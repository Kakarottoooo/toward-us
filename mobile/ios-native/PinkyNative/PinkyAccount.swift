import Foundation
import SwiftUI

@MainActor
final class PinkyAccount: ObservableObject {
    @Published private(set) var identity: PinkyIdentity?
    @Published private(set) var checking: Bool
    @Published private(set) var busy = false
    @Published private(set) var warning: String?
    @Published private(set) var restoreFailed = false
    @Published private(set) var widgetEnabled = false
    let api: PinkyAPI

    init(api: PinkyAPI = .configured) {
        self.api = api
        checking = api.hasSessionCookie
    }

    func restore() async {
        guard !busy else { return }
        defer { checking = false }
        guard api.hasSessionCookie else {
            if identity?.user != nil { clear() }
            return
        }
        if identity == nil { checking = true }
        let restored = await perform {
            identity = try await api.restoreIdentity()
            widgetEnabled = PinkyWidgetAccess.restore(for: identity?.user?.id)
        }
        restoreFailed = !restored && warning != nil && identity == nil
    }

    func authenticate(email: String, password: String, name: String?, language: PinkyLanguage) async -> Bool {
        await perform {
            let path = name == nil ? "/api/auth/login" : "/api/auth/register"
            let submitted = Credentials(email: email.lowercased(), password: password, name: name, language: language.rawValue)
            identity = try await api.post(path, body: submitted)
            widgetEnabled = PinkyWidgetAccess.restore(for: identity?.user?.id)
            if identity?.user != nil {
                try? await api.send("/api/me/language", body: ["language": language.rawValue])
            }
        }
    }

    func changeLanguage(_ language: PinkyLanguage) async {
        guard identity?.user != nil else { return }
        try? await api.send("/api/me/language", body: ["language": language.rawValue])
    }

    func setConsent(_ agree: Bool, language: PinkyLanguage) async -> Bool {
        await perform {
            try await api.send("/api/privacy/ai-consent", body: Consent(agree: agree, language: language.rawValue))
            identity = try await api.get("/api/auth/me")
        }
    }

    func invite(language: PinkyLanguage) async -> Bool {
        await perform {
            let reply: PinkyPairingResponse = try await api.post("/api/partner/invitations", body: ["language": language.rawValue])
            identity = PinkyIdentity(user: identity?.user, pairing: reply.pairing)
        }
    }

    func join(code: String, language: PinkyLanguage) async -> Bool {
        await perform {
            let reply: PinkyPairingResponse = try await api.post("/api/partner/accept", body: ["code": code, "language": language.rawValue])
            identity = PinkyIdentity(user: identity?.user, pairing: reply.pairing)
        }
    }

    func signOut() async -> Bool {
        await perform {
            if widgetEnabled {
                do { try await PinkyWidgetAccess.disable(api: api) }
                catch let error as PinkyAPIError where error.statusCode == 401 { PinkyWidgetAccess.clear() }
                widgetEnabled = false
            }
            try await api.send("/api/auth/logout", body: [String: String]())
            clear()
        }
    }

    var widgetAvailable: Bool { PinkyWidgetAccess.available }

    func setWidget(_ enabled: Bool) async {
        guard let userId = identity?.user?.id, widgetAvailable else { return }
        await perform {
            if enabled { try await PinkyWidgetAccess.enable(api: api, userId: userId) }
            else { try await PinkyWidgetAccess.disable(api: api) }
            widgetEnabled = PinkyWidgetAccess.enabled(for: userId)
        }
    }

    func deleteAccount(password: String, language: PinkyLanguage) async -> Bool {
        await perform {
            try await api.delete("/api/privacy/account", body: Confirmation(password: password, confirm: true, language: language.rawValue))
            clear()
        }
    }

    func leave(password: String, language: PinkyLanguage) async -> Bool {
        await perform {
            try await api.send("/api/privacy/leave", body: Confirmation(password: password, confirm: true, language: language.rawValue))
            identity = try await api.get("/api/auth/me")
        }
    }

    func recoveryCode(password: String, language: PinkyLanguage) async -> String? {
        var result: String?
        await perform {
            let response: RecoveryCode = try await api.post("/api/privacy/recovery-code", body: ["password": password, "language": language.rawValue])
            result = response.recoveryCode
        }
        return result
    }

    func reset(email: String, code: String, password: String, language: PinkyLanguage) async -> Bool {
        await perform {
            try await api.send("/api/auth/recover", body: ["email": email, "recoveryCode": code, "password": password, "language": language.rawValue])
            clear()
        }
    }

    func requestPasswordLink(email: String, language: PinkyLanguage) async -> Bool {
        await perform {
            try await api.send("/api/auth/reset-request", body: ["email": email, "language": language.rawValue])
        }
    }

    func clearWarning() {
        warning = nil
        restoreFailed = false
    }

    private func clear() {
        api.clearSession()
        PinkyWidgetAccess.clear()
        widgetEnabled = false
        identity = PinkyIdentity(user: nil, pairing: nil)
    }

    @discardableResult
    private func perform(_ action: () async throws -> Void) async -> Bool {
        guard !busy else { return false }
        busy = true
        clearWarning()
        defer { busy = false }
        do {
            try await action()
            return true
        } catch is CancellationError {
            return false
        } catch let error as URLError where error.code == .cancelled {
            return false
        } catch {
            warning = error.localizedDescription
            return false
        }
    }

    private struct Credentials: Encodable {
        let email: String
        let password: String
        let name: String?
        let language: String
    }
    private struct Consent: Encodable { let agree: Bool; let language: String }
    private struct Confirmation: Encodable { let password: String; let confirm: Bool; let language: String }
    private struct RecoveryCode: Decodable { let recoveryCode: String }
}
