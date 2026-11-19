import CryptoKit
import Foundation
import MetricKit
import UIKit
import WebKit

/// The bundled Capacitor configuration is the sole destination for first-party telemetry.
enum PinkyOrigin {
    static let url: URL? = {
        guard let file = Bundle.main.url(forResource: "capacitor.config", withExtension: "json"),
              let data = try? Data(contentsOf: file),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = config["server"] as? [String: Any],
              let raw = server["url"] as? String, let url = URL(string: raw),
              ["http", "https"].contains(url.scheme), url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }()
    static func matches(_ other: URL?) -> Bool {
        guard let expected = url, let other else { return false }
        return expected.scheme == other.scheme && expected.host == other.host && expected.port == other.port
    }
}

private final class MetricsTransport: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
final class PinkyTelemetry: NSObject, MXMetricManagerSubscriber {
    static let shared = PinkyTelemetry()

    private struct Pending: Codable {
        let id: UUID
        let endpoint: String
        let body: Data
        let at: Date
        let session: UUID?
        let heartbeat: Bool
        var cookieDigest: String?
    }

    private var queue: [Pending] = []
    private let queueFile: URL
    private let installID: String
    private var foregroundSession: UUID?
    private var heartbeatTimer: Timer?
    private var sending = false
    private var backgroundTime = UIBackgroundTaskIdentifier.invalid
    private let clock = ISO8601DateFormatter()
    private let transport = MetricsTransport()
    private lazy var network: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 12
        return URLSession(configuration: config, delegate: transport, delegateQueue: nil)
    }()

    private override init() {
        let storage = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PinkyUsage", isDirectory: true)
        try? FileManager.default.createDirectory(at: storage, withIntermediateDirectories: true)
        var folder = storage
        var attributes = URLResourceValues()
        attributes.isExcludedFromBackup = true
        try? folder.setResourceValues(attributes)
        queueFile = storage.appendingPathComponent("pending.json")
        // This identifier represents this installation only. It never links two devices.
        let identityFile = storage.appendingPathComponent("installation")
        if let data = try? Data(contentsOf: identityFile), let str = String(data: data, encoding: .utf8), UUID(uuidString: str) != nil {
            installID = str
        } else {
            installID = UUID().uuidString
            try? Data(installID.utf8).write(to: identityFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        if let data = try? Data(contentsOf: queueFile), let saved = try? JSONDecoder().decode([Pending].self, from: data) {
            queue = saved.filter { $0.at.timeIntervalSinceNow > -30 * 86400 }
        }
        super.init()
        clock.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func opened() {
        MXMetricManager.shared.add(self)
        lifecycle("open", session: UUID())
    }

    func foreground() {
        guard foregroundSession == nil else { return }
        let id = UUID()
        foregroundSession = id
        lifecycle("foreground", session: id)
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
            Task { @MainActor in
                guard self.foregroundSession == id else { return }
                self.lifecycle("heartbeat", session: id)
            }
        }
    }

    func background() {
        guard let id = foregroundSession else { return }
        foregroundSession = nil
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        if backgroundTime == .invalid {
            backgroundTime = UIApplication.shared.beginBackgroundTask(withName: "Save Pinky session") { self.finishBackgroundTime() }
        }
        lifecycle("background", session: id)
    }

    private func finishBackgroundTime() {
        guard backgroundTime != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTime)
        backgroundTime = .invalid
    }

    private func lifecycle(_ kind: String, session: UUID) {
        let id = UUID(), now = Date()
        let body = ["event_id": id.uuidString, "install_id": installID, "session_id": session.uuidString,
                    "kind": kind, "at": clock.string(from: now)]
        guard let data = try? JSONEncoder().encode(body) else { return }
        let event = Pending(id: id, endpoint: "lifecycle", body: data, at: now,
                            session: session, heartbeat: kind == "heartbeat", cookieDigest: nil)
        // Persist the event before WebKit returns the cookie. A sudden suspension loses at most the attribution.
        append(event)
        Task {
            let cookie = await sessionCookie()
            if let index = queue.firstIndex(where: { $0.id == id }) {
                queue[index].cookieDigest = Self.digest(cookie)
                persist()
            }
            await flush()
        }
    }

    private func sessionCookie() async -> HTTPCookie? {
        guard let url = PinkyOrigin.url, let host = url.host else { return nil }
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return cookies.first { $0.name == "toward_us_session" && $0.domain == host && $0.path == "/"
            && (!$0.isSecure || url.scheme == "https") && ($0.expiresDate.map { $0 > Date() } ?? true) }
    }

    private static func digest(_ cookie: HTTPCookie?) -> String? {
        cookie.map { SHA256.hash(data: Data($0.value.utf8)).map { String(format: "%02x", $0) }.joined() }
    }

    private func append(_ event: Pending) {
        guard !queue.contains(where: { $0.id == event.id }) else { return }
        if event.heartbeat {
            queue.removeAll { $0.heartbeat && $0.session == event.session }
        }
        if queue.count >= 2048 { queue.removeFirst(queue.count - 2047) }
        queue.append(event)
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(queue) else { return }
        try? data.write(to: queueFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func flush() async {
        guard !sending, let origin = PinkyOrigin.url else { return }
        sending = true
        defer { sending = false; finishBackgroundTime() }
        while let event = queue.first {
            var request = URLRequest(url: origin.appendingPathComponent("api/app-metrics/" + event.endpoint))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = event.body
            if event.endpoint == "lifecycle", let expected = event.cookieDigest,
               let cookie = await sessionCookie(), Self.digest(cookie) == expected {
                request.setValue(HTTPCookie.requestHeaderFields(with: [cookie])["Cookie"], forHTTPHeaderField: "Cookie")
            }
            guard let (_, response) = try? await network.data(for: request),
                  let status = (response as? HTTPURLResponse)?.statusCode else { return }
            guard status == 204 || status == 400 || status == 413 else { return }
            queue.removeAll { $0.id == event.id }
            persist()
        }
    }

    nonisolated func didReceive(_ payloads: [MXDiagnosticPayload]) {
        Task { @MainActor in
            for payload in payloads { self.recordCrashes(payload) }
            await self.flush()
        }
    }

    private func recordCrashes(_ payload: MXDiagnosticPayload) {
        let crashes = payload.crashDiagnostics ?? []
        let builds = Dictionary(grouping: crashes) { $0.metaData.applicationBuildVersion }
        for (build, diagnostics) in builds {
            var counts: [String: (Int, MXCrashDiagnostic)] = [:]
            for item in diagnostics {
                let key = [item.signal, item.exceptionType, item.exceptionCode].map { $0?.stringValue ?? "_" }.joined(separator: "/")
                counts[key] = ((counts[key]?.0 ?? 0) + 1, item)
            }
            let groups = counts.sorted { $0.key < $1.key }
            for start in stride(from: 0, to: groups.count, by: 16) {
                let slice = groups[start..<min(start + 16, groups.count)]
                let fields: [[String: Any]] = slice.map { _, value in
                    let (count, item) = value
                    var row: [String: Any] = ["count": count]
                    if let code = item.exceptionCode { row["exception_code"] = code.stringValue }
                    if let type = item.exceptionType { row["exception_type"] = type.int32Value }
                    if let signal = item.signal { row["signal"] = signal.int32Value }
                    return row
                }
                // Redelivery of the same MetricKit summary produces the same event, without transmitting stack traces.
                let at = clock.string(from: payload.timeStampEnd)
                let key = [installID, build, at, clock.string(from: payload.timeStampBegin), String(start)]
                    + slice.map { $0.key + "=" + String($0.value.0) }
                let bytes = Array(SHA256.hash(data: Data(key.joined(separator: "|").utf8)))
                var uid: uuid_t = (0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)
                withUnsafeMutableBytes(of: &uid) { $0.copyBytes(from: bytes.prefix(16)) }
                uid.6 = (uid.6 & 0x0f) | 0x40
                uid.8 = (uid.8 & 0x3f) | 0x80
                let id = UUID(uuid: uid)
                let body: [String: Any] = ["event_id": id.uuidString, "build": build, "at": at, "crashes": fields]
                if let data = try? JSONSerialization.data(withJSONObject: body) {
                    append(Pending(id: id, endpoint: "diagnostics", body: data, at: payload.timeStampEnd,
                                   session: nil, heartbeat: false, cookieDigest: nil))
                }
            }
        }
    }
}
