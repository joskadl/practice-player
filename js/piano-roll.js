/** Channel colours (same idea as JustPlay Retune). */
export const CHANNEL_COLORS = [
  "#5b8def",
  "#e07a5f",
  "#81b29a",
  "#f2cc8f",
  "#9b5de5",
  "#00bbf9",
  "#f15bb5",
  "#fee440",
  "#00f5d4",
  "#9b2226",
  "#457b9d",
  "#e9c46a",
  "#2a9d8f",
  "#e76f51",
  "#264653",
  "#a8dadc",
];

export function channelColor(channel) {
  return CHANNEL_COLORS[(channel ?? 0) % CHANNEL_COLORS.length];
}

/**
 * Piano-roll canvas: notes by pitch vs time, channel colours, click-to-seek.
 */
export class PianoRoll {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{
   *   isNoteAudible: (note: object) => boolean,
   *   onSeek: (tick: number) => void,
   * }} opts
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts;
    this.project = null;
    this.playheadTick = 0;
    this._minNote = 36;
    this._maxNote = 84;
    this.canvas.addEventListener("click", (ev) => this._onClick(ev));
    this.canvas.addEventListener("keydown", (ev) => this._onKey(ev));
    window.addEventListener("resize", () => this.draw());
  }

  setProject(project) {
    this.project = project;
    this.playheadTick = 0;
    if (project?.notes?.length) {
      let lo = 127;
      let hi = 0;
      for (const n of project.notes) {
        lo = Math.min(lo, n.note);
        hi = Math.max(hi, n.note);
      }
      // Pad a bit so notes aren't glued to the edges.
      this._minNote = Math.max(0, lo - 2);
      this._maxNote = Math.min(127, hi + 2);
      if (this._maxNote <= this._minNote) this._maxNote = this._minNote + 1;
    } else {
      this._minNote = 36;
      this._maxNote = 84;
    }
    this.draw();
  }

  setPlayhead(tick) {
    this.playheadTick = tick | 0;
    this.draw();
  }

  draw() {
    const canvas = this.canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssW = Math.max(1, Math.floor(canvas.getBoundingClientRect().width));
    const cssH = Math.max(1, Math.floor(canvas.getBoundingClientRect().height || 220));
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#1a1d22";
    ctx.fillRect(0, 0, cssW, cssH);

    if (!this.project?.notes?.length) {
      ctx.fillStyle = "#8a9099";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("Load a MIDI file to see the piano roll — click to seek.", 14, cssH / 2);
      return;
    }

    const len = Math.max(1, this.project.durationTicks);
    const noteSpan = this._maxNote - this._minNote + 1;
    const topPad = 8;
    const bottomPad = 8;
    const noteH = cssH - topPad - bottomPad;

    // Light pitch guidelines every octave.
    ctx.strokeStyle = "#2a3038";
    ctx.lineWidth = 1;
    for (let note = this._minNote; note <= this._maxNote; note++) {
      if (note % 12 !== 0) continue;
      const y = topPad + noteH - ((note - this._minNote) / noteSpan) * noteH;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
    }

    for (const n of this.project.notes) {
      const x0 = (n.start / len) * cssW;
      const x1 = (n.end / len) * cssW;
      const y = topPad + noteH - ((n.note - this._minNote) / noteSpan) * noteH;
      const gain =
        typeof this.opts.noteGain === "function" ? this.opts.noteGain(n) : this.opts.isNoteAudible(n) ? 1 : 0;
      ctx.fillStyle =
        gain > 0
          ? typeof this.opts.noteColor === "function"
            ? this.opts.noteColor(n)
            : channelColor(n.channel)
          : "#3a4048";
      ctx.globalAlpha = gain <= 0 ? 0.35 : 0.35 + 0.65 * Math.min(1, gain);
      const barH = Math.max(4, Math.min(10, noteH / noteSpan + 2));
      ctx.fillRect(x0, y - barH / 2, Math.max(2, x1 - x0), barH);
      ctx.globalAlpha = 1;
    }

    const px = (this.playheadTick / len) * cssW;
    ctx.strokeStyle = "#ff5555";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, cssH);
    ctx.stroke();
  }

  _tickFromClientX(clientX) {
    if (!this.project) return 0;
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const len = Math.max(1, this.project.durationTicks);
    return Math.round((x / rect.width) * len);
  }

  _onClick(ev) {
    if (!this.project) return;
    const tick = this._tickFromClientX(ev.clientX);
    this.opts.onSeek(tick);
  }

  _onKey(ev) {
    if (!this.project) return;
    // Arrow onset skip is handled globally in main.js so it works without canvas focus.
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") return;
    const step = Math.max(1, Math.round(this.project.ticksPerBeat / 4));
    if (ev.key === "Home") {
      ev.preventDefault();
      this.opts.onSeek(0);
    } else if (ev.key === "End") {
      ev.preventDefault();
      this.opts.onSeek(this.project.durationTicks);
    } else if (ev.key === "," || ev.key === "<") {
      ev.preventDefault();
      this.opts.onSeek(Math.max(0, this.playheadTick - step));
    } else if (ev.key === "." || ev.key === ">") {
      ev.preventDefault();
      this.opts.onSeek(Math.min(this.project.durationTicks, this.playheadTick + step));
    }
  }
}
