/**
 * 歌舞伎町's passers-by (docs/rules/21 §8.1): who walks where, which way each one faces, and the crowd's own small
 * manners (rounded corners, keeping left, following, standing still, walking in pairs). Pure logic and numbers: the
 * board draws the result (ui/kabukicho.ts KbStreet, ui/board-view.ts). Never touches the rules' rand().
 */

/** cos 45°: the board's projection squashes the map's y by it (docs/rules/08 §4.3). */
const K = Math.SQRT1_2;
const DEG = 180 / Math.PI;

/**
 * Screen angle (degrees, 0 = right, 90 = down) of a model that faces +y in blockout view k (θ = −22.5° − 45°·k, the
 * board's own projection): screen = (−sin θ, K cos θ).
 */
export function viewAngle(k: number): number {
  const th = (-22.5 - 45 * k) / DEG;
  return Math.atan2(K * Math.cos(th), -Math.sin(th)) * DEG;
}

/** The smallest difference of two angles in degrees (0..180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}

/** The walkers' sheets: row r is blockout view 2r + 1 (kb_walkers.py VIEWS 1, 3, 5, 7). */
const ROW_VIEW = [1, 3, 5, 7];
/**
 * The screen angle each row of each walker sheet really faces, as the redraws came out (checked by eye on the
 * contact sheet, see kb-crowd.test.ts): null = a row that cannot be used. Default: the blockout's view.
 *  - kimono (1805): row 0 came out facing left-down (the blockout's right-down mirrored);
 *  - tourist (1803): row 3 came out as a back view (it must never be drawn walking towards the viewer).
 */
const ROW_ART: (number | null)[][] = Array.from({ length: 6 }, (_, kind) => ROW_VIEW.map((v, r) => {
  const a = viewAngle(v);
  if (kind === 4 && r === 0) return 180 - a;
  if (kind === 2 && r === 3) return null;
  return a;
}));

/** The row and mirroring that make walker `kind` face screen angle `deg`: the nearest of the 8 (rows × mirrored). */
export function walkerFacing(kind: number, deg: number): { row: number; flip: boolean; err: number } {
  let row = 0, flip = false, err = 999;
  const arts = ROW_ART[kind] ?? ROW_ART[0];
  for (let r = 0; r < 4; r++) {
    const a = arts[r];
    if (a === null) continue;
    const e0 = angleDiff(a, deg), e1 = angleDiff(180 - a, deg);
    if (e0 < err) { row = r; flip = false; err = e0; }
    if (e1 < err) { row = r; flip = true; err = e1; }
  }
  return { row, flip, err };
}

/** The view (0..7) of an 8-view sprite (a model facing +y in view k) nearest screen angle `deg`. */
export function nearestView(deg: number): number {
  let best = 0, err = 999;
  for (let k = 0; k < 8; k++) { const e = angleDiff(viewAngle(k), deg); if (e < err) { err = e; best = k; } }
  return best;
}

// ------------------------------------------------------------------ tracks

type Pt = [number, number];

/** A walkable line in walking order, with its lengths; `links`: where one may go on at its end. */
export interface Track {
  pts: Pt[];
  cum: number[];
  len: number;
  closed: boolean;
  /** The same line walked the other way (itself for a loop). */
  rev: Track;
  links: { via: Track | null; to: Track }[];
}

function measure(pts: Pt[]): { cum: number[]; len: number } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { cum, len: cum[cum.length - 1] };
}

function mkTrack(pts: Pt[], closed: boolean): Track {
  const { cum, len } = measure(pts);
  return { pts, cum, len, closed, rev: null as unknown as Track, links: [] };
}

/** A quadratic Bézier from a to b with control c, as points every ~4 px (the corner's curve). */
function bezier(a: Pt, c: Pt, b: Pt): Pt[] {
  const n = Math.max(3, Math.ceil((Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1])) / 4));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** A polyline with every inner corner (and a loop's closing one) rounded with a radius of about r. */
export function roundCorners(pts: Pt[], closed: boolean, r = 12): Pt[] {
  const P = closed && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1 ? pts.slice(0, -1) : pts.slice();
  const n = P.length;
  if (n < 3 && !closed) return P;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const cur = P[i];
    if (!closed && (i === 0 || i === n - 1)) { out.push(cur); continue; }
    const prev = P[(i - 1 + n) % n], next = P[(i + 1) % n];
    const l1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]), l2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const k = Math.min(r, l1 / 2, l2 / 2);
    if (k < 1) { out.push(cur); continue; }
    const a: Pt = [cur[0] + (prev[0] - cur[0]) * k / l1, cur[1] + (prev[1] - cur[1]) * k / l1];
    const b: Pt = [cur[0] + (next[0] - cur[0]) * k / l2, cur[1] + (next[1] - cur[1]) * k / l2];
    out.push(...bezier(a, cur, b));
  }
  if (closed) out.push(out[0]);
  return out;
}

const dirAt = (t: Track, end: boolean): Pt => {
  const p = t.pts, n = p.length;
  const a = end ? p[n - 2] : p[0], b = end ? p[n - 1] : p[1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

/**
 * The network the crowd walks: every path both ways (corners rounded), each open end linked to the ends of the
 * other sidewalks close by (round the corner, or straight on over the crossing), joined by a short curve; an end
 * with nowhere to go turns back.
 */
export function buildTracks(paths: Pt[][], reach = 100): Track[] {
  const out: Track[] = [];
  for (const raw of paths) {
    if (raw.length < 2) continue;
    const closed = raw.length > 2 && Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 1;
    const pts = roundCorners(raw, closed);
    const f = mkTrack(pts, closed);
    if (f.len <= 0) continue;
    if (closed) { f.rev = f; out.push(f); continue; }
    const r = mkTrack(pts.slice().reverse(), false);
    f.rev = r; r.rev = f;
    out.push(f, r);
  }
  for (const t of out) {
    if (t.closed) { t.links.push({ via: null, to: t }); continue; }
    const e = t.pts[t.pts.length - 1], h = dirAt(t, true);
    for (const u of out) {
      if (u.closed || u === t || u === t.rev) continue;
      const s = u.pts[0], d = Math.hypot(s[0] - e[0], s[1] - e[1]);
      if (d > reach) continue;
      const g = dirAt(u, false), turn = h[0] * g[0] + h[1] * g[1];
      if (turn < -0.2) continue;                                               // no U-turn onto another sidewalk
      const ahead = d < 1 ? 1 : ((s[0] - e[0]) * h[0] + (s[1] - e[1]) * h[1]) / d;
      if (ahead < 0.3) continue;                                               // only forwards
      // The curve's control point: where the two lines meet (round the corner), else halfway (straight on).
      const den = h[0] * g[1] - h[1] * g[0];
      let c: Pt = [(e[0] + s[0]) / 2, (e[1] + s[1]) / 2];
      if (Math.abs(den) > 0.3) {
        const k = ((s[0] - e[0]) * g[1] - (s[1] - e[1]) * g[0]) / den;
        if (k > 0 && k < reach) c = [e[0] + h[0] * k, e[1] + h[1] * k];
      }
      const via = d < 1 ? null : mkTrack(bezier(e, c, s), false);
      t.links.push({ via, to: u });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the crowd

export interface Walker {
  kind: number;
  track: Track;
  /** Distance along the track, map px. */
  s: number;
  /** After a connecting curve: the track to go on with. */
  then: Track | null;
  /** Own pace (map px / s) and its slow wobble's phase. */
  speed: number;
  wob: number;
  /** This frame's pace (after following someone slower). */
  pace: number;
  /** Keeping left: the side offset (map px, + = left of the way it walks), and the extra while dodging. */
  lane: number;
  dodge: number;
  /** Position (map px, lane included) and heading (radians in map space, eased). */
  x: number;
  y: number;
  h: number;
  /** Walk-cycle clock in frames (advances with the distance walked: no sliding feet). */
  anim: number;
  /** Seconds still standing, why, and seconds to the next stop. */
  stop: number;
  why: 'phone' | 'window' | 'turn';
  nextStop: number;
  /** Facing while standing at a window (radians). */
  look: number;
  /** In a pair or a group: the one it walks beside / behind and where (map px back, side). */
  lead: Walker | null;
  back: number;
  side: number;
}

/** mulberry32. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A cyclist on the sidewalk (drawn with the 8-view bicycle sprite, ui/kb-ambient.ts). */
export const BIKE = 6;
/** Pace by kind (map px / s): salaryman, OL, tourist, youth, kimono, courier, cyclist. */
const PACE: [number, number][] = [[20, 28], [18, 25], [13, 20], [17, 26], [11, 16], [27, 36], [42, 55]];
/** Walk-cycle frames per map px (≈ 12 frames a second at 22 px/s). */
const STRIDE = 12 / 22;

function pointAt(t: Track, s: number): { x: number; y: number; dx: number; dy: number } {
  const { pts, cum } = t;
  let lo = 1, hi = pts.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; }
  const i = lo, a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, k = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, dx: (b[0] - a[0]) / seg, dy: (b[1] - a[1]) / seg };
}

/**
 * The crowd: `n` walkers on `tracks`, the same for the same seed. `roadDir(x, y)` gives the map direction from a
 * point to the nearest road centre (for turning to a shop window), or null.
 */
export class Crowd {
  readonly walkers: Walker[] = [];
  private r: () => number;
  private grid = new Map<number, Walker[]>();

  /** How busy each track is (its length × the busyness of its middle): where walkers start and which way they turn. */
  private weight = new Map<Track, number>();

  /**
   * `busy(x, y)`: how crowded a spot of the map is (1 = average): the walkers start there more and turn towards it
   * more at the corners, so the busy streets stay busy.
   */
  /** The walker kinds (0..kinds − 1), the cyclists' kind, their paces, and which side people keep to (map y is down). */
  readonly kinds: number;
  readonly bike: number;
  private readonly pace: readonly [number, number][];
  private readonly sideSign: number;

  constructor(readonly tracks: Track[], n: number, seed: number, private roadDir: (x: number, y: number) => [number, number] | null = () => null,
    bikes = 0, busy: (x: number, y: number) => number = () => 1,
    opts: { kinds?: number; pace?: readonly [number, number][]; keepRight?: boolean } = {}) {
    // 歌舞伎町: six kinds, the cyclist 6, keeping left (Japan); 激情歲月 (docs/rules/24 §8): its own kinds, keeping right.
    this.kinds = opts.kinds ?? 6;
    this.bike = this.kinds;
    this.pace = opts.pace ?? PACE;
    this.sideSign = opts.keepRight ? -1 : 1;
    this.r = prng(seed);
    if (!tracks.length) return;
    for (const t of tracks) { const m = t.pts[t.pts.length >> 1]; this.weight.set(t, busy(m[0], m[1])); }
    const r = this.r, total = tracks.reduce((s, t) => s + t.len * this.weight.get(t)!, 0);
    const pick = () => {
      let u = r() * total;
      for (const t of tracks) { const w = t.len * this.weight.get(t)!; if (u < w) return t; u -= w; }
      return tracks[tracks.length - 1];
    };
    while (this.walkers.length < n) {
      const track = pick();
      const lead = this.spawn(track, r() * track.len, Math.floor(r() * this.kinds));
      // About one in four walks with a friend, one in twelve in a group of three.
      const g = r(), mates = g < 0.08 ? 2 : g < 0.3 ? 1 : 0;
      for (let i = 0; i < mates && this.walkers.length < n; i++) {
        const w = this.spawn(track, lead.s, Math.floor(r() * this.kinds));
        w.lead = lead; w.speed = lead.speed;
        w.side = i === 0 ? -7 : 0; w.back = i === 0 ? 1.5 : 8;
        w.anim = lead.anim + 1 + i;
      }
    }
    for (let i = 0; i < bikes; i++) {
      const track = pick(), b = this.spawn(track, r() * track.len, this.bike);
      b.nextStop = Infinity; b.lane = 1;
    }
    for (const w of this.walkers) this.place(w, 0);
  }

  private spawn(track: Track, s: number, kind: number): Walker {
    const r = this.r, [lo, hi] = this.pace[kind] ?? PACE[BIKE];
    const w: Walker = {
      kind, track, s, then: null, speed: lo + r() * (hi - lo), wob: r() * 6.28, pace: 0, lane: 2 + r() * 3, dodge: 0,
      x: 0, y: 0, h: 0, anim: r() * 4, stop: 0, why: 'phone', nextStop: 6 + r() * 30, look: 0, lead: null, back: 0, side: 0,
    };
    w.pace = w.speed;
    this.walkers.push(w);
    return w;
  }

  /** Where a walker is (its lane added) and the heading it eases to; `dt` 0 snaps the heading. */
  private place(w: Walker, dt: number) {
    if (w.lead) {
      const L = w.lead, hx = Math.cos(L.h), hy = Math.sin(L.h);
      w.x = L.x - hx * w.back - hy * w.side; w.y = L.y - hy * w.back + hx * w.side;
      w.h = L.h; w.stop = L.stop; w.why = L.why; w.look = L.look + (w.side ? 0.5 : -0.4);
      return;
    }
    const p = pointAt(w.track, Math.max(0, Math.min(w.track.len, w.s)));
    const want = Math.atan2(p.dy, p.dx);
    if (!dt) w.h = want;
    else {
      let d = want - w.h;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const max = 7 * dt;                                     // turns at most ~400° a second: no instant flips
      w.h += Math.max(-max, Math.min(max, d));
    }
    // Keep left (Japan): the side offset is to the left of the way it walks (map y is down: left = (dy, −dx)).
    // Eased towards the spot (a turn back or a dodge slides over instead of jumping; ~2 px behind while walking).
    const side = (w.lane + w.dodge) * this.sideSign, tx = p.x + p.dy * side, ty = p.y - p.dx * side;
    if (!dt) { w.x = tx; w.y = ty; return; }
    const k = 1 - Math.exp(-dt * 12);
    w.x += (tx - w.x) * k; w.y += (ty - w.y) * k;
  }

  /** One step of `dt` seconds (t: the street's clock, for the wobble). */
  step(dt: number, t: number) {
    if (!dt) return;
    this.neighbours();
    for (const w of this.walkers) if (!w.lead) this.move(w, dt, t);
    for (const w of this.walkers) if (w.lead) { this.place(w, dt); if (w.lead.stop <= 0) w.anim += w.lead.pace * dt * STRIDE; }
  }

  private move(w: Walker, dt: number, t: number) {
    w.dodge *= Math.pow(0.2, dt);
    if (w.stop > 0) {
      w.stop -= dt;
      if (w.stop <= 0) { w.anim = 0; w.nextStop = 15 + this.r() * 25; }
      return;
    }
    if ((w.nextStop -= dt) <= 0) {
      // Now and then a passer-by stands for a moment: looks at the phone, or turns to a shop window.
      const r = this.r();
      w.why = r < 0.55 ? 'phone' : 'window';
      w.stop = 1.5 + this.r() * 2.5;
      w.anim = 0;
      if (w.why === 'window') {
        const d = this.roadDir(w.x, w.y);
        const hx = Math.cos(w.h), hy = Math.sin(w.h);
        // Square to the way it walks, on the side away from the road.
        let lx = -hy, ly = hx;
        if (d && lx * d[0] + ly * d[1] > 0) { lx = -lx; ly = -ly; }
        w.look = Math.atan2(ly, lx);
      }
      return;
    }
    const pace = Math.min(w.speed * (1 + 0.08 * Math.sin(t * 0.7 + w.wob)), w.pace);
    let left = pace * dt;
    w.anim += left * STRIDE;
    while (left > 0) {
      const room = w.track.len - w.s;
      if (left < room) { w.s += left; break; }
      left -= room;
      this.next(w);
    }
    this.place(w, dt);
    w.pace = w.speed;
  }

  /** At the end of a track (or a connecting curve): on to a linked one, or back the way it came. */
  private next(w: Walker) {
    if (w.then) { w.track = w.then; w.then = null; w.s = 0; return; }
    const links = w.track.links;
    if (!links.length) { w.track = w.track.rev; w.s = 0; w.stop = 0.5; w.why = 'turn'; w.look = w.h + Math.PI; return; }
    let u = this.r() * links.reduce((s, x) => s + (this.weight.get(x.to) ?? 1), 0), l = links[links.length - 1];
    for (const x of links) { u -= this.weight.get(x.to) ?? 1; if (u < 0) { l = x; break; } }
    if (l.via) { w.track = l.via; w.then = l.to; } else w.track = l.to;
    w.s = 0;
  }

  /**
   * Who is close to whom (a 24 px grid): one following a slower one ahead keeps its pace; two meeting head-on step
   * further apart sideways.
   */
  private neighbours() {
    // The cells' lists are kept from frame to frame (emptied, not thrown away: no garbage every frame).
    const g = this.grid;
    for (const list of g.values()) list.length = 0;
    const key = (x: number, y: number) => ((Math.floor(x / 24) + 512) << 11) | (Math.floor(y / 24) + 512);
    for (const w of this.walkers) {
      const k = key(w.x, w.y), list = g.get(k);
      if (list) list.push(w); else g.set(k, [w]);
    }
    for (const w of this.walkers) {
      if (w.lead || w.stop > 0) continue;
      const hx = Math.cos(w.h), hy = Math.sin(w.h), cx = Math.floor(w.x / 24), cy = Math.floor(w.y / 24);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = g.get(((cx + i + 512) << 11) | (cy + j + 512));
        if (!list) continue;
        for (const o of list) {
          if (o === w || o.lead === w || w.lead === o) continue;
          const dx = o.x - w.x, dy = o.y - w.y, ahead = dx * hx + dy * hy, side = -dx * hy + dy * hx;
          if (ahead <= 0 || ahead > 13 || Math.abs(side) > 6) continue;
          const same = Math.cos(o.h - w.h);
          if (w.kind === this.bike) { w.dodge = side >= 0 ? -6 : 6; w.pace = Math.min(w.pace, w.speed * 0.6); continue; }
          if (same > 0.4 || o.stop > 0) w.pace = Math.min(w.pace, o.stop > 0 ? 0.6 * w.speed : o.pace * 0.97);
          else if (same < -0.4) w.dodge = side >= 0 ? -4 : 4;
        }
      }
    }
  }

  /** The heading a walker shows now (radians in map space): its walk, or where it looks while standing. */
  facing(w: Walker): number {
    return w.stop > 0 && (w.why === 'window' || w.why === 'turn') ? w.look : w.h;
  }
}
