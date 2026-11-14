import Foundation
import Capacitor
import WidgetKit

/// Hands the home-screen widget what it needs to fetch the couple's day on its own: the server address and a widget-only
/// token (not the sign-in cookie) the page got from POST /api/widget/token. Both live in the App Group the widget shares.
@objc(PinkyWidgetPlugin)
public class PinkyWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PinkyWidgetPlugin"
    public let jsName = "PinkyWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    static let appGroup = "group.us.toward.app"
    static let baseUrlKey = "pinky.widget.baseUrl"
    static let tokenKey = "pinky.widget.token"
    /// The widget's last good payload, shown when the network is down; removed on sign-out with everything else.
    static let lastPayloadKey = "pinky.widget.last"

    @objc func setWidgetData(_ call: CAPPluginCall) {
        guard let raw = call.getString("baseUrl"), let url = URL(string: raw), let scheme = url.scheme, ["https", "http"].contains(scheme), url.host != nil else {
            call.reject("baseUrl must be an http(s) origin", "invalid_base_url"); return
        }
        guard let token = call.getString("token"), !token.isEmpty else { call.reject("Missing token", "invalid_token"); return }
        guard let defaults = UserDefaults(suiteName: Self.appGroup) else { call.reject("App Group unavailable", "no_app_group"); return }
        let origin = url.absoluteString.hasSuffix("/") ? String(url.absoluteString.dropLast()) : url.absoluteString
        // A new token may be another account: never show the previous couple's numbers while the new ones load.
        if defaults.string(forKey: Self.baseUrlKey) != origin || defaults.string(forKey: Self.tokenKey) != token { defaults.removeObject(forKey: Self.lastPayloadKey) }
        defaults.set(origin, forKey: Self.baseUrlKey)
        defaults.set(token, forKey: Self.tokenKey)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        if let defaults = UserDefaults(suiteName: Self.appGroup) {
            for key in [Self.baseUrlKey, Self.tokenKey, Self.lastPayloadKey] { defaults.removeObject(forKey: key) }
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
