import { useEffect, useState } from "react";
import { Check, Crown, Sparkle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./membership.css";

// Pinky 会员 (founder 11-06): one member pays, both are members. In the iPhone app the purchase goes through Apple (the
// PinkyStore StoreKit plugin); on the web through Stripe Checkout. The server decides who is a member from verified payments.
export type Membership = { plan: "free" | "member"; until: string | null; source: string | null; paidBy: string | null; outfits: { owned: string[]; equipped: string | null }; providers: { stripe: boolean; apple: boolean }; prices: { monthly: { usd: number }; yearly: { usd: number }; outfit: { usd: number } } };
type StoreProduct = { id: string; displayPrice: string };
type StorePlugin = { products(args: { ids: string[] }): Promise<{ products: StoreProduct[] }>; purchase(args: { id: string; appAccountToken: string }): Promise<{ status: string; signedTransaction?: string }>; restore(args?: { sync?: boolean }): Promise<{ signedTransactions: string[] }>; addListener?(event: "transaction", callback: (data: { signedTransaction?: string }) => void): unknown };
// A beta invite link (/?beta=CODE) keeps its code here until the person is signed in and it is redeemed.
export const BETA_KEY = "pinky-beta-code";
export const readBetaCode = () => { try { return localStorage.getItem(BETA_KEY) || ""; } catch { return ""; } };
export const forgetBetaCode = () => { try { localStorage.removeItem(BETA_KEY); } catch { /* private mode */ } };
export const APPLE_IDS = { monthly: "us.toward.pinky.member.monthly", yearly: "us.toward.pinky.member.yearly" } as const;

/** The StoreKit bridge inside the iPhone app, or null in a browser. */
export function storePlugin(): StorePlugin | null {
  try { const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { PinkyStore?: StorePlugin } } }).Capacitor; return cap?.isNativePlatform?.() && cap.getPlatform?.() === "ios" ? cap.Plugins?.PinkyStore || null : null; } catch { return null; }
}
let renewalsBound = false;
/** Inside the iPhone app, hands every transaction StoreKit reports while the app runs (renewals, Ask to Buy approvals) to the
 * server, which verifies it; App Store Server Notifications cover the times the app is closed. A no-op in a browser. */
export function listenAppleTransactions() {
  try {
    const store = storePlugin(); if (!store?.addListener || renewalsBound) return; renewalsBound = true;
    void Promise.resolve(store.addListener("transaction", (data) => { if (data?.signedTransaction) void fetch("/api/membership/apple/verify", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: data.signedTransaction }) }).catch(() => {}); })).catch(() => {});
  } catch { /* never break the app over purchases */ }
}
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function MembershipPage({ language, userId, partnerName }: { language: Language; userId: string; partnerName: string | null }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [data, setData] = useState<Membership | null>(null);
  const [apple, setApple] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  const store = storePlugin();
  const keyboard = useKeyboard();
  const [code, setCode] = useState(readBetaCode);
  const redeem = async () => {
    keyboard.hide(); setBusy("redeem"); setNotice("");
    try { await relationshipApi("/api/membership/redeem", jsonBody({ code, language })); forgetBetaCode(); setCode(""); await load(); setNotice(t("内测码已用上，谢谢你们来试 Pinky！", "Beta code applied. Thanks for trying Pinky!", "Código aplicado. ¡Gracias por probar Pinky!")); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(""); }
  };
  const load = async () => { try { setData(await relationshipApi<Membership>("/api/membership")); } catch (error) { setNotice((error as Error).message); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!store) return; void store.products({ ids: Object.values(APPLE_IDS) }).then(({ products }) => setApple(Object.fromEntries(products.map((item) => [item.id, item.displayPrice])))).catch(() => {}); }, []);
  useEffect(() => { if (new URLSearchParams(location.search).get("paid") === "1") { setNotice(t("付款成功，正在开通，可能要等几秒。", "Payment received. Turning it on; this can take a few seconds.", "Pago recibido. Activándolo; puede tardar unos segundos.")); const timer = window.setTimeout(() => void load(), 4000); return () => window.clearTimeout(timer); } }, []);

  const buy = async (plan: "monthly" | "yearly") => {
    setBusy(plan); setNotice("");
    try {
      if (store) {
        const result = await store.purchase({ id: APPLE_IDS[plan], appAccountToken: userId });
        if (result.status === "purchased" && result.signedTransaction) setData(await relationshipApi<Membership>("/api/membership/apple/verify", jsonBody({ signedTransaction: result.signedTransaction })));
        else if (result.status === "pending") setNotice(t("等待批准，批准后会自动开通。", "Waiting for approval; it turns on once approved.", "Esperando aprobación; se activa al aprobarse."));
      } else {
        const { url } = await relationshipApi<{ url: string }>("/api/membership/stripe/checkout", jsonBody({ product: plan, language }));
        location.assign(url); return;
      }
    } catch (error) { setNotice((error as Error).message); }
    setBusy("");
  };
  const restore = async () => {
    if (!store) return; setBusy("restore"); setNotice("");
    try { const { signedTransactions } = await store.restore({ sync: true }); setData(await relationshipApi<Membership>("/api/membership/apple/restore", jsonBody({ signedTransactions }))); }
    catch (error) { setNotice((error as Error).message); }
    setBusy("");
  };
  const manage = async () => {
    setBusy("manage"); setNotice("");
    try { const { url } = await relationshipApi<{ url: string }>("/api/membership/stripe/portal", jsonBody({})); location.assign(url); return; } catch (error) { setNotice((error as Error).message); }
    setBusy("");
  };

  if (!data) return <p className="membership-loading">{notice || t("正在读取…", "Loading…", "Cargando…")}</p>;
  const member = data.plan === "member", mine = data.paidBy === userId;
  const until = data.until ? new Date(data.until).toLocaleDateString(language === "zh" ? "zh-CN" : language, { year: "numeric", month: "short", day: "numeric" }) : "";
  const price = (plan: "monthly" | "yearly") => apple[APPLE_IDS[plan]] || dollars(data.prices[plan].usd);
  const canPay = Boolean(store) || data.providers.stripe;
  const perks = [
    t("每天和 Pinky 聊得更多、打电话更久", "More with Pinky every day, and longer calls", "Más con Pinky cada día y llamadas más largas"),
    t("导入更多聊天记录，让 Pinky 看懂你们", "Import more chat history for Pinky to understand you", "Importa más historial para que Pinky los entienda"),
    t("小家伙的全部装扮", "Every outfit for your little one", "Todos los atuendos para su pequeño"),
    t(partnerName ? `一个人开通，你和 ${partnerName} 都能用` : "一个人开通，两个人都能用", partnerName ? `One of you pays; you and ${partnerName} both get it` : "One of you pays; you both get it", partnerName ? `Uno paga; tú y ${partnerName} lo tienen` : "Uno paga; los dos lo tienen"),
  ];
  return <div className="membership" data-testid="membership-page">
    <section className={`membership-hero ${member ? "is-member" : ""}`}>
      <span className="membership-crown" aria-hidden="true"><Crown size={26} weight="fill" /></span>
      <h2>{member ? t("你们是 Pinky 会员", "You're Pinky members", "Son miembros de Pinky") : t("Pinky 会员", "Pinky membership", "Membresía Pinky")}</h2>
      <p>{member
        ? data.source === "beta" ? t(`内测送的会员，到 ${until}。`, `A beta gift, until ${until}.`, `Regalo de la beta, hasta ${until}.`)
          : mine ? t(`由你开通，下次续费 ${until}。`, `You pay for it; it renews ${until}.`, `Lo pagas tú; se renueva el ${until}.`)
            : t(`由 ${partnerName || "TA"} 开通，到 ${until}。`, `${partnerName || "Your partner"} pays for it; until ${until}.`, `Lo paga ${partnerName || "tu pareja"}; hasta ${until}.`)
        : t("现在是免费版，所有功能都能用，只是每天 AI 次数少一些。", "You're on the free plan: every feature works, with less AI each day.", "Estás en el plan gratis: todo funciona, con menos IA cada día.")}</p>
    </section>
    <ul className="membership-perks">{perks.map((perk) => <li key={perk}><Check size={16} weight="bold" />{perk}</li>)}</ul>
    {!member && <div className="membership-plans">
      <button type="button" className="membership-plan featured" disabled={!canPay || Boolean(busy)} onClick={() => void buy("yearly")} data-testid="buy-yearly"><span className="membership-badge"><Sparkle size={12} weight="fill" />{t("省一半", "Save 50%", "Ahorra 50%")}</span><strong>{t("按年", "Yearly", "Anual")}</strong><span>{price("yearly")}{t(" / 年", " / year", " / año")}</span></button>
      <button type="button" className="membership-plan" disabled={!canPay || Boolean(busy)} onClick={() => void buy("monthly")} data-testid="buy-monthly"><strong>{t("按月", "Monthly", "Mensual")}</strong><span>{price("monthly")}{t(" / 月", " / month", " / mes")}</span></button>
    </div>}
    {!member && <form className="membership-code" onSubmit={(event) => { event.preventDefault(); if (code.trim()) void redeem(); }}><KeyboardInput value={code} maxLength={20} placeholder={t("有内测码？填在这里", "Have a beta code?", "¿Tienes un código de beta?")} onChange={(event) => setCode(event.target.value.toUpperCase())} onBlur={() => keyboard.hide()} aria-label={t("内测码", "Beta code", "Código de beta")} data-testid="beta-code" /><button type="submit" disabled={!code.trim() || Boolean(busy)}>{t("使用", "Apply", "Usar")}</button></form>}
    {!member && !canPay && <p className="membership-note">{t("付款功能还在准备，很快就能开通。", "Payment is almost ready; it opens soon.", "El pago está casi listo; abrirá pronto.")}</p>}
    {member && mine && data.source === "stripe" && <button type="button" className="membership-link" disabled={Boolean(busy)} onClick={() => void manage()}>{t("管理或取消订阅", "Manage or cancel", "Gestionar o cancelar")}</button>}
    {member && mine && data.source === "apple" && <p className="membership-note">{t("在 iPhone 的“设置 → 你的名字 → 订阅”里可以管理或取消。", "Manage or cancel in iPhone Settings → your name → Subscriptions.", "Gestiona o cancela en Ajustes del iPhone → tu nombre → Suscripciones.")}</p>}
    {store && <button type="button" className="membership-link" disabled={Boolean(busy)} onClick={() => void restore()}>{t("恢复购买", "Restore purchases", "Restaurar compras")}</button>}
    {notice && <p className="membership-notice" role="status">{notice}</p>}
    <p className="membership-fine">{t("订阅会自动续费，可以随时取消，取消后用到这一期结束。", "Subscriptions renew automatically; cancel anytime and keep it to the end of the period.", "La suscripción se renueva sola; cancela cuando quieras y la mantienes hasta el final del periodo.")}</p>
  </div>;
}
