/**
 * 自建地圖's layers over the ground (ui/maker/ground-gl.ts), drawn on a 2D canvas in world coordinates — in the editor
 * over the live ground, and once more into the map's ground picture when it is played (compile.ts):
 *
 * - Roads: the links between squares as bands — a verge, a surface with its texture, edge lines and the middle marking
 *   (ROAD_STYLES) —, each band drawn for every link before the next, so bends come out round and crossings merge.
 * - Lots: chalk outlines like the original maps' plots (a small lot one cell, a large plot 2 × 2 cells).
 * - Squares (editor only): a dot on each, the event's pad on an event square, as the game shows them in play.
 * - Things: the landmarks, buildings and props, each at its facing and size, lower ones over upper ones.
 */
import { ASSETS } from '../assets';
import { CELL, companyKind, evInfo, isWater, PAD_W, ROAD_STYLES, type MakerMap, type MkLot, type MkNode, type MkThing } from './model';

const TEX = `${ASSETS}/maps/remake/maker`;
const ROAD_TEX = ['asphalt', 'asphalt', 'mud', 'red-earth', 'gravel', 'flagstone', ''];
export const ROAD_W = 30;               // a road's surface width in world px (the verge adds 5 each side)

const imgs = new Map<string, HTMLImageElement>();
/** An image by url, loading once; `onload` redraws when it arrives. */
export function img(url: string, onload: () => void): HTMLImageElement | null {
  let i = imgs.get(url);
  if (!i) { i = new Image(); i.onload = onload; i.src = url; imgs.set(url, i); }
  return i.complete && i.naturalWidth ? i : null;
}
export interface Frames { frames: { file: string; width: number; height: number; anchor_x: number; anchor_y: number }[] }
const framesOf = new Map<number, Frames | null | Promise<void>>();
/** A sprite's frames (maps/remake/sprites/<res>/frames.json), loading once. */
/** A sprite's frames once loaded (null: none) — for work that must know the pieces' sizes first (random.ts). */
export async function framesReady(res: number): Promise<Frames | null> {
  frames(res, () => {});
  const f = framesOf.get(res);
  if (f instanceof Promise) await f;
  const g = framesOf.get(res);
  return g && !(g instanceof Promise) ? g : null;
}
/** Tests: a sprite's frames known without fetching. */
export const primeFrames = (res: number, f: Frames | null) => { framesOf.set(res, f); };
export function frames(res: number, onload: () => void): Frames | null {
  const f = framesOf.get(res);
  if (f === undefined) {
    framesOf.set(res, fetch(`${ASSETS}/maps/remake/sprites/${res}/frames.json`).then(r => r.json())
      .then(j => { framesOf.set(res, { frames: Array.isArray(j) ? j : j.frames }); onload(); }).catch(() => { framesOf.set(res, null); }));
    return null;
  }
  return f instanceof Promise ? null : f;
}
export const spriteUrl = (res: number, file: string) => `${ASSETS}/maps/remake/sprites/${res}/${file}`;

export const wx = (n: MkNode) => (n.cx + 0.5) * CELL;
export const wy = (n: MkNode) => (n.cy + 0.5) * CELL;

/** Every link once (a < b). */
export function links(m: MakerMap): [MkNode, MkNode][] {
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  const out: [MkNode, MkNode][] = [];
  for (const a of m.nodes) for (const id of a.links) { const b = byId.get(id); if (b && a.id < b.id) out.push([a, b]); }
  return out;
}

export function drawRoads(c: CanvasRenderingContext2D, m: MakerMap, redraw: () => void) {
  // each link in two halves, each in its own square's look: a lane meeting a road runs right up to the crossing
  const half = (a: MkNode, b: MkNode): [MkNode, MkNode] => [a, { ...b, cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2 }];
  // a square on water has no road under it (the user 2026-11-12, as 台灣's sea route: only the dots on the sea)
  const wet = (n: MkNode) => isWater(m.cells[Math.floor(n.cy + .5) * m.w + Math.floor(n.cx + .5)]);
  // and none under an event square either: the road stops half a step before its pad, as the original maps' roads run
  // in pieces between the pads (the user 2026-11-12, the original editor: 「路是一段一段的…給這個事件格留出一個空間」)
  const ls = links(m).flatMap(([a, b]) => [half(a, b), half(b, a)]).filter(([a]) => !wet(a) && !a.ev);
  if (!ls.length && !m.nodes.length) return;
  const styleOf = ([a]: [MkNode, MkNode]) => ROAD_STYLES[a.style] ?? ROAD_STYLES[0];
  const path = (w: number, color: string | CanvasPattern, pick: (s: (typeof ROAD_STYLES)[number]) => boolean = () => true, dash: number[] = []) => {
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = w; c.strokeStyle = color; c.setLineDash(dash);
    c.beginPath();
    for (const l of ls) { if (!pick(styleOf(l))) continue; c.moveTo(wx(l[0]), wy(l[0])); c.lineTo(wx(l[1]), wy(l[1])); }
    // a lone square (no link yet): a round patch of road
    for (const n of m.nodes) if (!n.links.length && !wet(n) && !n.ev && pick(ROAD_STYLES[n.style] ?? ROAD_STYLES[0])) { c.moveTo(wx(n), wy(n)); c.lineTo(wx(n) + .01, wy(n)); }
    c.stroke();
    c.setLineDash([]);
  };
  // a soft shadow under the roads, then each style's bands
  c.save(); c.translate(3, 4); path(ROAD_W + 12, 'rgba(0, 0, 0, .22)'); c.restore();
  ROAD_STYLES.forEach((st, si) => {
    const mine = (s: (typeof ROAD_STYLES)[number]) => s === st;
    if (!ls.some(l => styleOf(l) === st) && !m.nodes.some(n => !n.links.length && n.style === si)) return;
    path(ROAD_W + 10, st.verge, mine);
    if (st.edge) path(ROAD_W + 1, st.edge, mine);
    const t = ROAD_TEX[si] ? img(`${TEX}/ground-${ROAD_TEX[si]}.webp`, redraw) : null;
    let surface: string | CanvasPattern = st.surface;
    if (t) {
      const p = c.createPattern(t, 'repeat');
      if (p) { p.setTransform(new DOMMatrix().scale(0.3)); surface = p; }
    }
    path(ROAD_W - (st.edge ? 4 : 0), st.surface, mine);
    c.globalAlpha = 0.55; path(ROAD_W - (st.edge ? 4 : 0), surface, mine); c.globalAlpha = 1;
    if (si === 6) path(ROAD_W - 4, 'rgba(60, 35, 15, .35)', mine, [2, 9]);       // the boardwalk's planks
    if (st.mid) {
      if ('double' in st && st.double) { path(5, st.mid, mine); path(1.5, st.surface, mine); }
      else path(st.dash.length ? 2.5 : 6, st.mid, mine, [...st.dash]);
    }
  });
}

/** The notches across the road halfway between squares (the game draws them too, MapArt.stepMarks). */
export function drawSteps(c: CanvasRenderingContext2D, m: MakerMap) {
  c.strokeStyle = 'rgba(255, 255, 255, .55)'; c.lineWidth = 2;
  c.beginPath();
  for (const [a, b] of links(m)) {
    const mx = (wx(a) + wx(b)) / 2, my = (wy(a) + wy(b)) / 2, dx = wx(b) - wx(a), dy = wy(b) - wy(a), L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L, h = ROAD_W / 2 + 4;
    c.moveTo(mx + nx * h, my + ny * h); c.lineTo(mx + nx * (h - 6), my + ny * (h - 6));
    c.moveTo(mx - nx * h, my - ny * h); c.lineTo(mx - nx * (h - 6), my - ny * (h - 6));
  }
  c.stroke();
}

/**
 * Where a lot stands (the user 2026-11-12: which lot is whose square was hard to tell): right beside its square(s), on
 * the side of its cell, square-on to the road there — turned with the road (a diagonal road: a diamond beside it; a
 * square dragged off the grid with 微調: the road's own angle), a large plot beside its two squares. Its data cell
 * keeps the place taken; this is where it is drawn and where the game puts it. 微調's own nudge (MkLot.adj) comes on
 * top, along and across the road, so the lot follows its road when a square moves.
 *
 * The road's direction at one square is the link the lot lies square beside (the user 2026-11-12: a lot at a T
 * crossing came out a diamond — the three links were averaged), not the links' average.
 */
export function lotGeom(m: MakerMap, l: MkLot): { x: number; y: number; angle: number; size: number } {
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  const ns = l.nodes.map(id => byId.get(id)).filter((n): n is MkNode => !!n);
  const a = l.adj;
  const size = (l.kind ? CELL * 2 - 12 : CELL - 14) * (a?.s ?? 1);
  const cx = (l.cx + (l.kind ? 1 : 0.5)) * CELL, cy = (l.cy + (l.kind ? 1 : 0.5)) * CELL;
  // 強制放置 (MkLot.free) or no square yet: where it was put, on its own cell(s)
  if (!ns.length || l.free) return { x: cx + (a?.u ?? 0), y: cy + (a?.v ?? 0), angle: a?.a ?? 0, size };
  const mx = ns.reduce((s, n) => s + wx(n), 0) / ns.length, my = ns.reduce((s, n) => s + wy(n), 0) / ns.length;
  let dx = 1, dy = 0;
  if (ns.length > 1) { dx = wx(ns[1]) - wx(ns[0]); dy = wy(ns[1]) - wy(ns[0]); }
  else {
    // of the square's links, the one most across the way to the lot's cell
    const tx = cx - mx, ty = cy - my, tl = Math.hypot(tx, ty) || 1;
    let best = Infinity;
    for (const id of ns[0].links) {
      const o = byId.get(id); if (!o) continue;
      const ux = wx(o) - wx(ns[0]), uy = wy(o) - wy(ns[0]), ul = Math.hypot(ux, uy) || 1;
      const k = Math.abs((ux * tx + uy * ty) / (ul * tl));
      if (k < best - 1e-6) { best = k; dx = ux; dy = uy; }
    }
  }
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  let px = -dy, py = dx;                                   // across the road, toward the lot's cell
  if (px * (cx - mx) + py * (cy - my) < 0) { px = -px; py = -py; }
  const off = ROAD_W / 2 + 6 + (l.kind ? CELL * 2 - 12 : CELL - 14) / 2;
  // the road's angle, a square's turn being a quarter (-45° .. 45°)
  let angle = Math.atan2(dy, dx);
  angle -= Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(angle) < 0.01) angle = 0;
  const u = a?.u ?? 0, v = a?.v ?? 0;
  return { x: mx + px * off + dx * u + px * v, y: my + py * off + dy * u + py * v, angle: angle + (a?.a ?? 0), size };
}

/** 微調's nudge for a lot from a world move (dx, dy): along and across its road (lotGeom's frame). */
export function lotNudge(m: MakerMap, l: MkLot, wdx: number, wdy: number): { u: number; v: number } {
  const g0 = lotGeom(m, { ...l, adj: { u: 0, v: 0, a: 0, s: 1 } }), g1 = lotGeom(m, { ...l, adj: { u: 1, v: 0, a: 0, s: 1 } }), g2 = lotGeom(m, { ...l, adj: { u: 0, v: 1, a: 0, s: 1 } });
  const ax = g1.x - g0.x, ay = g1.y - g0.y, bx = g2.x - g0.x, by = g2.y - g0.y;
  return { u: wdx * ax + wdy * ay, v: wdx * bx + wdy * by };
}

/** A street's colour (the editor marks each street's lots with it). */
export const streetColor = (id: number) => `hsl(${(id * 137) % 360} 85% 62%)`;

/** The lots' chalk outlines, as the original maps' plots; in the editor (`streets`) each street's colour and name. */
export function drawLots(c: CanvasRenderingContext2D, m: MakerMap, sel = -1, streets = false) {
  const labels = new Map<number, { x: number; y: number; n: number }>();
  for (const l of m.lots) {
    const g = lotGeom(m, l), h = g.size / 2;
    c.save(); c.translate(g.x, g.y); c.rotate(g.angle);
    if (streets && l.street !== undefined) { c.fillStyle = streetColor(l.street).replace(')', ' / .28)'); c.fillRect(-h, -h, g.size, g.size); }
    c.lineWidth = 3; c.strokeStyle = 'rgba(24, 20, 16, .45)'; c.setLineDash([]); c.strokeRect(-h, -h, g.size, g.size);
    c.lineWidth = 2; c.setLineDash([9, 2.5, 4, 2]);
    c.strokeStyle = l.id === sel ? '#fff36b' : streets && l.street !== undefined ? streetColor(l.street) : 'rgba(236, 248, 222, .92)';
    c.strokeRect(-h + 1, -h + 1, g.size - 2, g.size - 2);
    c.setLineDash([]);
    c.restore();
    if (streets && l.street !== undefined) { const t = labels.get(l.street) ?? { x: 0, y: 0, n: 0 }; t.x += g.x; t.y += g.y; t.n++; labels.set(l.street, t); }
  }
  if (!streets) return;
  c.font = 'bold 15px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const [id, t] of labels) {
    const st = m.streets.find(s => s.id === id);
    if (!st) continue;
    const text = `${st.name}・${st.price}`, x = t.x / t.n, y = t.y / t.n, w = c.measureText(text).width + 12;
    c.fillStyle = 'rgba(10, 20, 50, .72)'; c.beginPath(); c.roundRect(x - w / 2, y - 11, w, 22, 11); c.fill();
    c.strokeStyle = streetColor(id); c.lineWidth = 2; c.stroke();
    c.fillStyle = '#fff'; c.fillText(text, x, y + 1);
  }
}

/** Editor only: each square's dot and event pad, and a line from each lot to its squares. */
export function drawSquares(c: CanvasRenderingContext2D, m: MakerMap, redraw: () => void, sel = -1) {
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  c.strokeStyle = 'rgba(255, 243, 107, .7)'; c.lineWidth = 2; c.setLineDash([3, 4]);
  c.beginPath();
  for (const l of m.lots) for (const id of l.nodes) {
    const n = byId.get(id); if (!n) continue;
    const g = lotGeom(m, l);
    c.moveTo(wx(n), wy(n)); c.lineTo(g.x, g.y);
  }
  c.stroke(); c.setLineDash([]);
  for (const n of m.nodes) {
    const e = evInfo(n.ev);
    if (e.pad >= 0) {
      const p = img(`${ASSETS}/hd/map/0024-SMP/frame-${String(e.pad).padStart(3, '0')}.webp`, redraw);
      if (p) { const w = PAD_W, h = (p.height / p.width) * w; c.drawImage(p, wx(n) - w / 2, wy(n) - h / 2, w, h); continue; }
    }
    c.fillStyle = '#fff6dc'; c.strokeStyle = '#6b5230'; c.lineWidth = 2;
    c.beginPath(); c.arc(wx(n), wy(n), 6, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  // 微調's chosen square: a ring round it
  const n = byId.get(sel);
  if (n) {
    c.strokeStyle = '#fff36b'; c.lineWidth = 3;
    c.beginPath(); c.arc(wx(n), wy(n), 17, 0, Math.PI * 2); c.stroke();
  }
}

/** The landmarks, buildings and props: each sprite at its facing and size, anchored at its foot, upper ones first. */
export function drawThings(c: CanvasRenderingContext2D, m: MakerMap, redraw: () => void, sel = -1) {
  const order = m.things.map((_, i) => i).sort((a, b) => m.things[a].y - m.things[b].y);
  for (const i of order) {
    const t = m.things[i], f = frames(t.res, redraw);
    if (!f) continue;
    const fr = f.frames[t.face % f.frames.length] ?? f.frames[0];
    const im = img(spriteUrl(t.res, fr.file), redraw);
    if (!im) continue;
    const k = SPRITE_SCALE * t.s;
    c.drawImage(im, t.x - fr.anchor_x * k, t.y - fr.anchor_y * k, fr.width * k, fr.height * k);
    if (i === sel) {
      c.strokeStyle = '#fff36b'; c.lineWidth = 3; c.setLineDash([6, 4]);
      c.strokeRect(t.x - fr.anchor_x * k, t.y - fr.anchor_y * k, fr.width * k, fr.height * k);
      c.setLineDash([]);
    }
  }
}
/**
 * The original map sprites (the game's art bank, set by main.ts): a 企業大樓's look is one (map#style+38), in original
 * px — the size it has on the map.
 */
export type MapArt = (res: number, frame: number) => { src: string; w: number; h: number; ax: number; ay: number } | null;
let mapArt: MapArt | null = null;
export const setMapArt = (f: MapArt) => { mapArt = f; };
/** A 企業大樓 look's picture for a button (its first facing), '' before the art bank is up. */
export const styleIcon = (style: number) => mapArt?.(style + 38, 1)?.src ?? '';
/** Building facing toward its road squares (city_build.facing): 0..7, as the game's company record. */
export const facingTo = (nx: number, ny: number, px: number, py: number) => ((Math.round(Math.atan2(px - nx, -(py - ny)) / (Math.PI / 4)) % 8) + 8) % 8;

/** The 企業大樓 (lots of kind 2): each one's building over its plot, facing its squares as the game draws it. */
export function drawCompanies(c: CanvasRenderingContext2D, m: MakerMap, redraw: () => void) {
  if (!mapArt) return;
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  const cos = m.lots.filter(l => l.kind === 2).map(l => ({ l, g: lotGeom(m, l) })).sort((a, b) => a.g.y - b.g.y);
  for (const { l, g } of cos) {
    const kind = companyKind(l.co);
    const style = kind?.styles.includes(l.style as never) ? l.style! : kind?.styles[0];
    if (style === undefined) continue;
    const ns = l.nodes.map(id => byId.get(id)).filter((n): n is MkNode => !!n);
    const face = ns.length ? facingTo(ns.reduce((s, n) => s + wx(n), 0) / ns.length, ns.reduce((s, n) => s + wy(n), 0) / ns.length, g.x, g.y) : 0;
    const a = mapArt(style + 38, (8 - face) & 7);
    const im = a && img(a.src, redraw);
    if (!a || !im) continue;
    c.drawImage(im, g.x - a.ax, g.y - a.ay, a.w, a.h);
  }
}

/** The remake's sprites are drawn at 4× (as the HD redraws): a quarter is their size on the map. */
export const SPRITE_SCALE = 0.25;

/** The thing under a world point (its picture's box), the topmost first; -1 none. */
export function thingAt(m: MakerMap, x: number, y: number): number {
  const order = m.things.map((_, i) => i).sort((a, b) => m.things[b].y - m.things[a].y);
  for (const i of order) {
    const t = m.things[i], f = framesOf.get(t.res);
    if (!f || f instanceof Promise) continue;
    const fr = f.frames[t.face % f.frames.length] ?? f.frames[0], k = SPRITE_SCALE * t.s;
    if (x >= t.x - fr.anchor_x * k && x <= t.x + (fr.width - fr.anchor_x) * k && y >= t.y - fr.anchor_y * k && y <= t.y + (fr.height - fr.anchor_y) * k) return i;
  }
  return -1;
}

/**
 * Whether a piece stands on anything that matters for play (the user 2026-11-12: landmarks never cover the squares,
 * the lots or the road): its foot — an ellipse as wide as the lower part of its picture — against every square and
 * every lot.
 */
export const covers = (m: MakerMap, t: MkThing): boolean => !!covering(m, t);
/** What a piece stands on: '路' (a square of the road), a lot's name, or '' (nothing). */
export function covering(m: MakerMap, t: MkThing): string {
  const f = framesOf.get(t.res);
  const fr = f && !(f instanceof Promise) ? f.frames[t.face % f.frames.length] ?? f.frames[0] : null;
  const rx = Math.max(10, ((fr ? fr.width : 160) * SPRITE_SCALE * t.s) * 0.38), ry = rx * 0.55;
  const inside = (x: number, y: number, pad: number) => ((x - t.x) / (rx + pad)) ** 2 + ((y - t.y) / (ry + pad)) ** 2 < 1;
  // (an event square's pad is drawn much larger than the road: it needs more room)
  if (m.nodes.some(n => inside(wx(n), wy(n), n.ev ? PAD_W / 2 + 6 : ROAD_W / 2))) return '路';
  // the picture itself (a crown, a roof) over a square: an event's pad or the road's dot hidden
  if (fr) {
    const k = SPRITE_SCALE * t.s, x0 = t.x - fr.anchor_x * k, y0 = t.y - fr.anchor_y * k, x1 = x0 + fr.width * k, y1 = y0 + fr.height * k;
    if (m.nodes.some(n => { const p = n.ev ? 34 : 8; return wx(n) > x0 - p && wx(n) < x1 + p && wy(n) > y0 - p && wy(n) < y1 + p; })) return '路';
  }
  // a lot where it is drawn (lotGeom: beside its squares, turned): its point nearest the piece's foot
  for (const l of m.lots) {
    const g = lotGeom(m, l), h = g.size / 2, c = Math.cos(g.angle), s = Math.sin(g.angle);
    const dx = t.x - g.x, dy = t.y - g.y, u = Math.max(-h, Math.min(h, c * dx + s * dy)), v = Math.max(-h, Math.min(h, -s * dx + c * dy));
    if (inside(g.x + c * u - s * v, g.y + s * u + c * v, 4)) return `「${(l.street !== undefined && m.streets.find(x => x.id === l.street)?.name) || l.name}」`;
  }
  return '';
}
