#!/usr/bin/env python3
"""ASCII dump of staff relative to detected lines for manual pitch reading."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


def staff_lines(gray: np.ndarray) -> list[int]:
    h, w = gray.shape
    ink = (gray < 140).astype(np.float32)
    row = ink.sum(axis=1)
    sm = np.convolve(row, np.ones(5) / 5, mode="same")
    peaks = []
    for y in range(2, h - 2):
        if sm[y] > sm[y - 1] and sm[y] >= sm[y + 1] and sm[y] > w * 0.12:
            peaks.append((sm[y], y))
    peaks.sort(reverse=True)
    ys = sorted({y for _, y in peaks[:15]})
    # choose 5 with most regular spacing near median gap ~20
    best = None
    from itertools import combinations

    for comb in combinations(ys, 5):
        sp = [comb[k + 1] - comb[k] for k in range(4)]
        if min(sp) < 12 or max(sp) > 40:
            continue
        if max(sp) / min(sp) > 1.45:
            continue
        mean = float(np.mean(sp))
        score = abs(mean - 20) + float(np.std(sp)) * 2
        if best is None or score < best[0]:
            best = (score, list(comb), mean)
    if not best:
        raise RuntimeError(f"no lines in {ys}")
    return best[1]


def dump(path: Path, clef: str = "treble", x0_frac=0.12, step=8):
    im = ImageOps.autocontrast(Image.open(path).convert("L"))
    g = np.array(im)
    lines = staff_lines(g)
    sp = (lines[4] - lines[0]) / 4.0
    h, w = g.shape
    # sample positions relative to staff: ledger below to ledger above
    # positions: steps from bottom line in half-spaces
    positions = list(range(-4, 13))  # D3..A5-ish for treble
    diat = "CDEFGAB"
    if clef == "treble":
        base = 4 * 7 + 2
    else:
        base = 2 * 7 + 4

    def pname(steps: int) -> str:
        idx = base + steps
        return f"{diat[idx % 7]}{idx // 7}"

    print(f"\n===== {path.name} lines={lines} sp={sp:.1f} =====")
    # header
    names = [pname(s) for s in positions[::-1]]
    # for each x, find darkest y near staff and map to nearest position
    x0 = int(w * x0_frac)
    xs = list(range(x0, w - 5, step))
    # build grid: for each staff position, mark ink density
    for s in positions[::-1]:
        y = lines[4] - s * (sp / 2.0)
        row_chars = []
        for x in xs:
            yi = int(round(y))
            if yi < 2 or yi >= h - 2:
                row_chars.append(" ")
                continue
            # local darkness
            patch = g[yi - 2 : yi + 3, x : x + step]
            dark = (patch < 100).mean()
            if dark > 0.35:
                row_chars.append("#")
            elif dark > 0.18:
                row_chars.append("+")
            else:
                row_chars.append(".")
        print(f"{pname(s):3} |" + "".join(row_chars))
    # also list candidate note x positions where column has strong ink off staff-line-only
    print("note candidates (x, pitch, dark):")
    for x in range(x0, w - 4, 2):
        best = None
        for s in positions:
            y = lines[4] - s * (sp / 2.0)
            yi = int(round(y))
            if yi < 2 or yi >= h - 2:
                continue
            # avoid exact staff line pixels: check if near line
            on_line = any(abs(yi - ly) <= 1 for ly in lines)
            patch = g[max(0, yi - 2) : yi + 3, x : x + 6]
            dark = float((patch < 95).mean())
            if on_line:
                dark *= 0.7
            if dark > 0.4 and (best is None or dark > best[0]):
                best = (dark, s, yi)
        if best and best[0] > 0.45:
            # peak local: compare neighbors
            print(f"  x={x:4d} {pname(best[1]):3} dark={best[0]:.2f}")


def main():
    base = Path("examples/_img_crops")
    dump(base / "sop_m1_3.png", step=10)
    dump(base / "clef_ks_0.png", x0_frac=0.25, step=8)
    dump(base / "key_clef.png", x0_frac=0.35, step=10)
    dump(base / "s1S.png", step=12)
    dump(base / "s3S.png", step=12)


if __name__ == "__main__":
    main()
