/**
 * 大富豪模式 on screen (docs/rules/17 §10-§12): building the world from the five cities' records, the overlay's
 * sprites, the world badge (city, rivals left) with the live ticker of what happens in the other cities, the recent
 * log, and the travel dialog. The map, the HUD and every other screen are the normal game's, on the city shown.
 */
import { parseBoard, type RawMap } from '../core/board';
import { CHARACTERS } from '../core/characters';
import type { Ask, GameEvent, TravelOption } from '../core/types';
import { applyOverlay, CITY_NAMES, LAND_INDEX, mergeLines, RESORT, TYCOON_SPRITES, World, type TickerLine, type TycoonOverlay, type TycoonSettings } from '../core/world';
import { loadWorld as restoreWorld, reshuffleWorld, type WorldSaveData } from '../core/save';
import { ASSETS, loadMapData, type MapSprites } from './assets';
import type { SpriteBank } from './sprites';
import { askScreens, fxScreens, type ScreenContext } from './screens/registry';
import { TOOL_TEXT } from './screens/shop';
import { audio, Sfx } from './audio';
import { phrases, shrinkText } from './text';
import { icbmFlight } from './icbm-flight';
import { onePage, pageRows, pickLayout, rowsReadable } from './fit-list';
import './tycoon.css';

/** The world being played (null in a normal game); screens that differ in 大富豪模式 read it. */
export const tycoon: { world: World | null } = { world: null };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
/** A colour per city for tags (東京 red, 大阪 orange, 札幌 sky, 九州 green, 沖繩 sea). */
export const CITY_COLORS: Record<number, string> = { 100: '#e0303c', 101: '#f08a1c', 102: '#3a9be0', 103: '#2ea84a', 104: '#16b3c0' };
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa', 105: 'finale' }; // 105 大富翁城 (docs/rules/19)
/** The city's illustrated postcard (tools/tycoon-art/map_thumbs.py; the same picture as its entry in maps/remake/index.json). */
export const cityThumb = (mapId: number) => `${ASSETS}/maps/remake/${KEYS[mapId]}-postcard.webp`;

/** The five cities' boards with the tycoon overlay (records only; no ground art is loaded here). */
async function boards(maps: number[]) {
  const raws = await Promise.all(maps.map(id => loadMapData(id)));
  return raws.map((raw, i) => applyOverlay(parseBoard(raw as RawMap), raw.tycoon as TycoonOverlay | undefined, maps[i]));
}

export async function newWorld(settings: TycoonSettings): Promise<World> {
  return new World(settings, await boards(settings.maps));
}

/** A saved world, with the stock and company names of the maps as they are now. */
export async function resumeWorld(save: WorldSaveData): Promise<World> {
  const w = restoreWorld(save, await boards(save.settings.maps));
  reshuffleWorld(w, crypto.getRandomValues(new Uint32Array(1))[0]); // issue #5: not the same dice as last time
  return w;
}

/** The overlay's pads and buildings (maps/remake/sprites/NNNN/frames.json) into the sprite bank. */
export async function registerSprites(bank: SpriteBank): Promise<void> {
  const out: MapSprites = {};
  await Promise.all(TYCOON_SPRITES.map(async res => {
    const id = String(res).padStart(4, '0');
    try {
      const r = await fetch(`${ASSETS}/maps/remake/sprites/${id}/frames.json`);
      if (r.ok) out[`map/${id}`] = { dir: `remake/sprites/${id}`, frames: await r.json() };
    } catch { /* drawn as nothing */ }
  }));
  // The tycoon cards 31..36 (17 §3.5) as Data#601..606, after the original cards Data#571..600 (maps/remake/cards/);
  // 複製卡 (39) as Data#609.
  for (const id of [601, 602, 603, 604, 605, 606, 609]) out[`Data/0${id}`] = { dir: 'remake/cards', frames: [{ file: `0${id}.webp`, width: 660, height: 1024, anchor_x: 0, anchor_y: 0 }] };
  // 大富豪模式's lab tools 14-16 (17 §3.6) as Data#614..616 (maps/remake/tools/), in the size of the Panel#11 icons.
  for (const [id, w, h] of [[614, 480, 438], [615, 480, 471], [616, 480, 465]]) out[`Data/0${id}`] = { dir: 'remake/tools', frames: [{ file: `0${id}.webp`, width: w, height: h, anchor_x: 0, anchor_y: 0 }] };
  bank.addMapSprites(out, true);
}

/** The world badge (17 §10): which city is shown, its land index, how many rivals are left; a tap opens the log. */
export class WorldBar {
  readonly el: HTMLElement;
  private badge: HTMLElement;
  onOpen: () => void = () => {};

  constructor(readonly world: World) {
    this.el = document.createElement('div');
    this.el.className = 'wb';
    this.el.innerHTML = '<button class="wb-badge"></button>';
    this.badge = this.el.querySelector('.wb-badge')!;
    this.el.addEventListener('click', () => { audio.ui('click'); this.onOpen(); });
    this.update();
  }

  update() {
    const w = this.world, v = w.view(), id = v >= 0 ? w.mapId(v) : 0, h = w.human();
    const trip = h?.trip ? '在路上 → ' : '';
    this.badge.innerHTML = `<i style="--cc:${CITY_COLORS[id] ?? '#888'}"></i><b>${trip}${esc(CITY_NAMES[id] ?? '')}</b><span>地價×${(LAND_INDEX[id] ?? 1).toFixed(1)}・對手 ${w.rivalsLeft()}/${w.players.length - 1}</span>`;
  }
}

/** 播報 (系統): 0 詳細 (important and merged everyday lines), 1 只看重要, 2 關. */
export const CHAT_MODES = ['詳細', '只看重要', '關'];
export function chatMode(): number { try { return Math.max(0, Math.min(2, Number(localStorage.getItem('rich4.ticker') ?? 0))); } catch { return 0; } }
export function setChatMode(i: number) { try { localStorage.setItem('rich4.ticker', String(i)); } catch { /* not kept */ } }
const chatShows = (l: TickerLine) => { const m = chatMode(); return m === 0 || (m === 1 && !!l.important); };

/**
 * The chat box (17 §10, an MMO-style log): over the map's lower edge, the other cities' news of the round slide in
 * one by one (0.25 s apart) after the shown city's moves; nothing disappears — idle for 6 s it fades to a faint line,
 * a swipe scrolls the history, a tap opens the full log with filters. Hidden under dialogs and scenes.
 */
export class ChatBox {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private badge: HTMLElement;
  private queue: TickerLine[] = [];
  private pumping = false;
  private unseen = 0;
  private idleTimer = 0;
  onOpen: () => void = () => {};

  constructor(readonly world: World, readonly bank: SpriteBank) {
    this.el = document.createElement('div');
    this.el.className = 'chat idle';
    this.el.innerHTML = '<div class="chat-list"></div><button class="chat-new" hidden></button>';
    this.list = this.el.querySelector('.chat-list')!;
    this.badge = this.el.querySelector('.chat-new')!;
    if (chatMode() === 2) this.el.hidden = true;
    // The history so far (after a city change too): the latest lines of the other cities.
    const v = world.view();
    for (const l of mergeLines(world.log.filter(x => x.map !== v || x.kind === 'title'), p => world.name(p)).slice(-30)) if (chatShows(l)) this.list.append(this.row(l));
    requestAnimationFrame(() => { this.list.scrollTop = this.list.scrollHeight; });
    // A tap (not a swipe) opens the full log; taps stay on the box.
    let y0 = 0, moved = false;
    this.el.addEventListener('pointerdown', e => { y0 = e.clientY; moved = false; e.stopPropagation(); });
    this.el.addEventListener('pointermove', e => { if (Math.abs(e.clientY - y0) > 6) moved = true; });
    this.el.addEventListener('click', e => { e.stopPropagation(); if (!moved) { audio.ui('click'); this.onOpen(); } });
    this.list.addEventListener('scroll', () => { if (this.atEnd()) { this.unseen = 0; this.showBadge(); } this.wake(); });
    this.badge.addEventListener('click', e => { e.stopPropagation(); this.list.scrollTop = this.list.scrollHeight; this.unseen = 0; this.showBadge(); });
  }

  /** 播報 changed in 系統. */
  refresh() { this.el.hidden = chatMode() === 2; }

  private atEnd() { return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 8; }
  private showBadge() { this.badge.hidden = !this.unseen; this.badge.textContent = `▼ 新消息 ${this.unseen}`; }

  private row(l: TickerLine): HTMLElement {
    const r = document.createElement('div');
    r.className = `chat-row${l.important ? ' imp' : ''}${l.kind === 'bankrupt' ? ' hot' : l.kind === 'title' ? ' gold' : ''}`;
    const id = l.map >= 0 ? this.world.mapId(l.map) : 0;
    const q = l.p !== undefined ? this.world.players[l.p] : undefined;
    const f = q ? this.bank.art('Data', 2, q.character) : null;
    r.innerHTML = `<span class="wb-city" style="--cc:${CITY_COLORS[id] ?? '#888'}">${esc(CITY_NAMES[id] ?? '')}</span>${f ? `<img class="chat-face" src="${f.src}" alt="">` : ''}<span class="chat-text">${esc(l.text)}</span>`;
    return r;
  }

  /** A line of the round; they appear one after another. */
  push(l: TickerLine) {
    if (!chatShows(l)) return;
    this.queue.push(l);
    if (!this.pumping) void this.pump();
  }

  private async pump() {
    this.pumping = true;
    while (this.queue.length) {
      const stick = this.atEnd();
      const r = this.row(this.queue.shift()!);
      r.classList.add('in');
      this.list.append(r);
      while (this.list.childElementCount > 400) this.list.firstElementChild!.remove();
      if (stick) this.list.scrollTop = this.list.scrollHeight; else { this.unseen++; this.showBadge(); }
      this.wake();
      await new Promise(res => setTimeout(res, 250));
    }
    this.pumping = false;
  }

  private wake() {
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.el.classList.add('idle'), 6000);
  }
}

/** The full log (17 §10): every line kept for the game, filtered by city, player or importance. */
export function logPanel(w: World, bank: SpriteBank): HTMLElement {
  const box = document.createElement('div');
  box.className = 'wlp';
  let city = -1, who = -1, imp = false;
  // One page, no scrolling: the newest lines that fit, older ones on the next pages (‹ 1/3 ›).
  let page = 0, starts = [0], items: string[] = [];
  const face = (ch: number) => { const f = bank.art('Data', 2, ch); return f ? `<img src="${f.src}" alt="">` : ''; };
  const paginate = () => {
    const list = box.querySelector<HTMLElement>('.wl'), pager = box.querySelector<HTMLElement>('.wlp-pager');
    if (!list || !pager || !list.clientHeight) return;
    page = Math.min(page, starts.length - 1);
    const from = starts[page];
    list.innerHTML = items.slice(from).join('') || '<p class="info-none">沒有符合的消息</p>';
    let shown = list.childElementCount;
    while (shown > 1 && list.scrollHeight > list.clientHeight + 0.5) { list.lastElementChild!.remove(); shown--; }
    // a day heading never ends a page
    if (shown > 1 && list.lastElementChild?.classList.contains('wl-day')) { list.lastElementChild.remove(); shown--; }
    starts = starts.slice(0, page + 1);
    if (from + shown < items.length) starts.push(from + shown);
    const pages = starts.length;
    pager.hidden = pages < 2 && page === 0;
    pager.innerHTML = `<button class="chip" data-pg="-1"${page ? '' : ' disabled'}>‹ 較新</button><span>${page + 1}</span><button class="chip" data-pg="1"${page < pages - 1 ? '' : ' disabled'}>較舊 ›</button>`;
  };
  const render = () => {
    const rows = mergeLines(w.log, p => w.name(p)).filter(l => (city < 0 || l.map === city) && (who < 0 || l.p === who) && (!imp || l.important)).reverse().slice(0, 400);
    let day = -1;
    items = [];
    for (const l of rows) {
      if (l.day !== day) { day = l.day; items.push(`<div class="wl-day">第 ${day + 1} 天</div>`); }
      items.push(`<div class="wl-row${l.important ? ' imp' : ''}">${lineHtml(w, l)}</div>`);
    }
    page = 0; starts = [0];
    box.innerHTML = `<div class="wlp-filters">
        <button class="chip${city < 0 && who < 0 && !imp ? ' on' : ''}" data-f="all">全部</button>
        <button class="chip${imp ? ' on' : ''}" data-f="imp">重要</button>
        ${w.cities.map((_c, i) => `<button class="chip${city === i ? ' on' : ''}" data-city="${i}" style="--cc:${CITY_COLORS[w.mapId(i)]}">${esc(w.cityName(i))}</button>`).join('')}
      </div>
      <div class="wlp-who">${w.players.map(q => `<button class="wlp-face${who === q.id ? ' on' : ''}${q.bankrupt ? ' out' : ''}" data-who="${q.id}" title="${esc(w.name(q.id))}">${face(q.character)}</button>`).join('')}</div>
      <div class="wl"></div><div class="wlp-pager" hidden></div>`;
    paginate();
  };
  new ResizeObserver(() => paginate()).observe(box);
  box.addEventListener('click', e => {
    const pg = (e.target as HTMLElement).closest<HTMLElement>('[data-pg]');
    if (pg) { audio.ui('click'); page = Math.max(0, page + Number(pg.dataset.pg)); paginate(); return; }
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-f],[data-city],[data-who]');
    if (!b) return;
    audio.ui('click');
    if (b.dataset.f === 'all') { city = -1; who = -1; imp = false; }
    if (b.dataset.f === 'imp') imp = !imp;
    if (b.dataset.city) city = city === Number(b.dataset.city) ? -1 : Number(b.dataset.city);
    if (b.dataset.who) who = who === Number(b.dataset.who) ? -1 : Number(b.dataset.who);
    render();
  });
  render();
  return box;
}

/** 「【大阪】阿土伯 在道頓堀買下土地」 with the city's colour and the player's. */
function lineHtml(w: World, l: TickerLine): string {
  const id = l.map >= 0 ? w.mapId(l.map) : 0;
  const ch = l.p !== undefined ? CHARACTERS[w.players[l.p]?.character ?? 0] : null;
  const tag = `<span class="wb-city" style="--cc:${CITY_COLORS[id] ?? '#888'}">${esc(CITY_NAMES[id] ?? '')}</span>`;
  const text = ch ? esc(l.text).replace(esc(ch.name), `<b style="--pc:${hex(ch.color)}">${esc(ch.name)}</b>`) : esc(l.text);
  return `${tag}<span class="wb-msg${l.kind === 'bankrupt' ? ' hot' : l.kind === 'title' ? ' gold' : ''}">${text}</span>`;
}

// ------------------------------------------------------------------ travel dialog (17 §3)

/**
 * The travel dialog: one page, a card per destination with its picture, the fare, the player's lots there and the
 * rivals there; a destination too dear is greyed. 「不搭了」 stays. Answer: the city index or -1.
 */
askScreens.travel = (ctx: ScreenContext, a: Ask) => new Promise<unknown>(resolve => {
  if (a.t !== 'travel') { resolve(-1); return; }
  const station = a.via === 'station';
  const pad = ctx.bank.art('map', station ? 9017 : 9018, 0);
  const me = ctx.game.players[a.p];
  const box = document.createElement('div');
  box.className = `msg tv ${station ? 'rail' : 'air'}`;
  const card = (o: TravelOption) => `<button class="tv-card" data-v="${o.map}" ${o.affordable ? '' : 'disabled'} style="--cc:${CITY_COLORS[o.mapId] ?? '#888'}">
      <span class="tv-pic"><img src="${cityThumb(o.mapId)}" alt=""></span>
      <b class="tv-name">${esc(o.name)}</b>
      <span class="tv-fare">${a.card ? '用卡片' : `${o.price.toLocaleString('zh-Hant')} 元`}</span>
      <span class="tv-meta"><span>地價 ×${(o.landIndex ?? 1).toFixed(1)}</span><span>地產 ${o.owned}・對手 ${o.rivals}</span></span>
      ${(() => { const lord = tycoon.world?.overlordOf(o.map) ?? -1; return lord >= 0 ? `<span class="tv-lord">霸主：${esc(CHARACTERS[ctx.game.players[lord].character].name)}</span>` : ''; })()}
      ${RESORT[o.mapId] ? `<span class="tv-resort"><span>度假勝地</span><span>旅館收入×${RESORT[o.mapId].base}</span><span>（夏季×${RESORT[o.mapId].summer}）</span></span>` : ''}</button>`;
  box.innerHTML = `<div class="ribbon">${pad ? `<img class="tv-pad" src="${pad.src}" alt="">` : ''}${station ? '新幹線' : '飛機'}・從${esc(a.from)}出發</div>
    <div class="tv-note">${phrases(`${a.card ? `用${station ? '電車卡' : '飛行卡'}，不用買票。` : ''}搭乘要停一回合（在路上），下回合從目的地的${station ? '車站' : '機場'}出發。\n現金 ${me.cash.toLocaleString('zh-Hant')}・存款 ${me.bank.toLocaleString('zh-Hant')}`)}</div>
    <div class="tv-cards n${a.options.length}">${a.options.map(card).join('')}</div>
    <div class="choices"><button class="candy ghost" data-v="-1">不搭了</button></div>`;
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
    if (!b || b.disabled) return;
    const v = Number(b.dataset.v);
    audio.ui(v >= 0 ? 'yes' : 'no');
    if (v >= 0) audio.sfx(station ? Sfx.special : Sfx.airplane);
    ctx.close();
    resolve(v);
  });
  // Over the whole game screen: four destination cards need more than a small phone's map area.
  ctx.open(box, true);
  // The city pictures take the height that is left: measured without them, then as tall as the room allows (at most
  // their 3:2 shape), dropped on a very low screen; only then the dialog shrinks as a whole.
  const fit = () => {
    if (!box.isConnected) { ro.disconnect(); return; }
    const layer = box.parentElement;
    if (!layer) return;
    box.style.zoom = '';
    box.style.maxHeight = 'none';
    const ls = getComputedStyle(layer);
    const room = layer.clientHeight - parseFloat(ls.paddingTop) - parseFloat(ls.paddingBottom) - parseFloat(getComputedStyle(box).marginTop);
    const cards = box.querySelector<HTMLElement>('.tv-cards')!, pic = box.querySelector<HTMLElement>('.tv-pic');
    box.style.setProperty('--tvh', '0px');
    const rows = Math.round(cards.offsetHeight / Math.max(1, (cards.firstElementChild as HTMLElement).offsetHeight + 4)) || 1;
    const spare = room - box.offsetHeight - 2;
    const natural = pic ? pic.offsetWidth / 1.5 : 0;
    const h = Math.min(natural, Math.floor(spare / rows) - 4);
    box.style.setProperty('--tvh', h >= 26 ? `${h}px` : '0px');
    box.classList.toggle('no-pic', h < 26);
    shrinkText(box, '.tv-name, .tv-fare, .tv-meta > span, .tv-resort > span, .tv-lord', 9);
    box.style.maxHeight = '';
    if (box.scrollHeight > room + 0.5) box.style.zoom = String(Math.max(0.6, room / box.scrollHeight));
  };
  const ro = new ResizeObserver(fit);
  ro.observe(box.parentElement ?? box);
});

// ------------------------------------------------------------------ announcements

const banner = async (ctx: ScreenContext, cls: string, html: string, ms: number) => {
  const box = document.createElement('div');
  box.className = `msg tb ${cls}`;
  box.innerHTML = html;
  ctx.open(box);
  await new Promise(r => setTimeout(r, ms * ctx.scale()));
  ctx.close();
};

fxScreens['travel-arrive'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { text?: string };
  await banner(ctx, 'arrive', `<div class="msg-text">${phrases(d.text ?? '')}</div>`, 1300);
};
fxScreens['house-full'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { text?: string };
  await banner(ctx, 'full', `<div class="msg-text">${phrases(d.text ?? '')}</div>`, 1800);
};
// ------------------------------------------------------------------ twelve-player screens (17 §12)

type Fx = Extract<GameEvent, { t: 'fx' }>;
const yuan = (n: number) => `${Math.trunc(n).toLocaleString('zh-Hant')}`;

/**
 * A compact sheet of twelve rows (face, name, figures), closed by a tap or after `ms`: over the whole game screen, in
 * the roomiest of one, two or three columns that fits, names shrunk to one line; pages with a pager when not even
 * the smallest rows fit (a tap or the time turns the page first) — no cut-off, no scrolling.
 */
function sheetRows(ctx: ScreenContext, title: string, head: string, rows: string[], ms: number): Promise<void> {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'msg tw';
    box.innerHTML = `<div class="ribbon">${esc(title)}</div>${head ? `<div class="tw-head">${head}</div>` : ''}<div class="tw-rows">${rows.join('')}</div><div class="tw-tap">點一下繼續</div>`;
    ctx.open(box, true);
    const list = box.querySelector<HTMLElement>('.tw-rows')!, layer = box.parentElement;
    const across = () => !!layer && box.offsetWidth <= layer.clientWidth + 1 && list.scrollWidth <= list.clientWidth + 1 && rowsReadable(box, '.tw-row, .tw-name');
    const fits = () => !!layer && box.offsetHeight <= layer.clientHeight - 30 && across();
    const LOOKS = ['one', 'two', 'three', 'tight'];
    const wide = (layer?.clientWidth ?? 0) >= 540;
    const looks = [...(wide ? ['two', 'one'] : ['one', 'two']), 'one tight', 'two tight', 'three tight'];
    const apply = (cls: string) => { box.classList.remove(...LOOKS); box.classList.add(...cls.split(' ')); shrinkText(box, '.tw-name', 9); };
    let pages = onePage;
    if (pickLayout(looks, apply, fits) === null) {
      apply([...looks].reverse().find(l => (apply(l), across())) ?? 'one tight');
      pages = pageRows([...list.children] as HTMLElement[], list, fits);
    }
    let done = false, timer = 0;
    const wait = () => { clearTimeout(timer); timer = window.setTimeout(turn, ms * Math.max(0.6, ctx.scale())); };
    const close = () => { if (done) return; done = true; clearTimeout(timer); ctx.close(); resolve(); };
    const turn = () => { if (pages.next()) wait(); else close(); };
    box.addEventListener('click', turn);
    box.querySelector('.fl-pager')?.addEventListener('click', wait);
    wait();
  });
}

function faceRow(ctx: ScreenContext, p: number, cells: string, cls = ''): string {
  const q = ctx.game.players[p], ch = CHARACTERS[q.character], f = ctx.bank.art('Data', 2, q.character);
  return `<div class="tw-row ${cls}" style="--c:${hex(ch.color)}"><span class="tw-face">${f ? `<img src="${f.src}" alt="">` : ''}</span><b class="tw-name">${esc(ch.name)}</b>${cells}</div>`;
}

/** 月初銀行結算 for the twelve (17 §6): deposits, interest, the champion and the unlucky one of the month. */
function worldMonthReport(ctx: ScreenContext, fx: Fx): Promise<void> {
  audio.sfx(Sfx.monthly);
  const d = fx.data as unknown as { rows: { p: number; bank: number; loan: boolean; interest: number; after: number }[]; unlucky: number; champion: number };
  // The biggest deposits first (the champion and the unlucky one keep their marks).
  const order = d.rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.bank - a.r.bank);
  const rows = order.map(({ r, i }) => faceRow(ctx, r.p,
    `<span class="tw-num">${yuan(r.bank)}</span><span class="tw-num ${r.loan ? 'minus' : 'plus'}">${r.loan ? '貸款中' : `+${yuan(r.interest)}`}</span>`,
    i === d.champion ? 'champ' : i === d.unlucky ? 'unlucky' : ''));
  const champ = d.rows[d.champion], unl = d.unlucky >= 0 ? d.rows[d.unlucky] : null;
  const head = `${champ ? `本月冠軍 <b>${esc(ctx.game.name(champ.p))}</b>` : ''}${unl ? `　悲情人物 <b>${esc(ctx.game.name(unl.p))}</b>` : ''}`;
  return sheetRows(ctx, '月初銀行結算（存款 10% 利息）', head, rows, 2600).then(() => richList(ctx, fx));
}

/** 本月全國富豪榜 (17 §6): the five richest of the world, and the human's own place under them when lower. */
function richList(ctx: ScreenContext, fx: Fx): Promise<void> {
  const ranking = (fx.data as { ranking?: { p: number; wealth: number }[] }).ranking ?? [];
  if (!ranking.length) return Promise.resolve();
  const me = ctx.game.players.find(q => q.human)?.id ?? -1, mine = ranking.findIndex(r => r.p === me);
  const MEDAL = ['gold', 'silver', 'bronze', '', ''];
  const row = (r: { p: number; wealth: number }, i: number) => faceRow(ctx, r.p, `<span class="tw-rank ${MEDAL[i] ?? ''}">${i + 1}</span><span class="tw-num">${yuan(r.wealth)}</span>`, `rich${r.p === me ? ' me' : ''}`);
  const rows = ranking.slice(0, 5).map(row);
  if (mine >= 5) rows.push('<div class="tw-gap">⋯</div>', row(ranking[mine], mine));
  audio.sfx(Sfx.monthlyHigh);
  return sheetRows(ctx, '本月全國富豪榜', mine >= 0 ? `你是第 <b>${mine + 1}</b> 名（${ranking.length} 人中）` : '', rows, 2400);
}

/** The 15th's dividends of the nationwide market (17 §5): each player's total, the human's companies listed. */
function worldDividends(ctx: ScreenContext, fx: Fx): Promise<void> {
  audio.sfx(61);
  const d = fx.data as unknown as { rows: { company: string; city: string; profit: number; each: number[] }[]; pay: number[] };
  const g = ctx.game, me = g.players.find(q => q.human)?.id ?? -1;
  const rows = g.players.filter(q => q.whoPlays !== 0 && d.pay[q.id]).sort((a, b) => Math.abs(d.pay[b.id]) - Math.abs(d.pay[a.id])).map(q => faceRow(ctx, q.id,
    `<span class="tw-num ${d.pay[q.id] < 0 ? 'minus' : 'plus'}">${d.pay[q.id] > 0 ? '+' : ''}${yuan(d.pay[q.id])}</span>`, q.id === me ? 'me' : ''));
  const mine = me >= 0 ? d.rows.filter(r => r.each[me]).map(r => `${esc(r.city)}・${esc(r.company)} ${r.each[me] > 0 ? '+' : ''}${yuan(r.each[me])}`) : [];
  if (!rows.length) return Promise.resolve();
  return sheetRows(ctx, '上市公司分紅（全國）', mine.length ? `你的分紅：${mine.slice(0, 4).join('、')}${mine.length > 4 ? '…' : ''}` : '', rows, 5000);
}

let installed = false;
/** In a world the month report and the dividends have twelve rows: their compact versions (the originals otherwise). */
export function installWorldScreens() {
  if (installed) return;
  installed = true;
  for (const [kind, fn] of [['month-report', worldMonthReport], ['dividends', worldDividends]] as const) {
    const orig = fxScreens[kind];
    fxScreens[kind] = (ctx, fx) => (fx.data?.world ? fn(ctx, fx) : orig ? orig(ctx, fx) : Promise.resolve());
  }
}

// ------------------------------------------------------------------ 獨裁卡, 召集卡, 通緝卡 (17 §3.5)

// ------------------------------------------------------------------ 研究所「限定」道具 (17 §3.6)

Object.assign(TOOL_TEXT, {
  14: '大富豪模式限定：免費替一塊地加蓋兩級',
  15: '大富豪模式限定：核子飛彈打全國任何一座城市的任何一塊地',
  16: '大富豪模式限定：本城當傳送機用，或立刻穿越到另一座城市的機場',
});

/** 洲際飛彈 launched at another city: the rocket over the globe, then the news (the blast happens there). */
fxScreens['icbm-launch'] = async (ctx, s) => {
  // The full-screen flight onto the target (icbm-flight.ts), then the news line.
  const d = (s.data ?? {}) as { text?: string; from?: string; city?: string; target?: string; mapId?: number; x?: number; y?: number; size?: number };
  await icbmFlight(ctx, d);
};

/** 洲際飛彈 has hit (own city or another): 命中！ and everyone it hurt, each with a puzzled 「？？？」 (the user 2026-10-19). */
fxScreens['icbm-hit'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { victims?: number[]; text?: string };
  const lines = ['？？？', '？？', '欸？？', '？！', '咦？？', '蛤？？'];
  const who = (d.victims ?? []).map(id => ctx.game.players[id]).filter(Boolean);
  const ic = ctx.bank.art('Data', 615, 0);
  const faces = who.map((q, k) => { const f = ctx.bank.art('Data', 2, q.character); return `<div class="ih-who" style="--k:${k}"><span class="ih-say">${esc(lines[(q.id * 3 + k) % lines.length])}</span><span class="ih-face">${f ? `<img src="${f.src}" alt="">` : ''}</span><b>${esc(CHARACTERS[q.character].name)}</b></div>`; }).join('');
  await banner(ctx, `icbm hit${who.length > 4 ? ' many' : ''}`, `${ic ? `<img class="ic-rocket" src="${ic.src}" alt="">` : ''}<div class="dc-word">命中！</div>${d.text ? `<div class="dc-sub">${phrases(d.text)}</div>` : ''}${faces ? `<div class="ih-row">${faces}</div>` : '<div class="dc-sub">沒有炸到任何人</div>'}`, who.length ? 2600 : 1400);
};

/** 時空機 to another city: a swirl of light around the gadget, then the new city. */
fxScreens['space-time'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { text?: string };
  const ic = ctx.bank.art('Data', 616, 0);
  audio.sfx(Sfx.magic);
  await banner(ctx, 'spacetime', `<div class="st-swirl">${ic ? `<img src="${ic.src}" alt="">` : ''}</div><div class="dc-word">時空穿越</div><div class="dc-sub">${phrases(d.text ?? '')}</div>`, 2000);
};

/** 召集！: the summoner rings the bell, the rival's face flies in from the other city. */
fxScreens['summon'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { from?: string; to?: string; text?: string };
  const g = ctx.game, me = g.players[s.p ?? 0], q = g.players[s.target ?? 0];
  const face = (ch: number) => { const f = ctx.bank.art('Data', 2, ch); return f ? `<img src="${f.src}" alt="">` : ''; };
  audio.sfx(Sfx.airplane);
  await banner(ctx, 'summon', `<div class="sm-row"><span class="dc-me">${face(me.character)}</span><span class="sm-bell"></span>
    <span class="sm-in">${face(q?.character ?? 0)}<em>${esc(d.from ?? '')} → ${esc(d.to ?? '')}</em></span></div>
    <div class="dc-word">召集！</div><div class="dc-sub">${phrases(d.text ?? '')}</div>`, 2200);
};

/** 通緝！: a wanted poster with the target's face, the police sound. */
fxScreens['wanted'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { city?: string; text?: string };
  const q = ctx.game.players[s.target ?? 0];
  const f = q ? ctx.bank.art('Data', 2, q.character) : null;
  audio.sfx(Sfx.police);
  await banner(ctx, 'wanted', `<div class="wt-poster"><b>WANTED</b>${f ? `<img src="${f.src}" alt="">` : ''}<span>${esc(q ? CHARACTERS[q.character].name : '')}</span></div>
    <div class="dc-sub">${phrases(d.text ?? '')}</div>`, 2200);
};

/** 城市霸主 (17 §3.8): the crown when the human gains (or loses) a city. */
fxScreens['tycoon-overlord'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { city?: string; gained?: boolean; text?: string };
  const who = ctx.game.players[s.p ?? 0], f = who ? ctx.bank.art('Data', 2, who.character) : null;
  audio.sfx(d.gained ? Sfx.fireworks : Sfx.godLeaves);
  await banner(ctx, `overlord${d.gained ? '' : ' lost'}`, `<div class="ol-crown"></div>${f ? `<div class="dc-me">${`<img src="${f.src}" alt="">`}</div>` : ''}
    <div class="dc-word">${esc(d.city ?? '')}霸主</div><div class="dc-sub">${esc(d.gained ? '在這座城市住院、坐牢都當天出來' : d.text ?? '')}</div>`, 2200);
};

/** 城市霸主's same-day release: 特護病房 / 檢察官. */
fxScreens['overlord-release'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { place?: string; city?: string; text?: string };
  audio.sfx(d.place === 'hospital' ? Sfx.ambulance : Sfx.police);
  await banner(ctx, 'overlord small', `<div class="ol-crown"></div><div class="dc-sub"><b>${esc(d.city ?? '')}霸主</b>　${esc(d.text ?? '')}</div>`, 1400);
};

/** Something another city's turn did to the human (召集, 通緝, 洲際飛彈 …): a short banner with the doer's face. */
fxScreens['tycoon-notice'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { text?: string };
  const who = ctx.game.players[s.p ?? 0];
  const f = who ? ctx.bank.art('Data', 2, who.character) : null;
  await banner(ctx, 'notice', `${f ? `<div class="dc-me">${`<img src="${f.src}" alt="">`}</div>` : ''}<div class="msg-text">${phrases(d.text ?? '')}</div>`, 2200);
};

/** 獨裁！: the user's face and the banner, the others flying off in little planes towards their cities. */
fxScreens['dictator'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { victims?: [number, number][]; city?: string };
  const g = ctx.game, me = g.players[s.p ?? 0];
  const face = (ch: number) => { const f = ctx.bank.art('Data', 2, ch); return f ? `<img src="${f.src}" alt="">` : ''; };
  const w = tycoon.world;
  audio.sfx(Sfx.airplane);
  const flyers = (d.victims ?? []).map(([q, to], k) => `<div class="dc-fly" style="--k:${k};--n:${(d.victims ?? []).length}">
    <span class="dc-face">${face(g.players[q].character)}</span><span class="dc-to">${esc(w?.cityName(to) ?? '')}</span></div>`).join('');
  await banner(ctx, 'dictator', `<div class="dc-me">${face(me.character)}</div><div class="dc-word">獨裁！</div>
    <div class="dc-sub">${esc(CHARACTERS[me.character].name)}一聲令下，同城對手全部送走</div><div class="dc-sky">${flyers}</div>`, 2600);
};
