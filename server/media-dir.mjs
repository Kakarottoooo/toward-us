import { tmpdir } from "node:os";
import { join } from "node:path";

// Where uploaded photos, the couple's character pictures and imported chats live on disk. On Render this is the paid
// service's persistent disk (TOWARD_US_MEDIA_DIR in render.yaml, founder 11-06 "确认升级"); a temporary folder would be
// wiped on every restart and deploy. Locally it sits next to the data file, as before.
export const mediaDirectory = () => process.env.TOWARD_US_MEDIA_DIR || (process.env.TOWARD_US_DATA_FILE ? `${process.env.TOWARD_US_DATA_FILE}.media` : join(tmpdir(), "pinky-media"));
/** "disk" (a configured lasting folder), "file" (beside the local data file) or "temporary" (lost on restart). */
export const mediaPersistence = () => process.env.TOWARD_US_MEDIA_DIR ? "disk" : process.env.TOWARD_US_DATA_FILE ? "file" : "temporary";
