/**
 * 地圖庫 (tools/party-relay/maps.mjs): only a map its maker won on goes in, under the maker's name; the server reads the
 * win the way the game writes it (model.ts playHash).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs of the relay, no types
import { openMaps, playHash as serverHash } from '../../../../tools/party-relay/maps.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleared, fromSample, parseMap, playHash, savedForm } from './model';

const sample = fileURLToPath(new URL('../../../../editor/site/assets/remake/maker/sample-laiyang.json', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'rich4-maps-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!existsSync(sample))('地圖庫', () => {
  const m = parseMap(JSON.parse(readFileSync(sample, 'utf8')))!;

  it('the sample 梨園萊陽 and maps made from it are refused (the user 2026-11-13)', () => {
    const lib = openMaps({ dataDir: mkdtempSync(join(tmpdir(), 'rich4-sample-')) });
    const s = parseMap(JSON.parse(readFileSync(sample, 'utf8')))!;
    const won = { ...savedForm(s), cleared: playHash(s) };
    expect(fromSample(s)).toBe(true);
    expect(lib.add(JSON.stringify({ map: won, author: '小梁' }), 'd1')).toEqual({ error: 'sample' });
  });
  m.seed = 7; // (the tests below: a map of the player's own)

  it('the server takes the same fingerprint of a map as the game', () => {
    const sent = JSON.parse(JSON.stringify(savedForm(m)));
    expect(serverHash(sent)).toBe(playHash(m));
  });

  it('a map nobody won is refused; won, it goes in under the maker\'s name; changed, the win no longer counts', () => {
    const lib = openMaps({ dataDir: dir });
    expect(lib.add(JSON.stringify({ map: savedForm(m), author: '小梁', dev: 'd1' }), 'd1')).toEqual({ error: 'unwon' });
    m.cleared = playHash(m);
    expect(cleared(m)).toBe(true);
    const { id } = lib.add(JSON.stringify({ map: savedForm(m), author: '小梁', dev: 'd1' }), 'd1');
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(lib.list().maps).toEqual([expect.objectContaining({ id, name: m.name, author: '小梁', w: 48, h: 48 })]);
    expect(JSON.stringify(lib.list())).not.toContain('d1');           // the device id never goes out
    const got = parseMap(JSON.parse(lib.get(id)))!;
    expect(got.nodes.length).toBe(m.nodes.length);
    expect(Array.from(got.cells)).toEqual(Array.from(m.cells));
    expect(lib.list().maps[0].takes).toBe(1);
    // the same device sends it again: replaced, not a second copy; another device's is its own
    expect(lib.add(JSON.stringify({ map: savedForm(m), author: '小梁' }), 'd1').id).toBe(id);
    // another phone sending the same map (taken from the library, edited or not): refused — it is not theirs
    expect(lib.add(JSON.stringify({ map: savedForm(m), author: '阿明' }), 'd2')).toEqual({ error: 'sample' });
    // a map of their own (another seed): its own entry
    expect(lib.add(JSON.stringify({ map: { ...savedForm(m), seed: 8, cleared: playHash(m) }, author: '阿明' }), 'd2').id).not.toBe(id);
    expect(lib.list().total).toBe(2);
    expect(lib.list(0, 60, '阿明').total).toBe(1);
    m.lots[0].price += 1000;
    expect(cleared(m)).toBe(false);
    expect(lib.add(JSON.stringify({ map: savedForm(m), author: '小梁' }), 'd3')).toEqual({ error: 'unwon' });
  });
  it("the hall: words and contacts kept, plays once a day and flowers once a phone, sorted, the picture", () => {
    const lib = openMaps({ dataDir: mkdtempSync(join(tmpdir(), 'rich4-hall-')) });
    const won = { ...savedForm(m), cleared: playHash(m) };
    const jpg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200, 7)]).toString('base64')}`;
    const a = lib.add(JSON.stringify({ map: { ...won, id: 'a' }, author: '小梁', desc: '第一行\n第二行<b>', note: '來玩吧', contact: [{ k: 'wechat', v: 'liang123' }, { k: 'evil', v: 'x' }, { k: 'ig', v: '@l' }, { k: 'tg', v: 't' }], thumb: jpg }), 'd1').id;
    const b = lib.add(JSON.stringify({ map: { ...won, id: 'b', seed: 99 }, author: '阿明' }), 'd2').id;
    const e = lib.list().maps.find((x: { id: string }) => x.id === a);
    expect(e).toMatchObject({ desc: '第一行\n第二行b', note: '來玩吧', contact: [{ k: 'wechat', v: 'liang123' }, { k: 'ig', v: '@l' }], thumb: true, plays: 0, flowers: 0 });
    expect(lib.thumb(a)?.length).toBe(202);
    expect(lib.thumb(b)).toBeNull();
    expect(lib.play(a, 'p1')).toBe(1);
    expect(lib.play(a, 'p1')).toBe(1);                                 // once a day for a phone
    expect(lib.play(a, 'p2')).toBe(2);
    expect(lib.flower(b, 'p1')).toEqual({ flowers: 1, given: true });
    expect(lib.flower(b, 'p1')).toEqual({ flowers: 1, given: false });  // once for a phone
    expect(lib.flower('zzzzzzzz', 'p1')).toBeNull();
    expect(lib.list(0, 30, '', 'plays').maps.map((x: { id: string }) => x.id)).toEqual([a, b]);
    expect(lib.list(0, 30, '', 'flowers').maps.map((x: { id: string }) => x.id)).toEqual([b, a]);
    expect(lib.list(0, 30, '', 'new').maps[0].id).toBe(b);
    expect(JSON.stringify(lib.list())).not.toMatch(/"fl"|"dev"|p1|d1/);   // who gave flowers, who sent it: never out
    // sent again by its maker: the counts stay
    lib.add(JSON.stringify({ map: { ...won, id: 'a' }, author: '小梁' }), 'd1');
    expect(lib.list(0, 30, '', 'plays').maps[0]).toMatchObject({ id: a, plays: 2, thumb: true });
  });
});

describe.skipIf(!existsSync(sample))('微調 and the win', () => {
  it("a lot's nudge is its look only: the win stands, on the server too; a square moved is a change", () => {
    const m = parseMap(JSON.parse(readFileSync(sample, 'utf8')))!;
    m.seed = 7;
    const h = playHash(m);
    m.lots[0].adj = { u: 5, v: -3, a: 0.2, s: 1.2 };
    expect(playHash(m)).toBe(h);
    expect(serverHash(JSON.parse(JSON.stringify(savedForm(m))))).toBe(h);
    m.switches = { noGods: true, bankHoliday: true };                   // 特殊規則: a change, the same on the server
    expect(playHash(m)).not.toBe(h);
    expect(serverHash(JSON.parse(JSON.stringify(savedForm(m))))).toBe(playHash(m));
    delete m.switches;
    m.nodes[0].cx += 0.3;
    expect(playHash(m)).not.toBe(h);
  });
});
