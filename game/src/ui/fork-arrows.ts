/**
 * 岔路箭頭 on the board (docs/rules/14-forks-and-junctions.md §5): the arrows of the player whose turn it is, in
 * that player's colour. Each is a small toy arrow on the free ground beside a fork (not on the road, the event pads,
 * lots, plots, landmarks or plants), pointing the absolute way that player will walk out of the fork: their route
 * ahead is walked by their own 直走/左轉/右轉 choices (Forks.plan) up to the first fork met twice, so every arrow
 * shown is what will happen; forks not on that walk show none. A fork's spot is chosen once in map coordinates, so
 * it is the same in all 8 view rotations; the arrow lies flat on the ground plane and swings round when it changes.
 *
 * Board view hook: `drawForkArrows(ctx, game, project, zoom, W, H, decor)` once per frame after the event icons.
 */
import { worldSize, type Board, type BoardNode } from '../core/board';
import { CHARACTERS } from '../core/characters';
import type { Game } from '../core/game';

interface Shown { angle: number; at: number }
interface Decor { x: number; y: number }

const state = new WeakMap<Game, Map<number, Shown>>();
const plans = new WeakMap<Game, { key: string; plan: Map<number, number> }>();

/**
 * Player p's way out of each fork on the road ahead (Forks.plan: their route walked by their own choices up to the
 * first fork met twice) — exactly what will happen, so that is what the arrows show. Recomputed when the player
 * moves or a choice changes.
 */
function planOf(game: Game, p: number): Map<number, number> {
  const q = game.players[p], c = game.forks.choices[p] ?? {};
  const key = `${p}:${q.node}:${q.lastNode}:${q.dir}:${Object.values(c).join('')}`;
  const hit = plans.get(game);
  if (hit && hit.key === key) return hit.plan;
  const plan = game.forks.plan(p);
  plans.set(game, { key, plan });
  return plan;
}
const spots = new WeakMap<Board, Map<number, { x: number; y: number }>>();

/** World-pixel size of the arrow (about a coupon dot on screen): half length, shaft / head half-widths, head length. */
const HALF = 13, SHAFT = 3.6, HEAD = 8.5, HEAD_LEN = 11;

/** Clearance (world px) the arrow's spot keeps from each kind of thing on the ground. */
const CLEAR = { road: 33, bigIcon: 64, smallIcon: 36, lot: 44, plot: 78, landscape: 84, plant: 30, edge: 40 };

/** Big event pads (124×92) by map#24 frame; coupons, mini games and plain dots are smaller. */
function bigIcon(n: BoardNode): boolean { return !!n.aux && n.aux < 33 && !(n.aux >= 19 && n.aux <= 24); }

/** Screen offset of a map point in view rotation r (board-view's projection at zoom 1, docs/rules/08 §4.3). */
const ROT = Array.from({ length: 8 }, (_, r) => { const th = (-22.5 + 45 * r) * Math.PI / 180; return [Math.cos(th), Math.sin(th)]; });
function screenAt(x: number, y: number, r: number): [number, number] {
  const [c, s] = ROT[r];
  return [1.2175 * (c * x - s * y), 1.2175 * Math.SQRT1_2 * (s * x + c * y)];
}

function segDist(px: number, py: number, a: BoardNode, b: BoardNode): number {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L2));
  return Math.hypot(px - a.x - t * dx, py - a.y - t * dy);
}

/**
 * The spot of a fork's arrow: the nearest point to the junction (rings 56–150 px out) that keeps clear of roads,
 * event pads, lots and plots, landscapes and plants. Plants are given up last: if only a plant is in the way, the
 * plants on the spot are taken off the map (they are decoration only).
 */
export function forkSpot(b: Board, n: BoardNode, decor: Decor[] = []): { x: number; y: number } {
  let cache = spots.get(b);
  if (!cache) { cache = new Map(); spots.set(b, cache); }
  const hit = cache.get(n.id);
  if (hit) return hit;
  const segs: [BoardNode, BoardNode][] = [];
  for (const a of b.nodes) for (const id of a.adjacent) if (id > a.id && b.nodes[id - 1]) segs.push([a, b.nodes[id - 1]]);
  const near = (x: number, y: number, r: number) => Math.abs(x - n.x) < r && Math.abs(y - n.y) < r;
  const R = 260, S = worldSize(b);
  const roads = segs.filter(([p, q]) => near(p.x, p.y, R) || near(q.x, q.y, R));
  const icons = b.nodes.filter(m => m.aux && near(m.x, m.y, R));
  const lots = b.lands.filter(l => near(l.x, l.y, R));
  const plots = [...b.facilities, ...b.companies].filter(p => near(p.x, p.y, R));
  const scapes = b.landscapes.filter(s => s.resource && near(s.x, s.y, R));
  const plants = decor.filter(d => near(d.x, d.y, R));
  // Things standing up from the ground (houses at level 5, big buildings, landscapes, plants) hide what lies just
  // behind them on screen; the arrow is drawn under them, so its spot must not be behind one in any rotation.
  const tall: [number, number, number, number][] = [
    ...lots.map(l => [l.x, l.y, 46, 120] as [number, number, number, number]),
    ...plots.map(p => [p.x, p.y, 80, 190] as [number, number, number, number]),
    ...scapes.map(sc => [sc.x, sc.y, 90, 230] as [number, number, number, number]),
  ];
  const tallPlants = plants.map(d => [d.x, d.y, 34, 90] as [number, number, number, number]);
  const hidden = (x: number, y: number, list: [number, number, number, number][]) => {
    let bad = 0;
    for (let r = 0; r < 8; r++) {
      const [sx, sy] = screenAt(x, y, r);
      for (const [ox, oy, w, h] of list) {
        const [tx, ty] = screenAt(ox, oy, r);
        if (sy < ty && ty - sy < h && Math.abs(sx - tx) < w) bad += 1;
      }
    }
    return bad;
  };
  const cost = (x: number, y: number, withPlants: boolean): number => {
    if (x < CLEAR.edge || y < CLEAR.edge || x > S - CLEAR.edge || y > S - CLEAR.edge) return Infinity;
    let bad = 0;
    for (const [p, q] of roads) bad += Math.max(0, CLEAR.road - segDist(x, y, p, q));
    for (const m of icons) bad += Math.max(0, (bigIcon(m) ? CLEAR.bigIcon : CLEAR.smallIcon) - Math.hypot(x - m.x, y - m.y));
    for (const l of lots) bad += Math.max(0, CLEAR.lot - Math.hypot(x - l.x, y - l.y));
    for (const p of plots) bad += Math.max(0, CLEAR.plot - Math.hypot(x - p.x, y - p.y));
    for (const s of scapes) bad += Math.max(0, CLEAR.landscape - Math.hypot(x - s.x, y - s.y));
    if (withPlants) for (const d of plants) bad += Math.max(0, CLEAR.plant - Math.hypot(x - d.x, y - d.y));
    if (bad > 0) return bad;
    return hidden(x, y, tall) * 2 + (withPlants ? hidden(x, y, tallPlants) : 0);
  };
  let best: { x: number; y: number; c: number } | null = null;
  for (const withPlants of [true, false]) {
    for (let r = 56; r <= 150 && !(best && best.c === 0); r += 6) {
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * 2 * Math.PI, x = n.x + Math.cos(a) * r, y = n.y + Math.sin(a) * r;
        // Nearer is better: a clear spot one ring further out beats a slightly crowded one.
        const c = cost(x, y, withPlants) + r * 0.01;
        if (!best || c < best.c) best = { x, y, c: cost(x, y, withPlants) === 0 ? 0 : c };
      }
    }
    if (best && best.c === 0) {
      if (!withPlants) {
        // Only plants were in the way: take the ones on the spot off the map.
        for (let i = decor.length - 1; i >= 0; i--) if (Math.hypot(decor[i].x - best.x, decor[i].y - best.y) < CLEAR.plant) decor.splice(i, 1);
      }
      break;
    }
  }
  const spot = { x: Math.round(best!.x), y: Math.round(best!.y) };
  cache.set(n.id, spot);
  return spot;
}

/**
 * `opts` (歌舞伎町, docs/rules/21 §8: a dark, busy neon ground): `scale` makes the arrow bigger, `glow` gives it a
 * bright halo; the board view then draws them over the street's walkers and buildings.
 */
export function drawForkArrows(
  ctx: CanvasRenderingContext2D, game: Game, project: (x: number, y: number) => { x: number; y: number },
  zoom: number, W: number, H: number, decor: Decor[] = [], opts: { scale?: number; glow?: boolean } = {},
) {
  const k = opts.scale ?? 1;
  // The arrows of the player whose turn it is (that is also the one moving), in that player's colour.
  const who = game.current, player = game.isPlayerId(who) ? game.players[who] : undefined;
  if (!player || !player.placed || !game.forks) return;
  const plan = planOf(game, who);
  const rgb = CHARACTERS[player.character]?.color ?? 0xff9a1a;
  const mix = (k: number, t: number) => { const c = (sh: number) => Math.round(((rgb >> sh) & 255) * k + 255 * t); return `rgb(${c(16)}, ${c(8)}, ${c(0)})`; };
  const light = mix(0.55, 0.45), base = mix(1, 0), dark = mix(0.5, 0), outline = mix(0.25, 0);
  let shown = state.get(game);
  if (!shown) { shown = new Map(); state.set(game, shown); }
  const now = performance.now(), b = game.board;
  // Screen size of one world pixel (the projection squashes y; use the larger axis for line widths).
  const o = project(0, 0), ox = project(1, 0), oy = project(0, 1);
  const unit = Math.max(Math.hypot(ox.x - o.x, ox.y - o.y), Math.hypot(oy.x - o.x, oy.y - o.y)) || zoom;
  // The arrow floats a little over the grass (bobbing), its shadow under it; its edge is extruded.
  const lift = Math.max(1.5, 2.6 * unit), float = Math.max(2.5, 4.5 * unit) + Math.sin(now / 300) * 1.2 * unit;
  for (const [id, to] of plan) {
    const n = b.nodes[id - 1], m = b.nodes[to - 1];
    if (!n || !m) continue;
    const at = forkSpot(b, n, decor);
    const c = project(at.x, at.y);
    if (c.x < -60 || c.x > W + 60 || c.y < -60 || c.y > H + 60) continue;
    const want = Math.atan2(m.y - n.y, m.x - n.x);
    let s = shown.get(id);
    if (!s) { s = { angle: want, at: now }; shown.set(id, s); }
    // Swing round the shorter way, about a third of a second.
    const dt = Math.min(0.1, (now - s.at) / 1000);
    s.at = now;
    let d = want - s.angle;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    s.angle += Math.abs(d) < 0.002 ? d : d * Math.min(1, dt * 10);

    const ux = Math.cos(s.angle), uy = Math.sin(s.angle), vx = -uy, vy = ux;
    const bob = Math.sin(now / 260) * 1.2, tail = (-HALF + bob) * k, tip = (HALF + bob) * k, neck = tip - HEAD_LEN * k;
    const shape: [number, number][] = [
      [tail, -SHAFT * k], [neck, -SHAFT * k], [neck, -HEAD * k], [tip, 0], [neck, HEAD * k], [neck, SHAFT * k], [tail, SHAFT * k],
    ];
    const pts = shape.map(([u, v]) => project(at.x + ux * u + vx * v, at.y + uy * u + vy * v));
    const path = (dy: number) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y + dy - float) : ctx.moveTo(p.x, p.y + dy - float)));
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = 'round';
    path(float);                                        // shadow on the grass
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();
    ctx.lineWidth = Math.max(2.5, 3.6 * unit) * (opts.glow ? 1.6 : 1);   // pale halo, so the outline reads on any ground
    ctx.strokeStyle = 'rgba(255, 250, 230, 0.9)';
    if (opts.glow) { ctx.shadowColor = 'rgba(255, 255, 210, 0.95)'; ctx.shadowBlur = Math.max(6, 10 * unit); }
    path(lift); ctx.stroke();
    path(0); ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    path(lift);                                         // extruded edge
    ctx.fillStyle = dark;
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, 1.6 * unit);
    ctx.strokeStyle = outline;
    ctx.stroke();
    path(0);                                            // top face
    const g = ctx.createLinearGradient(pts[0].x, pts[0].y - float, pts[3].x, pts[3].y - float);
    g.addColorStop(0, light);
    g.addColorStop(1, base);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
