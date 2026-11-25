/**
 * 私服 斷線重連 (the user 2026-11-23: 「掉線就連不回去」): a real 私服 (tools/private-server, relayCore) on a local port,
 * a room played over it, and a guest whose network goes away mid-game for longer than the 私服 holds its session —
 * its tries to reconnect failing meanwhile (they used to end it for good: a 私服 has no other way to the room). Back,
 * it gets the same seat in the same room and the game goes on identically; the computer played the seat meanwhile
 * (the host's side as on ours). Also the app closed and opened again (issue #50) on a 私服, and the owner's refusals
 * the game shows (full, password, ban, sent away).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('peerjs', () => import('./peerjs-mock'));

import { pack } from '../core/date';
import { netConfig, useServer } from './net-peer';
import { rememberedServer, Room, startMsg } from './party-net';
import { setHelloApp, type RelayPeer } from './relay-peer';

const serverFile = fileURLToPath(new URL('../../../tools/private-server/server.cjs', import.meta.url));
const have = existsSync(fileURLToPath(new URL('../../desktop/node_modules/ws', import.meta.url)));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await sleep(25); } };
type Srv = { port: number; stop(): void; cfg: { adminToken: string }; core: { sessions: Map<string, { app?: { dev?: string } }> } };
const relayOf = (r: Room) => (r as unknown as { peer: { relay: RelayPeer } }).peer.relay;
const sock = (p: RelayPeer) => p as unknown as { ws: WebSocket | null; url: string };

describe.skipIf(!have)('私服: 斷線重連 and the owner\'s refusals', () => {
  const store = new Map<string, string>();
  const dir = mkdtempSync(join(tmpdir(), 'rich4-srvre-'));
  const req = createRequire(import.meta.url);
  const { startServer } = req(serverFile) as { startServer(o: object): Promise<Srv> };
  let srv: Srv, addr = '';
  const rooms: Room[] = [];
  const room = (name: string, character: number) => { const r = new Room({ name, character }, '1.3.0'); rooms.push(r); return r; };
  beforeAll(async () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    // ours (where a 私服 room claims its code) is not reached in a test: the code is the 私服's alone
    store.set('rich4.party.relayDev', 'ws://127.0.0.1:1');
    srv = await startServer({ port: 0, name: '測試服', max: 50, holdMs: 1500, roomHoldMs: 1500, log: () => {} });
    addr = `127.0.0.1:${srv.port}`;
  });
  afterEach(() => { for (const r of rooms.splice(0)) r.close(); setHelloApp({}); });
  afterAll(() => { srv?.stop(); useServer('', ''); netConfig.relays = []; rmSync(dir, { recursive: true, force: true }); });

  it('a guest off the network past the hold, its tries failing meanwhile: back in the same seat, the game the same', async () => {
    useServer(addr, '測試服');
    const host = room('h', 0), g = room('g', 3);
    const said: string[] = [];
    g.onStatus = t => said.push(t);
    const code = await host.create('2', false);
    expect(code).toMatch(/^\d{6}$/);
    await g.join(code);
    await until(() => host.members.length === 2);
    host.start(startMsg(host, 4, pack(2026, 11, 23), 7));
    await until(() => !!g.started);
    const seat = [...g.mine][0], id = g.myId;
    host.answer(0, 'roll'); g.answer(1, 'buy');
    expect(await g.wait(0)).toBe('roll');
    expect(await host.wait(1)).toBe('buy');

    // The guest's network goes: every try to reconnect fails (a dead address), past the 私服's 1.5 s hold.
    const p = relayOf(g), url = sock(p).url;
    sock(p).url = 'ws://127.0.0.1:1';
    sock(p).ws?.close();
    await until(() => !srv.core.sessions.has(id), 6000);            // the 私服 let its session go
    await until(() => !host.ownerConnected(seat), 6000);             // the host: gone, the computer plays its seat
    expect(host.members.find(m => m.id === id)?.away).toBe(true);
    host.answer(2, 'end'); host.answer(3, 'auto-for-g');               // the game goes on meanwhile
    await sleep(2500);
    expect(p.destroyed).toBe(false);                                   // still trying (it used to give up here)

    // The network is back: the same id, the same seat, what it missed, and on as before.
    sock(p).url = url;
    await until(() => host.ownerConnected(seat), 25000);
    expect(said.some(t => /重新連線/.test(t))).toBe(true);             // the usual indicator while away
    expect(g.myId).toBe(id);
    expect([...g.mine]).toEqual([seat]);
    expect(await g.wait(2)).toBe('end');
    expect(await g.wait(3)).toBe('auto-for-g');
    g.answer(4, 'sell');
    expect(await host.wait(4)).toBe('sell');
    expect(host.members.find(m => m.id === id)?.away).toBe(false);
    expect(host.members.length).toBe(2);
  }, 40000);

  it('the host off the network past the hold: a guest takes the room over, the old host comes back to its own seat', async () => {
    useServer(addr, '測試服');
    const host = room('h', 0), g = room('g', 3);
    const code = await host.create('2', false);
    await g.join(code);
    await until(() => host.members.length === 2);
    host.start(startMsg(host, 4, pack(2026, 11, 23), 9));
    await until(() => !!g.started);
    host.answer(0, 'roll');
    expect(await g.wait(0)).toBe('roll');
    const p = relayOf(host), url = sock(p).url;
    sock(p).url = 'ws://127.0.0.1:1';
    sock(p).ws?.close();
    await until(() => g.host, 20000);                                  // the room passed on
    g.answer(1, 'new-host-answer');
    sock(p).url = url;                                                  // the old host's network is back
    await until(() => !host.host && host.connected(), 25000);           // a guest of the new host now
    expect([...host.mine]).toEqual([0]);
    expect(await host.wait(1)).toBe('new-host-answer');
    await until(() => g.ownerConnected(0), 10000);
    host.answer(2, 'old-host-again');
    expect(await g.wait(2)).toBe('old-host-again');
  }, 60000);

  it('the app closed and opened again (issue #50): the room code alone goes back to that 私服, the same seat', async () => {
    useServer(addr, '測試服');
    const host = room('h', 0), g = room('g', 3);
    const code = await host.create('2', false);
    await g.join(code);
    await until(() => host.members.length === 2);
    host.start(startMsg(host, 4, pack(2026, 11, 23), 8));
    await until(() => !!g.started);
    const seat = [...g.mine][0];
    host.answer(0, 'a'); host.snapshot(1, () => '{"save":2}'); host.answer(1, 'b');
    await until(() => g.started !== null && (g as unknown as { log: unknown[] }).log.length >= 2);
    expect(rememberedServer(code)).toBe(addr);                         // kept with the seat on this device
    g.close();
    // reopened: not on the 私服 any more; the code says where (party.ts enter), as the player types it
    useServer('', '');
    expect(netConfig.server).toBeNull();
    useServer(rememberedServer(code), '測試服');
    const g2 = room('g', 3);
    await g2.join(code);
    await until(() => !!g2.started);
    expect(g2.resume).toEqual({ save: '{"save":2}', seq: 1 });
    expect([...g2.mine]).toEqual([seat]);
    expect(await g2.wait(1)).toBe('b');
    await until(() => host.ownerConnected(seat));
  }, 20000);

  it('the owner\'s refusals are said, never a silent failure: full, password, sent away, banned', async () => {
    const tight = await startServer({ port: 0, max: 2, password: 'open-sesame', log: () => {} });
    const a = `127.0.0.1:${tight.port}`;
    try {
      // wrong or no password
      useServer(a, '小服');
      await expect(room('h', 0).create('2', false)).rejects.toThrow('進服密碼不對');
      useServer(a, '小服', 'open-sesame');
      const host = room('h', 0), g = room('g', 3);
      const code = await host.create('2', false);
      await g.join(code);
      await until(() => host.members.length === 2);
      // full: two sessions on a 私服 of two
      await expect(room('x', 5).join(code)).rejects.toThrow('私服已滿（2/2 人）');
      // sent away by the owner (管理頁 踢人): the room leaves with the reason
      const said: string[] = [];
      g.onStatus = t => said.push(t);
      const auth = { authorization: `Bearer ${tight.cfg.adminToken}`, 'content-type': 'application/json' };
      const r = await fetch(`http://${a}/admin/api/kick`, { method: 'POST', headers: auth, body: JSON.stringify({ id: g.myId }) }).then(x => x.json());
      expect(r).toEqual({ ok: true, kicked: 1 });
      await until(() => g.refused);
      expect(said).toContain('你被服主請出了私服');
      // banned: this address refused at once, with why
      expect((await fetch(`http://${a}/admin/api/ban`, { method: 'POST', headers: auth, body: JSON.stringify({ ip: '127.0.0.1' }) }).then(x => x.json())).ok).toBe(true);
      await until(() => host.refused);
      await expect(room('y', 6).join(code)).rejects.toThrow('封禁');
      expect(await fetch(`http://${a}/info`).then(x => x.json())).toMatchObject({ banned: true, needPassword: true });
    } finally { tight.stop(); }
  }, 30000);
});

describe.skipIf(!have)('私服 rich4-server.json', () => {
  it('the admin token is made and written at the first start, the other settings kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rich4-srvcfg-'));
    try {
      const file = join(dir, 'rich4-server.json');
      writeFileSync(file, JSON.stringify({ name: '我的服', port: 0, max: 30, region: '華南' }));
      const { startServer } = createRequire(import.meta.url)(serverFile) as { startServer(o: object): Promise<Srv> };
      const logs: string[] = [];
      const s = await startServer({ config: file, log: (...a: unknown[]) => logs.push(a.join(' ')) });
      const token = s.cfg.adminToken;
      s.stop();
      const saved = JSON.parse(await import('node:fs').then(fs => fs.readFileSync(file, 'utf8')));
      expect(saved).toMatchObject({ name: '我的服', max: 30, region: '華南', adminToken: token });
      expect(token.length).toBeGreaterThanOrEqual(20);
      expect(logs.join('\n')).toContain(token);                         // printed once, for the owner
      const s2 = await startServer({ config: file, log: (...a: unknown[]) => logs.push(a.join(' ')) });
      expect(s2.cfg.adminToken).toBe(token);                            // the same next time, not printed again
      s2.stop();
      expect(logs.filter(l => l.includes(token)).length).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
