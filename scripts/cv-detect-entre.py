#!/usr/bin/env python3
"""OpenCV staff-line + notehead detection for Entre crops."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

OUT = Path("examples/_img_crops/dbg/cv")
OUT.mkdir(parents=True, exist_ok=True)


def find_staff_lines(binary: np.ndarray) -> list[int]:
    """binary: ink=255 on white=0, single staff crop."""
    h, w = binary.shape
    # horizontal projection
    row = (binary > 0).sum(axis=1).astype(float)
    # emphasize thin horizontal runs
    # morphological open with horizontal kernel to isolate staff lines
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(40, w // 8), 1))
    lines_img = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    row2 = (lines_img > 0).sum(axis=1).astype(float)
    # peak detect
    thr = max(row2.max() * 0.35, w * 0.15)
    peaks = []
    for y in range(1, h - 1):
        if row2[y] >= thr and row2[y] >= row2[y - 1] and row2[y] >= row2[y + 1]:
            peaks.append(y)
    # merge close
    merged = []
    for y in peaks:
        if merged and y - merged[-1] < 6:
            if row2[y] > row2[merged[-1]]:
                merged[-1] = y
            continue
        merged.append(y)
    if len(merged) >= 5:
        # pick best 5 consecutive by regularity
        best = None
        for i in range(len(merged) - 4):
            cand = merged[i : i + 5]
            sp = [cand[k + 1] - cand[k] for k in range(4)]
            if min(sp) < 8:
                continue
            score = np.std(sp)
            if best is None or score < best[0]:
                best = (score, cand)
        if best:
            return best[1]
    # fallback: top 5 peaks by strength among merged
    scored = sorted(merged, key=lambda y: -row2[y])[:5]
    return sorted(scored)


def pitch_name(y: float, lines: list[int], clef: str) -> str:
    sp = (lines[4] - lines[0]) / 4.0
    steps = int(round((lines[4] - y) / (sp / 2.0)))
    diat = "CDEFGAB"
    if clef == "treble":
        base = 4 * 7 + 2  # E4
    else:
        base = 2 * 7 + 4  # G2
    idx = base + steps
    return f"{diat[idx % 7]}{idx // 7}"


def detect_heads(gray: np.ndarray, lines: list[int], cut_x: int) -> list[tuple[int, int, str, float]]:
    h, w = gray.shape
    sp = (lines[4] - lines[0]) / 4.0
    # erase staff lines
    work = gray.copy()
    for ly in lines:
        y0 = max(0, ly - 1)
        y1 = min(h, ly + 2)
        work[y0:y1, :] = 255
    # binary ink
    _, bw = cv2.threshold(work, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # remove thin vertical stems somewhat
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(3, int(sp * 0.55)), max(2, int(sp * 0.4))))
    opened = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k)
    # components
    n, labels, stats, cents = cv2.connectedComponentsWithStats(opened, connectivity=8)
    heads = []
    for i in range(1, n):
        x, y, bw_, bh, area = stats[i]
        cx, cy = cents[i]
        if cx < cut_x:
            continue
        if area < sp * sp * 0.25 or area > sp * sp * 6:
            continue
        if bw_ < sp * 0.35 or bw_ > sp * 2.8:
            continue
        if bh < sp * 0.25 or bh > sp * 2.2:
            continue
        aspect = bw_ / max(bh, 1)
        if aspect < 0.5 or aspect > 2.8:
            continue
        # circularity-ish
        heads.append((int(cx), int(cy), area, bw_, bh))
    heads.sort()
    # merge near duplicates
    merged = []
    for h_ in heads:
        if (
            merged
            and abs(h_[0] - merged[-1][0]) < sp * 0.45
            and abs(h_[1] - merged[-1][1]) < sp * 0.55
        ):
            if h_[2] > merged[-1][2]:
                merged[-1] = h_
            continue
        merged.append(h_)
    out = []
    for cx, cy, area, bw_, bh in merged:
        out.append((cx, cy, pitch_name(cy, lines, "treble"), float(area)))
    return out


def process(path: Path, clef: str = "treble", cut_frac: float = 0.14):
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        print("fail", path)
        return
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    # mild denoise
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    lines = find_staff_lines(bw)
    if len(lines) < 5:
        print(path.name, "lines fail", lines)
        return
    cut = int(gray.shape[1] * cut_frac)
    # for bass override pitch function via clef param stored
    heads = detect_heads(gray, lines, cut)
    # fix bass pitches
    if clef == "bass":
        heads = [(x, y, pitch_name(y, lines, "bass"), a) for x, y, _, a in heads]

    vis = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    for ly in lines:
        cv2.line(vis, (0, ly), (vis.shape[1], ly), (0, 200, 0), 1)
    cv2.line(vis, (cut, 0), (cut, vis.shape[0]), (255, 0, 0), 1)
    labels = []
    for x, y, p, a in heads:
        cv2.circle(vis, (x, y), 7, (0, 0, 255), 2)
        cv2.putText(vis, p, (x - 10, y - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)
        labels.append(f"{p}@{x}")
    outp = OUT / f"{path.stem}.png"
    cv2.imwrite(str(outp), vis)
    print(f"{path.name}: lines={lines} n={len(heads)}")
    print("  ", " ".join(labels))


def main():
    base = Path("examples/_img_crops")
    for name, clef, cut in [
        ("sop_m1_3.png", "treble", 0.10),
        ("key_clef.png", "treble", 0.40),
        ("clef_ks_0.png", "treble", 0.35),
        ("s1S.png", "treble", 0.14),
        ("s1A.png", "treble", 0.14),
        ("s1T.png", "treble", 0.14),
        ("s1B.png", "bass", 0.14),
        ("s2S.png", "treble", 0.14),
        ("s2A.png", "treble", 0.14),
        ("s2T.png", "treble", 0.14),
        ("s2B.png", "bass", 0.14),
        ("s3S.png", "treble", 0.14),
        ("s3A.png", "treble", 0.14),
        ("s3T.png", "treble", 0.14),
        ("s3B.png", "bass", 0.14),
        ("zoom_s1_staff1.png", "treble", 0.12),
    ]:
        process(base / name, clef, cut)


if __name__ == "__main__":
    main()
