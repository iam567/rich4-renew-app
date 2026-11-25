/**
 * 私服 (the user 2026-11-18, issue #116): players with a server of their own run tools/private-server on it and the
 * game plays 派對模式 there instead of on ours — 「私服房間」 in 派對模式 holds 局域網房間, 私服房間 (the servers this
 * device has been on, or a typed address) and 私服列表 (those players made public, sorted by this phone's ping).
 *
 * A 私服 is reached at 「host:port」 over plain http/ws (no certificate: a mainland VPS needs no 備案 that way). Its
 * /info says what it is; the public list lives on our relay (tools/party-relay/servers.mjs).
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { officialRelays } from './net-peer';
import { deviceId } from './party-presence';
import { cleanBanner, cleanNext, cleanSocials, cleanTicker, ownerText, safeLink, type Banner, type NextEvent, type Social, type Ticker } from './private-server-news';

export const DEFAULT_PORT = 8842;
/** A 私服's own answer (tools/private-server/server.cjs /info). */
export interface ServerInfo { name: string; online: number; rooms: number; max: number; listed: boolean; region: string; headline: string; next: NextEvent | null; /** 私服介紹 ('' none) and Banner (private-server-news.ts). */ intro: string; banner: Banner | null; /** 服主社交帳號, 滾動公告. */ socials: Social[]; ticker: Ticker | null; /** 進服密碼 needed; this device banned there. */ needPassword?: boolean; banned?: boolean }
/** One of this device's 私服 (most recent first), under the name this player gave it. */
export interface MyServer { addr: string; name: string; at: number }
/** One of the 私服列表 (`area`: from its IP; `region`: the owner's own word for where it is, rich4-server.json). */
export interface PublicServer { addr: string; name: string; area: string; region?: string; online: number; rooms: number; max: number; down?: boolean; mine?: boolean }
/** Where it is, as the 私服列表 says it: the owner's word first, else the area its IP is in. */
export const whereOf = (s: { area?: string; region?: string }) => s.region || s.area || '';

/** 擁堵: nearly full (four fifths of its players), or slow from here. */
export const crowded = (s: { online: number; max: number }, ms?: number | null) => (s.max > 0 && s.online >= s.max * 0.8) || (!!ms && ms > 300);

const KEY = 'rich4.party.servers';
const KEEP = 20;

/** What a player typed (「1.2.3.4」, 「1.2.3.4:9000」, 「http://my.host:9000/」) as 「host:port」, or ''. */
export function normAddr(v: string): string {
  let s = String(v ?? '').trim().toLowerCase().replace(/^(https?|wss?):\/\//, '').replace(/\/.*$/, '').replace(/[：]/g, ':').replace(/[。]/g, '.');
  if (!s) return '';
  if (/^[a-z0-9.-]+$/.test(s) || /^\[[0-9a-f:]+\]$/.test(s)) s = `${s}:${DEFAULT_PORT}`;
  const m = /^([a-z0-9.-]{1,120}|\[[0-9a-f:]+\]):(\d{1,5})$/.exec(s);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535 || !/[a-z0-9]/.test(m[1])) return '';
  return s;
}

export function myServers(): MyServer[] {
  try {
    const k = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(k) ? k.filter(x => typeof x?.addr === 'string' && normAddr(x.addr)).map(x => ({ addr: normAddr(x.addr), name: String(x.name ?? '').slice(0, 20), at: Number(x.at) || 0 })) : [];
  } catch { return []; }
}
function keep(list: MyServer[]) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, KEEP))); } catch { /* not kept */ } }
/** Been on it now (or renamed): first in the list; `name` '' keeps the name it had. */
export function rememberServer(addr: string, name: string) {
  const old = myServers().find(x => x.addr === addr);
  keep([{ addr, name: name || old?.name || '', at: Date.now() }, ...myServers().filter(x => x.addr !== addr)]);
}
/** The name this player gave it ('' when not one of theirs). */
export const myName = (addr: string) => myServers().find(x => x.addr === addr)?.name ?? '';
/** Off this device's list (the server itself is untouched). */
export function forgetServer(addr: string) { keep(myServers().filter(x => x.addr !== addr)); }

/**
 * 收藏 (the user 2026-11-23): 私服 of the 私服列表 this player starred, kept on this device like 「我的私服」 and shown
 * first — also while one is off the list (it is asked directly then).
 */
export interface FavServer { addr: string; name: string }
const FAV_KEY = 'rich4.party.srvfav';
const FAV_KEEP = 30;
export function favServers(): FavServer[] {
  try {
    const k = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(k) ? k.filter(x => typeof x?.addr === 'string' && normAddr(x.addr)).map(x => ({ addr: normAddr(x.addr), name: String(x.name ?? '').slice(0, 20) })) : [];
  } catch { return []; }
}
/** Starred (true) or unstarred; the newest star first. */
export function toggleFav(addr: string, name: string): boolean {
  const old = favServers(), on = !old.some(x => x.addr === addr);
  const next = on ? [{ addr, name }, ...old] : old.filter(x => x.addr !== addr);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(next.slice(0, FAV_KEEP))); } catch { /* not kept */ }
  return on;
}

/** Ping from this device: ms, null (did not answer), undefined (not measured yet). */
export type Pings = Map<string, number | null>;
/** Full: no one more can come in. */
const full = (s: { online: number; max: number }) => s.max > 0 && s.online >= s.max;
/**
 * The 私服列表 in its order (the user 2026-11-23): 收藏 first, then the rest; in each, those that answered by their ping
 * (fastest first), then those not measured yet (in the order the list came), then 斷線 ones. `best`: the one 推薦 and
 * 「進入最快的私服」 go to — the fastest that answered and is not full, one not 擁堵 before one that is ('' none yet).
 */
export function orderServers<T extends PublicServer>(list: T[], pings: Pings | undefined, favs: Iterable<string>): { order: T[]; best: string } {
  const fav = new Set(favs);
  const ms = (x: T) => pings?.get(x.addr);
  const off = (x: T) => !!x.down || ms(x) === null;
  const rank = (x: T) => off(x) ? 2 : ms(x) === undefined ? 1 : 0;
  const order = list.map((x, i) => ({ x, i })).sort((a, b) =>
    Number(!fav.has(a.x.addr)) - Number(!fav.has(b.x.addr)) || rank(a.x) - rank(b.x) || (rank(a.x) ? 0 : ms(a.x)! - ms(b.x)!) || a.i - b.i).map(o => o.x);
  const ok = list.filter(x => !off(x) && typeof ms(x) === 'number' && !full(x)).sort((a, b) =>
    Number(crowded(a, ms(a))) - Number(crowded(b, ms(b))) || ms(a)! - ms(b)!);
  return { order, best: ok[0]?.addr ?? '' };
}

/** 滾動公告 of the 私服 at `addr` (its /info once): null none, undefined not reached (keep what is shown). */
export async function serverTicker(addr: string): Promise<Ticker | null | undefined> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const j = await (await fetch(`http://${addr}/info`, { signal: ctl.signal, cache: 'no-store' })).json() as Record<string, unknown>;
    return j?.rich4 === 'server' ? cleanTicker(j.ticker) : undefined;
  } catch { return undefined; } finally { clearTimeout(timer); }
}

/** Its /info and how long it took (the best of two, ms), or null when it does not answer as a 私服 (3 s). */
export async function probe(addr: string): Promise<{ info: ServerInfo; ms: number } | null> {
  let best: { info: ServerInfo; ms: number } | null = null;
  for (let i = 0; i < 2; i++) {
    const ctl = new AbortController(), t0 = performance.now();
    const timer = setTimeout(() => ctl.abort(), 3000);
    try {
      const r = await fetch(`http://${addr}/info`, { signal: ctl.signal, cache: 'no-store' });
      const j = await r.json() as Partial<Record<keyof ServerInfo | 'rich4', unknown>>;
      const ms = Math.round(performance.now() - t0);
      if (j?.rich4 !== 'server') return null;
      const info: ServerInfo = { name: ownerText(j.name, 20) || '大富翁4 私服', online: Number(j.online) || 0, rooms: Number(j.rooms) || 0, max: Number(j.max) || 0, listed: j.listed !== false, region: ownerText(j.region, 8), headline: ownerText(j.headline, 40), next: cleanNext(j.next), intro: ownerText(j.intro, 300, true), banner: cleanBanner(j.banner), socials: cleanSocials(j.socials), ticker: cleanTicker(j.ticker) };
      // 進服密碼 needed; this device's address banned there (the owner's 管理頁)
      if (j.needPassword) info.needPassword = true;
      if (j.banned) info.banned = true;
      if (!best || ms < best.ms) best = { info, ms };
    } catch { if (!best) return null; } finally { clearTimeout(timer); }
  }
  return best;
}

const base = async () => {
  const url = (await officialRelays())[0];
  return url ? url.replace(/^ws/, 'http').replace(/\/+$/, '') : '';
};
/** The 私服列表 (null: ours not reached). */
export async function publicServers(): Promise<PublicServer[] | null> {
  try {
    const b = await base();
    if (!b) return null;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`${b}/servers?dev=${encodeURIComponent(deviceId())}`, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const j = await r.json() as { servers?: PublicServer[] };
    return Array.isArray(j.servers) ? j.servers : [];
  } catch { return null; }
}
const WHY: Record<string, string> = {
  bad: '地址不對', private: '這是內網地址，外面的人連不到', unreachable: '從外面連不到這個私服：確認伺服器的防火牆／安全組放行了這個埠',
  unlisted: '這個私服的主人設定了不公開', full: '你公開的私服太多了', busy: '操作太頻繁，等一下再試', 'not-yours': '只有公開它的人才能取消公開', banned: '這個私服不能公開到私服列表',
  taken: '這個私服已經被別人公開在私服列表裡了',
};
/** Make it public under `name` (again: renamed) (''), or take it off; else why not. */
export async function publish(addr: string, on: boolean, name = ''): Promise<string> {
  try {
    const b = await base();
    if (!b) return '連不上網路';
    const r = await fetch(`${b}/servers${on ? '' : '/remove'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ addr, dev: deviceId(), ...(on ? { name } : {}) }) });
    const j = await r.json() as { ok?: boolean; error?: string };
    return j.ok ? '' : WHY[j.error ?? ''] ?? '沒有成功，等一下再試';
  } catch { return '連不上網路'; }
}

/**
 * An outside page (a 私服's Banner link: http(s) only) in the system's browser, never inside the game: the PC version's
 * window-open handler hands it to shell.openExternal (desktop/main.cjs); the iPhone app's web view gives a new window to
 * Safari (Capacitor's WebViewDelegationHandler createWebViewWith → UIApplication.open); the Android app's web view sends
 * any other host out as ACTION_VIEW, the default browser (Capacitor's Bridge.launchIntent); the browser version: a new tab.
 */
export function openOutside(url: string) {
  const u = safeLink(url);
  if (!u) return;
  const w = window.open(u, '_blank');
  try { if (w) w.opener = null; } catch { /* another origin */ }
}

/** Text to the clipboard (the web view's clipboard, else the old way); false when neither worked. */
export async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* not allowed here */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/**
 * 私服舉報 (the user 2026-11-23: 「加一個私服舉報按鈕，可以舉報違法私服到後台」): sent to our relay (never to the 私服
 * itself — its owner never sees it), one reason and a short note.
 */
export const REPORT_REASONS = [['gambling', '賭博'], ['porn', '色情'], ['political', '政治違規'], ['fraud', '詐騙'], ['other', '其他違法']] as const;
export type ReportReason = typeof REPORT_REASONS[number][0];
export const REPORT_NOTE_MAX = 200;
/** '' sent, else what to tell the player. */
export async function reportServer(addr: string, name: string, reason: ReportReason, text: string): Promise<string> {
  if (!REPORT_REASONS.some(([k]) => k === reason)) return '要選一個舉報原因';
  try {
    const b = await base();
    if (!b) return '沒有送出，等一下再試';
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${b}/servers/report`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ addr, name: ownerText(name, 20), reason, text: ownerText(text, REPORT_NOTE_MAX, true), dev: deviceId() }),
    });
    clearTimeout(timer);
    const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (j.ok) return '';
    return ({ dup: '你今天已經舉報過這個私服了', busy: '操作太頻繁，等一下再試' } as Record<string, string>)[j.error ?? ''] ?? '沒有送出，等一下再試';
  } catch { return '沒有送出，等一下再試'; }
}

/**
 * A room just opened on the 私服 at `addr` takes its 6-digit code everywhere (so 「進入房間」 with the code alone finds
 * it): false only when the code is already someone else's; true when ours cannot be reached (the room still works
 * for those who connect to the 私服 first).
 */
export async function claimRoomCode(code: string, addr: string): Promise<boolean> {
  try {
    const b = await base();
    if (!b) return true;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${b}/proom`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, addr }), signal: ctl.signal });
    clearTimeout(timer);
    return (await r.json() as { error?: string }).error !== 'taken';
  } catch { return true; }
}
/** The 私服 holding room `code` (a 6-digit code our relay does not have), or ''. */
export async function findRoomServer(code: string): Promise<string> {
  if (!/^\d{6}$/.test(code)) return '';
  try {
    const b = await base();
    if (!b) return '';
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${b}/proom?code=${code}`, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    return normAddr(String((await r.json() as { addr?: string }).addr ?? ''));
  } catch { return ''; }
}

interface LanInfoPlugin { caps(): Promise<{ server?: boolean }> }
const LanInfo = registerPlugin<LanInfoPlugin>('LanInfo');
let can: Promise<boolean> | null = null;
/**
 * Whether this install reaches a 私服: the PC version and the Android app (plain connections allowed since 1.0); the
 * iPhone app only from the 1.3 installer (its web view let out to any address — older ones answer no to caps()); never
 * the browser version (an https page may not open ws://).
 */
export function serverSupported(): Promise<boolean> {
  can ??= (async () => {
    if ((globalThis as { rich4Desktop?: unknown }).rich4Desktop) return true;
    // the browser version: only a page served over plain http (a developer's own test) may open ws://
    if (!Capacitor.isNativePlatform()) return typeof location !== 'undefined' && location.protocol === 'http:';
    if (Capacitor.getPlatform() === 'android') return true;
    try { return !!(await LanInfo.caps()).server; } catch { return false; }
  })();
  return can;
}

/**
 * 進服密碼 (the user 2026-11-23: an owner may lock the 私服): asked once, kept per 私服 on this device, sent with each
 * hello (net-peer.ts useServer) and to its /news, /inbox … (the x-rich4-pw header).
 */
const PW_KEY = 'rich4.party.srvpw';
const pwAll = (): Record<string, string> => { try { const k = JSON.parse(localStorage.getItem(PW_KEY) ?? '{}'); return k && typeof k === 'object' ? k : {}; } catch { return {}; } };
export const serverPass = (addr: string): string => { const v = pwAll()[addr]; return typeof v === 'string' ? v : ''; };
export function setServerPass(addr: string, pw: string) {
  const all = pwAll();
  if (pw) all[addr] = pw.slice(0, 32); else delete all[addr];
  try { localStorage.setItem(PW_KEY, JSON.stringify(all)); } catch { /* not kept */ }
}
/** Whether `pw` is that 私服's password: 'ok', 'wrong', 'busy' (too many tries), or 'down' (not reached). */
export async function checkPass(addr: string, pw: string): Promise<'ok' | 'wrong' | 'busy' | 'down'> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(`http://${addr}/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pw }), signal: ctl.signal, cache: 'no-store' });
    if (r.status === 429) return 'busy';
    return (await r.json() as { ok?: boolean }).ok ? 'ok' : 'wrong';
  } catch { return 'down'; } finally { clearTimeout(timer); }
}
