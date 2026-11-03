/** 存檔備份 (save-backup.ts): every save in one file and back; anything else is refused with a plain message. */
import { describe, expect, it, vi } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';

const store = new Map<number, unknown>();
vi.mock('./saves', () => ({
  AUTO_SLOT: 0, TYCOON_AUTO_SLOT: 6,
  allIds: () => [0, 1, 2, 3, 4, 5, 6, 1000, 1001],
  readSlot: async (id: number) => store.get(id),
  writeSlot: async (id: number, s: unknown) => { store.set(id, s); },
}));
vi.mock('./audio', () => ({ audio: { ui() {} } }));

describe('存檔備份', () => {
  it('exports every save and reads them back', async () => {
    const { backupBytes, readBackup } = await import('./save-backup');
    store.clear();
    expect(await backupBytes()).toBeNull();
    store.set(0, { savedAt: 1, game: 'auto' }); store.set(3, { savedAt: 2, game: 'three' }); store.set(1001, { savedAt: 3, game: 'ring' });
    const b = await backupBytes();
    expect(b!.count).toBe(3);
    const f = readBackup(b!.bytes);
    expect(f.saves.map(([id]) => id)).toEqual([0, 3, 1001]);
    expect(f.saves[1][1]).toEqual({ savedAt: 2, game: 'three' });
  });

  it('refuses a file that is not a backup, and drops ids that are no slot', async () => {
    const { readBackup } = await import('./save-backup');
    expect(() => readBackup(strToU8('hello'))).toThrow('不是大富翁4的存檔備份');
    expect(() => readBackup(gzipSync(strToU8(JSON.stringify({ app: 'other', saves: [] }))))).toThrow('不是大富翁4的存檔備份');
    expect(() => readBackup(strToU8(JSON.stringify({ app: 'rich4-saves', v: 1, saves: [[99, {}]] })))).toThrow('沒有存檔');
    const f = readBackup(strToU8(JSON.stringify({ app: 'rich4-saves', v: 1, at: 1, saves: [[2, { a: 1 }], [77, { b: 1 }]] })));
    expect(f.saves).toEqual([[2, { a: 1 }]]);
  });
});
