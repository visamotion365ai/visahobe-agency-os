"""Render the VisaHOBe eye mark into the PNG sizes the PWA manifest needs.

Pure-Pillow so the icons can be regenerated without a browser installed.
"""
from PIL import Image, ImageDraw
import math
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'apps', 'web', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

S = 1024  # supersampled working canvas


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, c0, c1, diagonal=True):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2) if diagonal else y / (size - 1)
            px[x, y] = lerp(c0, c1, t)
    return img


def draw_mark(size, maskable=False, transparent=False):
    scale = size / 64.0

    def p(v):
        return v * scale

    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bg = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    radius = p(16)
    grad = gradient(size, (91, 77, 255), (11, 143, 158)).convert('RGBA')
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    if maskable:
        # Full-bleed for maskable icons; the safe zone keeps the eye centred.
        canvas.paste(grad, (0, 0))
        inset = size * 0.16
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=0, fill=255)
        canvas.putalpha(mask)
    else:
        canvas.paste(grad, (0, 0), mask)
        canvas.putalpha(mask)

    d = ImageDraw.Draw(canvas)
    white = (255, 255, 255, 255)
    stroke = max(2, int(p(3.1)))
    cx, cy = size / 2, size / 2
    if maskable:
        # Slightly smaller mark inside the maskable safe zone.
        shrink = 0.72
        stroke = max(2, int(p(3.1) * shrink))

    def sc(v):
        return p(v) * (0.72 if maskable else 1.0)

    ex = p(64) / 2
    ey = p(32) * (1 if not maskable else 1)
    rx = sc(18.6)
    ry = sc(12.0)

    # Eye outline as a lens (two arcs) approximated with a polygon fill.
    pts = []
    steps = 120
    for i in range(steps + 1):
        a = -math.pi / 2 + math.pi * (i / steps)
        pts.append((cx - rx * math.cos(a), ey - ry * math.sin(a)))
    for i in range(steps + 1):
        a = math.pi / 2 + math.pi * (i / steps)
        pts.append((cx - rx * math.cos(a), ey + ry * math.sin(a)))
    # draw as a thick outlined shape
    d.line(pts + [pts[0]], fill=white, width=stroke, joint='curve')

    # Iris
    ir = sc(6.6)
    iris = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    idr = ImageDraw.Draw(iris)
    idr.ellipse([cx - ir, ey - ir, cx + ir, ey + ir], fill=(233, 240, 255, 255))
    canvas.alpha_composite(iris)
    pr = sc(3.0)
    d.ellipse([cx - pr, ey - pr, cx + pr, ey + pr], fill=(22, 32, 58, 255))
    hr = sc(1.35)
    d.ellipse([cx + sc(2.2) - hr, ey - sc(2.4) - hr, cx + sc(2.2) + hr, ey - sc(2.4) + hr], fill=white)

    # Approval tick
    tick = [
        (cx - sc(9.5), ey + sc(15.5)),
        (cx - sc(5.9), ey + sc(19.1)),
        (cx + sc(1.1), ey + sc(11.5)),
    ]
    d.line(tick, fill=(255, 255, 255, 235), width=max(2, int(sc(2.6))), joint='curve')

    return canvas


def save(size, name, maskable=False, transparent=False):
    img = draw_mark(size * 4, maskable=maskable, transparent=transparent)
    img = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, name)
    img.save(path)
    print('wrote', name, os.path.getsize(path), 'bytes')


save(192, 'icon-192.png')
save(512, 'icon-512.png')
save(512, 'icon-maskable-512.png', maskable=True)
save(180, 'apple-touch-icon.png')
save(32, 'favicon-32.png')
save(16, 'favicon-16.png')
print('icons generated')
