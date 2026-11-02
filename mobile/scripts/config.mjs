import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The shell loads the hosted web app so the existing HttpOnly session cookie keeps working unchanged.
// TOWARD_US_APP_URL is read at sync time; the default must be confirmed as the real production domain.
const DEFAULT_URL = 'https://toward-us.onrender.com';
const raw = (process.env.TOWARD_US_APP_URL || DEFAULT_URL).trim();
let url;
try { url = new URL(raw); } catch { console.error('TOWARD_US_APP_URL is not a valid URL: ' + raw); process.exit(2); }
if (url.protocol !== 'https:' && url.protocol !== 'http:') { console.error('TOWARD_US_APP_URL must be http(s): ' + raw); process.exit(2); }
// Cleartext only for an explicit http:// dogfooding URL (e.g. a PC on the same Wi-Fi); never by default.
const cleartext = url.protocol === 'http:';
const config = {
  appId: 'us.toward.app',
  appName: 'Toward Us',
  webDir: 'www',
  loggingBehavior: 'none',
  backgroundColor: '#f4efe6',
  server: { url: url.origin, ...(cleartext ? { cleartext: true } : {}) },
  ios: { contentInset: 'automatic', allowsLinkPreview: false },
  plugins: { CapacitorHttp: { enabled: false } },
};
await writeFile(new URL('../capacitor.config.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
// cap sync requires webDir to exist; the remote server.url replaces it at runtime.
const www = new URL('../www/', import.meta.url);
await mkdir(www, { recursive: true });
await writeFile(new URL('index.html', www), '<!doctype html><meta charset="utf-8"><title>Toward Us</title><p>Loading ' + url.origin + '</p>\n');
console.log('capacitor.config.json -> server.url ' + url.origin + (cleartext ? ' (cleartext allowed for http dogfooding)' : '') + ' at ' + fileURLToPath(new URL('../capacitor.config.json', import.meta.url)));
