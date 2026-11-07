import XCTest
import SwiftUI
import WidgetKit

/// The widget's loader against a stubbed server, and pictures of every size and state (PinkyWidgetCore.swift is compiled
/// into this test bundle too). Pictures go to $PINKY_SNAPSHOT_DIR (pass TEST_RUNNER_PINKY_SNAPSHOT_DIR to xcodebuild).
@MainActor
final class PinkyWidgetTests: XCTestCase {
    final class StubServer: URLProtocol {
        static var reply: (status: Int, body: String) = (404, "")
        static var seen: URLRequest?
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            Self.seen = request
            let response = HTTPURLResponse(url: request.url!, statusCode: Self.reply.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(Self.reply.body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

    private let payload = #"{"v":1,"language":"zh","partnerName":"Mia","daysTogether":123,"streak":{"days":5,"me":true,"partner":false},"next":{"title":"生日","date":"2026-12-01","inDays":25},"updatedAt":"2026-11-06T08:00:00Z"}"#
    private var defaults: UserDefaults!
    private var session: URLSession!

    override func setUp() {
        defaults = UserDefaults(suiteName: "pinky.widget.tests")!
        defaults.removePersistentDomain(forName: "pinky.widget.tests")
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubServer.self]
        session = URLSession(configuration: config)
    }

    func testSignedOutWithoutAToken() async {
        guard case .signedOut = await WidgetLoader.load(defaults: defaults, session: session) else { return XCTFail("expected signed out") }
    }

    func testFetchesWithTheWidgetTokenAndFallsBackGracefully() async throws {
        defaults.set("https://pinky.example", forKey: WidgetStore.baseUrlKey)
        defaults.set("widget-token", forKey: WidgetStore.tokenKey)

        // Before the server ships /api/widget: a gentle prompt, not an error.
        StubServer.reply = (404, #"{"error":"Not found"}"#)
        guard case .unavailable = await WidgetLoader.load(defaults: defaults, session: session) else { return XCTFail("404 without data") }

        StubServer.reply = (200, payload)
        guard case .ready(let fresh) = await WidgetLoader.load(defaults: defaults, session: session) else { return XCTFail("200") }
        XCTAssertEqual(StubServer.seen?.url?.absoluteString, "https://pinky.example/api/widget")
        XCTAssertEqual(StubServer.seen?.value(forHTTPHeaderField: "Authorization"), "Bearer widget-token")
        XCTAssertEqual(fresh.daysTogether, 123)
        XCTAssertEqual(WidgetWords(payload: fresh).next, "生日 · 还有 25 天")
        XCTAssertEqual(WidgetWords(payload: fresh).today, "你 ✓  Mia ○")

        // A server hiccup keeps the last good numbers.
        StubServer.reply = (503, "")
        guard case .ready(let kept) = await WidgetLoader.load(defaults: defaults, session: session) else { return XCTFail("503 with data") }
        XCTAssertEqual(kept, fresh)

        // A revoked token: sign in again, and the old numbers are gone.
        StubServer.reply = (401, #"{"error":"Unauthorized"}"#)
        guard case .signedOut(let lang) = await WidgetLoader.load(defaults: defaults, session: session) else { return XCTFail("401") }
        XCTAssertEqual(lang, .zh)
        XCTAssertNil(defaults.data(forKey: WidgetStore.lastPayloadKey))
    }

    func testWordsInEveryLanguage() throws {
        var sample = try JSONDecoder().decode(WidgetPayload.self, from: Data(payload.utf8))
        sample.language = "en"; sample.next?.title = "Birthday"; sample.next?.inDays = 1
        XCTAssertEqual(WidgetWords(payload: sample).next, "Birthday · tomorrow")
        XCTAssertEqual(WidgetWords(payload: sample).streak, "🔥 5 days")
        sample.language = "es"; sample.next?.title = "Cumpleaños"; sample.next?.inDays = 25; sample.partnerName = nil
        XCTAssertEqual(WidgetWords(payload: sample).next, "Cumpleaños · en 25 días")
        XCTAssertEqual(WidgetWords(payload: sample).today, "Tú ✓  Pareja ○")
    }

    // MARK: - Pictures

    private static let sizes: [(WidgetFamily, CGSize, String)] = [
        (.systemSmall, CGSize(width: 170, height: 170), "small"), (.systemMedium, CGSize(width: 364, height: 170), "medium"),
        (.accessoryRectangular, CGSize(width: 172, height: 76), "rectangular"), (.accessoryCircular, CGSize(width: 76, height: 76), "circular"),
    ]

    /// One widget as the system draws it: ivory with the standard 16pt margins on the home screen, vibrant on the lock screen.
    @ViewBuilder private static func tile(_ content: WidgetContent, _ family: WidgetFamily, _ size: CGSize) -> some View {
        if family == .systemSmall || family == .systemMedium {
            PinkyWidgetContent(content: content, family: family).padding(16).frame(width: size.width, height: size.height)
                .background(PinkyPalette.ivory).clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous)).environment(\.colorScheme, .light)
        } else {
            PinkyWidgetContent(content: content, family: family).frame(width: size.width, height: size.height)
                .foregroundColor(.white).environment(\.colorScheme, .dark)
        }
    }

    func testRendersEverySizeAndState() throws {
        let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["PINKY_SNAPSHOT_DIR"] ?? NSTemporaryDirectory() + "pinky-widget-snapshots")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let zh = try JSONDecoder().decode(WidgetPayload.self, from: Data(payload.utf8))
        let en = WidgetPayload(v: 1, language: "en", partnerName: "Mia", daysTogether: 123, streak: .init(days: 5, me: true, partner: true), next: .init(title: "Birthday", date: nil, inDays: 25), updatedAt: nil)
        let es = WidgetPayload(v: 1, language: "es", partnerName: "Leo", daysTogether: nil, streak: .init(days: 12, me: false, partner: true), next: nil, updatedAt: nil)
        let states: [(WidgetContent, String)] = [(.ready(zh), "zh"), (.ready(en), "en"), (.ready(es), "es-no-anniversary"), (.signedOut(.zh), "signed-out-zh"), (.signedOut(.en), "signed-out-en"), (.unavailable(.es), "unavailable-es")]

        let sheet = VStack(alignment: .leading, spacing: 18) {
            ForEach(Array(states.enumerated()), id: \.offset) { _, state in
                VStack(alignment: .leading, spacing: 6) {
                    Text(state.1).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundColor(.white)
                    HStack(alignment: .center, spacing: 16) {
                        ForEach(Array(Self.sizes.enumerated()), id: \.offset) { _, size in Self.tile(state.0, size.0, size.1) }
                    }
                }
            }
        }.padding(24).background(Color(red: 0.16, green: 0.17, blue: 0.2))

        func write<V: View>(_ view: V, _ name: String) throws {
            let renderer = ImageRenderer(content: view)
            renderer.scale = 3
            let png = try XCTUnwrap(renderer.uiImage?.pngData(), name)
            try png.write(to: dir.appendingPathComponent(name + ".png"))
        }
        try write(sheet, "widget-sheet")
        for state in states { for size in Self.sizes { try write(Self.tile(state.0, size.0, size.1), "widget-\(size.2)-\(state.1)") } }
        print("PINKY_EVIDENCE widget snapshots in " + dir.path)
    }
}
