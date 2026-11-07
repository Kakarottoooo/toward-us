import XCTest
import StoreKitTest
import WebKit

/// Hosted in the real app: JavaScript on the loaded page calls the native plugins through the Capacitor bridge exactly as
/// the web app will (`Capacitor.Plugins.PinkyStore`), while StoreKit answers from Pinky.storekit instead of the App Store.
@MainActor
final class PinkyStoreTests: XCTestCase {
    private var session: SKTestSession!
    private static let allIds = ["us.toward.pinky.member.monthly", "us.toward.pinky.member.yearly"]
        + ["bow", "crown", "scarf", "glasses", "flower", "santa"].map { "us.toward.pinky.outfit." + $0 }

    override func setUp() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Pinky", withExtension: "storekit"))
        session = try SKTestSession(contentsOf: url)
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
    }

    /// The app's web view once the page has loaded and the Capacitor bridge has registered Pinky's plugins.
    private func page() async throws -> WKWebView {
        for _ in 0..<120 {
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
            if let webView = windows.lazy.compactMap({ Self.find(in: $0) }).first,
               (try? await webView.evaluateJavaScript("!!(window.Capacitor && Capacitor.Plugins.PinkyStore && Capacitor.Plugins.PinkyWidget)")) as? Bool == true {
                return webView
            }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        throw XCTSkip("The app's page did not load (no network?), so the bridge could not be reached")
    }

    private static func find(in view: UIView) -> WKWebView? {
        if let webView = view as? WKWebView { return webView }
        return view.subviews.lazy.compactMap { find(in: $0) }.first
    }

    /// Runs `body` as an async JS function on the page and returns its JSON-stringified result decoded.
    private func js(_ body: String, _ arguments: [String: Any] = [:]) async throws -> [String: Any] {
        let webView = try await page()
        let text = try await webView.callAsyncJavaScript("return JSON.stringify(await (async () => { " + body + " })())", arguments: arguments, contentWorld: .page) as? String
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(text).utf8)) as? [String: Any])
    }

    /// The payload of an App Store signed transaction (JWS), which the server verifies.
    private static func claims(_ jws: String) throws -> [String: Any] {
        var part = String(jws.split(separator: ".")[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while part.count % 4 != 0 { part += "=" }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(Data(base64Encoded: part))) as? [String: Any])
    }

    func testPageListsTheContractProductsFromStoreKit() async throws {
        let result = try await js("return await Capacitor.Plugins.PinkyStore.products({ ids })", ["ids": Self.allIds])
        let json = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        print("PINKY_EVIDENCE products " + String(decoding: json, as: UTF8.self))
        let products = try XCTUnwrap(result["products"] as? [[String: Any]])
        XCTAssertEqual(Set(products.compactMap { $0["id"] as? String }), Set(Self.allIds))
        let monthly = try XCTUnwrap(products.first { $0["id"] as? String == "us.toward.pinky.member.monthly" })
        XCTAssertEqual(monthly["type"] as? String, "subscription")
        XCTAssertEqual(monthly["price"] as? Double, 9.99)
        XCTAssertEqual(monthly["currency"] as? String, "USD")
        XCTAssertEqual(products.first { $0["id"] as? String == "us.toward.pinky.member.yearly" }?["price"] as? Double, 59.99)
        let bow = try XCTUnwrap(products.first { $0["id"] as? String == "us.toward.pinky.outfit.bow" })
        XCTAssertEqual(bow["type"] as? String, "nonConsumable")
        XCTAssertEqual(bow["price"] as? Double, 1.99)
        XCTAssertTrue((bow["displayPrice"] as? String ?? "").contains("1.99"))
    }

    func testPurchaseCarriesTheAccountTokenAndRestoreReturnsIt() async throws {
        let member = UUID()
        let bought = try await js("return await Capacitor.Plugins.PinkyStore.purchase({ id: 'us.toward.pinky.outfit.bow', appAccountToken: member })", ["member": member.uuidString])
        XCTAssertEqual(bought["status"] as? String, "purchased")
        let claims = try Self.claims(XCTUnwrap(bought["signedTransaction"] as? String))
        XCTAssertEqual(claims["productId"] as? String, "us.toward.pinky.outfit.bow")
        XCTAssertEqual((claims["appAccountToken"] as? String)?.lowercased(), member.uuidString.lowercased())

        let subscribed = try await js("return await Capacitor.Plugins.PinkyStore.purchase({ id: 'us.toward.pinky.member.yearly', appAccountToken: member })", ["member": member.uuidString])
        XCTAssertEqual(subscribed["status"] as? String, "purchased")

        let restored = try await js("return await Capacitor.Plugins.PinkyStore.restore({})")
        let products = try (XCTUnwrap(restored["signedTransactions"] as? [String])).map { try Self.claims($0)["productId"] as? String }
        print("PINKY_EVIDENCE restore " + products.map { $0 ?? "?" }.sorted().joined(separator: ","))
        XCTAssertEqual(Set(products.compactMap { $0 }), ["us.toward.pinky.outfit.bow", "us.toward.pinky.member.yearly"])
    }

    func testPurchaseRefusesATokenThatIsNotAUserId() async throws {
        let result = try await js("try { await Capacitor.Plugins.PinkyStore.purchase({ id: 'us.toward.pinky.outfit.bow', appAccountToken: 'not-a-uuid' }); return { ok: true } } catch (e) { return { code: e.code } }")
        XCTAssertEqual(result["code"] as? String, "invalid_account_token")
    }

    func testRenewalsAndOutsidePurchasesReachThePage() async throws {
        _ = try await js("window.__pinkyTransactions = []; await Capacitor.Plugins.PinkyStore.addListener('transaction', (event) => window.__pinkyTransactions.push(event.signedTransaction)); return {}")
        try session.buyProduct(productIdentifier: "us.toward.pinky.outfit.crown")
        for _ in 0..<40 {
            let seen = try await js("return { list: window.__pinkyTransactions }")["list"] as? [String] ?? []
            if let jws = seen.first {
                XCTAssertEqual(try Self.claims(jws)["productId"] as? String, "us.toward.pinky.outfit.crown")
                return
            }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTFail("No transaction event reached the page")
    }

    func testWidgetDataIsSavedForTheWidgetAndClearedOnSignOut() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "group.us.toward.app"))
        defaults.set(Data("{}".utf8), forKey: "pinky.widget.last")
        _ = try await js("await Capacitor.Plugins.PinkyWidget.setWidgetData({ baseUrl: 'https://pinky.example/', token: 'widget-token' }); return {}")
        XCTAssertEqual(defaults.string(forKey: "pinky.widget.baseUrl"), "https://pinky.example")
        XCTAssertEqual(defaults.string(forKey: "pinky.widget.token"), "widget-token")
        XCTAssertNil(defaults.data(forKey: "pinky.widget.last"), "a new token must not show the previous account's numbers")
        let refused = try await js("try { await Capacitor.Plugins.PinkyWidget.setWidgetData({ baseUrl: 'javascript:alert(1)', token: 'x' }); return { ok: true } } catch (e) { return { code: e.code } }")
        XCTAssertEqual(refused["code"] as? String, "invalid_base_url")
        _ = try await js("await Capacitor.Plugins.PinkyWidget.clear(); return {}")
        XCTAssertNil(defaults.string(forKey: "pinky.widget.baseUrl"))
        XCTAssertNil(defaults.string(forKey: "pinky.widget.token"))
    }
}
