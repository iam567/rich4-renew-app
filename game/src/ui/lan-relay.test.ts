/**
 * 局域網房間 (desktop/lan-relay.cjs, the user 2026-11-08): the PC version's own server — the same relay wire as the
 * VPS's (a room played over it, a dropped socket coming back), its rooms for the app's search; never the game in a browser.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('peerjs', () => import('./peerjs-mock'));

import { pack } from '../core/date';
import { netConfig } from './net-peer';
import { Room, startMsg } from './party-net';
import type { RelayPeer } from './relay-peer';

const server = fileURLToPath(new URL('../../desktop/lan-relay.cjs', import.meta.url));
const have = existsSync(fileURLToPath(new URL('../../desktop/node_modules/ws', import.meta.url)));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 4000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await sleep(20); } };

describe.skipIf(!have)('局域網房間 (the PC version\'s server)', () => {
  let lan: { port: number; urls: string[]; stop(): void };
  const dir = mkdtempSync(join(tmpdir(), 'rich4-lan-'));
  beforeAll(async () => {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(dir, 'a.mp3'), Buffer.alloc(1000, 7));
    const { startLan, local } = createRequire(import.meta.url)(server) as { startLan(o?: object): Promise<typeof lan>; local(ip: string): boolean };
    // only the local network
    expect(['192.168.1.5', '10.0.0.2', '172.20.1.1', '127.0.0.1', '::1', '::ffff:192.168.0.9', 'fe80::1'].every(local)).toBe(true);
    expect(['8.8.8.8', '172.32.0.1', '203.0.113.5', '::ffff:1.2.3.4', '2001:db8::1'].some(local)).toBe(false);
    lan = await startLan();
    vi.stubGlobal('window', globalThis);
  });
  afterAll(() => { lan?.stop(); rmSync(dir, { recursive: true, force: true }); netConfig.relays = []; netConfig.lan = false; });

  it('a browser gets only how to join with the app (never the game); the rooms are listed for the app\'s search', async () => {
    const base = `http://127.0.0.1:${lan.port}`;
    const r = await fetch(`${base}/?room=1234`);
    expect(r.status).toBe(200);
    const page = await r.text();
    expect(page).toContain('大富翁4 App');
    expect(page).toContain('1234');
    expect((await fetch(`${base}/index.html`)).headers.get('content-type')).toContain('text/html');
    expect(await (await fetch(`${base}/index.html`)).text()).not.toContain('<title>t</title>');
    expect((await fetch(`${base}/chat`, { method: 'POST', body: '{"text":"x"}' })).status).toBe(204);
    expect(await (await fetch(`${base}/lan`)).json()).toMatchObject({ rich4: 'lan', rooms: [] });
  });

  it('plays a room over it, and a dropped socket comes back', async () => {
    netConfig.relays = [`ws://127.0.0.1:${lan.port}`]; netConfig.lan = true;
    const host = new Room({ name: 'h', character: 0 }, '1.1.1'), g = new Room({ name: 'g', character: 3 }, '1.1.1');
    try {
      const code = await host.create('2', false);
      // the room is listed for the phones' search (lan-find.ts)
      expect((await (await fetch(`http://127.0.0.1:${lan.port}/lan`)).json()).rooms).toEqual([code]);
      await g.join(code);
      await until(() => host.members.length === 2);
      host.start(startMsg(host, 4, pack(2026, 11, 8), 9));
      await until(() => !!g.started);
      host.answer(0, 'roll');
      g.answer(1, 'buy');
      expect(await g.wait(0)).toBe('roll');
      expect(await host.wait(1)).toBe('buy');
      ((g as unknown as { peer: { relay: RelayPeer } }).peer.relay as unknown as { ws: WebSocket | null }).ws?.close();
      host.answer(2, 'end');
      expect(await g.wait(2)).toBe('end');
    } finally { host.close(); g.close(); }
  });
});
