/**
 * Text that wraps only where a person would break it: at the end of a clause (，。、！？：；…), never in the middle
 * of a word because the box happened to end there (also after a full-width space or ・). Each clause is an inline-block (`.ph`, style.css) kept whole on its
 * line; a clause longer than the line still wraps inside, balanced so no character is left alone. Hard line breaks
 * (\n) stay, a blank line becomes a small gap.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** A clause: everything up to and including its closing punctuation (and closing brackets after it); a thousands comma (345,678) is not one. */
// (no lookbehind: iOS / iPadOS before 16.4 cannot parse it, and the whole game would not start — the user's iPad)
const CLAUSE = /(?:\d,(?=\d)|[^，。、！？：；,!?;…　・])+(?:[，。、！？：；,!?;…　・]+[」』）)]*)?|[，。、！？：；,!?;…　・]+/g;

/**
 * Amounts never break inside: a number with its thousands separators, a 萬/億 and its unit (20,000 元, 3 天, ×2 倍)
 * stays whole on one line (`.nb`, white-space: nowrap) — the user saw 「2」 at a line's end and 「0000」 on the next.
 */
const AMOUNT = /([+\-−×x]?\s?\d[\d,.]*\s*(?:[萬万億亿])?\s*(?:元|點券|点券|顆|颗|枚|天|倍|級|级|%|％|股|張|张|個|个|格|步|回合|號|号)?)/g;
export const keepAmounts = (html: string) => html.replace(AMOUNT, '<span class="nb">$1</span>');

/** One line of text as clauses (`deco` may mark up each clause's escaped text, e.g. numbers in gold). */
export function phraseLine(line: string, deco: (html: string) => string = h => h): string {
  const parts = line.match(CLAUSE) ?? [];
  if (parts.length <= 1) return `<span class="ph">${deco(keepAmounts(esc(line)))}</span>`;
  return parts.map(p => `<span class="ph">${deco(keepAmounts(esc(p)))}</span>`).join('');
}

/** Several lines: \n keeps a hard break, \n\n a small gap. */
export function phrases(text: string, deco?: (html: string) => string): string {
  return text.split(/(\n{2,}|\n)/).map(part => (part.startsWith('\n') ? (part.length > 1 ? '<br><span class="gap"></span>' : '<br>') : phraseLine(part, deco))).join('');
}

/** True when a clause (`.ph`) inside `root` had to wrap inside itself (it is longer than the line). */
export function clauseWraps(root: ParentNode): boolean {
  for (const e of root.querySelectorAll<HTMLElement>('.ph')) {
    if (!e.offsetHeight) continue;
    const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    if (e.offsetHeight > lh * 1.5) return true;
  }
  return false;
}

/**
 * Clause text that should keep each clause on one line: the font of `el` steps down (by 5 % to `minRatio` of its CSS
 * size) until no clause wraps inside itself and, when given, `fits()` holds. Below that the clause wraps, balanced.
 */
export function fitPhrases(el: HTMLElement, minRatio = 0.8, fits: () => boolean = () => true): void {
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize);
  if (!base || !el.offsetWidth) return;
  for (let k = 1; k >= minRatio - 1e-6; k -= 0.05) {
    if (k < 1) el.style.fontSize = `${(base * k).toFixed(1)}px`;
    if (!clauseWraps(el) && fits()) return;
  }
}

/**
 * Titles, names and labels stay on one line: each element matched in `root` gets its font stepped down (to `min` px)
 * until its text fits its box. The elements need a width of their own (block / flex item) and `white-space: nowrap`.
 */
export function shrinkText(root: ParentNode, selector: string, min = 9): void {
  for (const e of root.querySelectorAll<HTMLElement>(selector)) {
    e.style.fontSize = '';
    if (!e.clientWidth) continue;
    let fs = parseFloat(getComputedStyle(e).fontSize);
    while (e.scrollWidth > e.clientWidth + 0.5 && fs > min) { fs -= 0.5; e.style.fontSize = `${fs}px`; }
  }
}
