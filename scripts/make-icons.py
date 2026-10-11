# Draws the app icons (a chunky kart on jungle green) into client/icons/.
#   python3 scripts/make-icons.py
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "client" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

GREEN = (31, 90, 53)
GREEN_LIGHT = (63, 154, 53)
MANGO = (255, 154, 31)
MANGO_DEEP = (217, 98, 11)
INK = (59, 36, 18)
CREAM = (255, 244, 220)
BLUE = (46, 125, 215)
TYRE = (42, 39, 48)


def draw(size, maskable=False):
    s = size * 4  # draw big, scale down for smooth edges
    img = Image.new("RGBA", (s, s), GREEN + (255,))
    d = ImageDraw.Draw(img)
    # maskable icons keep the art inside the central safe circle
    k = 0.72 if maskable else 0.9
    cx, cy = s / 2, s / 2

    def P(x, y):
        return (cx + x * s * k / 2, cy + y * s * k / 2)

    def box(x0, y0, x1, y1):
        a, b = P(x0, y0), P(x1, y1)
        return [a[0], a[1], b[0], b[1]]

    # sun-burst stripes behind
    for i in range(12):
        if i % 2:
            continue
        import math
        a0 = i * math.pi / 6
        a1 = (i + 1) * math.pi / 6
        r = s
        d.polygon([(cx, cy * 1.1), (cx + r * math.cos(a0), cy * 1.1 + r * math.sin(a0)), (cx + r * math.cos(a1), cy * 1.1 + r * math.sin(a1))], fill=GREEN_LIGHT + (255,))
    # ground shadow
    d.ellipse(box(-0.85, 0.55, 0.85, 0.85), fill=(20, 52, 32, 255))
    lw = max(4, int(s * 0.018))
    # rear wheels (big) and front wheels
    for x0 in (-0.95, 0.55):
        d.rounded_rectangle(box(x0, 0.05, x0 + 0.4, 0.72), radius=s * 0.03, fill=TYRE, outline=INK, width=lw)
    # body
    d.rounded_rectangle(box(-0.62, 0.08, 0.62, 0.5), radius=s * 0.06, fill=MANGO, outline=INK, width=lw)
    d.rectangle(box(-0.62, 0.36, 0.62, 0.5), fill=MANGO_DEEP)
    d.rounded_rectangle(box(-0.62, 0.08, 0.62, 0.5), radius=s * 0.06, outline=INK, width=lw)
    # spoiler
    d.rounded_rectangle(box(-0.78, -0.12, 0.78, 0.0), radius=s * 0.02, fill=MANGO, outline=INK, width=lw)
    d.rectangle(box(-0.5, 0.0, -0.4, 0.1), fill=INK)
    d.rectangle(box(0.4, 0.0, 0.5, 0.1), fill=INK)
    # driver: big helmet with a stripe and goggles
    d.ellipse(box(-0.42, -0.78, 0.42, 0.06), fill=BLUE, outline=INK, width=lw)
    d.rectangle(box(-0.06, -0.78, 0.06, -0.1), fill=CREAM)
    for gx in (-0.2, 0.2):
        d.ellipse(box(gx - 0.13, -0.5, gx + 0.13, -0.24), fill=(99, 210, 255), outline=INK, width=lw)
    # exhaust flames
    for fx in (-0.25, 0.25):
        d.polygon([P(fx - 0.09, 0.5), P(fx + 0.09, 0.5), P(fx, 0.78)], fill=(255, 194, 61), outline=INK)
    return img.resize((size, size), Image.LANCZOS)


for size in (192, 512):
    draw(size).save(OUT / f"icon-{size}.png")
    draw(size, maskable=True).save(OUT / f"icon-maskable-{size}.png")
draw(180).convert("RGB").save(OUT / "apple-touch-icon.png")
print("wrote", sorted(p.name for p in OUT.iterdir()))
