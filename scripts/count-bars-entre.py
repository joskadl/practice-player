#!/usr/bin/env python3
"""Detect barlines and per-bar ink clusters on s2/s3 voice crops."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

OUT = Path("examples/_img_crops/dbg/sys23")


def analyze(path: Path, cut_frac=0.12):
    im = ImageOps.autocontrast(Image.open(path).convert("L"))
    g = np.array(im)
    h, w = g.shape
    ink = (g < 110).astype(np.float32)
    # vertical projection
    col = ink.sum(axis=0)
    # staff band rows
    row = ink.sum(axis=1)
    ys = np.where(row > w * 0.08)[0]
    y0, y1 = int(ys[0]), int(ys[-1])
    band = ink[y0:y1, :]
    # barline candidates: tall thin columns spanning most of staff height
    bh = y1 - y0
    bar_x = []
    i = int(w * cut_frac)
    while i < w - 2:
        # column darkness and height span
        c = band[:, i]
        if c.sum() > bh * 0.55:
            # thin peak
            j = i
            while j < w and band[:, j].sum() > bh * 0.4:
                j += 1
            width = j - i
            if 1 <= width <= 6:
                bar_x.append((i + j) // 2)
            i = j
        else:
            i += 1
    # merge close
    merged = []
    for x in bar_x:
        if merged and x - merged[-1] < 25:
            continue
        merged.append(x)
    print(f"\n=== {path.name} bars={len(merged)} xs={merged} ===")
    # measure widths
    xs = [int(w * cut_frac)] + merged + [w - 1]
    for mi in range(len(xs) - 1):
        a, b = xs[mi], xs[mi + 1]
        width = b - a
        # count dark blobs roughly by local maxima of column sum in measure
        seg = band[:, a:b]
        proj = seg.sum(axis=0)
        # smooth
        if len(proj) < 5:
            continue
        sm = np.convolve(proj, np.ones(5) / 5, mode="same")
        peaks = []
        thr = sm.mean() * 1.4
        for x in range(2, len(sm) - 2):
            if sm[x] > thr and sm[x] >= sm[x - 1] and sm[x] >= sm[x + 1]:
                if peaks and x - peaks[-1] < 12:
                    continue
                peaks.append(x)
        print(f"  bar{mi}: x={a}-{b} width={width}px ~ink_peaks={len(peaks)}")
    # annotate
    rgb = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(rgb)
    for x in merged:
        draw.line([(x, 0), (x, h)], fill=(255, 0, 0), width=2)
    out = OUT / f"bars_{path.stem}.png"
    rgb.save(out)
    print("saved", out)


def main():
    base = Path("examples/_img_crops")
    for name in [
        "s2S.png",
        "s2A.png",
        "s2T.png",
        "s2B.png",
        "s3S.png",
        "s3A.png",
        "s3T.png",
        "s3B.png",
    ]:
        analyze(base / name)


if __name__ == "__main__":
    main()
