import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
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
