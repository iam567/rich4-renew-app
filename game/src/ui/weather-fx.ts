/**
 * The weather on screen (docs/rules/16-weather.md, the remake's addition): what `weather.ts` decides for the day,
 * drawn over the map and heard through the effect channel. Purely cosmetic.
 *
 * Two layers, chosen for a canvas that WebKit may fill on the CPU:
 *  - sharp things — rain streaks, splashes, snowflakes, a lightning bolt — are drawn on the board canvas itself
 *    (BoardView.overWorld: after the figures, before the picking glows), from fixed pools (typed arrays, no
 *    per-frame objects), so no second full-size canvas has to be cleared and blended;
 *  - soft things — the day's tint, warm sunlight, wet sheen, cloud shadows, fog banks, the lightning flash — go on a
 *    small canvas at a quarter of the resolution, stretched over the map by the compositor (bilinear, free).
 * Cloud shadows and fog banks live in world space (they turn and scroll with the map); rain and snow are screen
 * particles shifted with the camera. Everything eases from one day's look to the next over a few seconds, stops
 * while a full-screen scene covers the map, and never invalidates the ground cache.
 */
import type { BoardView } from './board-view';
import type { Game } from '../core/game';
import { audio } from './audio';
import { climateOf } from './climate';
import { onWeatherMode, overrideWeather, todayWeather, weatherMode, type Weather, type WeatherKind } from './weather';

const K = Math.SQRT1_2, S = 1.2175;
/** Particle pools (the counts at full strength on a 874×402 view; a bigger view gets proportionally more, capped). */
const MAX_RAIN = 420, MAX_SNOW = 340, MAX_SPLASH = 56, MAX_CLOUD = 7, MAX_FOG = 8;
const REF_AREA = 874 * 402;
/** The soft layer's resolution: one pixel per LR css px. */
const LR = 4;
/** Full-screen scenes that hide the map (the weather pauses and its sound goes quiet, as indoors). */
const COVERS = '.pl-scene:not(.sm-scene):not(.wh-scene), .shop, .bk-atm-ov, .bk-counter-ov, .dv-ov, .bm-overlay, .slots-overlay, .ui-layer.show .stocks';

/** What a day looks like; every number eases towards the day's values. */
interface Look {
  /** Tint over everything: colour and alpha. */
  r: number; g: number; b: number; a: number;
  /** Warm sunlight from the top left. */
  warm: number;
  /** Bluish sheen at the top of wet ground. */
  sheen: number;
  /** Cloud shadows: darkness, and how many of the pool drift by. */
  cloud: number; clouds: number;
  /** Fog banks. */
  fog: number;
  /** Rain and snow density 0..1. */
  rain: number; snow: number;
  /** Wind: slant of the rain (screen dx per dy) and drift speed of clouds (world px / s). */
  slant: number; drift: number;
  /** Lightning strikes per minute; wind sound; rain sound. */
  bolts: number; gust: number; patter: number;
}
const ZERO: Look = { r: 0, g: 0, b: 0, a: 0, warm: 0, sheen: 0, cloud: 0, clouds: 0, fog: 0, rain: 0, snow: 0, slant: 0, drift: 0, bolts: 0, gust: 0, patter: 0 };
const KEYS = Object.keys(ZERO) as (keyof Look)[];

/** The day's target look. `bright`: the ground is white (snowy maps), so the tint stays cooler and lighter. */
export function lookOf(w: Weather | null, bright: boolean): Look {
  if (!w) return { ...ZERO };
  const i = w.intensity, L: Look = { ...ZERO };
  const slant = Math.cos(w.wind);
  switch (w.kind as WeatherKind) {
    // 晴 and 多雲 look the same: warm light, no grey tint and no drifting cloud shadows (they dimmed the board and
    // read as a veil over the dialogs on a phone, 16 §5). 多雲 keeps only its faint wind sound.
    case 'sunny':
    case 'cloudy':
      Object.assign(L, { r: 255, g: 226, b: 160, a: 0.04, warm: 1 - 0.3 * i, drift: 14, gust: w.kind === 'cloudy' ? 0.05 : 0 });
      break;
    case 'rain':
      Object.assign(L, { r: 30, g: 46, b: 76, a: (bright ? 0.12 : 0.17) + 0.12 * i, sheen: 0.5 + 0.4 * i, cloud: 0.14, clouds: 5, drift: 22,
        rain: 0.22 + 0.78 * i, slant: slant * (0.08 + 0.12 * i), patter: 0.35 + 0.65 * i });
      break;
    case 'storm':
      Object.assign(L, { r: 18, g: 24, b: 48, a: bright ? 0.2 : 0.27, sheen: 0.8, cloud: 0.22, clouds: 6, drift: 34,
        rain: 0.8 + 0.2 * i, slant: slant * 0.22, bolts: 5 + 4 * i, patter: 1, gust: 0.25 });
      break;
    case 'typhoon':
      Object.assign(L, { r: 22, g: 34, b: 56, a: bright ? 0.22 : 0.3, sheen: 0.9, cloud: 0.26, clouds: 7, drift: 90,
        rain: 1, slant: (slant >= 0 ? 1 : -1) * 0.55, bolts: 1.5, patter: 1, gust: 1 });
      break;
    case 'snow':
      Object.assign(L, { r: bright ? 88 : 170, g: bright ? 104 : 182, b: bright ? 136 : 205, a: bright ? 0.11 + 0.07 * i : 0.1 + 0.08 * i,
        cloud: 0.1, clouds: 4, drift: 10, snow: 0.2 + 0.8 * i, slant: slant * (0.15 + 0.35 * i), gust: 0.15 + 0.35 * i });
      break;
    case 'fog':
      Object.assign(L, { r: 214, g: 222, b: 230, a: 0.12 + 0.1 * i, fog: 0.45 + 0.55 * i, drift: 7, gust: 0.04 });
      break;
  }
  return L;
}

/** A soft round blob (radial gradient), drawn scaled for cloud shadows and fog banks. */
function blob(rgb: string, lumpy: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas'), n = 96;
  c.width = c.height = n;
  const x = c.getContext('2d')!;
  const puff = (cx: number, cy: number, r: number, a: number) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.55, `rgba(${rgb},${a * 0.6})`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, n, n);
  };
  if (lumpy) { puff(40, 50, 34, 0.75); puff(60, 44, 30, 0.7); puff(50, 58, 26, 0.6); puff(30, 40, 20, 0.45); }
  else puff(48, 48, 48, 1);
  return c;
}

/**
 * Snowflake sprite at device resolution: a soft white puff with a blue-grey rim and a faint shadow below it, so it
 * reads on white snow as well as on grass.
 */
function flake(r: number, dpr: number, bright: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas'), pad = 3, size = Math.ceil((r * 2 + pad * 2 + 2) * dpr);
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  x.scale(dpr, dpr);
  const m = r + pad;
  const sh = x.createRadialGradient(m + 1, m + 1.6, 0, m + 1, m + 1.6, r * 1.25);
  sh.addColorStop(0, `rgba(40, 58, 92, ${bright ? 0.5 : 0.32})`); sh.addColorStop(1, 'rgba(40, 58, 92, 0)');
  x.fillStyle = sh; x.fillRect(0, 0, m * 2 + 2, m * 2 + 2);
  const g = x.createRadialGradient(m - r * 0.2, m - r * 0.2, 0, m, m, r);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)'); g.addColorStop(0.55, 'rgba(250, 252, 255, .95)');
  // On white snow the rim is darker blue-grey, so the flake has an edge against the ground.
  g.addColorStop(0.8, bright ? 'rgba(112, 136, 176, .95)' : 'rgba(160, 180, 210, .8)'); g.addColorStop(1, 'rgba(112, 136, 176, 0)');
  x.fillStyle = g;
  x.beginPath(); x.arc(m, m, r, 0, Math.PI * 2); x.fill();
  return c;
}

/** Warm light (top left) and wet sheen (top), drawn once at the soft layer's size. */
function lightImage(w: number, h: number, warm: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  if (warm) {
    const g = x.createRadialGradient(w * 0.08, -h * 0.15, 0, w * 0.08, -h * 0.15, Math.hypot(w, h) * 0.75);
    g.addColorStop(0, 'rgba(255, 214, 112, .46)'); g.addColorStop(0.35, 'rgba(255, 200, 96, .16)'); g.addColorStop(1, 'rgba(255, 190, 90, 0)');
    x.fillStyle = g;
  } else {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(190, 210, 245, .32)'); g.addColorStop(0.5, 'rgba(160, 185, 230, .08)'); g.addColorStop(1, 'rgba(160, 185, 230, 0)');
    x.fillStyle = g;
  }
  x.fillRect(0, 0, w, h);
  return c;
}

// ------------------------------------------------------------------ sound

/** Weather sound levels against the music: the rain/wind bed, and thunder on top of it (master × this). */
const AMBIENCE = 0.18, THUNDER = 0.5;

/**
 * Rain, wind and thunder made with Web Audio from one buffer of noise (no files): rain = filtered noise, wind =
 * noise through a slowly swept band-pass, thunder = a crack and a low rumble with a falling low-pass. All of it
 * goes through the effect bus (effect volume, mute) and fades in and out.
 */
class WeatherSound {
  private nodes: { ctx: AudioContext; master: GainNode; rain: GainNode; rainLp: BiquadFilterNode; wind: GainNode; srcs: AudioScheduledSourceNode[]; noise: AudioBuffer } | null = null;
  private idleSince = 0;
  private want = { rain: 0, wind: 0, level: 0 };

  /** Called a few times a second with the eased look; `level` 0..1 is the overall loudness (0: silent). */
  set(rain: number, wind: number, level: number) {
    this.want = { rain, wind, level };
    const now = performance.now();
    const audible = level > 0.01 && (rain > 0.01 || wind > 0.01);
    if (!audible) {
      if (this.nodes) {
        this.ramp(0);
        if (!this.idleSince) this.idleSince = now;
        else if (now - this.idleSince > 2500) this.stop();
      }
      return;
    }
    this.idleSince = 0;
    // The audio context was replaced (iOS, back from another app): the old nodes are dead, build new ones.
    if (this.nodes && this.nodes.ctx !== audio.ambience()?.ctx) this.nodes = null;
    if (!this.nodes && !this.start()) return;
    this.ramp(level);
  }

  private ramp(level: number) {
    const n = this.nodes;
    if (!n) return;
    const t = n.ctx.currentTime, { rain, wind } = this.want;
    // A quiet bed under the music (the user found rain and thunder drowning it out).
    n.master.gain.setTargetAtTime(level * AMBIENCE, t, 0.6);
    n.rain.gain.setTargetAtTime(rain * 0.42, t, 0.5);
    n.rainLp.frequency.setTargetAtTime(2200 + 4200 * rain, t, 0.5);
    n.wind.gain.setTargetAtTime(wind * 0.5, t, 0.8);
  }

  private start(): boolean {
    const a = audio.ambience();
    if (!a || a.ctx.state !== 'running') return false;
    const { ctx, out } = a;
    const len = ctx.sampleRate * 2, noise = ctx.createBuffer(1, len, ctx.sampleRate), d = noise.getChannelData(0);
    // Slightly pink noise (a one-pole low-pass on white) sounds less like hiss.
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = 0.82 * last + 0.18 * w; d[i] = w * 0.55 + last * 1.6; }
    const master = ctx.createGain(); master.gain.value = 0; master.connect(out);
    const loop = (offset: number) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(ctx.currentTime, offset); return s; };
    // Rain: noise → high-pass (no rumble) → low-pass (brighter when heavy).
    const r = loop(0), hp = ctx.createBiquadFilter(), rainLp = ctx.createBiquadFilter(), rain = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 420; rainLp.type = 'lowpass'; rainLp.frequency.value = 3000; rain.gain.value = 0;
    r.connect(hp).connect(rainLp).connect(rain).connect(master);
    // Wind: noise → band-pass swept by a slow oscillator, loudness breathing with another.
    const w = loop(0.77), bp = ctx.createBiquadFilter(), wind = ctx.createGain(), swell = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.9; wind.gain.value = 0; swell.gain.value = 1;
    const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
    lfo.frequency.value = 0.11; lfoAmt.gain.value = 260; lfo.connect(lfoAmt).connect(bp.frequency);
    const lfo2 = ctx.createOscillator(), lfo2Amt = ctx.createGain();
    lfo2.frequency.value = 0.07; lfo2Amt.gain.value = 0.45; lfo2.connect(lfo2Amt).connect(swell.gain);
    lfo.start(); lfo2.start();
    w.connect(bp).connect(swell).connect(wind).connect(master);
    this.nodes = { ctx, master, rain, rainLp, wind, srcs: [r, w, lfo, lfo2], noise };
    return true;
  }

  /** A thunder clap `delay` seconds from now; `near` 0..1 makes it louder and sharper. */
  thunder(delay: number, near: number) {
    const n = this.nodes;
    if (!n || this.want.level <= 0.01) return;
    const { ctx, noise } = n, t = ctx.currentTime + delay, dur = 2.6 + 1.6 * (1 - near);
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 + 2400 * near, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + dur * 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(THUNDER * (0.5 + 0.7 * near), t + 0.03 + 0.1 * (1 - near));
    // Rolling rumble: a few swells while it decays.
    g.gain.exponentialRampToValueAtTime(THUNDER * (0.25 + 0.3 * near), t + 0.5);
    g.gain.exponentialRampToValueAtTime(THUNDER * (0.35 + 0.25 * near), t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(n.master);
    src.start(t, Math.random() * 1.2, dur + 0.1);
    src.onended = () => { try { src.disconnect(); g.disconnect(); lp.disconnect(); } catch { /* gone */ } };
  }

  stop() {
    const n = this.nodes;
    if (!n) return;
    this.nodes = null;
    this.idleSince = 0;
    const t = n.ctx.currentTime;
    n.master.gain.setTargetAtTime(0, t, 0.2);
    for (const s of n.srcs) { try { s.stop(t + 1); } catch { /* stopped */ } }
    setTimeout(() => { try { n.master.disconnect(); } catch { /* gone */ } }, 1300);
  }
}

// ------------------------------------------------------------------ the map layer

export class WeatherFx {
  /** The soft layer over the map. */
  readonly el: HTMLCanvasElement;
  private sx: CanvasRenderingContext2D;
  private alive = true;
  /** The weather shown (null: none), its source date and the setting it was decided under. */
  private day = -1;
  /** The 天氣 setting, read once and again when it changes (not from storage every frame). */
  private mode = weatherMode();
  private modeSeen = -1;
  weather: Weather | null = null;
  private target: Look = { ...ZERO };
  private now: Look = { ...ZERO };
  private readonly bright: boolean;
  private last = 0;
  private frame = 0;
  private covered = false;
  private sound = new WeatherSound();
  private unlisten: () => void;

  // Pools: rain [x, y, len, speed, depth], snow [x, y, size, speed, phase, sway], splash [x, y, age], clouds/fog [x, y, size, phase].
  private rain = new Float32Array(MAX_RAIN * 5);
  private snow = new Float32Array(MAX_SNOW * 6);
  private splash = new Float32Array(MAX_SPLASH * 3);
  private splashNext = 0;
  private clouds = new Float32Array(MAX_CLOUD * 4);
  private fogs = new Float32Array(MAX_FOG * 4);
  private seeded = false;
  private bolt = new Float32Array(2 * 14);
  private boltN = 0;
  private boltAt = -1e9;
  private flashAt = -1e9;
  private nextBolt = 0;
  private camX = NaN;
  private camY = NaN;
  private W = 0;
  private H = 0;
  private zoom = 1;
  private dpr = 0;
  private flakes: HTMLCanvasElement[] = [];
  private shadow = blob('16, 22, 36', true);
  private mist = blob('236, 240, 246', false);
  private warmImg: HTMLCanvasElement | null = null;
  private sheenImg: HTMLCanvasElement | null = null;
  private tintKey = -1;
  private tintStyle = 'rgba(0, 0, 0, 0)';
  /** Stroke colours of the three rain depths and of the splash rings (by strength, ten steps). */
  private rainStyles: string[] = [];
  private splashStyles: string[] = [];

  constructor(private readonly view: BoardView, private readonly game: Game) {
    this.bright = climateOf(game.settings.mapId) === 'sapporo';
    // On white ground the streaks are blue-grey so they still show; elsewhere pale.
    const col = this.bright ? '70, 96, 135' : '215, 228, 248';
    this.rainStyles = [0, 1, 2].map(l => `rgba(${col}, ${(0.3 + l * 0.16).toFixed(2)})`);
    this.splashStyles = Array.from({ length: 11 }, (_, i) => `rgba(${col}, ${(0.035 * i).toFixed(3)})`);
    this.el = document.createElement('canvas');
    this.el.className = 'wx-layer';
    this.el.setAttribute('aria-hidden', 'true');
    view.canvas.after(this.el);
    this.sx = this.el.getContext('2d')!;
    view.overWorld = (ctx, w, h, dpr, zoom) => this.draw(ctx, w, h, dpr, zoom);
    this.unlisten = onWeatherMode(() => { this.mode = weatherMode(); this.day = -1; });
  }

  destroy() {
    this.alive = false;
    this.unlisten();
    if (this.view.overWorld) this.view.overWorld = null;
    this.sound.stop();
    this.el.remove();
  }

  /** Debug and screenshots: show a given weather (kind and intensity), or `undefined` to go back to the day's. */
  force(kind?: WeatherKind | null, intensity = 0.8, wind = 0.6) {
    overrideWeather(kind === undefined ? undefined : kind === null ? null : { kind, intensity, wind });
    this.decide();
  }

  /** Jumps to the target look (screenshots, tests). */
  settle() { this.now = { ...this.target }; this.seeded = false; }

  private decide() {
    const mode = this.mode, d = this.game.date;
    if (d === this.day && mode === this.modeSeen) return;
    this.day = d; this.modeSeen = mode;
    this.weather = todayWeather(this.game);
    this.target = mode === 2 ? { ...ZERO } : lookOf(this.weather, this.bright);
    if (this.weather) this.nextBolt = 0;
  }

  private draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, zoom: number) {
    if (!this.alive) return;
    const t = performance.now(), dt = Math.min(0.1, this.last ? (t - this.last) / 1000 : 0.016);
    this.last = t;
    this.frame++;
    if (this.frame % 12 === 1) {
      this.decide();
      const covered = !!document.querySelector(COVERS);
      if (covered !== this.covered) { this.covered = covered; this.el.style.visibility = covered ? 'hidden' : ''; }
    }
    // Ease every number towards the day's look (about 3 s for a full change).
    const k = 1 - Math.exp(-dt / 1.1), L = this.now, T = this.target;
    let active = false;
    for (const key of KEYS) {
      const v = L[key] + (T[key] - L[key]) * k;
      L[key] = Math.abs(v - T[key]) < 1e-4 ? T[key] : v;
      if (key !== 'r' && key !== 'g' && key !== 'b' && L[key] > 0.002) active = true;
    }
    if (this.frame % 15 === 2) {
      const on = this.mode === 0 && !audio.settings.mute && audio.settings.sfx > 0;
      this.sound.set(L.patter, L.gust, on ? (this.covered ? 0.3 : 1) : 0);
    }
    if (!active) {
      if (this.W) { this.sx.clearRect(0, 0, this.el.width, this.el.height); this.W = 0; }
      return;
    }
    if (this.covered) return;
    this.layout(w, h, dpr);
    this.zoom = zoom;
    // The camera's shift on screen since the last frame (rain and snow move with the ground; a turn resets them).
    const c = this.view.project(1152, 1152);
    let mx = 0, my = 0;
    if (Number.isFinite(this.camX)) { mx = c.x - this.camX; my = c.y - this.camY; if (Math.abs(mx) > 240 || Math.abs(my) > 240) { mx = 0; my = 0; } }
    this.camX = c.x; this.camY = c.y;
    if (!this.seeded) this.seed(w, h);
    this.soft(t, dt, w, h, zoom);
    if (L.rain > 0.005) this.drawRain(ctx, dt, w, h, zoom, mx, my);
    if (L.snow > 0.005) this.drawSnow(ctx, t, dt, w, h, zoom, mx, my);
    this.lightning(ctx, t, w, h);
  }

  private layout(w: number, h: number, dpr: number) {
    if (w === this.W && h === this.H && dpr === this.dpr) return;
    this.W = w; this.H = h;
    if (dpr !== this.dpr) { this.dpr = dpr; this.flakes = [2.4, 3.3, 4.6].map(r => flake(r, dpr, this.bright)); }
    this.el.width = Math.max(1, Math.ceil(w / LR));
    this.el.height = Math.max(1, Math.ceil(h / LR));
    this.warmImg = lightImage(this.el.width, this.el.height, true);
    this.sheenImg = lightImage(this.el.width, this.el.height, false);
    this.tintKey = -1;
    this.seeded = false;
  }

  /** Scatters the pools over the view (a new view size, a jump, the first frame). */
  private seed(w: number, h: number) {
    this.seeded = true;
    const Sn = this.snow;
    for (let i = 0; i < MAX_RAIN; i++) this.spawnRain(i, w, h, true);
    for (let i = 0; i < MAX_SNOW; i++) {
      const o = i * 6;
      Sn[o] = Math.random() * (w + 80) - 40; Sn[o + 1] = Math.random() * h; Sn[o + 2] = Math.random() < 0.5 ? 0 : Math.random() < 0.7 ? 1 : 2;
      Sn[o + 3] = 22 + Math.random() * 30; Sn[o + 4] = Math.random() * 6.28; Sn[o + 5] = 6 + Math.random() * 14;
    }
    const centre = this.view.unproject(w / 2, h / 2);
    const r = Math.max(w, h) / this.zoom / S * 0.6;
    for (let i = 0; i < MAX_CLOUD; i++) this.spawnSoft(this.clouds, i, centre.x, centre.y, r, false);
    for (let i = 0; i < MAX_FOG; i++) this.spawnSoft(this.fogs, i, centre.x, centre.y, r, false);
  }

  private spawnRain(i: number, w: number, h: number, anywhere: boolean) {
    const R = this.rain, o = i * 5, depth = Math.random();
    const slant = this.now.slant;
    R[o] = Math.random() * (w + Math.abs(slant) * h + 40) - (slant > 0 ? slant * h : 0) - 20;
    R[o + 1] = anywhere ? Math.random() * h : -Math.random() * 60 - 20;
    R[o + 4] = depth;
    R[o + 2] = 13 + 22 * depth;
    R[o + 3] = 680 + 560 * depth;
  }

  /** A cloud or fog bank somewhere round (cx, cy) in the world (upwind when `edge`). */
  private spawnSoft(P: Float32Array, i: number, cx: number, cy: number, r: number, edge: boolean) {
    const o = i * 4, wind = this.weather?.wind ?? 0;
    if (edge) {
      const a = wind + Math.PI + (Math.random() - 0.5) * 1.6;
      P[o] = cx + Math.cos(a) * r; P[o + 1] = cy + Math.sin(a) * r;
    } else {
      P[o] = cx + (Math.random() * 2 - 1) * r; P[o + 1] = cy + (Math.random() * 2 - 1) * r;
    }
    P[o + 2] = 0.7 + Math.random() * 0.7;
    P[o + 3] = Math.random() * 6.28;
  }

  /** The soft layer: tint, light, cloud shadows, fog, flash. */
  private soft(t: number, dt: number, w: number, h: number, zoom: number) {
    const x = this.sx, L = this.now, cw = this.el.width, ch = this.el.height;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.clearRect(0, 0, cw, ch);
    if (L.a > 0.003) {
      // The colour string is rebuilt only when the eased tint has moved by a visible step.
      const q = (Math.round(L.r / 4) << 18) | (Math.round(L.g / 4) << 12) | (Math.round(L.b / 4) << 6) | Math.round(L.a * 160);
      if (q !== this.tintKey) { this.tintKey = q; this.tintStyle = `rgba(${Math.round(L.r)}, ${Math.round(L.g)}, ${Math.round(L.b)}, ${(Math.round(L.a * 160) / 160).toFixed(4)})`; }
      x.fillStyle = this.tintStyle;
      x.fillRect(0, 0, cw, ch);
    }
    if (L.warm > 0.01 && this.warmImg) { x.globalAlpha = Math.min(1, L.warm); x.drawImage(this.warmImg, 0, 0); }
    if (L.sheen > 0.01 && this.sheenImg) { x.globalAlpha = Math.min(1, L.sheen * 0.35); x.drawImage(this.sheenImg, 0, 0); }
    const wind = this.weather?.wind ?? 0, vx = Math.cos(wind) * L.drift * dt, vy = Math.sin(wind) * L.drift * dt;
    const centre = this.view.unproject(w / 2, h / 2), reach = Math.max(w, h) / zoom / S * 0.75 + 500;
    // Cloud shadows: world-anchored lumpy blobs, squashed like the ground (K), drifting with the wind.
    if (L.cloud > 0.004) {
      const n = Math.min(MAX_CLOUD, Math.ceil(L.clouds));
      x.globalAlpha = Math.min(1, L.cloud * 2.2);
      for (let i = 0; i < n; i++) {
        const o = i * 4, P = this.clouds;
        P[o] += vx; P[o + 1] += vy;
        if (Math.hypot(P[o] - centre.x, P[o + 1] - centre.y) > reach) this.spawnSoft(P, i, centre.x, centre.y, reach * 0.95, true);
        const q = this.view.project(P[o], P[o + 1]), size = 520 * P[o + 2] * zoom * S / LR;
        const fade = i < n - 1 ? 1 : 1 - (n - L.clouds);
        if (fade <= 0) continue;
        x.globalAlpha = Math.min(1, L.cloud * 2.2) * fade;
        x.drawImage(this.shadow, q.x / LR - size / 2, q.y / LR - size * K / 2, size, size * K);
      }
    }
    // Fog: pale banks drifting slowly, breathing in and out.
    if (L.fog > 0.004) {
      for (let i = 0; i < MAX_FOG; i++) {
        const o = i * 4, P = this.fogs;
        P[o] += vx * 0.8; P[o + 1] += vy * 0.8;
        if (Math.hypot(P[o] - centre.x, P[o + 1] - centre.y) > reach) this.spawnSoft(P, i, centre.x, centre.y, reach * 0.95, true);
        const q = this.view.project(P[o], P[o + 1]), size = 640 * P[o + 2] * zoom * S / LR;
        x.globalAlpha = Math.min(1, L.fog * (0.32 + 0.12 * Math.sin(t / 2600 + P[o + 3])));
        x.drawImage(this.mist, q.x / LR - size / 2, q.y / LR - size * K / 2, size, size * K);
      }
    }
    // Lightning flash: a double flicker.
    const f = t - this.flashAt;
    if (f < 520) {
      const a = f < 70 ? 0.55 : f < 140 ? 0.12 : f < 210 ? 0.42 : 0.42 * (1 - (f - 210) / 310);
      x.globalAlpha = Math.max(0, a);
      x.fillStyle = '#eef3ff';
      x.fillRect(0, 0, cw, ch);
    }
    x.globalAlpha = 1;
  }

  private drawRain(ctx: CanvasRenderingContext2D, dt: number, w: number, h: number, zoom: number, mx: number, my: number) {
    const L = this.now, R = this.rain, area = Math.min(1.8, (w * h) / REF_AREA);
    const n = Math.min(MAX_RAIN, Math.round(L.rain * 340 * area));
    const slant = L.slant, zs = Math.max(0.7, Math.min(1.6, zoom));
    // Three depths, one path each: far thin and faint, near longer and brighter.
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      for (let i = layer; i < n; i += 3) {
        const o = i * 5;
        const sp = R[o + 3] * dt * zs;
        R[o] += sp * slant + mx; R[o + 1] += sp + my;
        if (R[o + 1] > h + 30 || R[o] < -60 || R[o] > w + 60) {
          // A drop that lands makes a small ring now and then.
          if (R[o + 1] > h * 0.15 && Math.random() < 0.35) this.addSplash(R[o], Math.min(h - 4, R[o + 1] - 30 - Math.random() * h * 0.6));
          this.spawnRain(i, w, h, false);
          continue;
        }
        const len = R[o + 2] * zs;
        ctx.moveTo(R[o], R[o + 1]);
        ctx.lineTo(R[o] - len * slant, R[o + 1] - len);
      }
      ctx.lineWidth = (1 + layer * 0.5) * Math.min(1.3, zs);
      ctx.strokeStyle = this.rainStyles[layer];
      ctx.stroke();
    }
    // Splash rings: flat ellipses that grow and fade.
    ctx.beginPath();
    const P = this.splash;
    for (let i = 0; i < MAX_SPLASH; i++) {
      const o = i * 3;
      if (P[o + 2] <= 0) continue;
      P[o] += mx; P[o + 1] += my;
      P[o + 2] -= dt * 3.2;
      if (P[o + 2] <= 0) continue;
      const age = 1 - P[o + 2], r = (1.5 + 5 * age) * zs;
      ctx.moveTo(P[o] + r, P[o + 1]);
      ctx.ellipse(P[o], P[o + 1], r, r * 0.45, 0, 0, Math.PI * 2);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.splashStyles[Math.round(10 * Math.min(1, L.rain * 1.4))];
    ctx.stroke();
  }

  private addSplash(x: number, y: number) {
    const o = this.splashNext * 3;
    this.splashNext = (this.splashNext + 1) % MAX_SPLASH;
    this.splash[o] = x; this.splash[o + 1] = y; this.splash[o + 2] = 1;
  }

  private drawSnow(ctx: CanvasRenderingContext2D, t: number, dt: number, w: number, h: number, zoom: number, mx: number, my: number) {
    const L = this.now, Sn = this.snow, area = Math.min(1.8, (w * h) / REF_AREA);
    const n = Math.min(MAX_SNOW, Math.round(L.snow * 250 * area));
    const zs = Math.max(0.75, Math.min(1.5, zoom)), drift = L.slant * 40;
    ctx.globalAlpha = Math.min(1, 0.35 + L.snow);
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      Sn[o + 1] += Sn[o + 3] * dt * zs + my;
      Sn[o] += (drift + Math.cos(t / 900 + Sn[o + 4]) * Sn[o + 5] * 0.9) * dt + mx;
      if (Sn[o + 1] > h + 8) { Sn[o + 1] = -8 - Math.random() * 20; Sn[o] = Math.random() * (w + 80) - 40; }
      if (Sn[o] < -40) Sn[o] += w + 80; else if (Sn[o] > w + 40) Sn[o] -= w + 80;
      if (Sn[o + 1] < -30) Sn[o + 1] += h + 30;
      const img = this.flakes[Sn[o + 2]];
      if (!img) continue;
      const s = (img.width / this.dpr) * zs;
      ctx.drawImage(img, Sn[o] - s / 2, Sn[o + 1] - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  private lightning(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
    const L = this.now;
    if (L.bolts > 0.2) {
      if (!this.nextBolt) this.nextBolt = t + 1500 + Math.random() * 4000;
      if (t >= this.nextBolt) {
        this.strike(t, w, h);
        this.nextBolt = t + (60000 / L.bolts) * (0.4 + Math.random() * 1.2);
      }
    } else this.nextBolt = 0;
    const age = t - this.boltAt;
    if (age > 200 || this.boltN < 2) return;
    const B = this.bolt;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [lw, col] of [[10, 'rgba(160, 190, 255, .3)'], [5, 'rgba(210, 225, 255, .55)'], [2.4, 'rgba(255, 255, 255, 1)']] as const) {
      ctx.beginPath();
      ctx.moveTo(B[0], B[1]);
      for (let i = 1; i < this.boltN; i++) ctx.lineTo(B[i * 2], B[i * 2 + 1]);
      ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.globalAlpha = age < 80 ? 1 : 0.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private strike(t: number, w: number, h: number) {
    this.flashAt = t;
    const near = Math.random();
    // A visible bolt for the closer ones: jagged, from above the view down into it.
    if (near > 0.45) {
      const B = this.bolt, n = 14;
      let x = w * (0.2 + Math.random() * 0.6), y = -10;
      const endY = h * (0.3 + Math.random() * 0.3), step = (endY - y) / (n - 1);
      for (let i = 0; i < n; i++) { B[i * 2] = x; B[i * 2 + 1] = y; x += (Math.random() - 0.5) * 34; y += step * (0.7 + Math.random() * 0.6); }
      this.boltN = n;
      this.boltAt = t;
    }
    if (this.mode === 0) this.sound.thunder(0.25 + (1 - near) * 2.2, near);
  }
}

// ------------------------------------------------------------------ outdoor scenes

/**
 * A light touch of the day's rain or snow over an outdoor full-screen scene (the sky mini games): a small canvas
 * in the scene's design space, few particles, translucent, under the scene's text. Ends with the scene.
 */
export function sceneWeather(parent: HTMLElement, game: Game, w = 640, h = 480) {
  if (weatherMode() === 2) return;
  const wx = todayWeather(game);
  if (!wx || (wx.kind !== 'rain' && wx.kind !== 'storm' && wx.kind !== 'snow' && wx.kind !== 'typhoon' && wx.kind !== 'fog')) return;
  const c = document.createElement('canvas');
  c.className = 'wx-scene';
  c.width = w / 2; c.height = h / 2;
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  parent.append(c);
  const x = c.getContext('2d')!, snow = wx.kind === 'snow', fog = wx.kind === 'fog';
  const n = fog ? 0 : Math.round((snow ? 70 : 120) * (0.4 + 0.6 * wx.intensity)), P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { P[i * 3] = Math.random() * w; P[i * 3 + 1] = Math.random() * h; P[i * 3 + 2] = Math.random(); }
  const slant = wx.kind === 'typhoon' ? 0.5 : Math.cos(wx.wind) * 0.15;
  let last = performance.now();
  const tick = (t: number) => {
    if (!c.isConnected) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    x.setTransform(0.5, 0, 0, 0.5, 0, 0);
    x.clearRect(0, 0, w, h);
    if (fog) { x.fillStyle = `rgba(230, 236, 242, ${0.18 + 0.1 * Math.sin(t / 1800)})`; x.fillRect(0, 0, w, h); return; }
    x.fillStyle = snow ? 'rgba(120, 140, 170, .08)' : 'rgba(30, 45, 75, .12)';
    x.fillRect(0, 0, w, h);
    x.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 3, d = P[o + 2];
      if (snow) { P[o + 1] += (30 + 30 * d) * dt; P[o] += Math.cos(t / 800 + i) * 12 * dt; }
      else { const sp = (700 + 500 * d) * dt; P[o + 1] += sp; P[o] += sp * slant; }
      if (P[o + 1] > h) { P[o + 1] = -20; P[o] = Math.random() * w; }
      if (P[o] > w) P[o] -= w; else if (P[o] < 0) P[o] += w;
      if (snow) { x.moveTo(P[o] + 2 + d, P[o + 1]); x.arc(P[o], P[o + 1], 2 + d, 0, Math.PI * 2); }
      else { const len = 12 + 12 * d; x.moveTo(P[o], P[o + 1]); x.lineTo(P[o] - len * slant, P[o + 1] - len); }
    }
    if (snow) { x.fillStyle = 'rgba(255, 255, 255, .85)'; x.fill(); }
    else { x.lineWidth = 2; x.strokeStyle = 'rgba(214, 226, 246, .6)'; x.stroke(); }
  };
  requestAnimationFrame(tick);
}
