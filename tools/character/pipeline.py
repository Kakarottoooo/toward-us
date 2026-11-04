"""The picture steps of the couple's character (server/character.mjs), run by the Pinky server itself in the GPU
environment (default E:\\local-ai\\wan22\\venv: torch, transformers, imageio+av, Pillow). Copied from the 人脉/Onegent
repository (tools/character/pipeline.py); keep the two in step by hand.

    pipeline.py looks PHOTO OUT_DIR       cut the subject out, check it is whole, write look-0.png (transparent)
    pipeline.py green LOOK OUT.png        the look on plain green with room to move, as the video model's first frame
    pipeline.py loop CLIP.mp4 OUT.webp [pingpong|forward]   every frame cut out again, framed like the look; a clip
                                          that does not end where it began plays forward then back

Every picture of a character is cut to its own shape, whatever it is (a lying lizard, a standing person): the whole
subject (in a clip: everything it covers across all frames) with a thin margin, no box around it, so it can stand on
the screen; the app sizes it by height with a width limit. None is ever cut.
Exit code 3: the subject runs off the photo's edge (cut off); 4: no subject found."""
import os
import sys

import numpy as np
from PIL import Image

MODEL = os.environ.get("BIREFNET", r"E:\local-ai\models\BiRefNet")  # BiRefNet, MIT; u2net lost tails and paws
GREEN = (0, 177, 64)
PAD = 0.04  # around the subject, so soft fur edges and a shadow are not clipped
EDGE = 0.02  # a subject touching more than this share of one photo edge is cut off by the photo
_model = None


def matte(images):
    """PIL images -> 'L' alpha images of the main subject, each the size of its input."""
    global _model
    import torch
    from transformers import AutoModelForImageSegmentation
    if _model is None:
        torch.set_float32_matmul_precision("high")
        _model = AutoModelForImageSegmentation.from_pretrained(MODEL, trust_remote_code=True).cuda().eval().half()
    alphas = []
    for image in images:
        x = np.asarray(image.convert("RGB").resize((1024, 1024), Image.BILINEAR), dtype=np.float32) / 255.0
        x = (x - (0.485, 0.456, 0.406)) / (0.229, 0.224, 0.225)
        x = torch.from_numpy(x.transpose(2, 0, 1)[None].astype(np.float16)).cuda()
        with torch.no_grad():
            pred = _model(x)[-1].sigmoid()[0, 0].float().cpu().numpy()
        alphas.append(Image.fromarray((pred * 255).astype(np.uint8)).resize(image.size, Image.LANCZOS))
    return alphas


def frame(rgba, box, side):
    """The part of rgba inside box, trimmed to the subject's own shape with a thin even margin (never a square box: the
    founder, 11-03), its longer side scaled to side. The app sizes characters by height, so none is out of scale."""
    crop = rgba.crop(box)
    pad = max(1, round(max(crop.size) * PAD))
    scale = side / (max(crop.size) + 2 * pad)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    canvas = Image.new("RGBA", (size[0] + 2 * round(pad * scale), size[1] + 2 * round(pad * scale)), (0, 0, 0, 0))
    canvas.alpha_composite(crop.resize(size, Image.LANCZOS), (round(pad * scale), round(pad * scale)))
    return canvas


def looks(photo_path, out_dir):
    photo = Image.open(photo_path)
    photo = photo.convert("RGB")
    photo.thumbnail((2048, 2048))
    alpha = np.asarray(matte([photo])[0])
    solid = alpha > 128
    if solid.sum() < solid.size * 0.01:
        sys.exit(4)
    edges = (solid[0], solid[-1], solid[:, 0], solid[:, -1])
    if any(edge.mean() > EDGE for edge in edges):
        sys.exit(3)
    ys, xs = np.where(alpha > 16)
    rgba = Image.fromarray(unmix(np.asarray(photo, np.float32), alpha.astype(np.float32)), "RGBA")  # no background colour on the edge
    frame(rgba, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), 512).save(os.path.join(out_dir, "look-0.png"))


def green(look_path, out_path, side=640, fill=0.7):
    """Smaller than in the look, so a moving tail or a raised arm stays inside the clip."""
    look = Image.open(look_path).convert("RGBA")
    box = look.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    crop = look.crop(box)
    scale = side * fill / max(crop.size)
    size = (round(crop.width * scale), round(crop.height * scale))
    canvas = Image.new("RGB", (side, side), GREEN)
    canvas.paste(crop.resize(size, Image.LANCZOS).convert("RGB"), ((side - size[0]) // 2, side - size[1] - round(side * 0.12)),
                 crop.resize(size, Image.LANCZOS).getchannel("A"))
    canvas.save(out_path)


def unmix(rgb, alpha):
    """The subject's own colour at its soft edges. An edge pixel mixes subject and green screen; taking the green out by
    arithmetic leaves a tint (grey or pink), and a dark tint read as a box behind the character (the founder, 11-03).
    So an edge pixel takes the colour of the solid subject next to it (spread outward by blurring) and keeps only its
    own transparency."""
    from PIL import ImageFilter
    a = alpha / 255.0
    solid = (a > 0.92).astype(np.float32)
    spread_rgb, spread_w = rgb * solid[..., None], solid.copy()
    for radius in (2, 6, 16):  # near colour first, then further out for thin wisps
        w = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255
        c = np.dstack([np.asarray(Image.fromarray((rgb[..., i] * solid).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius)), np.float32)
                       for i in range(3)])
        empty = spread_w < 0.05
        spread_rgb[empty], spread_w[empty] = c[empty], w[empty]
    edge_colour = spread_rgb / np.maximum(spread_w, 1e-3)[..., None]
    out = np.where((a > 0.92)[..., None], rgb, edge_colour)
    return np.dstack([out, alpha]).clip(0, 255).astype(np.uint8)


def loop(clip_path, out_path, mode="pingpong", side=256, fps=15):
    import imageio.v3 as iio
    source_fps = iio.immeta(clip_path, plugin="pyav").get("fps") or 30
    frames = iio.imread(clip_path, plugin="pyav")[:: max(1, round(source_fps / fps))]
    alphas = matte([Image.fromarray(f) for f in frames])  # fur edges survive far better than with a chroma key
    keyed = []
    for rgb, alpha in zip(frames, alphas):
        keyed.append(Image.fromarray(unmix(rgb.astype(np.float32), np.asarray(alpha, np.float32)), "RGBA"))
    cover = np.stack([np.asarray(k.getchannel("A")) for k in keyed]).max(axis=0)
    ys, xs = np.where(cover > 16)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)  # one box for every frame: the character never jumps
    images = [frame(k, box, side) for k in keyed]
    step_ms = round(1000 * max(1, round(source_fps / fps)) / source_fps)
    if mode == "pingpong":
        images = images + images[-2:0:-1]  # forward then back: the last frame meets the first
    else:
        images = images[:-1]  # it ends on the frame it began with; showing both would stutter
    images[0].save(out_path, save_all=True, append_images=images[1:], duration=step_ms, loop=0, quality=88, method=6)


if __name__ == "__main__":
    step, *args = sys.argv[1:]
    {"looks": looks, "green": green, "loop": loop}[step](*args)
