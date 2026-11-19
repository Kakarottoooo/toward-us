import { execFileSync } from "node:child_process";
import { build } from "vite";
import manifest from "../package.json" with { type: "json" };

// Stamp the loaded bundle, including cached bundles served after a newer deploy.
let sha = process.env.RENDER_GIT_COMMIT || process.env.BUILD_COMMIT;
if (!sha) {
  try { sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* source archive */ }
}
await build({ define: {
  "import.meta.env.VITE_WEB_COMMIT": JSON.stringify(/^[a-f0-9]{40}$/i.test(sha || "") ? sha : null),
  "import.meta.env.VITE_WEB_VERSION": JSON.stringify(manifest.version),
} });
