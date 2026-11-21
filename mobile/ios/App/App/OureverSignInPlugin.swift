import AuthenticationServices
import Capacitor
import UIKit

@objc(OureverSignInPlugin)
final class OureverSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    let identifier = "OureverSignInPlugin"
    let jsName = "OureverSignIn"
    let pluginMethods = [CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)]
    private var authorization: ASWebAuthenticationSession?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.authorization == nil, self.bridge?.viewController?.view.window != nil,
                  PinkyOrigin.matches(self.bridge?.webView?.url), let raw = call.getString("url"),
                  let start = URL(string: raw), PinkyOrigin.matches(start), start.scheme == "https",
                  start.user == nil, start.password == nil,
                  ["/api/auth/oauth/google/authorize", "/api/auth/oauth/apple/authorize"].contains(start.path) else {
                call.reject("unavailable")
                return
            }
            let session = ASWebAuthenticationSession(url: start, callbackURLScheme: "us.toward.app") { returned, error in
                DispatchQueue.main.async {
                    self.authorization = nil
                    guard PinkyOrigin.matches(self.bridge?.webView?.url) else { call.reject("unavailable"); return }
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        call.resolve(["error": "cancelled"])
                        return
                    }
                    guard error == nil, let returned, let parts = URLComponents(url: returned, resolvingAgainstBaseURL: false),
                          parts.scheme == "us.toward.app", parts.host == "signin", parts.path.isEmpty,
                          parts.user == nil, parts.password == nil, parts.port == nil else { call.reject("failed"); return }
                    let items = parts.queryItems ?? []
                    if let reason = items.first(where: { $0.name == "error" })?.value {
                        call.resolve(["error": ["cancelled", "adult_required", "referral_ineligible"].contains(reason) ? reason : "failed"])
                    } else if let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty {
                        call.resolve(["code": code])
                    } else {
                        call.reject("failed")
                    }
                }
            }
            session.presentationContextProvider = self
            self.authorization = session
            if !session.start() { self.authorization = nil; call.reject("unavailable") }
        }
    }
}
