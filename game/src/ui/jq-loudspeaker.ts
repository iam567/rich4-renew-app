/**
 * 激情歲月's loudspeakers (docs/rules/24 §9): the era's broadcast sound, made with Web Audio on the effect bus (the
 * effect volume and the mute; at most 0.12, the sirens' and the rain's level). Everything here is ORIGINAL music
 * written for the remake: no 樣板戲 aria, no 《東方紅》, no old recording, no melody copied from anything (§9.1) — a
 * 3-second 廣播站 jingle (a bugle-like fanfare and a glockenspiel), opera-flavoured phrases (a 京胡-like bowed saw
 * gliding over a pentatonic scale, the 板鼓 / 鑼 / 鈸 percussion patterns), a brisk march for the 廣播體操 and a
 * dance tune for the 忠字舞. All of it goes through the loudspeaker filter: band 300–3,400 Hz, a little distortion,
 * the echo of the next horn (120–250 ms), panned by where the horn is on screen and duller farther away.
 *
 * The spoken announcements are not voiced (the system voices may not be shipped, §9.2): their texts show as banners
 * (ui/jq-street.ts). Purely decorative, never touches the rules; muted under dialogs and while the page is hidden.
 */
import { audio } from './audio';
import { prng } from './kb-crowd';

/** The loudest the loudspeakers get (the weather's rain bed is about 0.15 at full rain). */
const LEVEL = 0.12;
/** The pentatonic scale (宮商角徵羽 from D): semitones over D4. */
const PENTA = [0, 2, 4, 7, 9];
const D4 = 293.66;
const hz = (step: number) => D4 * Math.pow(2, (Math.floor(step / 5) * 12 + PENTA[((step % 5) + 5) % 5]) / 12);

type Ctx = AudioContext;

/** The loudspeaker filter: input → band 300–3,400 Hz → soft clipping → dry + echo → level → pan → the effect bus. */
class Horn {
  readonly input: GainNode;
  private readonly level: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly pan: StereoPannerNode | null;
  constructor(readonly ctx: Ctx, out: AudioNode) {
    this.input = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300; hp.Q.value = 0.8;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 3400; this.lp.Q.value = 0.9;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(2.4 * x) / Math.tanh(2.4); }
    shaper.curve = curve;
    const echo = ctx.createDelay(1); echo.delayTime.value = 0.18;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.38;
    this.level = ctx.createGain(); this.level.gain.value = 0;
    try { this.pan = ctx.createStereoPanner(); } catch { this.pan = null; }
    this.input.connect(hp).connect(this.lp).connect(shaper);
    shaper.connect(this.level);
    shaper.connect(echo); echo.connect(fb).connect(echo); echo.connect(wet).connect(this.level);
    if (this.pan) this.level.connect(this.pan).connect(out); else this.level.connect(out);
  }
  /** Loudness 0..1 (× LEVEL), pan −1..1, `dull` 0..1 (farther: duller). */
  set(v: number, pan: number, dull: number) {
    const t = this.ctx.currentTime;
    this.level.gain.setTargetAtTime(LEVEL * Math.max(0, Math.min(1, v)), t, 0.25);
    this.pan?.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, pan)), t, 0.25);
    this.lp.frequency.setTargetAtTime(3400 / (1 + 2 * Math.max(0, dull)), t, 0.3);
  }
  close() { try { this.level.disconnect(); this.pan?.disconnect(); } catch { /* gone */ } }
}

// ------------------------------------------------------------------ instruments (each note scheduled at time t)

function env(ctx: Ctx, t: number, a: number, peak: number, d: number, sustain = 0): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
  return g;
}

/** A bugle-like brass note (square + saw, a little vibrato). */
function brass(ctx: Ctx, out: AudioNode, t: number, f: number, dur: number, v = 0.5) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.03); g.gain.setValueAtTime(v * 0.8, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(2600, t + 0.06); lp.frequency.linearRampToValueAtTime(1500, t + dur);
  for (const [type, k] of [['square', 0.5], ['sawtooth', 0.5]] as const) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = type === 'square' ? -6 : 6;
    const m = ctx.createGain(); m.gain.value = k;
    o.connect(m).connect(lp); o.start(t); o.stop(t + dur + 0.05);
  }
  lp.connect(g).connect(out);
}

/** A glockenspiel strike (two sine partials, quick decay). */
function bell(ctx: Ctx, out: AudioNode, t: number, f: number, v = 0.35) {
  for (const [k, a] of [[1, 1], [2.76, 0.35]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * k;
    const g = env(ctx, t, 0.004, v * a, 0.9);
    o.connect(g).connect(out); o.start(t); o.stop(t + 1);
  }
}

/** A short noise source (for the drums and cymbals). */
let noiseBuf: AudioBuffer | null = null;
function noise(ctx: Ctx): AudioBufferSourceNode {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0), r = prng(0x6a71);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  return s;
}

/** 板鼓: a dry, high wooden click. */
function clap(ctx: Ctx, out: AudioNode, t: number, v = 0.5) {
  const s = noise(ctx), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 3;
  const g = env(ctx, t, 0.002, v, 0.05);
  s.connect(bp).connect(g).connect(out); s.start(t); s.stop(t + 0.1);
}

/** 鑼: a gong swooping down a little, with its hiss. */
function gong(ctx: Ctx, out: AudioNode, t: number, v = 0.45, small = false) {
  const o = ctx.createOscillator(); o.type = 'triangle';
  const f0 = small ? 620 : 300;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (small ? 1.12 : 0.82), t + 0.5);
  const g = env(ctx, t, 0.005, v, small ? 0.5 : 1.3);
  o.connect(g).connect(out); o.start(t); o.stop(t + 1.5);
  const s = noise(ctx), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = small ? 3000 : 1600; bp.Q.value = 1.2;
  const gn = env(ctx, t, 0.003, v * 0.3, small ? 0.3 : 0.8);
  s.connect(bp).connect(gn).connect(out); s.start(t); s.stop(t + 1);
}

/** 鈸: a splashy cymbal. */
function cymbal(ctx: Ctx, out: AudioNode, t: number, v = 0.3) {
  const s = noise(ctx), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
  const g = env(ctx, t, 0.002, v, 0.45);
  s.connect(hp).connect(g).connect(out); s.start(t); s.stop(t + 0.6);
}

/** A bowed two-string fiddle line (京胡-like): a bright saw through a nasal band, vibrato, gliding between notes. */
function fiddle(ctx: Ctx, out: AudioNode, t: number, notes: { f: number; d: number }[], v = 0.32) {
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  const vib = ctx.createOscillator(); vib.frequency.value = 5.6;
  const vibG = ctx.createGain(); vibG.gain.value = 9;
  vib.connect(vibG).connect(o.detune);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.6;
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
  let at = t;
  for (const [i, n] of notes.entries()) {
    if (i === 0) o.frequency.setValueAtTime(n.f, at); else o.frequency.setTargetAtTime(n.f, at, 0.035);   // the glide
    g.gain.setTargetAtTime(v, at, 0.02); g.gain.setTargetAtTime(v * 0.72, at + n.d * 0.5, 0.08);
    at += n.d;
  }
  g.gain.setTargetAtTime(0, at, 0.05);
  o.connect(bp).connect(g).connect(out);
  o.start(t); vib.start(t); o.stop(at + 0.4); vib.stop(at + 0.4);
  return at;
}

/** A plucked chord tone (the march's accompaniment). */
function pluck(ctx: Ctx, out: AudioNode, t: number, f: number, v = 0.25) {
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
  const g = env(ctx, t, 0.004, v, 0.22);
  o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + 0.3);
}

// ------------------------------------------------------------------ pieces (original; seconds from t)

/** The 廣播站's 3-second jingle (§9.2: a fanfare and the glockenspiel, nothing borrowed). Returns its length. */
export function jingle(ctx: Ctx, out: AudioNode, t: number, short = false): number {
  // C major arpeggio up and a held top note, answered by the glockenspiel.
  const C = 261.63, notes: [number, number][] = short
    ? [[C * 1.5, 0.16], [C * 2, 0.16], [C * 2.5, 0.5]]
    : [[C, 0.18], [C * 1.25, 0.18], [C * 1.5, 0.18], [C * 2, 0.36], [C * 1.5, 0.18], [C * 2, 0.18], [C * 2.5, 0.9]];
  let at = t;
  for (const [f, d] of notes) { brass(ctx, out, at, f, d * 0.95, 0.42); at += d; }
  const bells = short ? [C * 4, C * 5] : [C * 4, C * 5, C * 6, C * 8];
  bells.forEach((f, i) => bell(ctx, out, at - 0.1 + i * 0.14, f));
  return at - t + bells.length * 0.14 + 0.4;
}

/**
 * An opera-flavoured passage (§9.2 b): a 鑼鼓 opening (板鼓 rolls, 鑼, 鈸), then the fiddle over the pentatonic scale in
 * four-bar phrases of its own (a random walk drawn from `seed`), the percussion keeping time; about `len` seconds.
 */
export function opera(ctx: Ctx, out: AudioNode, t: number, len: number, seed: number): number {
  const r = prng(seed), beat = 60 / 120;
  // The opening: a roll accelerating, the big gong, the cymbals answering.
  let at = t;
  for (let i = 0; i < 8; i++) { clap(ctx, out, at, 0.35 + i * 0.03); at += 0.16 - i * 0.012; }
  gong(ctx, out, at, 0.5); cymbal(ctx, out, at + beat, 0.3); gong(ctx, out, at + beat * 1.5, 0.3, true); cymbal(ctx, out, at + beat * 2, 0.3);
  at += beat * 3;
  const end = t + len;
  let step = 7;
  while (at < end - 2) {
    // One phrase: 8–12 notes, rhythm from a few cells, ending held on 宮 or 徵.
    const notes: { f: number; d: number }[] = [];
    const n = 8 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      step = Math.max(3, Math.min(13, step + [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)]));
      const d = [0.25, 0.25, 0.5, 0.5, 0.75, 1][Math.floor(r() * 6)] * beat;
      notes.push({ f: hz(step), d });
    }
    notes.push({ f: hz(r() < 0.5 ? 5 : 8), d: beat * 2 });
    const phraseEnd = fiddle(ctx, out, at, notes);
    // 板鼓 on the beats, a small gong every bar, the cymbal at the phrase's end.
    for (let b = at, k = 0; b < phraseEnd; b += beat, k++) { clap(ctx, out, b, k % 2 ? 0.22 : 0.32); if (k % 4 === 3) gong(ctx, out, b, 0.2, true); }
    cymbal(ctx, out, phraseEnd - beat * 0.5, 0.25);
    at = phraseEnd + beat;
  }
  gong(ctx, out, at, 0.45);
  return at - t + 1.5;
}

/** A brisk 2/4 march for the 廣播體操 (§8.3): bass and chord on the beats, a bright tune, a woodblock counting 1–8. */
export function march(ctx: Ctx, out: AudioNode, t: number, len: number, seed: number): number {
  const r = prng(seed), beat = 60 / 132;
  const roots = [261.63, 196, 220, 174.61];   // C, G, A, F (a plain progression)
  let at = t, k = 0;
  while (at < t + len) {
    const root = roots[Math.floor(k / 8) % roots.length];
    pluck(ctx, out, at, root / 2, 0.3);
    pluck(ctx, out, at + beat / 2, root, 0.18); pluck(ctx, out, at + beat / 2, root * 1.25, 0.14); pluck(ctx, out, at + beat / 2, root * 1.5, 0.14);
    clap(ctx, out, at, k % 8 === 0 ? 0.45 : 0.25);
    if (k % 2 === 0) brass(ctx, out, at, root * [2, 2.5, 3, 2.5][Math.floor(r() * 4)], beat * 0.9, 0.22);
    at += beat; k++;
  }
  return at - t;
}

/** A merry tune for the 忠字舞 (§8.3): the fiddle in quick even notes over drum and small gong. */
export function dance(ctx: Ctx, out: AudioNode, t: number, len: number, seed: number): number {
  const r = prng(seed), beat = 60 / 140;
  let at = t, step = 5;
  while (at < t + len) {
    const notes: { f: number; d: number }[] = [];
    for (let i = 0; i < 8; i++) { step = Math.max(2, Math.min(12, step + [-1, 1, 1, -2, 2, 0][Math.floor(r() * 6)])); notes.push({ f: hz(step), d: beat / 2 }); }
    const e = fiddle(ctx, out, at, notes, 0.28);
    for (let b = at, i = 0; b < e; b += beat / 2, i++) { if (i % 2 === 0) clap(ctx, out, b, 0.3); if (i % 4 === 2) gong(ctx, out, b, 0.18, true); }
    at = e;
  }
  return at - t;
}

/** Whooshes and the time-travel tones of the intro (screens/jq-intro.ts), straight on the effect bus (no horn). */
export function sweep(ctx: Ctx, out: AudioNode, t: number, from: number, to: number, dur: number, v = 0.12, type: OscillatorType = 'sine') {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.2); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}
export function hiss(ctx: Ctx, out: AudioNode, t: number, dur: number, v = 0.1) {
  const s = noise(ctx), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
  bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3500, t + dur * 0.6); bp.frequency.exponentialRampToValueAtTime(600, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
  s.connect(bp).connect(g).connect(out); s.start(t); s.stop(t + dur + 0.05);
}

// ------------------------------------------------------------------ the loudspeakers

export type Program = 'opera' | 'march' | 'dance';

/**
 * The map's horns as one source: a program is a jingle, then (the banner's announcement) the music. The street
 * (ui/jq-street.ts) says where the nearest horn is on screen each frame (`place`) and whether it may sound (`on`).
 */
export class Loudspeakers {
  private horn: Horn | null = null;
  private busyUntil = 0;
  private seed = 1;

  private ensure(): Horn | null {
    if (this.horn) return this.horn;
    const a = audio.ambience();
    if (!a || a.ctx.state !== 'running') return null;
    this.horn = new Horn(a.ctx, a.out);
    return this.horn;
  }

  /** Whether a program is still playing. */
  busy(): boolean { const h = this.horn; return !!h && h.ctx.currentTime < this.busyUntil; }

  /** Plays a program now (the jingle, then the music of `kind` for about `len` s). Returns its length (0: no sound). */
  play(kind: Program, len: number): number {
    const h = this.ensure();
    if (!h) return 0;
    const t = h.ctx.currentTime + 0.05, j = jingle(h.ctx, h.input, t);
    const seed = (this.seed = (this.seed * 1103515245 + 12345) >>> 0);
    const m = kind === 'opera' ? opera(h.ctx, h.input, t + j + 0.6, len, seed) : kind === 'march' ? march(h.ctx, h.input, t + j + 0.3, len, seed) : dance(h.ctx, h.input, t + j + 0.3, len, seed);
    this.busyUntil = t + j + m + 0.8;
    return j + m;
  }

  /** The 廣播站's jingle alone (a news board, wherever the camera is: full loudness, centred). */
  newsJingle(on: boolean) {
    if (!on) return;
    const a = audio.ambience();
    if (!a || a.ctx.state !== 'running') return;
    // Its own horn at full loudness (the street's is faded out while the board covers the map).
    this.news ??= new Horn(a.ctx, a.out);
    this.news.set(1, 0, 0);
    jingle(a.ctx, this.news.input, a.ctx.currentTime + 0.05, true);
  }
  private news: Horn | null = null;

  /** Where the nearest horn is: 0..1 near, pan, dull; `on` false fades out (a dialog, the setting, hidden page). */
  place(near: number, pan: number, dull: number, on: boolean) { this.horn?.set(on ? near : 0, pan, dull); }

  close() {
    for (const h of [this.horn, this.news]) { if (!h) continue; h.set(0, 0, 0); setTimeout(() => h.close(), 800); }
    this.horn = this.news = null;
  }
}
