"""Genera le icone PNG del progetto a partire dal design di public/favicon.svg.

Renderizza in PIL a 1024x1024 con supersampling, poi downscaling LANCZOS verso
le size target. Il design e` 1:1 col favicon.svg (stessi colori, stesse coords
in viewBox 0..64, semplicemente moltiplicate per S = size/64).

Output:
  - public/favicon-16.png         16x16  (favicon piccolo per bookmark list)
  - public/favicon-32.png         32x32  (favicon standard tab/url bar fallback)
  - public/apple-touch-icon.png   180x180 (iOS "Aggiungi a Home" + Favoriti)
  - public/icon-192.png           192x192 (Android / PWA manifest)
  - public/icon-512.png           512x512 (Android / PWA splash + maskable)

Note:
  - PNG opachi (RGB no alpha) → richiesto da iOS Safari per apple-touch-icon
  - Niente rounded corners: iOS/Android applicano il proprio mask (squircle,
    cerchio, ecc.) — un PNG "square" e` la scelta corretta.
"""
from PIL import Image, ImageDraw
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

# Colori dalla favicon.svg
BG       = "#2b3c24"  # sfondo verde oliva scuro
CREMA    = "#faf8f3"  # corpo calendario
HEADER   = "#456b3a"  # verde olive medio (header calendario + giorni)
HOOK     = "#e0e8d8"  # ganci + giorni "vuoti"
DAY_FULL = "#9ab488"  # giorni "pieni" della griglia
ROSSO    = "#b91c1c"  # croce medica
WHITE    = "#faf8f3"  # croce interna (= crema)


def render(supersample=1024):
    """Renderizza il design SVG a `supersample` px. Tutte le coords del SVG
    sono in viewBox 0..64, quindi le moltiplico per S = supersample/64."""
    S = supersample / 64.0
    img = Image.new("RGB", (supersample, supersample), color=BG)
    draw = ImageDraw.Draw(img)

    def rect(x, y, w, h, color, rx=0):
        bbox = [(x * S, y * S), ((x + w) * S, (y + h) * S)]
        if rx > 0:
            draw.rounded_rectangle(bbox, radius=rx * S, fill=color)
        else:
            draw.rectangle(bbox, fill=color)

    def circle(cx, cy, r, color):
        bbox = [((cx - r) * S, (cy - r) * S), ((cx + r) * S, (cy + r) * S)]
        draw.ellipse(bbox, fill=color)

    # ── Calendario: corpo crema ───────────────────────────────────────
    rect(10, 16, 44, 36, CREMA, rx=5)

    # ── Header verde olive: rect rounded + rect flat sul fondo ────────
    # (il secondo "chiude" la curvatura inferiore del header così la giunta
    #  col corpo crema è netta)
    rect(10, 16, 44, 13, HEADER, rx=5)
    rect(10, 22, 44, 7, HEADER)

    # ── Ganci sopra il calendario ─────────────────────────────────────
    rect(20, 11, 5, 10, HOOK, rx=2.5)
    rect(39, 11, 5, 10, HOOK, rx=2.5)

    # ── Griglia giorni (riga 1) ───────────────────────────────────────
    rect(16, 36, 6, 5, DAY_FULL, rx=1.5)
    rect(26, 36, 6, 5, DAY_FULL, rx=1.5)
    rect(36, 36, 6, 5, HOOK,     rx=1.5)
    rect(46, 36, 6, 5, DAY_FULL, rx=1.5)

    # ── Griglia giorni (riga 2) ───────────────────────────────────────
    rect(16, 44, 6, 5, HOOK,     rx=1.5)
    rect(26, 44, 6, 5, DAY_FULL, rx=1.5)
    rect(36, 44, 6, 5, DAY_FULL, rx=1.5)
    rect(46, 44, 6, 5, HOOK,     rx=1.5)

    # ── Croce medica rossa: cerchio + due rect a "+" ──────────────────
    circle(46, 26, 7, ROSSO)
    rect(43.5, 22, 5, 8, WHITE, rx=1.5)
    rect(42,   23.5, 8, 5, WHITE, rx=1.5)

    return img


def main():
    master = render(1024)
    targets = [
        (16,  "favicon-16.png"),
        (32,  "favicon-32.png"),
        (180, "apple-touch-icon.png"),
        (192, "icon-192.png"),
        (512, "icon-512.png"),
    ]
    for size, name in targets:
        out = master.resize((size, size), Image.LANCZOS) if size != 1024 else master
        path = PUBLIC / name
        out.save(path, "PNG", optimize=True)
        print(f"  OK {name:30s} {size}x{size}  ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
