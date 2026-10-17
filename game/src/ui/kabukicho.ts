/**
 * 歌舞伎町 on the board (docs/rules/21, the remake's 自製地圖 #7, map 106): its shops' and houses' sprites, the two
 * pads, the 黑幫 / 拉客仔 figures, the head badges, and the living street of §8 (passers-by on the sidewalks, the
 * neon breathing on the landmarks and shops). Everything here is off unless the game has the map's rules
 * (`kbRules`), so every other map is drawn as before. The screens (shop picker, incidents, the machines) are
 * screens/kb-*.ts; the rules are core/kabukicho.ts.
 *
 * Nothing here touches the rules' rand(): the street has its own PRNG from the game's seed and is never saved.
 */
import { EV_PACHINKO, EV_PACHISLOT, kbRules } from '../core/kabukicho'; // also registers map 106's rules for a normal game
import type { Game } from '../core/game';
import type { Player } from '../core/types';
import { picSize } from './decode';
import { memTier } from './mem-tier';
import type { MapSprites } from './assets';
import type { SpriteBank } from './sprites';
import './kabukicho.css';

export { kbRules };

/** The large plots' sprites by facility type (§9.1): 5 levels each, 8 views. */
const SHOP_SPRITE: Record<number, number> = { 10: 1771, 11: 1776, 12: 1781, 13: 1786, 4: 1791 };
/** The small lots' houses, levels 1–5 (8 views by the lot's facing). */
const HOUSE_SPRITE = 1796;
/** 黑幫 and 拉客仔 (8 views). */
const GANG_SPRITE = 1768, TOUT_SPRITE = 1769;
/** The six passers-by, 16 frames each: row (direction) × 4 + walk phase. */
const WALKER_SPRITE = 1801, WALKER_KINDS = 6;
/** Kinds whose down-right row came out as a back view (the tourist, 1803): they walk down-right as row 0 mirrored. */
const MIRROR_DOWN_RIGHT = new Set([2]);
/** Landmarks (landscape sprites) that carry neon (the hospital and the prison are not the map's own). */
const LANDMARK_FIRST = 1751, LANDMARK_LAST = 1767;

/** A shop's sprite at its level on 歌舞伎町 (null elsewhere, or for a type that is not one of its five). */
export function kbShopSprite(game: Game, fa: { type: number; level: number }): number | null {
  if (!fa.level || !kbRules(game)) return null;
  const first = SHOP_SPRITE[fa.type];
  return first ? first + Math.max(1, Math.min(5, fa.level)) - 1 : null;
}

/** A small lot's house on 歌舞伎町 (chain stores keep the original's). */
export function kbHouseSprite(game: Game, l: { level: number; chain: number | boolean }): number | null {
  if (!l.level || l.chain || !kbRules(game)) return null;
  return HOUSE_SPRITE + Math.max(1, Math.min(5, l.level)) - 1;
}

/** The 柏青哥店 / 拉霸店 pads (§7.1: map sprites 9019 / 9020, the size of 9017 / 9018); 0 for any other square. */
export function kbPadSprite(game: Game, event: number): number {
  if (event !== EV_PACHINKO && event !== EV_PACHISLOT) return 0;
  return kbRules(game) ? (event === EV_PACHINKO ? 9019 : 9020) : 0;
}

/** The figures standing on the road (§4): 黑幫 on its square while it holds nobody, 拉客仔 unless sent away. */
export function kbFigures(game: Game): { node: number; res: number }[] {
  const kb = kbRules(game);
  if (!kb) return [];
  const out: { node: number; res: number }[] = [];
  if (kb.s.gang.node > 0 && kb.s.gang.holder < 0) out.push({ node: kb.s.gang.node, res: GANG_SPRITE });
  if (kb.s.tout.node > 0 && !(kb.s.tout.gone > 0)) out.push({ node: kb.s.tout.node, res: TOUT_SPRITE });
  return out;
}

/** The signs over a player's head (§2.2 「處理事務中」, §4.1 「黑幫附身」). */
export function kbBadges(game: Game, pid: number): { text: string; kind: 'busy' | 'gang' }[] {
  const kb = kbRules(game);
  if (!kb) return [];
  const out: { text: string; kind: 'busy' | 'gang' }[] = [];
  if (kb.s.gang.holder === pid) out.push({ text: '黑幫附身', kind: 'gang' });
  if ((kb.s.busy[pid] ?? 0) > 0) out.push({ text: '處理事務中', kind: 'busy' });
  return out;
}

/** The same signs on the player panel (ui/side.ts). */
export function kbPanelTags(game: Game, p: Player): string {
  return kbBadges(game, p.id).map((b, i) => `<div class="pp-kb ${b.kind}" style="--i:${i}">${b.text}</div>`).join('');
}

/** The exclusive tools' icons (§7.5): tools 17–20 as Data#617..620 (maps/remake/tools/, as the lab tools 614..616). */
export function prepareKabukicho(bank: SpriteBank): void {
  const out: MapSprites = {};
  for (const [id, w, h] of [[617, 470, 480], [618, 480, 409], [619, 393, 480], [620, 445, 480]]) {
    out[`Data/0${id}`] = { dir: 'remake/tools', frames: [{ file: `0${id}.webp`, width: w, height: h, anchor_x: 0, anchor_y: 0 }] };
  }
  bank.addMapSprites(out);
}

// ------------------------------------------------------------------ settings (§8.1)

const KEY_WALKERS = 'rich4.walkers', KEY_NEON = 'rich4.neon';
/** Both rows of the settings: 0 開, 1 關. */
export const STREET_MODES = ['開', '關'];
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const stored = (key: string, fallback: number) => {
  try { const v = localStorage.getItem(key); return v === '0' || v === '1' ? Number(v) : fallback; } catch { return fallback; }
};
/** 街頭行人: on by default, off on the low memory tier and when the system asks for less motion. */
export const walkersMode = () => stored(KEY_WALKERS, memTier().name === 'low' || reducedMotion() ? 1 : 0);
/** 霓虹閃爍: on by default, off when the system asks for less motion. */
export const neonMode = () => stored(KEY_NEON, reducedMotion() ? 1 : 0);
const listeners = new Set<() => void>();
const write = (key: string, v: number) => {
  try { localStorage.setItem(key, String(v)); } catch { /* not kept */ }
  for (const f of listeners) f();
};
export const setWalkersMode = (v: number) => write(KEY_WALKERS, v);
export const setNeonMode = (v: number) => write(KEY_NEON, v);

// ------------------------------------------------------------------ the street (§8)

/** Screens that cover the map or ask something: the passers-by stand still meanwhile (§8.1). */
const COVERS = '.ui-layer.show, .pl-scene, .fx-overlay, .te-cover, .shop, .bk-atm-ov, .bk-counter-ov, .dv-ov, .bm-overlay, .slots-overlay, .rd-ov';

/** mulberry32: the street's own numbers (never the rules' rand()). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small hash of a sign's id, 0..1 (its own rhythm). */
const hash01 = (n: number, salt: number) => {
  let h = Math.imul((n ^ salt) >>> 0, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

interface Path { pts: [number, number][]; cum: number[]; len: number; closed: boolean }

interface Walker {
  path: Path;
  /** Distance along the path and the way it walks it (+1 / −1; a loop always +1). */
  s: number;
  dir: number;
  /** Map px per second. */
  speed: number;
  kind: number;
  /** Walk-cycle clock in frames (12 a second). */
  anim: number;
  /** Seconds still standing (looking at the phone), and until the next stop. */
  stop: number;
  nextStop: number;
  x: number;
  y: number;
  /** The way it faces, in map px (kept while standing). */
  vx: number;
  vy: number;
}

/**
 * The living street of 歌舞伎町 (§8): the passers-by and the neon. Its clock is its own (the screen's frames, not
 * the game's tick): it stops while a dialog or a screen is open, while the page is hidden, and runs at the same
 * pace whatever the game speed.
 */
export class KbStreet {
  private walkers: Walker[] = [];
  private paths: Path[];
  private last = 0;
  private frame = 0;
  private covered = false;
  private walkOn = walkersMode() === 0;
  private neonAnim = neonMode() === 0;
  /** The low tier glows the whole picture faintly instead of keeping a neon mask per frame (no extra memory). */
  private readonly cheap = memTier().name === 'low';
  private masks = new WeakMap<CanvasImageSource, HTMLCanvasElement | null>();
  private built = 0;
  private readonly unlisten: () => void;

  constructor(readonly game: Game, paths: [number, number][][]) {
    this.paths = paths.filter(p => p.length >= 2).map(pts => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const a = pts[0], b = pts[pts.length - 1];
      return { pts, cum, len: cum[cum.length - 1], closed: Math.hypot(a[0] - b[0], a[1] - b[1]) < 1 };
    }).filter(p => p.len > 0);
    this.populate();
    const update = () => { this.walkOn = walkersMode() === 0; this.neonAnim = neonMode() === 0; };
    listeners.add(update);
    this.unlisten = () => listeners.delete(update);
  }

  destroy() { this.unlisten(); }

  /** The same crowd for the same game: start points from the game's seed, spread by path length. */
  private populate() {
    const total = this.paths.reduce((s, p) => s + p.len, 0);
    if (!total) return;
    const r = prng((this.game.settings.seed ^ 0x6b61626b) >>> 0);
    for (let i = 0; i < memTier().walkers; i++) {
      let u = r() * total, path = this.paths[0];
      for (const p of this.paths) { if (u < p.len) { path = p; break; } u -= p.len; }
      const w: Walker = {
        path, s: r() * path.len, dir: path.closed || r() < 0.5 ? 1 : -1, speed: 18 + r() * 12, kind: Math.floor(r() * WALKER_KINDS),
        anim: r() * 4, stop: 0, nextStop: 5 + r() * 35, x: 0, y: 0, vx: 0, vy: 1,
      };
      this.place(w);
      this.walkers.push(w);
    }
  }

  /** Position and heading at the walker's distance along its path. */
  private place(w: Walker) {
    const { pts, cum } = w.path;
    let i = 1;
    while (i < pts.length - 1 && cum[i] < w.s) i++;
    const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, k = Math.max(0, Math.min(1, (w.s - cum[i - 1]) / seg));
    w.x = a[0] + (b[0] - a[0]) * k; w.y = a[1] + (b[1] - a[1]) * k;
    w.vx = (b[0] - a[0]) * w.dir; w.vy = (b[1] - a[1]) * w.dir;
  }

  /** One screen frame: the street's clock moves on unless something covers the map. */
  advance() {
    const now = performance.now(), dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.frame++ % 12 === 0) this.covered = (typeof document !== 'undefined' && (document.hidden || !!document.querySelector(COVERS)));
    if (!this.walkOn || this.covered || !dt) return;
    for (const w of this.walkers) {
      if (w.stop > 0) { w.stop -= dt; if (w.stop <= 0) w.anim = 0; continue; }
      if ((w.nextStop -= dt) <= 0) {
        // About once in 20–40 s a passer-by stops for 2 s (to look at the phone, §8.1).
        const h = hash01(Math.floor(w.s * 7) + w.kind, 0x51);
        w.stop = 2; w.nextStop = 20 + h * 20; w.anim = 0;
        continue;
      }
      const L = w.path.len;
      w.s += w.dir * w.speed * dt;
      if (w.path.closed) w.s = ((w.s % L) + L) % L;
      else if (w.s > L) { w.s = 2 * L - w.s; w.dir = -1; }
      else if (w.s < 0) { w.s = -w.s; w.dir = 1; }
      w.anim += dt * 12;
      this.place(w);
    }
  }

  /**
   * The passers-by to draw: map point, sprite and frame. `toScreen` turns a map vector into a screen one, so the
   * row facing closest to the walk on screen is chosen: rows 0..3 of the sheets face down-left, up-right, up-left
   * and down-right on screen (blockout views 1, 3, 5, 7 as the redraws came out). `flip`: drawn mirrored.
   */
  walkersToDraw(toScreen: (dx: number, dy: number) => { x: number; y: number }): { x: number; y: number; res: number; frame: number; flip: boolean }[] {
    if (!this.walkOn) return [];
    return this.walkers.map(w => {
      const v = toScreen(w.vx, w.vy), phase = w.stop > 0 ? 0 : Math.floor(w.anim) % 4;
      let row = v.y >= 0 ? (v.x < 0 ? 0 : 3) : (v.x >= 0 ? 1 : 2), flip = false;
      if (row === 3 && MIRROR_DOWN_RIGHT.has(w.kind)) { row = 0; flip = true; }
      return { x: w.x, y: w.y, res: WALKER_SPRITE + w.kind, frame: row * 4 + phase, flip };
    });
  }

  /** The walkers' sprites (for the loading screen; none while they are off). */
  walkerSprites(): number[] {
    return this.walkOn && this.walkers.length ? Array.from({ length: WALKER_KINDS }, (_, i) => WALKER_SPRITE + i) : [];
  }

  /** Whether a map sprite carries neon (the landmarks, the shops, the houses). */
  static glows(res: number): boolean {
    return (res >= LANDMARK_FIRST && res <= LANDMARK_LAST) || (res >= 1771 && res <= HOUSE_SPRITE + 4);
  }

  /**
   * The neon's brightness for sign `id` now (§8.2): a breath between 0.75 and 1.0 over 2–4 s, and on one sign in
   * five a quick double blink every 8–15 s; stepped at 12 fps. 霓虹閃爍 off: a steady 0.9. The news 節電令
   * (blackout) halves it.
   */
  level(id: number): number {
    let v = 0.9;
    if (this.neonAnim) {
      const t = Math.floor(performance.now() / 83) * 0.083;
      const period = 2 + 2 * hash01(id, 0x1e), phase = hash01(id, 0x2f);
      v = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin((t / period + phase) * Math.PI * 2));
      if (hash01(id, 0x3a) < 0.2) {
        const every = 8 + 7 * hash01(id, 0x4b), u = (t + phase * every) % every;
        if (u < 0.1 || (u >= 0.2 && u < 0.3)) v = 0;
      }
    }
    const kb = kbRules(this.game);
    return (kb?.s.mods.blackout ?? 0) > 0 ? v / 2 : v;
  }

  /**
   * Draws the glow of a sign over its sprite (already drawn at dx, dy, dw, dh in CSS px): the picture's bright,
   * saturated pixels (the neon tubes and lit windows), softened, added with 'lighter'. The masks are made once per
   * decoded picture at half its size, at most two a frame; the low memory tier adds the whole picture faintly.
   */
  glow(ctx: CanvasRenderingContext2D, img: CanvasImageSource, id: number, dx: number, dy: number, dw: number, dh: number) {
    const v = this.level(id);
    if (v <= 0) return;
    if (this.cheap) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 * v;
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
      return;
    }
    let mask = this.masks.get(img);
    if (mask === undefined) {
      if (this.built >= 2) return;
      this.built++;
      mask = neonMask(img);
      this.masks.set(img, mask);
    }
    if (!mask) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85 * v;
    ctx.drawImage(mask, dx, dy, dw, dh);
    ctx.restore();
  }

  /** Called once a frame by the board before drawing (the mask budget). */
  beginFrame() { this.built = 0; }
}

/** The neon part of a picture at half size, with a soft halo; null when it has none (or cannot be read). */
function neonMask(img: CanvasImageSource): HTMLCanvasElement | null {
  const { w: W, h: H } = picSize(img);
  const w = Math.max(1, Math.round(W / 2)), h = Math.max(1, Math.round(H / 2));
  if (W < 2 || H < 2) return null;
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, w, h);
    const data = x.getImageData(0, 0, w, h), px = data.data;
    let any = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      // Bright and coloured: the tubes, the lit signs, warm windows; the walls, roofs and shadows stay out.
      const k = a < 128 ? 0 : Math.max(0, Math.min(1, (mx - 170) / 60)) * Math.max(0, Math.min(1, (sat - 0.35) / 0.3));
      if (k > 0) any++;
      px[i + 3] = Math.round(255 * k);
    }
    if (any < (w * h) / 400) return null;
    x.putImageData(data, 0, 0);
    // The halo: the mask blurred under itself (browsers without canvas filters keep the sharp mask only).
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const o = out.getContext('2d')!;
    o.filter = `blur(${Math.max(1.5, w / 120).toFixed(1)}px)`;
    o.drawImage(c, 0, 0);
    o.filter = 'none';
    o.drawImage(c, 0, 0);
    return out;
  } catch { return null; }
}
