// Opening speed limit: the JavaScript the browser must download before Ourever can draw its first screen stays under
// LIMIT before compression. That is index.html's entry script plus every chunk it imports statically; screens and games
// loaded on demand do not count. Fails the build when the limit is passed, so the opening bundle cannot quietly regrow.
// If you hit it, load the new code on demand (see lazyScreen in src/lazyScreen.tsx) instead of raising the limit.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const OUT = fileURLToPath(new URL("../dist/client/", import.meta.url));
const LIMIT = 530 * 1024;
const html = readFileSync(join(OUT, "index.html"), "utf8");
const seen = new Set();
const visit = (name) => {
  if (seen.has(name)) return;
  seen.add(name);
  const code = readFileSync(join(OUT, "assets", name), "utf8");
  for (const m of code.matchAll(/(?:^|[;\n}])\s*import\s*(?:[^"'()]*?from\s*)?["']\.\/([\w.\-]+\.js)["']/g)) visit(m[1]);
};
for (const m of html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\/assets\/([\w.\-]+\.js)"/g)) visit(m[1]);
// The first screen's styles arrive as one stylesheet, in source order. A chunking change that splits it into several
// files also reorders the cascade, which changes how screens look.
const sheets = [...html.matchAll(/<link[^>]*rel="stylesheet"/g)].length;
if (sheets !== 1) { console.error(`budget: index.html links ${sheets} stylesheets, expected 1 (the cascade order would change)`); process.exit(1); }
if (seen.size === 0) { console.error("budget: no entry script found in dist/client/index.html"); process.exit(1); }
let total = 0;
let gzip = 0;
for (const name of seen) {
  const bytes = readFileSync(join(OUT, "assets", name));
  total += statSync(join(OUT, "assets", name)).size;
  gzip += gzipSync(bytes).length;
  console.log(`  ${name.padEnd(40)} ${(bytes.length / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`opening JavaScript: ${(total / 1024).toFixed(1)} KB (${(gzip / 1024).toFixed(1)} KB gzip) of ${LIMIT / 1024} KB`);
if (total > LIMIT) {
  console.error(`over the ${LIMIT / 1024} KB opening limit: load the new code on demand instead of in the first screen`);
  process.exit(1);
}
