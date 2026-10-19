/**
 * The small map of the right column (docs/rules/09 §3.5): the board seen from above (never rotated), owned
 * property marks in the owner's colour, every player's head, a white frame on the current actor, and the two
 * rotate buttons. Tapping looks at that spot; tapping it again (or the frame) goes back to following.
 */
import { CHARACTERS } from '../core/characters';
import type { Game } from '../core/game';
import { worldSize } from '../core/board';
import type { BoardView } from './board-view';
import type { SpriteBank } from './sprites';

const SIZE = 200;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private looking: { x: number; y: number } | null = null;
  private heads: HTMLImageElement[] = [];
  /** Canvas pixels per map pixel at 1 dpr (raised for the large map). */
  res = 2;

  /** `ground`: the picture under the marks (the original ground, or the 1× preview of a redrawn style). */
  constructor(readonly game: Game, readonly bank: SpriteBank, readonly view: BoardView, public ground: CanvasImageSource) {
    this.el = document.createElement('div');
    this.el.className = 'mm';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mm-canvas';
    // The redrawn Data#517.20/21 came out as letters, so the buttons use plain rotate arrows.
    const arrow = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    const rot = (by: number, left: number) => {
      const b = document.createElement('button');
      b.className = 'mm-rot';
      b.style.left = `${left}px`;
      b.title = by < 0 ? '地圖向左旋轉' : '地圖向右旋轉';
      b.innerHTML = arrow(by < 0 ? 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5' : 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5');
      b.onclick = e => { e.stopPropagation(); view.rotate(by); };
      return b;
    };
    this.el.append(this.canvas, rot(-1, 3), rot(1, 28));
    this.heads = CHARACTERS.map(c => {
      const im = new Image();
      const a = bank.art('Data', 2, c.id);
      if (a) im.src = a.src;
      im.onload = () => this.update();
      return im;
    });
    this.canvas.addEventListener('click', e => {
      const r = this.canvas.getBoundingClientRect();
      const MAP = worldSize(game.board);
      const x = Math.max(220, Math.min(MAP - 220, (e.clientX - r.left) / r.width * MAP));
      const y = Math.max(220, Math.min(MAP - 220, (e.clientY - r.top) / r.height * MAP));
      const near = this.looking && Math.hypot(this.looking.x - x, this.looking.y - y) < 120;
      // Looking elsewhere only while the map may move (a human deciding, 09 §1.4); otherwise the view stays on the actor.
      if (near) { this.looking = null; view.followActor(game.current); }
      else if (view.lookAt(x, y)) this.looking = { x, y };
      this.update();
    });
  }

  update() {
    const dpr = window.devicePixelRatio || 1, px = Math.round(SIZE * this.res * dpr);
    if (this.canvas.width !== px) { this.canvas.width = px; this.canvas.height = px; }
    const ctx = this.canvas.getContext('2d')!, g = this.game, b = g.board, K = SIZE / worldSize(b);
    ctx.setTransform(px / SIZE, 0, 0, px / SIZE, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.ground, 0, 0, SIZE, SIZE);
    // Owned property in the owner's colour, drawn as the plot itself: a lot is a 48 px square (big plots of
    // facilities and companies 96 px) turned to face its road, like the outlines in the ground picture.
    const mark = (ref: number, x: number, y: number, owner: number, big: boolean) => {
      const p = g.players[owner - 1];
      if (!p) return;
      // The plot faces the road squares that belong to it (as the map compiler draws the outlines).
      const own = b.nodes.filter(n => n.ref === ref);
      let tx = 0, ty = 0;
      if (own.length) { for (const n of own) { tx += n.x; ty += n.y; } tx /= own.length; ty /= own.length; }
      else { let d = Infinity; for (const n of b.nodes) { const e = Math.hypot(n.x - x, n.y - y); if (e < d) { d = e; tx = n.x; ty = n.y; } } }
      const side = (big ? 86 : 44) * K, angle = Math.atan2(y - ty, x - tx);
      ctx.save();
      ctx.translate(x * K, y * K); ctx.rotate(angle);
      ctx.fillStyle = hex(CHARACTERS[p.character].color);
      ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
      ctx.lineWidth = 0.5;
      ctx.fillRect(-side / 2, -side / 2, side, side);
      ctx.strokeRect(-side / 2, -side / 2, side, side);
      ctx.restore();
    };
    for (const l of b.lands) if (l.owner) mark(l.id + 2000, l.x, l.y, l.owner, false);
    for (const f of b.facilities) if (f.owner) mark(f.id + 4000, f.x, f.y, f.owner, true);
    for (const c of b.companies) if (c.controller) mark(c.id + 6000, c.x, c.y, c.controller, true);
    // Players' heads.
    for (const p of g.players) {
      if (!p.placed || p.bankrupt || g.offRoad(p)) continue;
      const n = g.node(p.node);
      if (!n) continue; // 大富豪模式: still on another city's square (summoned, arriving)
      const cx = n.x * K, cy = n.y * K, r = 7;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
      ctx.fillStyle = hex(CHARACTERS[p.character].color); ctx.fill();
      ctx.clip();
      const im = this.heads[p.character];
      if (im.complete && im.naturalWidth) ctx.drawImage(im, cx - r + 1, cy - r + 1, r * 2 - 2, r * 2 - 2);
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = hex(CHARACTERS[p.character].color); ctx.lineWidth = 1.6; ctx.stroke();
    }
    // The current actor: a white 30×30 frame; the spot being looked at: red.
    const cur = g.isPlayerId(g.current) ? g.players[g.current] : null;
    const curNode = cur?.placed ? g.node(cur.node) : undefined;
    if (curNode) {
      const n = curNode;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
      ctx.strokeRect(n.x * K - 15, n.y * K - 15, 30, 30);
    }
    if (this.looking) {
      ctx.strokeStyle = '#ff2020'; ctx.lineWidth = 1.2;
      ctx.strokeRect(this.looking.x * K - 15, this.looking.y * K - 15, 30, 30);
    }
  }

  /** The camera went back to following (a new turn). */
  reset() { this.looking = null; this.update(); }
}
