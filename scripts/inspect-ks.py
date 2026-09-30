#!/usr/bin/env python3
"""Inspect key-signature region: sharp vs flat by shape."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps, ImageDraw

def analyze(path: Path, x0_frac=0.08, x1_frac=0.22):
    im = ImageOps.autocontrast(Image.open(path).convert("L"))
    g = np.array(im)
    h, w = g.shape
    # find staff band via horizontal projection
    ink = (g < 130).astype(np.float32)
    row = ink.sum(axis=1)
    # staff roughly where row ink high in middle
    ys = np.where(row > w * 0.08)[0]
    if len(ys) == 0:
        print(path.name, "no staff")
        return
    y0, y1 = int(ys[0]), int(ys[-1])
    # expand a bit
    pad = 10
    y0 = max(0, y0 - pad)
    y1 = min(h, y1 + pad)
    x0 = int(w * x0_frac)
    x1 = int(w * x1_frac)
    region = g[y0:y1, x0:x1]
    # save zoom
    out = Path("examples/_img_crops/dbg") / f"ksreg_{path.stem}.png"
    z = Image.fromarray(region)
    z = z.resize((z.width * 4, z.height * 4), Image.Resampling.NEAREST)
    z.save(out)
    # analyze: for each x column, ink height
    binr = (region < 110).astype(np.uint8)
    col = binr.sum(axis=0)
    # find clusters
    clusters = []
    i = 0
    while i < len(col):
        if col[i] > 2:
            j = i
            while j < len(col) and col[j] > 1:
                j += 1
            width = j - i
            height = int(binr[:, i:j].sum(axis=0).max()) if j > i else 0
            # centroid y of ink in cluster
            sub = binr[:, i:j]
            ys2, xs2 = np.where(sub > 0)
            cy = float(ys2.mean()) if len(ys2) else 0
            clusters.append((i, j, width, height, cy, int(sub.sum())))
            i = j
        else:
            i += 1
    print(f"\n{path.name} staff y={y0}-{y1} ks x={x0}-{x1} -> {out.name}")
    print(f"  clusters (x0,x1,w,h,cy,area):")
    for c in clusters:
        print(f"    {c}")
    # Heuristic: sharp has two vertical strokes close together (narrow tall pairs)
    # flat has one vertical + round body on right, typically mid-staff
    tall = [c for c in clusters if c[3] > (y1 - y0) * 0.35 and c[2] <= 8]
    print(f"  tall-narrow count={len(tall)} (sharps often 2 per accidental)")


base = Path("examples/_img_crops")
for name in [
    "clef_ks_0.png",
    "clef_ks_1.png",
    "clef_ks_2.png",
    "clef_ks_3.png",
    "key_clef.png",
    "sop_m1_3.png",
    "s1S.png",
    "s1A.png",
    "s1T.png",
    "s1B.png",
    "m1_stack.png",
]:
    analyze(base / name)
