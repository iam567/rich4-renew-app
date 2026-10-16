/**
 * The map info box (docs/rules/09 §6.4, fcn_00417559): pressing the map shows what is there in Data#517.0-3
 * (189×116, the tail tip is the anchor) with the tip on the press. The frame is (y ≥ 116 above the press ? the
 * box goes above : below) + (press right of 251 ? the box goes left : right); the original's lines are 16 px
 * bold, centred 103 px beside the tip from 42 px below it (box below) or 96 px above it (box above); here they
 * are centred in the redrawn box's blue panel.
 * The original closes it as soon as the mouse moves or is released; on a touch screen it stays 3 s or until
 * the next press. Event squares get a line about what they do (the original shows nothing for them).
 */
import type { Game } from '../core/game';
import { eventName } from '../core/game';
import { OBJECT_NAMES } from '../core/modules/objects';
import { toolDef } from '../core/modules/tools';
import { nodeById } from '../core/board';
import type { SpriteBank } from './sprites';

type Pt = { x: number; y: number };

const HOUSE = ['空  地', '平  房', '店  舖', '商  場', '商業大樓', '摩天大樓'];
const LEVEL = ['０級', '一級', '二級', '三級', '四級', '五級'];
const FACILITY = ['公  園', '旅  館', '購物中心', '加油站', '研究所', '輪盤館', '二十一點館', '百家樂館', '德州撲克館', '骰寶館']; // 5..9 大富翁城's halls (docs/rules/19)
/** What an event square does (the remake's addition). */
const EVENT_TEXT: Record<number, string> = {
  2: '停留時播報一則新聞', 3: '停留時抽一張命運', 4: '入獄的人在這裡服刑', 5: '住院的人在這裡休養',
  6: '停留可玩小遊戲賺點券', 7: '停留可玩小遊戲賺點券', 8: '停留可玩小遊戲賺點券',
  9: '停留可買樂透，每月15日開獎', 10: '停留得點券 50', 11: '停留得點券 30', 12: '停留得點券 10',
  13: '停留得一張卡片', 14: '路過可存提款\n停留可貸款、還款', 15: '停留可買賣道具和卡片', 16: '停留時施展魔法',
};

/** Lines for whatever is at a world point, nearest first by layer (actors, objects, plots, scenery, squares). */
export function describe(game: Game, at: Pt, actorPos: (id: number) => Pt | undefined): { pos: Pt; lines: string[] } | null {
  const b = game.board, pi = game.priceIndex;
  const near = <T extends Pt>(items: T[], r: number): T | undefined => {
    let best: T | undefined, d = r;
    for (const it of items) { const e = Math.hypot(it.x - at.x, it.y - at.y); if (e < d) { d = e; best = it; } }
    return best;
  };
  const who = (owner: number) => (owner > 0 && game.players[owner - 1] ? game.name(owner - 1) : '');
  // Players (drawn where their actor stands).
  const ps = game.players.filter(p => !p.bankrupt && p.placed).map(p => ({ ...(actorPos(p.id) ?? nodeById(b, p.node)), p }));
  const p = near(ps, 26);
  if (p) return { pos: p, lines: [game.name(p.p.id)] };
  // Objects lying on the map (gods, dog, gift, chest, roadblocks, mines, bombs).
  const objs = game.objects.slots.filter(o => o.node && !o.owner).map(o => ({ ...nodeById(b, o.node), o }));
  const o = near(objs, 24);
  if (o) return { pos: o, lines: [OBJECT_NAMES[o.o.type - 1]] };
  const land = near(b.lands, 30);
  if (land) {
    const owned = land.owner > 0;
    const lines = [who(land.owner), land.chain ? '連鎖店' : HOUSE[land.level] ?? '', LEVEL[land.level] ?? ''];
    if (owned && land.chain) lines.push(`$${pi * 2000}×${b.lands.filter(l => l.chain && l.owner === land.owner).length}`);
    else lines.push(`$${owned ? (land.tolls[land.level] ?? 0) * pi : land.price}`);
    return { pos: land, lines: lines.filter(Boolean) };
  }
  const f = near(b.facilities, 44);
  if (f) {
    const lines = [who(f.owner)];
    if (!f.level && !f.owner) lines.push('空  地');
    else {
      lines.push(f.name || FACILITY[f.type] || '');
      if (f.type === 3) lines.push('×1000');
      else if (f.type === 1 || f.type === 2) lines.push(LEVEL[f.level] ?? '', `×${(f.fees[f.level] ?? 0) * pi}`);
      else if (f.type === 4) lines.push(LEVEL[f.level] ?? '', f.labTool ? toolDef(game.tools.labToolId(f.labTool))?.name ?? '' : '');
    }
    return { pos: f, lines: lines.filter(Boolean) };
  }
  const c = near(b.companies, 44);
  if (c) return { pos: c, lines: [who(c.controller), c.name, `餘股:${c.freeShares}`].filter(Boolean) };
  const sc = near(b.landscapes, 40);
  if (sc) return { pos: sc, lines: [sc.name] };
  const n = near(b.nodes.filter(n => n.event >= 2), 24);
  if (n) return { pos: n, lines: [eventName(n.event), ...(EVENT_TEXT[n.event] ?? '').split('\n')].filter(Boolean) };
  return null;
}

/** The blue panel inside Data#517.0-3 as fractions of the box: left, top, right, bottom (measured on the redraw). */
const PANEL: [number, number, number, number][] = [[0.13, 0.27, 0.94, 0.9], [0.14, 0.09, 0.94, 0.72], [0.05, 0.27, 0.87, 0.9], [0.06, 0.09, 0.87, 0.72]];

/** The box itself, over the map canvas; `show` takes the press in CSS px of the host and the view's zoom. */
export class InfoBubble {
  private readonly el = document.createElement('div');
  private timer = 0;

  constructor(readonly host: HTMLElement, readonly bank: SpriteBank) {
    this.el.className = 'map-info';
    this.el.hidden = true;
    host.append(this.el);
  }

  show(x: number, y: number, zoom: number, lines: string[]) {
    const W = this.host.clientWidth;
    const above = y >= 116 * zoom, left = x > W * 251 / 440;
    const frame = (above ? 1 : 0) + (left ? 2 : 0), art = this.bank.art('Data', 517, frame);
    const w = 189 * zoom, h = 116 * zoom;
    Object.assign(this.el.style, { left: `${left ? x - w : x}px`, top: `${above ? y - h : y}px`, width: `${w}px`, height: `${h}px`,
      backgroundImage: art ? `url('${art.src}')` : '' });
    // The lines are centred in the redrawn box's blue panel (its place differs a little from the original's
    // text offsets, which would push a fourth line past the panel), smaller when there are four.
    const [l, t, r, b] = PANEL[frame], box = document.createElement('div');
    box.className = 'map-info-text';
    Object.assign(box.style, { left: `${l * 100}%`, top: `${t * 100}%`, width: `${(r - l) * 100}%`, height: `${(b - t) * 100}%`,
      fontSize: `${(lines.length > 3 ? 13.5 : 16) * zoom}px` });
    box.append(...lines.map(t => { const s = document.createElement('span'); s.textContent = t; return s; }));
    this.el.replaceChildren(box);
    this.el.hidden = false;
    // A long line wraps inside the panel; if the wrapped lines are then too tall, the text shrinks until it fits.
    for (let px = parseFloat(box.style.fontSize); box.scrollHeight > box.clientHeight + 1 && px > 9 * zoom; px -= 0.5 * zoom)
      box.style.fontSize = `${px}px`;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), 3000);
  }

  hide() { this.el.hidden = true; clearTimeout(this.timer); }
}
