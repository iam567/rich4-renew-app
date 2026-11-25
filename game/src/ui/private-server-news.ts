/**
 * 私服的公告、活動和服主私信 (the user 2026-11-23: 「私服老闆可以有自己的 webui 管理頁面…發布公告、發布活動…私服列表裡顯示
 * 私服的公告和相關活動…讓玩家預約比賽…給玩家發私信」). The owner writes them on the 私服's own admin page
 * (tools/private-server); the game reads them from the 私服 itself:
 *
 * - GET  /info                        headline (the newest notice's title, or ''), next ({ title, start, end } of the
 *                                     next or running event, or null) — one line in each row of the 私服 lists
 * - GET  /news?device=<id>            { notices: [{ id, title, body, time, pinned }],
 *                                       events: [{ id, title, start, end, prize, body, count, max, open, msg }],
 *                                       mine: [event id, …] }  (the events this device signed up for)
 * - POST /signup   { event, device, name }   { ok } or { error, msg }
 * - POST /unsignup { event, device }         { ok } or { error, msg }
 * - GET  /inbox?device=<id>&since=<ms>        { messages: [{ id, time, text, from }] } — 服主私信 newer than `since`
 *
 * Everything the owner wrote is untrusted: cut to a length here and escaped where shown; a link stays plain text (never
 * made clickable). A 私服 with a password gets
 * it as the header x-rich4-password (the one private-server.ts serverPass keeps; only when this device knows one, so a
 * plain 私服 is never asked a preflight).
 * Read 私信 are remembered on this device.
 */
import { deviceId } from './party-presence';
import { serverPass } from './private-server';

/** An owner's text: no control characters (line breaks kept where `lines`), at most `n` characters. */
export const ownerText = (v: unknown, n: number, lines = false) =>
  [...String(v ?? '').replace(lines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, lines ? '' : ' ').replace(/\n{3,}/g, '\n\n').trim()].slice(0, n).join('');
/** A time the 私服 sent (ms, seconds or a date text) as ms, or 0. */
export function timeOf(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 0 && v < 1e11 ? v * 1000 : Math.max(0, v);
  if (typeof v === 'string' && v.trim()) { const n = Number(v); if (Number.isFinite(n)) return timeOf(n); const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  return 0;
}

/**
 * 私服介紹和 Banner (the user 2026-11-23: the owner's banner image, a tap opens its link — 線下活動的宣傳): /info (and
 * /news) say `intro` (≤ 300 characters, line breaks kept) and `banner: { v, link } | null`; the image itself is
 * http://<addr>/banner?v=<v>. A link is only ever an http(s) address of at most 300 characters ('' otherwise: the banner
 * is then not tapped anywhere).
 */
export interface Banner { v: string; link: string }
export function safeLink(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s || s.length > 300 || /[\u0000-\u0020\u007f<>"'`\\]/.test(s) || !/^https?:\/\//i.test(s)) return '';
  try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? s : ''; } catch { return ''; }
}
export function cleanBanner(v: unknown): Banner | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>, ver = String(o.v ?? '');
  return /^[A-Za-z0-9_-]{1,32}$/.test(ver) ? { v: ver, link: safeLink(o.link) } : null;
}
/** The banner image's address on the 私服 at `addr` (the hash keeps an old one out of the cache). */
export const bannerSrc = (addr: string, b: Banner) => `http://${addr}/banner?v=${encodeURIComponent(b.v)}`;

/**
 * 服主社交帳號 and 滾動公告 (the user 2026-11-23): /info (and /news) say `socials: [{ k, v, label? }]` (≤ 4) and
 * `ticker: { text, v } | null`. An account is text to copy, never a link; only a plain X / YouTube handle or a numeric
 * B站 UID makes an address (built here, never taken from the 私服).
 */
export const SOCIAL_LABELS: Record<string, string> = {
  x: 'X', bilibili: 'B站', douyin: '抖音', weibo: '微博', xhs: '小紅書', youtube: 'YouTube', wechat: '微信', qq: 'QQ群', discord: 'Discord', tg: 'Telegram', other: '其他',
};
export interface Social { k: string; v: string; label: string }
export function cleanSocials(v: unknown): Social[] {
  return (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object' && Object.prototype.hasOwnProperty.call(SOCIAL_LABELS, (x as Record<string, unknown>).k as string)).map(x => {
    const o = x as Record<string, unknown>, k = String(o.k);
    return { k, v: ownerText(o.v, 40), label: k === 'other' ? ownerText(o.label, 8) || '其他' : SOCIAL_LABELS[k] };
  }).filter(x => x.v).slice(0, 4);
}
/** The page of an X / YouTube handle or a B站 UID, or '' (copy only). */
export function socialUrl(s: { k: string; v: string }): string {
  const v = s.v.trim();
  let m: RegExpExecArray | null;
  if (s.k === 'x' && (m = /^@?([A-Za-z0-9_]{1,15})$/.exec(v))) return `https://x.com/${m[1]}`;
  if (s.k === 'bilibili' && (m = /^(?:uid[:：]?\s*)?(\d{1,12})$/i.exec(v))) return `https://space.bilibili.com/${m[1]}`;
  if (s.k === 'youtube' && (m = /^@?([A-Za-z0-9_.-]{3,30})$/.exec(v))) return `https://www.youtube.com/@${m[1]}`;
  return '';
}
export interface Ticker { text: string; v: string }
export function cleanTicker(v: unknown): Ticker | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>, text = ownerText(o.text, 120);
  return text ? { text, v: /^[A-Za-z0-9]{1,16}$/.test(String(o.v ?? '')) ? String(o.v) : String([...text].length) } : null;
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/**
 * A 私服's 滾動公告 as shown: one line running right to left (slower the longer it is), held while pointed at or tapped;
 * still (and wrapped) for those who asked their system for less motion (party.css).
 */
export const tickerHtml = (t: Ticker) =>
  `<div class="pt-ticker" role="marquee" title="${escHtml(t.text)}"><span class="pt-tickin" style="--dur:${Math.round(Math.max(10, [...t.text].length * 0.32 + 8))}s">📢 ${escHtml(t.text)}</span></div>`;

export interface NextEvent { title: string; start: number; end: number }
export interface Notice { id: string; title: string; body: string; time: number; pinned: boolean }
export interface SrvEvent { id: string; title: string; start: number; end: number; prize: string; body: string; count: number; max: number; open: boolean; msg: string }
export interface News { notices: Notice[]; events: SrvEvent[]; mine: Set<string> }
export interface InboxMsg { id: string; time: number; text: string; from: string }

const id = (v: unknown) => ownerText(v, 40);
export function cleanNext(v: unknown): NextEvent | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const title = ownerText(o.title, 30);
  return title ? { title, start: timeOf(o.start), end: timeOf(o.end) } : null;
}
/** /news as shown: 公告 pinned first then the newest; 活動 running or coming first (soonest), then the ended ones. */
export function cleanNews(j: unknown, now = Date.now()): News {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object').slice(0, 100) as Record<string, unknown>[];
  const notices = arr(o.notices ?? o.announcements).map(x => ({
    id: id(x.id), title: ownerText(x.title, 40), body: ownerText(x.body ?? x.text, 2000, true), time: timeOf(x.time ?? x.at ?? x.date), pinned: !!x.pinned,
  })).filter(x => x.title || x.body).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.time - a.time);
  const events = arr(o.events ?? o.activities).map(x => {
    const signed = x.count ?? x.signed ?? x.signups;
    const count = Array.isArray(signed) ? signed.length : Math.max(0, Number(signed) || 0);
    return {
      id: id(x.id), title: ownerText(x.title, 40), start: timeOf(x.start), end: timeOf(x.end), prize: ownerText(x.prize, 80), body: ownerText(x.body ?? x.text, 2000, true),
      count, max: Math.max(0, Number(x.max) || 0), open: x.open !== false && x.closed !== true, msg: ownerText(x.msg ?? x.note, 40),
    };
  }).filter(x => x.id && x.title);
  const ended = (e: SrvEvent) => !!e.end && e.end < now;
  events.sort((a, b) => Number(ended(a)) - Number(ended(b)) || (ended(a) ? b.end - a.end : (a.start || 0) - (b.start || 0)));
  // the events this device signed up for: a list beside them, or each one's own `mine`
  const mine = new Set((Array.isArray(o.mine) ? o.mine : []).map(id).filter(Boolean));
  for (const x of arr(o.events ?? o.activities)) if (x.mine === true && id(x.id)) mine.add(id(x.id));
  return { notices, events, mine };
}

const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
const hm = (t: number) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** 「20:05」 in this device's time. */
export const clockOf = (t: number) => t ? hm(t) : '';
/** An event's dates in this device's time: 「12/1–12/7」, 「12/1 20:00」 (one day), 「進行中 ～12/7」 while it runs. */
export function eventWhen(e: { start: number; end: number }, now = Date.now()): string {
  if (e.start && e.start <= now && (!e.end || now <= e.end)) return e.end ? `進行中 ～${md(e.end)}` : '進行中';
  if (e.end && e.end < now) return `已結束 ${md(e.end)}`;
  if (!e.start) return e.end ? `～${md(e.end)}` : '';
  if (!e.end || md(e.start) === md(e.end)) return `${md(e.start)} ${hm(e.start)}`;
  return `${md(e.start)}–${md(e.end)}`;
}
/** A notice's date: 「12/1」 (this year) or 「2025/12/1」. */
export const dateOf = (t: number) => !t ? '' : new Date(t).getFullYear() === new Date().getFullYear() ? md(t) : `${new Date(t).getFullYear()}/${md(t)}`;

const headers = (addr: string, json = false): Record<string, string> => {
  const h: Record<string, string> = json ? { 'content-type': 'application/json' } : {};
  const pw = serverPass(addr);
  if (pw) h['x-rich4-password'] = pw;
  return h;
};
async function call(addr: string, path: string, body?: object): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`http://${addr}${path}`, body ? { method: 'POST', headers: headers(addr, true), body: JSON.stringify(body), signal: ctl.signal } : { headers: headers(addr), signal: ctl.signal, cache: 'no-store' });
    const text = await r.text();
    if (text.length > 400_000) return null;
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? j : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/**
 * The 私服's 公告 and 活動; null: it did not answer (or an older 私服 without them); a text: why it would not say (a
 * 進服密碼 this device does not have yet, banned, too many asks).
 */
export async function fetchNews(addr: string): Promise<News | string | null> {
  const j = await call(addr, `/news?device=${encodeURIComponent(deviceId())}`);
  if (!j) return null;
  if (j.error && !Array.isArray(j.notices) && !Array.isArray(j.events)) {
    return j.error === 'password' ? '這個私服有進服密碼：按「進入」輸入密碼後，就看得到公告和活動' : ownerText(j.msg, 40) || '這個私服現在不給看公告和活動';
  }
  return cleanNews(j);
}
/** 預約/報名 (on) or 取消報名: '' done, else why not (the 私服's own words when it gave some). */
export async function signUp(addr: string, event: string, on: boolean, name: string): Promise<string> {
  const j = await call(addr, on ? '/signup' : '/unsignup', on ? { event, device: deviceId(), name } : { event, device: deviceId() });
  if (!j) return '連不到這個私服，等一下再試';
  if (j.ok) return '';
  const msg = ownerText(j.msg, 40);
  return msg || ({ full: '名額已滿', closed: '報名已經截止', ended: '活動已經結束' } as Record<string, string>)[String(j.error)] || '沒有成功，等一下再試';
}

// 私信: kept per 私服 on this device (the newest 50) with what was read
const BOX_KEY = (addr: string) => `rich4.party.srvinbox.${addr}`;
interface Box { msgs: InboxMsg[]; seen: number }
function box(addr: string): Box {
  try {
    const b = JSON.parse(localStorage.getItem(BOX_KEY(addr)) ?? '{}');
    const msgs = (Array.isArray(b.msgs) ? b.msgs : []).filter((m: Partial<InboxMsg>) => m && typeof m.text === 'string' && typeof m.time === 'number')
      .map((m: InboxMsg) => ({ id: String(m.id), time: m.time, text: m.text, from: String(m.from ?? '服主') }));
    return { msgs, seen: Number(b.seen) || 0 };
  } catch { return { msgs: [], seen: 0 }; }
}
const keepBox = (addr: string, b: Box) => { try { localStorage.setItem(BOX_KEY(addr), JSON.stringify({ msgs: b.msgs.slice(0, 50), seen: b.seen })); } catch { /* not kept */ } };
function cleanMsg(x: unknown): InboxMsg | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const text = ownerText(o.text ?? o.body, 500, true), time = timeOf(o.time ?? o.at);
  return text ? { id: id(o.id) || String(time), time, text, from: ownerText(o.from, 16) || '服主' } : null;
}
/** The 私信 on this device, the newest first, and how many are unread. */
export function inbox(addr: string): { msgs: InboxMsg[]; unread: number } {
  const b = box(addr);
  return { msgs: b.msgs, unread: b.msgs.filter(m => m.time > b.seen).length };
}
/** All read. */
export function markRead(addr: string) { const b = box(addr); b.seen = Math.max(b.seen, ...b.msgs.map(m => m.time), 0); keepBox(addr, b); }
/** New 私信 since the last asked (fetched and kept), the newest first; [] when none or not answered. */
export async function checkInbox(addr: string): Promise<InboxMsg[]> {
  const b = box(addr);
  const since = Math.max(0, ...b.msgs.map(m => m.time));
  const j = await call(addr, `/inbox?device=${encodeURIComponent(deviceId())}&since=${since}`);
  if (!j || !Array.isArray(j.messages)) return [];
  const have = new Set(b.msgs.map(m => m.id));
  const fresh = (j.messages as unknown[]).slice(0, 50).map(cleanMsg).filter((m): m is InboxMsg => !!m && !have.has(m.id) && m.time > b.seen);
  if (!fresh.length) return [];
  b.msgs = [...fresh, ...b.msgs].sort((x, y) => y.time - x.time).slice(0, 50);
  keepBox(addr, b);
  return fresh.sort((x, y) => y.time - x.time);
}

/**
 * While this game plays on the 私服 `addr` (`on()` says so), asks for 私信 every minute and shows a new one as a small
 * 「服主私信」 toast at the top that never takes a tap (the turn goes on); read later in the 私服's page.
 */
let watching = '';
export function watchInbox(addr: string, on: () => boolean) {
  if (watching === addr) return;
  watching = addr;
  const tick = async () => {
    if (watching !== addr || !on()) { if (watching === addr) watching = ''; return; }
    const fresh = await checkInbox(addr);
    if (fresh.length && watching === addr && on()) toast(fresh.length > 1 ? `${fresh.length} 封新私信：${fresh[0].text}` : fresh[0].text);
    setTimeout(() => void tick(), 60_000);
  };
  void tick();
}
function toast(text: string) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'srv-mailtoast';
  el.setAttribute('role', 'status');
  const b = document.createElement('b'); b.textContent = '服主私信';
  const s = document.createElement('span'); s.textContent = [...text.replace(/\s+/g, ' ')].slice(0, 40).join('') + ([...text].length > 40 ? '…' : '');
  const m = document.createElement('small'); m.textContent = '到「私服房間」看全文';
  el.append(b, s, m);
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 6000);
  setTimeout(() => el.remove(), 6600);
}
