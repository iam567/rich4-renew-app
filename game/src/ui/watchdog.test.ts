import { describe, expect, it, vi } from 'vitest';
import { outstanding, timeout, watch, Watchdog } from './watchdog';

describe('watchdog', () => {
  it('lists outstanding waits until they settle', async () => {
    let done!: () => void;
    const p = watch('view.panTo', new Promise<void>(r => { done = r; }));
    expect(outstanding().map(w => w.label)).toContain('view.panTo');
    done(); await p;
    expect(outstanding().map(w => w.label)).not.toContain('view.panTo');
  });

  it('timeout() settles with the fallback when the promise never does', async () => {
    vi.useFakeTimers();
    const never = new Promise<number>(() => {});
    const t = timeout(never, 500, -1);
    vi.advanceTimersByTime(600);
    expect(await t).toBe(-1);
    expect(await timeout(Promise.resolve(3), 500, -1)).toBe(3);
    expect(await timeout(Promise.reject(new Error('x')), 500, () => 9)).toBe(9);
    vi.useRealTimers();
  });

  it('reports a stall once (with what is still awaited) and rescues; a human deciding is no stall', () => {
    const rescue = vi.fn(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wd = new Watchdog(1000, () => ({ at: 'test' }), rescue);
    const t0 = performance.now();
    wd.beat('fx:god-detach');
    void watch('view.panTo', new Promise(() => {}));
    wd.check(t0 + 500);
    expect(rescue).not.toHaveBeenCalled();
    wd.check(t0 + 1500);
    expect(rescue).toHaveBeenCalledTimes(1);
    expect(wd.stalls[0].stage).toBe('fx:god-detach');
    expect(wd.stalls[0].waits.map(w => w.label)).toContain('view.panTo');
    wd.check(t0 + 3000);
    expect(rescue).toHaveBeenCalledTimes(1);
    wd.beat('turn');
    wd.setHuman(true);
    wd.check(performance.now() + 60000);
    expect(rescue).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
