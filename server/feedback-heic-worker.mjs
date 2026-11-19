// Prebuilt sharp supports AVIF but does not ship an HEVC decoder. Isolate libheif's CPU/memory lifetime per upload.
import { parentPort, workerData } from "node:worker_threads";
import libheif from "libheif-js/wasm-bundle.js";
import sharp from "sharp";

try {
  const [image] = new libheif.HeifDecoder().decode(workerData.bytes);
  const width = image.get_width(), height = image.get_height();
  if (!(width > 0 && height > 0 && width * height <= workerData.pixels)) throw new Error();
  const raw = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const result = await new Promise((resolve) => image.display(raw, resolve));
  if (!result) throw new Error();
  const bytes = await sharp(result.data, { raw: { width, height, channels: 4 } })
    .resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
  parentPort.postMessage(bytes);
} catch { parentPort.postMessage(null); }
