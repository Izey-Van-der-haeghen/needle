"""Draw Needle's toolbar and store icons (16, 32, 48, 128 px) from simple geometry.

A coral tile with an ink magnifying glass whose handle is a needle: "look closely
at this page". From 32 px a check mark sits in the lens; from 48 px the needle
gets its eye. Run: python3 tools/make-icons.py
"""
from math import hypot
from pathlib import Path
from PIL import Image, ImageDraw

CORAL = (255, 106, 85, 255)   # house style coral #FF6A55
INK = (20, 19, 18, 255)       # house style ink #141312
PAPER = (250, 250, 247, 255)  # house style paper #FAFAF7
OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 8  # supersampling for smooth edges


def draw(size: int, pad: float) -> Image.Image:
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    p = pad * big
    w = big - 2 * p
    u = w / 16  # one unit = 1/16 of the tile

    # Tile
    d.rounded_rectangle([p, p, p + w, p + w], radius=u * (3.2 if size <= 16 else 3.6), fill=CORAL)

    # Lens
    cx, cy = p + u * 6.6, p + u * 6.6
    r = u * (4.3 if size <= 16 else 4.1)
    ring = u * (1.9 if size <= 16 else 1.45)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=INK)
    inner = r - ring
    d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=PAPER)

    # Needle handle: from the lens rim to a sharp point in the lower right
    k = 0.7071
    sx, sy = cx + r * k * 0.92, cy + r * k * 0.92        # start on the rim
    tx, ty = p + u * 14.2, p + u * 14.2                    # tip
    half = u * (1.25 if size <= 16 else 1.05)              # half width at the lens end
    nx, ny = -k, k                                         # normal to the handle
    d.polygon([(sx + nx * half, sy + ny * half), (sx - nx * half, sy - ny * half), (tx, ty)], fill=INK)

    if size >= 48:
        # The needle's eye: a short slot near the lens end
        ex, ey = sx + (tx - sx) * 0.22, sy + (ty - sy) * 0.22
        dx, dy = (tx - sx), (ty - sy)
        n = hypot(dx, dy)
        dx, dy = dx / n, dy / n
        L, t = u * 0.85, u * 0.32
        d.line([(ex - dx * L, ey - dy * L), (ex + dx * L, ey + dy * L)], fill=PAPER, width=max(1, int(t * 2)))

    if size >= 32:
        # Check mark in the lens
        cw = max(1, int(u * (1.0 if size < 48 else 0.85)))
        a = (cx - inner * 0.55, cy + inner * 0.02)
        b = (cx - inner * 0.12, cy + inner * 0.45)
        c = (cx + inner * 0.58, cy - inner * 0.42)
        d.line([a, b, c], fill=INK, width=cw, joint="curve")

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for size in (16, 32, 48):
        draw(size, pad=0.0).save(OUT / f"icon{size}.png")
    # Chrome Web Store: 128 px with 96 px artwork and 16 px transparent padding.
    draw(128, pad=16 / 128).save(OUT / "icon128.png")
    print("Wrote", ", ".join(f"icon{s}.png" for s in (16, 32, 48, 128)), "to", OUT)


if __name__ == "__main__":
    main()
