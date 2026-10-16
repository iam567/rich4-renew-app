/**
 * The remake's map effects for news and fate results (the original plays a clip only for news 4, 5, 15, 20, 21
 * and the hospital / prison / abroad moves; everything else just changes numbers). Vector drawing on the map
 * canvas in CSS px, so they stay sharp at any zoom: coins raining in or flying out, the ground shaking and
 * cracking, water, rain, traffic, arrows over the land prices, ghosts, rubber stamps, a stock chart, sparkles.
 * Each one runs about two seconds while the result box shows.
 */
import type { BoardView } from './board-view';
import { TOP } from './effects';

type Pt = { x: number; y: number };
type Ctx = CanvasRenderingContext2D;

/** Where an effect plays: the spot (a lot or a node), the lots hit and the players concerned. */
export interface EventFxTarget { spot?: Pt | null; refs?: number[]; players?: number[]; actor?: number }

export const EVENT_FX_MS = 2000;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;

/** fx name (core EventResult.fx) → painter; names the original already shows with a clip are left out. */
const PAINTERS: Record<string, (k: Kit) => Painter> = {
  award: k => coinsIn(k, k.people(), 18),
  subsidy: k => coinsIn(k, k.people(), 14),
  gain: k => coinsIn(k, k.people(), 14),
  bonus: k => coinsIn(k, k.people(), 10),
  'stock-sell': k => coinsIn(k, k.people(), 10),
  tax: k => coinsOut(k, k.people(), null),
  fine: k => coinsOut(k, k.people(), null),
  steal: k => coinsOut(k, k.people().slice(1), k.people()[0] ?? null),
  quake: k => quake(k),
  flood: k => flood(k),
  rain: k => rain(k),
  jam: k => jam(k),
  'price-up': k => arrows(k, true, '#ffd23f', '#b86b00'),
  haunt: k => ghosts(k),
  auction: k => stamp(k, k.people().length ? '成交' : '流標', k.people().length ? '#e8243c' : '#6b6b6b', k.spot()),
  'bank-stop': k => stamp(k, '停止放款', '#e8243c', null),
  'bank-refuse': k => stamp(k, '拒絕往來', '#e8243c', k.people()[0] ?? null),
  loan: k => stamp(k, '冒名貸款', '#c0392b', k.people()[0] ?? null),
  'stock-halt': k => stamp(k, '暫停交易', '#e8243c', null),
  'stock-resume': k => stamp(k, '恢復交易', '#1f9d55', null),
  'stock-up': k => chart(k, true, 1),
  'stock-down': k => chart(k, false, 1),
  'company-up': k => chart(k, true, 0.7),
  'company-down': k => chart(k, false, 0.7),
  'stock-loss': k => chart(k, false, 0.7),
  release: k => sparkle(k, k.people(), ['#ffffff', '#7dffb0', '#ffe14a'], true),
  extend: k => stamp(k, '延長3天', '#c0392b', k.spot()),
  blessed: k => halo(k, k.people()),
  cursed: k => smoke(k, k.people(), '#5b2a86'),
  vehicle: k => smoke(k, k.people(), '#5a5a5a'),
  birthday: k => confetti(k, k.people().slice(0, 1)),
  cards: k => cardsFly(k, k.people()),
};

/** True when the remake has its own effect for this kind (the clips of the original are played elsewhere). */
export const hasEventFx = (fx: string) => fx in PAINTERS;

/** Plays the effect for a result kind; resolves after about two seconds (at once when there is none). */
export function playEventFx(view: BoardView, fx: string, target: EventFxTarget): Promise<void> {
  const make = PAINTERS[fx];
  if (!make) return Promise.resolve();
  const k = new Kit(view, target);
  const paint = make(k);
  const done = view.fx.hold(EVENT_FX_MS, (add, t) => add(TOP, 2, () => {
    const ctx = view.canvas.getContext('2d')!;
    ctx.save();
    paint(ctx, t / EVENT_FX_MS, t);
    ctx.restore();
  }));
  return done.then(() => k.cleanup());
}

type Painter = (ctx: Ctx, u: number, ms: number) => void;

/** What painters need: projected points, the zoom, the canvas size. */
class Kit {
  private undo: (() => void)[] = [];
  constructor(readonly view: BoardView, readonly target: EventFxTarget) {}
  get z() { return Math.max(1, this.view.zoomLevel); }
  get w() { return this.view.canvas.clientWidth; }
  get h() { return this.view.canvas.clientHeight; }
  project(p: Pt): Pt { return this.view.project(p.x, p.y); }
  /** Positions of the players concerned (on the map, drawn), live. */
  people(): (() => Pt)[] {
    const ids = this.target.players ?? [];
    return ids.filter(id => this.view.actorAt(id)?.visible).map(id => () => {
      const a = this.view.actorAt(id)!;
      return this.project({ x: a.x, y: a.y });
    });
  }
  spot(): (() => Pt) | null {
    const s = this.target.spot;
    return s ? () => this.project(s) : null;
  }
  lots(): (() => Pt)[] {
    return (this.target.refs ?? []).map(r => this.view.lotPos(r)).filter((p): p is Pt => !!p).map(p => () => this.project(p));
  }
  onCleanup(fn: () => void) { this.undo.push(fn); }
  cleanup() { for (const f of this.undo.splice(0)) f(); }
}

// ------------------------------------------------------------------ drawing bits

function coin(ctx: Ctx, x: number, y: number, r: number, spin: number, alpha = 1) {
  const sx = Math.max(0.12, Math.abs(Math.cos(spin)));
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#fff7c0'); g.addColorStop(0.45, '#ffd23f'); g.addColorStop(1, '#c98a00');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.16); ctx.strokeStyle = '#8a5a00'; ctx.stroke();
  if (sx > 0.45) {
    ctx.fillStyle = '#9a6400';
    ctx.font = `900 ${r * 1.2}px "Huninn", "PingFang TC", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, r * 0.05);
  }
  ctx.restore();
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, rr = i & 1 ? r * 0.32 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function label(ctx: Ctx, text: string, x: number, y: number, size: number, fill: string, stroke = '#101010') {
  ctx.font = `900 ${size}px "Huninn", "PingFang TC", "Noto Sans TC", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

/** The camera point (kept above the result box) when an effect has no point of its own. */
const centre = (k: Kit): (() => Pt) => k.spot() ?? (() => ({ x: k.w / 2, y: k.h * k.view.focusY }));

// ------------------------------------------------------------------ painters

/** Coins raining onto each player (awards, subsidies, money found), bouncing once, with a glow and sparkles. */
function coinsIn(k: Kit, at: (() => Pt)[], n: number): Painter {
  const parts = at.flatMap((p, i) => Array.from({ length: n }, () => ({ p, d: rnd(0, 0.45) + i * 0.08, dx: rnd(-34, 34), spin: rnd(0, 6), v: rnd(5, 9), r: rnd(7, 10) })));
  return (ctx, u) => {
    const z = k.z;
    for (const p of at) {
      const q = p(), glow = Math.sin(clamp01(u * 1.4) * Math.PI);
      const g = ctx.createRadialGradient(q.x, q.y - 30 * z, 0, q.x, q.y - 30 * z, 70 * z);
      g.addColorStop(0, `rgba(255,230,90,${0.55 * glow})`); g.addColorStop(1, 'rgba(255,230,90,0)');
      ctx.fillStyle = g; ctx.fillRect(q.x - 80 * z, q.y - 110 * z, 160 * z, 160 * z);
    }
    for (const c of parts) {
      const t = (u - c.d) / 0.42;
      if (t < 0) continue;
      const q = c.p(), x = q.x + c.dx * z * 0.6;
      const groundY = q.y - 18 * z;
      let y: number, a = 1;
      if (t < 1) y = groundY - (1 - t * t) * 230 * z;
      else { const b = t - 1; y = groundY - Math.max(0, Math.sin(Math.min(1, b * 2.2) * Math.PI)) * 22 * z; a = clamp01(1.9 - b * 1.1); }
      coin(ctx, x, y, c.r * z, c.spin + u * c.v * 3, a);
    }
    for (const p of at) {
      const q = p();
      for (let i = 0; i < 5; i++) {
        const s = (u * 3 + i / 5) % 1;
        star(ctx, q.x + Math.cos(i * 2.4) * 40 * z, q.y - 40 * z - s * 50 * z, 7 * z * (1 - s), '#fff6b0', u > 0.3 ? 1 - s : 0);
      }
    }
  };
}

/** Coins bursting out of each payer and flying away upwards (taxes, fines), or over to `to` (fate 4). */
function coinsOut(k: Kit, from: (() => Pt)[], to: (() => Pt) | null): Painter {
  const parts = from.flatMap((p, i) => Array.from({ length: 12 }, () => ({ p, d: rnd(0, 0.35) + i * 0.1, ang: rnd(-Math.PI * 0.85, -Math.PI * 0.15), sp: rnd(70, 130), spin: rnd(0, 6), r: rnd(6.5, 9) })));
  return (ctx, u) => {
    const z = k.z;
    for (const p of from) {
      const q = p(), pulse = Math.sin(clamp01(u * 2) * Math.PI);
      ctx.save();
      ctx.globalAlpha = 0.55 * pulse;
      ctx.strokeStyle = '#ff4f4f'; ctx.lineWidth = 4 * z;
      ctx.beginPath(); ctx.ellipse(q.x, q.y - 4 * z, (24 + 30 * u) * z, (10 + 12 * u) * z, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    for (const c of parts) {
      const t = (u - c.d) / 0.6;
      if (t < 0 || t > 1.4) continue;
      const q = c.p(), s = q.y - 30 * z;
      let x: number, y: number;
      if (to) {
        const e = to(), m = easeOut(t);
        x = q.x + (e.x - q.x) * m + Math.cos(c.ang) * c.sp * 0.35 * z * Math.sin(m * Math.PI);
        y = s + (e.y - 30 * z - s) * m - Math.sin(m * Math.PI) * 90 * z;
      } else {
        x = q.x + Math.cos(c.ang) * c.sp * t * z;
        y = s + Math.sin(c.ang) * c.sp * t * z - t * t * 160 * z;
      }
      coin(ctx, x, y, c.r * z, c.spin + u * 18, clamp01(1.35 - t));
    }
    if (u > 0.08) for (const p of from) {
      const q = p(), a = clamp01((u - 0.08) * 5) * clamp01((1 - u) * 4);
      ctx.save(); ctx.globalAlpha = a;
      label(ctx, '−$', q.x, q.y - (70 + 30 * u) * z, 24 * z, '#ff6b6b');
      ctx.restore();
    }
  };
}

/** Earthquake: the view shakes, cracks run out from every lot of the street, dust rises. */
function quake(k: Kit): Painter {
  const canvas = k.view.canvas, base = canvas.style.transform;
  k.onCleanup(() => { canvas.style.transform = base; });
  const lots = k.lots().length ? k.lots() : [centre(k)];
  const cracks = lots.map(p => ({ p, arms: Array.from({ length: 4 }, () => {
    let a = rnd(0, Math.PI * 2);
    const pts: [number, number][] = [[0, 0]];
    for (let i = 1; i <= 6; i++) { a += rnd(-0.6, 0.6); const l = i * 12; pts.push([Math.cos(a) * l, Math.sin(a) * l * 0.55]); }
    return pts;
  }) }));
  return (ctx, u) => {
    const z = k.z, amp = 7 * z * (1 - easeOut(u)) * (u < 0.85 ? 1 : 0);
    canvas.style.transform = amp > 0.2 ? `translate(${rnd(-amp, amp).toFixed(1)}px, ${rnd(-amp * 0.6, amp * 0.6).toFixed(1)}px)` : base;
    const grow = easeOut(u * 1.6), fade = clamp01((1 - u) * 5);
    for (const c of cracks) {
      const q = c.p();
      for (const arm of c.arms) {
        const n = Math.max(1, Math.round(arm.length * grow));
        for (const [w, col] of [[8, 'rgba(255,244,220,.7)'], [4, '#1d0e02']] as const) {
          ctx.save(); ctx.globalAlpha = fade;
          ctx.strokeStyle = col; ctx.lineWidth = w * z; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.beginPath();
          arm.slice(0, n).forEach(([x, y], i) => (i ? ctx.lineTo(q.x + x * z, q.y + y * z) : ctx.moveTo(q.x + x * z, q.y + y * z)));
          ctx.stroke(); ctx.restore();
        }
      }
      for (let i = 0; i < 6; i++) {
        const s = clamp01(u * 1.5 - i * 0.06);
        ctx.save(); ctx.globalAlpha = 0.45 * Math.sin(s * Math.PI) * fade;
        ctx.fillStyle = '#c9b089';
        ctx.beginPath(); ctx.arc(q.x + Math.cos(i * 1.7) * 30 * z * s, q.y - 10 * z - 40 * z * s, (8 + 14 * s) * z, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  };
}

/** Flash flood: muddy water swells over the lot with waves and bubbles, then drains away. */
function flood(k: Kit): Painter {
  const at = k.spot() ?? centre(k);
  return (ctx, u, ms) => {
    const z = k.z, q = at(), rise = Math.sin(clamp01(u * 1.15) * Math.PI);
    const rx = 115 * z * (0.4 + 0.6 * rise), ry = 58 * z * (0.4 + 0.6 * rise);
    ctx.save();
    ctx.globalAlpha = rise;
    // Muddy rim, then the water.
    ctx.fillStyle = 'rgba(122,88,46,.75)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, rx * 1.06, ry * 1.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(38,104,170,.88)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(120,190,240,.55)';
    ctx.beginPath(); ctx.ellipse(q.x - rx * 0.2, q.y - ry * 0.25, rx * 0.5, ry * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2.4 * z;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2, w = Math.sin(a * 6 + ms / 120 + r) * 3 * z, f = 0.45 + r * 0.22;
        const x = q.x + Math.cos(a) * (rx * f + w), y = q.y + Math.sin(a) * (ry * f + w * 0.5);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const s = (ms / 900 + i / 7) % 1;
      ctx.beginPath(); ctx.arc(q.x + Math.cos(i * 2.2) * rx * 0.6, q.y + Math.sin(i * 2.2) * ry * 0.5 - s * 20 * z, 3.5 * z * (1 - s), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };
}

/** Heavy rain over the whole view: darker sky, slanted streaks, a flash of lightning, splashes at the walkers. */
function rain(k: Kit): Painter {
  const drops = Array.from({ length: 170 }, () => ({ x: Math.random(), y: Math.random(), v: rnd(0.9, 1.4), l: rnd(14, 24) }));
  const at = k.people();
  return (ctx, u, ms) => {
    const z = k.z, W = k.w, H = k.h, fade = Math.sin(clamp01(u) * Math.PI) ** 0.4;
    ctx.fillStyle = `rgba(16,24,52,${0.45 * fade})`; ctx.fillRect(0, 0, W, H);
    if (u > 0.22 && u < 0.27) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0, 0, W, H); }
    ctx.strokeStyle = `rgba(210,232,255,${0.9 * fade})`; ctx.lineWidth = 2 * Math.min(2, z); ctx.lineCap = 'round';
    ctx.beginPath();
    for (const d of drops) {
      const y = ((d.y + (ms / 1000) * d.v * 1.6) % 1) * (H + 40) - 20, x = ((d.x + y / H * 0.15) % 1) * W;
      ctx.moveTo(x, y); ctx.lineTo(x - d.l * 0.3 * z, y + d.l * z);
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(220,240,255,${0.8 * fade})`; ctx.lineWidth = 2 * z;
    for (const p of at) {
      const q = p();
      for (let i = 0; i < 2; i++) {
        const s = (ms / 700 + i / 2) % 1;
        ctx.beginPath(); ctx.ellipse(q.x, q.y + 2 * z, (8 + 26 * s) * z, (3 + 9 * s) * z, 0, 0, Math.PI * 2);
        ctx.globalAlpha = 1 - s; ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  };
}

/** Traffic jam: amber hazard lights at the screen edges and honking cars stuck around each driver. */
function jam(k: Kit): Painter {
  const at = k.people();
  return (ctx, u, ms) => {
    const z = k.z, W = k.w, H = k.h, blink = Math.floor(ms / 250) & 1, fade = clamp01((1 - u) * 5);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(255,170,0,${blink ? 0.28 * fade : 0.1 * fade})`); g.addColorStop(0.25, 'rgba(255,170,0,0)');
    g.addColorStop(0.75, 'rgba(255,170,0,0)'); g.addColorStop(1, `rgba(255,170,0,${blink ? 0.28 * fade : 0.1 * fade})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const p of at) {
      const q = p();
      [[-46, -6], [44, 4], [-6, 26]].forEach(([dx, dy], i) => {
        const x = q.x + dx * 1.4 * z, y = q.y + dy * 1.4 * z, a = clamp01(u * 4 - i * 0.3) * fade;
        ctx.save(); ctx.globalAlpha = a;
        ctx.translate(x, y); ctx.scale(1.5, 1.5); ctx.translate(-x, -y);
        ctx.fillStyle = ['#e8243c', '#2d7ff9', '#2bb673'][i];
        ctx.beginPath(); ctx.roundRect(x - 13 * z, y - 7 * z, 26 * z, 12 * z, 4 * z); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(x - 6 * z, y - 11 * z, 12 * z, 5 * z);
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x - 7 * z, y + 5 * z, 3 * z, 0, 7); ctx.arc(x + 7 * z, y + 5 * z, 3 * z, 0, 7); ctx.fill();
        ctx.fillStyle = blink ? '#ffcf3a' : '#7a5a00'; ctx.fillRect(x - 13 * z, y - 4 * z, 3 * z, 3 * z); ctx.fillRect(x + 10 * z, y - 4 * z, 3 * z, 3 * z);
        ctx.restore();
      });
      if (blink) {
        ctx.save(); ctx.globalAlpha = fade;
        ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 3 * z; ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(q.x, q.y - 54 * z, (10 + i * 8) * z, -2.4, -0.7); ctx.stroke(); }
        ctx.restore();
      }
    }
  };
}

/** Land prices up: gold arrows rise from every lot of the street with a price tag. */
function arrows(k: Kit, up: boolean, fill: string, edge: string): Painter {
  const lots = k.lots().length ? k.lots() : [centre(k)];
  return (ctx, u) => {
    const z = k.z;
    lots.forEach((p, i) => {
      const q = p();
      for (let j = 0; j < 2; j++) {
        const s = clamp01(u * 1.3 - i * 0.05 - j * 0.3);
        if (s <= 0 || s >= 1) continue;
        const y = q.y - 20 * z - (up ? s : 1 - s) * 70 * z, a = Math.sin(s * Math.PI);
        ctx.save(); ctx.globalAlpha = a; ctx.translate(q.x + (j ? 18 : -12) * z, y);
        ctx.scale(1.5, up ? 1.5 : -1.5);
        ctx.fillStyle = fill; ctx.strokeStyle = edge; ctx.lineWidth = 2 * z; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(0, -16 * z); ctx.lineTo(13 * z, 0); ctx.lineTo(5 * z, 0); ctx.lineTo(5 * z, 14 * z);
        ctx.lineTo(-5 * z, 14 * z); ctx.lineTo(-5 * z, 0); ctx.lineTo(-13 * z, 0); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.restore();
      }
    });
    const c = lots[0](), a = clamp01(u * 4) * clamp01((1 - u) * 4);
    ctx.save(); ctx.globalAlpha = a; label(ctx, up ? '地價 ▲30％' : '地價 ▼30％', c.x, c.y - 125 * z, 26 * z, up ? '#ffe14a' : '#d9b3ff'); ctx.restore();
  };
}

/** Haunted: a purple gloom and ghosts swaying up out of the lots; the price goes down. */
function ghosts(k: Kit): Painter {
  const lots = k.lots().length ? k.lots() : [centre(k)];
  const down = arrows(k, false, '#b98cff', '#3d1a6e');
  return (ctx, u, ms) => {
    const z = k.z, W = k.w, H = k.h, fade = Math.sin(clamp01(u) * Math.PI) ** 0.5;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(40,0,70,0)'); g.addColorStop(1, `rgba(40,0,70,${0.55 * fade})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    lots.forEach((p, i) => {
      const q = p(), s = clamp01(u * 1.2 - i * 0.07);
      const x = q.x + Math.sin(ms / 220 + i) * 10 * z, y = q.y - 30 * z - s * 60 * z;
      ctx.save(); ctx.globalAlpha = 0.85 * Math.sin(s * Math.PI);
      ctx.translate(x, y); ctx.scale(1.6, 1.6); ctx.translate(-x, -y);
      ctx.fillStyle = '#f4f0ff';
      ctx.beginPath();
      ctx.arc(x, y, 13 * z, Math.PI, 0);
      for (let w = 0; w <= 4; w++) ctx.lineTo(x + 13 * z - w * 6.5 * z, y + 16 * z + (w & 1 ? -4 : 2) * z + Math.sin(ms / 90 + w) * 1.5 * z);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a1640';
      ctx.beginPath(); ctx.arc(x - 4.5 * z, y - 1 * z, 2.4 * z, 0, 7); ctx.arc(x + 4.5 * z, y - 1 * z, 2.4 * z, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, y + 6 * z, 2.5 * z, 3.5 * z, 0, 0, 7); ctx.fill();
      ctx.restore();
    });
    down(ctx, u, ms);
  };
}

/** A rubber stamp slams onto a player, a spot or the middle of the view, with a shock ring. */
function stamp(k: Kit, text: string, color: string, at: (() => Pt) | null): Painter {
  const where = at ?? centre(k), tilt = rnd(-0.22, -0.08);
  return (ctx, u) => {
    const z = Math.min(k.z, 1.6), q = where(), y = q.y - (at ? 70 : 0) * z;
    const t = clamp01(u / 0.18), sc = 2.4 - 1.4 * easeOut(t), a = clamp01(t * 2) * clamp01((1 - u) * 5);
    const size = (text.length > 2 ? 30 : 40) * z, w = size * text.length + 34 * z, h = size + 26 * z;
    if (t >= 1 && u < 0.45) {
      const r = (u - 0.18) / 0.27;
      ctx.save(); ctx.globalAlpha = (1 - r) * 0.7; ctx.strokeStyle = color; ctx.lineWidth = 5 * z * (1 - r);
      ctx.beginPath(); ctx.ellipse(q.x, y, w * (0.6 + r * 0.6), h * (0.6 + r * 0.8), 0, 0, 7); ctx.stroke(); ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(q.x, y); ctx.rotate(tilt); ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.strokeStyle = color; ctx.lineWidth = 5 * z;
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 10 * z); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2 * z;
    ctx.beginPath(); ctx.roundRect(-w / 2 + 6 * z, -h / 2 + 6 * z, w - 12 * z, h - 12 * z, 6 * z); ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `900 ${size}px "Huninn", "PingFang TC", "Noto Sans TC", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 2 * z);
    ctx.restore();
  };
}

/** The stock board: a chart line climbs (red, as Taiwan shows a rise) or tumbles (green) across the view. */
function chart(k: Kit, up: boolean, size: number): Painter {
  const pts = Array.from({ length: 9 }, (_, i) => {
    const trend = i / 8;
    return (up ? 1 - trend : trend) * 0.7 + 0.15 + (i % 2 ? -0.08 : 0.06) * (i > 0 && i < 8 ? 1 : 0);
  });
  const col = up ? '#ff3b3b' : '#18c26b';
  return (ctx, u) => {
    const W = k.w, H = k.h, cw = Math.min(W * 0.86, 520) * size, ch = Math.min(H * 0.36, 240) * size;
    const x0 = (W - cw) / 2, y0 = Math.max(8, H * k.view.focusY * 0.9 - ch / 2), fade = clamp01((1 - u) * 5), g = easeOut(u * 1.4);
    ctx.save();
    ctx.globalAlpha = 0.6 * fade;
    ctx.fillStyle = 'rgba(8,16,40,.75)';
    ctx.beginPath(); ctx.roundRect(x0 - 14, y0 - 14, cw + 28, ch + 28, 14); ctx.fill();
    ctx.globalAlpha = 0.25 * fade; ctx.strokeStyle = '#9fb6ff'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x0, y0 + (ch * i) / 4); ctx.lineTo(x0 + cw, y0 + (ch * i) / 4); ctx.stroke(); }
    ctx.globalAlpha = fade;
    const n = (pts.length - 1) * g, last = Math.floor(n), f = n - last;
    const P = (i: number) => ({ x: x0 + (cw * i) / (pts.length - 1), y: y0 + ch * pts[i] });
    ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.beginPath();
    let end = P(0);
    ctx.moveTo(end.x, end.y);
    for (let i = 1; i <= last; i++) { end = P(i); ctx.lineTo(end.x, end.y); }
    if (last < pts.length - 1) { const a = P(last), b = P(last + 1); end = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; ctx.lineTo(end.x, end.y); }
    ctx.stroke();
    ctx.shadowBlur = 0;
    const prev = P(Math.max(0, Math.min(last, pts.length - 2))), ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    ctx.translate(end.x, end.y); ctx.rotate(ang); ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -11); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.globalAlpha = fade * clamp01(u * 3);
    label(ctx, up ? '▲ 上漲' : '▼ 下跌', x0 + 70 * size, y0 + (up ? 22 : ch - 22) * size, 28 * size, col, '#ffffff');
    ctx.restore();
  };
}

/** Rising stars and twinkles around players (released from prison or hospital). */
function sparkle(k: Kit, at: (() => Pt)[], colors: string[], rays: boolean): Painter {
  const where = at.length ? at : [centre(k)];
  const parts = where.flatMap(p => Array.from({ length: 16 }, (_, i) => ({ p, a: rnd(0, 7), d: rnd(0, 0.5), c: colors[i % colors.length], r: rnd(5, 9) })));
  return (ctx, u) => {
    const z = k.z;
    if (rays) for (const p of where) {
      const q = p(), a = Math.sin(clamp01(u) * Math.PI) * 0.5;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(q.x, q.y - 30 * z); ctx.rotate(u * 1.5);
      ctx.fillStyle = '#fffbd0';
      for (let i = 0; i < 10; i++) { ctx.rotate(Math.PI / 5); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7 * z, -80 * z); ctx.lineTo(7 * z, -80 * z); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
    for (const s of parts) {
      const t = clamp01((u - s.d) / 0.5);
      if (t <= 0 || t >= 1) continue;
      const q = s.p();
      star(ctx, q.x + Math.cos(s.a) * 50 * z * t, q.y - 30 * z + Math.sin(s.a) * 30 * z * t - 50 * z * t, s.r * z * (1 - t * 0.6), s.c, 1 - t);
    }
  };
}

/** A god's protection: a golden halo ring above the player and rays. */
function halo(k: Kit, at: (() => Pt)[]): Painter {
  const twinkle = sparkle(k, at, ['#fff6b0', '#ffe14a', '#ffffff'], true);
  const where = at.length ? at : [centre(k)];
  return (ctx, u, ms) => {
    twinkle(ctx, u, ms);
    const z = k.z;
    for (const p of where) {
      const q = p(), a = clamp01(u * 4) * clamp01((1 - u) * 4), y = q.y - 78 * z + Math.sin(ms / 200) * 3 * z;
      ctx.save(); ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 5 * z; ctx.shadowColor = '#fff2a0'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.ellipse(q.x, y, 22 * z, 7 * z, 0, 0, 7); ctx.stroke();
      ctx.restore();
    }
  };
}

/** Puffs of smoke over the player (a god's curse, a vehicle gone). */
function smoke(k: Kit, at: (() => Pt)[], color: string): Painter {
  const where = at.length ? at : [centre(k)];
  const puffs = where.flatMap(p => Array.from({ length: 10 }, () => ({ p, dx: rnd(-26, 26), d: rnd(0, 0.5), r: rnd(10, 18) })));
  return (ctx, u) => {
    const z = k.z;
    for (const s of puffs) {
      const t = clamp01((u - s.d) / 0.5);
      if (t <= 0 || t >= 1) continue;
      const q = s.p();
      ctx.save(); ctx.globalAlpha = 0.55 * (1 - t); ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(q.x + s.dx * z * (1 + t), q.y - 10 * z - 60 * z * t, s.r * z * (0.6 + t), 0, 7); ctx.fill();
      ctx.restore();
    }
  };
}

/** Birthday confetti bursting over the player. */
function confetti(k: Kit, at: (() => Pt)[]): Painter {
  const where = at.length ? at : [centre(k)];
  const cols = ['#ff4f7b', '#ffd84a', '#4ee07a', '#4b95f5', '#c04bff'];
  const bits = where.flatMap(p => Array.from({ length: 40 }, (_, i) => ({ p, a: rnd(-Math.PI * 0.95, -Math.PI * 0.05), v: rnd(120, 220), c: cols[i % 5], s: rnd(0, 6) })));
  return (ctx, u) => {
    const z = k.z;
    for (const b of bits) {
      const t = u * 1.6, q = b.p();
      const x = q.x + Math.cos(b.a) * b.v * z * Math.min(t, 0.6) * 1.2, y = q.y - 50 * z + Math.sin(b.a) * b.v * z * Math.min(t, 0.6) * 1.2 + Math.max(0, t - 0.4) ** 2 * 120 * z;
      ctx.save(); ctx.globalAlpha = clamp01((1 - u) * 3); ctx.translate(x, y); ctx.rotate(b.s + u * 12); ctx.fillStyle = b.c;
      ctx.fillRect(-4 * z, -2 * z, 8 * z, 4 * z); ctx.restore();
    }
  };
}

/** Cards and tools flying up from the player and turning into coupons. */
function cardsFly(k: Kit, at: (() => Pt)[]): Painter {
  const where = at.length ? at : [centre(k)];
  const cards = where.flatMap(p => Array.from({ length: 8 }, (_, i) => ({ p, dx: (i - 3.5) * 14, d: i * 0.05 })));
  return (ctx, u) => {
    const z = k.z;
    for (const c of cards) {
      const t = clamp01((u - c.d) / 0.7), q = c.p();
      if (t <= 0) continue;
      const x = q.x + c.dx * z * (1 + t), y = q.y - 40 * z - 90 * z * easeOut(t);
      ctx.save(); ctx.globalAlpha = clamp01((1 - t) * 3); ctx.translate(x, y); ctx.scale(Math.cos(t * Math.PI * 3), 1);
      ctx.fillStyle = t < 0.5 ? '#ffffff' : '#ffe14a'; ctx.strokeStyle = t < 0.5 ? '#2160cf' : '#b98200'; ctx.lineWidth = 2 * z;
      ctx.beginPath(); ctx.roundRect(-8 * z, -11 * z, 16 * z, 22 * z, 3 * z); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  };
}
