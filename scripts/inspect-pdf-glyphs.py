#!/usr/bin/env python3
import sys
from collections import defaultdict
from pathlib import Path

import fitz

sys.stdout.reconfigure(encoding="utf-8")
NOTEHEAD = 0xE0A4
pdf = fitz.open(r"examples/stille-nacht- bladmuziek (1).pdf")


def glyphs(page):
    out = []
    d = page.get_text("rawdict")
    for b in d["blocks"]:
        if b.get("type") != 0:
            continue
        for l in b.get("lines", []):
            for s in l.get("spans", []):
                for c in s.get("chars", []):
                    ch = c.get("c") or ""
                    if not ch:
                        continue
                    x0, y0, x1, y1 = c["bbox"]
                    out.append(
                        {
                            "cx": (x0 + x1) / 2,
                            "cy": (y0 + y1) / 2,
                            "ord": ord(ch),
                            "font": s.get("font"),
                            "y0": y0,
                            "y1": y1,
                            "x0": x0,
                        }
                    )
    return out


page = pdf[0]
g = glyphs(page)
for o in sorted(set(x["ord"] for x in g if x["font"] == "Leland")):
    xs = [x for x in g if x["ord"] == o]
    if len(xs) <= 40:
        print(hex(o), "count", len(xs), "cy", [round(x["cy"], 1) for x in xs[:8]])

heads = [x for x in g if x["ord"] == NOTEHEAD]
staff1 = sorted([x for x in heads if 120 < x["cy"] < 150], key=lambda z: z["cx"])
print("sop m1-4:")
for x in staff1:
    print(f"  x={x['cx']:.1f} cy={x['cy']:.1f}")

# horizontal staff lines from drawings
ys = defaultdict(float)
for p in page.get_drawings():
    r = p.get("rect")
    if not r:
        continue
    if r.width > 150 and 0.05 < r.height < 1.5:
        ys[round(r.y0, 1)] += r.width
print("strong horizontal lines:")
for y, w in sorted(ys.items(), key=lambda kv: -kv[1])[:30]:
    print(f"  y={y} widthsum={w:.0f}")
