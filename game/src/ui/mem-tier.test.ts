import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Android's memory limits (issues #7 / #13: the web view closed by the system while a game loaded, and late in a long
 * game, on a Huawei Mate 30 and a Redmi K80): the low limits at most whatever the phone reports, one step lower again
 * after the app was closed while loading, and nothing changed for iOS and the desktop.
 */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
const g = globalThis as { Capacitor?: { getPlatform: () => string }; navigator?: unknown };
let platform = 'web';
g.Capacitor = { getPlatform: () => platform };

type Tier = typeof import('./mem-tier');
let t: Tier;
const fresh = async (p: string, deviceMemory?: number) => {
  platform = p;
  vi.stubGlobal('navigator', { deviceMemory, userAgent: p === 'ios' ? 'iPhone' : 'Mozilla', maxTouchPoints: p === 'web' ? 0 : 5, hardwareConcurrency: 8 });
  vi.resetModules();
  t = await import('./mem-tier');
};

describe('memory tiers on Android (issues #7, #13)', () => {
  beforeEach(() => { store.clear(); });

  it('an Android phone gets the low limits even when it says it has 8 GB; a desktop and an 8 GB browser keep theirs', async () => {
    await fresh('android', 8);
    expect(t.isAndroid()).toBe(true);
    expect(t.memTier().key).toBe('low');
    await fresh('web', 8);
    expect(t.memTier().key).toBe('high');
    await fresh('web');
    expect(t.memTier().key).toBe('high');
    // A stored tier above low (v0.7.4 lowered high → mid after a crash) is capped too on Android only.
    store.set('rich4.memTier', 'mid');
    await fresh('android', 8);
    expect(t.memTier().key).toBe('low');
    await fresh('web', 8);
    expect(t.memTier().key).toBe('mid');
  });

  it('closed while loading: the next start is one step lower, down to min (which still counts as low elsewhere)', async () => {
    await fresh('android', 8);
    expect(t.lowerTier()).toBe('min');
    expect(t.memTier().key).toBe('min');
    expect(t.memTier().name).toBe('low');
    expect(t.lowerTier()).toBeNull();
    await fresh('android', 8);
    expect(t.memTier().key).toBe('min');
  });

  it('min holds less of everything than low, and low less than the tiers above', () => {
    const k: (keyof Tier['TIERS']['low'])[] = ['groundBytes', 'previewMax', 'tilePx', 'spritePx', 'spriteBytes', 'clipBytes', 'clipCount', 'musicBytes'];
    const order = ['min', 'low', 'mid', 'high'] as const;
    for (let i = 1; i < order.length; i++) for (const f of k) expect(t.TIERS[order[i - 1]][f], `${order[i - 1]}.${f}`).toBeLessThanOrEqual(t.TIERS[order[i]][f] as number);
    // The desktop keeps every decoded track as before.
    expect(t.TIERS.high.musicBytes).toBe(Infinity);
  });

  it('the measuring switch gives a desktop browser the Android limits', async () => {
    store.set('rich4.memAndroid', '1');
    await fresh('web', 8);
    expect(t.isAndroid()).toBe(true);
    expect(t.memTier().key).toBe('low');
  });
});
