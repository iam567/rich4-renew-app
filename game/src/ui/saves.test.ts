import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game } from '../core/game';
import { saveGame, type SaveData } from '../core/save';
import { attachLedger } from '../core/stats';

/**
 * The app's save slots (ui/saves.ts) on a stand-in for the Capacitor file system (issue #7: 「安卓版經常出現讀取存檔失敗，
 * 然後閃退」): compressed files with a preview, the old JSON files still read and converted once, a damaged newest copy
 * replaced by the one before it (and said so), a write that did not land never replacing a good save, and small
 * strings across the bridge.
 */
const files = new Map<string, Buffer>();
const bridge: number[] = [];
let cutWrites = false;
let hang = '';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    async readFile({ path, encoding }: { path: string; encoding?: string }) {
      if (path === hang) return new Promise(() => {});
      const f = files.get(path);
      if (!f) throw new Error('File does not exist.');
      const data = encoding ? f.toString('utf8') : f.toString('base64');
      bridge.push(data.length);
      return { data };
    },
    async writeFile({ path, data, encoding }: { path: string; data: string; encoding?: string }) {
      bridge.push(data.length);
      const b = encoding ? Buffer.from(data, 'utf8') : Buffer.from(data, 'base64');
      files.set(path, cutWrites ? b.subarray(0, b.length >> 1) : b);
      return { uri: path };
    },
    async stat({ path }: { path: string }) {
      const f = files.get(path);
      if (!f) throw new Error('File does not exist.');
      return { size: f.length, type: 'file' };
    },
    async deleteFile({ path }: { path: string }) { if (!files.delete(path)) throw new Error('File does not exist.'); },
    async rename({ from, to }: { from: string; to: string }) {
      const f = files.get(from);
      if (!f) throw new Error('File does not exist.');
      files.delete(to); files.set(to, f); files.delete(from);
    },
  },
}));
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

const mapFile = fileURLToPath(new URL('../../../editor/site/assets/map-2.json', import.meta.url));
type Saves = typeof import('./saves');
let saves: Saves;
let base: SaveData;
/** A different save each time (another day, another time saved). */
const save = (n: number): SaveData => ({ ...JSON.parse(JSON.stringify(base)), savedAt: 1000 + n, game: { ...base.game, date: base.game.date + n } });
const corrupt = (p: string, how: 'cut' | 'flip') => {
  const f = Buffer.from(files.get(p)!);
  if (how === 'flip') { f[f.length - 9] ^= 0xff; files.set(p, f); } else files.set(p, f.subarray(0, f.length - 7));
};

describe.skipIf(!existsSync(mapFile))('save slots in the app (issue #7)', () => {
  beforeAll(() => {
    const g = new Game({ mapId: 2, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 1,
      landLimitIndex: 2, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 77 }, parseBoard(JSON.parse(readFileSync(mapFile, 'utf8')) as RawMap));
    attachLedger(g.players);
    const f = g.run();
    for (let r = f.next(); !r.done && g.daysElapsed < 60 && !g.over; r = f.next());
    base = JSON.parse(JSON.stringify(saveGame(g)));
  });
  beforeEach(async () => {
    files.clear(); store.clear(); bridge.length = 0; cutWrites = false; hang = '';
    vi.useRealTimers();
    vi.resetModules();
    saves = await import('./saves');
  });

  it('writes a compressed file and reads the same save back; the bridge carries far less than the JSON', async () => {
    await saves.writeSlot(2, save(1));
    expect([...files.keys()]).toEqual(['saves/slot-2.r4z']);
    expect((await saves.loadSlot(2))).toEqual({ save: save(1), damaged: false });
    const json = JSON.stringify(save(1)).length;
    expect(Math.max(...bridge)).toBeLessThan(json / 3);
    // A second write keeps the first as the previous copy.
    await saves.writeSlot(2, save(2));
    expect([...files.keys()].sort()).toEqual(['saves/slot-2.prev.r4z', 'saves/slot-2.r4z']);
    expect((await saves.readSlot(2))?.savedAt).toBe(1002);
  });

  it('the slot list reads only the previews', async () => {
    await saves.writeSlot(3, save(3));
    // The compressed save itself damaged: the preview still shows, the load notices (and has no copy to fall back on).
    corrupt('saves/slot-3.r4z', 'flip');
    const p = await saves.previewSlot(3);
    expect(p?.savedAt).toBe(1003);
    expect(p?.players.map(q => q.character)).toEqual([0, 4, 9, 11]);
    expect(await saves.loadSlot(3)).toEqual({ damaged: true });
  });

  it('old JSON saves (0.7.3 and before) still load, are converted once, and the JSON files stay', async () => {
    files.set('saves/slot-4.json', Buffer.from(JSON.stringify(save(4)), 'utf8'));
    files.set('saves/slot-1001.json', Buffer.from(JSON.stringify(save(5)), 'utf8'));
    // An old interrupted write: only its temporary file.
    files.set('saves/slot-5.tmp.json', Buffer.from(JSON.stringify(save(6)), 'utf8'));
    expect((await saves.previewSlot(4))?.savedAt).toBe(1004);
    expect(files.has('saves/slot-4.r4z') && files.has('saves/slot-1001.r4z') && files.has('saves/slot-5.r4z')).toBe(true);
    expect(files.has('saves/slot-4.json') && files.has('saves/slot-1001.json') && files.has('saves/slot-5.tmp.json')).toBe(true);
    expect(store.get('rich4.savesPacked')).toBe('1');
    expect((await saves.loadSlot(4)).save).toEqual(save(4));
    expect((await saves.loadSlot(5)).save).toEqual(save(6));
    expect((await saves.autoSaves(0)).map(a => a.id)).toEqual([1001]);
    // Without a compressed copy (conversion failed) the JSON file is read directly.
    files.delete('saves/slot-4.r4z');
    expect(await saves.loadSlot(4)).toEqual({ save: save(4), damaged: false });
  });

  it('a damaged or cut newest copy: the previous copy is read and the caller is told; nothing readable: told so', async () => {
    await saves.writeSlot(1, save(7));
    await saves.writeSlot(1, save(8));
    corrupt('saves/slot-1.r4z', 'cut');
    expect(await saves.loadSlot(1)).toEqual({ save: save(7), damaged: true });
    expect((await saves.previewSlot(1))?.savedAt).toBe(1007);
    corrupt('saves/slot-1.prev.r4z', 'flip');
    expect(await saves.loadSlot(1)).toEqual({ damaged: true });
    // A damaged old JSON file is not taken for a save either.
    files.set('saves/slot-2.json', Buffer.from('{"version":1,"savedAt":', 'utf8'));
    store.set('rich4.savesPacked', '1');
    expect(await saves.loadSlot(2)).toEqual({ damaged: true });
    expect(await saves.loadSlot(5)).toEqual({ damaged: false });
  });

  it('an interrupted swap (the new file written, not yet renamed) loads the new file', async () => {
    await saves.writeSlot(2, save(9));
    files.set('saves/slot-2.prev.r4z', files.get('saves/slot-2.r4z')!);
    files.delete('saves/slot-2.r4z');
    await saves.writeSlot(3, save(10));
    files.set('saves/slot-2.tmp.r4z', files.get('saves/slot-3.r4z')!);
    expect((await saves.loadSlot(2)).save?.savedAt).toBe(1010);
  });

  it('a write that did not land whole fails and never replaces the save that was there', async () => {
    await saves.writeSlot(2, save(11));
    cutWrites = true;
    await expect(saves.writeSlot(2, save(12))).rejects.toThrow();
    cutWrites = false;
    expect(await saves.loadSlot(2)).toEqual({ save: save(11), damaged: false });
    // The next write goes through.
    await saves.writeSlot(2, save(13));
    expect((await saves.readSlot(2))?.savedAt).toBe(1013);
  });

  it('the automatic ring keeps five turns, newest first, from the previews', async () => {
    for (let k = 0; k < 7; k++) await saves.writeAuto(0, save(20 + k), `t${k}`);
    const ring = await saves.autoSaves(0);
    expect(ring.map(r => r.save.savedAt)).toEqual([1026, 1025, 1024, 1023, 1022]);
    // A new app session finds the oldest by the previews and overwrites it.
    vi.resetModules();
    saves = await import('./saves');
    store.set('rich4.savesPacked', '1');
    await saves.writeAuto(0, save(30), 'n0');
    expect((await saves.autoSaves(0)).map(r => r.save.savedAt)).toEqual([1030, 1026, 1025, 1024, 1023]);
  });

  it('a bridge call that never answers does not hang the slot list or a load', async () => {
    await saves.writeSlot(2, save(14));
    store.set('rich4.savesPacked', '1');
    vi.useFakeTimers();
    hang = 'saves/slot-2.r4z';
    const p = saves.loadSlot(2), q = saves.previewSlot(2);
    await vi.advanceTimersByTimeAsync(16_000);
    // The file never came: the previous copies are tried (there are none), and the load reports nothing to load.
    await expect(p).resolves.toEqual({ damaged: false });
    await expect(q).resolves.toBeUndefined();
  });

  it('notes a load until the board shows: a note left at the next start means the app was closed while loading', async () => {
    expect(saves.interruptedLoad()).toBeNull();
    saves.markLoading(3);
    expect(saves.interruptedLoad()).toBe(3);
    expect(saves.interruptedLoad()).toBeNull();
    saves.markLoading(4);
    saves.markLoading(null);
    expect(saves.interruptedLoad()).toBeNull();
  });
});
