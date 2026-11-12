"""Regenerate runtime WebP icons from preserved PNGs. Requires Pillow."""
from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parents[1] / 'assets'
for source in sorted(assets.glob('board_icon_start_*.png')):
    with Image.open(source) as image:
        image.save(source.with_suffix('.webp'), quality=90, method=6, exact=True)
