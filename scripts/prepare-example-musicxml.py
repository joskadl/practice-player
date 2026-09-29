#!/usr/bin/env python3
"""Normalize MuseScore MusicXML exports for the published examples set."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"

SATB = ["Soprano", "Alto", "Tenor", "Bass"]
PERSONAL_CREDIT = {
    "composer",
    "lyricist",
    "arranger",
    "translator",
    "poet",
    "librettist",
    "transcriber",
    "encoder",
}

TITLES = {
    "blue-christmas-for-barbershopers.musicxml": "Blue Christmas",
    "gaudete-christus-est-natus.musicxml": "Gaudete, Christus est natus",
    "gloria-in-excelsis-deo-oggi-e-nato-il-salvatore.musicxml": "Gloria in excelsis Deo",
}


def local(tag: str | None) -> str:
    return tag.split("}")[-1] if tag else ""


def children(parent: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in list(parent) if local(c.tag) == name]


def first(parent: ET.Element, name: str) -> ET.Element | None:
    found = children(parent, name)
    return found[0] if found else None


def prepare(path: Path, title: str) -> None:
    text = path.read_text(encoding="utf-8")
    text2 = re.sub(r"<!DOCTYPE[^>]*>", "", text)
    root = ET.fromstring(text2)

    work = first(root, "work")
    if work is None:
        work = ET.Element("work")
        idx = 0
        for i, c in enumerate(list(root)):
            if local(c.tag) in ("movement-title", "identification", "defaults", "part-list"):
                idx = i
                break
        root.insert(idx, work)
    wt = first(work, "work-title")
    if wt is None:
        wt = ET.SubElement(work, "work-title")
    wt.text = title

    mt = first(root, "movement-title")
    if mt is None:
        mt = ET.Element("movement-title")
        kids = list(root)
        root.insert(kids.index(work) + 1, mt)
    mt.text = title

    ident = first(root, "identification")
    if ident is not None:
        for el in children(ident, "creator") + children(ident, "rights") + children(ident, "source"):
            ident.remove(el)
        enc = first(ident, "encoding")
        if enc is not None:
            softwares = children(enc, "software")
            if softwares:
                for sw in softwares:
                    sw.text = "MIDI Practice Player"
            else:
                ET.SubElement(enc, "software").text = "MIDI Practice Player"
        misc = first(ident, "miscellaneous")
        if misc is not None:
            for field in list(children(misc, "miscellaneous-field")):
                name = field.get("name") or ""
                if name in ("platform", "creationDate", "mscVersion") or name.startswith("msc"):
                    misc.remove(field)
            if not list(misc):
                ident.remove(misc)

    for credit in list(children(root, "credit")):
        ctype = first(credit, "credit-type")
        t = (ctype.text or "").strip().lower() if ctype is not None else ""
        if not t or t in PERSONAL_CREDIT:
            root.remove(credit)

    pl = first(root, "part-list")
    if pl is not None:
        parts = children(pl, "score-part")
        for i, sp in enumerate(parts):
            pn = first(sp, "part-name")
            name = (pn.text or "").strip() if pn is not None else ""
            name = re.sub(r"\s+", " / ", name) if name else ""
            if not name:
                name = SATB[i] if i < len(SATB) else f"Voice {i + 1}"
            if pn is None:
                pn = ET.Element("part-name")
                sp.insert(0, pn)
            pn.text = name
            for si in children(sp, "score-instrument"):
                inn = first(si, "instrument-name")
                if inn is not None and not (inn.text or "").strip():
                    inn.text = name

    body = ET.tostring(root, encoding="unicode")
    path.write_text("<?xml version='1.0' encoding='utf-8'?>\n" + body, encoding="utf-8")
    print(f"prepared {path.name}")


def main() -> int:
    targets = sys.argv[1:]
    if targets:
        pairs = []
        for arg in targets:
            p = Path(arg)
            if not p.is_absolute():
                p = (Path.cwd() / p).resolve()
            title = TITLES.get(p.name) or p.stem.replace("-", " ").title()
            pairs.append((p, title))
    else:
        pairs = [(EXAMPLES / name, title) for name, title in TITLES.items()]

    for path, title in pairs:
        if not path.exists():
            print(f"missing {path}", file=sys.stderr)
            return 1
        prepare(path, title)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
