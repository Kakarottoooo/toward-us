import { useEffect, useState } from "react";
import { Check, Crown, TShirt } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { storePlugin, type Membership } from "../membership/MembershipPage";
import { OUTFIT_IDS, OutfitArt, outfitName, type OutfitId } from "./Outfit";

// 装扮 in the little one's room (founder 11-06, "按对会员+装扮"): members wear any of them; anyone can buy one for $1.99
// (Apple in the iPhone app, Stripe on the web). Dressing it changes it for both of you.
export function Wardrobe({ language, userId, onWear, onMembership }: { language: Language; userId: string; onWear: (outfit: OutfitId | null) => void; onMembership: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [data, setData] = useState<Membership | null>(null);
  const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const store = storePlugin();
  useEffect(() => { void relationshipApi<Membership>("/api/membership").then(setData).catch(() => {}); }, []);
  useEffect(() => { if (!store) return; void store.products({ ids: OUTFIT_IDS.map((id) => `us.toward.pinky.outfit.${id}`) }).then(({ products }) => setPrices(Object.fromEntries(products.map((item) => [item.id, item.displayPrice])))).catch(() => {}); }, []);
  if (!data) return null;
  const owned = new Set(data.outfits.owned), worn = data.outfits.equipped;
  const wear = async (id: OutfitId | null) => {
    setBusy(id || "off"); setNotice("");
    try { const next = await relationshipApi<Membership>("/api/membership/outfit", jsonBody({ outfit: id })); setData(next); onWear(next.outfits.equipped as OutfitId | null); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(""); }
  };
  const buy = async (id: OutfitId) => {
    setBusy(id); setNotice("");
    try {
      if (store) {
        const result = await store.purchase({ id: `us.toward.pinky.outfit.${id}`, appAccountToken: userId });
        if (result.status === "purchased" && result.signedTransaction) { setData(await relationshipApi<Membership>("/api/membership/apple/verify", jsonBody({ signedTransaction: result.signedTransaction }))); await wear(id); }
      } else if (data.providers.stripe) {
        const { url } = await relationshipApi<{ url: string }>("/api/membership/stripe/checkout", jsonBody({ product: `outfit:${id}`, language })); location.assign(url); return;
      } else setNotice(t("付款功能还在准备，很快就能开通。", "Payment is almost ready; it opens soon.", "El pago está casi listo; abrirá pronto."));
    } catch (error) { setNotice((error as Error).message); }
    setBusy("");
  };
  const price = (id: OutfitId) => prices[`us.toward.pinky.outfit.${id}`] || `$${(data.prices.outfit.usd / 100).toFixed(2)}`;
  return <section className="pet-how wardrobe" data-testid="wardrobe">
    <h3><TShirt size={15} weight="fill" />{t("装扮", "Outfits", "Atuendos")}</h3>
    <p className="wardrobe-note">{t("给它穿上，你们俩看到的都会变。", "Dress it up; you both see the change.", "Vístelo; los dos ven el cambio.")}</p>
    <div className="wardrobe-grid">{OUTFIT_IDS.map((id) => {
      const mine = owned.has(id), on = worn === id;
      return <button key={id} type="button" className={`wardrobe-item${on ? " is-on" : ""}${mine ? "" : " is-locked"}`} disabled={Boolean(busy)} onClick={() => void (mine ? wear(on ? null : id) : buy(id))} aria-pressed={mine ? on : undefined} data-testid={`wardrobe-${id}`}>
        <OutfitArt id={id} />
        <span className="wardrobe-name">{outfitName(id, language)}</span>
        <small>{on ? <><Check size={12} weight="bold" />{t("穿着", "Wearing", "Puesto")}</> : mine ? t("穿上", "Wear", "Poner") : price(id)}</small>
      </button>;
    })}</div>
    {data.plan !== "member" && <button type="button" className="wardrobe-member" onClick={onMembership} data-testid="wardrobe-membership"><Crown size={16} weight="fill" />{t("开通会员，全部装扮都能穿", "Members get every outfit", "Los miembros tienen todos los atuendos")}</button>}
    {notice && <p className="wardrobe-note" role="status">{notice}</p>}
  </section>;
}
