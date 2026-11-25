/**
 * The map info box (docs/rules/09 §6.4, fcn_00417559): pressing the map shows what is there in Data#517.0-3
 * (189×116, the tail tip is the anchor) with the tip on the press. The frame is (y ≥ 116 above the press ? the
 * box goes above : below) + (press right of 251 ? the box goes left : right); the original's lines are 16 px
 * bold, centred 103 px beside the tip from 42 px below it (box below) or 96 px above it (box above); here they
 * are centred in the redrawn box's blue panel.
 * The original closes it as soon as the mouse moves or is released; on a touch screen it stays 3 s or until
 * the next press. Event squares get a line about what they do (the original shows nothing for them).
 */
import { CQ_FAC_NAMES, CQ_MAP } from '../core/chongqing';
import type { Game } from '../core/game';
import { eventName } from '../core/game';
import { OBJECT_NAMES } from '../core/modules/objects';
import { toolDef } from '../core/modules/tools';
import { nodeById } from '../core/board';
import { jqRules } from '../core/jiqing';
import { JQ_WORK_POINTS } from '../core/modules/jq-data';
import { POSTS } from '../core/changan';
import { QINGMING_MAP } from '../core/qingming';
import type { SpriteBank } from './sprites';

type Pt = { x: number; y: number };

const HOUSE = ['空  地', '平  房', '店  舖', '商  場', '商業大樓', '摩天大樓'];
const LEVEL = ['０級', '一級', '二級', '三級', '四級', '五級'];
const FACILITY = ['公  園', '旅  館', '購物中心', '加油站', '研究所', '輪盤館', '二十一點館', '百家樂館', '德州撲克館', '骰寶館', '居酒屋', '陪酒店', '泡泡浴', '情人酒店']; // 5..9 大富翁城's halls (docs/rules/19), 10..13 歌舞伎町's shops (21)
/** What an event square does (the remake's addition). */
const EVENT_TEXT: Record<number, string> = {
  2: '停留時播報一則新聞', 3: '停留時抽一張命運', 4: '入獄的人在這裡服刑', 5: '住院的人在這裡休養',
  6: '停留可玩小遊戲賺點券', 7: '停留可玩小遊戲賺點券', 8: '停留可玩小遊戲賺點券',
  9: '停留可買樂透，每月15日開獎', 10: '停留得點券 50', 11: '停留得點券 30', 12: '停留得點券 10',
  13: '停留得一張卡片', 14: '路過可存提款\n停留可貸款、還款', 15: '停留可買賣道具和卡片', 16: '停留時施展魔法',
  19: '停留可用點券玩柏青哥\n鋼珠可換點券或獎品', 20: '停留可用點券玩拉霸\n代幣可換點券或獎品',
};

/**
 * The remake's own pieces by sprite id (tools/tycoon-art/changan_pieces.py, changan_walls.py). A landscape an editor-made
 * map places (ui/maker/compile.ts) carries no name of its own, so its piece's name is shown (the user 2026-11-20: an
 * empty box pointed at 開元盛世's palaces — say what the building is, or show no box).
 */
const PIECE_NAMES: Record<number, string> = {
  9601: '城牆', 9602: '角樓', 9603: '城門', 9604: '宮牆', 9605: '城門樓', 9606: '明德門', 9607: '角樓', 9608: '坊門',
  9611: '城牆', 9612: '城門', 9613: '明德門', 9614: '角樓',
  9631: '含元殿', 9632: '大雁塔', 9633: '小雁塔', 9634: '勤政務本樓', 9635: '花萼相輝樓', 9636: '紫雲樓', 9637: '太極殿',
  9638: '大興善寺', 9639: '青龍寺', 9640: '西明寺', 9641: '市門', 9642: '國子監', 9643: '驛站', 9644: '鬥雞場', 9645: '貢院',
  9646: '發配所', 9651: '邸店', 9652: '邸店', 9653: '邸店', 9654: '酒肆', 9655: '酒肆', 9656: '酒肆', 9657: '驛站馬廄',
  9658: '梨園', 9659: '將作監', 9660: '將作監', 9661: '將作監', 9671: '民宅', 9672: '民宅', 9673: '商鋪', 9674: '宅院',
  9675: '宅院', 9676: '胡餅鋪', 9677: '絲綢鋪', 9678: '茶藥鋪', 9681: '西域駝隊', 9682: '長安車坊', 9683: '義倉', 9684: '將作監',
  // 清明上河 (tools/tycoon-art/qingming_pieces.py NAMES): the companies, the landmarks, the 水滸 squares' buildings
  9851: '汴河漕運', 9852: '常平倉', 9853: '樊樓正店', 9854: '東京車坊', 9855: '將作監',
  9861: '宣德門', 9862: '大慶殿', 9863: '大相國寺', 9864: '樊樓', 9865: '虹橋', 9866: '州橋', 9867: '開寶寺鐵塔', 9868: '寶津樓',
  9869: '聚義廳', 9870: '梁山寨門', 9871: '城門', 9881: '汴河漕運碼頭', 9882: '貢院', 9883: '景陽岡', 9884: '黃泥岡', 9885: '十字坡',
  9886: '相撲擂台', 9887: '野豬林', 9888: '金沙灘',
  // 清明上河's city wall (tools/tycoon-art/qingming_walls.py): corners with their 角樓, gap ends, gates and water gates
  9890: '角樓', 9891: '城牆', 9892: '城牆', 9893: '封丘門', 9894: '曹門', 9895: '新鄭門', 9896: '南薰門', 9897: '西水門',
  9898: '東水門', 9899: '角樓',
};
/** A piece's name; '' when it has none (the city walls' runs 9620..9629 and 9900..9919 (清明上河, 馬面 too), the palace
 * walls' 9690..9699 by range). */
export function pieceName(res: number): string {
  if ((res >= 9620 && res <= 9629) || (res >= 9900 && res <= 9919)) return '城牆';
  if (res >= 9690 && res <= 9699) return '宮牆';
  return PIECE_NAMES[res] ?? '';
}

/** 清明上河's names for the original squares (editor/maker_qingming.py ERA), as its pads and screens call them. */
const QM_EVENT_NAMES: Record<number, string> = {
  2: '小報', 3: '卦肆', 4: '開封府', 5: '趙太丞家', 6: '掘藏', 7: '捶丸', 8: '元宵燈山', 9: '關撲', 13: '書坊', 14: '交子務',
  15: '相國寺萬姓交易', 16: '上清宮',
};

/** 長安's own squares (Board.specials, core/changan.ts): their names and what they do. */
const SPECIAL_TEXT: Record<string, string[]> = {
  exam: ['貢院', '停留時應試答題'], cock: ['鬥雞場', '停留可押注鬥雞'], exile: ['發配所'],
  move: ['小事件', '停留抽一張小事件：前進、後退、轉向……'],
  // 清明上河's (docs/rules/35-qingming.md)
  boat: ['汴河漕運', '停留可乘漕船去梁山'], juyi: ['聚義廳', '集齊檔口來此兌換'], ling: ['梁山令', '停留抽一張梁山令'],
  tiger: ['景陽岡', '停留上岡打虎'], wrestle: ['相撲擂台', '停留上台比試'], gang: ['黃泥岡', '停留可拉霸搶生辰綱'], inn: ['十字坡', '孫二娘的黑店，會被送回城'],
  pig: ['野豬林', '停留射野豬'], land: ['金沙灘', '梁山泊的渡口'],
  ...Object.fromEntries(Object.entries(POSTS).map(([k, v]) => [k, [v.name, '停留可乘驛馬']])),
};

/**
 * Lines for whatever is at a world point, nearest first by layer (actors, objects, plots, scenery, squares); null when
 * nothing there has a word to show (never an empty box).
 */
export function describe(game: Game, at: Pt, actorPos: (id: number) => Pt | undefined): { pos: Pt; lines: string[] } | null {
  const d = find(game, at, actorPos);
  const lines = d?.lines.map(l => l.trim()).filter(Boolean) ?? [];
  return d && lines.length ? { pos: d.pos, lines } : null;
}

function find(game: Game, at: Pt, actorPos: (id: number) => Pt | undefined): { pos: Pt; lines: string[] } | null {
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
  if (o) return { pos: o, lines: [OBJECT_NAMES[o.o.type - 1], ...(game.rules?.godNote?.(o.o.type) ? [`賭場${game.rules.godNote(o.o.type).slice(1)}`] : [])] };
  const land = near(b.lands, 30);
  if (land) {
    const owned = land.owner > 0;
    // The street's name first (the user 2026-11-03: the task cards name streets — which lot is it?), then the owner,
    // the building and its level on one line, the toll.
    const lines = [land.name, who(land.owner), land.chain ? '連鎖店' : `${(HOUSE[land.level] ?? '').replace(/\s+/g, '')} ${LEVEL[land.level] ?? ''}`];
    if (owned && land.chain) lines.push(`$${pi * 2000}×${b.lands.filter(l => l.chain && l.owner === land.owner).length}`);
    else lines.push(`$${owned ? (land.tolls[land.level] ?? 0) * pi : land.price}`);
    return { pos: land, lines: lines.filter(Boolean) };
  }
  const f = near(b.facilities, 44);
  if (f) {
    // the plot's own name first (the task cards name plots too), then the owner and the facility
    const plot = f.name || '';
    const lines = [plot, who(f.owner)];
    if (!f.level && !f.owner) lines.push('空  地');
    else {
      // 重慶's, 長安's, 清明上河's own names (MapRules.facilityNames)
      const kind = (game.settings.mapId === CQ_MAP ? CQ_FAC_NAMES[f.type] : f.type < 5 ? game.rules?.facilityNames?.[f.type] : undefined) ?? FACILITY[f.type];
      if (kind && kind !== plot) lines.push(kind);
      if (f.type === 3) lines.push('×1000');
      else if (f.type === 1 || f.type === 2) lines.push(LEVEL[f.level] ?? '', `×${(f.fees[f.level] ?? 0) * pi}`);
      else if (f.type === 4) lines.push(LEVEL[f.level] ?? '', f.labTool ? toolDef(game.tools.labToolId(f.labTool))?.name ?? '' : '');
    }
    return { pos: f, lines: lines.filter(Boolean) };
  }
  const c = near(b.companies, 44);
  if (c) return { pos: c, lines: [who(c.controller), c.name, `餘股:${c.freeShares}`].filter(Boolean) };
  // Scenery by its own name, else its piece's (an editor-made map's); scenery with neither is passed over.
  const sc = near(b.landscapes.map(s => ({ x: s.x, y: s.y, name: s.name.trim() || pieceName(s.resource + 38) })).filter(s => s.name), 40);
  if (sc) return { pos: sc, lines: [sc.name] };
  const sp = near(b.nodes.filter(n => SPECIAL_TEXT[b.specials?.[n.id] ?? '']), 24);
  if (sp) return { pos: sp, lines: SPECIAL_TEXT[b.specials![sp.id]] };
  const n = near(b.nodes.filter(n => n.event >= 2), 24);
  // (激情歲月's 記工分 pay less: its own amounts)
  const work = jqRules(game) && n ? JQ_WORK_POINTS[n.event] : undefined;
  if (n && work !== undefined) return { pos: n, lines: [`點券${work}`, `停留得點券 ${work}`] };
  const evName = (e: number) => (game.settings.mapId === QINGMING_MAP ? QM_EVENT_NAMES[e] : undefined) ?? eventName(e);
  if (n) return { pos: n, lines: [evName(n.event), ...(EVENT_TEXT[n.event] ?? '').split('\n')].filter(Boolean) };
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
    lines = lines.filter(l => l.trim());
    if (!lines.length) { this.hide(); return; }   // never an empty box
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
