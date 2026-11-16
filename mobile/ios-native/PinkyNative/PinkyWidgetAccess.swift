import Foundation
import WidgetKit

enum PinkyWidgetAccess {
    private static let group = "group.us.toward.app"
    private static let baseKey = "pinky.widget.baseUrl"
    private static let tokenKey = "pinky.widget.token"
    private static let cacheKey = "pinky.widget.last"
    private static let ownerKey = "pinky.widget.owner"
    private static let kind = "PinkyNativeWidget"

    private static var defaults: UserDefaults? {
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil else { return nil }
        return UserDefaults(suiteName: group)
    }

    static var available: Bool { defaults != nil }

    static func enabled(for userId: String?) -> Bool {
        guard let userId, let defaults else { return false }
        return defaults.string(forKey: ownerKey) == userId && defaults.string(forKey: tokenKey) != nil
    }

    static func restore(for userId: String?) -> Bool {
        if let owner = defaults?.string(forKey: ownerKey), owner != userId { clear() }
        return enabled(for: userId)
    }

    static func enable(api: PinkyAPI, userId: String) async throws {
        guard let defaults else { return }
        let result: Token = try await api.post("/api/widget/token", body: [String: String]())
        defaults.removeObject(forKey: cacheKey)
        defaults.set(api.baseURL.absoluteString, forKey: baseKey)
        defaults.set(result.token, forKey: tokenKey)
        defaults.set(userId, forKey: ownerKey)
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
    }

    static func disable(api: PinkyAPI) async throws {
        try await api.delete("/api/widget/token", body: [String: String]())
        clear()
    }

    static func clear() {
        guard let defaults else { return }
        [baseKey, tokenKey, cacheKey, ownerKey].forEach { defaults.removeObject(forKey: $0) }
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
    }

    private struct Token: Decodable { let token: String }
}
