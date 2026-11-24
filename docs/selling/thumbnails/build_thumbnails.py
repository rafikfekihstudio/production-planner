"""Build the four Production Planner Gumroad thumbnails locally with PIL.

No image-model credits are used. Output: 1200x1200 PNGs in this folder.
"""

from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W = H = 1200
FONT_REG = r"C:\Windows\Fonts\segoeui.ttf"
FONT_BOLD = r"C:\Windows\Fonts\seguisb.ttf"

PRODUCTS = [
    {
        "key": "personal",
        "accent": (45, 212, 191),
        "price": "$39",
        "title": "Personal Studio",
        "badge": "1 STUDIO • INTERNAL USE",
        "sub": "Self-hosted • Source code",
        "style": "personal",
    },
    {
        "key": "commercial",
        "accent": (139, 155, 255),
        "price": "$99",
        "title": "Commercial License",
        "badge": "CLIENT WORK • WHITE-LABEL",
        "sub": "Client projects • Self-host",
        "style": "commercial",
    },
    {
        "key": "setup",
        "accent": (251, 191, 36),
        "price": "$149",
        "title": "Setup & Customization",
        "badge": "HANDS-ON HELP",
        "sub": "Install • Configure • Handoff",
        "style": "setup",
    },
    {
        "key": "ownership",
        "accent": (245, 196, 81),
        "price": "$699",
        "title": "Full Ownership",
        "badge": "ONE BUYER ONLY",
        "sub": "All rights • Signed transfer",
        "style": "ownership",
    },
]

BASE = np.array([11, 15, 20], dtype=float)
GRID = (150, 195, 215, 16)
WHITE = (238, 245, 250, 255)
MUTED = (158, 176, 190, 255)


def rgba(rgb: tuple[int, int, int], alpha: int = 255) -> tuple[int, int, int, int]:
    return rgb[0], rgb[1], rgb[2], alpha


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def draw_spaced(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    spacing: int = 3,
) -> None:
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += int(draw.textlength(ch, font=fnt)) + spacing


def make_background(accent: tuple[int, int, int]) -> Image.Image:
    glow_color = mix(tuple(BASE.astype(int)), accent, 0.38)
    yy, xx = np.mgrid[0:H, 0:W]
    dist = np.sqrt((xx - 140) ** 2 + (yy - 70) ** 2)
    falloff = np.clip(1 - dist / 980, 0, 1) ** 1.8
    arr = BASE[None, None, :] * (1 - falloff[..., None]) + np.array(glow_color, dtype=float)[
        None, None, :
    ] * falloff[..., None]
    img = Image.fromarray(np.uint8(np.clip(arr, 0, 255)), "RGB").convert("RGBA")

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=GRID, width=1)
    return Image.alpha_composite(img, overlay)


def draw_card(img: Image.Image, accent: tuple[int, int, int]) -> None:
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle(
        (110, 280, 1090, 760),
        radius=38,
        fill=(16, 24, 32, 238),
        outline=rgba(accent, 205),
        width=3,
    )
    d.rounded_rectangle((128, 298, 1072, 362), radius=26, fill=(255, 255, 255, 9))
    img.alpha_composite(card)


def draw_bar(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], color: tuple[int, int, int, int]) -> None:
    d.rounded_rectangle(box, radius=18, fill=color)


def draw_timeline(img: Image.Image, product: dict) -> None:
    d = ImageDraw.Draw(img)
    accent = product["accent"]
    style = product["style"]

    axis_y = 660
    d.line([(178, axis_y), (1022, axis_y)], fill=(255, 255, 255, 42), width=2)

    label_font = font(FONT_REG, 17)
    for i, x in enumerate([178, 389, 600, 811, 1022]):
        d.line([(x, axis_y - 8), (x, axis_y + 8)], fill=(255, 255, 255, 55), width=2)
        label = ["07:00", "11:00", "15:00", "19:00", "23:00"][i]
        box = d.textbbox((0, 0), label, font=label_font)
        tw = box[2] - box[0]
        d.text((x - tw / 2, axis_y + 20), label, font=label_font, fill=(150, 168, 182, 255))

    if style == "personal":
        draw_bar(d, (210, 378, 430, 430), rgba(accent, 235))
        draw_bar(d, (470, 458, 720, 510), rgba(mix(accent, (120, 180, 255), 0.45), 220))
        draw_bar(d, (760, 538, 980, 590), rgba(mix(accent, (255, 255, 255), 0.22), 205))
    elif style == "commercial":
        d.rounded_rectangle((182, 352, 1018, 410), radius=20, fill=(255, 255, 255, 8))
        d.rounded_rectangle((182, 430, 1018, 488), radius=20, fill=(255, 255, 255, 5))
        draw_bar(d, (205, 366, 455, 410), rgba(accent, 235))
        draw_bar(d, (520, 366, 730, 410), rgba(mix(accent, (200, 160, 255), 0.5), 225))
        draw_bar(d, (780, 444, 990, 488), rgba(accent, 215))
        draw_bar(d, (230, 524, 500, 568), rgba(mix(accent, (255, 255, 255), 0.18), 190))
        draw_bar(d, (590, 524, 860, 568), rgba(mix(accent, (100, 200, 255), 0.4), 205))
    elif style == "setup":
        draw_bar(d, (210, 386, 470, 438), rgba(accent, 235))
        draw_bar(d, (540, 470, 820, 522), rgba(mix(accent, (255, 255, 255), 0.2), 215))
        track_y = [568, 604]
        for i, y in enumerate(track_y):
            d.rounded_rectangle((210, y, 980, y + 8), radius=4, fill=(255, 255, 255, 35))
            knob_x = [360, 760][i]
            d.ellipse((knob_x - 16, y - 12, knob_x + 16, y + 20), fill=rgba(accent, 255))
    else:  # ownership
        draw_bar(d, (270, 398, 930, 486), rgba(accent, 250))
        draw_bar(d, (270, 536, 500, 578), rgba(mix(accent, (0, 0, 0), 0.72), 190))
        draw_bar(d, (650, 536, 930, 578), rgba(mix(accent, (0, 0, 0), 0.72), 190))


def draw_type(img: Image.Image, product: dict) -> None:
    d = ImageDraw.Draw(img)
    accent = product["accent"]

    draw_spaced(
        d,
        (90, 86),
        "PRODUCTION PLANNER",
        font(FONT_BOLD, 24),
        (225, 235, 242, 190),
        4,
    )

    d.rounded_rectangle((88, 824, 94, 930), radius=3, fill=rgba(accent, 255))
    d.text((118, 802), product["price"], font=font(FONT_BOLD, 112), fill=rgba(accent, 255))
    d.text((92, 952), product["title"], font=font(FONT_BOLD, 58), fill=WHITE)
    draw_spaced(d, (92, 1046), product["badge"], font(FONT_BOLD, 26), rgba(accent, 255), 2)
    d.text((92, 1092), product["sub"], font=font(FONT_REG, 24), fill=MUTED)


def build(product: dict) -> Image.Image:
    img = make_background(product["accent"])
    draw_card(img, product["accent"])
    draw_timeline(img, product)
    draw_type(img, product)
    return img.convert("RGB")


def main() -> None:
    images = []
    for product in PRODUCTS:
        img = build(product)
        out = os.path.join(HERE, f"{product['key']}-thumbnail.png")
        img.save(out, "PNG", optimize=True)
        print(f"saved {out}")
        images.append(img)

    thumb_size = 300
    sheet = Image.new("RGB", (thumb_size * 2 + 60, thumb_size * 2 + 60), (7, 10, 14))
    for idx, img in enumerate(images):
        small = img.resize((thumb_size, thumb_size), Image.Resampling.LANCZOS)
        x = 20 + (idx % 2) * (thumb_size + 20)
        y = 20 + (idx // 2) * (thumb_size + 20)
        sheet.paste(small, (x, y))
    sheet_path = os.path.join(HERE, "thumbnail-contact-sheet.png")
    sheet.save(sheet_path, "PNG", optimize=True)
    print(f"saved {sheet_path}")


if __name__ == "__main__":
    main()
