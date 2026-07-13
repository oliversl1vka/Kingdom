#!/usr/bin/env python3
"""Render an ANSI (truecolor SGR) text capture to a PNG for visual QA."""
import sys, os, re, argparse
from PIL import Image, ImageDraw, ImageFont

def _find_monospace_font():
    """Return the best available monospace font path for the current platform."""
    if sys.platform == 'darwin':
        candidates = [
            '/System/Library/Fonts/Menlo.ttc',
            '/System/Library/Fonts/SF-Mono.ttc',
            '/System/Library/Fonts/Monaco.ttf',
            '/Library/Fonts/Courier New.ttf',
        ]
    elif sys.platform == 'win32':
        candidates = [
            r'C:\Windows\Fonts\consola.ttf',
            r'C:\Windows\Fonts\cour.ttf',
        ]
    else:
        candidates = [
            '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
            '/usr/share/fonts/TTF/DejaVuSansMono.ttf',
        ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None  # let PIL use its default

SGR = re.compile(r"\x1b\[([0-9;]*)m")


def parse(line):
    """Yield (text, fg, bold) runs. fg is (r,g,b) or None."""
    fg = None
    bold = False
    pos = 0
    runs = []
    for m in SGR.finditer(line):
        if m.start() > pos:
            runs.append((line[pos:m.start()], fg, bold))
        codes = [c for c in m.group(1).split(";") if c != ""]
        i = 0
        if not codes:
            fg = None; bold = False
        while i < len(codes):
            c = int(codes[i])
            if c == 0:
                fg = None; bold = False
            elif c == 1:
                bold = True
            elif c == 2:
                bold = False
            elif c == 38 and i + 4 < len(codes) and codes[i + 1] == "2":
                fg = (int(codes[i + 2]), int(codes[i + 3]), int(codes[i + 4])); i += 4
            elif c == 48 and i + 4 < len(codes) and codes[i + 1] == "2":
                i += 4  # ignore bg for QA
            i += 1
        pos = m.end()
    if pos < len(line):
        runs.append((line[pos:], fg, bold))
    return runs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--font", default=_find_monospace_font())
    ap.add_argument("--size", type=int, default=18)
    ap.add_argument("--bg", default="14,14,16")
    a = ap.parse_args()

    with open(a.input, encoding="utf-8-sig") as f:
        lines = f.read().replace("\r", "").split("\n")

    font = ImageFont.truetype(a.font, a.size) if a.font else ImageFont.load_default()
    # cell metrics
    cw = font.getbbox("M")[2]
    line_h = int(a.size * 1.32)
    cols = max((len(SGR.sub("", l)) for l in lines), default=1)
    W = cw * (cols + 1)
    H = line_h * (len(lines) + 1)
    bg = tuple(int(x) for x in a.bg.split(","))
    img = Image.new("RGBA", (W, H), (*bg, 255))

    y = line_h // 2
    for line in lines:
        x = cw // 2
        for text, fg, bold in parse(line):
            color = fg if fg else (200, 200, 200)
            for ch_idx, ch in enumerate(text):
                mask = font.getmask(ch)
                if mask is None:
                    x += cw
                    continue
                mw, mh = mask.size
                # Create an RGBA glyph image from the mask — paint every
                # non-zero mask pixel in the run's colour so we sidestep
                # CoreText limitations that prevent Pillow's ImageDraw.text()
                # from rendering supplementary-plane glyphs like braille.
                glyph = Image.new("RGBA", (mw, mh), (0, 0, 0, 0))
                glyph_px = glyph.load()
                mask_px = list(mask)
                for py in range(mh):
                    row_off = py * mw
                    for px_idx in range(mw):
                        alpha = mask_px[row_off + px_idx]
                        if alpha:
                            glyph_px[px_idx, py] = (*color, alpha)
                img.paste(glyph, (x, y), glyph)
                x += cw
        y += line_h

    # Flatten to RGB for PNG output
    rgb = Image.new("RGB", img.size, bg)
    rgb.paste(img, mask=img.split()[3])
    rgb.save(a.output)
    print(f"{a.output}  ({W}x{H}, {cols} cols x {len(lines)} rows)")


if __name__ == "__main__":
    main()
