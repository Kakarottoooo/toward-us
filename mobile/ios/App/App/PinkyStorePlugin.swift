import Foundation
import UIKit
import Capacitor
import StoreKit

/// Apple in-app purchase for the couple's membership and outfits (StoreKit 2). The web page decides what to sell and the
/// server decides what a purchase unlocks: this plugin only lists products, buys one, and hands back Apple's signed
/// transactions (JWS) for the server to verify. Plan is per couple; the server links the purchase through appAccountToken.
@objc(PinkyStorePlugin)
public class PinkyStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PinkyStorePlugin"
    public let jsName = "PinkyStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
    ]

    /// Every product in the App Store Connect contract (and Pinky.storekit), used when the page asks without ids.
    static let productIds = ["us.toward.pinky.member.monthly", "us.toward.pinky.member.yearly"]
        + ["bow", "crown", "scarf", "glasses", "flower", "santa"].map { "us.toward.pinky.outfit." + $0 }

    private var updates: Task<Void, Never>?

    override public func load() {
        // Renewals, Ask to Buy approvals and purchases made on another device arrive here, also while the app was closed.
        // Kept until the page listens, so the server still hears about a renewal that lands before the page has loaded.
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let transaction) = result else { continue }
                self?.notifyListeners("transaction", data: ["signedTransaction": result.jwsRepresentation], retainUntilConsumed: true)
                await transaction.finish()
            }
        }
    }

    deinit { updates?.cancel() }

    @objc func products(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? Self.productIds
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve(["products": products.sorted { $0.id < $1.id }.map(Self.describe)])
            } catch {
                call.reject(error.localizedDescription, "products_failed", error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else { call.reject("Missing product id", "invalid_product"); return }
        var options: Set<Product.PurchaseOption> = []
        if let raw = call.getString("appAccountToken"), !raw.isEmpty {
            // Without the account token the server could not tell whose couple paid; never buy unlinked by mistake.
            guard let token = UUID(uuidString: raw) else { call.reject("appAccountToken must be a UUID", "invalid_account_token"); return }
            options.insert(.appAccountToken(token))
        }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else { call.reject("Product not found", "not_found"); return }
                let result: Product.PurchaseResult
                if #available(iOS 17.0, *), let scene = await MainActor.run(body: { self.bridge?.viewController?.view.window?.windowScene }) {
                    result = try await product.purchase(confirmIn: scene, options: options)
                } else {
                    result = try await product.purchase(options: options)
                }
                switch result {
                case .success(let verification):
                    guard case .verified(let transaction) = verification else { call.reject("Apple could not verify this purchase", "unverified"); return }
                    await transaction.finish()
                    call.resolve(["status": "purchased", "signedTransaction": verification.jwsRepresentation])
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                @unknown default:
                    call.resolve(["status": "cancelled"])
                }
            } catch {
                call.reject(error.localizedDescription, "purchase_failed", error)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        let sync = call.getBool("sync") ?? false
        Task {
            if sync {
                // Asks the member to sign in to the App Store, so only when they tapped "Restore purchases".
                do { try await AppStore.sync() } catch { call.reject(error.localizedDescription, "sync_failed", error); return }
            }
            var signed: [String] = []
            for await result in Transaction.currentEntitlements {
                if case .verified = result { signed.append(result.jwsRepresentation) }
            }
            call.resolve(["signedTransactions": signed])
        }
    }

    static func describe(_ product: Product) -> [String: Any] {
        let subscription = product.type == .autoRenewable || product.type == .nonRenewable
        return [
            "id": product.id,
            "displayName": product.displayName,
            "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).doubleValue,
            "currency": product.priceFormatStyle.currencyCode,
            "type": subscription ? "subscription" : "nonConsumable",
        ]
    }
}
