import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { LEGAL_PAGES, renderLegalPage } from "../../server/legal.mjs";

// Static hosting publishes this directory only. No accounts, secrets or media are needed.
const output = resolve(process.argv[2] || "dist-ourever-public");
const appUrl = "https://toward-us-private-beta.onrender.com/";
const copy = {
  en: { summary: "A private place to think through a relationship, find the words, and make plans together.", open: "Open Ourever", privacy: "Privacy policy", terms: "Terms of use", support: "Help and support" },
  zh: { summary: "理清恋爱里的想法，找到合适的话，也可以和伴侣一起商量计划。", open: "打开 Ourever", privacy: "隐私政策", terms: "使用条款", support: "帮助与支持" },
  es: { summary: "Un lugar privado para reflexionar sobre tu relación, encontrar las palabras y hacer planes en pareja.", open: "Abrir Ourever", privacy: "Política de privacidad", terms: "Condiciones de uso", support: "Ayuda y soporte" },
};
const langTag = { en: "en-US", zh: "zh-Hans", es: "es" };
const prefix = (lang) => lang === "en" ? "/" : `/${lang}/`;

// Support the existing ?lang= links on a host that serves static files.
const selectLanguage = `<script>
const selected = new URLSearchParams(location.search).get("lang");
if (["en", "es", "zh"].includes(selected)) {
  const target = new URL(location.href);
  const page = target.pathname.replace(/^\\/(zh|es)(?=\\/|$)/, "").replace(/^\\/+/, "");
  target.pathname = (selected === "en" ? "/" : "/" + selected + "/") + page;
  target.searchParams.delete("lang");
  location.replace(target.href);
}
</script>`;

async function savePage(directory, html) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), html.replace("</head>", selectLanguage + "</head>"));
}

for (const [lang, t] of Object.entries(copy)) {
  const directory = lang === "en" ? output : join(output, lang);
  const languages = Object.keys(copy).map((other) => other === lang ? `<strong>${lang.toUpperCase()}</strong>` : `<a lang="${langTag[other]}" href="${prefix(other)}">${other.toUpperCase()}</a>`).join(" / ");
  const legalLinks = LEGAL_PAGES.map(page => `<a href="${prefix(lang)}${page}">${t[page]}</a>`).join(" · ");
  await savePage(directory, `<!doctype html><html lang="${langTag[lang]}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Ourever</title>
<style>body{margin:0;background:#f4efe6;color:#2b2622;font:18px/1.6 system-ui,sans-serif}main{max-width:38rem;margin:auto;padding:clamp(2rem,8vw,6rem) 1.5rem}nav,footer{font-size:1rem}h1{font:600 clamp(3.6rem,12vw,6rem)/1.1 Georgia,serif;margin:3rem 0 1rem}p{max-width:32rem}a{color:#863619}#open{display:inline-block;background:#2b2622;color:#fff;border-radius:.5rem;padding:.65rem 1rem;text-decoration:none}footer{margin-top:4rem}</style></head>
<body><main><nav aria-label="Language">${languages}</nav><h1>Ourever</h1><p>${t.summary}</p><p><a id="open" href="${appUrl}">${t.open}</a></p><footer>${legalLinks}<p>© 2026 Witnora, Inc.</p></footer></main>
<script>
// Preserve a partner invitation when the recipient opens the app or switches languages.
const invite = new URLSearchParams(location.search).get("invite");
if (invite && /^[A-Z0-9]{8}$/i.test(invite)) {
  for (const link of document.querySelectorAll("#open, nav a")) {
    const target = new URL(link.href);
    target.searchParams.set("invite", invite);
    link.href = target.href;
  }
}
</script></body></html>`);
  for (const page of LEGAL_PAGES) {
    await savePage(join(directory, page), renderLegalPage(page, lang, process.env, true));
  }
}
