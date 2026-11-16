/**
 * 通關次數 (the user 2026-11-08): how many times this device's player won each map alone, kept on the device — the map
 * cards show 「已通關 N」 on the new-game screen and the next game's map picker, not only for the run in progress. On a
 * phone a file next to the saves keeps it too (the web view's storage can be cleared by the system); the two are
 * merged at each start, the larger count of each map kept.
 */
import { Capacitor } from '@capacitor/core';

const KEY = 'rich4.clears';
const FILE = 'saves/clears.json';
const fs = () => import('@capacitor/filesystem');

function all(): Record<string, number> {
  try { const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>; return Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isInteger(v) && (v as number) > 0)) as Record<string, number>; } catch { return {}; }
}

/** How many times map `id` was cleared. */
export const clears = (id: number): number => all()[id] ?? 0;

function keep(o: Record<string, number>) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* not kept */ }
  if (!Capacitor.isNativePlatform()) return;
  void fs().then(({ Filesystem, Directory, Encoding }) => Filesystem.writeFile({ path: FILE, data: JSON.stringify(o), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })).catch(() => {});
}

/** One more clear of map `id`. */
export function addClear(id: number) {
  const o = all();
  o[id] = (o[id] ?? 0) + 1;
  keep(o);
}

/** At the start: the phone's file and the web view's storage merged (the larger count of each map). */
export async function loadClears(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Filesystem, Directory, Encoding } = await fs();
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    const file = JSON.parse(typeof r.data === 'string' ? r.data : await r.data.text()) as Record<string, unknown>;
    const o = all();
    let changed = false;
    for (const [k, v] of Object.entries(file)) if (Number.isInteger(v) && (v as number) > (o[k] ?? 0)) { o[k] = v as number; changed = true; }
    if (changed) keep(o);
  } catch { /* no file yet */ }
}

/** The stamp on a map card ('' when never cleared). */
export const clearStamp = (id: number, cls = 'rs-stamp'): string => { const n = clears(id); return n ? `<i class="${cls}">已通關 ${n} 次</i>` : ''; };
