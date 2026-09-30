#!/usr/bin/env python3
"""Slice soprano opening into per-note crops for vision."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps, ImageDraw

base = Path("examples/_img_crops")
out = base / "dbg" / "notes"
out.mkdir(parents=True, exist_ok=True)

im = ImageOps.autocontrast(Image.open(base / "sop_m1_3.png").convert("L"))
g = np.array(im)
h, w = g.shape
# staff band
ink = (g < 120).astype(np.float32)
row = ink.sum(axis=1)
ys = np.where(row > w * 0.1)[0]
y0, y1 = max(0, ys[0] - 15), min(h, ys[-1] + 40)  # include lyrics tops
staff = g[y0:y1, :]
# vertical projection skipping left clef/ks
x_start = int(w * 0.12)
proj = (staff[:, x_start:] < 110).sum(axis=0)
# smooth
k = 7
sm = np.convolve(proj.astype(float), np.ones(k) / k, mode="same")
# find peaks
peaks = []
for x in range(2, len(sm) - 2):
    if sm[x] > sm[x - 1] and sm[x] >= sm[x + 1] and sm[x] > sm.mean() * 1.3:
        peaks.append((sm[x], x + x_start))
peaks.sort(reverse=True)
# take top peaks, merge nearby
cands = sorted([x for _, x in peaks[:40]])
merged = []
for x in cands:
    if merged and abs(x - merged[-1]) < 18:
        continue
    merged.append(x)
print("peak xs", merged[:20])

# also save full annotated with peak lines
rgb = Image.open(base / "sop_m1_3.png").convert("RGB")
draw = ImageDraw.Draw(rgb)
for x in merged[:16]:
    draw.line([(x, 0), (x, h)], fill=(255, 0, 0), width=1)
rgb.save(out / "sop_peaks.png")

# save individual windows around each peak
for i, x in enumerate(merged[:14]):
    x0 = max(0, x - 40)
    x1 = min(w, x + 40)
    crop = Image.open(base / "sop_m1_3.png").crop((x0, y0, x1, y1))
    crop = crop.resize((crop.width * 3, crop.height * 3), Image.Resampling.LANCZOS)
    crop.save(out / f"sop_n{i:02d}_x{x}.png")
    print(f"saved note {i} at x={x}")

# key signature only crop
ks = Image.open(base / "sop_m1_3.png").crop((0, y0, int(w * 0.14), y1))
ks = ks.resize((ks.width * 4, ks.height * 4), Image.Resampling.NEAREST)
ks.save(out / "sop_ks_only.png")

# Also slice s1S into measure-ish thirds
im2 = Image.open(base / "s1S.png")
w2, h2 = im2.size
for i, (a, b) in enumerate([(0, 0.25), (0.2, 0.45), (0.4, 0.65), (0.6, 0.85), (0.8, 1.0)]):
    c = im2.crop((int(w2 * a), 0, int(w2 * b), h2))
    c = ImageOps.autocontrast(c.convert("L")).convert("RGB")
    c = c.resize((c.width * 2, c.height * 2), Image.Resampling.LANCZOS)
    c.save(out / f"s1S_mish{i}.png")
