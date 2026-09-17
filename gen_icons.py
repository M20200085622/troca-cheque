from PIL import Image, ImageDraw

BG = (11, 15, 20, 255)
CHEQUE = (243, 245, 247, 255)
CHEQUE_LINE = (154, 165, 177, 255)
ACCENT = (61, 220, 151, 255)
ACCENT_DARK = (6, 37, 26, 255)

def make_icon(size, path, rounded=True):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    if rounded:
        radius = int(size * 0.22)
        mask = Image.new("L", (size, size), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        bg_layer = Image.new("RGBA", (size, size), BG)
        img = Image.composite(bg_layer, Image.new("RGBA", (size, size), (0, 0, 0, 0)), mask)
        d = ImageDraw.Draw(img)

    # cheque body
    pad = size * 0.16
    cheque_w = size - pad * 2
    cheque_h = cheque_w * 0.62
    cx0 = pad
    cy0 = (size - cheque_h) / 2 - size * 0.03
    cx1 = cx0 + cheque_w
    cy1 = cy0 + cheque_h
    d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=size * 0.045, fill=CHEQUE)

    # lines on cheque
    line_y1 = cy0 + cheque_h * 0.32
    line_y2 = cy0 + cheque_h * 0.52
    d.line([cx0 + cheque_w * 0.12, line_y1, cx0 + cheque_w * 0.62, line_y1], fill=CHEQUE_LINE, width=max(2, int(size * 0.014)))
    d.line([cx0 + cheque_w * 0.12, line_y2, cx0 + cheque_w * 0.48, line_y2], fill=CHEQUE_LINE, width=max(2, int(size * 0.014)))

    # signature squiggle bottom-right
    sig_y = cy0 + cheque_h * 0.78
    d.line(
        [cx0 + cheque_w * 0.55, sig_y,
         cx0 + cheque_w * 0.63, sig_y - cheque_h * 0.08,
         cx0 + cheque_w * 0.71, sig_y + cheque_h * 0.06,
         cx0 + cheque_w * 0.80, sig_y - cheque_h * 0.05],
        fill=CHEQUE_LINE, width=max(2, int(size * 0.012)), joint="curve"
    )

    # accent coin/badge bottom-right overlapping the cheque
    coin_r = size * 0.185
    coin_cx = cx1 - coin_r * 0.35
    coin_cy = cy1 - coin_r * 0.15
    d.ellipse([coin_cx - coin_r, coin_cy - coin_r, coin_cx + coin_r, coin_cy + coin_r], fill=ACCENT)

    # checkmark inside coin
    lw = max(3, int(size * 0.022))
    d.line(
        [coin_cx - coin_r * 0.45, coin_cy + coin_r * 0.02,
         coin_cx - coin_r * 0.12, coin_cy + coin_r * 0.35,
         coin_cx + coin_r * 0.48, coin_cy - coin_r * 0.35],
        fill=ACCENT_DARK, width=lw, joint="curve"
    )

    img.save(path)

make_icon(192, "icons/icon-192.png")
make_icon(512, "icons/icon-512.png")
make_icon(180, "icons/icon-180.png", rounded=False)  # apple-touch-icon: iOS applies its own mask
print("icons generated")
