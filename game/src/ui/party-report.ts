/**
 * 派對模式's problem reports (docs/rules/22 §3.1.1), to find what goes wrong online. Only while this phone is in
 * 派對模式: a program error, a wait for another player far too long, the two phones' games differing, a lost connection
 * to the host, a new host. Each report carries the app's version, the platform, the player's name, the install id and
 * the room code — nothing else. A save that fails is reported in every game (issue #58: the game only said it failed).
 */
import { Capacitor } from '@capacitor/core';
import { relays } from './net-peer';
import { deviceId, partyPlace, setPresenceApp } from './party-presence';
import { PARTY_VERSION } from './party-net';
import { setHelloApp } from './relay-peer';

export type ReportKind = 'error' | 'stuck' | 'desync' | 'drop' | 'host' | 'timeout' | 'save' | 'game';

/** The player's name and the room they are in (party.ts / main.ts keep them current). */
export const reportCtx: { name: string; room: string } = { name: '', room: '' };

export function platform(): string {
  if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) return 'electron';
  try { return Capacitor.getPlatform(); } catch { return 'web'; }
}
/** Who this phone is, for the relay (its hello) and the reports. */
export const appInfo = () => ({ v: PARTY_VERSION ?? '', plat: platform(), name: reportCtx.name, dev: deviceId() });

/** The player's name in the reports (and in the relay's session). */
export function setReportName(name: string) { reportCtx.name = name; setHelloApp(appInfo()); setPresenceApp(appInfo); }

let sent = 0, sentAt = 0;
/** Sends a report (at most 20 a minute from this phone; never waits, never fails loudly). */
export async function reportParty(kind: ReportKind, msg: string, extra: { detail?: string; seq?: number } = {}) {
  const now = Date.now();
  if (now - sentAt > 60_000) { sent = 0; sentAt = now; }
  if (++sent > 20) return;
  const url = (await relays())[0];
  if (!url) return;
  try {
    await fetch(`${url.replace(/^ws/, 'http').replace(/\/+$/, '')}/report`, {
      method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, msg: msg.slice(0, 300), detail: extra.detail?.slice(0, 2000), seq: extra.seq, room: reportCtx.room || undefined, app: appInfo() }),
    });
  } catch { /* the relay is not reached: nothing to do */ }
}

/** The game this phone has a seat in: how far it got comes from main.ts, its way to the room from the room. */
let playing: { gid: string; via: () => string } | null = null;
export const gameAt = { days: 0 };
let watchingExit = false;

const gameEvent = (stage: string, gid: string, extra: Record<string, unknown>) =>
  reportParty('game', stage, { detail: JSON.stringify({ gid, days: gameAt.days, ...extra }) });

/** A game begins on this phone (the phones of one game share `gid`): the admin page counts how many get finished. */
export function gameStart(gid: string, via: () => string, info: { map: number; humans: number; total: number }) {
  if (playing?.gid === gid) return;
  playing = { gid, via };
  gameAt.days = 0;
  void gameEvent('start', gid, { ...info, via: via() });
  if (watchingExit || typeof window === 'undefined') return;
  watchingExit = true;
  window.addEventListener('pagehide', () => gameEnd('quit', 'closed'));
}

/** The game is over for this phone: finished, or left (`why`: left, kicked, closed); only the first call counts. */
export function gameEnd(stage: 'finish' | 'quit', why = '') {
  if (!playing) return;
  const { gid, via } = playing;
  playing = null;
  void gameEvent(stage, gid, { via: via(), ...(why ? { why } : {}) });
}

let saveReports = 0;
/** A failed save: what failed, the step it stopped at, and the room the system gives the app (at most three a run). */
export async function reportSaveFailed(what: string, e: unknown, step: string) {
  if (++saveReports > 3) return;
  const err = e as { message?: string; code?: string; stack?: string } | undefined;
  const mb = (n?: number) => (n === undefined ? '?' : `${Math.round(n / 1048576)} MB`);
  const room = await navigator.storage?.estimate?.().then(s => `quota ${mb(s.quota)}, used ${mb(s.usage)}`, () => '') ?? '';
  await reportParty('save', `${what}：${err?.message ?? String(e)}`, { detail: [`step: ${step}`, err?.code && `code: ${err.code}`, room, err?.stack].filter(Boolean).join('\n') });
}

/** A chat line this phone said in a room, to the relay as well (whichever way the room is connected). */
export async function postChat(room: string, text: string) {
  const url = (await relays())[0];
  if (!url || !text) return;
  try {
    await fetch(`${url.replace(/^ws/, 'http').replace(/\/+$/, '')}/chat`, {
      method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room, text, app: appInfo() }),
    });
  } catch { /* not reached: nothing to do */ }
}

let watching = false;
/** Program errors while in 派對模式 are reported too (installed once). */
export function watchErrors() {
  if (watching || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  watching = true;
  window.addEventListener('error', e => {
    // The browser's own note that a layout fitting itself (fitToScreen, shrinkText) took one more frame: harmless, never
    // reported (2026-11-04: it was nearly every 「程序錯誤」 on the admin page).
    if (/ResizeObserver loop/.test(String(e.message))) return;
    if (partyPlace()) void reportParty('error', String(e.message || 'error'), { detail: `${e.filename ?? ''}:${e.lineno ?? ''}:${e.colno ?? ''}\n${(e.error as Error | undefined)?.stack ?? ''}` });
  });
  window.addEventListener('unhandledrejection', e => {
    if (!partyPlace()) return;
    const r = e.reason as Error | undefined;
    void reportParty('error', String(r?.message ?? r ?? 'unhandled rejection'), { detail: r?.stack });
  });
}
