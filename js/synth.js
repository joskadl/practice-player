/**
 * Thin FluidSynth (js-synthesizer) wrapper — choir/GM playback, no JI retune.
 */

function loadScriptOnce(src) {
  const existing = document.querySelector(`script[data-pp-src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === "1") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.ppSrc = src;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export class ChoirSynth {
  constructor() {
    this.ctx = null;
    this.synth = null;
    this.node = null;
    this.sfontId = null;
    this.program = 52;
    this._initPromise = null;
    this._holds = new Map();
  }

  async ensure() {
    if (this.synth && this.sfontId != null) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    if (!this._initPromise) this._initPromise = this._init();
    await this._initPromise;
  }

  async _init() {
    this.ctx = new AudioContext();
    await loadScriptOnce("./vendor/libfluidsynth-2.4.6.js");
    await loadScriptOnce("./vendor/js-synthesizer.min.js");
    if (typeof JSSynth === "undefined") throw new Error("js-synthesizer failed to load");
    await JSSynth.waitForReady();
    await this.ctx.audioWorklet.addModule("./vendor/libfluidsynth-2.4.6.js");
    await this.ctx.audioWorklet.addModule("./vendor/js-synthesizer.worklet.min.js");

    this.synth = new JSSynth.AudioWorkletNodeSynthesizer();
    this.synth.init(this.ctx.sampleRate);
    this.node = this.synth.createAudioNode(this.ctx);
    this.synth.setGain(0.85);
    this.node.connect(this.ctx.destination);

    const res = await fetch("./soundfonts/TimGM6mb.sf2");
    if (!res.ok) throw new Error(`Soundfont load failed (${res.status})`);
    this.sfontId = await this.synth.loadSFont(await res.arrayBuffer());
    this._applyProgram();
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setProgram(program) {
    this.program = Math.max(0, Math.min(127, program | 0));
    if (this.synth && this.sfontId != null) this._applyProgram();
  }

  _applyProgram() {
    for (let ch = 0; ch < 16; ch++) {
      if (ch === 9) {
        this.synth.setChannelType(ch, true);
        continue;
      }
      this.synth.midiProgramSelect(ch, this.sfontId, 0, this.program);
    }
  }

  /** Apply GM RPN pitch-bend sensitivity (semitones) on melodic channels. */
  setPitchBendRange(semitones, channelRanges = null) {
    if (!this.synth) return;
    const fallback = Math.max(1, Math.min(96, semitones | 0));
    for (let ch = 0; ch < 16; ch++) {
      if (ch === 9) continue;
      const range =
        channelRanges && channelRanges[ch] != null
          ? Math.max(1, Math.min(96, channelRanges[ch] | 0))
          : fallback;
      this.synth.midiPitchWheelSensitivity(ch, range);
    }
  }

  /** 14-bit unsigned pitch bend (0..16383), center 8192. */
  pitchBend(channel, value14) {
    if (!this.synth) return;
    const ch = channel & 0x0f;
    const v = Math.max(0, Math.min(16383, value14 | 0));
    this.synth.midiPitchBend(ch, v);
  }

  resetPitchBends() {
    for (let ch = 0; ch < 16; ch++) this.pitchBend(ch, 8192);
  }

  noteOn(channel, note, velocity) {
    if (!this.synth) return;
    const ch = channel & 0x0f;
    const key = `${ch}:${note}`;
    const prev = this._holds.get(key) || 0;
    this._holds.set(key, prev + 1);
    this.synth.midiNoteOn(ch, note, Math.max(1, Math.min(127, velocity | 0)));
  }

  noteOff(channel, note, { force = false } = {}) {
    if (!this.synth) return;
    const ch = channel & 0x0f;
    const key = `${ch}:${note}`;
    if (force) {
      this._holds.delete(key);
      this.synth.midiNoteOff(ch, note);
      return;
    }
    const next = (this._holds.get(key) || 0) - 1;
    if (next <= 0) {
      this._holds.delete(key);
      this.synth.midiNoteOff(ch, note);
    } else {
      this._holds.set(key, next);
    }
  }

  allNotesOff() {
    if (!this.synth) return;
    // Prefer whole-synth cut (−1) when the build supports omitting the channel.
    try {
      this.synth.midiAllNotesOff();
      this.synth.midiAllSoundsOff();
    } catch {
      for (let ch = 0; ch < 16; ch++) {
        this.synth.midiAllNotesOff(ch);
        try {
          this.synth.midiAllSoundsOff(ch);
        } catch {
          /* older builds may lack allSoundsOff */
        }
      }
    }
    this._holds.clear();
  }

  /**
   * Hard stop for stuck notes: force every tracked key off, then CC / All Sound Off.
   * Safe to call when nothing is playing.
   */
  panic() {
    if (!this.synth) {
      this._holds.clear();
      return;
    }
    for (const key of [...this._holds.keys()]) {
      const [chStr, noteStr] = key.split(":");
      this.noteOff(Number(chStr), Number(noteStr), { force: true });
    }
    this._holds.clear();
    for (let ch = 0; ch < 16; ch++) {
      try {
        // CC 120 All Sound Off, CC 123 All Notes Off (GM)
        this.synth.midiControl(ch, 120, 0);
        this.synth.midiControl(ch, 123, 0);
      } catch {
        /* ignore */
      }
    }
    this.allNotesOff();
    this.resetPitchBends();
  }

  now() {
    return this.ctx?.currentTime ?? performance.now() / 1000;
  }
}
