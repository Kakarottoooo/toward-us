import Foundation
import SwiftUI
import WidgetKit

// Everything the widget shows, without the WidgetKit entry point, so AppTests can render it and drive the loader too.

/// GET /api/widget (contract v1). Only numbers, the partner's name and a date title: never message text or anything private.
struct WidgetPayload: Codable, Equatable {
    struct Streak: Codable, Equatable { var days: Int; var me: Bool?; var partner: Bool? }
    struct Next: Codable, Equatable { var title: String; var date: String?; var inDays: Int }
    var v: Int?
    var language: String?
    var partnerName: String?
    var daysTogether: Int?
    var streak: Streak?
    var next: Next?
    var updatedAt: String?

    static let sample = WidgetPayload(v: 1, language: PinkyLanguage.device.rawValue, partnerName: "Mia", daysTogether: 123,
                                      streak: Streak(days: 5, me: true, partner: false), next: Next(title: PinkyLanguage.device.say("生日", "Birthday", "Cumpleaños"), date: nil, inDays: 25), updatedAt: nil)
}

enum PinkyLanguage: String {
    case zh, en, es
    /// The phone's language, for the states before the server has told us the member's own choice.
    static var device: PinkyLanguage {
        let first = (Locale.preferredLanguages.first ?? "en").lowercased()
        return first.hasPrefix("zh") ? .zh : first.hasPrefix("es") ? .es : .en
    }
    init(payload: String?) { self = PinkyLanguage(rawValue: payload ?? "") ?? .device }
    func say(_ zh: String, _ en: String, _ es: String) -> String { self == .zh ? zh : self == .es ? es : en }
}

enum WidgetContent: Equatable {
    case ready(WidgetPayload)
    /// No token, or the server refused it (401): the member has to open the app and sign in.
    case signedOut(PinkyLanguage)
    /// Signed in but nothing to show yet (server unreachable, or /api/widget not deployed): a gentle way into the app.
    case unavailable(PinkyLanguage)
}

enum WidgetStore {
    static let appGroup = "group.us.toward.app"
    static let baseUrlKey = "pinky.widget.baseUrl"
    static let tokenKey = "pinky.widget.token"
    static let lastPayloadKey = "pinky.widget.last"
}

enum WidgetLoader {
    /// Reads the server address and widget token the app saved in the App Group, and fetches today's numbers.
    static func load(defaults: UserDefaults? = UserDefaults(suiteName: WidgetStore.appGroup), session: URLSession = .shared) async -> WidgetContent {
        let device = PinkyLanguage.device
        guard let base = defaults?.string(forKey: WidgetStore.baseUrlKey), let token = defaults?.string(forKey: WidgetStore.tokenKey), !token.isEmpty,
              let url = URL(string: base + "/api/widget") else { return .signedOut(device) }
        let cached = defaults?.data(forKey: WidgetStore.lastPayloadKey).flatMap { try? JSONDecoder().decode(WidgetPayload.self, from: $0) }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let reply = try? await session.data(for: request), let status = (reply.1 as? HTTPURLResponse)?.statusCode {
            let data = reply.0
            if status == 401 {
                defaults?.removeObject(forKey: WidgetStore.lastPayloadKey)
                return .signedOut(PinkyLanguage(payload: cached?.language))
            }
            if status == 200, let payload = try? JSONDecoder().decode(WidgetPayload.self, from: data) {
                defaults?.set(data, forKey: WidgetStore.lastPayloadKey)
                return .ready(payload)
            }
        }
        // 404 until the server ships /api/widget, rate limits, 5xx, offline: keep the last good numbers, else a gentle prompt.
        if let cached { return .ready(cached) }
        return .unavailable(device)
    }
}

enum PinkyPalette {
    static let ivory = Color(red: 0xf4 / 255, green: 0xef / 255, blue: 0xe6 / 255)
    static let card = Color(red: 0xff / 255, green: 0xfd / 255, blue: 0xf8 / 255)
    static let ink = Color(red: 0x25 / 255, green: 0x25 / 255, blue: 0x25 / 255)
    static let muted = Color(red: 0x6f / 255, green: 0x68 / 255, blue: 0x60 / 255)
    static let pink = Color(red: 0xe0 / 255, green: 0x40 / 255, blue: 0x5a / 255)
    static let pinkInk = Color(red: 0xc2 / 255, green: 0x34 / 255, blue: 0x4f / 255)
}

/// Words for one payload, in the member's language.
struct WidgetWords {
    let payload: WidgetPayload
    var lang: PinkyLanguage { PinkyLanguage(payload: payload.language) }
    var partner: String { payload.partnerName?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? lang.say("TA", "Partner", "Pareja") }
    /// The big number: days together, or the streak when the couple has not set the day they got together.
    var hero: Int { payload.daysTogether ?? payload.streak?.days ?? 0 }
    var heroLabel: String { payload.daysTogether != nil ? lang.say("在一起的天数", "days together", "días juntos") : lang.say("连续一起的天数", "days in a row", "días seguidos") }
    func days(_ n: Int) -> String { lang.say("\(n) 天", n == 1 ? "1 day" : "\(n) days", n == 1 ? "1 día" : "\(n) días") }
    var streak: String { "🔥 " + days(payload.streak?.days ?? 0) }
    /// Who has shown up today: ✓ done, ○ not yet.
    var today: String {
        let mark: (Bool?) -> String = { $0 == true ? "✓" : "○" }
        return lang.say("你", "You", "Tú") + " " + mark(payload.streak?.me) + "  " + partner + " " + mark(payload.streak?.partner)
    }
    var next: String {
        guard let next = payload.next else { return lang.say("还没有下一个日子", "No date coming up yet", "Aún no hay fecha próxima") }
        let when: String
        switch next.inDays {
        case ...0: when = lang.say("就是今天", "today", "hoy")
        case 1: when = lang.say("明天", "tomorrow", "mañana")
        default: when = lang.say("还有 \(next.inDays) 天", "in \(next.inDays) days", "en \(next.inDays) días")
        }
        return next.title + " · " + when
    }
}

private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }

/// The widget's face for one family. Family is passed in (not read from the environment) so tests can render every size.
struct PinkyWidgetContent: View {
    let content: WidgetContent
    let family: WidgetFamily

    var body: some View {
        switch content {
        case .ready(let payload): ready(WidgetWords(payload: payload))
        case .signedOut(let lang): prompt(lang.say("打开 Pinky 登录", "Open Pinky to sign in", "Abre Pinky para iniciar sesión"))
        case .unavailable(let lang): prompt(lang.say("打开 Pinky 看看今天", "Open Pinky to see today", "Abre Pinky para ver hoy"))
        }
    }

    @ViewBuilder private func ready(_ words: WidgetWords) -> some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text("\(words.hero)").font(.system(size: 20, weight: .bold, design: .rounded)).minimumScaleFactor(0.5).lineLimit(1)
                    Text("♥").font(.system(size: 11))
                }.padding(4)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("♥ " + words.partner + " · " + words.days(words.hero)).font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                Text(words.streak + "  " + words.today).font(.caption).lineLimit(1).minimumScaleFactor(0.7)
                Text(words.next).font(.caption).lineLimit(1).minimumScaleFactor(0.7)
            }.frame(maxWidth: .infinity, alignment: .leading)
        case .systemMedium:
            HStack(spacing: 14) {
                hero(words)
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(words.streak).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundColor(PinkyPalette.ink)
                        Text(words.today).font(.system(size: 12, weight: .medium)).foregroundColor(PinkyPalette.muted).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(words.lang.say("下一个日子", "Next date", "Próxima fecha")).font(.system(size: 11, weight: .medium)).foregroundColor(PinkyPalette.muted)
                        Text(words.next).font(.system(size: 13, weight: .semibold)).foregroundColor(PinkyPalette.pinkInk).lineLimit(2).minimumScaleFactor(0.8)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(PinkyPalette.card))
            }
        default:
            VStack(alignment: .leading, spacing: 0) {
                hero(words)
                Spacer(minLength: 6)
                Text(words.streak).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundColor(PinkyPalette.ink)
                Text(words.today).font(.system(size: 11, weight: .medium)).foregroundColor(PinkyPalette.muted).lineLimit(1).minimumScaleFactor(0.6)
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func hero(_ words: WidgetWords) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("♥ " + words.partner).font(.system(size: 13, weight: .semibold)).foregroundColor(PinkyPalette.pinkInk).lineLimit(1)
            Text("\(words.hero)").font(.system(size: 46, weight: .bold, design: .rounded)).foregroundColor(PinkyPalette.ink).lineLimit(1).minimumScaleFactor(0.5)
            Text(words.heroLabel).font(.system(size: 11, weight: .medium)).foregroundColor(PinkyPalette.muted).lineLimit(1).minimumScaleFactor(0.7)
        }
    }

    @ViewBuilder private func prompt(_ message: String) -> some View {
        switch family {
        case .accessoryCircular:
            ZStack { AccessoryWidgetBackground(); Text("♥").font(.system(size: 22, weight: .bold)) }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("♥ Pinky").font(.headline)
                Text(message).font(.caption).lineLimit(2)
            }.frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 6) {
                Text("♥ Pinky").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundColor(PinkyPalette.pinkInk)
                Spacer(minLength: 0)
                Text(message).font(.system(size: family == .systemMedium ? 20 : 17, weight: .semibold, design: .rounded)).foregroundColor(PinkyPalette.ink).lineLimit(3).minimumScaleFactor(0.8)
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
