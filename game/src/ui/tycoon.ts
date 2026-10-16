/**
 * 大富豪模式 on screen (docs/rules/17 §10-§12): building the world from the five cities' records, the overlay's
 * sprites, the world badge (city, rivals left) with the live ticker of what happens in the other cities, the recent
 * log, and the travel dialog. The map, the HUD and every other screen are the normal game's, on the city shown.
 */
import { parseBoard, type RawMap } from '../core/board';
import { CHARACTERS } from '../core/characters';
import type { Ask, GameEvent, TravelOption } from '../core/types';
import { applyOverlay, CITY_NAMES, LAND_INDEX, RESORT, TYCOON_SPRITES, World, type TickerLine, type TycoonOverlay, type TycoonSettings } from '../core/world';
import { loadWorld as restoreWorld, type WorldSaveData } from '../core/save';
import { ASSETS, loadMapData, type MapSprites } from './assets';
import type { SpriteBank } from './sprites';
import { askScreens, fxScreens, type ScreenContext } from './screens/registry';
import { audio, Sfx } from './audio';
import './tycoon.css';

/** The world being played (null in a normal game); screens that differ in 大富豪模式 read it. */
export const tycoon: { world: World | null } = { world: null };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
/** A colour per city for tags (東京 red, 大阪 orange, 札幌 sky, 九州 green, 沖繩 sea). */
export const CITY_COLORS: Record<number, string> = { 100: '#e0303c', 101: '#f08a1c', 102: '#3a9be0', 103: '#2ea84a', 104: '#16b3c0' };
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
export const cityThumb = (mapId: number) => `${ASSETS}/maps/remake/${KEYS[mapId]}-thumb.jpg`;

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
  return restoreWorld(save, await boards(save.settings.maps));
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
  bank.addMapSprites(out);
}

/**
 * The world badge and the ticker (17 §10): top of the map, one compact line that never blocks play. The badge says
 * which city is shown and how many rivals are left; the ticker shows the newest line of the other cities for a moment
 * each (a little queue when many come at once). A tap opens the recent log.
 */
export class WorldBar {
  readonly el: HTMLElement;
  private badge: HTMLElement;
  private line: HTMLElement;
  private queue: TickerLine[] = [];
  private busy = false;
  onOpen: () => void = () => {};

  constructor(readonly world: World) {
    this.el = document.createElement('div');
    this.el.className = 'wb';
    this.el.innerHTML = '<button class="wb-badge"></button><button class="wb-line"><span class="wb-text"></span></button>';
    this.badge = this.el.querySelector('.wb-badge')!;
    this.line = this.el.querySelector('.wb-text')!;
    this.el.addEventListener('click', () => { audio.ui('click'); this.onOpen(); });
    this.update();
    this.idle();
  }

  update() {
    const w = this.world, v = w.view(), id = v >= 0 ? w.mapId(v) : 0, h = w.human();
    const trip = h?.trip ? '在路上 → ' : '';
    this.badge.innerHTML = `<i style="--cc:${CITY_COLORS[id] ?? '#888'}"></i><b>${trip}${esc(CITY_NAMES[id] ?? '')}</b><span>地價×${(LAND_INDEX[id] ?? 1).toFixed(1)}・對手 ${w.rivalsLeft()}/${w.players.length - 1}</span>`;
  }

  private idle() {
    this.line.parentElement!.classList.add('quiet');
    this.line.innerHTML = '<em>各地動態</em>';
  }

  /** A ticker line from another city; shown in turn, each about two seconds. */
  push(l: TickerLine) {
    this.queue.push(l);
    if (this.queue.length > 6) this.queue.splice(0, this.queue.length - 6);
    if (!this.busy) void this.run();
  }

  private async run() {
    this.busy = true;
    while (this.queue.length) {
      const l = this.queue.shift()!;
      const host = this.line.parentElement!;
      host.classList.remove('quiet', 'in');
      void host.offsetWidth;
      this.line.innerHTML = lineHtml(this.world, l);
      host.classList.add('in');
      if (l.kind === 'bankrupt' || l.kind === 'title') audio.ui('click');
      await new Promise(r => setTimeout(r, this.queue.length > 2 ? 1100 : 2200));
    }
    this.busy = false;
    setTimeout(() => { if (!this.busy) this.idle(); }, 2500);
  }
}

/** 「【大阪】阿土伯 在道頓堀買下土地」 with the city's colour and the player's. */
function lineHtml(w: World, l: TickerLine): string {
  const id = l.map >= 0 ? w.mapId(l.map) : 0;
  const ch = l.p !== undefined ? CHARACTERS[w.players[l.p]?.character ?? 0] : null;
  const tag = `<span class="wb-city" style="--cc:${CITY_COLORS[id] ?? '#888'}">${esc(CITY_NAMES[id] ?? '')}</span>`;
  const text = ch ? esc(l.text).replace(esc(ch.name), `<b style="--pc:${hex(ch.color)}">${esc(ch.name)}</b>`) : esc(l.text);
  return `${tag}<span class="wb-msg${l.kind === 'bankrupt' ? ' hot' : l.kind === 'title' ? ' gold' : ''}">${text}</span>`;
}

/** The recent log (17 §10): newest first, by day, every city. */
export function logHtml(w: World): string {
  const rows = [...w.log].reverse().slice(0, 120);
  if (!rows.length) return '<p class="info-none">還沒有消息</p>';
  let day = -1, out = '';
  for (const l of rows) {
    if (l.day !== day) { day = l.day; out += `<div class="wl-day">第 ${day + 1} 天</div>`; }
    out += `<div class="wl-row">${lineHtml(w, l)}</div>`;
  }
  return `<div class="wl">${out}</div>`;
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
      <span class="tv-fare">${o.price.toLocaleString('zh-Hant')} 元</span>
      <span class="tv-meta">地價 ×${(o.landIndex ?? 1).toFixed(1)}・地產 ${o.owned}・對手 ${o.rivals}</span>
      ${RESORT[o.mapId] ? `<span class="tv-resort">度假勝地：旅館收入×${RESORT[o.mapId].base}（夏季×${RESORT[o.mapId].summer}）</span>` : ''}</button>`;
  box.innerHTML = `<div class="ribbon">${pad ? `<img class="tv-pad" src="${pad.src}" alt="">` : ''}${station ? '新幹線' : '飛機'}・從${esc(a.from)}出發</div>
    <div class="tv-note">搭乘要停一回合（在路上），下回合從目的地的${station ? '車站' : '機場'}出發。現金 ${me.cash.toLocaleString('zh-Hant')}・存款 ${me.bank.toLocaleString('zh-Hant')}</div>
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
  ctx.open(box);
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

fxScreens['travel-depart'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { via?: string; text?: string };
  audio.sfx(d.via === 'station' ? Sfx.special : Sfx.airplane);
  const pad = ctx.bank.art('map', d.via === 'station' ? 9017 : 9018, 0);
  await banner(ctx, 'go', `${pad ? `<img class="tb-pad" src="${pad.src}" alt="">` : ''}<div class="msg-text">${esc(d.text ?? '')}</div>`, 1600);
};
fxScreens['travel-arrive'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { text?: string };
  await banner(ctx, 'arrive', `<div class="msg-text">${esc(d.text ?? '')}</div>`, 1300);
};
fxScreens['house-full'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { text?: string };
  await banner(ctx, 'full', `<div class="msg-text">${esc(d.text ?? '')}</div>`, 1800);
};
// ------------------------------------------------------------------ twelve-player screens (17 §12)

type Fx = Extract<GameEvent, { t: 'fx' }>;
const yuan = (n: number) => `${Math.trunc(n).toLocaleString('zh-Hant')}`;

/** A compact sheet of twelve rows (face, name, figures), closed by a tap or after `ms`. */
function sheetRows(ctx: ScreenContext, title: string, head: string, rows: string[], ms: number): Promise<void> {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'msg tw';
    box.innerHTML = `<div class="ribbon">${esc(title)}</div>${head ? `<div class="tw-head">${head}</div>` : ''}<div class="tw-rows">${rows.join('')}</div><div class="tw-tap">點一下繼續</div>`;
    let done = false;
    const close = () => { if (done) return; done = true; ctx.close(); resolve(); };
    box.addEventListener('click', close);
    ctx.open(box);
    setTimeout(close, ms * Math.max(0.6, ctx.scale()));
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
  const rows = d.rows.map((r, i) => faceRow(ctx, r.p,
    `<span class="tw-num">${yuan(r.bank)}</span><span class="tw-num ${r.loan ? 'minus' : 'plus'}">${r.loan ? '貸款中' : `+${yuan(r.interest)}`}</span>`,
    i === d.champion ? 'champ' : i === d.unlucky ? 'unlucky' : ''));
  const champ = d.rows[d.champion], unl = d.unlucky >= 0 ? d.rows[d.unlucky] : null;
  const head = `${champ ? `本月冠軍 <b>${esc(ctx.game.name(champ.p))}</b>` : ''}${unl ? `　悲情人物 <b>${esc(ctx.game.name(unl.p))}</b>` : ''}`;
  return sheetRows(ctx, '月初銀行結算（存款 10% 利息）', head, rows, 6000);
}

/** The 15th's dividends of the nationwide market (17 §5): each player's total, the human's companies listed. */
function worldDividends(ctx: ScreenContext, fx: Fx): Promise<void> {
  audio.sfx(61);
  const d = fx.data as unknown as { rows: { company: string; city: string; profit: number; each: number[] }[]; pay: number[] };
  const g = ctx.game, me = g.players.find(q => q.human)?.id ?? -1;
  const rows = g.players.filter(q => q.whoPlays !== 0 && d.pay[q.id]).map(q => faceRow(ctx, q.id,
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
