import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game } from '../core/game';
import { JQ_MAP } from '../core/jiqing';
import { loadGame, loadWorld, saveGame, saveWorld, type SaveData, type WorldSaveData } from '../core/save';
import { attachLedger } from '../core/stats';
import { applyOverlay, TYCOON_MAPS, World, type TycoonOverlay } from '../core/world';
import { cloneData } from './compat';
import { crc32, decodeSave, encodeSave, fromBase64, isPacked, peekSave, previewOf, toBase64 } from './save-codec';

/**
 * Issue #7 (「安卓版經常出現讀取存檔失敗，然後閃退」): the compressed save files of the app (ui/save-codec.ts). Big saves of
 * every kind go through the format and come back the same, and still play on the same; a cut or damaged file is
 * refused (the slot then falls back to its previous copy, saves.test.ts).
 */
const classicFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const remake = (k: string) => fileURLToPath(new URL(`../../../editor/site/assets/remake/${k}.json`, import.meta.url));
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const have = existsSync(classicFile(5)) && existsSync(remake('jiqing')) && TYCOON_MAPS.every(id => existsSync(remake(KEYS[id])));

function playGame(mapId: number, board: Board, days: number, seed: number): Game {
  const g = new Game({ mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 1,
    landLimitIndex: 2, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed }, board);
  attachLedger(g.players);
  const f = g.run();
  for (let r = f.next(); !r.done && g.daysElapsed < days && !g.over; r = f.next());
  return g;
}
const tycoonBoards = () => TYCOON_MAPS.map(id => { const r = JSON.parse(readFileSync(remake(KEYS[id]), 'utf8')) as RawMap & { tycoon?: TycoonOverlay }; return applyOverlay(parseBoard(r), r.tycoon, id); });
function playWorld(days: number): World {
  const w = new World({ mode: 'tycoon', maps: [...TYCOON_MAPS], players: Array.from({ length: 12 }, (_, i) => ({ character: i, human: false })),
    fundIndex: 1, traffic: 1, landLimitIndex: 0, startDate: pack(2026, 10, 16), seed: 3 }, tycoonBoards());
  attachLedger(w.players);
  const f = w.run();
  for (let r = f.next(); !r.done && w.daysElapsed < days && !w.over; r = f.next()) if ('ask' in r.value) throw new Error('computers never ask');
  return w;
}

const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const sizes: string[] = [];
function measured(name: string, s: SaveData | WorldSaveData) {
  const json = new TextEncoder().encode(JSON.stringify(s)).length, file = encodeSave(s as SaveData), b64 = toBase64(file).length;
  sizes.push(`${name}: JSON ${(json / 1024).toFixed(0)} KB → file ${(file.length / 1024).toFixed(0)} KB (bridge base64 ${(b64 / 1024).toFixed(0)} KB, ${(json / file.length).toFixed(1)}×)`);
  return { json, file, b64 };
}

describe.skipIf(!have)('save files (issue #7)', () => {
  let classic: Game, jiqing: Game, world: World;
  beforeAll(() => {
    classic = playGame(5, parseBoard(JSON.parse(readFileSync(classicFile(5), 'utf8')) as RawMap), 380, 77);
    jiqing = playGame(JQ_MAP, parseBoard(JSON.parse(readFileSync(remake('jiqing'), 'utf8')) as RawMap), 320, 5);
    world = playWorld(400);
  }, 120_000);

  it('a normal game, 激情歲月 and a 大富豪 world come back the same and play on the same; the files are 4× smaller or more', () => {
    for (const [name, g] of [['normal (map 5)', classic], ['激情歲月', jiqing]] as const) {
      const s = plain(saveGame(g)), { json, file } = measured(`${name}, day ${g.daysElapsed}`, s);
      expect(isPacked(file)).toBe(true);
      const back = decodeSave(file);
      expect(back).toEqual(s);
      expect(json / file.length).toBeGreaterThan(4);
      // The restored game is the same game.
      const h = loadGame(back);
      expect({ ...saveGame(h), savedAt: 0 }).toEqual({ ...saveGame(g), savedAt: 0 });
    }
    const ws = plain(saveWorld(world)), { json, file } = measured(`大富豪 world, day ${world.daysElapsed}`, ws);
    const back = decodeSave(file) as unknown as WorldSaveData;
    expect(back).toEqual(ws);
    expect(json / file.length).toBeGreaterThan(4);
    const w2 = loadWorld(back, tycoonBoards());
    const fp = (w: World) => { const s = saveWorld(w); s.savedAt = 0; return JSON.stringify(s); };
    expect(fp(w2)).toBe(fp(world));
    console.log(`save sizes (issue #7):\n  ${sizes.join('\n  ')}`);
  });

  it('the slot list reads only the preview: the date, the map, the faces, when', () => {
    const s = saveGame(classic), file = encodeSave(s);
    expect(peekSave(file)).toEqual(previewOf(s));
    expect(peekSave(file).players.map(p => p.character)).toEqual([0, 4, 9, 11]);
    const ws = saveWorld(world), wp = peekSave(encodeSave(ws as unknown as SaveData));
    expect(wp.kind).toBe('tycoon');
    expect(wp.world?.date).toBe(ws.world.date);
    expect(wp.players).toHaveLength(12);
    // A preview is tiny next to the save.
    expect(JSON.stringify(wp).length).toBeLessThan(1500);
  });

  it('a file cut short, with a changed byte, or not a save at all is refused', () => {
    const file = encodeSave(saveGame(classic));
    for (const cut of [file.length - 1, Math.floor(file.length / 2), 30, 10, 0]) {
      expect(() => decodeSave(file.subarray(0, cut))).toThrow();
      expect(() => peekSave(file.subarray(0, cut))).toThrow();
    }
    // One byte changed in the compressed save: the CRC (or the inflater) notices.
    for (const at of [file.length - 5, file.length - 200, Math.floor(file.length * 0.6)]) {
      const bad = file.slice();
      bad[at] ^= 0x5a;
      expect(() => decodeSave(bad)).toThrow();
    }
    expect(() => decodeSave(new TextEncoder().encode(JSON.stringify(saveGame(classic))))).toThrow();
    expect(() => decodeSave(new Uint8Array(0))).toThrow();
  });

  it('base64 over the bridge: the same bytes back, line breaks ignored', () => {
    const file = encodeSave(saveGame(jiqing)), b = toBase64(file);
    expect(fromBase64(b)).toEqual(file);
    expect(fromBase64(b.replace(/(.{76})/g, '$1\n'))).toEqual(file);
    expect(Buffer.from(b, 'base64').equals(Buffer.from(file))).toBe(true);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('ui/compat.ts: its structuredClone copies what the game clones (boards, players) exactly as the real one', () => {
    const b = parseBoard(JSON.parse(readFileSync(classicFile(5), 'utf8')) as RawMap);
    for (const x of [b, ...tycoonBoards(), world.players, classic.board, classic.players, jiqing.board]) {
      const c = cloneData(x);
      expect(c).toStrictEqual(structuredClone(x));
      expect(c).not.toBe(x);
    }
    const shared = { a: 1 }, cyc: Record<string, unknown> = { list: [shared, shared], m: new Map([[1, shared]]), s: new Set([2]), u: undefined };
    cyc.self = cyc;
    const c = cloneData(cyc) as typeof cyc & { list: object[]; self: unknown };
    expect(c.self).toBe(c);
    expect(c.list[0]).toBe(c.list[1]);
    expect(c.list[0]).not.toBe(shared);
    expect('u' in c).toBe(true);
  });
});
