"""
Builds the icon HashCortx ships, from the artwork it is drawn from.

    python3 scripts/gen-icon.py
    npm run tauri icon src-tauri/icons/icon-master.png

The first command writes the 1024x1024 master; the second turns it into every
size and container the platforms want (.icns, .ico, the Square*Logo set, and
the mobile folders). Neither step invents anything: the brain is the artwork at
logosss/new hashcortx logo no bg.png, composited unchanged.

WHAT THIS FILE USED TO BE. It drew a seven-ray neon-green burst that the app has
never shipped, under a header warning you not to run it. So the real icon was
not reproducible from the repository at all — it existed only as the PNGs in
src-tauri/icons/, and the only script named after the job made a different
picture. That is the kind of gap where a rebuild quietly changes the product.

THE THREE THINGS THAT ARE DECISIONS HERE, so they can be changed on purpose:

  FILL. The mark stands at 82% of the tile's height. The icon it replaces sat at
  about 65%, which read as a small brain in a large black square — the padding
  was the most noticeable thing about it at the size an icon is actually seen.

  CORNERS. A rounded square at 22% of the side, with the corners transparent, so
  the platform's own background shows through them rather than a black box
  sitting on top of it.

  EDGE. A #39ff81 stroke at 1.9% of the side — the same neon green the app uses
  for Coder's accent, not a new colour. It is drawn last and inset by half its
  width, so the whole stroke lands inside the canvas instead of being clipped by
  it.

Everything is composited at four times the final size and scaled down once, so
the corner and the stroke are smooth rather than stepped.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "logosss" / "new hashcortx logo no bg.png"
OUT = ROOT / "src-tauri" / "icons" / "icon-master.png"

SIZE = 1024
SUPERSAMPLE = 4
MARK_HEIGHT = 0.82      # share of the tile the mark stands at
CORNER = 0.22           # corner radius, as a share of the side
STROKE = 0.019          # neon edge width, as a share of the side
TILE = (8, 9, 13, 255)  # near-black, the app's own ground
NEON = (57, 255, 129, 255)  # #39ff81


def build() -> Image.Image:
    s = SIZE * SUPERSAMPLE
    radius = int(CORNER * s)
    stroke = int(STROKE * s)

    tile = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=TILE)

    mark = Image.open(ART).convert("RGBA")
    # The artwork sits in a much larger transparent canvas; the mark is what
    # matters, so it is cropped to itself before being placed.
    mark = mark.crop(mark.split()[3].getbbox())
    height = int(MARK_HEIGHT * s)
    width = round(height * mark.width / mark.height)
    mark = mark.resize((width, height), Image.LANCZOS)
    tile.alpha_composite(mark, ((s - width) // 2, (s - height) // 2))

    half = stroke // 2
    ImageDraw.Draw(tile).rounded_rectangle(
        [half, half, s - 1 - half, s - 1 - half],
        radius=radius - half, outline=NEON, width=stroke,
    )
    return tile.resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == "__main__":
    if not ART.exists():
        raise SystemExit(f"the artwork is missing: {ART}")
    icon = build()
    icon.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)}  {icon.size[0]}x{icon.size[1]}")
    print('next: npm run tauri icon "src-tauri/icons/icon-master.png"')
