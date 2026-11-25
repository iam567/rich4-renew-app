/**
 * 私服 服主管理 and its GM system (the user 2026-11-23): the owner's /admin page and its API (adminToken), 進服密碼, 踢人,
 * 封禁 (rich4-bans.json), 關閉房間, 人數上限, the settings saved to rich4-server.json; 公告, 活動/比賽 with 報名, 私信 —
 * the game's public questions (/info, /news, /signup, /unsignup, /inbox) and all of it kept over a restart
 * (rich4-data.json). Raw WebSockets play the phones here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverFile = fileURLToPath(new URL('../../../tools/private-server/server.cjs', import.meta.url));
const wsDir = fileURLToPath(new URL('../../desktop/node_modules/ws', import.meta.url));
const have = existsSync(wsDir);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Srv = { port: number; stop(): void; cfg: { adminToken: string; name: string; max: number; password: string } };
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const answer = async (r: Response): Promise<J> => ({ ...(await r.json() as J), status: r.status });

describe.skipIf(!have)('私服 服主管理 and GM', () => {
  const req = createRequire(import.meta.url);
  const { startServer } = req(serverFile) as { startServer(o: object): Promise<Srv> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WS = req(wsDir) as any;
  const dir = mkdtempSync(join(tmpdir(), 'rich4-gm-'));
  const file = join(dir, 'rich4-server.json');
  let srv: Srv, base = '';
  const H = () => ({ authorization: `Bearer ${srv.cfg.adminToken}`, 'content-type': 'application/json' });
  const admin = (what: string, body?: object, headers: Record<string, string> = H()) =>
    fetch(`${base}/admin/api/${what}`, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers }).then(answer);
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers }).then(answer);
  const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(answer);
  /** A phone's raw hello: what the 私服 answers first, and the socket. */
  const hello = (id: string, extra: object = {}) => new Promise<{ ws: any; first: J; frames: J[] }>((resolve, reject) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const ws = new WS(`ws://127.0.0.1:${srv.port}`);
    const frames: J[] = [];
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', id, ...extra })));
    ws.on('message', (d: Buffer) => { const m = JSON.parse(String(d)); frames.push(m); if (frames.length === 1) resolve({ ws, first: m, frames }); });
    ws.on('error', reject);
  });

  beforeAll(async () => {
    writeFileSync(file, JSON.stringify({ name: '阿梁的服', port: 0, max: 50, region: '華南' }));
    srv = await startServer({ config: file, log: () => {} });
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(() => { srv?.stop(); rmSync(dir, { recursive: true, force: true }); });

  it('the 管理頁: the page for anyone (nothing in it), its API only with the adminToken', async () => {
    const page = await fetch(`${base}/admin`).then(r => r.text());
    expect(page).toContain('私服管理');
    expect(page).not.toContain(srv.cfg.adminToken);
    expect((await admin('state', undefined, {})).status).toBe(401);
    expect((await admin('state', undefined, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await admin('kick', { id: 'x' }, { authorization: 'Bearer nope', 'content-type': 'application/json' })).status).toBe(401);
    const st = await admin('state');
    expect(st.status).toBe(200);
    expect(st.cfg).toMatchObject({ name: '阿梁的服', max: 50, region: '華南', password: '', listed: true });
    // /info never tells the password or the token
    const info = await get('/info');
    expect(info).toMatchObject({ rich4: 'server', name: '阿梁的服', region: '華南', needPassword: false, headline: '', next: null });
    expect(JSON.stringify(info)).not.toContain(srv.cfg.adminToken);
  });

  it('設定: saved to rich4-server.json and in force at once (name, max, region, listed, password)', async () => {
    expect((await admin('config', { max: 1 })).error).toContain('2 到 2000');
    expect((await admin('config', { name: '新名字<b>', max: 3, region: '香港九龍塘區域', listed: false, password: 'pw-123' })).ok).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved).toMatchObject({ name: '新名字b', max: 3, region: '香港九龍塘區域'.slice(0, 8), listed: false, password: 'pw-123', port: 0, adminToken: srv.cfg.adminToken });
    const info = await get('/info');
    expect(info).toMatchObject({ name: '新名字b', max: 3, listed: false, needPassword: true });
    expect(JSON.stringify(info)).not.toContain('pw-123');
  });

  it('進服密碼: refused without it or wrong, in with it; /auth tells; the GM questions need it too (not /info)', async () => {
    expect((await hello('rich4-party-v2-u-nopw')).first).toEqual({ t: 'password' });
    expect((await hello('rich4-party-v2-u-badpw', { pw: 'x' })).first).toEqual({ t: 'password' });
    const ok = await hello('rich4-party-v2-u-okpw', { pw: 'pw-123' });
    expect(ok.first).toMatchObject({ t: 'ok', fresh: true, hold: 120000 });
    ok.ws.send(JSON.stringify({ t: 'bye' })); // (a socket closed without bye is held for its return, and counts)
    expect(await post('/auth', { pw: 'nope' })).toMatchObject({ ok: false, msg: '進服密碼不對' });
    expect(await post('/auth', { pw: 'pw-123' })).toMatchObject({ ok: true });
    expect((await get('/news')).status).toBe(403);
    expect((await get('/news', { 'x-rich4-password': 'pw-123' })).status).toBe(200);
    expect((await get('/inbox?device=abcdefgh01', { 'x-rich4-password': 'bad' })).status).toBe(403);
    expect((await get('/info')).status).toBe(200);
    await admin('config', { password: '' });
    expect((await get('/news')).status).toBe(200);
  });

  it('人數上限: the one past it hears 「full」 with the count; 踢人: told why, kept out a while', async () => {
    await admin('config', { max: 2 });
    const a = await hello('rich4-party-v2-u-aaa', { app: { name: '小明', dev: 'devaaaaaaaa1' } });
    const b = await hello('rich4-party-v2-u-bbb', { app: { name: '小美', dev: 'devbbbbbbbb2' } });
    expect(b.first.t).toBe('ok');
    expect((await hello('rich4-party-v2-u-ccc')).first).toEqual({ t: 'full', online: 2, max: 2 });
    const st = await admin('state');
    expect(st.players.map((p: J) => p.name).sort()).toEqual(['小明', '小美']);
    expect(st.devices.map((d: J) => d.device)).toEqual(expect.arrayContaining(['devaaaaaaaa1', 'devbbbbbbbb2']));
    // 踢人 by device: its sessions told why and ended; back with a new id: still out
    expect(await admin('kick', { dev: 'devaaaaaaaa1' })).toMatchObject({ ok: true, kicked: 1 });
    await sleep(100);
    expect(a.frames).toContainEqual({ t: 'kicked', why: '你被服主請出了私服' });
    expect((await hello('rich4-party-v2-u-aaa2', { app: { dev: 'devaaaaaaaa1' } })).first).toMatchObject({ t: 'kicked' });
    b.ws.send(JSON.stringify({ t: 'bye' }));
    await sleep(100);
    await admin('config', { max: 50 });
  });

  it('封禁 by address: refused at connect and on the API, kept in rich4-bans.json; 解除 lets it in again', async () => {
    const a = await hello('rich4-party-v2-u-ban1', { app: { name: '搗蛋鬼', dev: 'devbanban001' } });
    expect(a.first.t).toBe('ok');
    expect(await admin('ban', { dev: 'devbanban001', note: '洗版' })).toMatchObject({ ok: true, kicked: 1 });
    await sleep(100);
    expect(a.frames).toContainEqual({ t: 'kicked', why: '你已被這個私服的服主封禁' });
    expect(JSON.parse(readFileSync(join(dir, 'rich4-bans.json'), 'utf8'))).toEqual([expect.objectContaining({ ip: '127.0.0.1', note: '洗版', name: '搗蛋鬼' })]);
    expect((await hello('rich4-party-v2-u-ban2')).first).toEqual({ t: 'banned' });
    expect(await get('/info')).toMatchObject({ banned: true });
    expect((await get('/news')).status).toBe(403);
    // (the owner's page still works from that address: it has the token)
    expect((await admin('state')).bans).toHaveLength(1);
    expect(await admin('unban', { ip: '127.0.0.1' })).toMatchObject({ ok: true });
    expect(await admin('unban', { ip: '127.0.0.1' })).toMatchObject({ status: 400 });
    const back = await hello('rich4-party-v2-u-ban3');
    expect(back.first.t).toBe('ok');
    back.ws.send(JSON.stringify({ t: 'bye' })); // (a socket closed without bye is held for its return, and counts)
    expect(JSON.parse(readFileSync(join(dir, 'rich4-bans.json'), 'utf8'))).toEqual([]);
  });

  it('關閉房間: the host and those connected to it sent away, the code not opened again for a while; rooms on the 管理頁', async () => {
    const host = await hello('rich4-party-v2-room-424242', { app: { name: '房主', dev: 'devhost00001' } });
    const g = await hello('rich4-party-v2-u-guest1', { app: { name: '客人', dev: 'devguest0001' } });
    g.ws.send(JSON.stringify({ t: 'conn', cid: 'g1:x:1', to: 'rich4-party-v2-room-424242', s: 1 }));
    // the phones' presence (party-presence.ts on a 私服): the room, its day and map
    await get('/stats?dev=devguest0001&where=game&name=%E5%AE%A2%E4%BA%BA&room=424242&day=12&map=%E5%8F%B0%E7%81%A3');
    await sleep(100);
    const st = await admin('state');
    expect(st.rooms).toEqual([expect.objectContaining({ code: '424242', map: '台灣', day: 12, players: [expect.objectContaining({ name: '房主', host: true }), expect.objectContaining({ name: '客人' })] })]);
    expect(st.count).toMatchObject({ online: 1, game: 1 });
    expect(await admin('close', { code: '999999' })).toMatchObject({ status: 400 });
    expect(await admin('close', { code: '424242' })).toMatchObject({ ok: true });
    await sleep(100);
    expect(host.frames).toContainEqual({ t: 'kicked', why: '服主關閉了這個房間' });
    expect(g.frames).toContainEqual({ t: 'kicked', why: '服主關閉了這個房間' });
    expect((await hello('rich4-party-v2-room-424242')).first).toEqual({ t: 'kicked', why: '這個房間已被服主關閉' });
    expect((await get('/room/424242')).open).toBe(false);
    await get('/stats?dev=devguest0001&where=off');
  });

  it('公告: add, edit, pin, delete; the newest pinned one is /info\'s headline', async () => {
    expect((await admin('notice', { title: '' })).error).toBe('公告要有標題');
    const a = (await admin('notice', { title: '開服啦', body: '歡迎<script>\n來玩' })).notice;
    expect(a.body).toBe('歡迎script\n來玩');
    await sleep(5);
    const b = (await admin('notice', { title: '維護通知', body: '週五 22:00 維護' })).notice;
    expect((await get('/info')).headline).toBe('維護通知');
    await admin('notice', { id: a.id, title: '開服啦！', body: a.body, pinned: true });
    expect((await get('/info')).headline).toBe('開服啦！');
    const news = await get('/news');
    expect(news.notices.map((n: J) => [n.title, n.pinned])).toEqual([['開服啦！', true], ['維護通知', false]]);
    expect(await admin('notice-del', { id: b.id })).toMatchObject({ ok: true });
    expect((await get('/news')).notices).toHaveLength(1);
  });

  it('活動/比賽: 報名 (full, already, closed), 取消, the owner removes one; /info\'s next; /news with mine', async () => {
    const now = Date.now();
    expect((await admin('event', { title: '倒序', start: now + 2000, end: now + 1000 })).error).toContain('結束時間');
    const ev = (await admin('event', { title: '週末大賽', body: '台灣地圖，三局兩勝', prize: '第一名現金獎勵 500 元', start: now + 86400_000, end: now + 2 * 86400_000, max: 2 })).event;
    const over = (await admin('event', { title: '上週賽', start: now - 3 * 86400_000, end: now - 86400_000 })).event;
    expect((await get('/info')).next).toEqual({ title: '週末大賽', start: ev.start, end: ev.end });
    expect(await post('/signup', { event: ev.id, device: 'devplayer001', name: '小明' })).toMatchObject({ ok: true, signed: 1 });
    expect(await post('/signup', { event: ev.id, device: 'devplayer001', name: '小明' })).toMatchObject({ ok: false, error: 'already', msg: '你已經報名了' });
    expect(await post('/signup', { event: ev.id, device: 'devplayer002', name: '小美' })).toMatchObject({ ok: true, signed: 2 });
    expect(await post('/signup', { event: ev.id, device: 'devplayer003', name: '阿土' })).toMatchObject({ ok: false, error: 'full', msg: '名額已滿（2 人）' });
    expect(await post('/signup', { event: over.id, device: 'devplayer003', name: '阿土' })).toMatchObject({ ok: false, error: 'closed' });
    expect(await post('/signup', { event: 'nope', device: 'devplayer003', name: '阿土' })).toMatchObject({ ok: false });
    const mine = await get('/news?device=devplayer001');
    expect(mine.events[0]).toMatchObject({ id: ev.id, title: '週末大賽', prize: '第一名現金獎勵 500 元', signed: 2, max: 2, full: true, open: false, mine: true });
    expect(mine.events[0].signups).toBeUndefined();                    // names and devices: the owner's only
    expect(mine.events[1]).toMatchObject({ id: over.id, open: false, mine: false });
    expect(mine.mine).toEqual([ev.id]);
    expect(await post('/unsignup', { event: ev.id, device: 'devplayer002' })).toMatchObject({ ok: true, signed: 1 });
    const st = await admin('state');
    expect(st.events.find((e: J) => e.id === ev.id).signups.map((s: J) => s.name)).toEqual(['小明']);
    expect(await admin('signup-del', { event: ev.id, device: 'devplayer001' })).toMatchObject({ ok: true });
    expect((await get('/news')).events[0].signed).toBe(0);
    await admin('event', { id: ev.id, title: '週末大賽（改期）', start: ev.start, end: ev.end, max: 0, prize: ev.prize, body: ev.body });
    expect((await get('/news')).events[0]).toMatchObject({ title: '週末大賽（改期）', open: true, full: false });
    expect(await admin('event-del', { id: over.id })).toMatchObject({ ok: true });
  });

  it('私信: to a device seen here, fetched with since; 群發 to everyone online', async () => {
    expect((await admin('dm', { device: 'devplayer001', text: '' })).error).toBe('私信不能是空的');
    expect(await admin('dm', { device: 'devplayer001', text: '恭喜你得到第一名！' })).toMatchObject({ ok: true, n: 1 });
    const box = await get('/inbox?device=devplayer001&since=0');
    expect(box.messages).toEqual([expect.objectContaining({ text: '恭喜你得到第一名！', from: '服主' })]);
    expect((await get(`/inbox?device=devplayer001&since=${box.messages[0].time}`)).messages).toEqual([]);
    expect((await get('/inbox?device=devplayer002&since=0')).messages).toEqual([]);
    // 群發: the phones on now (a session, or their presence)
    const on = await hello('rich4-party-v2-u-online1', { app: { name: '在線甲', dev: 'devonline001' } });
    await get('/stats?dev=devonline002&where=menu&name=x');
    expect(await admin('dm', { all: true, text: '今晚八點比賽開始' })).toMatchObject({ ok: true, n: 2 });
    expect((await get('/inbox?device=devonline001')).messages.map((m: J) => m.text)).toEqual(['今晚八點比賽開始']);
    expect((await get('/inbox?device=devonline002')).messages.map((m: J) => m.text)).toEqual(['今晚八點比賽開始']);
    expect((await admin('state')).dms[0]).toMatchObject({ all: true, n: 2, text: '今晚八點比賽開始' });
    on.ws.send(JSON.stringify({ t: 'bye' })); // (a socket closed without bye is held for its return, and counts)
    await get('/stats?dev=devonline002&where=off');
  });

  it('kept over a restart: 公告, 活動 with their sign-ups, 私信, the devices seen, bans, the settings', async () => {
    await admin('ban', { ip: '10.9.8.7', note: '外掛' });
    const ev = (await admin('event', { title: '重開測試', start: Date.now() + 1e6, end: Date.now() + 2e6 })).event;
    await post('/signup', { event: ev.id, device: 'devplayer009', name: '留下來' });
    await admin('dm', { device: 'devplayer009', text: '還在嗎' });
    await admin('config', { name: '重開的服' });
    const token = srv.cfg.adminToken;
    srv.stop();
    srv = await startServer({ config: file, log: () => {} });
    base = `http://127.0.0.1:${srv.port}`;
    expect(srv.cfg.adminToken).toBe(token);
    const st = await admin('state');
    expect(st.cfg.name).toBe('重開的服');
    expect(st.notices.map((n: J) => n.title)).toEqual(['開服啦！']);
    expect(st.events.find((e: J) => e.id === ev.id).signups).toEqual([expect.objectContaining({ device: 'devplayer009', name: '留下來' })]);
    expect(st.bans.map((b: J) => b.ip)).toEqual(['10.9.8.7']);
    expect(st.devices.map((d: J) => d.device)).toEqual(expect.arrayContaining(['devaaaaaaaa1', 'devplayer009']));
    expect((await get('/inbox?device=devplayer009')).messages.map((m: J) => m.text)).toEqual(['還在嗎']);
  });

  it('wrong admin tokens: ten from one address and it waits (even the right one)', async () => {
    for (let i = 0; i < 10; i++) expect((await admin('state', undefined, { authorization: `Bearer bad${i}` })).status).toBe(401);
    expect((await admin('state')).status).toBe(429);
  });
});
