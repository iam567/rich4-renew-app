/**
 * 玩家統計 (the user 2026-11-04: which regions play most, which devices — to aim the next versions): once a day, when
 * the game reaches its title, it says hello to the relay with this install's random id (party-presence.ts deviceId),
 * the app's version and its platform; the relay reads the device from the request's User-Agent and the region from
 * the address (tools/party-relay/players.mjs). Nothing else: no name, no save, nothing personal. Never waits, never fails loudly.
 */
import { relays } from './net-peer';
import { deviceId } from './party-presence';
import { platform } from './party-report';
import { RUNNING } from './update';

const DAY_KEY = 'rich4.hi.day';

export async function sayHello(): Promise<void> {
  try {
    const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    if (localStorage.getItem(DAY_KEY) === day) return;
    const url = (await relays())[0], dev = deviceId();
    if (!url || !dev) return;
    const r = await fetch(`${url.replace(/^ws/, 'http').replace(/\/+$/, '')}/hi`, {
      method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dev, v: RUNNING, plat: platform() }),
    });
    if (r.ok) localStorage.setItem(DAY_KEY, day);
  } catch { /* not reached: tomorrow, or the next start */ }
}
