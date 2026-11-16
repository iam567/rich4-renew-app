/**
 * 局域網房間 (the user 2026-11-08: 「同一個局域網…搜房間碼不就行了嗎」): the rooms PCs on this device's network are
 * hosting (desktop/lan-relay.cjs), found without typing an address. Every address of this device's /24 is asked for
 * /lan on the server's ports — not from this page (a web view allows too few connections at once: the right one was
 * crowded out by the dead ones), but by the PC version's main process (lan-relay.cjs findLan) or the app's LanInfo
 * plugin (android LanInfoPlugin.java, ios AppDelegate.swift). Nothing leaves the local network.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

/** A PC hosting on the network: its address (「192.168.1.5:8842」), its name, its rooms' codes. */
export interface LanServer { addr: string; host: string; rooms: string[] }

/** (desktop/lan-relay.cjs tries these in turn) */
const PORTS = [8842, 18842, 28842];

interface LanInfoPlugin { find(o: { ports: number[] }): Promise<{ found: { addr: string; body: string }[] }> }
const LanInfo = registerPlugin<LanInfoPlugin>('LanInfo');
const desktop = () => (globalThis as { rich4Desktop?: { lan?: { find?(): Promise<LanServer[]> } } }).rich4Desktop?.lan;

/**
 * Whether this install can play 局域網房間: the PC version from 1.2 on (its main process hosts and searches) or the app
 * from 1.2 on (its LanInfo plugin; older installers lack it and block plain local connections). An older install
 * that took the game by the in-game update (1.1.1) shows no 局域網房間 at all rather than one that cannot work.
 */
export function lanSupported(): boolean {
  if (desktop()) return true;
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LanInfo');
}

/** One server's /lan answer as the game keeps it, or null. */
export function lanServer(addr: string, body: unknown): LanServer | null {
  let j = body as { rich4?: string; host?: unknown; rooms?: unknown };
  if (typeof body === 'string') { try { j = JSON.parse(body); } catch { return null; } }
  if (!j || j.rich4 !== 'lan' || !/^[A-Za-z0-9.-]+:\d{2,5}$/.test(addr)) return null;
  return { addr, host: typeof j.host === 'string' ? j.host.slice(0, 40) : '', rooms: Array.isArray(j.rooms) ? j.rooms.map(String).filter(x => /^\d{1,8}$/.test(x)) : [] };
}

/** The PCs hosting on this device's networks; `[]` where it cannot look (a browser): then the address is typed by hand. */
export async function findLan(): Promise<LanServer[]> {
  try {
    const d = desktop();
    if (d?.find) return (await d.find()).map(s => lanServer(s.addr, { ...s, rich4: 'lan' })).filter((s): s is LanServer => !!s);
    if (Capacitor.isNativePlatform()) return (await LanInfo.find({ ports: PORTS })).found.map(f => lanServer(f.addr, f.body)).filter((s): s is LanServer => !!s);
  } catch { /* nothing found */ }
  return [];
}
