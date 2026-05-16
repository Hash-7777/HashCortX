"""
HashCortx icon generator
Run: python3 scripts/gen-icon.py
Output: src/assets/icon-master.png  (1024x1024, used by `npm run tauri icon`)

After running this, regenerate all platform icon sizes with:
  npm run tauri icon src/assets/icon-master.png
"""

import math
import sys
import os
from PIL import Image, ImageDraw, ImageFilter

# ── Configuration ─────────────────────────────────────────────
SIZE       = 1024          # master icon is 1024×1024
BG_COLOR   = (4, 7, 4)    # --hc-bg: near-black green
LINE_COLOR = (57, 255, 129)  # --hc-green: neon terminal green
RADIUS_PCT = 0.370         # ray length as fraction of canvas size
STROKE_PCT = 0.040         # line width as fraction of canvas size (bolder, matches reference)

# 7 rays — bearing angles CW from 12 o'clock, derived by pixel-tracing the reference image.
# Gap in upper-left quadrant (between 263° and 360°/0°) is intentional asymmetry.
ANGLES = [0, 50, 95, 138, 192, 217, 263]

# ── Drawing ───────────────────────────────────────────────────
def draw_icon(size=SIZE):
    cx, cy   = size // 2, size // 2
    r        = int(size * RADIUS_PCT)
    lw       = max(4, int(size * STROKE_PCT))  # sharp line width
    glow_lw  = lw * 5                          # glow layer is wider + blurred

    # Pre-compute ray endpoints
    endpoints = []
    for deg in ANGLES:
        rad = math.radians(deg)
        ex  = cx + r * math.sin(rad)
        ey  = cy - r * math.cos(rad)
        endpoints.append((ex, ey))

    # ── Layer 1: outer glow (wide, very blurred) ──────────────
    outer_glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(outer_glow)
    for ex, ey in endpoints:
        d.line([(cx, cy), (ex, ey)], fill=(*LINE_COLOR, 80), width=glow_lw * 2)
        # Dot at origin and tip to round the caps visually
        cap_r = glow_lw
        d.ellipse([cx-cap_r, cy-cap_r, cx+cap_r, cy+cap_r], fill=(*LINE_COLOR, 80))
        d.ellipse([ex-cap_r, ey-cap_r, ex+cap_r, ey+cap_r], fill=(*LINE_COLOR, 80))
    outer_glow = outer_glow.filter(ImageFilter.GaussianBlur(radius=lw * 6))

    # ── Layer 2: inner glow (narrower, medium blur) ───────────
    inner_glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(inner_glow)
    for ex, ey in endpoints:
        d.line([(cx, cy), (ex, ey)], fill=(*LINE_COLOR, 140), width=glow_lw)
        cap_r = glow_lw // 2
        d.ellipse([cx-cap_r, cy-cap_r, cx+cap_r, cy+cap_r], fill=(*LINE_COLOR, 140))
        d.ellipse([ex-cap_r, ey-cap_r, ex+cap_r, ey+cap_r], fill=(*LINE_COLOR, 140))
    inner_glow = inner_glow.filter(ImageFilter.GaussianBlur(radius=lw * 2))

    # ── Layer 3: sharp lines ──────────────────────────────────
    sharp = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(sharp)
    for ex, ey in endpoints:
        d.line([(cx, cy), (ex, ey)], fill=(*LINE_COLOR, 255), width=lw)
        # Rounded caps via small filled circles
        cap_r = lw // 2
        d.ellipse([cx-cap_r, cy-cap_r, cx+cap_r, cy+cap_r], fill=(*LINE_COLOR, 255))
        d.ellipse([ex-cap_r, ey-cap_r, ex+cap_r, ey+cap_r], fill=(*LINE_COLOR, 255))

    # ── Composite: bg → outer_glow → inner_glow → sharp ──────
    bg     = Image.new("RGBA", (size, size), (*BG_COLOR, 255))
    result = Image.alpha_composite(bg, outer_glow)
    result = Image.alpha_composite(result, inner_glow)
    result = Image.alpha_composite(result, sharp)
    return result.convert("RGB")


# ── Main ──────────────────────────────────────────────────────
out_dir  = os.path.join(os.path.dirname(__file__), "..", "src", "assets")
out_path = os.path.join(out_dir, "icon-master.png")

os.makedirs(out_dir, exist_ok=True)
img = draw_icon()
img.save(out_path)
print(f"Saved {out_path}  ({img.width}×{img.height})")
print()
print("Next step — generate all platform icon sizes:")
print("  npm run tauri icon src/assets/icon-master.png")
