/**
 * What the game uses that an older Android System WebView or a vendor's own (issue #7: HarmonyOS 4.2 runs the APK on
 * Huawei's WebView; issue #121: a TV's) may not have: the app is built for Chrome 74 (vite.config.ts `build.target`; syntax is lowered
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

/** `.at()` (Chrome 92) on arrays, strings and typed arrays; `replaceAll` (Chrome 85). */
function at(this: ArrayLike<unknown>, i: number) {
  const n = this.length;
  let k = Math.trunc(Number(i)) || 0;
  if (k < 0) k += n;
  return k < 0 || k >= n ? undefined : this[k];
}
const fill = (proto: object, name: string, fn: unknown) => {
  if (proto && !(name in proto)) Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
};
fill(Array.prototype, 'at', at);
fill(String.prototype, 'at', at);
const typed = Object.getPrototypeOf(Int8Array.prototype) as object | null;
if (typed) fill(typed, 'at', at);
fill(String.prototype, 'replaceAll', function (this: string, find: string | RegExp, to: string | ((...a: string[]) => string)) {
  if (find instanceof RegExp) return this.replace(find, to as string);
  return this.split(find).join(typeof to === 'function' ? (to as (s: string) => string)(find) : to);
});

/** `replaceChildren` (Chrome 86): the screens build their content with it. */
if (typeof Element !== 'undefined') for (const P of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
  fill(P, 'replaceChildren', function (this: ParentNode & Node, ...nodes: (Node | string)[]) {
    while (this.lastChild) this.removeChild(this.lastChild);
    this.append(...nodes);
  });
}

/** Canvas `roundRect` (Chrome 99): a radius (or the first of a list) for every corner. */
function roundRect(this: CanvasPath, x: number, y: number, w: number, h: number, radii?: number | DOMPointInit | (number | DOMPointInit)[]) {
  const r0 = Array.isArray(radii) ? radii[0] : radii;
  let r = typeof r0 === 'number' ? r0 : (r0?.x ?? 0);
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  this.moveTo(x + r, y);
  this.arcTo(x + w, y, x + w, y + h, r);
  this.arcTo(x + w, y + h, x, y + h, r);
  this.arcTo(x, y + h, x, y, r);
  this.arcTo(x, y, x + w, y, r);
  this.closePath();
}
const canvasKinds = ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D', 'Path2D'] as const;
for (const k of canvasKinds) {
  const C = (globalThis as unknown as Record<string, { prototype: object } | undefined>)[k];
  if (C) fill(C.prototype, 'roundRect', roundRect);
}

/** `Blob.text()` / `.arrayBuffer()` (Chrome 76): saves read from files. */
const readBlob = (b: Blob, how: 'readAsText' | 'readAsArrayBuffer') => new Promise<string | ArrayBuffer>((ok, no) => {
  const fr = new FileReader();
  fr.onload = () => ok(fr.result as string | ArrayBuffer);
  fr.onerror = () => no(fr.error);
  fr[how](b);
});
if (typeof Blob !== 'undefined') fill(Blob.prototype, 'text', function (this: Blob) { return readBlob(this, 'readAsText'); });
if (typeof Blob !== 'undefined') fill(Blob.prototype, 'arrayBuffer', function (this: Blob) { return readBlob(this, 'readAsArrayBuffer'); });
