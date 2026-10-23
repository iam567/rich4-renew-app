/**
 * What the game uses that an older Android System WebView or a vendor's own (issue #7: HarmonyOS 4.2 runs the APK on
 * Huawei's WebView) may not have: the app is built for Chrome 87 (vite.config.ts `build.target`; syntax is lowered
 * there), and the few newer functions are filled in here. Imported first by main.ts. Guarded by android-webview.test.ts.
 */

/**
 * structuredClone (Chrome 98) for the data the game clones (boards, players, the finale's figures): arrays, plain
 * objects, Map / Set / Date / typed arrays, shared and circular references, `undefined` kept as structuredClone keeps it.
 */
export function cloneData<T>(v: T, seen = new Map<unknown, unknown>()): T {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v) as T;
  const o = v as unknown;
  if (o instanceof Date) return new Date(o.getTime()) as T;
  if (ArrayBuffer.isView(o)) return (o as unknown as { slice(): unknown }).slice() as T;
  if (o instanceof Map) {
    const m = new Map();
    seen.set(v, m);
    o.forEach((val, k) => m.set(cloneData(k, seen), cloneData(val, seen)));
    return m as T;
  }
  if (o instanceof Set) {
    const s = new Set();
    seen.set(v, s);
    o.forEach(val => s.add(cloneData(val, seen)));
    return s as T;
  }
  if (Array.isArray(o)) {
    const a: unknown[] = new Array(o.length);
    seen.set(v, a);
    for (let i = 0; i < o.length; i++) a[i] = cloneData(o[i], seen);
    return a as T;
  }
  const out: Record<string, unknown> = {};
  seen.set(v, out);
  for (const k of Object.keys(o as object)) out[k] = cloneData((o as Record<string, unknown>)[k], seen);
  return out as T;
}

const g = globalThis as { structuredClone?: <T>(v: T) => T };
if (typeof g.structuredClone !== 'function') g.structuredClone = <T>(v: T): T => cloneData(v);
