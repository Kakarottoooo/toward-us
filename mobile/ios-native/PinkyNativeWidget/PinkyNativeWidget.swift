import Foundation
import SwiftUI
import WidgetKit

private enum WidgetLanguage: String, Codable {
    case zh, en, es

    static var device: Self {
        let first = Locale.preferredLanguages.first ?? "en"
        if first.hasPrefix("zh") { return .zh }
        if first.hasPrefix("es") { return .es }
        return .en
    }

    func say(_ zh: String, _ en: String, _ es: String) -> String {
        switch self {
        case .zh: return zh
        case .en: return en
        case .es: return es
        }
    }
}

/// The lock screen displays only counts. The richer response from /api/widget is never saved verbatim.
private struct WidgetCounts: Codable {
    let language: WidgetLanguage
    let daysTogether: Int?
    let streakDays: Int

    static var preview: Self {
        Self(language: .device, daysTogether: 123, streakDays: 5)
    }
}

private struct WidgetResponse: Decodable {
    struct Streak: Decodable { let days: Int }
    let v: Int
    let language: String?
    let daysTogether: Int?
    let streak: Streak

    var counts: WidgetCounts {
        WidgetCounts(
            language: WidgetLanguage(rawValue: language ?? "") ?? .device,
            daysTogether: daysTogether.map { max(0, $0) },
            streakDays: max(0, streak.days)
        )
    }
}

private enum WidgetStatus {
    case ready(WidgetCounts, cached: Bool)
    case needsAccount
    case unavailable
}

private struct WidgetEntry: TimelineEntry {
    let date: Date
    let status: WidgetStatus
}

private enum WidgetLoader {
    private static let appGroup = "group.us.toward.app"
    private static let baseKey = "pinky.widget.baseUrl"
    private static let tokenKey = "pinky.widget.token"
    private static let cacheKey = "pinky.widget.last"
    private static let maxCacheAge: TimeInterval = 24 * 60 * 60

    private struct CachedCounts: Codable {
        let savedAt: Date
        let counts: WidgetCounts
    }

    // Requests carry a widget-only bearer. Reject redirects so it never goes to a different origin.
    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    static func load(now: Date = .now) async -> WidgetStatus {
        guard let store = UserDefaults(suiteName: appGroup),
              let base = store.string(forKey: baseKey),
              let token = store.string(forKey: tokenKey),
              !token.isEmpty,
              let url = endpoint(base) else {
            return .needsAccount
        }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCache = nil
        let session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let response = try? await session.data(for: request)

        // The app may sign out or change accounts while a request is in flight.
        guard store.string(forKey: baseKey) == base, store.string(forKey: tokenKey) == token else {
            return .needsAccount
        }
        if let response, let http = response.1 as? HTTPURLResponse {
            if http.statusCode == 401 || http.statusCode == 403 {
                store.removeObject(forKey: cacheKey)
                return .needsAccount
            }
            if http.statusCode == 200,
               let payload = try? JSONDecoder().decode(WidgetResponse.self, from: response.0),
               payload.v == 1 {
                let counts = payload.counts
                if let cache = try? JSONEncoder().encode(CachedCounts(savedAt: now, counts: counts)) {
                    store.set(cache, forKey: cacheKey)
                }
                return .ready(counts, cached: false)
            }
        }
        if let cache = store.data(forKey: cacheKey),
           let saved = try? JSONDecoder().decode(CachedCounts.self, from: cache),
           (0..<maxCacheAge).contains(now.timeIntervalSince(saved.savedAt)) {
            return .ready(saved.counts, cached: true)
        }
        return .unavailable
    }

    private static func endpoint(_ base: String) -> URL? {
        guard var parts = URLComponents(string: base),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        #if DEBUG
        let loopback = parts.scheme == "http" && ["localhost", "127.0.0.1"].contains(host)
        #else
        let loopback = false
        #endif
        guard parts.scheme == "https" || loopback else { return nil }
        parts.path = "/api/widget"
        return parts.url
    }
}

private struct PinkyWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> WidgetEntry {
        WidgetEntry(date: .now, status: .ready(.preview, cached: false))
    }

    func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
        } else {
            Task { completion(WidgetEntry(date: .now, status: await WidgetLoader.load())) }
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
        Task {
            let now = Date.now
            let entry = WidgetEntry(date: now, status: await WidgetLoader.load(now: now))
            completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(30 * 60))))
        }
    }
}

private struct PinkyWidgetFace: View {
    @Environment(\.widgetFamily) private var family
    let entry: WidgetEntry

    private var accessory: Bool {
        family == .accessoryCircular || family == .accessoryRectangular || family == .accessoryInline
    }

    var body: some View {
        Group {
            switch entry.status {
            case .ready(let counts, let cached):
                face(counts, cached: cached)
            case .needsAccount:
                prompt(WidgetLanguage.device.say("打开 Pinky 登录", "Open Pinky to sign in", "Abre Pinky para iniciar sesión"))
            case .unavailable:
                prompt(WidgetLanguage.device.say("暂时无法刷新", "Couldn’t refresh", "No se pudo actualizar"))
            }
        }
        .containerBackground(for: .widget) {
            if !accessory { Color(uiColor: .secondarySystemGroupedBackground) }
        }
    }

    @ViewBuilder private func face(_ counts: WidgetCounts, cached: Bool) -> some View {
        let words = counts.language
        let big = counts.daysTogether ?? counts.streakDays
        let heroLabel = counts.daysTogether == nil ? words.say("连续天数", "days in a row", "días seguidos") : words.say("在一起的天数", "days together", "días juntos")
        let badge = words.say("连续 \(counts.streakDays) 天", "\(counts.streakDays)-day streak", "Racha de \(counts.streakDays) días")
        let fullLabel = "\(big) \(heroLabel)"
        switch family {
        case .accessoryInline:
            Label(fullLabel, systemImage: "heart.fill")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 2) {
                    Image(systemName: "heart.fill").font(.caption)
                    Text(big.formatted()).font(.headline.monospacedDigit()).minimumScaleFactor(0.55).lineLimit(1)
                }
                .padding(4)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(fullLabel)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label(fullLabel, systemImage: "heart.fill").font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                if counts.daysTogether != nil { Text(badge).font(.caption).lineLimit(1).minimumScaleFactor(0.7) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 3) {
                Label("Pinky", systemImage: "heart.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color(red: 0.78, green: 0.22, blue: 0.39))
                Text(big.formatted())
                    .font(.system(size: family == .systemMedium ? 48 : 38, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                Text(heroLabel).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if counts.daysTogether != nil { Text(badge).font(.caption2.weight(.semibold)).lineLimit(1) }
                if cached {
                    Text(words.say("上次更新", "Last update", "Última actualización"))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder private func prompt(_ text: String) -> some View {
        switch family {
        case .accessoryInline:
            Label("Pinky", systemImage: "heart")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "heart").font(.title3)
            }
            .accessibilityLabel(text)
        default:
            VStack(alignment: .leading, spacing: 4) {
                Label("Pinky", systemImage: "heart").font(.headline)
                Text(text).font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@main
struct PinkyNativeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PinkyNativeWidget", provider: PinkyWidgetProvider()) {
            PinkyWidgetFace(entry: $0)
        }
        .configurationDisplayName("Pinky")
        .description(WidgetLanguage.device.say("看在一起的天数与连续天数。", "See days together and your shared streak.", "Mira sus días juntos y su racha."))
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}
