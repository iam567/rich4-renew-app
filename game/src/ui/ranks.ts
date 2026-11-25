/**
 * 排行榜 (the user 2026-11-16): the title's button under 圖鑑, the boards (最富 / 最快 / 最狠 / 最慘, then the map, then the
 * difficulty), and the 新紀錄 form after a game won alone against three computers (core/ranks.ts says which games).
 *
 * A record carries a name, a region (shown before the name: players of a place compete) and, if the player likes, one
 * social account (a platform and 16 characters) shown under the name — so others can find a streamer and come to
 * challenge them. Name, region and account never change once sent. A game won offline waits on this phone and is
 * offered again at the title.
 *
 * Real time played (最快榜) is counted here, while a game is on screen and the app in front (keepPlayClock).
 */
import { PACE_NAMES, type Game } from '../core/game';
import { Recorder, type GameLog } from '../core/replay';
import { BOARD_NAMES, BOARDS, FIERCE, LEVEL_NAMES, mapKey, notRanked, scores, WOE, type BoardKey, type RankEntry } from '../core/ranks';
import { ledgerOf, type Ledger } from '../core/stats';
import { ASSETS, type MapInfo } from './assets';
import { audio } from './audio';
import { uiAlert } from './dialog';
import { libraryBase } from './maker/library';
import { deviceId } from './party-presence';
import type { SpriteBank } from './sprites';
import './ranks.css';

/** 海外's countries, a second list when 海外 is chosen (ranks.mjs OVERSEAS); 海外 itself: another country. */
export const OVERSEAS = ['日本', '韓國', '新加坡', '馬來西亞', '泰國', '越南', '菲律賓', '印尼', '美國', '加拿大', '墨西哥', '巴西', '英國', '法國', '德國', '意大利', '西班牙', '荷蘭', '俄羅斯', '澳洲', '紐西蘭', '阿聯酋'];
/** Regions (tools/party-relay/ranks.mjs REGIONS, the same list): the provinces, 香港, 澳門, 台灣 and 海外. */
export const REGIONS = ['北京', '天津', '上海', '重慶', '河北', '山西', '遼寧', '吉林', '黑龍江', '江蘇', '浙江', '安徽', '福建', '江西', '山東', '河南', '湖北', '湖南', '廣東', '海南', '四川', '貴州', '雲南', '陝西', '甘肅', '青海', '內蒙古', '廣西', '西藏', '寧夏', '新疆', '香港', '澳門', '台灣', '海外'];
/** Social platforms (ranks.mjs SOCIALS, the same keys): a name and a colour for its tag (words only, no logos). */
export const SOCIALS: { k: string; n: string; c: string }[] = [
  { k: 'douyin', n: '抖音', c: '#161823' }, { k: 'kuaishou', n: '快手', c: '#ff5000' }, { k: 'bilibili', n: 'B站', c: '#fb7299' },
  { k: 'xhs', n: '小紅書', c: '#ff2442' }, { k: 'weibo', n: '微博', c: '#e6162d' }, { k: 'huya', n: '虎牙', c: '#ff9600' },
  { k: 'douyu', n: '鬥魚', c: '#ff7700' }, { k: 'youtube', n: 'YouTube', c: '#e00000' }, { k: 'twitch', n: 'Twitch', c: '#9146ff' },
  { k: 'tiktok', n: 'TikTok', c: '#161823' }, { k: 'ig', n: 'Instagram', c: '#d62976' }, { k: 'x', n: 'X', c: '#000' },
  { k: 'threads', n: 'Threads', c: '#000' }, { k: 'fb', n: 'Facebook', c: '#1877f2' },
];
const BOARD_SUB: Record<BoardKey, string> = { rich: '資產最多', fast: '通關最快', fierce: '狠分最高', woe: '慘分最高' };
const icon = (k: BoardKey) => `${ASSETS}/maps/remake/ranks/board-${k}.webp`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* none */ } }, del: (k: string) => { try { localStorage.removeItem(k); } catch { /* none */ } } };

// ---------------------------------------------------------------- the record and the clocks

/** A game that might rank: its answers from its start, and its time on the server (the token; '' no network then). */
const ranked = new WeakMap<Game, { rec: Recorder; token: string; settings: string }>();
/** The recorder of a game that might rank (the screen logs each step and the 托管 / 小遊戲 changes into it). */
export const rankRecorder = (g: Game) => ranked.get(g)?.rec;
/** Tests in the browser: a game's record so far, its settings and how many steps it took (window.__rich4Rank). */
(window as unknown as { __rich4Rank: unknown }).__rich4Rank = (g: Game) => { const it = ranked.get(g); return it && { log: it.rec.log, settings: it.settings, steps: it.rec.steps, token: it.token }; };
/**
 * A game begun (not loaded: the user 2026-11-16, 存讀檔一次的就不上排行榜) alone against three computers: its answers are
 * kept, and the server starts its clock (最快榜 counts the server's time, a 加速齒輪 cannot hurry it).
 */
export function startRanked(g: Game) {
  const s = g.settings, t = ticket;
  ticket = null;
  if (s.party || s.trial || s.realtime || s.myMap || s.challenge || s.monthTasks || g.players.length !== 4 || g.players.filter(p => p.human).length !== 1) return;
  // only a game begun on the server's 開局券 (its seed): one begun without the network never ranks
  if (!t || t.seed !== s.seed) return;
  ranked.set(g, { rec: new Recorder(g.animation), token: t.token, settings: JSON.stringify(s) });
}

/**
 * 開局券 (排行榜, 防作弊): the server's word for one game — a token for its clock and the seed it is played on, so a
 * game's luck cannot be tried over and over offline for a record, and one game's record serves one record only.
 * Fetched while 開始遊戲's settings are chosen; none (no network): the game is played as ever, off the boards.
 */
let ticket: { token: string; seed: number } | null = null, fetching: Promise<void> | null = null;
export function prefetchTicket() {
  if (ticket || fetching) return;
  fetching = post('/ranks/start', { dev: deviceId() ?? '' }).then(r => {
    if (typeof r.token === 'string' && Number.isInteger(r.seed)) ticket = { token: r.token, seed: r.seed as number };
  }).catch(() => {}).finally(() => { fetching = null; });
}
/** The seed of the 開局券 in hand (the new game is played on it), or undefined. */
export const ticketSeed = () => ticket?.seed;

let clock = 0, last = 0, beatAt = 0;
/** Counts real time into the ledger while `g` is on screen and the app in front (a minute at most per tick: a sleep is no play). */
export function keepPlayClock(g: Game | null) {
  clearInterval(clock); clock = 0;
  const l = g && ledgerOf(g.players);
  if (!l) return;
  last = performance.now();
  clock = window.setInterval(() => {
    const now = performance.now(), d = now - last;
    last = now;
    if (document.visibilityState === 'visible' && !g.over) l.playMs += Math.min(d, 60_000);
    // the server's clock for 最快榜: a word every 30 s while the game is on screen, with the day it is at
    const it = ranked.get(g);
    if (it?.token && document.visibilityState === 'visible' && !g.over && now - beatAt > 30_000) {
      beatAt = now;
      void post('/ranks/beat', { token: it.token, day: g.daysElapsed }).catch(() => {});
    }
  }, 1000);
}

// ---------------------------------------------------------------- figures

export const fmtMoney = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)}億` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString()}萬` : n.toLocaleString());
export const fmtTime = (ms: number) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h}小時${String(m).padStart(2, '0')}分` : `${m}分${String(s % 60).padStart(2, '0')}秒`; };
interface Row { id?: string; map?: string; name: string; region: string; social: { k: string; v: string } | null; char: number; rich: number; ms: number; days: number; fierce: number; woe: number; at: number; place?: number }
const value = (k: BoardKey, r: Pick<Row, 'rich' | 'ms' | 'days' | 'fierce' | 'woe'>): [string, string] =>
  k === 'rich' ? [fmtMoney(r.rich), `${r.days} 天`] : k === 'fast' ? [fmtTime(r.ms), `${r.days} 天`] : [`${(k === 'fierce' ? r.fierce : r.woe).toLocaleString()} 分`, `${r.days} 天`];
const date = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const socialTag = (s: Row['social']) => { const p = s && SOCIALS.find(x => x.k === s.k); return p ? `<span class="rk-sns" style="--c:${p.c}">${esc(p.n)}</span><span class="rk-acc">${esc(s!.v)}</span>` : ''; };

/** What a won game sends (core/ranks.ts RankEntry), or null when it cannot rank. */
export function entryOf(g: Game, winner: number): (RankEntry & { log: GameLog; settings: string; token: string }) | null {
  const it = ranked.get(g);
  if (notRanked(g, winner) || !it) return null;
  const l: Ledger | undefined = ledgerOf(g.players), me = g.players[winner];
  if (!l) return null;
  const { fierce, woe } = scores(l.of(me.id));
  const map = mapKey(g);
  return {
    map, level: g.settings.aiLevel ?? 0, rich: Math.round(g.wealth(me)), ms: Math.round(l.playMs), days: g.daysElapsed, fierce, woe,
    char: me.character, fund: g.settings.fundIndex, seed: g.settings.seed, v: __APP_VERSION__,
    log: it.rec.log, settings: it.settings, token: it.token,
  };
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${await libraryBase()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

// ---------------------------------------------------------------- 新紀錄

const PENDING = 'rich4.ranks.pending', LASTNAME = 'rich4.ranks.name', LASTREGION = 'rich4.ranks.region', LASTSNS = 'rich4.ranks.sns';
type Pending = RankEntry & { mapName: string; log?: GameLog; settings?: string; token?: string };

/**
 * After a game won alone: where it would stand; on any board, the form (name, region, account) and the record sent.
 * Offline: kept on the phone and offered again at the title (pendingRanks).
 */
export async function afterWin(root: HTMLElement, g: Game, winner: number, mapName: string, bank: SpriteBank): Promise<void> {
  const e = entryOf(g, winner);
  if (!e) {
    // a game that would rank but for how it was played: say why (the user's rules, 2026-11-16)
    const why = notRanked(g, winner);
    if (why === 'pace') await uiAlert(`${PACE_NAMES[g.pace]}對局不計入排行榜\n（只有原版節奏的對局才能上榜）`);
    else if (why === 'loaded') await uiAlert('這局讀過存檔，成績不能上排行榜\n（從頭一口氣打完的局才能上榜）');
    else if (!why) await uiAlert('這局開始時沒有連上網路，成績不能上排行榜');
    return;
  }
  await offer(root, { ...e, mapName }, bank);
}

/** The title: a won game kept from when there was no network, offered now. */
export async function pendingRanks(root: HTMLElement, bank: SpriteBank): Promise<void> {
  const raw = store.get(PENDING);
  if (!raw) return;
  let p: Pending;
  try { p = JSON.parse(raw); } catch { store.del(PENDING); return; }
  await offer(root, p, bank, true);
}

async function offer(root: HTMLElement, p: Pending, bank: SpriteBank, later = false) {
  const dev = deviceId() ?? '';
  let places: Partial<Record<BoardKey, number>>;
  try {
    const r = await post('/ranks/check', { ...p, dev });
    if (r.error) { store.del(PENDING); return; }
    places = r.places as Record<BoardKey, number>;
  } catch { store.set(PENDING, JSON.stringify(p)); return; }       // no network: next time at the title
  store.del(PENDING);
  const hits = BOARDS.filter(k => places[k]);
  if (!hits.length) return;
  const sent = await form(root, p, hits, places, bank, later);
  if (sent) audio.ui('yes');
}

function form(root: HTMLElement, p: Pending, hits: BoardKey[], places: Partial<Record<BoardKey, number>>, bank: SpriteBank, later: boolean): Promise<boolean> {
  return new Promise(done => {
    const ov = document.createElement('div');
    ov.className = 'slots-overlay rk-new';
    const face = bank.art('Data', 2, p.char)?.src ?? '';
    const sns = (() => { try { return JSON.parse(store.get(LASTSNS) ?? 'null') as { k: string; v: string } | null; } catch { return null; } })();
    ov.innerHTML = `<div class="msg sheet rk-nsheet"><div class="ribbon">新紀錄！</div><div class="rk-nbody">
      <div class="rk-burst">${face ? `<img src="${esc(face)}" alt="">` : ''}<span>${later ? '上次通關的成績可以上榜：<br>' : ''}${esc(p.mapName)}・${LEVEL_NAMES[p.level] ?? ''}<br><b>${fmtTime(p.ms)}・${p.days} 天</b></span></div>
      <div class="rk-hits">${hits.map(k => `<div class="rk-hit"><img src="${icon(k)}" alt="">${BOARD_NAMES[k]}<em>第 ${places[k]} 名</em></div>`).join('')}</div>
      <label class="rk-field">名字<input class="rk-name" maxlength="8" value="${esc(store.get(LASTNAME) ?? '')}" placeholder="最多 8 個字"></label>
      <div class="rk-field">地區（顯示在名字前面）<div class="rk-snsrow"><select class="rk-region"><option value="">不顯示</option>${REGIONS.map(r => `<option value="${r}">${r}</option>`).join('')}</select><select class="rk-country" hidden><option value="海外">其他國家</option>${OVERSEAS.map(r => `<option value="${r}">${r}</option>`).join('')}</select></div></div>
      <div class="rk-field">社交帳號（選填）<div class="rk-snsrow"><select class="rk-snsk"><option value="">不顯示</option>${SOCIALS.map(s => `<option value="${s.k}"${s.k === sns?.k ? ' selected' : ''}>${s.n}</option>`).join('')}</select><input class="rk-snsv" maxlength="16" value="${esc(sns?.v ?? '')}" placeholder="帳號或直播間"></div><small>只能填一個，最多 16 個字，會顯示在排行榜上，讓大家來找你挑戰</small></div>
      <p class="rk-warn">上榜後名字、地區和帳號都不能再修改，請確認</p></div>
      <div class="choices"><button class="candy ghost" data-r="no">不上榜</button><button class="candy yes" data-r="ok">確定上榜</button></div></div>`;
    root.append(ov);
    const $ = <T extends HTMLElement>(s: string) => ov.querySelector<T>(s)!;
    const reg = $<HTMLSelectElement>('.rk-region'), country = $<HTMLSelectElement>('.rk-country');
    /** A region into the two lists: a country of 海外 is 海外 + the country. */
    const setRegion = (r: string) => { const o = OVERSEAS.includes(r); reg.value = o ? '海外' : REGIONS.includes(r) ? r : ''; country.value = o ? r : '海外'; country.hidden = reg.value !== '海外'; };
    reg.addEventListener('change', () => { country.hidden = reg.value !== '海外'; });
    setRegion(store.get(LASTREGION) ?? '');
    // the region the network suggests, when this phone has none yet
    if (!store.get(LASTREGION)) void libraryBase().then(b => fetch(`${b}/ranks/where`, { cache: 'no-store' })).then(r => r.json()).then(j => { if (j.region && !reg.value) setRegion(j.region); }).catch(() => {});
    ov.addEventListener('click', async e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
      if (!b) return;
      if (b.dataset.r === 'no') { audio.ui('click'); ov.remove(); done(false); return; }
      const name = $<HTMLInputElement>('.rk-name').value.trim().slice(0, 8), region = reg.value === '海外' ? country.value : reg.value;
      const k = $<HTMLSelectElement>('.rk-snsk').value, v = $<HTMLInputElement>('.rk-snsv').value.trim().slice(0, 16);
      if (!name) { audio.ui('error'); $<HTMLInputElement>('.rk-name').focus(); return; }
      if (k && !v) { audio.ui('error'); $<HTMLInputElement>('.rk-snsv').focus(); return; }
      b.setAttribute('disabled', '');
      try {
        const r = await post('/ranks', { ...p, dev: deviceId() ?? '', name, region, ...(k && v ? { social: { k, v } } : {}) });
        if (r.error === 'low') { await uiAlert('剛剛有人搶先上榜，這次的成績擠不進前 50 名了'); ov.remove(); done(false); return; }
        if (r.error === 'check' || r.error === 'ticket' || r.error === 'bad') { await uiAlert('這局的紀錄核對不上，不能上排行榜'); ov.remove(); done(false); return; }
        if (r.error) throw new Error(String(r.error));
        store.set(LASTNAME, name); store.set(LASTREGION, region); store.set(LASTSNS, JSON.stringify(k && v ? { k, v } : null));
        ov.remove(); done(true);
      } catch {
        b.removeAttribute('disabled');
        await uiAlert('網路不太穩，沒有送出：請再按一次「確定上榜」');
      }
    });
  });
}

// ---------------------------------------------------------------- the boards

const ORDER: Record<BoardKey, (a: Row, b: Row) => number> = {   // tools/party-relay/ranks.mjs order
  rich: (a, b) => b.rich - a.rich || a.at - b.at,
  fast: (a, b) => a.ms - b.ms || a.days - b.days || a.at - b.at,
  fierce: (a, b) => b.fierce - a.fierce || a.at - b.at,
  woe: (a, b) => b.woe - a.woe || a.at - b.at,
};
/** 總榜 put together from each map's board (a server before 總榜): every row marked with its map, each player once, the top 50. */
async function mergedBoards(q: URLSearchParams, maps: string[], board: BoardKey): Promise<{ rows: Row[]; mine?: Row }> {
  const base = await libraryBase();
  const parts = await Promise.all(maps.map(async map => {
    const u = new URLSearchParams(q); u.set('map', map);
    try { const j = await (await fetch(`${base}/ranks?${u}`, { cache: 'no-store' })).json() as { rows?: Row[]; mine?: Row }; return { map, rows: j.rows ?? [], mine: j.mine }; } catch { return { map, rows: [] as Row[], mine: undefined }; }
  }));
  const who = (r: Row) => `${r.name}|${r.region}|${r.social?.k ?? ''}|${r.social?.v ?? ''}`;
  const all = parts.flatMap(p => p.rows.filter(r => board !== 'fast' || r.ms).map(r => ({ ...r, map: p.map }))).sort(ORDER[board]);
  const seen = new Set<string>(), rows: Row[] = [];
  for (const r of all) { if (seen.has(who(r))) continue; seen.add(who(r)); rows.push(r); if (rows.length >= 50) break; }
  const best = parts.flatMap(p => (p.mine ? [{ ...p.mine, map: p.map }] : [])).sort(ORDER[board])[0];
  const at = best ? rows.findIndex(r => who(r) === who(best)) : -1;
  return { rows, ...(best ? { mine: { ...best, place: at >= 0 ? at + 1 : undefined } } : {}) };
}

const VIEW = 'rich4.ranks.view';
/** The boards over `root`: `maps` the game's own maps (開始遊戲's, original then the remake's). */
export function openRanks(root: HTMLElement, bank: SpriteBank, maps: MapInfo[]): Promise<void> {
  return new Promise(done => {
    const own = maps.filter(m => !m.hidden).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'orig' ? -1 : 1));
    const saved = (() => { try { return JSON.parse(store.get(VIEW) ?? '{}'); } catch { return {}; } })();
    const view = { board: (BOARDS.includes(saved.board) ? saved.board : 'fast') as BoardKey, map: String(saved.map ?? 'all'), level: Number.isInteger(saved.level) ? saved.level : 3 };
    const ov = document.createElement('div');
    ov.className = 'slots-overlay rk-ov';
    ov.innerHTML = `<div class="msg sheet rk-sheet"><div class="ribbon">排行榜</div>
      <div class="rk-l"><div class="rk-boards">${BOARDS.map(k => `<button class="rk-board" data-b="${k}"><img src="${icon(k)}" alt=""><span>${BOARD_NAMES[k]}<small>${BOARD_SUB[k]}</small></span></button>`).join('')}</div>
        <ol class="rk-list rk-minelist"></ol>
        <div class="choices"><button class="candy ghost" data-a="how">怎麼算分</button><button class="candy yes" data-a="close">返回</button></div>
        <p class="rk-hint">1 個玩家打 3 個電腦、讓所有電腦破產才能上榜；讀過存檔（SL）、用了修改器或離線玩的局都不算</p></div>
      <div class="rk-r"><div class="chips rk-maps"></div><div class="chips rk-lv">${LEVEL_NAMES.map((n, i) => `<button class="chip" data-lv="${i}">${n}</button>`).join('')}</div>
        <ol class="rk-list rk-top"></ol></div></div>`;
    root.append(ov);
    const $ = (s: string) => ov.querySelector<HTMLElement>(s)!;
    const face = (c: number) => bank.art('Data', 2, c)?.src ?? '';
    const mapName = new Map(own.map(m => [`m${m.id}`, m.name]));
    const item = (r: Row, n: number, me = false) => {
      const [v, sub] = value(view.board, r);
      // 總榜 (the user 2026-11-17): after the figure, the map it was won on
      const onMap = view.map === 'all' && r.map && mapName.has(r.map) ? `<span class="rk-onmap">${esc(mapName.get(r.map))}</span>` : '';
      return `<li class="rk-item${me ? ' me' : ''}"><span class="rk-no${n <= 3 ? ` g${n}` : ''}">${n}</span><img class="rk-face" src="${esc(face(r.char))}" alt="">
        <span class="rk-who"><b>${r.region ? `<span class="rk-reg${OVERSEAS.includes(r.region) || r.region === '海外' ? ' o' : ''}">${esc(r.region)}</span>` : ''}${esc(r.name)}</b><small>${me ? '我的最好成績' : r.social ? socialTag(r.social) : date(r.at)}</small></span>
        <span class="rk-val">${v}<small>${onMap}${sub}</small></span></li>`;
    };
    let seq = 0;
    const draw = async () => {
      store.set(VIEW, JSON.stringify(view));
      ov.querySelectorAll<HTMLElement>('[data-b]').forEach(b => b.classList.toggle('on', b.dataset.b === view.board));
      ov.querySelectorAll<HTMLElement>('[data-lv]').forEach(b => b.classList.toggle('on', Number(b.dataset.lv) === view.level));
      // 總榜 first (every map together), then each map
      const chips = [{ map: 'all', name: '總榜' }, ...own.map(m => ({ map: `m${m.id}`, name: m.name }))];
      if (!chips.some(c => c.map === view.map)) view.map = chips[0]?.map ?? 'm0';
      $('.rk-maps').innerHTML = chips.map(c => `<button class="chip${c.map === view.map ? ' on' : ''}" data-map="${esc(c.map)}">${esc(c.name)}</button>`).join('');
      ov.querySelector('.rk-maps .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
      const top = $('.rk-top'), mine = $('.rk-minelist');
      top.innerHTML = '<li class="rk-none">載入中…</li>';
      const me = ++seq;
      try {
        const q = new URLSearchParams({ map: view.map, level: String(view.level), board: view.board, dev: deviceId() ?? '' });
        let j = await (await fetch(`${await libraryBase()}/ranks?${q}`, { cache: 'no-store' })).json() as { rows: Row[]; mine?: Row; total?: number };
        // 總榜 from a server that does not know it yet (no `total`): each map's board, put together here
        if (view.map === 'all' && j.total === undefined) j = await mergedBoards(q, own.map(m => `m${m.id}`), view.board);
        if (me !== seq) return;
        top.innerHTML = j.rows.length ? j.rows.map((r, i) => item(r, i + 1)).join('') : '<li class="rk-none">還沒有人上榜：1 個玩家打 3 個電腦，第一個通關的就是第 1 名！</li>';
        mine.innerHTML = j.mine ? item(j.mine, j.mine.place ?? 0, true) : '';
      } catch {
        if (me === seq) { top.innerHTML = '<li class="rk-none">連不上網路，等一下再看看</li>'; mine.innerHTML = ''; }
      }
    };
    ov.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.b) { view.board = b.dataset.b as BoardKey; audio.ui('click'); void draw(); return; }
      if (b.dataset.map) { view.map = b.dataset.map; audio.ui('click'); void draw(); return; }
      if (b.dataset.lv) { view.level = Number(b.dataset.lv); audio.ui('click'); void draw(); return; }
      if (b.dataset.a === 'how') {
        audio.ui('click');
        void uiAlert(`最富榜：通關時的總資產\n最快榜：通關用的實際時間（遊戲畫面開著的時間），一樣快的比天數\n\n最狠榜（狠分）：讓一個電腦破產 ${FIERCE.broke}、好神附身 ${FIERCE.god}、用整人的卡片 ${FIERCE.card}、用路障地雷飛彈等道具 ${FIERCE.tool}、好事 ${FIERCE.lucky}、每收 1 萬過路費 ${FIERCE.toll}\n\n最慘榜（慘分）：壞神附身 ${WOE.god}、被電腦用卡片或道具整 ${WOE.attacked}、住院坐牢每天 ${WOE.day}、倒楣事 ${WOE.unlucky}、每付 1 萬過路費 ${WOE.toll}\n\n總榜：所有地圖一起排名，每一條都標出是在哪張地圖打的。\n\n每個人在每張地圖、每個難度只顯示最好的一次（總榜也是每人一次）。\n\n讀過一次存檔（SL）、用了修改器，或開局時沒有連網（離線玩）的局，都不會計入排行榜。`, '怎麼算分');
        return;
      }
      if (b.dataset.a === 'close') { audio.ui('click'); ov.remove(); done(); }
    });
    void draw();
  });
}
