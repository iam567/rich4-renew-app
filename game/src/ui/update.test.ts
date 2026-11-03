/** 在線更新 (update.ts): only the changed files are fetched, each checked by its hash; the new version is named last. */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const files = new Map<string, Uint8Array>();
const desk = {
  read: async (n: string) => files.get(n) ?? null,
  write: async (n: string, d: Uint8Array | string) => { files.set(n, typeof d === 'string' ? new TextEncoder().encode(d) : d); return true; },
  remove: async (n: string) => { for (const k of [...files.keys()]) if (k === n || k.startsWith(`${n}/`)) files.delete(k); return true; },
  rename: async (a: string, b: string) => { for (const [k, v] of [...files]) if (k.startsWith(`${a}/`)) { files.delete(k); files.set(b + k.slice(a.length), v); } return true; },
  list: async () => [...new Set([...files.keys()].map(k => k.split('/')[0]))],
};
(globalThis as { rich4Desktop?: unknown }).rich4Desktop = { update: desk };

const RUN = __APP_VERSION__;
const bump = (v: string) => v.split('.').map((x, i, a) => (i === a.length - 1 ? String(Number(x) + 1) : x)).join('.');
const NEXT = bump(RUN);
const own = { version: RUN, shell: 1, files: { 'index.html': [h('old index'), 9], 'assets/a.webp': [h('pic'), 3], 'assets/b.webp': [h('same'), 4] } };
const next = { version: NEXT, shell: 1, files: { 'index.html': [h('new index'), 9], 'assets/a.webp': [h('pic2'), 4], 'assets/b.webp': [h('same'), 4], 'assets/c.webp': [h('added'), 5] } };
const served: Record<string, string> = { [h('new index')]: 'new index', [h('pic2')]: 'pic2', [h('added')]: 'added' };
const asked: string[] = [];

function serve(latest: object, opts: { broken?: string } = {}) {
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(String(url).replace(/^.*\/u\//, ''));
    const u = String(url);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (u.endsWith('/update-base.json')) return json(own);
    if (u.endsWith('/latest.json')) return json(latest);
    if (u.endsWith(`/m/${NEXT}.json`)) return json(next);
    const f = u.match(/\/f\/([0-9a-f]{32})$/)?.[1];
    if (f && served[f] !== undefined) return new Response(f === opts.broken ? 'garbage' : served[f], { status: 200 });
    return new Response('', { status: 404 });
  });
}

describe('在線更新', () => {
  afterEach(() => { files.clear(); asked.length = 0; vi.unstubAllGlobals(); vi.resetModules(); });

  it('versions compare by number', async () => {
    const { newer } = await import('./update');
    expect(newer('0.9.10', '0.9.9')).toBe(true);
    expect(newer('0.9.2.1', '0.9.2')).toBe(true);
    expect(newer('0.9.2', '0.9.2')).toBe(false);
    expect(newer('0.8.9', '0.9.0')).toBe(false);
  });

  it('a newer version: ready; the same one: nothing; one needing a newer installer: the installer', async () => {
    serve({ version: NEXT, shell: 1 });
    expect(await (await import('./update')).checkUpdate()).toEqual({ kind: 'ready', version: NEXT });
    vi.resetModules(); serve({ version: RUN, shell: 1 });
    expect(await (await import('./update')).checkUpdate()).toEqual({ kind: 'none' });
    vi.resetModules(); serve({ version: NEXT, shell: 2 });
    expect(await (await import('./update')).checkUpdate()).toEqual({ kind: 'installer', version: NEXT });
    vi.resetModules(); serve({ version: NEXT, shell: 1 }); files.set('bad', new TextEncoder().encode(NEXT));
    expect(await (await import('./update')).checkUpdate()).toEqual({ kind: 'installer', version: NEXT });
  });

  it('downloads only what changed, checks each file, names the version last', async () => {
    serve({ version: NEXT, shell: 1 });
    const { applyUpdate } = await import('./update');
    const seen: [number, number][] = [];
    await applyUpdate(NEXT, (d, t) => seen.push([d, t]));
    const got = asked.filter(a => a.startsWith('f/')).sort();
    expect(got).toEqual([h('added'), h('new index'), h('pic2')].map(x => `f/${x}`).sort()); // not the unchanged b.webp
    const dec = (n: string) => new TextDecoder().decode(files.get(n));
    expect(dec(`v${NEXT}/index.html`)).toBe('new index');
    expect(dec(`v${NEXT}/assets/c.webp`)).toBe('added');
    expect(files.has(`v${NEXT}/assets/b.webp`)).toBe(false);
    expect(dec('current')).toBe(NEXT);
    expect(seen.at(-1)).toEqual([18, 18]);
  });

  it('a file that does not match its hash: nothing switched, the old version stays', async () => {
    serve({ version: NEXT, shell: 1 }, { broken: h('pic2') });
    const { applyUpdate } = await import('./update');
    await expect(applyUpdate(NEXT, () => {})).rejects.toThrow(/網路/);
    expect(files.has('current')).toBe(false);
  });

  it('the title confirms the start and drops other versions\' folders', async () => {
    serve({ version: RUN, shell: 1 });
    files.set('boot', new TextEncoder().encode(`${NEXT} 1`));
    files.set('v0.1.0/index.html', new Uint8Array([1]));
    files.set('v9.9.9.part/index.html', new Uint8Array([1]));
    const { confirmStart } = await import('./update');
    await confirmStart();
    expect([...files.keys()]).toEqual([]);
  });
});
