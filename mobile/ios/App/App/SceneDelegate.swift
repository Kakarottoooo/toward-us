import UIKit
import Capacitor
import WebKit
import Photos
import CoreLocation
import PhotosUI
import Vision

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PinkyBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        if let response = connectionOptions.notificationResponse,
           let controller = window?.rootViewController as? PinkyBridgeViewController {
            controller.bridge?.notificationRouter.pushNotificationHandler?.didReceive(response: response)
        }
        for context in connectionOptions.urlContexts where context.url.isFileURL { ChatImportUploader.shared.receive(context.url, window: window) }
    }

    func sceneWillEnterForeground(_ scene: UIScene) { PinkyTelemetry.shared.foreground() }
    func sceneDidEnterBackground(_ scene: UIScene) { PinkyTelemetry.shared.background() }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Files shared to Ourever (WhatsApp "Export chat", Files, Mail) are chat-history imports; other links go to Capacitor.
        let files = URLContexts.filter { $0.url.isFileURL }
        for context in files { ChatImportUploader.shared.receive(context.url, window: window) }
        let others = URLContexts.subtracting(files)
        if !others.isEmpty { SceneDelegateProxy.shared.scene(scene, openURLContexts: others) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Uploads a chat export shared from another app straight into the member's private chat-history import, signed in with
/// the web view's own session cookie, then opens that import. The copy iOS placed in this app's Inbox is deleted afterwards.
final class ChatImportUploader {
    static let shared = ChatImportUploader()

    func receive(_ file: URL, window: UIWindow?, attempt: Int = 0) {
        guard let webView = (window?.rootViewController as? CAPBridgeViewController)?.webView, let page = webView.url, PinkyOrigin.matches(page), !webView.isLoading else {
            // A cold start: wait for the app's page to load (and its sign-in cookie to be readable) before uploading.
            if attempt < 40 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.receive(file, window: window, attempt: attempt + 1) } }
            return
        }
        webView.evaluateJavaScript("localStorage.getItem('toward-us.language')") { value, _ in
            let language = (value as? String) ?? "en"
            let title: String, message: String, proceed: String, cancel: String
            switch language {
            case "zh":
                (title, message, proceed, cancel) = ("导入这份聊天记录？", "记录也包含对方的消息，分析时这些内容会发送给 OpenAI 或 Anthropic。请只导入你有权分享的对话。", "确认导入", "取消")
            case "es":
                (title, message, proceed, cancel) = ("¿Importar esta conversación?", "El archivo también contiene mensajes de la otra persona. Su contenido se envía a OpenAI o Anthropic para analizarlo. Importa solo conversaciones que tengas permiso para compartir.", "Importar", "Cancelar")
            default:
                (title, message, proceed, cancel) = ("Import this conversation?", "The file also contains the other person’s messages. Its contents are sent to OpenAI or Anthropic for analysis. Only import conversations you have permission to share.", "Import", "Cancel")
            }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: cancel, style: .cancel) { _ in self.removeInboxCopy(file) })
            alert.addAction(UIAlertAction(title: proceed, style: .default) { _ in
                guard PinkyOrigin.matches(webView.url) else { return }
                self.upload(file, page: page, language: language, webView: webView, window: window)
            })
            window?.rootViewController?.present(alert, animated: true)
        }
    }

    private func removeInboxCopy(_ file: URL) {
        let inbox = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Inbox")
        if file.standardizedFileURL.deletingLastPathComponent().path == inbox.standardizedFileURL.path {
            try? FileManager.default.removeItem(at: file)
        }
    }

    private func upload(_ file: URL, page: URL, language: String, webView: WKWebView, window: UIWindow?) {
        let access = file.startAccessingSecurityScopedResource()
        let data = try? Data(contentsOf: file)
        if access { file.stopAccessingSecurityScopedResource() }
        removeInboxCopy(file)
        guard let data, !data.isEmpty else { return }
        var components = URLComponents(url: page, resolvingAgainstBaseURL: false)!
        components.path = "/api/imports"; components.fragment = nil
        components.queryItems = [URLQueryItem(name: "name", value: file.lastPathComponent), URLQueryItem(name: "language", value: language)]
        guard let endpoint = components.url, let host = page.host else { return }
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("1", forHTTPHeaderField: "X-Pinky-Import-Disclosure")
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            let mine = cookies.filter { cookie in let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain; return host == domain || host.hasSuffix("." + domain) }
            for (name, value) in HTTPCookie.requestHeaderFields(with: mine) { request.setValue(value, forHTTPHeaderField: name) }
            URLSession.shared.uploadTask(with: request, from: data) { body, response, _ in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let json = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                let id = (json?["import"] as? [String: Any])?["id"] as? String
                DispatchQueue.main.async {
                    if status == 201, let id = id, let target = URL(string: "/?view=import&import=\(id)", relativeTo: page) {
                        webView.load(URLRequest(url: target))
                    } else {
                        let message = json?["error"] as? String ?? (status == 401 ? "Please open Ourever and sign in first." : "Ourever could not import this file.")
                        let alert = UIAlertController(title: "Ourever", message: message, preferredStyle: .alert)
                        alert.addAction(UIAlertAction(title: "OK", style: .default))
                        window?.rootViewController?.present(alert, animated: true)
                    }
                }
            }.resume()
        }
    }
}

private final class PinkyLanguagePreference: NSObject, WKScriptMessageHandlerWithReply {
    private let key = "PinkyInterfaceLanguage"
    private let choices = ["en", "es", "zh"]

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url else { replyHandler(nil, "Unavailable"); return }
        if PinkyOrigin.matches(url), let language = message.body as? String, choices.contains(language) {
            UserDefaults.standard.set(language, forKey: key)
            replyHandler(language, nil)
        } else if url.scheme == "capacitor", url.host == "localhost", url.lastPathComponent == "offline.html" {
            replyHandler(UserDefaults.standard.string(forKey: key) ?? Locale.preferredLanguages.compactMap { $0.split(separator: "-").first.map(String.init) }.first(where: choices.contains) ?? "en", nil)
        } else {
            replyHandler(nil, "Unavailable")
        }
    }
}

/// The bridge with Ourever's own native plugins registered (Capacitor 8 has no auto-registration for app-target plugins).
@objc(OureverFeedbackPlugin)
final class OureverFeedbackPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "OureverFeedbackPlugin"
    let jsName = "OureverFeedback"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
                                            CAPPluginMethod(name: "shareExport", returnType: CAPPluginReturnPromise)]

    override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(screenshotTaken),
            name: UIApplication.userDidTakeScreenshotNotification, object: nil)
    }

    @objc private func screenshotTaken() {
        guard PinkyOrigin.matches(bridge?.webView?.url) else { return }
        notifyListeners("screenshot", data: [:])
    }

    @objc func shareExport(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard PinkyOrigin.matches(self.bridge?.webView?.url),
                  let presenter = self.bridge?.viewController, presenter.presentedViewController == nil,
                  let contents = call.getString("contents") else { call.reject("export_unavailable"); return }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            let file = directory.appendingPathComponent("ourever-export.json")
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try Data(contents.utf8).write(to: file, options: [.atomic, .completeFileProtection])
            } catch {
                try? FileManager.default.removeItem(at: directory)
                call.reject("export_unavailable")
                return
            }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = presenter.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            sheet.completionWithItemsHandler = { _, completed, _, error in
                try? FileManager.default.removeItem(at: directory)
                if error != nil { call.reject("export_unavailable") }
                else { call.resolve(["completed": completed]) }
            }
            presenter.present(sheet, animated: true)
        }
    }

    @objc func info(_ call: CAPPluginCall) {
        guard PinkyOrigin.matches(bridge?.webView?.url) else { call.reject("Unavailable"); return }
        var system = utsname()
        uname(&system)
        let machine = withUnsafeBytes(of: &system.machine) { bytes in
            String(decoding: bytes.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        call.resolve(["app_version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                      "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
                      "device_model": machine, "os_version": UIDevice.current.systemVersion])
    }
}

/// Paints the safe areas the web view insets (status bar, home indicator) in the page's own background colour, so the
/// plum welcome and sign-in fill the whole screen and signed-in pages keep their paper colour.
private final class PinkyPageColor: NSObject, WKScriptMessageHandler {
    weak var controller: PinkyBridgeViewController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let controller, PinkyOrigin.matches(controller.webView?.url), let text = message.body as? String else { return }
        let parts = text.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        guard parts.count >= 3, parts.count < 4 || parts[3] > 0.5 else { return }
        let color = UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: 1)
        controller.applyPageColor(color, dark: 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2] < 128)
    }
}

class PinkyBridgeViewController: CAPBridgeViewController {
    private var pageIsDark = false
    override var preferredStatusBarStyle: UIStatusBarStyle { pageIsDark ? .lightContent : .darkContent }

    func applyPageColor(_ color: UIColor, dark: Bool) {
        view.backgroundColor = color
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color
        if dark != pageIsDark { pageIsDark = dark; setNeedsStatusBarAppearanceUpdate() }
    }

    override open func capacitorDidLoad() {
        let pageColor = PinkyPageColor()
        pageColor.controller = self
        webView?.configuration.userContentController.add(pageColor, contentWorld: .defaultClient, name: "pinkyPageColor")
        webView?.configuration.userContentController.addUserScript(WKUserScript(source: """
        (() => {
            let last = '';
            const report = () => {
                const body = document.body;
                if (!body) return;
                const color = getComputedStyle(body).backgroundColor;
                if (color && color !== last) { last = color; window.webkit.messageHandlers.pinkyPageColor.postMessage(color); }
            };
            let queued = false;
            const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; report(); }); } };
            report();
            new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        })();
        """, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
        bridge?.registerPluginInstance(OureverFeedbackPlugin())
        bridge?.registerPluginInstance(OureverSignInPlugin())
        bridge?.registerPluginInstance(PinkyPhotosPlugin())
        bridge?.registerPluginInstance(PinkyWidgetPlugin())
        // Render pages already carrying this revision own their own styles. The bundled fallback also
        // covers a welcome screen mounted later by client-side navigation in an older cached document.
        guard let config = bridge?.config.getPluginConfig("PinkyWelcome"),
              let production = config.getString("productionOrigin"), let origin = URL(string: production),
              origin.scheme == "https", PinkyOrigin.matches(origin),
              let file = Bundle.main.url(forResource: "welcome-layout", withExtension: "css"),
              let css = try? String(contentsOf: file, encoding: .utf8),
              let stylesheet = try? JSONEncoder().encode(css),
              let encodedOrigin = try? JSONEncoder().encode(production) else { return }
        let controller = webView?.configuration.userContentController
        controller?.addScriptMessageHandler(PinkyLanguagePreference(), contentWorld: .defaultClient, name: "pinkyLanguage")
        let languageScript = """
        (() => {
            const save = window.webkit.messageHandlers.pinkyLanguage;
            if (location.origin === \(String(decoding: encodedOrigin, as: UTF8.self))) {
                try {
                    const key = 'toward-us.language';
                    if (!['en', 'zh', 'es'].includes(localStorage.getItem(key))) {
                        const preferred = navigator.languages.map(tag => tag.toLowerCase().split('-')[0]);
                        localStorage.setItem(key, preferred.find(lang => ['en', 'zh', 'es'].includes(lang)) || 'en');
                    }
                    const sync = () => save.postMessage(localStorage.getItem(key)).catch(() => {});
                    const observe = () => {
                        sync();
                        new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
                    };
                    if (document.documentElement) observe();
                    else document.addEventListener('DOMContentLoaded', observe, { once: true });
                } catch {}
            } else if (location.protocol === 'capacitor:' && location.hostname === 'localhost' && location.pathname.endsWith('/offline.html')) {
                save.postMessage(null).then(value => {
                    if (['en', 'zh', 'es'].includes(value)) {
                        localStorage.setItem('toward-us.language', value);
                        document.dispatchEvent(new Event('pinky-language-ready'));
                    }
                }).catch(() => {});
            }
        })();
        """
        controller?.addUserScript(WKUserScript(source: languageScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
        let script = """
        if (location.origin === \(String(decoding: encodedOrigin, as: UTF8.self))) {
            const applyWelcomeLayout = () => {
                if (!getComputedStyle(document.documentElement).getPropertyValue('--pinky-welcome-layout').trim()) {
                    const style = document.createElement('style');
                    style.id = 'pinky-native-welcome-layout';
                    style.textContent = \(String(decoding: stylesheet, as: UTF8.self));
                    document.head.append(style);
                }
            };
            applyWelcomeLayout();
        }
        """
        webView?.configuration.userContentController.addUserScript(
            WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient)
        )
    }
}

/// Reads one photo album the member picked (usually a shared couple album) so Ourever can turn it into the couple's memories.
/// The web app asks for times and places first and only then for small copies of the few photos each memory needs.
@objc(PinkyPhotosPlugin)
public class PinkyPhotosPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PinkyPhotosPlugin"
    public let jsName = "PinkyPhotos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "access", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "albums", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "thumbnail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "place", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "findTogether", returnType: CAPPluginReturnPromise),
    ]
    private let geocoder = CLGeocoder()
    var pickCall: CAPPluginCall?

    private static func status(_ value: PHAuthorizationStatus) -> String {
        switch value {
        case .authorized: return "authorized"
        case .limited: return "limited"
        case .denied, .restricted: return "denied"
        default: return "unknown"
        }
    }
    private static func imagesOnly() -> PHFetchOptions {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        return options
    }

    /// The current photo permission; with ask true, iOS asks the member when they have not been asked yet.
    @objc func access(_ call: CAPPluginCall) {
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if current == .notDetermined && call.getBool("ask") == true {
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { value in call.resolve(["status": Self.status(value)]) }
        } else {
            call.resolve(["status": Self.status(current)])
        }
    }

    /// The member's albums with photos in them, shared iCloud albums included, biggest first.
    @objc func albums(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            var out: [[String: Any]] = []
            PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil).enumerateObjects { collection, _, _ in
                let count = PHAsset.fetchAssets(in: collection, options: Self.imagesOnly()).count
                if count > 0 { out.append(["id": collection.localIdentifier, "title": collection.localizedTitle ?? "", "count": count, "shared": collection.assetCollectionSubtype == .albumCloudShared]) }
            }
            out.sort { ($0["count"] as? Int ?? 0) > ($1["count"] as? Int ?? 0) }
            call.resolve(["albums": out])
        }
    }

    /// Every photo in one album: id, when (and that day on this phone's calendar) and where. No pixels.
    @objc func scan(_ call: CAPPluginCall) {
        guard let id = call.getString("albumId"), let collection = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [id], options: nil).firstObject else {
            call.reject("Album not found"); return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let iso = ISO8601DateFormatter()
            let day = DateFormatter(); day.dateFormat = "yyyy-MM-dd"; day.locale = Locale(identifier: "en_US_POSIX"); day.timeZone = .current
            var out: [[String: Any]] = []
            PHAsset.fetchAssets(in: collection, options: Self.imagesOnly()).enumerateObjects { asset, _, _ in
                guard let date = asset.creationDate else { return }
                var item: [String: Any] = ["id": asset.localIdentifier, "takenAt": iso.string(from: date), "day": day.string(from: date)]
                if let location = asset.location { item["lat"] = location.coordinate.latitude; item["lon"] = location.coordinate.longitude }
                out.append(item)
            }
            call.resolve(["assets": out])
        }
    }

    /// A small JPEG of one photo (fetched from iCloud when only a preview is on the phone).
    @objc func thumbnail(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            call.reject("Photo not found"); return
        }
        let side = CGFloat(call.getInt("size") ?? 1280)
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat; options.resizeMode = .fast; options.isNetworkAccessAllowed = true
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: side, height: side), contentMode: .aspectFit, options: options) { image, _ in
            guard let image = image, let data = image.jpegData(compressionQuality: 0.75) else { call.reject("No image"); return }
            call.resolve(["data": data.base64EncodedString()])
        }
    }

    /// A short place name for a spot (a landmark, else the town), in the member's language. Empty when unknown.
    @objc func place(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon") else { call.resolve(["name": ""]); return }
        let locale = Locale(identifier: call.getString("locale") ?? "en")
        DispatchQueue.main.async {
            self.geocoder.reverseGeocodeLocation(CLLocation(latitude: lat, longitude: lon), preferredLocale: locale) { marks, _ in
                let mark = marks?.first
                let name = mark?.areasOfInterest?.first ?? mark?.locality ?? mark?.subAdministrativeArea ?? mark?.administrativeArea ?? mark?.country ?? ""
                call.resolve(["name": name])
            }
        }
    }
}

// MARK: - 找你们俩的合照 (founder 11-06): no couple album needed. The member picks one photo of themself and one of their
// partner; Vision finds the faces and a feature print of each; then the library is scanned on the phone for photos with
// two faces that look like the two of them. Nothing leaves the phone here: the member reviews the candidates and only the
// ones they choose are uploaded, the same way an album is.
extension PinkyPhotosPlugin: PHPickerViewControllerDelegate {
    /// Opens the photo picker for one photo with a face; returns that face's feature print and a small crop to show.
    @objc func pickFace(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.filter = .images; config.selectionLimit = 1
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            self.pickCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pickCall else { return }
        pickCall = nil
        guard let id = results.first?.assetIdentifier, let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { call.reject("cancelled"); return }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let image = Self.image(of: asset, side: 1600, network: true), let faces = Self.faces(in: image), let face = faces.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }),
                  let crop = Self.crop(image, to: face.boundingBox), let print = Self.featurePrint(of: crop) else { call.reject("no_face"); return }
            let preview = UIImage(cgImage: crop).jpegData(compressionQuality: 0.8)?.base64EncodedString() ?? ""
            call.resolve(["print": Self.encode(print), "face": preview])
        }
    }

    /// Scans the library (newest first, the last few years) for photos with two faces that match the two prints. Returns the
    /// best candidates with when and where, sorted by how closely both faces match. Progress is sent as "findProgress".
    @objc func findTogether(_ call: CAPPluginCall) {
        guard let a = Self.decode(call.getString("a") ?? ""), let b = Self.decode(call.getString("b") ?? "") else { call.reject("missing faces"); return }
        let limit = call.getInt("limit") ?? 80, maxScan = call.getInt("maxScan") ?? 4000
        let since = Date(timeIntervalSince1970: (call.getDouble("since") ?? (Date().timeIntervalSince1970 - 3 * 365 * 86_400)))
        DispatchQueue.global(qos: .userInitiated).async {
            let options = PHFetchOptions()
            options.predicate = NSPredicate(format: "mediaType == %d AND creationDate > %@", PHAssetMediaType.image.rawValue, since as NSDate)
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            options.fetchLimit = maxScan
            let assets = PHAsset.fetchAssets(with: options)
            let iso = ISO8601DateFormatter()
            let day = DateFormatter(); day.dateFormat = "yyyy-MM-dd"; day.locale = Locale(identifier: "en_US_POSIX"); day.timeZone = .current
            var found: [(score: Float, item: [String: Any])] = []
            let total = assets.count
            for index in 0..<total {
                autoreleasepool {
                    let asset = assets.object(at: index)
                    if index % 50 == 0 { self.notifyListeners("findProgress", data: ["done": index, "total": total, "found": found.count]) }
                    // A quick look on the local thumbnail first; only photos with two or more faces are looked at closely.
                    guard let small = Self.image(of: asset, side: 512, network: false), let quick = Self.faces(in: small), quick.count >= 2,
                          let image = Self.image(of: asset, side: 1400, network: false), let faces = Self.faces(in: image), faces.count >= 2 else { return }
                    let prints = faces.prefix(8).compactMap { face -> [Float]? in Self.crop(image, to: face.boundingBox).flatMap { Self.featurePrint(of: $0) } }
                    guard prints.count >= 2 else { return }
                    var best = Float.greatestFiniteMagnitude
                    for i in prints.indices { for j in prints.indices where i != j { best = min(best, max(Self.distance(prints[i], a), Self.distance(prints[j], b))) } }
                    guard let date = asset.creationDate else { return }
                    var item: [String: Any] = ["id": asset.localIdentifier, "takenAt": iso.string(from: date), "day": day.string(from: date), "score": best]
                    if let location = asset.location { item["lat"] = location.coordinate.latitude; item["lon"] = location.coordinate.longitude }
                    found.append((best, item))
                }
            }
            found.sort { $0.score < $1.score }
            self.notifyListeners("findProgress", data: ["done": total, "total": total, "found": found.count])
            call.resolve(["assets": found.prefix(limit).map { $0.item }, "scanned": total, "withTwoFaces": found.count])
        }
    }

    // Helpers: images from the library, faces and their feature prints.
    static func image(of asset: PHAsset, side: CGFloat, network: Bool) -> CGImage? {
        let options = PHImageRequestOptions()
        options.isSynchronous = true; options.deliveryMode = network ? .highQualityFormat : .fastFormat; options.resizeMode = .fast; options.isNetworkAccessAllowed = network
        var out: CGImage?
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: side, height: side), contentMode: .aspectFit, options: options) { image, _ in out = image?.cgImage }
        return out
    }
    static func faces(in image: CGImage) -> [VNFaceObservation]? {
        let request = VNDetectFaceRectanglesRequest()
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return request.results?.filter { $0.boundingBox.width * CGFloat(image.width) >= 40 }
    }
    static func crop(_ image: CGImage, to box: CGRect) -> CGImage? {
        let w = CGFloat(image.width), h = CGFloat(image.height)
        // Vision boxes are normalized with the origin at the bottom left; widen a little to keep the whole face.
        var rect = CGRect(x: box.minX * w, y: (1 - box.maxY) * h, width: box.width * w, height: box.height * h)
        rect = rect.insetBy(dx: -rect.width * 0.25, dy: -rect.height * 0.25).intersection(CGRect(x: 0, y: 0, width: w, height: h))
        return image.cropping(to: rect.integral)
    }
    static func featurePrint(of image: CGImage) -> [Float]? {
        let request = VNGenerateImageFeaturePrintRequest()
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        guard let observation = request.results?.first as? VNFeaturePrintObservation, observation.elementType == .float else { return nil }
        return observation.data.withUnsafeBytes { Array($0.bindMemory(to: Float.self).prefix(observation.elementCount)) }
    }
    static func distance(_ x: [Float], _ y: [Float]) -> Float {
        guard x.count == y.count else { return .greatestFiniteMagnitude }
        var sum: Float = 0
        for index in x.indices { let d = x[index] - y[index]; sum += d * d }
        return sum.squareRoot()
    }
    static func encode(_ values: [Float]) -> String { values.withUnsafeBufferPointer { Data(buffer: $0) }.base64EncodedString() }
    static func decode(_ text: String) -> [Float]? {
        guard let data = Data(base64Encoded: text), data.count % 4 == 0, !data.isEmpty else { return nil }
        return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }
}
