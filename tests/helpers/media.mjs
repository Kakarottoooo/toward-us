import { join } from "node:path";

// A Render build cannot write to the runtime disk. Keep real fixture uploads inside its disposable directory.
export function useTestMedia(t, directory) {
  const media = join(directory, "media");
  const previous = process.env.TOWARD_US_MEDIA_DIR;
  process.env.TOWARD_US_MEDIA_DIR = media;
  t.after(() => {
    if (previous === undefined) delete process.env.TOWARD_US_MEDIA_DIR;
    else process.env.TOWARD_US_MEDIA_DIR = previous;
  });
  return media;
}
