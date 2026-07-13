#!/usr/bin/env python3
"""High-fidelity terminal portrait converter for KingdomOS dashboards.

Reads an original painting and emits, per requested cell width:
  - <name>.braille.txt   monochrome braille art (Floyd-Steinberg dithered)
  - <name>.cells.json    {w,h,rows:[[lum,...],...]} per-cell luminance 0..255
                         plus rows of braille glyphs, for shaded rendering

Braille gives 2x4 dot resolution per character cell; combined with a per-cell
grey value this produces a soft, photographic, monochrome portrait that suits a
muted greyscale / beige design palette.
"""
import sys, json, argparse
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
import numpy as np

# Braille dot bit layout (Unicode U+2800 base).
# dot positions (row, col) -> bit value
BRAILLE_BITS = {
    (0, 0): 0x01, (1, 0): 0x02, (2, 0): 0x04, (3, 0): 0x40,
    (0, 1): 0x08, (1, 1): 0x10, (2, 1): 0x20, (3, 1): 0x80,
}


def preprocess(img, cutoff, gamma, sharpen, bg_suppress):
    """Grayscale, auto-level, gamma, sharpen, optional background suppression."""
    g = img.convert("L")
    # Auto-contrast: stretch histogram, clipping `cutoff` percent each end.
    g = ImageOps.autocontrast(g, cutoff=cutoff)
    arr = np.asarray(g).astype(np.float32) / 255.0
    if gamma and gamma != 1.0:
        arr = np.power(arr, gamma)
    if bg_suppress > 0:
        # Pull the darkest tones toward black so painterly backgrounds recede.
        lo = bg_suppress
        arr = np.clip((arr - lo) / max(1e-6, 1.0 - lo), 0.0, 1.0)
    out = Image.fromarray((arr * 255).astype(np.uint8))
    if sharpen > 0:
        out = out.filter(
            ImageFilter.UnsharpMask(radius=1.4, percent=int(sharpen * 100), threshold=2)
        )
    return out


def target_height(src_w, src_h, cell_w, cell_aspect):
    # physical aspect of output = cell_w : cell_aspect*H  must equal src_w:src_h
    return max(1, round(cell_w * (src_h / src_w) / cell_aspect))


def convert(path, cell_w, cell_aspect, cutoff, gamma, sharpen, bg_suppress,
            threshold, raw=False, dot_threshold=50.0, lum_gain=1.0,
            coverage=0.22):
    img = Image.open(path)
    H = target_height(img.width, img.height, cell_w, cell_aspect)
    dotW, dotH = cell_w * 2, H * 4

    if raw:
        # Source is already a clean braille stipple (light ink on black).
        # Downsample with MAX pooling so sparse bright dots survive instead of
        # being averaged into the black background.
        g = img.convert("L")
        src = np.asarray(g).astype(np.float32)
        sh, sw = src.shape
        ys = (np.linspace(0, sh, dotH + 1)).astype(int)
        xs = (np.linspace(0, sw, dotW + 1)).astype(int)
        on = np.zeros((dotH, dotW), dtype=bool)
        garr = np.zeros((dotH, dotW), dtype=np.float32)
        for j in range(dotH):
            y0, y1 = ys[j], max(ys[j] + 1, ys[j + 1])
            for i in range(dotW):
                x0, x1 = xs[i], max(xs[i] + 1, xs[i + 1])
                block = src[y0:y1, x0:x1]
                garr[j, i] = block.mean()
                # Light a dot when a meaningful fraction of the source region is
                # bright; preserves the stipple density gradient (cleaner than a
                # raw max-pool which floods bright regions into solid blocks).
                cov = float((block >= dot_threshold).mean())
                on[j, i] = cov >= coverage
    else:
        pre = preprocess(img, cutoff, gamma, sharpen, bg_suppress)
        grid = pre.resize((dotW, dotH), Image.LANCZOS)
        garr = np.asarray(grid).astype(np.float32)
        dith = garr.copy()
        for y in range(dotH):
            for x in range(dotW):
                old = dith[y, x]
                new = 255.0 if old >= threshold else 0.0
                dith[y, x] = new
                err = old - new
                if x + 1 < dotW:
                    dith[y, x + 1] += err * 7 / 16
                if y + 1 < dotH:
                    if x > 0:
                        dith[y + 1, x - 1] += err * 3 / 16
                    dith[y + 1, x] += err * 5 / 16
                    if x + 1 < dotW:
                        dith[y + 1, x + 1] += err * 1 / 16
        on = dith >= 128

    # Per-cell luminance (average of the 8 subpixels), used for greyscale tint.
    cells_lum = []
    for cy in range(H):
        row = []
        for cx in range(cell_w):
            block = garr[cy * 4:cy * 4 + 4, cx * 2:cx * 2 + 2]
            row.append(int(round(min(255.0, block.mean() * lum_gain))))
        cells_lum.append(row)

    braille_rows = []
    for cy in range(H):
        chars = []
        for cx in range(cell_w):
            bits = 0
            for (dr, dc), bit in BRAILLE_BITS.items():
                if on[cy * 4 + dr, cx * 2 + dc]:
                    bits |= bit
            chars.append(chr(0x2800 + bits))
        braille_rows.append("".join(chars))

    return {"w": cell_w, "h": H, "braille": braille_rows, "lum": cells_lum}


def from_braille(original, braille_path, lum_gain=1.0):
    """Pair an externally-generated braille stipple (e.g. ascii-image-converter)
    with per-cell luminance sampled from the original painting, so the dashboard
    can render the high-detail dot pattern in soft greyscale.

    The braille text defines the cell grid (cols x rows); the original is
    downsampled to that grid for one luminance value per cell.
    """
    rows = [ln.rstrip("\n") for ln in
            open(braille_path, encoding="utf-8").read().split("\n")]
    while rows and rows[-1] == "":
        rows.pop()
    cols = max((len(r) for r in rows), default=0)
    rows = [r.ljust(cols, chr(0x2800)) for r in rows]
    h = len(rows)

    g = Image.open(original).convert("L")
    g = ImageOps.autocontrast(g, cutoff=1.0)
    small = g.resize((max(1, cols), max(1, h)), Image.LANCZOS)
    larr = np.asarray(small).astype(np.float32)
    lum = [[int(round(min(255.0, larr[y, x] * lum_gain)))
            for x in range(cols)] for y in range(h)]
    return {"w": cols, "h": h, "braille": rows, "lum": lum}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("out_base", help="output path without extension")
    ap.add_argument("--width", type=int, default=44)
    ap.add_argument("--cell-aspect", type=float, default=2.0,
                    help="terminal cell height/width ratio")
    ap.add_argument("--cutoff", type=float, default=1.5)
    ap.add_argument("--gamma", type=float, default=0.85)
    ap.add_argument("--sharpen", type=float, default=0.9)
    ap.add_argument("--bg-suppress", type=float, default=0.10)
    ap.add_argument("--threshold", type=float, default=128.0)
    ap.add_argument("--raw", action="store_true",
                    help="source is already a clean braille stipple; preserve it")
    ap.add_argument("--dot-threshold", type=float, default=50.0,
                    help="raw mode: brightness above which a dot is lit")
    ap.add_argument("--lum-gain", type=float, default=1.0,
                    help="multiply per-cell luminance for brighter shading")
    ap.add_argument("--coverage", type=float, default=0.22,
                    help="raw mode: min bright-pixel fraction to light a dot")
    ap.add_argument("--from-braille",
                    help="pair this pre-made braille .txt with luminance from input")
    a = ap.parse_args()

    if a.from_braille:
        res = from_braille(a.input, a.from_braille, lum_gain=a.lum_gain)
    else:
        res = convert(a.input, a.width, a.cell_aspect, a.cutoff, a.gamma,
                      a.sharpen, a.bg_suppress, a.threshold,
                      raw=a.raw, dot_threshold=a.dot_threshold, lum_gain=a.lum_gain,
                      coverage=a.coverage)
    with open(a.out_base + ".braille.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(res["braille"]) + "\n")
    with open(a.out_base + ".cells.json", "w", encoding="utf-8") as f:
        json.dump({"w": res["w"], "h": res["h"], "braille": res["braille"],
                   "lum": res["lum"]}, f)
    print(f"{a.input} -> {a.out_base} ({res['w']}x{res['h']})")


if __name__ == "__main__":
    main()
