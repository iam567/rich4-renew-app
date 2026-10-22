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
import { warmKbFx } from './screens/kb-fx';
import { BIKE, buildTracks, Crowd, nearestView, walkerFacing } from './kb-crowd';
import { AMB, Ambient, ambientSprites, phoneGlow, type AddItem, type StreetView } from './kb-ambient';
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
/** Landmarks (landscape sprites) that carry neon (the hospital and the prison are not the map's own). */
const LANDMARK_FIRST = 1751, LANDMARK_LAST = 1767;

/** A shop's sprite at its level on 歌舞伎町 (null elsewhere, or for a type that is not one of its five). */
export function kbShopSprite(game: Game, fa: { type: number; level: number }): number | null {
  if (!fa.level || !kbRules(game)) return null;
  const first = SHOP_SPRITE[fa.type];
  return first ? first + Math.max(1, Math.min(5, fa.level)) - 1 : null;
}

/**
 * The small lots' buildings v2 (§9.2, purely visual; owned land without a house keeps the original's character
 * marker): Lv1 one of twelve street shops, Lv2 the 3–4 floor building grown from it, Lv3 / Lv4 / Lv5 one of six 雑居ビル
 * of about 5 / 7 / 10 floors (mixed and themed). Which shop and which tall variant a lot has is fixed by the lot (a hash
 * of the map and the lot), a lot differing from the one before it on its street where it can.
 */
/** Each street shop's Lv1 and Lv2 sprites: 便利店, 牛丼店, 理髮店, 麻將館, 拉麵店 (1811..), then 抓娃娃機店, 藥妝店, 咖啡廳,
 * 烤雞串店, 章魚燒店, 占卜屋, 漫畫網咖 (1861..). */
const LOT_SHOPS: [number, number][] = [
  ...[0, 1, 2, 3, 4].map(s => [1811 + 3 * s, 1813 + 3 * s] as [number, number]),
  ...[0, 1, 2, 3, 4, 5, 6].map(s => [1861 + 2 * s, 1862 + 2 * s] as [number, number]),
];
/** The six 雑居ビル at Lv3 (≈5 floors), Lv4 (≈7) and Lv5 (≈10). */
const TALL_FIRST: Record<number, number> = { 3: 1851, 4: 1831, 5: 1841 };
const LOT_STYLES = LOT_SHOPS.length, TALL_VARIANTS = 6;
const looks = new WeakMap<object, { style: number[]; tall: number[] }>();
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
function lotLooks(game: Game): { style: number[]; tall: number[] } {
  const lands = game.board.lands;
  let v = looks.get(lands);
  if (!v) {
    v = { style: [], tall: [] };
    lands.forEach((l, i) => {
      const h = hash(game.settings.mapId, l.id), same = i > 0 && lands[i - 1].name === l.name;
      let st = h % LOT_STYLES, tv = (h >>> 8) % TALL_VARIANTS;
      if (same && st === v!.style[i - 1]) st = (st + 1) % LOT_STYLES;
      if (same && tv === v!.tall[i - 1]) tv = (tv + 1) % TALL_VARIANTS;
      v!.style.push(st); v!.tall.push(tv);
    });
    looks.set(lands, v);
  }
  return v;
}

/** A small lot's building on 歌舞伎町 at its level (chain stores keep the original's). */
export function kbHouseSprite(game: Game, l: { id?: number; level: number; chain: number | boolean }): number | null {
  if (!l.level || l.chain || !kbRules(game)) return null;
  const lv = Math.max(1, Math.min(5, l.level)), i = game.board.lands.findIndex(x => x.id === l.id);
  if (i < 0) return HOUSE_SPRITE + lv - 1;
  const { style, tall } = lotLooks(game);
  return lv <= 2 ? LOT_SHOPS[style[i]][lv - 1] : TALL_FIRST[lv] + tall[i];
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
export function kbBadges(game: Game, pid: number): { text: string; kind: 'busy' | 'gang' | 'taxi' }[] {
  const kb = kbRules(game);
  if (!kb) return [];
  const out: { text: string; kind: 'busy' | 'gang' | 'taxi' }[] = [];
  if ((kb.s.taxi?.[pid] ?? 0) > 0) out.push({ text: '計程車', kind: 'taxi' }); // 計程車券 put on them: 5 dice next throw
  if (kb.s.gang.holder === pid) out.push({ text: '黑幫附身', kind: 'gang' });
  if ((kb.s.busy[pid] ?? 0) > 0) out.push({ text: '處理事務中', kind: 'busy' });
  return out;
}

/** The same signs on the player panel (ui/side.ts). */
export function kbPanelTags(game: Game, p: Player): string {
  return kbBadges(game, p.id).map((b, i) => `<div class="pp-kb ${b.kind}" style="--i:${i}">${b.text}</div>`).join('');
}

/**
 * The prize counter's own goods (§7.5): the tools 17, 18 as Data#617, 618 (maps/remake/tools/, as the lab tools
 * 614..616) and the cards 37 保鑣卡, 38 暴走卡 as Data#607, 608 (maps/remake/cards/, after 大富豪模式's 601..606).
 */
export function prepareKabukicho(bank: SpriteBank): void {
  const out: MapSprites = {};
  for (const [id, w, h] of [[617, 470, 480], [618, 480, 409]]) {
    out[`Data/0${id}`] = { dir: 'remake/tools', frames: [{ file: `0${id}.webp`, width: w, height: h, anchor_x: 0, anchor_y: 0 }] };
  }
  for (const id of [607, 608]) out[`Data/0${id}`] = { dir: 'remake/cards', frames: [{ file: `0${id}.webp`, width: 660, height: 1024, anchor_x: 0, anchor_y: 0 }] };
  bank.addMapSprites(out);
  bank.addMapSprites(ambientSprites()); // the street life's vehicles, train and street characters (§8.3)
  warmKbFx(bank); // the pictures of the prize goods' animations (screens/kb-fx.ts)
}

// ------------------------------------------------------------------ settings (§8.1)

const KEY_WALKERS = 'rich4.walkers', KEY_NEON = 'rich4.neon', KEY_VEHICLES = 'rich4.vehicles';
/** Both rows of the settings: 0 開, 1 關. */
export const STREET_MODES = ['開', '關'];
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const stored = (key: string, fallback: number) => {
  try { const v = localStorage.getItem(key); return v === '0' || v === '1' ? Number(v) : fallback; } catch { return fallback; }
};
/** 街頭行人: on by default, off on the low memory tier and when the system asks for less motion. */
export const walkersMode = () => stored(KEY_WALKERS, memTier().name === 'low' || reducedMotion() ? 1 : 0);
/** 街頭車輛 (the avenues' traffic, the train, the sirens): like 街頭行人. */
export const vehiclesMode = () => stored(KEY_VEHICLES, memTier().name === 'low' || reducedMotion() ? 1 : 0);
/** 霓虹閃爍: on by default, off when the system asks for less motion. */
export const neonMode = () => stored(KEY_NEON, reducedMotion() ? 1 : 0);
const listeners = new Set<() => void>();
const write = (key: string, v: number) => {
  try { localStorage.setItem(key, String(v)); } catch { /* not kept */ }
  for (const f of listeners) f();
};
export const setWalkersMode = (v: number) => write(KEY_WALKERS, v);
export const setNeonMode = (v: number) => write(KEY_NEON, v);
export const setVehiclesMode = (v: number) => write(KEY_VEHICLES, v);
/** Called when one of these settings changes (激情歲月's street reads 街頭行人 / 街頭車輛 too, ui/jq-street.ts). */
export const onStreetSettings = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

// ------------------------------------------------------------------ the street (§8)

/** Screens that cover the map or ask something: the passers-by stand still meanwhile (§8.1). */
const COVERS = '.ui-layer.show, .pl-scene, .fx-overlay, .te-cover, .shop, .bk-atm-ov, .bk-counter-ov, .dv-ov, .bm-overlay, .slots-overlay, .rd-ov, .kbm-root';

/** A small hash of a sign's id, 0..1 (its own rhythm). */
const hash01 = (n: number, salt: number) => {
  let h = Math.imul((n ^ salt) >>> 0, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/** Street props that glow (ui/kb-ambient.ts): vending machines (they flicker now and then), lanterns, lamps, signs. */
const GLOW_PROPS = new Set([2501, 2502, 2506, 2507, 2508, 2510]);
/** The ramen shops among the small lots' looks (拉麵店, levels 1–3) and how high their roofs are (original px). */
const RAMEN_FIRST = 1811 + 3 * 4, ROOF = [0, 16, 26, 36, 50, 66];
/** How far the walkers' sidewalks lie beyond the map's walker lines (map px, away from the road). */
const SIDEWALK = 9;

/**
 * The living street of 歌舞伎町 (§8): the passers-by (ui/kb-crowd.ts), the traffic, the train, the street characters,
 * the kaiju and the steam (ui/kb-ambient.ts), and the neon. Its clock is its own (the screen's frames, not the
 * game's tick): it stops while a dialog or a screen is open, while the page is hidden, and runs at the same pace
 * whatever the game speed.
 */
export class KbStreet {
  readonly crowd: Crowd;
  readonly ambient: Ambient;
  private last = 0;
  private frame = 0;
  private covered = false;
  private hidden = false;
  private clock = 0;
  private walkOn = walkersMode() === 0;
  private carsOn = vehiclesMode() === 0;
  private neonAnim = neonMode() === 0;
  /** The low tier glows the whole picture faintly instead of keeping a neon mask per frame (no extra memory). */
  private readonly cheap = memTier().name === 'low';
  private masks = new WeakMap<CanvasImageSource, HTMLCanvasElement | null>();
  private built = 0;
  private readonly unlisten: () => void;

  constructor(readonly game: Game, paths: [number, number][][]) {
    const tier = memTier(), seed = (game.settings.seed ^ 0x6b61626b) >>> 0, nodes = game.board.nodes;
    // Only the landmarks with a life of their own (the kaiju, the big screen, the stalls; they never move).
    const marks = game.board.landscapes.map(l => ({ x: l.x, y: l.y, res: l.resource + 38, facing: l.facing })).filter(l => l.res === 1753 || l.res === 1763 || l.res === 1764);
    // The way from a point to the nearest road square (for turning to a shop window, away from the road).
    const roadDir = (x: number, y: number): [number, number] | null => {
      let best: [number, number] | null = null, bd = 90 * 90;
      for (const n of nodes) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = [n.x - x, n.y - y]; } }
      return best;
    };
    // The sidewalks a few px further from the road than the map's lines (the road's edge): walkers keeping left in
    // either direction then both stay off the road.
    // The road is between a sidewalk and its partner across the street (the parallel line about 46 px away; the
    // map writes both sides of every street), so each moves away from its partner.
    const mid = (p: [number, number][]) => [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
    const side = paths.map(p => {
      if (p.length !== 2) return p;
      const [a, b] = p, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l, m = mid(p);
      let best: number[] | null = null, bd = Infinity;
      for (const q of paths) {
        if (q === p || q.length !== 2) continue;
        const n = mid(q), off = (n[0] - m[0]) * nx + (n[1] - m[1]) * ny, along = Math.abs((n[0] - m[0]) * ny - (n[1] - m[1]) * nx);
        if (Math.abs(Math.abs(off) - 46) < 8 && along < 30 && along < bd) { bd = along; best = n; }
      }
      const d = best ? [best[0] - m[0], best[1] - m[1]] : roadDir(m[0], m[1]);
      const s = d && d[0] * nx + d[1] * ny > 0 ? -SIDEWALK : SIDEWALK;
      return p.map(([x, y]) => [x + nx * s, y + ny * s] as [number, number]);
    });
    // Busiest round the cinema plaza and 一番街, quieter towards the edges of the district.
    const busy = (x: number, y: number) => 0.35 + 2.2 * Math.exp(-(((x - 1100) ** 2 + (y - 1400) ** 2) / (650 * 650)));
    this.crowd = new Crowd(buildTracks(side), tier.walkers, seed, roadDir, tier.bikes, busy);
    this.ambient = new Ambient(seed, { vehicles: tier.vehicles, crows: tier.crows }, {
      landmarks: () => marks,
      steamers: () => this.steamers(),
      sirenOk: () => this.walkOn && this.carsOn && !this.covered && !this.hidden,
    }, this.carsOn);
    const update = () => {
      this.walkOn = walkersMode() === 0; this.carsOn = vehiclesMode() === 0; this.neonAnim = neonMode() === 0;
      this.ambient.vehiclesOn = this.carsOn;
      if (!this.carsOn || !this.walkOn) this.ambient.silence();
    };
    listeners.add(update);
    const vis = () => { this.hidden = document.hidden; if (this.hidden) this.ambient.silence(); };
    try { document.addEventListener('visibilitychange', vis); } catch { /* no document (tests) */ }
    this.unlisten = () => { listeners.delete(update); try { document.removeEventListener('visibilitychange', vis); } catch { /* none */ } this.ambient.silence(); };
  }

  destroy() { this.unlisten(); }

  private steam: { x: number; y: number; z: number }[] = [];
  private steamAt = -1;

  /** The izakaya shops' and ramen shops' roofs (steam; the stalls are landmarks), looked up twice a second. */
  private steamers(): { x: number; y: number; z: number }[] {
    if (this.steamAt >= 0 && this.frame - this.steamAt < 30) return this.steam;
    this.steamAt = this.frame;
    const b = this.game.board, out: { x: number; y: number; z: number }[] = (this.steam = []);
    for (const f of b.facilities) if (f.type === 10 && f.level > 0) out.push({ x: f.x, y: f.y, z: ROOF[Math.min(5, f.level)] + 6 });
    for (const l of b.lands) {
      if (!l.level) continue;
      const res = kbHouseSprite(this.game, l);
      if (res !== null && res >= RAMEN_FIRST && res < RAMEN_FIRST + 3) out.push({ x: l.x, y: l.y, z: ROOF[l.level] });
    }
    return out;
  }

  /** One screen frame: the street's clock moves on unless something covers the map. */
  advance() {
    const now = performance.now(), dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.frame++ % 12 === 0) this.covered = (typeof document !== 'undefined' && (document.hidden || !!document.querySelector(COVERS)));
    if (this.covered || !dt) return;
    this.clock += dt;
    if (this.walkOn) this.crowd.step(dt, this.clock);
    if (this.walkOn || this.carsOn) this.ambient.step(dt);
  }

  /**
   * The street's drawings for the board's y-sorted list: the passers-by facing the way they walk on screen (rows
   * and mirroring from ui/kb-crowd.ts walkerFacing), the cyclists, then the ambient life (ui/kb-ambient.ts).
   */
  collect(v: StreetView, add: AddItem) {
    if (this.walkOn) {
      for (const w of this.crowd.walkers) {
        const p = v.visible(w.x, w.y, 60);
        if (!p) continue;
        const h = this.crowd.facing(w), s = v.toScreen(Math.cos(h), Math.sin(h)), deg = Math.atan2(s.y, s.x) * 180 / Math.PI;
        if (w.kind === BIKE) {
          const k = nearestView(deg);
          add(p.y, () => v.sprite(AMB.bicycle, k, p.x, p.y));
          continue;
        }
        const f = walkerFacing(w.kind, deg), phase = w.stop > 0 ? 0 : Math.floor(w.anim) % 4;
        const phone = w.stop > 0 && w.why === 'phone';
        add(p.y, () => {
          v.sprite(WALKER_SPRITE + w.kind, f.row * 4 + phase, p.x, p.y, f.flip);
          if (phone) phoneGlow(v.ctx, p.x, p.y, v.zoom, deg);
        });
      }
    }
    if (this.walkOn || this.carsOn) this.ambient.collect(v, add, this.walkOn);
  }

  /** Whether a street prop at map (x, y) stands where the avenues or the rails are drawn now (it is left out). */
  covers(x: number, y: number): boolean { return this.carsOn && Ambient.onRoad(x, y); }

  /** The avenues and the rails on the ground (only while the traffic is on). */
  drawGround(ctx: CanvasRenderingContext2D) { if (this.carsOn) this.ambient.drawGround(ctx); }

  /** The walkers' and the ambient sprites (for the loading screen; none while they are off). */
  walkerSprites(): number[] {
    const out = this.walkOn && this.crowd.walkers.length ? Array.from({ length: WALKER_KINDS }, (_, i) => WALKER_SPRITE + i) : [];
    return this.walkOn || this.carsOn ? [...out, ...this.ambient.sprites()] : out;
  }

  /** Whether a map sprite carries neon (the landmarks, the shops, the houses). */
  static glows(res: number): boolean {
    return (res >= LANDMARK_FIRST && res <= LANDMARK_LAST) || (res >= 1771 && res <= HOUSE_SPRITE + 4) || (res >= 1811 && res <= 1874) || GLOW_PROPS.has(res);
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
      if (id >= 9000) {
        // Street props: steady; one in three (the vending machines' tubes) stutters three times every 10–25 s.
        v = 0.95;
        if (hash01(id, 0x5c) < 0.34) {
          const every = 10 + 15 * hash01(id, 0x6d), u = (t + phase * every) % every;
          if (u < 0.6 && Math.floor(u / 0.083) % 3 !== 1) v = 0.15;
        }
      } else if (hash01(id, 0x3a) < 0.2) {
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
