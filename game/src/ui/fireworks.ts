/**
 * The fireworks when a lot reaches level 5 (`fcn_0040b0cd`; the original plays the clip Data#523, 66 frames ×
 * 42 ms), drawn in code instead of the clip: rockets rise with sparkling tails from round the building and burst
 * into glowing stars — peony, chrysanthemum, ring, willow, crackle — that slow down, fall and fade, the bursts
 * overlapping so it reads as one show. Positions are original px relative to the spot (the view's projection
 * places them, so the show follows the camera and the zoom); time is real time at the display's frame rate; the
 * number of stars follows the device and drops while frames get slow. No pictures to decode: one small glow dot
 * per colour is painted once and reused (~130 KB in all).
 */

/** As long as the original clip (66 × 42 ms), so the game waits the same. */
export const FIREWORKS_MS = 2772;
const END = FIREWORKS_MS / 1000;

/** Bright cartoon colours: [r, g, b]. */
const COLORS: readonly (readonly [number, number, number])[] = [
  [255, 210, 60],  // 0 gold
  [255, 60, 84],   // 1 red
  [60, 228, 255],  // 2 cyan
  [255, 80, 214],  // 3 magenta
  [92, 255, 110],  // 4 green
  [255, 246, 222], // 5 silver
  [255, 142, 40],  // 6 orange
  [168, 122, 255], // 7 violet
];
const GOLD = 0, SILVER = 5, ORANGE = 6;
/** Colours a peony / ring / chrysanthemum may take (gold and silver are the willow's and the crackle's). */
const BRIGHT = [1, 2, 3, 4, 7, 0, 6];

type Kind = 'peony' | 'chrys' | 'ring' | 'willow' | 'crackle';

/** One shell: launch time (s), burst position as a share of the room (x −1..1, height 0..1), rise time (s). */
interface Shell { t: number; kind: Kind; x: number; h: number; rise: number }
/** The show: staggered, a few at once at the end (each burst is over before `END`). */
const SHOW: Shell[] = [
  { t: 0.00, kind: 'peony', x: -0.12, h: 0.72, rise: 0.36 },
  { t: 0.15, kind: 'ring', x: 0.62, h: 0.5, rise: 0.38 },
  { t: 0.32, kind: 'chrys', x: -0.66, h: 0.45, rise: 0.4 },
  { t: 0.47, kind: 'willow', x: 0.12, h: 0.98, rise: 0.48 },
  { t: 0.66, kind: 'peony', x: 0.7, h: 0.82, rise: 0.42 },
  { t: 0.82, kind: 'crackle', x: -0.42, h: 0.9, rise: 0.44 },
  { t: 0.98, kind: 'ring', x: -0.8, h: 0.62, rise: 0.4 },
  { t: 1.1, kind: 'chrys', x: 0.42, h: 0.55, rise: 0.4 },
  { t: 1.27, kind: 'peony', x: -0.05, h: 0.86, rise: 0.4 },
  { t: 1.31, kind: 'crackle', x: 0.74, h: 0.72, rise: 0.38 },
  { t: 1.35, kind: 'peony', x: -0.72, h: 0.78, rise: 0.38 },
];

/** Per kind: stars at full quality, radius (original px), drag (1/s), gravity (px/s²), life (s), tail (s of speed), star size. */
const KINDS: Record<Kind, { n: number; r: number; drag: number; grav: number; life: [number, number]; tail: number; size: number }> = {
  peony: { n: 110, r: 104, drag: 2.7, grav: 70, life: [1.0, 1.2], tail: 0.055, size: 4 },
  chrys: { n: 96, r: 112, drag: 2.5, grav: 64, life: [1.05, 1.3], tail: 0.11, size: 3.5 },
  ring: { n: 64, r: 96, drag: 2.9, grav: 60, life: [0.95, 1.08], tail: 0.05, size: 4 },
  willow: { n: 80, r: 116, drag: 1.7, grav: 92, life: [1.5, 1.7], tail: 0.16, size: 3.2 },
  crackle: { n: 72, r: 96, drag: 2.7, grav: 70, life: [0.72, 0.86], tail: 0.045, size: 3.6 },
};

/** Particle kinds. */
const STAR = 0, EMBER = 1, SPARK = 2;
/** Particle flags: leaves a sparkling trail, pops into sparks when it dies, twinkles at the end, changes colour. */
const F_TRAIL = 1, F_POP = 2, F_TWINKLE = 4, F_SHIFT = 8;
/** At most this many particles at once (a full show peaks at ~600). */
const CAP = 1400;

// ------------------------------------------------------------------ device quality

/** 0.3..1: share of the stars drawn. Starts from the device, learns from frame times for the session. */
const quality = { base: 1, level: 1, ema: 16.7 };
{
  const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { deviceMemory?: number } : undefined;
  const cores = nav?.hardwareConcurrency || 4, mem = nav?.deviceMemory ?? 4;
  quality.base = quality.level = cores <= 2 || mem <= 2 ? 0.5 : cores <= 4 ? 0.75 : 1;
}
/** One frame took `ms`: slow frames (under ~42 fps) take stars away at once, fast ones give them back slowly. */
function noteFrame(ms: number) {
  if (!(ms > 0) || ms > 250) return;
  quality.ema += (ms - quality.ema) * 0.2;
  if (quality.ema > 24) quality.level = Math.max(0.3, quality.level * 0.96);
  else if (quality.ema < 18.5) quality.level = Math.min(quality.base, quality.level + 0.003);
}
/** The current quality (tests, debugging). */
export const fireworksQuality = () => quality.level;

// ------------------------------------------------------------------ glow dots

let dots: HTMLCanvasElement[] | null = null;
/** Paints the glow dots (one per colour, 64 px): call in idle time so the first burst does not pay for it. */
export function warmFireworks() {
  if (dots || typeof document === 'undefined') return;
  dots = COLORS.map(([r, g, b]) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!, gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    const mix = (k: number) => `${Math.round(r + (255 - r) * k)}, ${Math.round(g + (255 - g) * k)}, ${Math.round(b + (255 - b) * k)}`;
    gr.addColorStop(0, `rgba(${mix(0.9)}, 1)`);
    gr.addColorStop(0.16, `rgba(${mix(0.5)}, 1)`);
    gr.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, .9)`);
    gr.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, .28)`);
    gr.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return c;
  });
}
/** Tails a little lighter than the star (they are thin; a pure colour reads dark on the bright map). */
const TAIL = COLORS.map(([r, g, b]) => `rgb(${Math.round(r + (255 - r) * 0.25)}, ${Math.round(g + (255 - g) * 0.25)}, ${Math.round(b + (255 - b) * 0.25)})`);

// ------------------------------------------------------------------ the show

/** Room round the spot in original px: above it, to its left and right (the part of the view the show may use). */
export interface Room { up: number; left: number; right: number }

interface Rocket { t0: number; rise: number; x0: number; y0: number; x1: number; y1: number; kind: Kind; c1: number; c2: number; r: number; acc: number; burst: boolean }
interface Flash { x: number; y: number; r: number; c: number; t0: number }

export class Fireworks {
  /** Show time (s): advanced by the frame's real time (a stalled frame counts at most 0.1 s). */
  t = 0;
  /** Real time since the first frame (ms): the show never runs much longer than planned. */
  private wall = 0;
  private shells: Shell[];
  private rockets: Rocket[] = [];
  private flashes: Flash[] = [];
  private level: number;
  // Particles, struct of arrays (no garbage per frame); 0..n-1 alive.
  n = 0;
  /** Most particles alive at once (tests). */
  peak = 0;
  bursts = 0;
  private x = new Float32Array(CAP); private y = new Float32Array(CAP);
  private vx = new Float32Array(CAP); private vy = new Float32Array(CAP);
  private age = new Float32Array(CAP); private life = new Float32Array(CAP);
  private drag = new Float32Array(CAP); private grav = new Float32Array(CAP);
  private tail = new Float32Array(CAP); private size = new Float32Array(CAP);
  private col = new Uint8Array(CAP); private col2 = new Uint8Array(CAP);
  private kind = new Uint8Array(CAP); private flag = new Uint8Array(CAP);

  constructor(private rnd: () => number = Math.random, level?: number) {
    this.level = level ?? quality.level;
    this.shells = SHOW.map(s => ({ ...s, t: s.t + (s.t ? (rnd() - 0.5) * 0.06 : 0), x: s.x + (rnd() - 0.5) * 0.16, h: Math.min(1, s.h + (rnd() - 0.5) * 0.12) }));
  }

  get over() { return this.t >= END || this.wall >= FIREWORKS_MS + 600; }

  /** Advances the show by `ms` of real time; true once it is over. */
  step(ms: number, room: Room): boolean {
    this.wall += ms;
    const dt = Math.min(0.1, Math.max(0, ms / 1000));
    const t = this.t = Math.min(END, this.t + dt);
    // Launches.
    while (this.shells.length && this.shells[0].t <= t) this.launch(this.shells.shift()!, room);
    this.rockets = this.rockets.filter(r => this.rocket(r, t, dt));
    this.flashes = this.flashes.filter(f => t - f.t0 < 0.3);
    this.particles(t, dt);
    this.peak = Math.max(this.peak, this.n);
    return this.over;
  }

  private launch(s: Shell, room: Room) {
    const k = KINDS[s.kind], rnd = this.rnd;
    // A smaller burst where the view is small; inside the room left above and to the sides of the spot.
    const r = Math.max(36, Math.min(k.r * (0.9 + rnd() * 0.2), (room.up - 40) * 0.55, Math.min(room.left, room.right) * 0.6));
    const top = Math.max(70, Math.min(250, room.up - r - 6)), low = Math.min(top, 80);
    const y1 = -(low + (top - low) * s.h);
    const side = s.x < 0 ? room.left : room.right, x1 = s.x * Math.max(0, Math.min(175, side - r - 6));
    const x0 = x1 * 0.45 + (rnd() - 0.5) * 50, y0 = 8 + rnd() * 18;
    let c1: number, c2: number;
    if (s.kind === 'willow') { c1 = GOLD; c2 = ORANGE; }
    else if (s.kind === 'crackle') { c1 = rnd() < 0.5 ? GOLD : SILVER; c2 = c1 === GOLD ? SILVER : GOLD; }
    else {
      c1 = BRIGHT[Math.floor(rnd() * BRIGHT.length)];
      do c2 = BRIGHT[Math.floor(rnd() * BRIGHT.length)]; while (c2 === c1);
    }
    this.rockets.push({ t0: s.t, rise: s.rise, x0, y0, x1, y1, kind: s.kind, c1, c2, r, acc: 0, burst: false });
  }

  /** Rocket position at show time t (eases out: fast off the ground, slowing to the burst). */
  private rocketAt(r: Rocket, t: number) {
    const u = Math.min(1, Math.max(0, (t - r.t0) / r.rise)), e = 1 - (1 - u) * (1 - u);
    return { x: r.x0 + (r.x1 - r.x0) * e + Math.sin(u * 9 + r.x0) * 1.5 * (1 - u), y: r.y0 + (r.y1 - r.y0) * e, u };
  }

  private rocket(r: Rocket, t: number, dt: number): boolean {
    const p = this.rocketAt(r, t);
    // The tail: embers shed along the way, falling and dying fast.
    r.acc += dt * 80 * this.level;
    while (r.acc >= 1) {
      r.acc--;
      const back = this.rnd() * dt;
      const q = this.rocketAt(r, t - back);
      this.spawn(EMBER, q.x + (this.rnd() - 0.5) * 2, q.y, (this.rnd() - 0.5) * 22, 10 + this.rnd() * 30, 0.22 + this.rnd() * 0.22, 2.2, 160, 0, 1.7, this.rnd() < 0.6 ? GOLD : ORANGE, 0, F_TWINKLE);
    }
    if (p.u < 1) return true;
    this.burst(r, t);
    return false;
  }

  private burst(r: Rocket, t: number) {
    const k = KINDS[r.kind], rnd = this.rnd, cx = r.x1, cy = r.y1;
    this.bursts++;
    this.flashes.push({ x: cx, y: cy, r: r.r, c: r.c1, t0: t });
    const n = Math.max(12, Math.round(k.n * this.level)), left = END - t - 0.04;
    const life = () => Math.max(0.2, Math.min(k.life[0] + rnd() * (k.life[1] - k.life[0]), left - (r.kind === 'crackle' ? 0.3 : 0)));
    const v = r.r * k.drag;
    if (r.kind === 'ring') {
      // A tilted ring, and a few stars of the other colour in the middle.
      const tilt = 0.45 + rnd() * 0.5, turn = rnd() * Math.PI, ct = Math.cos(turn), st = Math.sin(turn), a0 = rnd() * 6.3;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2, s = v * (0.97 + rnd() * 0.06);
        const ux = Math.cos(a) * s, uy = Math.sin(a) * s * tilt;
        this.spawn(STAR, cx, cy, ux * ct - uy * st, ux * st + uy * ct, life(), k.drag, k.grav, k.tail, k.size, r.c1, 0, F_TWINKLE);
      }
      for (let i = 0, m = Math.round(n / 4); i < m; i++) this.sphere(cx, cy, v * 0.35, life(), k, r.c2, 0, F_TWINKLE);
      return;
    }
    for (let i = 0; i < n; i++) {
      switch (r.kind) {
        case 'peony': this.sphere(cx, cy, v, life(), k, r.c1, r.c2, F_TWINKLE | F_SHIFT); break;
        case 'chrys': this.sphere(cx, cy, v, life(), k, i % 5 ? r.c1 : r.c2, 0, F_TRAIL | F_TWINKLE); break;
        case 'willow': this.sphere(cx, cy, v, life(), k, i % 3 ? r.c1 : r.c2, 0, F_TRAIL); break;
        case 'crackle': this.sphere(cx, cy, v, life(), k, r.c1, 0, F_POP); break;
      }
    }
  }

  /** A star thrown in a random direction of a sphere seen from the side (denser at the rim, like a real shell). */
  private sphere(cx: number, cy: number, v: number, life: number, k: typeof KINDS[Kind], c: number, c2: number, flags: number) {
    const a = this.rnd() * Math.PI * 2, z = this.rnd() * 2 - 1, s = v * Math.sqrt(1 - z * z) * (0.9 + this.rnd() * 0.1);
    this.spawn(STAR, cx, cy, Math.cos(a) * s, Math.sin(a) * s, life, k.drag, k.grav, k.tail, k.size, c, c2, flags);
  }

  private spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number, drag: number, grav: number, tail: number, size: number, c: number, c2: number, flags: number) {
    const i = this.n;
    if (i >= CAP) return;
    this.n++;
    this.kind[i] = kind; this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.age[i] = 0; this.life[i] = life; this.drag[i] = drag; this.grav[i] = grav; this.tail[i] = tail;
    this.size[i] = size; this.col[i] = c; this.col2[i] = c2; this.flag[i] = flags;
  }

  private particles(t: number, dt: number) {
    const rnd = this.rnd, left = END - t - 0.02;
    for (let i = 0; i < this.n;) {
      const age = this.age[i] += dt;
      if (age >= this.life[i]) {
        // A crackle star pops into a few short white sparks.
        if (this.flag[i] & F_POP && left > 0.08) {
          const x = this.x[i], y = this.y[i], m = rnd() < this.level ? 3 : 2;
          for (let j = 0; j < m; j++) {
            const a = rnd() * 6.283, s = 40 + rnd() * 50;
            this.spawn(SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, Math.min(left, 0.16 + rnd() * 0.16), 5, 40, 0.03, 2, rnd() < 0.5 ? SILVER : GOLD, 0, F_TWINKLE);
          }
        }
        this.kill(i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      // Sparkling trails of the chrysanthemum and the willow.
      if (this.flag[i] & F_TRAIL && age > 0.08 && rnd() < dt * 9 * this.level) {
        this.spawn(EMBER, this.x[i], this.y[i], 0, 6, Math.min(left, 0.25 + rnd() * 0.2), 2, 30, 0, 1.6, this.col[i], 0, F_TWINKLE);
      }
      i++;
    }
  }

  private kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.kind[i] = this.kind[j]; this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
    this.tail[i] = this.tail[j]; this.size[i] = this.size[j]; this.col[i] = this.col[j]; this.col2[i] = this.col2[j]; this.flag[i] = this.flag[j];
  }

  /** Alpha of particle i (0..1): hot at first, fading with age, twinkling at the end. */
  private alpha(i: number, fade: number) {
    const k = this.age[i] / this.life[i];
    let a = Math.pow(1 - k, this.kind[i] === STAR ? 1.15 : 1.6) * fade;
    if (this.flag[i] & F_TWINKLE && k > 0.6 && this.rnd() < 0.4) a *= 0.3;
    return a;
  }

  /**
   * Advances the show by `ms` of real time with the spot at canvas point (qx, qy) (CSS px), `z` CSS px per
   * original px (the shells about to go up stay inside the view). True once it is over.
   */
  advance(ctx: CanvasRenderingContext2D, qx: number, qy: number, z: number, ms: number): boolean {
    noteFrame(ms);
    const tr = ctx.getTransform(), cw = ctx.canvas.width / (tr.a || 1);
    return this.step(ms, { up: Math.max(0, qy) / z, left: Math.max(0, qx) / z, right: Math.max(0, cw - qx) / z });
  }

  /** Draws the show with the spot at canvas point (qx, qy) (CSS px), `z` CSS px per original px. */
  draw(ctx: CanvasRenderingContext2D, qx: number, qy: number, z: number) {
    warmFireworks();
    const D = dots!, t = this.t, fade = Math.min(1, (END - t) / 0.25);
    ctx.save();
    // The sky dims a little while the show goes on, so the colours glow on the bright map.
    const dim = 0.38 * Math.min(1, t / 0.3) * Math.min(1, (END - t) / 0.6);
    if (dim > 0.004) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(10, 12, 40, ${dim.toFixed(3)})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }

    // Burst flashes (additive).
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const u = (t - f.t0) / 0.3, a = (1 - u) * (1 - u) * 0.5 * fade, s = f.r * z * (0.7 + u * 0.6);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(D[f.c], qx + f.x * z - s, qy + f.y * z - s, s * 2, s * 2);
    }

    // Tails: one path per colour and alpha step, drawn as lines over the map (source-over keeps the colour).
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    const STEPS = 3, paths: (Path2D | null)[] = new Array(COLORS.length * STEPS).fill(null);
    const P2D = typeof Path2D !== 'undefined';
    for (let i = 0; P2D && i < this.n; i++) {
      const tl = this.tail[i];
      if (!tl) continue;
      const a = this.alpha(i, fade);
      if (a < 0.05) continue;
      const c = this.color(i), b = c * STEPS + Math.min(STEPS - 1, Math.floor(a * STEPS));
      const x = qx + this.x[i] * z, y = qy + this.y[i] * z;
      const p = paths[b] ??= new Path2D();
      p.moveTo(x - this.vx[i] * tl * z, y - this.vy[i] * tl * z);
      p.lineTo(x, y);
    }
    ctx.lineWidth = Math.max(1, 1.7 * z);
    for (let b = 0; b < paths.length; b++) {
      const p = paths[b];
      if (!p) continue;
      ctx.globalAlpha = ((b % STEPS) + 0.75) / STEPS;
      ctx.strokeStyle = TAIL[Math.floor(b / STEPS)];
      ctx.stroke(p);
    }
    // Rockets: a hot streak and head.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1.2, 2.2 * z);
    ctx.strokeStyle = 'rgb(255, 222, 160)';
    for (const r of this.rockets) {
      if (t < r.t0) continue;
      const p = this.rocketAt(r, t), o = this.rocketAt(r, Math.max(r.t0, t - 0.07));
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(qx + o.x * z, qy + o.y * z); ctx.lineTo(qx + p.x * z, qy + p.y * z); ctx.stroke();
      const s = 15 * z;
      ctx.globalAlpha = 1;
      ctx.drawImage(D[SILVER], qx + p.x * z - s / 2, qy + p.y * z - s / 2, s, s);
    }
    // Stars, embers and sparks: glow dots (additive), larger while hot.
    for (let i = 0; i < this.n; i++) {
      const a = this.alpha(i, fade);
      if (a < 0.02) continue;
      const hot = this.kind[i] === STAR ? 1 + 0.5 * Math.max(0, 1 - this.age[i] / 0.12) : 1;
      const s = this.size[i] * 3.6 * z * hot;
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(D[this.color(i)], qx + this.x[i] * z - s / 2, qy + this.y[i] * z - s / 2, s, s);
    }
    ctx.restore();
  }

  /** Particle colour: a shifting peony takes its second colour half way. */
  private color(i: number) { return this.flag[i] & F_SHIFT && this.age[i] > this.life[i] * 0.5 ? this.col2[i] : this.col[i]; }
}
