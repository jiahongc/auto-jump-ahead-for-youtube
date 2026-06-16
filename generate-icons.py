"""Generate icon16.png, icon48.png, icon128.png (pure Python, no dependencies)."""
import math
import struct
import zlib


def make_png(size, draw_fn):
    raw = b""
    for y in range(size):
        raw += b"\x00"  # PNG scanline filter: None
        for x in range(size):
            raw += bytes(draw_fn(x, y, size))

    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA, 8-bit
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def in_triangle(px, py, x1, y1, x2, y2, x3, y3):
    d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
    d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3)
    d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def rounded_rect_alpha(px, py, left, top, right, bottom, radius):
    cx = min(max(px, left + radius), right - radius)
    cy = min(max(py, top + radius), bottom - radius)
    d = math.hypot(px - cx, py - cy)
    return d <= radius


def icon_pixel(x, y, size):
    px = (x + 0.5) / size
    py = (y + 0.5) / size

    # Rounded-square background mask.
    if not rounded_rect_alpha(px, py, 0.06, 0.06, 0.94, 0.94, 0.20):
        return (0, 0, 0, 0)

    # Indigo gradient background. Deliberately NOT YouTube red, and no
    # play-button-in-red-square shape, to avoid implying affiliation with
    # YouTube/Google in the Chrome Web Store listing.
    grad = 1.0 - (0.6 * py + 0.4 * px)
    grad = max(0.0, min(1.0, grad))
    r = int(60 + 40 * grad)
    g = int(72 + 52 * grad)
    b = int(196 + 44 * grad)

    # Soft top-left highlight.
    highlight = max(0.0, 1.0 - ((px - 0.28) ** 2 + (py - 0.20) ** 2) / 0.09)
    r = min(255, int(r + 18 * highlight))
    g = min(255, int(g + 18 * highlight))
    b = min(255, int(b + 12 * highlight))

    # Skip-to-next glyph: two triangles + right bar. This is the generic
    # media "skip forward" control, centered on the canvas.
    tri1 = in_triangle(px, py, 0.20, 0.28, 0.20, 0.72, 0.46, 0.50)
    tri2 = in_triangle(px, py, 0.43, 0.28, 0.43, 0.72, 0.69, 0.50)
    bar = (0.72 <= px <= 0.80) and (0.28 <= py <= 0.72)
    if tri1 or tri2 or bar:
        return (255, 255, 255, 255)
    return (r, g, b, 255)


for size in (16, 48, 128):
    out = f"icon{size}.png"
    with open(out, "wb") as f:
        f.write(make_png(size, icon_pixel))
    print(f"Created {out}")
