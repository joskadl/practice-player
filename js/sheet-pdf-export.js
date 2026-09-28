/**
 * Export the currently rendered sheet SVG(s) as a black-and-white multi-page PDF.
 * Reflects voice hide, layer toggles, and packed lyric-only layout already in the DOM.
 */

/** A4 portrait in PDF points. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const PAGE_MARGIN = 36;

/**
 * @param {HTMLElement} container sheet-music container
 * @param {{staves?:boolean, lyrics?:boolean, chords?:boolean, notes?:boolean}} layers
 * @returns {SVGSVGElement[]}
 */
export function cloneSheetSvgsForExport(container, layers = {}) {
  const srcSvgs = [...container.querySelectorAll("svg")];
  /** @type {SVGSVGElement[]} */
  const out = [];
  for (const src of srcSvgs) {
    const clone = /** @type {SVGSVGElement} */ (src.cloneNode(true));
    clone
      .querySelectorAll(".osmd-cursor, .cursor, .sheet-inline-edit, .sheet-annot-input")
      .forEach((el) => el.remove());
    bakePackedTransforms(clone, src);
    injectExportStyles(clone, layers);
    forceBlackAndWhite(clone);
    fitCloneToVisibleContent(clone, src, layers);
    out.push(clone);
  }
  return out;
}

/**
 * Convert CSS translateY packing on staffline groups into real SVG transforms
 * so rasterization (which ignores CSS overflow clipping) matches the screen.
 * @param {SVGSVGElement} clone
 * @param {SVGSVGElement} src
 */
function bakePackedTransforms(clone, src) {
  const srcStaffs = [...src.querySelectorAll("g.staffline")];
  const cloneStaffs = [...clone.querySelectorAll("g.staffline")];
  const ctm = src.getScreenCTM?.();
  if (!ctm || typeof src.createSVGPoint !== "function") {
    // Fallback: copy CSS transforms as-is (may not rasterize correctly).
    for (let i = 0; i < srcStaffs.length; i++) {
      const cg = cloneStaffs[i];
      if (!cg) continue;
      if (srcStaffs[i].style.display === "none") cg.setAttribute("display", "none");
      if (srcStaffs[i].style.transform) cg.style.transform = srcStaffs[i].style.transform;
    }
    return;
  }
  const inv = ctm.inverse();
  const pxToSvgY = (dyPx) => {
    const p0 = src.createSVGPoint();
    p0.x = 0;
    p0.y = 0;
    const p1 = src.createSVGPoint();
    p1.x = 0;
    p1.y = dyPx;
    return p1.matrixTransform(inv).y - p0.matrixTransform(inv).y;
  };

  for (let i = 0; i < srcStaffs.length; i++) {
    const sg = srcStaffs[i];
    const cg = cloneStaffs[i];
    if (!cg) continue;
    cg.style.transform = "";
    if (sg.style.display === "none") {
      cg.setAttribute("display", "none");
      continue;
    }
    const m = /translateY\(\s*(-?[\d.]+)\s*px\s*\)/.exec(sg.style.transform || "");
    if (!m) continue;
    const dy = pxToSvgY(Number(m[1]));
    if (!Number.isFinite(dy) || Math.abs(dy) < 1e-6) continue;
    const existing = (cg.getAttribute("transform") || "").trim();
    cg.setAttribute("transform", `${existing} translate(0 ${dy})`.trim());
  }
}

/**
 * @param {SVGSVGElement} svg
 * @param {{staves?:boolean, lyrics?:boolean, chords?:boolean, notes?:boolean}} layers
 */
function injectExportStyles(svg, layers) {
  const staves = layers.staves !== false;
  const lyrics = layers.lyrics !== false;
  const chords = layers.chords !== false;
  const notes = layers.notes !== false;

  const css = `
    svg { background: #ffffff; }
    ${
      staves
        ? ""
        : `
    path, rect, line, polygon, polyline, use, text, tspan, [class*="vf-"] {
      visibility: hidden !important;
    }
    .lyrics, .lyrics *, .dash, .dash *,
    .pp-chord, .pp-chord *, .pp-annot-note, .pp-annot-note * {
      visibility: visible !important;
    }
    `
    }
    ${lyrics ? "" : `.lyrics, .dash { display: none !important; }`}
    ${chords ? "" : `.pp-chord { display: none !important; }`}
    ${notes ? "" : `.pp-annot-note { display: none !important; }`}
    * {
      color: #000000 !important;
      fill: #000000 !important;
      stroke: #000000 !important;
      stop-color: #000000 !important;
    }
    [fill="none"] { fill: none !important; }
    [stroke="none"] { stroke: none !important; }
    [opacity="0"], [fill-opacity="0"] { opacity: 0 !important; }
  `;

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = css;
  svg.insertBefore(style, svg.firstChild);
}

/**
 * @param {SVGSVGElement} svg
 */
function forceBlackAndWhite(svg) {
  const walk = (el) => {
    if (el.nodeType !== 1) return;
    const tag = el.tagName?.toLowerCase?.() || "";
    if (tag === "style" || tag === "script") return;

    for (const attr of ["fill", "stroke", "color", "stop-color"]) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      const low = v.trim().toLowerCase();
      if (low === "none" || low === "transparent" || low === "currentcolor") continue;
      if (low.startsWith("url(")) continue;
      el.setAttribute(attr, "#000000");
    }

    const style = el.getAttribute("style");
    if (style) {
      el.setAttribute(
        "style",
        style
          .replace(/(^|;)\s*fill\s*:\s*(?!none\b)[^;]+/gi, "$1fill:#000000")
          .replace(/(^|;)\s*stroke\s*:\s*(?!none\b)[^;]+/gi, "$1stroke:#000000")
          .replace(/(^|;)\s*color\s*:\s*[^;]+/gi, "$1color:#000000"),
      );
    }

    for (const child of el.children) walk(child);
  };
  walk(svg);
}

/**
 * Tighten viewBox/width/height to the currently visible content.
 * @param {SVGSVGElement} clone
 * @param {SVGSVGElement} src
 * @param {{staves?:boolean, lyrics?:boolean, chords?:boolean, notes?:boolean}} layers
 */
function fitCloneToVisibleContent(clone, src, layers) {
  const ctm = src.getScreenCTM?.();
  const pad = 8;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const stavesOn = layers.staves !== false;
  const selector = stavesOn
    ? null
    : ".lyrics, .dash, .pp-chord, .pp-annot-note";

  /** @type {Element[]} */
  const els = selector
    ? [...src.querySelectorAll(selector)]
    : [src];

  if (ctm && typeof src.createSVGPoint === "function") {
    const inv = ctm.inverse();
    const map = (clientX, clientY) => {
      const p = src.createSVGPoint();
      p.x = clientX;
      p.y = clientY;
      return p.matrixTransform(inv);
    };
    for (const el of els) {
      if (selector && !(el.getBoundingClientRect().width || el.getBoundingClientRect().height)) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 || r.height > 0)) continue;
      const a = map(r.left, r.top);
      const b = map(r.right, r.bottom);
      minX = Math.min(minX, a.x, b.x);
      minY = Math.min(minY, a.y, b.y);
      maxX = Math.max(maxX, a.x, b.x);
      maxY = Math.max(maxY, a.y, b.y);
    }
  }

  if (!(maxX > minX && maxY > minY)) {
    // Fallback to declared size.
    const rect = src.getBoundingClientRect();
    let w = Number(src.getAttribute("width")) || rect.width || 800;
    let h = Number.parseFloat(src.style.height || "") || Number(src.getAttribute("height")) || rect.height || 600;
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
  } else {
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const vbW = maxX - minX;
    const vbH = maxY - minY;
    clone.setAttribute("viewBox", `${minX} ${minY} ${vbW} ${vbH}`);
    // Pixel size: preserve on-screen scale.
    const screenW = Math.max(1, (maxX - minX) * (ctm?.a || 1));
    const screenH = Math.max(1, (maxY - minY) * (ctm?.d || 1));
    clone.setAttribute("width", String(Math.round(screenW)));
    clone.setAttribute("height", String(Math.round(screenH)));
  }

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  clone.style.height = "";
  clone.style.overflow = "";
  clone.style.transform = "";
}

/**
 * @param {SVGSVGElement} svg
 * @param {number} [scale]
 * @returns {Promise<HTMLCanvasElement>}
 */
export function rasterizeSvg(svg, scale = 2) {
  const w = Number(svg.getAttribute("width")) || 800;
  const h = Number(svg.getAttribute("height")) || 600;
  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unsupported");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize sheet SVG"));
    };
    img.src = url;
  });
}

/**
 * @param {HTMLCanvasElement[]} canvases
 * @returns {Blob}
 */
export function canvasesToBwPdf(canvases) {
  const pages = [];
  const contentW = PAGE_W - PAGE_MARGIN * 2;
  const contentH = PAGE_H - PAGE_MARGIN * 2;

  for (const canvas of canvases) {
    if (!(canvas.width > 0 && canvas.height > 0)) continue;
    const scale = contentW / canvas.width;
    const pageSlicePx = Math.max(1, Math.floor(contentH / scale));

    let y = 0;
    while (y < canvas.height) {
      const sliceH = Math.min(pageSlicePx, canvas.height - y);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceH;
      const ctx = slice.getContext("2d");
      if (!ctx) throw new Error("Canvas unsupported");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

      const jpeg = dataUrlToUint8(slice.toDataURL("image/jpeg", 0.93));
      pages.push({
        jpeg,
        imgW: slice.width,
        imgH: slice.height,
        drawW: contentW,
        drawH: sliceH * scale,
      });
      y += sliceH;
    }
  }

  if (!pages.length) throw new Error("Nothing to export");
  return buildJpegPdf(pages);
}

/**
 * @param {string} dataUrl
 * @returns {Uint8Array}
 */
function dataUrlToUint8(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {{jpeg:Uint8Array, imgW:number, imgH:number, drawW:number, drawH:number}[]} pages
 * @returns {Blob}
 */
function buildJpegPdf(pages) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  /** @type {number[]} */
  const offsets = [];
  let pos = 0;
  const enc = new TextEncoder();

  const push = (/** @type {string|Uint8Array} */ part) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    pos += bytes.length;
  };

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  offsets[1] = pos;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const pageObjNums = pages.map((_, i) => 3 + i * 3);
  offsets[2] = pos;
  push(
    `2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [${pageObjNums
      .map((n) => `${n} 0 R`)
      .join(" ")}] >>\nendobj\n`,
  );

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageObj = 3 + i * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;
    const x = PAGE_MARGIN + (PAGE_W - PAGE_MARGIN * 2 - page.drawW) / 2;
    const y = PAGE_H - PAGE_MARGIN - page.drawH;

    offsets[pageObj] = pos;
    push(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /XObject << /Im${i} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`,
    );

    const content =
      `q\n${page.drawW.toFixed(2)} 0 0 ${page.drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im${i} Do\nQ\n`;
    const contentBytes = enc.encode(content);
    offsets[contentObj] = pos;
    push(`${contentObj} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push("endstream\nendobj\n");

    offsets[imageObj] = pos;
    push(
      `${imageObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.imgW} /Height ${page.imgH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
  }

  const xrefPos = pos;
  const maxObj = 2 + pages.length * 3;
  push(`xref\n0 ${maxObj + 1}\n`);
  push("0000000000 65535 f \n");
  for (let i = 1; i <= maxObj; i++) {
    push(`${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return new Blob([out], { type: "application/pdf" });
}

/**
 * @param {Blob} blob
 * @param {string} fileName
 */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   layers?: {staves?:boolean, lyrics?:boolean, chords?:boolean, notes?:boolean},
 *   fileName?: string,
 *   scale?: number,
 * }} [opts]
 */
export async function exportSheetViewPdf(container, opts = {}) {
  const layers = opts.layers || {};
  const scale = opts.scale ?? 2.25;
  const fileName = opts.fileName?.endsWith(".pdf")
    ? opts.fileName
    : `${opts.fileName || "score"}.pdf`;

  const svgs = cloneSheetSvgsForExport(container, layers);
  if (!svgs.length) throw new Error("No sheet music to export");

  /** @type {HTMLCanvasElement[]} */
  const canvases = [];
  for (const svg of svgs) {
    canvases.push(await rasterizeSvg(svg, scale));
  }
  const pdf = canvasesToBwPdf(canvases);
  downloadBlob(pdf, fileName);
  return fileName;
}
