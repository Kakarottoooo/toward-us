import UIKit
import Capacitor
import WebKit
import Photos
import CoreLocation

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PinkyBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        for context in connectionOptions.urlContexts where context.url.isFileURL { ChatImportUploader.shared.receive(context.url, window: window) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Files shared to Pinky (WhatsApp "Export chat", Files, Mail) are chat-history imports; other links go to Capacitor.
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
        guard let webView = (window?.rootViewController as? CAPBridgeViewController)?.webView, let page = webView.url, page.scheme?.hasPrefix("http") == true, !webView.isLoading else {
            // A cold start: wait for the app's page to load (and its sign-in cookie to be readable) before uploading.
            if attempt < 40 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.receive(file, window: window, attempt: attempt + 1) } }
            return
        }
        let access = file.startAccessingSecurityScopedResource()
        let data = try? Data(contentsOf: file)
        if access { file.stopAccessingSecurityScopedResource() }
        if file.path.contains("/Inbox/") { try? FileManager.default.removeItem(at: file) }
        guard let data = data, !data.isEmpty else { return }
        webView.evaluateJavaScript("localStorage.getItem('toward-us.language')") { value, _ in
            let language = ["zh", "en", "es"].contains(value as? String ?? "") ? value as! String : "zh"
            var components = URLComponents(url: page, resolvingAgainstBaseURL: false)!
            components.path = "/api/imports"; components.fragment = nil
            components.queryItems = [URLQueryItem(name: "name", value: file.lastPathComponent), URLQueryItem(name: "language", value: language)]
            guard let endpoint = components.url, let host = page.host else { return }
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                var request = URLRequest(url: endpoint)
                request.httpMethod = "POST"
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
                            let message = json?["error"] as? String ?? (status == 401 ? "Please open Pinky and sign in first." : "Pinky could not import this file.")
                            let alert = UIAlertController(title: "Pinky", message: message, preferredStyle: .alert)
                            alert.addAction(UIAlertAction(title: "OK", style: .default))
                            window?.rootViewController?.present(alert, animated: true)
                        }
                    }
                }.resume()
            }
        }
    }
}

/// The bridge with Pinky's own native plugins registered (Capacitor 8 has no auto-registration for app-target plugins).
class PinkyBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PinkyPhotosPlugin())
    }
}

/// Reads one photo album the member picked (usually a shared couple album) so Pinky can turn it into the couple's memories.
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
    ]
    private let geocoder = CLGeocoder()

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
