/**
 * 清明上河's three 梁山 mini-games as plain numbers (docs/rules/35, the user 2026-11-20/23): what qm-games.ts asks of
 * them moment by moment. No DOM here. All three are 15-second runs that an ordinary hand gets to about 13 s, the last two
 * seconds left for the very quick (the user 2026-11-23: 「大部分人能撐到13秒就行，留兩秒是極限挑戰」).
 *
 * - 景陽岡打虎: the red spots' pace — at the start one every 1.1 s, lit 1.3 s; at 15 s two at a time every 0.65 s, lit
 *   0.5 s (the lit time shrinking slowly at first and fast at the end); an ordinary hand gets under 100 點券.
 * - 野豬林射野豬: the waves (0–3 s one by one, slow; 3–6 s two at once, normal and big; 6–10.5 s three with kings; from
 *   10.5 s the big pack, six and more, faster and faster; few boars before it, so an ordinary hand gets under 100 點券) and the three boars (1 / 2 / 3 arrows, 3 / 5 / 10 點券; the user 2026-11-23: 「野豬改成3、5、10」).
 * - 相撲擂台: 15 s against 燕青 — every stop of the slider a strike (red 50 %, orange 34 %, yellow 25 %, else 10 %), the
 *   red zone moving, the bands narrower and the slider quicker each time (wide and slow at first); 燕青 throws you at 4, 8 and 12 s (25 % each, a moment out of the
 *   fight) and at 15 s his last throw floors you; floor him first to win.
 */

/** A random number 0 ≤ r < 1 (Math.random on screen; a fixed sequence in the tests). */
export type Rnd = () => number;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

// ---------------------------------------------------------------- 景陽岡打虎

export const TIGER_SECS = 15;
/**
 * The pace at second t: a new spot (or `burst` at once) every `every` s, each lit `life` s, at most `max` lit at once.
 * Few spots over the run (an ordinary hand meets about 19 by 13 s, ≈ 95 點券 — the user 2026-11-23: 「讓一般玩家控制
 * 在100點券以內」); the difficulty is the lit time shrinking and the spots coming two at a time near the end.
 */
/** (the first 3 s each spot stays up to half a second longer, so a first-timer sees what to do — the user 2026-11-24) */
export function tigerPace(t: number, secs = TIGER_SECS): { every: number; life: number; max: number; burst: number } {
  const k = clamp01(t / secs);
  return { every: 1 / lerp(1 / 1.1, 1 / 0.65, k), life: lerp(1.3, 0.5, Math.pow(k, 1.6)) + 0.5 * Math.max(0, 1 - t / 3), max: 4, burst: 1 + Math.floor(Math.pow(k, 1.5) * 1.999) };
}
/** How many spots a perfect player meets in `secs` (the pace alone, never held back by `max`): about 33. */
export function tigerSpotsFull(secs = TIGER_SECS, dt = 0.001): number {
  let n = 0, next = 0;
  for (let t = 0; t < secs; t += dt) if (t >= next) { n += 1; next = t + tigerPace(t, secs).every; }
  return n;
}

/** An area of the tiger a spot can sit on: an ellipse in fractions of its picture (x, y the centre; rx, ry the radii). */
export interface Area { part: string; x: number; y: number; rx: number; ry: number }
/** A spot: which area, and where inside it (u, v on the unit disc), so it keeps its place on the other picture. */
export interface SpotAt { area: number; u: number; v: number }
/** A point on the unit disc, picked evenly. */
export function discPoint(rnd: Rnd): { u: number; v: number } {
  const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.85;
  return { u: Math.cos(a) * r, v: Math.sin(a) * r };
}
export function spotXY(areas: readonly Area[], s: SpotAt): { x: number; y: number } {
  const a = areas[s.area % areas.length];
  return { x: a.x + a.rx * s.u, y: a.y + a.ry * s.v };
}
/**
 * A new spot on an area none of the lit ones uses (a different part of the tiger each time, as far as there are
 * parts free), never the area of the last one.
 */
export function pickSpot(areas: readonly Area[], lit: readonly SpotAt[], last: number, rnd: Rnd): SpotAt {
  const busy = new Set(lit.map(s => s.area));
  let free = areas.map((_, i) => i).filter(i => !busy.has(i) && i !== last);
  if (!free.length) free = areas.map((_, i) => i).filter(i => !busy.has(i));
  if (!free.length) free = areas.map((_, i) => i);
  const area = free[Math.floor(rnd() * free.length) % free.length];
  return { area, ...discPoint(rnd) };
}

// ---------------------------------------------------------------- 野豬林射野豬

export const BOAR_SECS = 15;
/** 普通野豬, 高級野豬 (tusks, big), 野豬王 (mane, red eyes). */
export const BOARS = [
  { name: '普通野豬', arrows: 1, points: 3 },
  { name: '高級野豬', arrows: 2, points: 5 },
  { name: '野豬王', arrows: 3, points: 10 },
] as const;
export interface Wave {
  /** How many boars run at once (new ones come while fewer are out). */
  target: number;
  /** Seconds at least between two new boars. */
  gap: number;
  /** Seconds a boar takes from the far end of the track to the line. */
  cross: number;
  /** Chance of each kind (normal, big, king), summing to 1. */
  mix: [number, number, number];
}
export function boarWave(t: number): Wave {
  if (t < 3) return { target: 1, gap: 0.9, cross: 4.4, mix: [1, 0, 0] };
  if (t < 6) return { target: 2, gap: 0.9, cross: 3.8, mix: [0.6, 0.4, 0] };
  if (t < 10.5) return { target: 3, gap: 0.72, cross: 3.4, mix: [0.4, 0.4, 0.2] };
  return { target: 6 + Math.floor((t - 10.5) / 0.5), gap: 0.15, cross: Math.max(1.4, 2.3 - 0.25 * (t - 10.5)), mix: [0.35, 0.38, 0.27] };
}
export function boarKind(w: Wave, rnd: Rnd): 0 | 1 | 2 {
  const r = rnd();
  return r < w.mix[0] ? 0 : r < w.mix[0] + w.mix[1] ? 1 : 2;
}

// ---------------------------------------------------------------- 相撲擂台

export const WRESTLE_SECS = 15;
/** The bands' widths as fractions of the bar: the red zone, then orange and yellow on each side of it. */
export interface Bands { red: number; orange: number; yellow: number }
/**
 * The bands at the n-th strike (0 first): wide at the start and narrower every strike — red 30 %, then 10 %, then 5 %
 * from the third on (the user 2026-11-25: 「第一下至少得佔30%，第二下佔個10%，第三下佔5%，別太難了」).
 */
export const BAND_STEPS: readonly Bands[] = [
  { red: 0.3, orange: 0.08, yellow: 0.09 },
  { red: 0.1, orange: 0.05, yellow: 0.06 },
  { red: 0.05, orange: 0.035, yellow: 0.045 },
];
export function bandsAt(n: number): Bands { return BAND_STEPS[Math.max(0, Math.min(BAND_STEPS.length - 1, Math.floor(n)))]; }
export const HIT_DAMAGE = { red: 50, orange: 34, yellow: 25, miss: 10 } as const;
export type Band = keyof typeof HIT_DAMAGE;
/** 燕青's throws (seconds into the bout), 25 % each; at WRESTLE_SECS his last one floors you. */
export const YAN_AT = [4, 8, 12], YAN_DAMAGE = 25;
/** After a strike, the seconds before the slider runs again (the shove, 燕青 back on guard); after a throw, out of it. */
export const STRIKE_RECOVER = 2.0, THROW_STUN = 1.5;
/** The slider must run this long before a tap stops it (no tapping through the shove). */
export const MIN_RUN = 0.3;
/** The red zone's left edge, so that the zone and both its bands lie inside the bar (left, middle or right). */
export function redZone(rnd: Rnd, w: Bands): number {
  const side = w.orange + w.yellow;
  return side + rnd() * (1 - w.red - 2 * side);
}
/** Where the slider stopped (0..1 along the bar), the red zone's left edge: the band and what it takes off 燕青. */
export function bandAt(pos: number, red: number, w: Bands): Band {
  const d = pos < red ? red - pos : pos > red + w.red ? pos - red - w.red : 0;
  if (d === 0) return 'red';
  if (d <= w.orange) return 'orange';
  if (d <= w.orange + w.yellow) return 'yellow';
  return 'miss';
}
/** Seconds for one sweep of the slider across the bar at the n-th strike (0 first): easy, then quicker each time. */
export function sweepSecs(n: number): number { return Math.max(0.3, 0.6 * Math.pow(0.82, n)); }
/** The slider's place at time s into a strike: back and forth across the bar, one sweep each `sweep` seconds. */
export function sliderAt(s: number, sweep: number): number {
  const k = (s / sweep) % 2;
  return k <= 1 ? k : 2 - k;
}
