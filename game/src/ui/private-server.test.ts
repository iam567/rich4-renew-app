/**
 * 私服 (the user 2026-11-18, issue #116): the server players run (tools/private-server), the 私服列表 and the room codes
 * on ours (tools/party-relay/servers.mjs), and the game's address handling (private-server.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crowded, favServers, normAddr, orderServers, toggleFav, whereOf, type PublicServer } from './private-server';
import { checkInbox, cleanNews, eventWhen, fetchNews, inbox, markRead, ownerText, signUp, timeOf } from './private-server-news';

const store = new Map<string, string>();
const fakeStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const serverFile = fileURLToPath(new URL('../../../tools/private-server/server.cjs', import.meta.url));
const wsDir = fileURLToPath(new URL('../../desktop/node_modules/ws', import.meta.url));
const have = existsSync(wsDir);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('私服 addresses', () => {
  it('takes what players type', () => {
    expect(normAddr('1.2.3.4')).toBe('1.2.3.4:8842');
    expect(normAddr(' 1.2.3.4:9000 ')).toBe('1.2.3.4:9000');
    expect(normAddr('http://My.Server.cn:9000/')).toBe('my.server.cn:9000');
    expect(normAddr('1.2.3.4：9000')).toBe('1.2.3.4:9000');
    expect(normAddr('[2001:db8::1]')).toBe('[2001:db8::1]:8842');
    for (const bad of ['', 'abc def', '1.2.3.4:99999', ':8842', 'a:b']) expect(normAddr(bad)).toBe('');
  });
  it('擁堵: nearly full, or slow', () => {
    expect(crowded({ online: 160, max: 200 })).toBe(true);
    expect(crowded({ online: 10, max: 200 }, 80)).toBe(false);
    expect(crowded({ online: 10, max: 200 }, 400)).toBe(true);
  });
});

describe('私服列表: the order, 推薦, 收藏 (the user 2026-11-23)', () => {
  beforeEach(() => { store.clear(); vi.stubGlobal('localStorage', fakeStorage); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const srv = (addr: string, o: Partial<PublicServer> = {}): PublicServer => ({ addr, name: addr, area: '香港', online: 1, rooms: 0, max: 100, ...o });

  it('fastest first, unmeasured next, 斷線 last; 推薦 the fastest one not full and not 擁堵', () => {
    const list = [srv('a:1'), srv('b:1'), srv('c:1', { down: true }), srv('d:1'), srv('e:1', { online: 100 }), srv('f:1')];
    const pings = new Map<string, number | null>([['a:1', 120], ['b:1', 40], ['c:1', 30], ['d:1', null], ['e:1', 10]]);
    const { order, best } = orderServers(list, pings, []);
    expect(order.map(x => x.addr)).toEqual(['e:1', 'b:1', 'a:1', 'f:1', 'c:1', 'd:1']);
    expect(best).toBe('b:1');                                  // e is full, c is down even with a ping
    // only crowded ones (slow): the fastest of them still
    expect(orderServers([srv('x:1'), srv('y:1')], new Map([['x:1', 500], ['y:1', 400]]), []).best).toBe('y:1');
    // nearly full is 擁堵: one that is not goes first even when slower
    expect(orderServers([srv('x:1', { online: 90 }), srv('y:1')], new Map([['x:1', 20], ['y:1', 90]]), []).best).toBe('y:1');
    // before any ping: the list's own order (斷線 still last), no 推薦
    expect(orderServers(list, undefined, [])).toEqual({ order: [0, 1, 3, 4, 5, 2].map(i => list[i]), best: '' });
  });

  it('收藏 first (by ping among them), kept on the device; 推薦 is over all', () => {
    expect(toggleFav('a:1', '阿A')).toBe(true);
    expect(toggleFav('d:1', '阿D')).toBe(true);
    expect(favServers()).toEqual([{ addr: 'd:1', name: '阿D' }, { addr: 'a:1', name: '阿A' }]);
    const list = [srv('a:1'), srv('b:1'), srv('d:1')];
    const pings = new Map<string, number | null>([['a:1', 200], ['b:1', 40], ['d:1', 80]]);
    const { order, best } = orderServers(list, pings, favServers().map(f => f.addr));
    expect(order.map(x => x.addr)).toEqual(['d:1', 'a:1', 'b:1']);
    expect(best).toBe('b:1');
    expect(toggleFav('a:1', '')).toBe(false);
    expect(favServers().map(f => f.addr)).toEqual(['d:1']);
    store.set('rich4.party.srvfav', '{bad');
    expect(favServers()).toEqual([]);
  });

  it('地區: the owner\'s word first, else the area of its IP', () => {
    expect(whereOf({ area: '廣東', region: '華南' })).toBe('華南');
    expect(whereOf({ area: '廣東' })).toBe('廣東');
    expect(whereOf({})).toBe('');
  });
});

describe('私服的公告、活動、私信 (the user 2026-11-23)', () => {
  const now = new Date(2026, 11, 3, 12).getTime();
  const day = 86400_000;
  let calls: { url: string; init?: RequestInit }[] = [];
  let reply: (url: string, init?: RequestInit) => unknown = () => ({});
  beforeEach(() => {
    store.clear(); calls = [];
    vi.stubGlobal('localStorage', fakeStorage);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { calls.push({ url, init }); return { text: async () => JSON.stringify(reply(url, init)) }; });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('owner text is cut and cleaned; times in ms, s or a date', () => {
    expect(ownerText('a\u0000b\nc', 10)).toBe('a b c');
    expect(ownerText('a\r\nb\n\n\n\nc', 20, true)).toBe('a\nb\n\nc');
    expect(ownerText('x'.repeat(50), 8)).toBe('x'.repeat(8));
    expect(timeOf(1_700_000_000)).toBe(1_700_000_000_000);
    expect(timeOf(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(timeOf('2026-12-01T00:00:00Z')).toBe(Date.UTC(2026, 11, 1));
    expect(timeOf('soon')).toBe(0);
  });

  it('event dates: 12/1–12/7, 進行中, 已結束', () => {
    const d = (m: number, dd: number, h = 0) => new Date(2026, m - 1, dd, h).getTime();
    expect(eventWhen({ start: d(12, 5), end: d(12, 7, 23) }, now)).toBe('12/5–12/7');
    expect(eventWhen({ start: d(12, 1), end: d(12, 7) }, now)).toBe('進行中 ～12/7');
    expect(eventWhen({ start: d(12, 5, 20), end: d(12, 5, 22) }, now)).toBe('12/5 20:00');
    expect(eventWhen({ start: d(11, 1), end: d(11, 2) }, now)).toBe('已結束 11/2');
  });

  it('/news: pinned then newest; coming events by start, ended last; mine; unsafe text stays text', () => {
    const n = cleanNews({
      notices: [{ id: 1, title: '舊', time: now - 3 * day }, { id: 2, title: '新', time: now - day }, { id: 3, title: '置頂', time: now - 9 * day, pinned: true }, { id: 4 }],
      events: [
        { id: 'e1', title: '結束了', start: now - 9 * day, end: now - 8 * day },
        { id: 'e2', title: '下週', start: now + 7 * day, end: now + 8 * day, prize: '第一名 ¥500', max: 16, count: 3 },
        { id: 'e3', title: '<b>明天</b>', start: now + day, end: now + 2 * day, signups: ['a', 'b'], closed: true, msg: '報名截止' },
        { title: '沒有 id' },
      ],
      mine: ['e2', 7],
    }, now);
    expect(n.notices.map(x => x.title)).toEqual(['置頂', '新', '舊']);
    expect(n.events.map(x => x.id)).toEqual(['e3', 'e2', 'e1']);
    expect(n.events[0]).toMatchObject({ title: '<b>明天</b>', count: 2, open: false, msg: '報名截止' });
    expect(n.events[1]).toMatchObject({ prize: '第一名 ¥500', max: 16, count: 3, open: true });
    expect([...n.mine]).toEqual(['e2', '7']);
    expect(cleanNews(null).events).toEqual([]);
  });

  it('asks the 私服 itself with this device, signs up with the player\'s name, the password only when known', async () => {
    reply = () => ({ notices: [], events: [], mine: [] });
    expect(await fetchNews('1.2.3.4:8842')).toMatchObject({ notices: [] });
    expect(calls[0].url).toMatch(/^http:\/\/1\.2\.3\.4:8842\/news\?device=[A-Za-z0-9]{16}$/);
    expect(new Headers(calls[0].init?.headers).has('x-rich4-password')).toBe(false);
    store.set('rich4.party.srvpw', JSON.stringify({ '1.2.3.4:8842': 'pw1' }));
    reply = () => ({ ok: true });
    expect(await signUp('1.2.3.4:8842', 'e2', true, '阿土仔')).toBe('');
    const body = JSON.parse(String(calls[1].init?.body));
    expect(calls[1].url).toBe('http://1.2.3.4:8842/signup');
    expect(body).toMatchObject({ event: 'e2', name: '阿土仔' });
    expect(body.device).toMatch(/^[A-Za-z0-9]{16}$/);
    expect((calls[1].init?.headers as Record<string, string>)['x-rich4-password']).toBe('pw1');
    reply = () => ({ error: 'full' });
    expect(await signUp('1.2.3.4:8842', 'e2', true, 'x')).toBe('名額已滿');
    reply = () => ({ error: 'x', msg: '只限 VIP' });
    expect(await signUp('1.2.3.4:8842', 'e2', false, 'x')).toBe('只限 VIP');
    expect(calls.at(-1)!.url).toBe('http://1.2.3.4:8842/unsignup');
    // a 進服密碼 this device does not have, a ban: said, not shown as an empty 私服
    reply = () => ({ error: 'password', msg: '進服密碼不對' });
    expect(await fetchNews('1.2.3.4:8842')).toMatch(/進服密碼/);
    reply = () => ({ error: 'banned', msg: '你已被這個私服的服主封禁' });
    expect(await fetchNews('1.2.3.4:8842')).toBe('你已被這個私服的服主封禁');
    vi.stubGlobal('fetch', async () => { throw new Error('down'); });
    expect(await fetchNews('1.2.3.4:8842')).toBeNull();
    expect(await signUp('1.2.3.4:8842', 'e2', true, 'x')).toBe('連不到這個私服，等一下再試');
  });

  it('私信: new ones kept with what was read, asked since the newest', async () => {
    const a = '1.2.3.4:8842';
    reply = () => ({ messages: [{ id: 'm1', time: now + 1000, text: '歡迎', from: '阿梁' }, { id: 'm2', time: now + 2000, text: '週末比賽' }] });
    expect((await checkInbox(a)).map(m => m.id)).toEqual(['m2', 'm1']);
    expect(calls[0].url).toMatch(/\/inbox\?device=\w+&since=0$/);
    expect(inbox(a)).toMatchObject({ unread: 2 });
    expect(inbox(a).msgs[1]).toMatchObject({ from: '阿梁' });
    expect(inbox(a).msgs[0]).toMatchObject({ from: '服主' });
    markRead(a);
    expect(inbox(a).unread).toBe(0);
    reply = () => ({ messages: [{ id: 'm2', time: now + 2000, text: '週末比賽' }, { id: 'm3', time: now + 3000, text: '新的' }] });
    expect((await checkInbox(a)).map(m => m.id)).toEqual(['m3']);
    expect(calls[1].url).toBe(`http://${a}/inbox?device=${calls[0].url.split('device=')[1].split('&')[0]}&since=${now + 2000}`);
    expect(inbox(a)).toMatchObject({ unread: 1 });
    reply = () => ({ nope: 1 });
    expect(await checkInbox(a)).toEqual([]);
  });
});

describe.skipIf(!have)('私服 and the 私服列表', () => {
  type Srv = { port: number; stop(): void };
  let pub: Srv, hidden: Srv;
  const dir = mkdtempSync(join(tmpdir(), 'rich4-srv-'));
  const req = createRequire(import.meta.url);
  beforeAll(async () => {
    const { startServer } = req(serverFile) as { startServer(o: object): Promise<Srv> };
    pub = await startServer({ port: 0, name: '測試服', max: 50, listed: true, region: '華南地區的機房很快', log: () => {} });
    hidden = await startServer({ port: 0, name: '不公開', max: 50, listed: false, log: () => {} });
  });
  afterAll(() => { pub?.stop(); hidden?.stop(); rmSync(dir, { recursive: true, force: true }); });

  it('answers who it is, never serves the game', async () => {
    const info = await (await fetch(`http://127.0.0.1:${pub.port}/info`)).json();
    expect(info).toMatchObject({ rich4: 'server', name: '測試服', max: 50, listed: true, rooms: 0 });
    expect((await (await fetch(`http://127.0.0.1:${hidden.port}/info`)).json()).region).toBeUndefined();
    expect(await (await fetch(`http://127.0.0.1:${pub.port}/?room=123456`)).text()).toContain('私服房間');
  });

  it('lists a public one under the player\'s name, refuses an unlisted one, codes find their 私服', async () => {
    const servPath = fileURLToPath(new URL('../../../tools/party-relay/servers.mjs', import.meta.url));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { openServers, cleanAddr } = await import(/* @vite-ignore */ servPath) as { openServers(o: object): any; cleanAddr(v: string): string };
    // ours never lists local or private addresses (except a developer's local test)
    expect(cleanAddr('192.168.1.5:8842')).toBe('');
    expect(cleanAddr('localhost:8842')).toBe('');
    expect(cleanAddr('8.8.8.8:8842')).toBe('8.8.8.8:8842');
    let ourRooms = new Set<string>();
    const s = openServers({ dataDir: dir, local: true, ours: (c: string) => ourRooms.has(c) });
    try {
      const a = `127.0.0.1:${pub.port}`, b = `127.0.0.1:${hidden.port}`;
      expect(await s.add(a, 'device00001', '阿梁的服')).toMatchObject({ ok: true, server: { name: '阿梁的服', mine: true, region: '華南地區的機房很' } });
      expect(await s.add(b, 'device00001', 'x')).toEqual({ error: 'unlisted' });
      expect(await s.add(a, 'device00002', '搶')).toEqual({ error: 'taken' });
      expect(s.listed('device00002')).toEqual([expect.objectContaining({ addr: a, name: '阿梁的服' })]);
      expect(s.listed('device00002')[0].mine).toBeUndefined();
      expect(s.remove(a, 'device00002')).toEqual({ error: 'not-yours' });

      // a room on the unlisted 私服: its code claimed with ours, then found from anywhere
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const WS = req(wsDir) as any;
      const ws = new WS(`ws://${b.replace('127.0.0.1', '127.0.0.1')}`);
      await new Promise(r => ws.on('open', r as () => void));
      ws.send(JSON.stringify({ t: 'hello', id: 'rich4-party-room-123456' }));
      await sleep(100);
      expect(await s.claimRoom('654321', b)).toEqual({ error: 'bad' });     // no such room there
      ourRooms = new Set(['123456']);
      expect(await s.claimRoom('123456', b)).toEqual({ error: 'taken' });   // ours has that code
      ourRooms = new Set();
      expect(await s.claimRoom('123456', b)).toEqual({ ok: true });
      expect(await s.claimRoom('123456', a)).toEqual({ error: 'taken' });   // another 私服 cannot take it
      expect(await s.findRoom('123456')).toEqual({ addr: b });
      ws.close();
      await sleep(200);
      // the session outlives its socket for a minute: bye ends it
      const ws2 = new WS(`ws://${b}`);
      await new Promise(r => ws2.on('open', r as () => void));
      ws2.send(JSON.stringify({ t: 'hello', id: 'rich4-party-room-123456' }));
      await sleep(100);
      ws2.send(JSON.stringify({ t: 'bye' }));
      await sleep(200);
      expect(await s.findRoom('123456')).toEqual({});                       // closed: forgotten
      expect(s.remove(a, 'device00001')).toEqual({ ok: true });
    } finally { s.stop(); }
  });
});
