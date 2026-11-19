import CryptoKit
import Foundation
import Security

/// The host and the widget are the only two targets entitled to read this device-only item.
struct WidgetCredential: Codable {
    let origin: String
    let token: String
    var lastPayload: Data?
}

enum WidgetStore {
    private static var query: [String: Any]? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "PinkyWidgetAccessGroup") as? String, !group.isEmpty else { return nil }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "PinkyWidget",
                kSecAttrAccount as String: "credential", kSecAttrAccessGroup as String: group]
    }

    private static func marker(_ token: String) -> Data {
        Data(SHA256.hash(data: Data(token.utf8)))
    }

    static func current() -> WidgetCredential? {
        guard var read = query else { return nil }
        read[kSecReturnData as String] = true
        var found: CFTypeRef?
        guard SecItemCopyMatching(read as CFDictionary, &found) == errSecSuccess, let data = found as? Data else { return nil }
        return try? JSONDecoder().decode(WidgetCredential.self, from: data)
    }

    static func connect(origin: String, token: String) -> Bool {
        guard let base = query else { return false }
        if let old = current(), old.origin == origin && old.token == token { return true }
        let credential = WidgetCredential(origin: origin, token: token, lastPayload: nil)
        guard let data = try? JSONEncoder().encode(credential) else { return false }
        let fields: [String: Any] = [kSecValueData as String: data, kSecAttrGeneric as String: marker(token),
                                     kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let update = SecItemUpdate(base as CFDictionary, fields as CFDictionary)
        if update == errSecSuccess { return true }
        guard update == errSecItemNotFound else { return false }
        return SecItemAdd(base.merging(fields) { _, new in new } as CFDictionary, nil) == errSecSuccess
    }

    static func cache(_ payload: Data?, for credential: WidgetCredential) -> Bool {
        guard var match = query else { return false }
        match[kSecAttrGeneric as String] = marker(credential.token)
        var updated = credential
        updated.lastPayload = payload
        guard let data = try? JSONEncoder().encode(updated) else { return false }
        return SecItemUpdate(match as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess
    }

    static func clear() -> Bool {
        guard let match = query else { return false }
        let result = SecItemDelete(match as CFDictionary)
        return result == errSecSuccess || result == errSecItemNotFound
    }
}
