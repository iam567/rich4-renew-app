/**
 * 歌舞伎町's street life beyond the passers-by (docs/rules/21 §8.3, purely decorative, never touches the rules):
 * traffic on the three outer avenues drawn round the board (職安通り north, 靖國通り south, 明治通り east: taxis, cars,
 * scooters, now and then a police car or an ambulance with its siren), the 西武新宿 train pulling in and out on the
 * west edge, cyclists on the sidewalks (they are crowd members, ui/kb-crowd.ts), a busker, sign-waving touts and the
 * トー横 youngsters on the plazas, crows, the kaiju's glowing blinking eyes and smoke, steam from the ramen stalls,
 * izakaya and ramen shops, the big video screen, flickering vending machines (the glow itself: ui/kabukicho.ts).
 *
 * Everything runs on the street's own clock (stopped under dialogs and while the page is hidden), is drawn only where
 * it is on screen, and is sorted with the map's sprites by the board (ui/board-view.ts) through `collect`.
 */
import { audio } from './audio';
import { nearestView, prng, viewAngle, walkerFacing } from './kb-crowd';
import { AMBIENT_FRAMES } from './kb-ambient-sprites';
import type { MapSprites } from './assets';

/** The ambient sprites (map/19NN, tools/tycoon-art/kb_ambient.py). */
export const AMB = { taxi: 1901, police: 1902, car: 1903, ambulance: 1904, bicycle: 1905, scooter: 1906, train: 1907, busker: 1908, waver: 1909, sitter: 1910, crow: 1911 };

/** The ambient sprites' frames for the sprite bank (registered with 歌舞伎町's other sprites). */
export function ambientSprites(): MapSprites {
  const out: MapSprites = {};
  for (const [res, frames] of Object.entries(AMBIENT_FRAMES)) {
    out[`map/${res}`] = { dir: `remake/sprites/${res}`, frames: frames.map(([w, h, ax, ay], i) => ({ file: `frame-${String(i).padStart(3, '0')}.webp`, width: w, height: h, anchor_x: ax, anchor_y: ay })) };
  }
  return out;
}

/** What the board lends the street to draw with (CSS px; map px in, screen px out). */
export interface StreetView {
  ctx: CanvasRenderingContext2D;
  zoom: number;
  rot: number;
  W: number;
  H: number;
  project(x: number, y: number): { x: number; y: number };
  /** A map vector as a screen vector. */
  toScreen(dx: number, dy: number): { x: number; y: number };
  /** Screen point of a map point when it is near the view, else null. */
  visible(x: number, y: number, m?: number): { x: number; y: number } | null;
  /** Draws a map sprite's frame with its anchor at (sx, sy); `flip`: mirrored; `alpha`. */
  sprite(res: number, frame: number, sx: number, sy: number, flip?: boolean, alpha?: number): void;
}

/** One drawing for the board's y-sorted list: its sort y (CSS px) and how to draw it. */
export type AddItem = (sortY: number, draw: () => void) => void;

const S = 1.2175, K = Math.SQRT1_2;
/** Screen px per map px of height at zoom 1 (blockout: screen y = S·K·(y − z)). */
const ZUP = S * K;
const DEG = 180 / Math.PI;
const screenDeg = (v: StreetView, dx: number, dy: number) => { const s = v.toScreen(dx, dy); return Math.atan2(s.y, s.x) * DEG; };

// ------------------------------------------------------------------ the avenues and the line (map px)

type Pt = [number, number];
/** Avenue centre lines and half widths: 職安通り (y), 靖國通り (y), 明治通り (x). */
const AVE_N = 150, AVE_S = 2185, AVE_E = 2240, HALF = 24, LANE = 8, OFF = 160, END = 2304 + 160;
/** The 西武新宿 line west of the board: rails at x, from off the map down to the buffer stop at the station forecourt. */
const RAIL_X = 200, RAIL_END = 1120, PLATFORM = [700, 1115];

/** The cars' routes (left-hand traffic: each way keeps to its left), corners rounded where they turn. */
const ROUTES: Pt[][] = [
  [[-OFF, AVE_N - LANE], [END, AVE_N - LANE]],                                   // 職安通り eastbound
  [[END, AVE_N + LANE], [-OFF, AVE_N + LANE]],                                   // 職安通り westbound
  [[-OFF, AVE_S - LANE], [END, AVE_S - LANE]],                                   // 靖國通り eastbound
  [[END, AVE_S + LANE], [-OFF, AVE_S + LANE]],                                   // 靖國通り westbound
  [[AVE_E + LANE, -OFF], [AVE_E + LANE, END]],                                   // 明治通り southbound
  [[AVE_E - LANE, END], [AVE_E - LANE, -OFF]],                                   // 明治通り northbound
  [[-OFF, AVE_N - LANE], [AVE_E + LANE, AVE_N - LANE], [AVE_E + LANE, END]],     // 職安通り east, right into 明治通り south
  [[AVE_E - LANE, END], [AVE_E - LANE, AVE_N + LANE], [-OFF, AVE_N + LANE]],     // 明治通り north, left into 職安通り west
  [[AVE_E + LANE, -OFF], [AVE_E + LANE, AVE_S + LANE], [-OFF, AVE_S + LANE]],    // 明治通り south, right into 靖國通り west
  [[-OFF, AVE_S - LANE], [AVE_E - LANE, AVE_S - LANE], [AVE_E - LANE, -OFF]],    // 靖國通り east, left into 明治通り north
];

/** The routes along 職安通り (indices into ROUTES). */
const AMBULANCE_ROUTES = [0, 1, 7];

interface Line { pts: Pt[]; cum: number[]; len: number }
function line(raw: Pt[], r = 26): Line {
  const pts: Pt[] = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const [p, c, n] = [raw[i - 1], raw[i], raw[i + 1]];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
    const a: Pt = [c[0] + (p[0] - c[0]) * r / l1, c[1] + (p[1] - c[1]) * r / l1], b: Pt = [c[0] + (n[0] - c[0]) * r / l2, c[1] + (n[1] - c[1]) * r / l2];
    for (let j = 0; j <= 8; j++) { const t = j / 8, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); }
  }
  pts.push(raw[raw.length - 1]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
function along(l: Line, s: number): { x: number; y: number; dx: number; dy: number } {
  const { pts, cum } = l;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, k = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, dx: (b[0] - a[0]) / seg, dy: (b[1] - a[1]) / seg };
}

interface Vehicle {
  res: number;
  line: Line;
  s: number;
  speed: number;
  pace: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Police / ambulance: its siren and lights. */
  siren: Siren | null;
  kind: 'car' | 'police' | 'ambulance';
}

// ------------------------------------------------------------------ things standing on the plazas

/** Street characters (one view, 4 looping frames) and where they stand. */
const FOLK: { res: number; x: number; y: number; fps: number; flip?: boolean }[] = [
  { res: AMB.busker, x: 1060, y: 1300, fps: 5 },                    // シネシティ広場
  { res: AMB.waver, x: 745, y: 1965, fps: 3 },                      // 一番街 gate square
  { res: AMB.waver, x: 1035, y: 2020, fps: 3, flip: true },
  { res: AMB.waver, x: 300, y: 1690, fps: 3 },                      // 西武新宿 forecourt
  { res: AMB.sitter, x: 1236, y: 1452, fps: 0.7 },                  // トー横, beside the crowd
  { res: AMB.sitter, x: 1262, y: 1470, fps: 0.6, flip: true },
  { res: AMB.sitter, x: 1415, y: 1440, fps: 0.8 },
];
/** People standing about (walker sprites, standing frame): the busker's listeners, the トー横 kids, the station. */
const LOITER: { x: number; y: number; kind: number; face: number }[] = [
  { x: 1048, y: 1330, kind: 3, face: -100 }, { x: 1080, y: 1328, kind: 1, face: -80 }, { x: 1092, y: 1310, kind: 2, face: -150 },
  { x: 1290, y: 1420, kind: 3, face: 20 }, { x: 1306, y: 1428, kind: 1, face: 200 }, { x: 1380, y: 1428, kind: 3, face: 120 },
  { x: 1395, y: 1452, kind: 1, face: -60 }, { x: 160, y: 1240, kind: 0, face: 90 }, { x: 186, y: 1236, kind: 1, face: 100 },
  { x: 890, y: 1990, kind: 2, face: -90 }, { x: 910, y: 1986, kind: 2, face: -100 },
];
/** Crows on the ground by the stalls and the rubbish (they fly off now and then and come back). */
const CROW_SPOTS: Pt[] = [[660, 905], [1745, 1352], [1150, 1480], [470, 1250], [1880, 1500]];

interface Crow { x: number; y: number; frame: number; t: number; away: number }
interface Flyer { x: number; y: number; z: number; vx: number; vy: number; flap: number; life: number }
/** A puff of steam or smoke: map point, height (original px over it), drift, age; `ox`: a screen offset (original px). */
interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; grey: number; ox?: number }

// ------------------------------------------------------------------ the kaiju (landmark map/1753)

/**
 * The kaiju's eyes and mouth in each of the landmark's 8 frames, measured on the redraw: [x, y, r] in original px
 * from the sprite's anchor (y up is negative). Frames 3 and 4 show the back of its head.
 */
const KAIJU = 1753;
const KAIJU_EYES: [number, number, number][][] = [
  [[-10, -52.8, 6.2], [18.2, -60.8, 3.8]],
  [[20, -52, 5.5], [36.5, -64.5, 1.8]],
  [[44, -76.2, 2]],
  [],
  [],
  [[-33.8, -85.2, 3.5]],
  [[-23.8, -56.2, 5.2], [-37, -69.8, 2.5]],
  [[-6.2, -53, 5.5], [-33.5, -59, 4.8]],
];
const KAIJU_MOUTH: (Pt | null)[] = [[7.8, -42.8], [36.8, -38.5], null, null, null, null, [-34.5, -40], [-21, -35.8]];
/** Steam sources: the ramen stalls (map/1764) and how high their tops are (original px over the anchor). */
const YATAI = 1764, SCREEN = 1763;

// ------------------------------------------------------------------ sound: the sirens

/**
 * A siren made with Web Audio through the effect bus (effect volume and mute), panned by where the car is on the
 * screen, louder as it comes near and with a Doppler-like pitch rise and fall as it passes. Police: the Japanese
 * patrol car's rising and falling wail; ambulance: the two-tone ピーポー (960 / 770 Hz).
 */
class Siren {
  private nodes: { ctx: AudioContext; osc: OscillatorNode; gain: GainNode; pan: StereoPannerNode | null; lp: BiquadFilterNode } | null = null;
  private last = -1;

  constructor(readonly kind: 'police' | 'ambulance') {
    const a = audio.ambience();
    if (!a || a.ctx.state !== 'running') return;
    const { ctx, out } = a, t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain(), lp = ctx.createBiquadFilter();
    osc.type = kind === 'police' ? 'sawtooth' : 'square';
    lp.type = 'lowpass'; lp.frequency.value = kind === 'police' ? 1900 : 2400;
    gain.gain.value = 0;
    let pan: StereoPannerNode | null = null;
    try { pan = ctx.createStereoPanner(); } catch { pan = null; }
    osc.connect(lp).connect(gain);
    if (pan) gain.connect(pan).connect(out); else gain.connect(out);
    // The pattern for a minute ahead (it is stopped long before).
    const f = osc.frequency;
    f.setValueAtTime(kind === 'police' ? 620 : 960, t);
    for (let i = 0; i < 40; i++) {
      if (kind === 'police') {
        const t0 = t + i * 3;
        f.setValueAtTime(620, t0); f.linearRampToValueAtTime(1080, t0 + 1.7); f.linearRampToValueAtTime(620, t0 + 3);
      } else {
        const t0 = t + i * 1.3;
        f.setValueAtTime(960, t0); f.setValueAtTime(770, t0 + 0.65);
      }
    }
    osc.start(t);
    this.nodes = { ctx, osc, gain, pan, lp };
  }

  /**
   * The car is at screen (sx, sy) in a view of W × H: loudness by distance from the view's centre, pan by side,
   * pitch by how fast it comes nearer or goes away. `on`: false fades it out (a dialog, the setting).
   */
  update(sx: number, sy: number, W: number, H: number, on: boolean, dt: number) {
    const n = this.nodes;
    if (!n) return;
    const t = n.ctx.currentTime, d = Math.hypot(sx - W / 2, sy - H / 2), r = Math.max(W, H) * 0.55;
    // ≈ the weather bed's level at the centre of the view, fading with distance.
    const level = on ? SIREN_LEVEL / (1 + (d / r) * (d / r)) : 0;
    n.gain.gain.setTargetAtTime(level, t, 0.15);
    if (n.pan) n.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, (sx - W / 2) / (W / 2))), t, 0.15);
    if (this.last >= 0 && dt > 0) {
      const v = (d - this.last) / dt;                       // screen px / s: + going away
      const shift = Math.max(-0.07, Math.min(0.07, -v / 2600));
      n.osc.detune.setTargetAtTime(1200 * Math.log2(1 + shift), t, 0.2);
    }
    this.last = d;
    // Farther away the siren is duller.
    n.lp.frequency.setTargetAtTime((this.kind === 'police' ? 1900 : 2400) / (1 + d / (2 * r)), t, 0.2);
  }

  stop() {
    const n = this.nodes;
    if (!n) return;
    const t = n.ctx.currentTime;
    n.gain.gain.setTargetAtTime(0, t, 0.1);
    try { n.osc.stop(t + 0.6); } catch { /* already stopped */ }
    setTimeout(() => { try { n.gain.disconnect(); n.pan?.disconnect(); } catch { /* gone */ } }, 900);
    this.nodes = null;
  }
}
/** A siren's peak loudness on the effect bus (the weather's rain bed is 0.35 × 0.42 ≈ 0.15 at full rain). */
const SIREN_LEVEL = 0.12;

// ------------------------------------------------------------------ the street's ambient life

export interface AmbientCounts { vehicles: number; crows: number }

export interface AmbientEnv {
  /** 歌舞伎町's landmarks (x, y, sprite, facing), its izakaya / ramen shops' roofs, read each frame. */
  landmarks(): { x: number; y: number; res: number; facing: number }[];
  steamers(): { x: number; y: number; z: number }[];
  /** Whether a siren may sound now (the settings, not under a dialog). */
  sirenOk(): boolean;
}

export class Ambient {
  private r: () => number;
  private lines = ROUTES.map(p => line(p));
  private cars: Vehicle[] = [];
  private nextCar = 0;
  private nextSiren: number;
  private train = { state: 'away' as 'away' | 'in' | 'dwell' | 'out', t: 0, front: -900, wait: 6 };
  private crows: Crow[] = [];
  private flyers: Flyer[] = [];
  private puffs: Puff[] = [];
  private steamClock = 0;
  /** The last puff period each steam source has puffed in. */
  private emitted = new Map<number, number>();
  private lastCollect = 0;
  private smokeNext = 6;
  private blinkNext = 3;
  private blink = 0;
  private puffImg: HTMLCanvasElement | null = null;
  private screens = new WeakMap<CanvasImageSource, HTMLCanvasElement | null>();
  private scratch: HTMLCanvasElement | null = null;
  private time = 0;

  constructor(seed: number, readonly counts: AmbientCounts, readonly env: AmbientEnv, public vehiclesOn: boolean) {
    this.r = prng(seed ^ 0x61626d62);
    this.nextSiren = 25 + this.r() * 35;
    for (let i = 0; i < counts.crows; i++) {
      const [x, y] = CROW_SPOTS[i % CROW_SPOTS.length];
      for (let j = 0; j < 2 + (i % 2); j++) this.crows.push({ x: x + (this.r() - 0.5) * 24, y: y + (this.r() - 0.5) * 14, frame: 0, t: this.r() * 2, away: 0 });
    }
    // Start with traffic already on the avenues.
    for (let i = 0; i < counts.vehicles; i++) this.spawnCar(this.r() * 0.9);
  }

  /** Every sprite the ambient life may draw (for the loading screen). */
  sprites(): number[] {
    return Object.values(AMB);
  }

  private spawnCar(at = 0, kind: Vehicle['kind'] = 'car') {
    // An ambulance takes 職安通り (大久保病院 is just off it); everything else any of the routes.
    const r = this.r, pool = kind === 'ambulance' ? AMBULANCE_ROUTES : null;
    const li = pool ? pool[Math.floor(r() * pool.length)] : Math.floor(r() * this.lines.length), l = this.lines[li];
    const res = kind === 'police' ? AMB.police : kind === 'ambulance' ? AMB.ambulance : [AMB.taxi, AMB.taxi, AMB.car, AMB.car, AMB.scooter][Math.floor(r() * 5)];
    const speed = kind === 'car' ? (res === AMB.scooter ? 55 + r() * 15 : 70 + r() * 35) : 135 + r() * 20;
    const s = at * l.len;
    // Not on top of one already there.
    if (this.cars.some(c => c.line === l && Math.abs(c.s - s) < 60)) return;
    const p = along(l, s);
    this.cars.push({ res, line: l, s, speed, pace: speed, x: p.x, y: p.y, dx: p.dx, dy: p.dy, kind, siren: kind === 'car' ? null : (this.env.sirenOk() ? new Siren(kind) : null) });
  }

  /** One step of `dt` seconds of the street's clock. */
  step(dt: number) {
    if (!dt) return;
    this.time += dt;
    const r = this.r;
    // ---- traffic
    if (this.vehiclesOn) {
      if ((this.nextCar -= dt) <= 0 && this.cars.filter(c => c.kind === 'car').length < this.counts.vehicles) { this.spawnCar(); this.nextCar = 1.5 + r() * 4; }
      if ((this.nextSiren -= dt) <= 0) {
        // A police car every 60–120 s; one time in four an ambulance instead (on its way to 大久保病院).
        if (!this.cars.some(c => c.kind !== 'car')) this.spawnCar(0, r() < 0.25 ? 'ambulance' : 'police');
        this.nextSiren = 60 + r() * 60;
      }
    } else if (this.cars.length) { for (const c of this.cars) c.siren?.stop(); this.cars = []; }
    for (const c of this.cars) {
      c.pace = c.speed;
      for (const o of this.cars) {
        if (o === c) continue;
        const ax = o.x - c.x, ay = o.y - c.y, ahead = ax * c.dx + ay * c.dy, side = Math.abs(-ax * c.dy + ay * c.dx);
        if (ahead > 0 && ahead < 48 && side < 6) c.pace = Math.min(c.pace, ahead < 30 ? 0 : o.pace);
      }
      c.s += c.pace * dt;
      const p = along(c.line, c.s);
      c.x = p.x; c.y = p.y; c.dx = p.dx; c.dy = p.dy;
    }
    for (const c of this.cars) if (c.s >= c.line.len) c.siren?.stop();
    this.cars = this.cars.filter(c => c.s < c.line.len);
    // ---- the train: in from the north, stands at the platform, back out north
    const T = this.train;
    T.t += dt;
    if (T.state === 'away' && T.t > T.wait) { T.state = 'in'; T.t = 0; }
    if (T.state === 'in') {
      const u = Math.min(1, T.t / 16), e = 1 - (1 - u) * (1 - u);       // brakes into the platform
      T.front = -900 + (RAIL_END - 12 + 900) * e;
      if (u >= 1) { T.state = 'dwell'; T.t = 0; }
    } else if (T.state === 'dwell' && T.t > 9) { T.state = 'out'; T.t = 0; }
    else if (T.state === 'out') {
      const u = T.t / 16;
      T.front = RAIL_END - 12 - (RAIL_END + 900) * u * u;
      if (u >= 1) { T.state = 'away'; T.t = 0; T.wait = 18 + r() * 25; T.front = -900; }
    }
    // ---- crows: peck about; now and then one flies off (and lands again later)
    for (const c of this.crows) {
      if (c.away > 0) { c.away -= dt; continue; }
      if ((c.t -= dt) <= 0) {
        const u = r();
        c.frame = u < 0.5 ? 1 : u < 0.75 ? 2 : u < 0.97 ? 0 : 3;
        c.t = c.frame === 3 ? 0.4 : 0.4 + r() * 1.4;
        if (c.frame === 3 && this.flyers.length < 4) {
          c.away = 20 + r() * 30;
          const a = r() * 6.28;
          this.flyers.push({ x: c.x, y: c.y, z: 4, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, flap: 0, life: 12 });
        }
      }
    }
    // A crow crossing high over the district now and then.
    if (this.flyers.length < this.counts.crows && r() < dt / 9) {
      const fromW = r() < 0.5, y = 200 + r() * 1900;
      this.flyers.push({ x: fromW ? -100 : 2400, y, z: 140 + r() * 80, vx: (fromW ? 1 : -1) * (75 + r() * 30), vy: (r() - 0.5) * 40, flap: r() * 6, life: 40 });
    }
    for (const f of this.flyers) {
      f.x += f.vx * dt; f.y += f.vy * dt; f.flap += dt * 9; f.life -= dt;
      if (f.z < 150) f.z += dt * 30;
    }
    this.flyers = this.flyers.filter(f => f.life > 0);
    // ---- puffs
    for (const p of this.puffs) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz *= Math.pow(0.7, dt); }
    this.puffs = this.puffs.filter(p => p.age < p.life);
    if ((this.blinkNext -= dt) <= 0) { this.blink = 0.16; this.blinkNext = 3 + r() * 5; }
    this.blink = Math.max(0, this.blink - dt);
    this.steamClock += dt;
    this.smokeNext -= dt;
  }

  /** Whether a map point lies on the avenues or the rails (street props there are not drawn while they are). */
  static onRoad(x: number, y: number): boolean {
    const m = HALF + 9;
    return Math.abs(y - AVE_N) < m || Math.abs(y - AVE_S) < m || Math.abs(x - AVE_E) < m || (Math.abs(x - RAIL_X) < 46 && y < RAIL_END + 16);
  }

  /** Stops every sound (the map closes, or the street is switched off). */
  silence() { for (const c of this.cars) { c.siren?.stop(); c.siren = null; } }

  /** The avenues and the rails, painted on the ground (the context holds the map's ground transform). */
  drawGround(ctx: CanvasRenderingContext2D) {
    ctx.save();
    const road = '#2a2433', edge = 'rgba(245, 214, 90, .85)', dash = 'rgba(240, 240, 240, .75)';
    ctx.fillStyle = 'rgba(70, 64, 78, .9)';                    // kerbs / pavement edge
    ctx.fillRect(-40, AVE_N - HALF - 5, 2384, 2 * HALF + 10);
    ctx.fillRect(-40, AVE_S - HALF - 5, 2384, 2 * HALF + 10);
    ctx.fillRect(AVE_E - HALF - 5, -40, 2 * HALF + 10, 2384);
    ctx.fillStyle = road;
    ctx.fillRect(-40, AVE_N - HALF, 2384, 2 * HALF);
    ctx.fillRect(-40, AVE_S - HALF, 2384, 2 * HALF);
    ctx.fillRect(AVE_E - HALF, -40, 2 * HALF, 2384);
    ctx.lineWidth = 1.6; ctx.strokeStyle = edge;
    ctx.beginPath();
    for (const y of [AVE_N - HALF + 3, AVE_N + HALF - 3, AVE_S - HALF + 3, AVE_S + HALF - 3]) {
      ctx.moveTo(-40, y); ctx.lineTo(AVE_E - HALF, y); ctx.moveTo(AVE_E + HALF, y); ctx.lineTo(2344, y);
    }
    for (const x of [AVE_E - HALF + 3, AVE_E + HALF - 3]) {
      ctx.moveTo(x, -40); ctx.lineTo(x, AVE_N - HALF); ctx.moveTo(x, AVE_N + HALF); ctx.lineTo(x, AVE_S - HALF); ctx.moveTo(x, AVE_S + HALF); ctx.lineTo(x, 2344);
    }
    ctx.stroke();
    ctx.setLineDash([14, 12]); ctx.lineWidth = 1.4; ctx.strokeStyle = dash;
    ctx.beginPath();
    for (const y of [AVE_N, AVE_S]) { ctx.moveTo(-40, y); ctx.lineTo(AVE_E - HALF - 8, y); ctx.moveTo(AVE_E + HALF + 8, y); ctx.lineTo(2344, y); }
    ctx.moveTo(AVE_E, -40); ctx.lineTo(AVE_E, AVE_N - HALF - 8);
    ctx.moveTo(AVE_E, AVE_N + HALF + 8); ctx.lineTo(AVE_E, AVE_S - HALF - 8);
    ctx.moveTo(AVE_E, AVE_S + HALF + 8); ctx.lineTo(AVE_E, 2344);
    ctx.stroke();
    ctx.setLineDash([]);
    // Zebra crossings beside the two junctions.
    ctx.fillStyle = 'rgba(240, 240, 240, .7)';
    for (const yc of [AVE_N, AVE_S]) {
      for (const xc of [AVE_E - HALF - 14, AVE_E + HALF + 14]) for (let k = -HALF + 4; k < HALF - 4; k += 7) ctx.fillRect(xc - 6, yc + k, 12, 3.5);
      for (const yy of [yc - HALF - 14, yc + HALF + 14]) for (let k = -HALF + 4; k < HALF - 4; k += 7) ctx.fillRect(AVE_E + k, yy - 6, 3.5, 12);
    }
    // The rails: ballast, sleepers, two rails, the platform and the buffer stop.
    ctx.fillStyle = 'rgba(92, 84, 92, .95)';
    ctx.fillRect(RAIL_X - 14, -40, 28, RAIL_END + 50);
    ctx.fillStyle = 'rgba(60, 46, 40, .95)';
    for (let y = -36; y < RAIL_END + 6; y += 9) ctx.fillRect(RAIL_X - 11, y, 22, 3.5);
    ctx.strokeStyle = 'rgba(200, 200, 210, .95)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const dx of [-6, 6]) { ctx.moveTo(RAIL_X + dx, -40); ctx.lineTo(RAIL_X + dx, RAIL_END + 6); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(178, 172, 168, .96)';
    ctx.fillRect(RAIL_X + 15, PLATFORM[0], 26, PLATFORM[1] - PLATFORM[0]);
    ctx.fillStyle = 'rgba(250, 210, 60, .9)';
    ctx.fillRect(RAIL_X + 15, PLATFORM[0], 2.2, PLATFORM[1] - PLATFORM[0]);
    ctx.fillStyle = '#c33';
    ctx.fillRect(RAIL_X - 10, RAIL_END + 6, 20, 5);
    ctx.restore();
  }

  /** Every ambient drawing near the view, for the board's y-sorted list. */
  collect(v: StreetView, add: AddItem, streetOn: boolean) {
    const z = v.zoom, now = performance.now(), dt = this.lastCollect ? Math.min(0.2, (now - this.lastCollect) / 1000) : 0;
    this.lastCollect = now;
    // ---- vehicles
    for (const c of this.cars) {
      const p = v.visible(c.x, c.y, 90);
      if (c.siren) { const q = p ?? v.project(c.x, c.y); c.siren.update(q.x, q.y, v.W, v.H, this.env.sirenOk(), dt); }
      if (!p) continue;
      const k = nearestView(screenDeg(v, c.dx, c.dy));
      add(p.y, () => {
        v.sprite(c.res, k, p.x, p.y);
        if (c.kind !== 'car') this.lights(v, p.x, p.y - (c.kind === 'police' ? 19 : 23) * ZUP * z, c);
      });
    }
    // ---- the train (four cars, 100 px apart)
    if (this.vehiclesOn && this.train.state !== 'away') {
      const T = this.train, heading = T.state === 'out' ? -1 : 1, k = nearestView(screenDeg(v, 0, heading));
      for (let i = 0; i < 4; i++) {
        const y = T.front - 50 - i * 100;
        if (y < -120 || y > RAIL_END) continue;
        const p = v.visible(RAIL_X, y, 160);
        if (p) add(p.y, () => v.sprite(AMB.train, k, p.x, p.y));
      }
    }
    if (!streetOn) return;
    // ---- people standing about, the busker, the touts, the sitters
    const t = this.time;
    for (const [i, f] of FOLK.entries()) {
      const p = v.visible(f.x, f.y, 60);
      if (!p) continue;
      const fr = f.fps ? Math.floor(t * f.fps + i * 1.7) % 4 : 0;
      add(p.y, () => v.sprite(f.res, fr, p.x, p.y, f.flip));
    }
    for (const [i, l] of LOITER.entries()) {
      const p = v.visible(l.x, l.y, 60);
      if (!p) continue;
      // Each turns a little now and then (a glance aside), mostly facing its group.
      const glance = Math.sin(t * 0.37 + i * 2.1) > 0.82 ? 50 : 0, face = l.face + glance;
      const a = face / DEG, deg = screenDeg(v, Math.cos(a), Math.sin(a));
      add(p.y, () => this.standing(v, l.kind, deg, p.x, p.y, Math.sin(t * 0.21 + i) > 0.3));
    }
    // ---- crows on the ground and in the air
    for (const c of this.crows) {
      if (c.away > 0) continue;
      const p = v.visible(c.x, c.y, 30);
      if (p) add(p.y, () => v.sprite(AMB.crow, c.frame, p.x, p.y));
    }
    for (const f of this.flyers) {
      const p = v.visible(f.x, f.y, 120);
      if (!p) continue;
      const sy = p.y - f.z * ZUP * z, dir = v.toScreen(f.vx, f.vy);
      add(p.y + 4000, () => flyer(v.ctx, p.x, sy, z, Math.sin(f.flap), dir.x < 0));
    }
    // ---- the landmarks' own life: the kaiju, the big screen, the stalls' steam
    for (const lm of this.env.landmarks()) {
      const p = v.visible(lm.x, lm.y, 260);
      if (!p) continue;
      const frame = (8 - lm.facing - v.rot) & 7;
      if (lm.res === KAIJU) add(p.y + 0.01, () => this.kaiju(v, frame, p.x, p.y, lm));
      else if (lm.res === SCREEN) add(p.y + 0.01, () => this.screen(v, frame, p.x, p.y));
      else if (lm.res === YATAI) this.emit(lm.x, lm.y, 22, 0.3, 1);
    }
    for (const s of this.env.steamers()) if (v.visible(s.x, s.y, 120)) this.emit(s.x, s.y, s.z, 0.55, 0.85);
    for (const p of this.puffs) {
      const q = v.visible(p.x, p.y, 200);
      if (!q) continue;
      add(q.y + 0.02, () => this.puff(v, q.x, q.y - p.z * z, p));
    }
  }

  /** A steam source at map (x, y), h original px above the ground: a puff every `every` seconds while seen. */
  private emit(x: number, y: number, h: number, every: number, grey: number) {
    const id = x * 4096 + y, key = Math.floor(this.steamClock / every + ((x * 7 + y * 13) % 97) / 97);
    if (this.emitted.get(id) === key) return;
    this.emitted.set(id, key);
    if (this.puffs.length > 120) return;
    const r = this.r;
    this.puffs.push({ x: x + (r() - 0.5) * 6, y: y + (r() - 0.5) * 4, z: h, vx: 2 + r() * 3, vy: -1 - r() * 2, vz: 12 + r() * 6, age: 0, life: 2.6 + r(), size: 6 + r() * 3, grey });
  }

  /** The kaiju over its landmark: eyes glowing (blinking now and then) and a smoke puff from its mouth. */
  private kaiju(v: StreetView, frame: number, sx: number, sy: number, at: { x: number; y: number }) {
    const ctx = v.ctx, z = v.zoom, eyes = KAIJU_EYES[frame] ?? [];
    const glow = 0.6 + 0.4 * Math.sin(this.time * 2.2);
    ctx.save();
    for (const [ex, ey, er] of eyes) {
      const x = sx + ex * z, y = sy + ey * z, rr = er * z;
      if (this.blink > 0) {
        ctx.fillStyle = '#5b4bb5';
        ctx.beginPath(); ctx.ellipse(x, y, rr * 1.15, rr * 1.15, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2b2160'; ctx.lineWidth = Math.max(1, rr * 0.18);
        ctx.beginPath(); ctx.moveTo(x - rr, y + rr * 0.15); ctx.quadraticCurveTo(x, y + rr * 0.55, x + rr, y + rr * 0.15); ctx.stroke();
        continue;
      }
      // The eyes light up golden (a soft fill over the white) inside a warm halo, breathing slowly.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255, 214, 60, ${0.3 + 0.35 * glow})`;
      ctx.beginPath(); ctx.ellipse(x, y, rr * 0.95, rr * 0.95, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, rr * 0.5, x, y, rr * 3);
      g.addColorStop(0, `rgba(255, 220, 90, ${0.75 * glow})`);
      g.addColorStop(0.5, `rgba(255, 150, 40, ${0.35 * glow})`);
      g.addColorStop(1, 'rgba(255, 110, 30, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rr * 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    const m = KAIJU_MOUTH[frame];
    if (m && this.smokeNext <= 0) {
      // A gentle puff of three little clouds from its mouth every 7–12 s.
      this.smokeNext = 7 + this.r() * 5;
      for (let i = 0; i < 3; i++) this.puffs.push({ x: at.x, y: at.y, z: -m[1] - 2 + i * 2, vx: 3 + i, vy: -2, vz: 9 + i * 2, age: -i * 0.3, life: 3.4, size: 7 + 2 * i, grey: 0.8, ox: m[0] });
    }
  }

  /** A soft puff of steam or smoke (grows and fades). */
  private puff(v: StreetView, sx: number, sy: number, p: Puff) {
    if (p.age < 0) return;
    const ctx = v.ctx, k = p.age / p.life, s = p.size * (1 + 1.6 * k) * v.zoom;
    const img = this.puffImg ??= puffSprite();
    if (!img) return;
    const ox = (p.ox ?? 0) * v.zoom;
    ctx.save();
    ctx.globalAlpha = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * 0.75 * p.grey;
    ctx.drawImage(img, sx + ox - s, sy - s, 2 * s, 2 * s);
    ctx.restore();
  }

  /** Flashing roof lights of a police car or an ambulance (left / right alternating, red; the police car blue too). */
  private lights(v: StreetView, x: number, y: number, c: Vehicle) {
    const ctx = v.ctx, z = v.zoom, on = Math.floor(this.time * 6) % 2, rr = 13 * z;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const lit = (side < 0) === (on === 0);
      if (!lit) continue;
      const cx = x + side * 4 * z, col = c.kind === 'police' || side < 0 ? '255, 40, 40' : '255, 60, 60';
      const g = ctx.createRadialGradient(cx, y, 0, cx, y, rr);
      g.addColorStop(0, `rgba(${col}, .9)`); g.addColorStop(1, `rgba(${col}, 0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, y, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** A walker standing still facing screen angle `deg` (standing frame; `phone`: a little glowing phone). */
  private standing(v: StreetView, kind: number, deg: number, x: number, y: number, phone: boolean) {
    const f = walkerFacing(kind, deg);
    v.sprite(1801 + kind, f.row * 4, x, y, f.flip);
    if (phone) phoneGlow(v.ctx, x, y, v.zoom, deg);
  }

  /** The big video screen (landmark map/1763): its blank cyan panel shows moving colours. */
  private screen(v: StreetView, frame: number, sx: number, sy: number) {
    const ff = this.frameInfo?.(SCREEN, frame);
    if (!ff) return;
    let mask = this.screens.get(ff.img);
    if (mask === undefined) { mask = screenMask(ff.img); this.screens.set(ff.img, mask); }
    if (!mask) return;
    const s = v.zoom * ff.scale, dx = sx - ff.ax * s, dy = sy - ff.ay * s, dw = ff.w * s, dh = ff.h * s;
    const c = this.scratch ??= document.createElement('canvas');
    if (c.width !== mask.width || c.height !== mask.height) { c.width = mask.width; c.height = mask.height; }
    const x = c.getContext('2d')!, t = Math.floor(this.time * 12) / 12, W = c.width, H = c.height;
    x.globalCompositeOperation = 'source-over';
    const hue = (t * 40) % 360;
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${hue}, 90%, 62%)`); g.addColorStop(0.5, `hsl(${(hue + 70) % 360}, 95%, 58%)`); g.addColorStop(1, `hsl(${(hue + 150) % 360}, 90%, 60%)`);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255, 255, 255, .35)';
    for (let i = 0; i < 3; i++) {
      const p = ((t * 0.45 + i / 3) % 1) * (W + H) - H;
      x.beginPath(); x.moveTo(p, 0); x.lineTo(p + W * 0.08, 0); x.lineTo(p + W * 0.08 + H, H); x.lineTo(p + H, H); x.fill();
    }
    if (t % 6 < 0.25) { x.fillStyle = 'rgba(255, 255, 255, .5)'; x.fillRect(0, 0, W, H); }
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(mask, 0, 0);
    v.ctx.save();
    v.ctx.globalAlpha = 0.82;
    v.ctx.drawImage(c, dx, dy, dw, dh);
    v.ctx.restore();
  }

  /** How the board reads a decoded sprite frame (set by the street). */
  frameInfo: ((res: number, frame: number) => { img: CanvasImageSource; ax: number; ay: number; w: number; h: number; scale: number } | null) | null = null;
}


/** The small glow of a phone held at chest height in front of a standing figure. */
export function phoneGlow(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, deg: number) {
  const a = deg / DEG, px = x + Math.cos(a) * 4 * z, py = y - 21 * z + Math.sin(a) * 2 * z;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(px, py, 0, px, py, 6 * z);
  g.addColorStop(0, 'rgba(150, 230, 255, .85)'); g.addColorStop(1, 'rgba(120, 200, 255, 0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 6 * z, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** A crow in flight: a dark body and two wings beating (`flap` −1..1). */
function flyer(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, flap: number, left: boolean) {
  const s = 7 * z, d = left ? -1 : 1;
  ctx.save();
  ctx.fillStyle = '#1d1a24'; ctx.strokeStyle = '#1d1a24'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.2, 1.6 * z);
  ctx.beginPath(); ctx.ellipse(x, y, s * 0.55, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + d * s * 0.55, y - s * 0.08, s * 0.2, 0, Math.PI * 2); ctx.fill();
  const wy = y - flap * s * 0.8;
  ctx.beginPath(); ctx.moveTo(x - s * 0.1, y); ctx.quadraticCurveTo(x - d * s * 0.3, wy - s * 0.2, x - d * s * 0.9, wy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.1, y); ctx.quadraticCurveTo(x + d * s * 0.1, wy - s * 0.35, x + d * s * 0.25, wy - s * 0.1); ctx.stroke();
  ctx.restore();
}

/** One soft round puff (radial gradient), drawn scaled for every puff. */
function puffSprite(): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d')!, g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)'); g.addColorStop(0.55, 'rgba(240, 240, 248, .55)'); g.addColorStop(1, 'rgba(230, 230, 240, 0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return c;
  } catch { return null; }
}

/** The big screen's blank panel (bright cyan pixels) of a decoded frame, at half size; null when it has none. */
function screenMask(img: CanvasImageSource): HTMLCanvasElement | null {
  try {
    const W0 = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width, H0 = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
    const w = Math.max(1, Math.round(W0 / 2)), h = Math.max(1, Math.round(H0 / 2));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h), px = d.data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
      const on = a > 200 && b > 190 && g > 170 && r < 150 && b - r > 80;
      if (on) n++;
      px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = on ? 255 : 0;
    }
    if (n < (w * h) / 60) return null;
    x.putImageData(d, 0, 0);
    return c;
  } catch { return null; }
}

/** For tests: the angle the train / a car is drawn at for a heading. */
export const _test = { viewAngle, nearestView };
