/**
 * 私服介紹和 Banner (the user 2026-11-23: the owner uploads a banner in the 管理頁, a tap opens its link — 線下活動的宣傳)
 * and 私服舉報 (to our relay, never the 私服): the server's upload (only png / jpeg / webp by their bytes, ≤ 1.5 MB, the
 * adminToken), /banner, the 介紹 and link in the settings, /info and /news, kept over a restart; the game's parsing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('./net-peer', async orig => ({ ...(await orig<typeof import('./net-peer')>()), officialRelays: async () => ['wss://relay.example/game/relay'] }));
import { openOutside, probe, reportServer, serverTicker } from './private-server';
import { bannerSrc, cleanBanner, cleanSocials, cleanTicker, safeLink, socialUrl, tickerHtml } from './private-server-news';

const serverFile = fileURLToPath(new URL('../../../tools/private-server/server.cjs', import.meta.url));
const have = existsSync(fileURLToPath(new URL('../../desktop/node_modules/ws', import.meta.url)));
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Srv = { port: number; stop(): void; cfg: { adminToken: string } };

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(40, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(40, 3)]);

describe.skipIf(!have)('私服 Banner and 介紹 (server)', () => {
  const { startServer } = createRequire(import.meta.url)(serverFile) as { startServer(o: object): Promise<Srv> };
  const dir = mkdtempSync(join(tmpdir(), 'rich4-banner-'));
  const file = join(dir, 'rich4-server.json');
  let srv: Srv, base = '';
  const auth = () => ({ authorization: `Bearer ${srv.cfg.adminToken}` });
  const up = (buf: Buffer, type = 'image/png', headers: Record<string, string> = auth()) =>
    fetch(`${base}/admin/api/banner`, { method: 'POST', headers: { 'content-type': type, ...headers }, body: new Uint8Array(buf) }).then(async (r): Promise<J> => ({ ...(await r.json() as J), status: r.status }));
  const admin = (what: string, body: object) => fetch(`${base}/admin/api/${what}`, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r): Promise<J> => ({ ...(await r.json() as J), status: r.status }));
  const get = (p: string, h: Record<string, string> = {}) => fetch(`${base}${p}`, { headers: h });

  beforeAll(async () => {
    writeFileSync(file, JSON.stringify({ name: '宣傳服', port: 0, password: 'pw9' }));
    srv = await startServer({ config: file, log: () => {} });
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(() => { srv?.stop(); rmSync(dir, { recursive: true, force: true }); });

  it('none yet: /banner 404, /info says banner null and intro empty', async () => {
    expect((await get('/banner')).status).toBe(404);
    const info = await get('/info').then(r => r.json()) as J;
    expect(info).toMatchObject({ intro: '', banner: null });
    // 人數上限 not set: 500 (the user 2026-11-23: 「改成500吧默認」)
    expect(info.max).toBe(500);
  });

  it('the upload: only with the adminToken, only png / jpeg / webp by their bytes, at most 1.5 MB', async () => {
    expect((await up(PNG, 'image/png', {})).status).toBe(401);
    expect((await up(PNG, 'image/png', { authorization: 'Bearer nope' })).status).toBe(401);
    const fake = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
    expect(await up(fake, 'image/png')).toMatchObject({ status: 415, error: expect.stringContaining('PNG') });
    expect((await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/png')).status).toBe(415);
    expect((await up(Buffer.alloc(0), 'image/png')).status).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(1.5 * 1024 * 1024)]);
    expect(await up(big, 'image/png')).toMatchObject({ status: 413, error: expect.stringContaining('1.5 MB') });
    expect((await get('/banner')).status).toBe(404);
    // the other questions keep their small limit (16 KB: refused, or the connection cut)
    const r = await fetch(`${base}/admin/api/notice`, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', body: 'y'.repeat(20000) }) }).then(x => x.status, () => 'cut');
    expect([400, 'cut']).toContain(r);
  });

  it('served with its type, nosniff, CORS, cached by its hash; public on a 私服 with a password; kept on disk', async () => {
    const r1 = await up(JPG, 'application/octet-stream');
    expect(r1).toMatchObject({ ok: true, banner: { kind: 'jpg', size: JPG.length } });
    const v = r1.banner.v as string;
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    const res = await get(`/banner?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await res.arrayBuffer()).equals(JPG)).toBe(true);
    expect((await get('/banner')).headers.get('cache-control')).toBe('no-cache');
    expect(existsSync(join(dir, 'rich4-banner.jpg'))).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).bannerV).toBe(v);
    // replaced: the new type, the old file gone, a new hash
    const r2 = await up(WEBP, 'image/webp');
    expect(r2.banner.v).not.toBe(v);
    expect((await get('/banner')).headers.get('content-type')).toBe('image/webp');
    expect(existsSync(join(dir, 'rich4-banner.jpg'))).toBe(false);
    expect(existsSync(join(dir, 'rich4-banner.webp'))).toBe(true);
    const info = await get('/info').then(r => r.json()) as J;
    expect(info).toMatchObject({ needPassword: true, banner: { v: r2.banner.v, link: '' } });
    // /news without the password: still closed, but the promotion told
    const news = await get('/news?device=abcdefgh12345678');
    expect(news.status).toBe(403);
    expect(await news.json()).toMatchObject({ error: 'password', banner: { v: r2.banner.v }, intro: '' });
    expect(await get('/news?device=abcdefgh12345678', { 'x-rich4-password': 'pw9' }).then(r => r.json())).toMatchObject({ banner: { v: r2.banner.v }, notices: [] });
  });

  it('the link: http(s) only, ≤ 300; the 介紹: ≤ 300, line breaks kept, control characters out', async () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x.com/a', 'www.x.com', 'https://x.com/a b', 'data:text/html,1', `https://x.com/${'a'.repeat(290)}`, 'https://x.com/"onx=']) {
      expect((await admin('config', { bannerLink: bad })).error, bad).toContain('http');
    }
    expect((await admin('config', { bannerLink: ' https://ex.com/活動?a=1 ', intro: `第一行\r\n第二行\u0007\u0000<b>\n\n\n\n${'長'.repeat(400)}` })).ok).toBe(true);
    const info = await get('/info').then(r => r.json()) as J;
    expect(info.banner.link).toBe('https://ex.com/活動?a=1');
    expect(info.intro.startsWith('第一行\n第二行b\n\n長')).toBe(true);
    expect([...info.intro].length).toBe(300);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved).toMatchObject({ bannerLink: 'https://ex.com/活動?a=1', intro: info.intro });
    expect((await admin('config', { bannerLink: '' })).ok).toBe(true);
    expect((await get('/info').then(r => r.json()) as J).banner.link).toBe('');
    await admin('config', { bannerLink: 'http://ex.com/' });
  });

  it('社交帳號 and 滾動公告: checked, saved, told by /info and /news (also without the password)', async () => {
    expect((await admin('config', { socials: [{ k: 'facebook', v: 'x' }] })).error).toContain('類型');
    expect((await admin('config', { socials: [1, 2, 3, 4, 5].map(i => ({ k: 'qq', v: String(i) })) })).error).toContain('4');
    expect((await admin('config', { ticker: 'x' })).error).toBeTruthy();
    const socials = [{ k: 'x', v: ' @rich4_tw ' }, { k: 'bilibili', v: '12345' }, { k: 'other', v: `線下<店>\n${'很'.repeat(60)}`, label: '粉絲團很長很長的名字' }, { k: 'qq', v: '' }];
    expect((await admin('config', { socials, ticker: { text: `今晚 8 點比賽\n<b>報名</b>${'！'.repeat(200)}`, on: true } })).ok).toBe(true);
    const info = await get('/info').then(r => r.json()) as J;
    expect(info.socials).toEqual([{ k: 'x', v: '@rich4_tw' }, { k: 'bilibili', v: '12345' }, { k: 'other', v: `線下 店 ${'很'.repeat(35)}`, label: '粉絲團很長很長的' }]);
    expect(info.ticker.text.startsWith('今晚 8 點比賽 b 報名 /b ！')).toBe(true);
    expect([...info.ticker.text].length).toBe(120);
    expect(info.ticker.v).toMatch(/^[0-9a-f]{8}$/);
    const closed = await get('/news?device=abcdefgh12345678').then(r => r.json()) as J;
    expect(closed).toMatchObject({ error: 'password', socials: info.socials, ticker: info.ticker });
    expect(closed.notices).toBeUndefined();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ socials: info.socials, ticker: { text: info.ticker.text, on: true } });
    // off: kept in the settings, not shown
    expect((await admin('config', { ticker: { text: info.ticker.text, on: false } })).ok).toBe(true);
    expect((await get('/info').then(r => r.json()) as J).ticker).toBeNull();
    expect((await admin('config', { ticker: { text: '開服活動進行中', on: true } })).ok).toBe(true);
  });

  it('kept over a restart; removed: 404, the file and the link gone', async () => {
    const v = (await get('/info').then(r => r.json()) as J).banner.v;
    srv.stop();
    srv = await startServer({ config: file, log: () => {} });
    base = `http://127.0.0.1:${srv.port}`;
    expect(await get('/info').then(r => r.json())).toMatchObject({ banner: { v, link: 'http://ex.com/' }, ticker: { text: '開服活動進行中' }, socials: [{ k: 'x' }, { k: 'bilibili' }, { k: 'other' }] });
    expect((await admin('banner-del', {})).ok).toBe(true);
    expect((await get('/banner')).status).toBe(404);
    expect(existsSync(join(dir, 'rich4-banner.webp'))).toBe(false);
    expect(await get('/info').then(r => r.json())).toMatchObject({ banner: null });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ bannerV: '', bannerLink: '' });
    expect((await up(PNG)).ok).toBe(true);
    expect((await get('/banner')).headers.get('content-type')).toBe('image/png');
  });
});

describe('私服 Banner, 介紹 and 舉報 (game)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('only http(s) links, a short hash; the image address carries it', () => {
    expect(safeLink('https://a.com/x?y=1')).toBe('https://a.com/x?y=1');
    expect(safeLink(' http://a.com ')).toBe('http://a.com');
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT://x', 'data:,1', '//a.com', 'https://', 'https://a.com/<x>', 'https://a.com/"', `https://a.com/${'x'.repeat(300)}`, 7, null]) expect(safeLink(bad)).toBe('');
    expect(cleanBanner({ v: 'abc123', link: 'javascript:1' })).toEqual({ v: 'abc123', link: '' });
    expect(cleanBanner({ v: '../x' })).toBeNull();
    expect(cleanBanner({ v: '' })).toBeNull();
    expect(cleanBanner(null)).toBeNull();
    expect(bannerSrc('1.2.3.4:8842', { v: 'abc', link: '' })).toBe('http://1.2.3.4:8842/banner?v=abc');
  });

  it('社交帳號: known kinds only, ≤ 4, cut; an address only from a plain handle or a UID', () => {
    const list = cleanSocials([{ k: 'x', v: '@a_b' }, { k: 'evil', v: 'x' }, { k: 'other', v: 'abc', label: '' }, { k: 'toString', v: 'x' }, { k: 'qq', v: '' }, { k: 'wechat', v: 'w'.repeat(50) }, { k: 'tg', v: 't' }, { k: 'discord', v: 'd' }, null]);
    expect(list.map(x => x.k)).toEqual(['x', 'other', 'wechat', 'tg']);
    expect(list[1].label).toBe('其他');
    expect(list[2].v.length).toBe(40);
    expect(cleanSocials({})).toEqual([]);
    expect(socialUrl({ k: 'x', v: '@rich4_tw' })).toBe('https://x.com/rich4_tw');
    expect(socialUrl({ k: 'bilibili', v: 'UID：12345' })).toBe('https://space.bilibili.com/12345');
    expect(socialUrl({ k: 'youtube', v: '@my.channel-1' })).toBe('https://www.youtube.com/@my.channel-1');
    for (const v of ['https://evil.com', 'a/b', 'javascript:alert(1)', '阿梁', 'x'.repeat(16), '../x', 'a b']) expect(socialUrl({ k: 'x', v })).toBe('');
    expect(socialUrl({ k: 'bilibili', v: '阿梁的頻道' })).toBe('');
    expect(socialUrl({ k: 'youtube', v: 'evil.com/x' })).toBe('');
    expect(socialUrl({ k: 'wechat', v: 'abc' })).toBe('');
    expect(socialUrl({ k: 'discord', v: 'abc' })).toBe('');
  });

  it('滾動公告: one line, ≤ 120, escaped where shown', () => {
    expect(cleanTicker(null)).toBeNull();
    expect(cleanTicker({ text: '  ' })).toBeNull();
    const t = cleanTicker({ text: `a\nb<img src=x onerror=alert(1)>"'${'x'.repeat(200)}`, v: 'ab12' })!;
    expect(t.v).toBe('ab12');
    expect([...t.text].length).toBe(120);
    expect(t.text.startsWith('a b<img')).toBe(true);
    const html = tickerHtml(t);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
    expect(html).toMatch(/--dur:\d+s/);
    expect(cleanTicker({ text: 'ok', v: '"><script>' })!.v).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('/info: the 介紹 cut to 300 with its line breaks, the banner cleaned', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rich4: 'server', name: 'S', intro: `a\nb\u0001c${'x'.repeat(400)}`, banner: { v: 'v1', link: 'https://ok.com/' } })));
    const p = await probe('1.2.3.4:8842');
    expect(p!.info.intro.startsWith('a\nbc')).toBe(true);
    expect([...p!.info.intro].length).toBe(300);
    expect(p!.info.banner).toEqual({ v: 'v1', link: 'https://ok.com/' });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rich4: 'server', name: 'old one' })));
    expect((await probe('1.2.3.4:8842'))!.info).toMatchObject({ intro: '', banner: null, socials: [], ticker: null });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rich4: 'server', name: 'S', socials: [{ k: 'x', v: 'a' }], ticker: { text: '比賽', v: 'ab' } })));
    expect((await probe('1.2.3.4:8842'))!.info).toMatchObject({ socials: [{ k: 'x', v: 'a', label: 'X' }], ticker: { text: '比賽', v: 'ab' } });
    expect(await serverTicker('1.2.3.4:8842')).toEqual({ text: '比賽', v: 'ab' });
    vi.stubGlobal('fetch', async () => { throw new Error('down'); });
    expect(await serverTicker('1.2.3.4:8842')).toBeUndefined();
  });

  it('a link opens outside the game (window.open), never a bad one', () => {
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    openOutside('javascript:alert(1)');
    expect(open).not.toHaveBeenCalled();
    openOutside('https://ok.com/');
    expect(open).toHaveBeenCalledWith('https://ok.com/', '_blank');
  });

  it('舉報: to our relay with the 私服, the reason, the note and this device; its answers in words', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    const calls: { url: string; init?: RequestInit }[] = [];
    let reply: J = { ok: true };
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(reply)); });
    expect(await reportServer('1.2.3.4:8842', '壞服', 'gambling', `賭錢\n${'x'.repeat(300)}`)).toBe('');
    expect(calls[0].url).toBe('https://relay.example/game/relay/servers/report');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ addr: '1.2.3.4:8842', name: '壞服', reason: 'gambling' });
    expect([...body.text].length).toBe(200);
    expect(body.dev).toMatch(/^[A-Za-z0-9]{8,40}$/);
    reply = { error: 'dup' };
    expect(await reportServer('1.2.3.4:8842', '壞服', 'porn', '')).toBe('你今天已經舉報過這個私服了');
    reply = { error: 'busy' };
    expect(await reportServer('1.2.3.4:8842', '壞服', 'fraud', '')).toBe('操作太頻繁，等一下再試');
    reply = { error: 'bad' };
    expect(await reportServer('1.2.3.4:8842', '壞服', 'other', '')).toBe('沒有送出，等一下再試');
    expect(await reportServer('1.2.3.4:8842', '壞服', 'nope' as 'other', '')).toBe('要選一個舉報原因');
    expect(calls.length).toBe(4);
    vi.stubGlobal('fetch', async () => { throw new Error('down'); });
    expect(await reportServer('1.2.3.4:8842', '壞服', 'political', '')).toBe('沒有送出，等一下再試');
  });
});
