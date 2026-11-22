import { execFileSync } from "node:child_process";
import { build } from "vite";
import manifest from "../package.json" with { type: "json" };

// Stamp the loaded bundle, including cached bundles served after a newer deploy.
let sha = process.env.RENDER_GIT_COMMIT || process.env.BUILD_COMMIT;
if (!sha) {
  try { sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* source archive */ }
}
// src/mobile/index.ts re-exports every mobile component, and the first screen imports that index (src/App.tsx, which is
// protected). Without this, the bundler keeps every re-exported component in the opening JavaScript, along with the
// dialog and gesture libraries only the bottom sheet and flow stack use. They only define components, so declaring them
// free of side effects lets the screens that use them load them on demand instead. (Not Carousel: marking it too makes
// the bundler split the stylesheet into several files in a different order, which would change the cascade.)
const onDemandMobile = /src[\\/]mobile[\\/](?:BottomSheet|FlowStack)\.tsx$/;
await build({
  define: {
    "import.meta.env.VITE_WEB_COMMIT": JSON.stringify(/^[a-f0-9]{40}$/i.test(sha || "") ? sha : null),
    "import.meta.env.VITE_WEB_VERSION": JSON.stringify(manifest.version),
  },
  build: { rolldownOptions: { treeshake: { moduleSideEffects: [{ test: onDemandMobile, sideEffects: false }] } } },
});
