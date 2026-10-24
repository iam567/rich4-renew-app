import { afterEach, describe, expect, it, vi } from 'vitest';

// Issue #10 (「iPad 只要觸發命運卡，整個畫面就糊了，只能存檔再進才能恢復」): a ground tile whose decoding failed once was
// never asked for again, so that part of the map stayed on the blurry preview until the save was loaded again.
const decodeImage = vi.fn();
vi.mock('./decode', () => ({ decodeImage: (...a: unknown[]) => decodeImage(...a), releasePic: () => {} }));

const { TiledGround } = await import('./ground');

type Ground = { update(quad: { x: number; y: number }[], density: number): void; stats(): { decoded: number } };
const make = (): Ground => {
  const m = { size: 1152, scale: 3, tile: 576, cols: 2, rows: 2, tiles: [['a.webp', 'b.webp'], ['c.webp', 'd.webp']], preview: 'p.webp' };
  // The constructor is private (TiledGround.load fetches the manifest); the test builds one directly.
  return new (TiledGround as unknown as new (s: string, b: string, m: unknown) => Ground)('test', '/g', m);
};
const view = [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 100 }]; // inside tile 0-0
const flush = () => new Promise(r => setTimeout(r, 0));

afterEach(() => { vi.restoreAllMocks(); decodeImage.mockReset(); });

describe('ground tiles after a failed decode', () => {
  it('are asked for again a moment later (not left on the preview for good)', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    decodeImage.mockRejectedValueOnce(new Error('decode')).mockResolvedValue({ width: 4, height: 4 });
    const g = make();
    g.update(view, 2);
    await flush();
    expect(decodeImage).toHaveBeenCalledTimes(1);
    expect(g.stats().decoded).toBe(0);
    // Not hammered while it keeps failing…
    g.update(view, 2);
    await flush();
    expect(decodeImage).toHaveBeenCalledTimes(1);
    // …but tried again after the wait, and the sharp tile is drawn from then on.
    now += 2500;
    g.update(view, 2);
    await flush();
    expect(decodeImage).toHaveBeenCalledTimes(2);
    expect(g.stats().decoded).toBe(1);
  });
});
