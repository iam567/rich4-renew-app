/**
 * 派對模式's head count (the user 2026-11-03: how many people are in 派對模式 right now, shown in the game). A phone in
 * 派對模式 (its menu, a room, a game) tells the relay every 15 s with a random id of this install and where it is; the
 * relay counts those heard within 35 s (tools/party-relay/relay.mjs /stats). The title only reads the count.
 * Without the relay (unreachable, or none listed) there is no count and nothing is shown.
 */
import { relays } from './net-peer';

export interface HeadCount { online: number; menu: number; room: number; game: number }
export type PartyPlace = 'menu' | 'room' | 'game';

const DEV_KEY = 'rich4.party.dev';
/** A random id of this install (no account, nothing personal): one phone counts once whatever it has open. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEV_KEY) ?? '';
    if (!/^[A-Za-z0-9]{8,40}$/.test(id)) { id = Array.from({ length: 16 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join(''); localStorage.setItem(DEV_KEY, id); }
    return id;
  } catch { return ''; }
}

async function statsUrl(): Promise<string | null> {
  const url = (await relays())[0];
  return url ? `${url.replace(/^ws/, 'http').replace(/\/+$/, '')}/stats` : null;
}

/** The count now (and, with `where`, this phone counted there; 'off': no longer). Null when the relay doesn't answer. */
export async function fetchHeadCount(where?: PartyPlace | 'off'): Promise<HeadCount | null> {
  const base = await statsUrl();
  if (!base) return null;
  const app = where && where !== 'off' ? reportApp() : null;
  const q = where ? `?dev=${deviceId()}&where=${where}${app ? `&v=${encodeURIComponent(app.v)}&plat=${encodeURIComponent(app.plat)}&name=${encodeURIComponent(app.name)}` : ''}` : '';
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(base + q, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json() as Partial<HeadCount>;
    const n = (k: keyof HeadCount) => (Number.isFinite(j[k]) ? Math.max(0, Math.floor(j[k] as number)) : 0);
    return { online: n('online'), menu: n('menu'), room: n('room'), game: n('game') };
  } catch { return null; }
}

let place: PartyPlace | null = null;
/** Where this phone is in 派對模式 now (null: not in it). */
export const partyPlace = () => place;
/** This phone's version, platform and name with the count (party-report.ts sets it; none: the count only). */
let reportApp: () => { v: string; plat: string; name: string } | null = () => null;
export function setPresenceApp(f: () => { v: string; plat: string; name: string }) { reportApp = f; }
let timer = 0;
let last: HeadCount | null = null;
const listeners = new Set<(n: HeadCount) => void>();

async function report() {
  if (!place) return;
  const n = await fetchHeadCount(place);
  if (!n || !place) return;
  last = n;
  for (const fn of listeners) fn(n);
}

/** This phone is in 派對模式 at `p` (reported now and every 15 s), or left it (null). */
export function inParty(p: PartyPlace | null) {
  const was = place;
  place = p;
  clearInterval(timer); timer = 0;
  if (p) { void report(); timer = setInterval(() => void report(), 15_000) as unknown as number; }
  else if (was) void fetchHeadCount('off');
}

/** The newest count known (null: none yet). */
export const lastHeadCount = () => last;

/** Called with each new count while this phone is in 派對模式 (at once with the last one known). */
export function onHeadCount(fn: (n: HeadCount) => void): () => void {
  listeners.add(fn);
  if (last) fn(last);
  return () => listeners.delete(fn);
}

/** 「派對模式 12 人在線」 and the split (遊戲中 / 房間裡 / 選單) — the parts that are not zero. */
export function headLine(n: HeadCount): string {
  const parts = [n.game ? `遊戲中 ${n.game}` : '', n.room ? `房間裡 ${n.room}` : '', n.menu ? `選單 ${n.menu}` : ''].filter(Boolean);
  return `${n.online} 人在線${parts.length > 1 ? `（${parts.join('・')}）` : ''}`;
}
