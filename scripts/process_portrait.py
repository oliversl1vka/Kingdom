from PIL import Image, ImageOps
import numpy as np
import json, os, sys

sys.path.insert(0, '/Users/oliver/projects/Kingdom')
from scripts.portrait_convert import from_braille

AIC = "/Users/oliver/projects/Kingdom/tools/ascii-image-converter_macOS_amd64_64bit/ascii-image-converter"
FRAMES = "/Users/oliver/projects/Kingdom/assets/terminal-portraits/frames"
SRC = "/Users/oliver/projects/Kingdom/assets/terminal-portraits/production_images"

def process_portrait(name, src_file, target_lum=75):
    img = Image.open(src_file).convert("L")
    arr = np.array(img).astype(np.float32)
    orig_lum = arr.mean()
    print(f"{name} original: {img.size} lum={orig_lum:.0f}")

    scale = target_lum / max(1, arr.mean())
    arr = arr * scale
    arr = np.clip(arr, 0, 255)
    arr = (arr - arr.mean()) * 1.1 + arr.mean()
    arr = np.clip(arr, 0, 255)
    bright = Image.fromarray(arr.astype(np.uint8))
    bright_path = f"/tmp/{name}_bright.png"
    bright.save(bright_path)

    best_th = None
    best_dots = 0
    best_res = None
    for th in range(50, 110, 5):
        os.system(f'{AIC} {bright_path} -b --threshold {th} -W 64 > /tmp/{name}_th{th}.txt 2>/dev/null')
        try:
            res = from_braille(bright_path, f'/tmp/{name}_th{th}.txt', lum_gain=1.15)
            dc = sum(1 for r in res['braille'] for ch in r if ch != '⠀')
            t = res['w'] * res['h'] * 8
            pct = 100*dc/t
            if abs(pct - 6.5) < abs(best_dots - 6.5) or best_th is None:
                best_th = th
                best_dots = pct
                best_res = res
        except Exception as e:
            pass

    if best_th is None:
        print(f"  ERROR for {name}")
        return

    dc = sum(1 for r in best_res['braille'] for ch in r if ch != '⠀')
    t = best_res['w'] * best_res['h'] * 8
    al = sum(sum(r) for r in best_res['lum']) / (best_res['w'] * best_res['h'])
    print(f"  Best th={best_th}: {best_res['w']}x{best_res['h']} dots={dc} ({100*dc/t:.1f}%) lum={al:.0f}")

    with open(f"{FRAMES}/{name}.cells.json", "w") as f:
        json.dump({"w": best_res["w"], "h": best_res["h"], "braille": best_res["braille"], "lum": best_res["lum"]}, f)
    with open(f"{FRAMES}/{name}.braille.txt", "w") as f:
        f.write("\n".join(best_res["braille"]) + "\n")

    RAMP = " .'~`^,:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
    def image_to_ascii(img, width):
        g = img.convert("L")
        g = ImageOps.autocontrast(g, cutoff=1.5)
        src_w, src_h = g.size
        cell_aspect = 2.0
        height = max(1, round(width * (src_h / src_w) / cell_aspect))
        g = g.resize((width, height), Image.LANCZOS)
        pixels = list(g.getdata())
        lines = []
        for y in range(height):
            row = pixels[y*width:(y+1)*width]
            lines.append("".join(RAMP[min(len(RAMP)-1, p*len(RAMP)//256)] for p in row))
        return lines

    for width, ext in [(44, "ascii"), (24, "mini")]:
        lines = image_to_ascii(bright, width)
        with open(f"{FRAMES}/{name}.{ext}.txt", "w") as f:
            f.write("\n".join(lines) + "\n")

    print(f"  OK {name} saved")

if __name__ == '__main__':
    name = sys.argv[1]
    src_file = sys.argv[2]
    process_portrait(name, src_file)
