/**
 * 派對模式's problem reports (docs/rules/22 §3.1.1), to find what goes wrong online. Only while this phone is in
 * 派對模式: a program error, a wait for another player far too long, the two phones' games differing, a lost connection
 * to the host, a new host. Each report carries the app's version, the platform, the player's name, the install id and
 * the room code — nothing else.
 */
import { Capacitor } from '@capacitor/core';
import { relays } from './net-peer';
import { deviceId, partyPlace, setPresenceApp } from './party-presence';
import { PARTY_VERSION } from './party-net';
import { setHelloApp } from './relay-peer';

export type ReportKind = 'error' | 'stuck' | 'desync' | 'drop' | 'host' | 'timeout';

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
  window.addEventListener('error', e => { if (partyPlace()) void reportParty('error', String(e.message || 'error'), { detail: `${e.filename ?? ''}:${e.lineno ?? ''}:${e.colno ?? ''}\n${(e.error as Error | undefined)?.stack ?? ''}` }); });
  window.addEventListener('unhandledrejection', e => {
    if (!partyPlace()) return;
    const r = e.reason as Error | undefined;
    void reportParty('error', String(r?.message ?? r ?? 'unhandled rejection'), { detail: r?.stack });
  });
}
