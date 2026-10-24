/**
 * 語言：繁體 / 简体 (remake setting, `localStorage` `rich4.lang`). The game is written in Traditional Chinese; 简体
 * converts what reaches the screen, never the game's data, saves, rules or RNG:
 * - `t()` for text built in code (cached, idempotent: a converted string converts to itself);
 * - while 简体 is on, a MutationObserver on the whole document converts text nodes and the title / placeholder /
 *   aria-label / alt attributes as they are written (before the browser paints), `fillText` / `strokeText` /
 *   `measureText` of 2D canvases convert their text, and so do alert / confirm / prompt.
 * Switching back restores every node and attribute it converted that the game has not rewritten since.
 * Elements marked `data-nozh` keep their text (the 繁體 / 简体 chips show each name in its own script).
 * Pictures with words drawn into them stay as they are. The converter (zh-hans.ts) is a separate chunk, loaded
 * only when 简体 is used.
 */

export type Lang = 'hant' | 'hans';
const KEY = 'rich4.lang';
/** The setting's choices, in the order of `Lang` (each in its own script). */
export const LANGS: readonly { id: Lang; label: string }[] = [{ id: 'hant', label: '繁體' }, { id: 'hans', label: '简体' }];

/** No saved choice: 简体 when the device prefers Simplified Chinese (zh-Hans, zh-CN, zh-SG, zh-MY), else 繁體. */
export function defaultLang(languages: readonly string[]): Lang {
  const zh = languages.find(l => /^zh\b/i.test(l));
  return zh && /^zh[-_](hans|cn|sg|my)\b/i.test(zh) ? 'hans' : 'hant';
}

let current: Lang | null = null;
export function lang(): Lang {
  if (current) return current;
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* no storage */ }
  current = saved === 'hans' || saved === 'hant' ? saved
    : defaultLang(typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language ?? '']);
  return current;
}

type Convert = (s: string) => string;
let convert: Convert | null = null;
let loading: Promise<Convert> | null = null;
const loadConverter = () => (loading ??= import('./zh-hans').then(m => (convert = m.toSimplified)));

const HAN = /[㐀-鿿豈-﫿]/;
const cache = new Map<string, string>();
/** Simplified form of `s` (as is until the converter has loaded; the DOM pass then catches up). */
function simplify(s: string): string {
  if (!convert || !HAN.test(s)) return s;
  let r = cache.get(s);
  if (r === undefined) {
    if (cache.size > 20000) cache.clear();
    r = convert(s);
    cache.set(s, r);
    // What the conversion produces is already Simplified: converting it again must give it back unchanged.
    if (r !== s) cache.set(r, r);
  }
  return r;
}

/** Text for the screen in the chosen script. */
export function t(s: string): string {
  return lang() === 'hans' ? simplify(s) : s;
}

const listeners = new Set<(l: Lang) => void>();
/** Called after the language changed and the page was converted (to redraw what the page cannot convert itself). */
export function onLangChange(f: (l: Lang) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Loads what the chosen language needs and converts the page; await before showing the first screen. */
export async function initLang(): Promise<void> {
  if (lang() !== 'hans') { markLang(); return; }
  await loadConverter().catch(() => undefined);
  apply();
}

/** Saves and applies the choice at once (no reload). */
export async function setLang(l: Lang): Promise<void> {
  try { localStorage.setItem(KEY, l); } catch { /* not kept */ }
  if (l === lang()) return;
  current = l;
  if (l === 'hans') await loadConverter().catch(() => undefined);
  if (current !== l) return; // switched again while loading
  apply();
  for (const f of listeners) f(l);
}

// ---- page conversion (browser only) ----

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'] as const;
/** Original and converted text of each node / attribute this module changed, to restore them for 繁體. */
const textOrig = new WeakMap<Text, [string, string]>();
const attrOrig = new WeakMap<Element, Map<string, [string, string]>>();
let observer: MutationObserver | null = null;
let patched: (() => void) | null = null;

function markLang() {
  if (typeof document !== 'undefined') document.documentElement.lang = lang() === 'hans' ? 'zh-Hans' : 'zh-Hant';
}

function apply() {
  markLang();
  if (typeof document === 'undefined') return;
  if (lang() === 'hans' && convert) {
    if (!observer) {
      observer = new MutationObserver(records => {
        for (const r of records) {
          if (r.type === 'characterData') convertText(r.target as Text);
          else if (r.type === 'attributes') convertAttr(r.target as Element, r.attributeName!);
          else for (const n of r.addedNodes) convertTree(n);
        }
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    }
    convertTree(document.documentElement);
    patched ??= patchOutputs();
  } else {
    observer?.disconnect();
    observer = null;
    patched?.();
    patched = null;
    restoreTree(document.documentElement);
  }
}

const kept = (n: Node) => {
  const e = n.nodeType === Node.ELEMENT_NODE ? n as Element : n.parentElement;
  return !!e?.closest('[data-nozh],script,style');
};

function convertText(n: Text) {
  const s = n.data;
  // What this pass wrote itself is Simplified already (it is not converted again: a text must come to rest, as every
  // change of it comes back here — 激情歲月's renames ping-ponged with this pass into a frozen page, issue #9).
  if (!HAN.test(s) || textOrig.get(n)?.[1] === s || kept(n)) return;
  const r = simplify(s);
  if (r === s) return;
  textOrig.set(n, [s, r]);
  n.data = r;
}

function convertAttr(e: Element, name: string) {
  const s = e.getAttribute(name);
  if (!s || !HAN.test(s) || attrOrig.get(e)?.get(name)?.[1] === s || kept(e)) return;
  const r = simplify(s);
  if (r === s) return;
  let m = attrOrig.get(e);
  if (!m) attrOrig.set(e, (m = new Map()));
  m.set(name, [s, r]);
  e.setAttribute(name, r);
}

function convertTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { convertText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches('[data-nozh],script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n: Node | null = root; n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) convertText(n as Text);
    else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) convertAttr(n as Element, a);
  }
}

function restoreTree(root: Node) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n: Node | null = root; n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const o = textOrig.get(n as Text);
      if (o && (n as Text).data === o[1]) (n as Text).data = o[0];
      textOrig.delete(n as Text);
    } else {
      const m = attrOrig.get(n as Element);
      if (!m) continue;
      for (const [a, [orig, conv]] of m) if ((n as Element).getAttribute(a) === conv) (n as Element).setAttribute(a, orig);
      attrOrig.delete(n as Element);
    }
  }
}

/** Canvas text and the browser's own dialogs; returns the undo. */
function patchOutputs(): () => void {
  const undo: (() => void)[] = [];
  const wrap = <T extends object>(obj: T | undefined, name: keyof T) => {
    if (!obj) return;
    const orig = obj[name] as unknown as (...a: unknown[]) => unknown;
    if (typeof orig !== 'function') return;
    (obj as Record<keyof T, unknown>)[name] = function (this: unknown, text: unknown, ...rest: unknown[]) {
      return orig.call(this ?? globalThis, typeof text === 'string' ? simplify(text) : text, ...rest);
    };
    undo.push(() => { (obj as Record<keyof T, unknown>)[name] = orig; });
  };
  const protos = [globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype];
  for (const p of protos) for (const m of ['fillText', 'strokeText', 'measureText'] as const) wrap(p, m);
  for (const m of ['alert', 'confirm', 'prompt'] as const) wrap(window, m);
  return () => { for (const u of undo) u(); };
}
