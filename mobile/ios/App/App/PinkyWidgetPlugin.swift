import Foundation
import Capacitor
import WidgetKit

@objc(PinkyWidgetPlugin)
public class PinkyWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PinkyWidgetPlugin"
    public let jsName = "PinkyWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    @objc func setWidgetData(_ call: CAPPluginCall) {
        guard let raw = call.getString("baseUrl"), PinkyOrigin.matches(URL(string: raw)), let origin = PinkyOrigin.url?.absoluteString,
              let token = call.getString("token"), !token.isEmpty else { call.reject("Invalid widget configuration"); return }
        guard WidgetStore.connect(origin: origin, token: token) else { call.reject("Widget storage unavailable"); return }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        guard WidgetStore.clear() else { call.reject("Widget storage unavailable"); return }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
