/**
 * The shop (docs/rules/05 §8, 09 §7.4): one screen, two pages — the card shop with the witch (卡片屋) and the
 * tool shop with the girl in the cap (道具屋) — switched with the corner tab. Tapping a shelf row buys it at once,
 * tapping an item in the bag below sells it at once for 90 % (no confirmation, as in the original); the shopkeeper
 * answers with the original lines. Hover (mouse) or long-press (touch) shows what an item does in her bubble.
 *
 * Laid out in original pixels on a fixed canvas (640×480 landscape as the original, 480×900 portrait) and scaled
 * to fit. Art: Panel #10 (room, shopkeepers, shelves, tab, bubble, EXIT, points box), Panel #11 (bag, tool icons),
 * Data #571-600 (card pictures).
 *
 * The engine asks one `shop` question per action; the scene stays up between them and is taken down on leaving.
 */
import { eraLine } from '../era-line';
import { CHARACTERS, playerName } from '../../core/characters';
import { cardDef, HAND_LIMIT, cardName, cardPrice, handRoom, handSlots, handStacks, stackOf } from '../../core/modules/cards';
import { MAX_HELD, TOOLS, sellPrice, type ShopAnswer } from '../../core/modules/tools';
import type { Ask } from '../../core/types';
import type { Archive } from '../sprites';
import { askScreens, fxScreens, type ScreenContext } from './registry';
import { audio, Theme } from '../audio';
import { centreWords } from '../bubble-text';
import { fitPhrases, phrases, shrinkText } from '../text';
import './shop.css';

type ShopAsk = Extract<Ask, { t: 'shop' }>;
type Page = 0 | 1;
interface Pt { x: number; y: number }

/** The shopkeepers' lines (rich4_shop.asm table 0x4755c0, Big5 strings 0x46423c..): per page. */
const LINES = [
  { hello: '有什麼我能\n為你服務的嗎？', pick: '請挑選你想要\n兌換的卡片。', poor: '抱歉！\n你的點數不足！', full: '對不起！\n您的卡片欄已滿！', bye: '歡迎下次再來！' },
  { hello: '歡迎光臨\n道具店！', pick: '您要兌換\n什麼道具？', poor: '對不起，\n您的點券不夠！', full: '很抱歉！您的\n道具欄已滿！', bye: '謝謝惠顧！' },
] as const;

/** What each tool does, for the bubble (05 §3). */
export const TOOL_TEXT: Record<number, string> = {
  1: '往前走九步，清掉路上的路障、地雷與炸彈',
  2: '放在路上，經過的人會被擋下來',
  3: '埋在路上，停在上面的人被炸傷住院',
  4: '放在路上，停下的人會背著它走，時間到就爆炸',
  5: '騎上機車，可以擲兩顆骰子',
  6: '開上汽車，可以擲三顆骰子',
  7: '炸毀目標一帶的建築，附近的人送醫',
  8: '指定下一次擲出的點數',
  9: '替一塊土地加蓋一層房子',
  10: '時光倒流，回到擲骰之前',
  11: '把人物或建築傳送到別的地方',
  12: '開工程車上路，幾回合內只能慢慢走',
  13: '整個畫面範圍內，建築全部充公',
};

/**
 * Where things go on each canvas, in original pixels. Landscape is the original screen (09 §7.4): background at
 * (0,0), shopkeeper anchored at (320,240), shelf (5,10), bag (227,293), tab (542,13), EXIT (556,246), points box
 * (230,246), bubble (120,10).
 */
interface Layout {
  w: number; h: number;
  bg: { x: number; y: number; w: number; h: number };
  keeper: [Pt, Pt];
  shelf: Pt; bag: Pt; tab: Pt; exit: Pt; points: Pt;
  label: Pt & { w: number };
  bubble: [Pt & { k: number }, Pt & { k: number }];
  /** Board for what an item does (hover / long-press). */
  info: Pt & { w: number; h: number };
  floor?: number;
  hint?: Pt & { w: number };
}
const LAND: Layout = {
  w: 640, h: 480,
  bg: { x: 0, y: 0, w: 640, h: 480 },
  keeper: [{ x: 372, y: 32 }, { x: 341, y: 11 }],
  shelf: { x: 5, y: 10 }, bag: { x: 227, y: 293 }, tab: { x: 542, y: 13 }, exit: { x: 556, y: 246 }, points: { x: 230, y: 246 },
  label: { x: 326, y: 248, w: 224 },
  bubble: [{ x: 120, y: 10, k: 1 }, { x: 120, y: 10, k: 1 }],
  info: { x: 238, y: 22, w: 300, h: 206 },
};
const PORT: Layout = {
  w: 480, h: 900,
  bg: { x: -267, y: 0, w: 747, h: 560 },
  keeper: [{ x: 276, y: 112 }, { x: 241, y: 53 }],
  shelf: { x: 6, y: 84 }, bag: { x: 9, y: 628 }, tab: { x: 391, y: 4 }, exit: { x: 384, y: 574 }, points: { x: 16, y: 574 },
  label: { x: 112, y: 574, w: 266 },
  bubble: [{ x: 71, y: 81, k: 0.85 }, { x: 106, y: 53, k: 0.85 }],
  info: { x: 236, y: 330, w: 236, h: 222 },
  floor: 560,
  hint: { x: 0, y: 846, w: 480 },
};

/** Waving arm (frame 3 / 19) relative to the shopkeeper's top-left: both are anchored at (320,240). */
const ARM: [Pt, Pt] = [{ x: -49, y: 62 }, { x: 0, y: 17 }];
/** Widest line inside the bubble frames 15 / 34 (their round body, without the tail); centred on it (bubble-text.ts). */
const BUBBLE_WIDTH = [196, 166];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const place = <E extends HTMLElement>(e: E, x: number, y: number, w?: number, h?: number): E => {
  e.style.left = `${x}px`; e.style.top = `${y}px`;
  if (w !== undefined) e.style.width = `${w}px`;
  if (h !== undefined) e.style.height = `${h}px`;
  return e;
};

let scene: ShopScene | null = null;

class ShopScene {
  readonly root = el('div', 'shop');
  private readonly backdrop = el('div', 'shop-backdrop');
  private readonly canvas = el('div', 'shop-canvas');
  private readonly bgImg = el('img', 'shop-bg');
  private readonly floor = el('div', 'shop-floor');
  private readonly keeper = el('div', 'shop-keeper');
  private readonly body = el('img', 'shop-body');
  private readonly arm = el('img', 'shop-arm');
  private readonly mark = el('div', 'shop-mark', '<i></i><i></i><i></i><i></i>');
  private readonly shelf = el('div', 'shop-shelf');
  private readonly shelfImg = el('img', 'shop-shelf-bg');
  private readonly rows = el('div', 'shop-rows');
  private readonly bag = el('div', 'shop-bag');
  private readonly bagImg = el('img', 'shop-bag-bg');
  private readonly cells = el('div', 'shop-cells');
  private readonly tab = el('button', 'shop-tab');
  private readonly tabImg = el('img');
  private readonly exit = el('button', 'shop-exit');
  private readonly exitImg = el('img');
  private readonly points = el('div', 'shop-points');
  private readonly pointsNum = el('span', 'shop-points-n');
  private readonly label = el('div', 'shop-label');
  private readonly hint = el('div', 'shop-hint', '點貨架買進・點背包賣出（九折）・長按看說明');
  private readonly bubble = el('div', 'shop-bubble');
  private readonly bubbleImg = el('img', 'shop-bubble-bg');
  private readonly bubbleText = el('div', 'shop-bubble-text');
  private readonly infoBoard = el('div', 'shop-info msg');

  private page: Page = 0;
  private visited = [false, false];
  private layout: Layout = LAND;
  private ask!: ShopAsk;
  private resolver: ((v: ShopAnswer) => void) | null = null;
  private guard = 0;
  private speechTimer = 0;
  private infoTimer = 0;
  private infoShown = false;
  private leaving = false;
  private lastPointer = 'mouse';
  /** A bag item that just arrived (pop animation on the next render). */
  private arrived: { kind: 'card' | 'tool'; id: number } | null = null;
  private readonly resize = new ResizeObserver(() => this.fit());
  private readonly onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.leave(); };

  constructor(readonly ctx: ScreenContext, readonly p: number) {
    const { root, canvas } = this;
    this.keeper.append(this.body, this.arm, this.mark);
    this.shelf.append(this.shelfImg, this.rows);
    this.bag.append(this.bagImg, this.cells);
    this.tab.append(this.tabImg);
    this.exit.append(this.exitImg);
    const pbox = el('img', 'shop-points-bg');
    this.img(pbox, 'Panel', 10, 37, 0, 0);
    this.points.append(pbox, this.pointsNum);
    this.bubble.append(this.bubbleImg, this.bubbleText);
    canvas.append(this.bgImg, this.floor, this.keeper, this.shelf, this.points, this.label, this.exit, this.bag, this.tab, this.hint, this.bubble, this.infoBoard);
    root.append(this.backdrop, canvas);
    this.tab.title = '切換卡片屋／道具屋';
    this.exit.title = '離開';
    this.tab.addEventListener('pointerdown', () => this.tab.classList.add('down'));
    this.exit.addEventListener('pointerdown', () => this.exit.classList.add('down'));
    for (const b of [this.tab, this.exit]) for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { b.classList.remove('down'); this.paintButtons(); });
    this.tab.onclick = () => this.switchPage();
    this.exit.onclick = () => this.leave();
    root.addEventListener('pointerdown', e => { this.lastPointer = e.pointerType; }, true);
    // Right click leaves at once (09 §7.4); a touch long-press can also raise contextmenu, so only for the mouse.
    root.addEventListener('contextmenu', e => { e.preventDefault(); if (this.lastPointer === 'mouse') this.leave(); });
    document.addEventListener('keydown', this.onKey);
    ctx.shell.append(root);
    this.resize.observe(root);
    this.fit();
    // Preload the other page so switching does not flash.
    for (const f of [0, 1, 2, 3, 13, 14, 15, 16, 17, 18, 19, 29, 30, 34, 35, 36]) { const a = this.art('Panel', 10, f); if (a) new Image().src = a.src; }
    for (const f of [0, 1]) { const a = this.art('Panel', 11, f); if (a) new Image().src = a.src; }
  }

  private art(archive: Archive, id: number, frame = 0) { return this.ctx.bank.art(archive, id, frame); }
  private img(e: HTMLImageElement, archive: Archive, id: number, frame = 0, x?: number, y?: number) {
    const a = this.art(archive, id, frame);
    if (!a) { e.removeAttribute('src'); return null; }
    if (e.getAttribute('src') !== a.src) e.src = a.src;
    e.alt = '';
    e.draggable = false;
    e.style.width = `${a.w}px`; e.style.height = `${a.h}px`;
    if (x !== undefined && y !== undefined) place(e, x, y);
    return a;
  }

  private fit() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    const portrait = h > w * 1.05;
    const layout = portrait ? PORT : LAND;
    if (layout !== this.layout) { this.layout = layout; if (this.ask) this.render(); }
    this.canvas.classList.toggle('portrait', portrait);
    this.canvas.style.width = `${layout.w}px`;
    this.canvas.style.height = `${layout.h}px`;
    const k = Math.min(w / layout.w, h / layout.h);
    this.canvas.style.transform = `translate(-50%, -50%) scale(${k})`;
  }

  /** A new question: refresh the shelves and wait for the player's next action. */
  update(a: ShopAsk): Promise<ShopAnswer> {
    clearTimeout(this.guard);
    const first = !this.ask;
    this.ask = a;
    this.render();
    if (first) this.enter(true);
    return new Promise(resolve => { this.resolver = resolve; });
  }

  private answer(v: ShopAnswer) {
    const r = this.resolver;
    if (!r) return;
    this.resolver = null;
    // The engine asks again right away; if it never does, do not leave the scene up.
    if (v !== -1) this.guard = window.setTimeout(() => { if (!this.resolver) this.destroy(); }, 4000);
    r(v);
  }

  // ------------------------------------------------------------ drawing

  private get player() { return this.ctx.game.players[this.p]; }

  private render() {
    const L = this.layout, pg = this.page, a = this.ask, me = this.player;
    this.canvas.dataset.page = String(pg);
    const bg = this.img(this.bgImg, 'Panel', 10, pg * 16);
    place(this.bgImg, L.bg.x, L.bg.y, L.bg.w, L.bg.h);
    if (bg) this.backdrop.style.backgroundImage = `url('${bg.src}')`;
    this.floor.hidden = L.floor === undefined;
    if (L.floor !== undefined) place(this.floor, 0, L.floor, L.w, L.h - L.floor);

    // Shopkeeper and her waving / pointing arm.
    const k = L.keeper[pg];
    place(this.keeper, k.x, k.y);
    const body = this.img(this.body, 'Panel', 10, 2 + pg * 16, 0, 0);
    if (body) { this.keeper.style.width = `${body.w}px`; this.keeper.style.height = `${body.h}px`; }
    this.img(this.arm, 'Panel', 10, 3 + pg * 16, ARM[pg].x, ARM[pg].y);

    // Bubble.
    // On the card page her bubble moves off the shelf, beside it (landscape) or under her face (portrait), so no card
    // is hidden while she talks (the long 大富豪模式 shelf fills the shelf's whole width).
    const wide = pg === 0;
    const b = wide ? (L === PORT ? { x: 232, y: 296, k: 0.85 } : { x: 232, y: 12, k: 0.85 }) : L.bubble[pg];
    const bub = this.img(this.bubbleImg, 'Panel', 10, pg ? 34 : 15, 0, 0);
    place(this.bubble, b.x, b.y, bub?.w, bub?.h);
    this.bubble.style.transform = `scale(${b.k})`;
    this.bubbleText.style.maxWidth = `${BUBBLE_WIDTH[pg]}px`;
    centreWords(this.bubbleText, `Panel/10/${pg ? 34 : 15}`);
    place(this.infoBoard, L.info.x, L.info.y, L.info.w, L.info.h);

    // Tab (13 = to the tool page / 29 = to the card page), EXIT, points box.
    place(this.tab, L.tab.x, L.tab.y, 85, 85);
    place(this.exit, L.exit.x, L.exit.y, 80, 40);
    this.paintButtons();
    place(this.points, L.points.x, L.points.y, 90, 40);
    this.pointsNum.textContent = String(a.points);
    this.points.title = `點券 ${a.points}`;

    // Label over the bag: who is shopping, and how full the bag is.
    place(this.label, L.label.x, L.label.y, L.label.w, 36);
    const ch = CHARACTERS[me.character];
    const face = this.art('Data', 2, ch.id);
    const used = pg === 0 ? `${handSlots(me.cards, stackOf(this.ctx.game))}/${HAND_LIMIT}` : `${me.tools.filter(Boolean).length} 種`;
    this.label.title = '點背包裡的東西即可賣出，得九折點券';
    this.label.innerHTML = `${face ? `<img src="${face.src}" alt="">` : ''}<b>${esc(playerName(me))}</b><span>${pg === 0 ? '卡片' : '道具'}</span><span class="n">${used}</span><span class="s">9折收購</span>`;
    this.hint.hidden = !L.hint;
    if (L.hint) place(this.hint, L.hint.x, L.hint.y, L.hint.w, 30);

    this.renderShelf();
    this.renderBag();
  }

  private paintButtons() {
    const pg = this.page;
    this.img(this.tabImg, 'Panel', 10, (pg ? 29 : 13) + (this.tab.classList.contains('down') ? 1 : 0), 0, 0);
    this.img(this.exitImg, 'Panel', 10, this.exit.classList.contains('down') ? 36 : 35, 0, 0);
    this.tab.setAttribute('aria-label', pg ? '到卡片屋' : '到道具屋');
  }

  /**
   * The shelf: the original puts card rows 24 px apart from y 81 (6..15 cards) and tool rows 48 px apart from
   * y 80 (09 §7.4), relative to (5,10). The redrawn Panel #10.1 / 10.17 moved its stripes (cards about 22 px,
   * tools about 57 px under a taller header), so the list area gets a plain face and every row draws its own
   * cell inside it: card list area (10,66)-(212,452), tool list area (14,80)-(208,447).
   */
  private renderShelf() {
    const pg = this.page, a = this.ask, me = this.player;
    place(this.shelf, this.layout.shelf.x, this.layout.shelf.y, 222, 462);
    this.img(this.shelfImg, 'Panel', 10, 1 + pg * 16, 0, 0);
    this.rows.replaceChildren(pg === 0 ? place(el('div', 'shop-face card'), 10, 66, 202, 386) : place(el('div', 'shop-face tool'), 14, 80, 194, 367));
    if (pg === 0) {
      const stack = stackOf(this.ctx.game), full = (id: number) => !handRoom(me.cards, id, stack);
      // 大富豪模式's shelf has every card (05 §8.3, 17 §3.10): more than the 15 rows that fit, so two columns of shorter
      // rows in the same list area, every card on the one page.
      const many = a.cards.length > 15, per = Math.ceil(a.cards.length / 2), step = many ? Math.min(25, Math.floor(378 / per)) : 25;
      a.cards.forEach((id, i) => {
        const row = many
          ? place(el('button', 'shop-row card compact'), 13 + 99 * Math.floor(i / per), 70 + step * (i % per), 97, step - 2)
          : place(el('button', 'shop-row card'), 14, 70 + 25 * i, 194, 23);
        if (!id) {
          row.classList.add('sold');
          row.innerHTML = '<span class="nm">已售出</span><span class="pr">SOLD</span>';
          row.disabled = true;
        } else {
          const price = cardPrice(id), poor = a.points < price;
          row.classList.toggle('poor', poor);
          row.classList.toggle('full', full(id));
          row.classList.toggle('always', !!a.always?.includes(id)); // 大富豪模式: always in stock (17 §3.10)
          row.innerHTML = `<span class="nm">${esc(cardName(id))}</span><span class="pr">$${price}</span>`;
          row.title = `${cardName(id)}　$${price}${a.always?.includes(id) ? '（常備，可一直買）' : ''}\n${(cardDef(id)?.text ?? "")}`;
          this.press(row, () => this.buy('card', i), () => this.cardInfo(id, price));
        }
        this.rows.append(row);
      });
      if (many) requestAnimationFrame(() => shrinkText(this.rows, '.shop-row.compact .nm', 9));
      if (!a.cards.length) this.rows.append(place(el('div', 'shop-empty', '卡片賣完了'), 14, 70, 194, 48));
    } else {
      a.tools.forEach((id, i) => {
        const row = place(el('button', 'shop-row tool'), 18, 83 + 45 * i, 186, 42);
        if (!id) {
          row.classList.add('sold');
          row.innerHTML = '<span class="nm">已售出</span><span class="pr">SOLD</span>';
          row.disabled = true;
        } else {
          const d = TOOLS[id - 1], held = me.tools[id - 1];
          row.classList.toggle('poor', a.points < d.price);
          row.classList.toggle('full', held >= MAX_HELD);
          const icon = this.art('Panel', 11, id + 1);
          row.innerHTML = `<span class="ic">${icon ? `<img src="${icon.src}" alt="" style="width:${icon.w}px;height:${icon.h}px">` : ''}</span>
            <span class="nm">${esc(d.name)}</span><span class="pr">$${d.price}</span><span class="held">持有 ${held}/${MAX_HELD}</span>`;
          row.title = `${d.name}　$${d.price}\n${TOOL_TEXT[id] ?? ''}`;
          this.press(row, () => this.buy('tool', i), () => this.toolInfo(id, d.price));
        }
        this.rows.append(row);
      });
      if (!a.tools.length) this.rows.append(place(el('div', 'shop-empty', '道具賣完了'), 18, 83, 186, 42));
    }
  }

  /**
   * The bag: 5×3 cells of 80×56 from (5,5) of Panel #11.0 / 11.1; a tap sells the item (09 §7.4). The redrawn
   * grid art does not line up with those cells, so the bag is a drawn panel with its own slots.
   */
  private renderBag() {
    const pg = this.page, me = this.player;
    place(this.bag, this.layout.bag.x, this.layout.bag.y, 412, 180);
    this.bagImg.removeAttribute('src');
    this.cells.replaceChildren(place(el('div', `shop-bag-face ${pg ? 'tool' : 'card'}`), 0, 0, 412, 180),
      ...Array.from({ length: 15 }, (_, k) => place(el('div', 'shop-slot'), 7 + 80 * (k % 5), 7 + 56 * Math.floor(k / 5), 76, 52)));
    const cell = (k: number) => place(el('button', 'shop-cell'), 7 + 80 * (k % 5), 7 + 56 * Math.floor(k / 5), 76, 52);
    const arrived = this.arrived;
    this.arrived = null;
    if (pg === 0) {
      // 大富豪模式: one cell a slot, 「×3」 on a stack; a tap sells one copy of it.
      const stacks = handStacks(me.cards, stackOf(this.ctx.game));
      stacks.forEach((st, k) => {
        const id = st.id, c = cell(k), pic = this.art('Data', 570 + id), get = sellPrice(cardPrice(id));
        c.classList.add('card');
        c.innerHTML = `${pic ? `<img class="pic" src="${pic.src}" alt="">` : ''}<span class="nm">${esc(cardName(id))}</span><span class="pr">+${get}</span>${st.n > 1 ? `<span class="shop-x">×${st.n}</span>` : ''}`;
        c.title = `賣出 ${cardName(id)}：得 ${get} 點券`;
        if (arrived?.kind === 'card' && arrived.id === id && !stacks.slice(k + 1).some(x => x.id === id)) c.classList.add('pop');
        this.press(c, () => this.sell({ sell: 'card', index: st.first }, get, c), () => this.cardInfo(id, cardPrice(id), true));
        this.cells.append(c);
      });
      if (!me.cards.length) this.cells.append(place(el('div', 'shop-empty bag', '沒有卡片'), 7, 63, 396, 52));
    } else {
      let k = 0;
      TOOLS.forEach(d => {
        const n = me.tools[d.id - 1];
        if (!n) return;
        const c = cell(k++), icon = this.art('Panel', 11, d.id + 1), get = sellPrice(d.price);
        c.classList.add('tool');
        c.innerHTML = `${icon ? `<img class="ic" src="${icon.src}" alt="" style="width:${icon.w}px;height:${icon.h}px">` : ''}<span class="pr">+${get}</span><span class="n">×${n}</span>`;
        c.title = `賣出一個${d.name}：得 ${get} 點券`;
        if (arrived?.kind === 'tool' && arrived.id === d.id) c.classList.add('pop');
        this.press(c, () => this.sell({ sell: 'tool', id: d.id }, get, c), () => this.toolInfo(d.id, d.price, true));
        this.cells.append(c);
      });
      if (!k) this.cells.append(place(el('div', 'shop-empty bag', '沒有道具'), 7, 63, 396, 52));
    }
  }

  /** Tap = act; mouse hover or a touch long-press = show what the item does in the bubble. */
  private press(e: HTMLElement, tap: () => void, info: () => void) {
    let timer = 0, long = false;
    e.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      long = false;
      e.classList.add('down');
      if (ev.pointerType !== 'mouse') timer = window.setTimeout(() => { long = true; info(); }, 420);
    });
    const up = () => { clearTimeout(timer); e.classList.remove('down'); };
    e.addEventListener('pointerup', up);
    e.addEventListener('pointercancel', up);
    e.addEventListener('pointerleave', ev => { up(); if (ev.pointerType === 'mouse') this.endInfo(); });
    e.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') info(); });
    e.addEventListener('click', () => {
      if (long) { long = false; this.endInfo(1800); return; }
      tap();
    });
  }

  // ------------------------------------------------------------ actions

  private buy(kind: 'card' | 'tool', index: number) {
    if (!this.resolver || this.leaving) return;
    const a = this.ask, me = this.player, lines = LINES[this.page];
    const id = kind === 'card' ? a.cards[index] : a.tools[index];
    if (!id) return;
    const price = kind === 'card' ? cardPrice(id) : TOOLS[id - 1].price;
    // Refusals in the original order: points first, then the full hand / stack (rich4_shop.asm:1312-1354, 1480-1543).
    if (a.points < price) { this.say(lines.poor, 2000, true); return; }
    if (kind === 'card' ? !handRoom(me.cards, id, stackOf(this.ctx.game)) : me.tools[id - 1] >= MAX_HELD) { this.say(lines.full, 2000, true); return; }
    this.arrived = { kind, id };
    this.floatText(`−${price}`, 'minus');
    this.hop();
    this.answer({ buy: kind, index });
  }

  private sell(v: ShopAnswer, get: number, from: HTMLElement) {
    if (!this.resolver || this.leaving) return;
    from.classList.add('gone');
    this.floatText(`+${get}`, 'plus');
    this.answer(v);
  }

  private switchPage() {
    if (this.leaving) return;
    this.page = this.page ? 0 : 1;
    this.hideBubble();
    this.endInfo();
    this.render();
    this.enter(!this.visited[this.page]);
  }

  /** Entering a page: the first time the shelf slides in from the left and the bag from the right (09 §7.4). */
  private enter(first: boolean) {
    const lines = LINES[this.page];
    this.visited[this.page] = true;
    this.canvas.classList.remove('slide');
    if (first) {
      void this.canvas.offsetWidth;
      this.canvas.classList.add('slide');
      this.say(lines.hello, 1700, false, () => this.say(lines.pick, 2000));
    } else this.say(lines.pick, 1800);
  }

  leave() {
    if (!this.resolver || this.leaving) return;
    this.leaving = true;
    this.endInfo();
    this.canvas.classList.add('bye'); this.keeper.classList.remove('hop'); void this.keeper.offsetWidth; this.keeper.classList.add('hop');
    this.say(LINES[this.page].bye, 2000);
    const r = this.resolver;
    this.resolver = null;
    window.setTimeout(() => {
      this.root.classList.add('out');
      window.setTimeout(() => { this.destroy(); r(-1); }, 260);
    }, Math.max(700, 1300 * this.ctx.scale()));
  }

  destroy() {
    // Back to the background track where it was (fcn_00454bcc after the shop's MIDI07).
    if (scene === this) audio.restore();
    clearTimeout(this.guard);
    clearTimeout(this.speechTimer);
    clearTimeout(this.infoTimer);
    this.resize.disconnect();
    document.removeEventListener('keydown', this.onKey);
    this.root.remove();
    if (scene === this) scene = null;
  }

  // ------------------------------------------------------------ the shopkeeper

  private say(text: string, ms: number, cross = false, then?: () => void) {
    // The shopkeepers' lines are voiced (#0000-#0010).
    void audio.say(text);
    this.bubbleText.innerHTML = esc(eraLine(text)).replace(/\n/g, '<br>');
    this.showBubble();
    this.keeper.classList.toggle('cross', cross);
    this.keeper.classList.remove('talk');
    void this.keeper.offsetWidth;
    this.keeper.classList.add('talk');
    clearTimeout(this.speechTimer);
    this.speechTimer = window.setTimeout(() => {
      this.keeper.classList.remove('talk', 'cross');
      if (then) then(); else this.hideBubble();
    }, ms);
  }

  private info(html: string) {
    clearTimeout(this.infoTimer);
    this.infoShown = true;
    this.infoBoard.innerHTML = html;
    this.infoBoard.classList.remove('show');
    void this.infoBoard.offsetWidth;
    this.infoBoard.classList.add('show');
    // a long clause a little smaller rather than broken inside
    const para = this.infoBoard.querySelector<HTMLElement>('p');
    if (para) fitPhrases(para, 0.75);
  }

  private endInfo(ms = 0) {
    if (!this.infoShown) return;
    clearTimeout(this.infoTimer);
    this.infoTimer = window.setTimeout(() => { this.infoShown = false; this.infoBoard.classList.remove('show'); }, ms);
  }

  private cardInfo(id: number, price: number, held = false) {
    const pic = this.art('Data', 570 + id);
    this.info(`${pic ? `<img class="pic" src="${pic.src}" alt="">` : ''}<div class="txt"><b>${esc(cardName(id))}</b><p>${phrases(cardDef(id)?.text ?? '')}</p>
      <em>${held ? `賣出得 ${sellPrice(price)} 點` : `售價 ${price} 點`}</em></div>`);
  }

  private toolInfo(id: number, price: number, held = false) {
    const icon = this.art('Panel', 11, id + 1), n = this.player.tools[id - 1];
    this.info(`<span class="icb">${icon ? `<img class="ic" src="${icon.src}" alt="" style="width:${icon.w * 1.5}px;height:${icon.h * 1.5}px">` : ''}</span><div class="txt"><b>${esc(TOOLS[id - 1].name)}</b>
      <p>${phrases(TOOL_TEXT[id] ?? '')}</p><em>${held ? `賣出得 ${sellPrice(price)} 點` : `售價 ${price} 點`}・持有 ${n}/${MAX_HELD}</em></div>`);
  }

  private showBubble() {
    this.bubble.classList.remove('show');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('show');
  }
  private hideBubble() { this.bubble.classList.remove('show'); this.keeper.classList.remove('talk', 'cross'); }

  private hop() {
    this.keeper.classList.remove('hop');
    void this.keeper.offsetWidth;
    this.keeper.classList.add('hop');
  }

  /** A number floating up from the points box. */
  private floatText(text: string, cls: string) {
    const L = this.layout.points;
    const f = place(el('div', `shop-float ${cls}`, esc(text)), L.x + 10, L.y - 6, 80, 30);
    this.canvas.append(f);
    window.setTimeout(() => f.remove(), 1100);
  }
}

askScreens['shop'] = (ctx: ScreenContext, a: Ask) => {
  if (a.t !== 'shop') return Promise.resolve(-1);
  if (scene && (scene.p !== a.p || !scene.root.isConnected)) { scene.destroy(); scene = null; }
  if (!scene) {
    // The shop plays MIDI07 (rich4_shop.asm:2196).
    audio.theme(Theme.shop);
    scene = new ShopScene(ctx, a.p);
  }
  return scene.update(a);
};

// Each purchase or sale is announced with fx 'shop'; the scene already shows it, so no pause on the map.
fxScreens['shop'] = async () => {};
