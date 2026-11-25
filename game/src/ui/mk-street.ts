/**
 * An official map in the editor's format with passers-by (長安, the user 2026-11-19: 「添加點動態的行走的人物，小商小販、
 * 行腳商販」): its walkers (MakerMap.crowd, sprites of 4 directions × 4 walk phases as 歌舞伎町's) walk the sidewalks beside
 * its streets (compile.ts sidewalks), keeping off the playing road's squares and the players' tokens. Purely decorative,
 * never touches the rules; its clock stops under any screen and while the page is hidden.
 *
 * The board (ui/board-view.ts) treats it like 激情歲月's JqStreet: `advance`, `collect`, `walkerSprites`, `covers`.
 */
import type { Game } from '../core/game';
import { buildTracks, Crowd, prng, walkerFacing } from './kb-crowd';
import type { AddItem, StreetView } from './kb-ambient';
import { onStreetSettings, walkersMode } from './kabukicho';
import { memTier } from './mem-tier';

const COVERS = '.ui-layer.show, .pl-scene, .fx-overlay, .te-cover, .shop, .bk-atm-ov, .bk-counter-ov, .dv-ov, .bm-overlay, .slots-overlay, .rd-ov';
/** Clearances (map px): nobody on a square or a pad, nor on a player's token. */
const NODE_CLEAR = 30, TOKEN_CLEAR = 40, ROAD_CLEAR = 26;

export class MkStreet {
  readonly crowd: Crowd;
  readonly ambient: { frameInfo: unknown } = { frameInfo: null };
  private last = 0;
  private frame = 0;
  private covered = false;
  private clock = 0;
  private walkOn = walkersMode() === 0;
  private readonly nodePts: [number, number][] = [];
  private readonly segs: [number, number, number, number][] = [];
  tokens: () => { x: number; y: number }[] = () => [];
  private tokenPts: { x: number; y: number }[] = [];
  private readonly unlisten: () => void;

  constructor(readonly game: Game, paths: [number, number][][], private readonly kinds: number[], hot: [number, number, number, number][] = [], private readonly areas: [number, number, number, number, number[]][] = []) {
    const tier = memTier(), seed = (game.settings.seed ^ 0x7c41) >>> 0;
    const nodes = game.board.nodes;
    for (const n of nodes) {
      this.nodePts.push([n.x, n.y]);
      for (const a of n.adjacent) if (a > n.id) { const m = nodes[a - 1]; if (m) this.segs.push([n.x, n.y, m.x, m.y]); }
    }
    const upright = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    const r = prng(seed);
    // paces by kind: most stroll, the child skips along, the porter with his load is slow
    // (the user 2026-11-19: 「每個 NPC 走得再隨機一點，數量再多一些，不然看不出大唐的感覺」) — paces from a dawdle to a
    // brisk walk, spread over the whole lane, stopping now and then, busiest round the markets
    const pace = kinds.map(() => [9 + r() * 4, 20 + r() * 8] as [number, number]);
    const busy = (x: number, y: number) => 0.6 + hot.reduce((s, [hx, hy, hr, w]) => s + w * Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (hr * hr)), 0);
    // (the lanes end short of the playing road; a reach of 30 never joins two across it — the user 2026-11-19: 「不要讓
    // 這些人物進到賽道裡」: an end with nowhere to go turns back)
    this.crowd = new Crowd(buildTracks(paths, 30), Math.round(tier.walkers * (upright ? 0.9 : 1.3)), seed, () => null, 0, busy,
      { kinds: kinds.length, pace, keepRight: true, spread: 9, idle: 2 });
    const off = onStreetSettings(() => { this.walkOn = walkersMode() === 0; });
    this.unlisten = off;
  }

  destroy() { this.unlisten(); }

  advance() {
    const now = performance.now(), dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.frame++ % 12 === 0) this.covered = typeof document !== 'undefined' && (document.hidden || !!document.querySelector(COVERS));
    if (this.covered || !dt || !this.walkOn) return;
    this.clock += dt;
    this.crowd.step(dt, this.clock);
  }

  /** How visible a walker is at (x, y): fading out near a square or a token (0: hidden). */
  private clear(x: number, y: number): number {
    let k = 1;
    const fade = (d: number, c: number) => Math.max(0, Math.min(1, (d - c) / 8));
    for (const tp of this.tokenPts) { const d = Math.hypot(tp.x - x, tp.y - y); if (d < TOKEN_CLEAR + 8) k = Math.min(k, fade(d, TOKEN_CLEAR)); }
    for (const [nx, ny] of this.nodePts) {
      if (Math.abs(nx - x) > NODE_CLEAR + 8 || Math.abs(ny - y) > NODE_CLEAR + 8) continue;
      k = Math.min(k, fade(Math.hypot(nx - x, ny - y), NODE_CLEAR));
      if (k <= 0) return 0;
    }
    for (const [ax, ay, bx, by] of this.segs) {
      if (x < Math.min(ax, bx) - ROAD_CLEAR - 8 || x > Math.max(ax, bx) + ROAD_CLEAR + 8 || y < Math.min(ay, by) - ROAD_CLEAR - 8 || y > Math.max(ay, by) + ROAD_CLEAR + 8) continue;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      k = Math.min(k, fade(Math.hypot(ax + dx * u - x, ay + dy * u - y), ROAD_CLEAR));
      if (k <= 0) return 0;
    }
    return k;
  }

  collect(v: StreetView, add: AddItem) {
    if (!this.walkOn) return;
    this.tokenPts = this.tokens();
    const deg = (dx: number, dy: number) => { const s = v.toScreen(dx, dy); return Math.atan2(s.y, s.x) * 180 / Math.PI; };
    for (const w of this.crowd.walkers) {
      const p = v.visible(w.x, w.y, 60);
      if (!p) continue;
      const a = this.clear(w.x, w.y);
      if (a <= 0) continue;
      const h = this.crowd.facing(w), f = walkerFacing(0, deg(Math.cos(h), Math.sin(h)));
      const phase = w.stop > 0 ? 0 : Math.floor(w.anim) % 4, area = this.areas.find(([x0, y0, x1, y1]) => w.x >= x0 && w.x <= x1 && w.y >= y0 && w.y <= y1),
        res = area ? area[4][w.kind % area[4].length] : this.kinds[w.kind % this.kinds.length];
      add(p.y, () => v.sprite(res, f.row * 4 + phase, p.x, p.y, f.flip, a));
    }
  }

  covers(_x: number, _y: number): boolean { return false; }
  drawGround(_ctx: CanvasRenderingContext2D) { /* the roads are the ground's own */ }
  beginFrame() { /* nothing */ }
  glow() { /* nothing */ }
  walkerSprites(): number[] { return this.walkOn ? [...this.kinds, ...this.areas.flatMap(a => a[4])] : []; }
}
