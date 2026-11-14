import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The shell loads the hosted web app so the existing HttpOnly session cookie keeps working unchanged.
// CLOUD_URL is Pinky's server in the cloud (fly.toml, Fly.io app "pinky-app"): the one place the App's server is set.
// TOWARD_US_APP_URL overrides it at sync time for dogfooding (a PC on the same Wi-Fi, a Tailscale name). A release build
// (--release, used for TestFlight and the App Store) may not point at a private or cleartext address.
export const CLOUD_URL = 'https://pinky-app.fly.dev';

/** Why `url` cannot be the server of a build that goes to TestFlight or the App Store, or '' when it can. */
export function releaseProblem(url) {
  if (url.protocol !== 'https:') return 'a release build must load an https:// URL';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return 'a release build cannot load a local address';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return 'a release build cannot load a bare IP address';
  // Tailscale names reach only devices signed in to the founder's tailnet: App Review and the public cannot open them.
  if (host.endsWith('.ts.net')) return 'a release build cannot load a Tailscale (*.ts.net) address; only the founder\'s devices reach it';
  return '';
}

/** The Capacitor config and the two bundled pages for a build that loads `raw`. Throws with a readable reason. */
export function shellFiles(raw, { release = false } = {}) {
  let url;
  try { url = new URL(raw || CLOUD_URL); } catch { throw new Error('TOWARD_US_APP_URL is not a valid URL: ' + raw); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('TOWARD_US_APP_URL must be http(s): ' + raw);
  const problem = release ? releaseProblem(url) : '';
  if (problem) throw new Error(problem + ': ' + url.origin);
  // Cleartext only for an explicit http:// dogfooding URL (e.g. a PC on the same Wi-Fi); never by default.
  const cleartext = url.protocol === 'http:';
  const config = {
    appId: 'us.toward.app',
    appName: 'Pinky',
    webDir: 'www',
    loggingBehavior: 'none',
    backgroundColor: '#f4efe6',
    // errorPath: when the server cannot be reached (no network, server down), show the bundled offline page instead of
    // a blank screen; it retries by itself and returns to the app once the server answers.
    server: { url: url.origin, errorPath: 'offline.html', ...(cleartext ? { cleartext: true } : {}) },
    ios: { contentInset: 'automatic', allowsLinkPreview: false },
    plugins: { CapacitorHttp: { enabled: false } },
  };
  return { url, cleartext, config, index: '<!doctype html><meta charset="utf-8"><title>Pinky</title><p>Loading ' + url.origin + '</p>\n', offline: offlinePage(url.origin) };
}

/** The page shown when Pinky's server cannot be reached: in the phone's language (zh / es / en), with a retry button,
 * and an automatic return as soon as the server answers again. Self-contained: no network needed to draw it. */
export function offlinePage(origin) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Pinky</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; height: 100%; background: #f4efe6; color: #2b2622; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { min-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: max(24px, env(safe-area-inset-top)) 28px max(24px, env(safe-area-inset-bottom)); text-align: center; }
  .mark { font-weight: 800; letter-spacing: 0.32em; font-size: 15px; color: #c2453d; }
  h1 { font-size: 24px; line-height: 1.3; margin: 8px 0 0; }
  p { font-size: 17px; line-height: 1.5; margin: 0; color: #5b524b; max-width: 320px; }
  button { margin-top: 12px; min-height: 48px; min-width: 160px; border: 0; border-radius: 24px; background: #c2453d; color: #fff; font-size: 17px; font-weight: 600; padding: 0 28px; }
  button:disabled { opacity: 0.6; }
  small { font-size: 14px; color: #7a7068; min-height: 20px; }
</style></head>
<body><main data-testid="offline-page">
  <div class="mark">PINKY</div>
  <h1 id="title"></h1><p id="body"></p>
  <button id="retry" type="button"></button>
  <small id="status" role="status"></small>
</main>
<script>
  var SERVER = ${JSON.stringify(origin)};
  var COPY = {
    zh: { title: "暂时连不上 Pinky", body: "请检查网络。连上之后会自动回来，你的内容都还在。", retry: "重试", trying: "正在重新连接…", still: "还是连不上，稍后会自动再试。" },
    es: { title: "No podemos conectar con Pinky", body: "Revisa tu conexión. Volverás solo en cuanto haya red; todo lo tuyo sigue ahí.", retry: "Reintentar", trying: "Reconectando…", still: "Sigue sin conexión; lo intentaremos de nuevo." },
    en: { title: "Can't reach Pinky right now", body: "Check your connection. You'll be back automatically once you're online; everything you saved is still there.", retry: "Try again", trying: "Reconnecting…", still: "Still offline. We'll keep trying." }
  };
  var tag = ((navigator.languages && navigator.languages[0]) || navigator.language || "en").toLowerCase();
  var lang = tag.indexOf("zh") === 0 ? "zh" : tag.indexOf("es") === 0 ? "es" : "en";
  var text = COPY[lang];
  document.documentElement.lang = lang === "zh" ? "zh-Hans" : lang;
  document.getElementById("title").textContent = text.title;
  document.getElementById("body").textContent = text.body;
  var button = document.getElementById("retry"), status = document.getElementById("status");
  button.textContent = text.retry;
  var busy = false;
  // An opaque no-cors request settles only when the server is reachable; a network failure rejects.
  function retry(manual) {
    if (busy) return; busy = true; button.disabled = true; if (manual) status.textContent = text.trying;
    var done = false, timer = setTimeout(function () { if (!done) { done = true; fail(); } }, 8000);
    fetch(SERVER + "/api/health", { mode: "no-cors", cache: "no-store" }).then(function () {
      if (done) return; done = true; clearTimeout(timer); location.replace(SERVER + "/");
    }, function () { if (done) return; done = true; clearTimeout(timer); fail(); });
    function fail() { busy = false; button.disabled = false; if (manual) status.textContent = text.still; }
  }
  button.addEventListener("click", function () { retry(true); });
  window.addEventListener("online", function () { retry(false); });
  setInterval(function () { retry(false); }, 10000);
  retry(false);
</script>
</body></html>
`;
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const release = process.argv.includes('--release') || process.env.PINKY_RELEASE === '1';
  let files;
  try { files = shellFiles((process.env.TOWARD_US_APP_URL || '').trim(), { release }); }
  catch (error) { console.error(error.message); process.exit(2); }
  await writeFile(new URL('../capacitor.config.json', import.meta.url), JSON.stringify(files.config, null, 2) + '\n');
  // cap sync requires webDir to exist; the remote server.url replaces index.html at runtime, offline.html stays bundled.
  const www = new URL('../www/', import.meta.url);
  await mkdir(www, { recursive: true });
  await writeFile(new URL('index.html', www), files.index);
  await writeFile(new URL('offline.html', www), files.offline);
  console.log('capacitor.config.json -> server.url ' + files.url.origin + (files.cleartext ? ' (cleartext allowed for http dogfooding)' : '') + (release ? ' [release]' : '') + ' at ' + fileURLToPath(new URL('../capacitor.config.json', import.meta.url)));
}
