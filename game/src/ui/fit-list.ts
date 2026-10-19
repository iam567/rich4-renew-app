/**
 * Lists of players (大富豪模式's twelve) on one page, never cut off and never scrolled: a box tries its layouts
 * (class lists, roomiest first) until one fits; when even the most compact one does not, its rows go on pages with
 * a 「‹ 1 / 2 ›」 pager under them. Presentation only.
 */
import './fit-list.css';

export interface Pages {
  /** Number of pages (1: everything shows, no pager). */
  readonly count: number;
  readonly page: number;
  go(page: number): void;
  /** The next page; false on the last one. */
  next(): boolean;
}

/**
 * Tries each layout of `layouts` in turn (`apply(layout)` puts it on) until `fits()`; returns the one that fits, or
 * null when none does (the last one stays on).
 */
export function pickLayout<T>(layouts: T[], apply: (l: T) => void, fits: () => boolean): T | null {
  for (const l of layouts) {
    apply(l);
    if (fits()) return l;
  }
  return null;
}

/**
 * Puts `rows` on pages so that `fits()` holds with the pager shown (inserted after `after`): as many rows per page
 * as fit, at least one. `changed` is told the page shown. Taps on the pager do not reach the box under it.
 */
export function pageRows(rows: HTMLElement[], after: HTMLElement, fits: () => boolean, changed?: (page: number) => void): Pages {
  const pager = document.createElement('div');
  pager.className = 'fl-pager';
  pager.innerHTML = '<button type="button" class="fl-prev" aria-label="上一頁">‹</button><span class="fl-num"></span><button type="button" class="fl-next" aria-label="下一頁">›</button>';
  after.after(pager);
  const show = (from: number, to: number) => rows.forEach((r, i) => r.classList.toggle('fl-off', i < from || i >= to));
  // The fullest page that fits (the pager is there while measuring).
  let per = rows.length - 1;
  pager.querySelector('.fl-num')!.textContent = '1 / 2';
  for (; per > 1; per--) {
    show(0, per);
    if (fits()) break;
  }
  per = Math.max(1, per);
  // Evenly filled pages (12 → 6 + 6, not 10 + 2).
  const count = Math.ceil(rows.length / per);
  per = Math.ceil(rows.length / count);
  let page = 0;
  const num = pager.querySelector<HTMLElement>('.fl-num')!;
  const prev = pager.querySelector<HTMLButtonElement>('.fl-prev')!, nextBtn = pager.querySelector<HTMLButtonElement>('.fl-next')!;
  const go = (p: number) => {
    page = Math.max(0, Math.min(count - 1, p));
    show(page * per, (page + 1) * per);
    num.textContent = `${page + 1} / ${count}`;
    prev.disabled = page === 0;
    nextBtn.disabled = page === count - 1;
    pager.dataset.page = String(page);
    changed?.(page);
  };
  const stop = (e: Event) => e.stopPropagation();
  for (const t of ['pointerdown', 'pointerup', 'click']) pager.addEventListener(t, stop);
  prev.addEventListener('click', () => go(page - 1));
  nextBtn.addEventListener('click', () => go(page + 1));
  go(0);
  return {
    count,
    get page() { return page; },
    go,
    next: () => { if (page >= count - 1) return false; go(page + 1); return true; },
  };
}

/** One page, no pager. */
export const onePage: Pages = { count: 1, page: 0, go: () => {}, next: () => false };

/** True when none of `els` (one-line labels) is wider than its box and no `texts` element runs over `lines` lines. */
export function rowsReadable(root: ParentNode, oneLine: string, texts = '', lines = 2): boolean {
  for (const e of root.querySelectorAll<HTMLElement>(oneLine)) {
    if (e.offsetParent === null) continue;
    if (e.scrollWidth > e.clientWidth + 1) return false;
  }
  if (texts) {
    for (const e of root.querySelectorAll<HTMLElement>(texts)) {
      if (e.offsetParent === null || !e.textContent) continue;
      const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      if (e.offsetHeight > lh * lines + 2) return false;
    }
  }
  return true;
}
