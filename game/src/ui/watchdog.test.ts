import { describe, expect, it, vi } from 'vitest';
import { guard, outstanding, timeout, watch, Watchdog } from './watchdog';

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

  it('guard() gives up on a promise that never settles: logs, rescues once, settles with the fallback', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rescue = vi.fn();
    let limit = 1000;
    const g = guard('screen wheel', new Promise<number>(() => {}), () => limit, -1, rescue);
    let got: number | undefined;
    void g.then(v => { got = v; });
    await vi.advanceTimersByTimeAsync(600);
    expect(got).toBeUndefined();
    limit = 3000; // a human took over the screen: more time
    await vi.advanceTimersByTimeAsync(1500);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1200);
    expect(got).toBe(-1);
    expect(rescue).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some(c => String(c[0]).includes('gave up waiting for "screen wheel"'))).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(rescue).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('guard() passes a settled value or an error through and never rescues then', async () => {
    const rescue = vi.fn();
    expect(await guard('fx', Promise.resolve(7), () => 1000, -1, rescue)).toBe(7);
    await expect(guard('fx', Promise.reject(new Error('boom')), () => 1000, -1, rescue)).rejects.toThrow('boom');
    expect(rescue).not.toHaveBeenCalled();
  });

  it('guard() does not count time the page spends hidden (animations stand still then)', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = globalThis as unknown as { document?: { hidden: boolean } };
    const had = doc.document;
    doc.document = { hidden: true };
    let got: number | undefined;
    void guard('fx', new Promise<number>(() => {}), () => 1000, -1).then(v => { got = v; });
    await vi.advanceTimersByTimeAsync(10000);
    expect(got).toBeUndefined();
    doc.document.hidden = false;
    await vi.advanceTimersByTimeAsync(1300);
    expect(got).toBe(-1);
    doc.document = had;
    warn.mockRestore();
    vi.useRealTimers();
  });
});
