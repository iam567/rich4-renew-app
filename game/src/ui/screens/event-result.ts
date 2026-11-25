/**
 * The result box after a news or fate entry (the remake's: the original changes the numbers silently or only
 * names the winner on the board). It says who received or paid how much, which lot was hit and how, who went
 * to hospital or prison, one row each, with the faces. It stays at least 2 s at every game speed (a tap closes it
 * only after that) and longer for more rows at the slow speed; it sits at the bottom of the map so the effect
 * above it stays in view.
 */
import { CHARACTERS, playerName } from '../../core/characters';
import type { EventResult } from '../../core/modules/events';
import type { ScreenContext } from './registry';
import { fitPhrases, phrases, shrinkText } from '../text';
import { onePage, pageRows, pickLayout, rowsReadable } from '../fit-list';
import './event-result.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('zh-Hant')}元`;

/** At least this long on screen, whatever the speed; taps before it are ignored. */
export const RESULT_MIN_MS = 2000;
/**
 * More rows than this: the list shows this many and scrolls (by itself, slowly, and by finger) — the user 2026-11-24 on a
 * 梁山令 flagging eleven lots: 「出東西太多了…做成滑動的…只顯示5個，然後慢慢滑動」.
 */
export const RESULT_SCROLL_ROWS = 5;
/** The auto-scroll: ms per row, and the pause at the top and after a finger. */
const SCROLL_ROW_MS = 1100, SCROLL_HOLD_MS = 1200;

/** The same line more than once (a street's lots each flagged): one row, its count after it, its sums added. */
function mergeLines(lines: BoxData['lines']): BoxData['lines'] {
  const out: (BoxData['lines'][number] & { n?: number })[] = [];
  for (const l of lines) {
    const same = out.find(o => o.p === l.p && o.text === l.text);
    if (same) { same.n = (same.n ?? 1) + 1; if (typeof l.amount === 'number') same.amount = (same.amount ?? 0) + l.amount; } else out.push({ ...l });
  }
  return out.map(o => (o.n ? { ...o, text: `${o.text}（${o.n}處）` } : o));
}

/** Good, bad or neutral news, for the header colour. */
const TONE: Record<string, 'good' | 'bad' | 'info'> = {
  award: 'good', subsidy: 'good', gain: 'good', bonus: 'good', release: 'good', blessed: 'good', 'stock-up': 'good', 'company-up': 'good',
  'price-up': 'good', birthday: 'good', 'stock-resume': 'good', 'stock-sell': 'info', auction: 'info',
};
const tone = (fx: string) => TONE[fx] ?? (fx === 'none' || fx === 'card-info' ? 'info' : fx === 'card-good' ? 'good' : 'bad');

/** What the box shows: a news / fate result, or a card's (screens/card-result.ts: own tag, a headline panel). */
export type BoxData = Pick<EventResult, 'fx' | 'title' | 'head' | 'lines'> & { tag?: string; hero?: string };

/** Short tag for the kind of event, next to the title. */
const TAG: Record<string, string> = {
  award: '表揚', subsidy: '補助', gain: '進帳', bonus: '紅利', tax: '繳稅', fine: '罰款', steal: '挪用', quake: '地震', flood: '山洪',
  rain: '豪雨', jam: '塞車', 'price-up': '漲價', haunt: '鬧鬼', auction: '拍賣', 'bank-stop': '銀行', 'bank-refuse': '銀行', loan: '貸款',
  'stock-halt': '股市', 'stock-resume': '股市', 'stock-up': '股市', 'stock-down': '股市', 'company-up': '企業', 'company-down': '企業',
  'stock-loss': '股票', 'stock-sell': '股票', release: '釋放', extend: '延長', blessed: '保佑', cursed: '作祟', vehicle: '交通', birthday: '生日',
  cards: '點券', alien: '外星人', monster: '怪獸', explosion: '氣爆', typhoon: '颱風', tornado: '龍捲風', prison: '坐牢', hospital: '住院',
  abroad: '出國', abduct: '綁架', demolish: '拆除', expropriate: '徵收',
};

/** What must stay on one line in a row (a name, a sum; the text too in the tightest rows). */
const ONE_LINE = '.er-row, .er-body, .er-amt, .er-box.tight .er-text';

/**
 * Shows the box on the dialog layer (which raises the camera point above it); resolves when it closes. `subject`
 * gives the screen y (CSS px from the top of the map area) of what the box is about: when the camera cannot lift
 * it above the box (the edge of the map), the box moves to the top instead.
 */
export function resultBox(ctx: ScreenContext, r: BoxData, subject?: () => number | null): Promise<void> {
  // More than four players (大富豪模式's twelve): the biggest sums first, and a line every row shares said once
  // above the rows (「繳交地價稅」), which then hold just the face, the name and the sum.
  let lines = mergeLines(r.lines);
  const many = lines.length > 4, scroll = lines.length > RESULT_SCROLL_ROWS;
  if (many && lines.every(l => typeof l.amount === 'number')) lines = [...lines].sort((a, b) => Math.abs(b.amount!) - Math.abs(a.amount!));
  const common = many && lines.every(l => l.p !== undefined && l.text === lines[0].text) ? lines[0].text : '';
  const rows = lines.map(l => {
    const p = l.p !== undefined ? ctx.game.players[l.p] : undefined;
    const ch = p ? CHARACTERS[p.character] : undefined;
    const face = ch ? ctx.bank.art('Data', 2, ch.id) : null;
    const amt = typeof l.amount === 'number' && l.amount !== 0 ? `<span class="er-amt ${l.amount > 0 ? 'plus' : 'minus'}">${money(l.amount)}</span>` : '';
    const text = common ? '' : `<span class="er-text">${esc(l.text)}</span>`;
    return `<div class="er-row${ch ? '' : ' plain'}"${ch ? ` style="--c:#${ch.color.toString(16).padStart(6, '0')}"` : ''}>
      ${ch ? `<span class="er-face">${face ? `<img src="${face.src}" alt="">` : ''}</span>` : '<i class="er-dot"></i>'}
      <span class="er-body">${ch ? `<b class="er-name">${esc(playerName(p))}</b>` : ''}${text}</span>${amt}</div>`;
  }).join('');
  const node = document.createElement('div');
  node.className = `msg er-box ${tone(r.fx)}${many ? ' many' : ''}${common ? ' bare' : ''}${scroll ? ' scroll' : ''}`;
  const tag = r.tag ?? TAG[r.fx];
  node.innerHTML = `<div class="er-head"><span class="er-cat">${esc(r.title)}</span>${tag ? `<span class="er-tag">${esc(tag)}</span>` : ''}</div>
    <div class="er-title">${phrases(r.head)}</div>${r.hero ?? ''}${common ? `<div class="er-common">${esc(common)}</div>` : ''}
    <div class="er-rows">${rows}</div>
    <div class="er-tap">點一下繼續</div>`;
  // Every row on one page: the roomiest layout that fits over the map (so the effect stays in view), else over the
  // whole game screen, in one, two or three columns, smaller rows; when not even that fits (a small phone held
  // sideways), pages with a pager — never cut off, never scrolled.
  const n = lines.length, list = node.querySelector<HTMLElement>('.er-rows')!;
  const room = () => (node.parentElement?.clientHeight ?? 0) - 40;
  const across = (textLines: number, texts = '.er-text') => node.offsetWidth <= (node.parentElement?.clientWidth ?? 0) + 1
    && list.scrollWidth <= list.clientWidth + 1 && rowsReadable(node, ONE_LINE, texts, textLines);
  // Rows on one line each (the name and its text side by side, the user 2026-11-02: no wrapped rows) when any layout
  // allows it; else a text may take two lines.
  const fitsFlat = () => node.offsetHeight <= room() && across(1, '.er-text, .er-body');
  const fits = () => node.offsetHeight <= room() && across(2);
  const cols = (c: string) => (n >= 3 ? [c ? `${c} two` : 'two'] : []);
  const looks = (full: boolean) => [
    ...(n >= 3 && ctx.area.clientWidth >= 540 ? ['two', ''] : ['', ...cols('')]), 'compact', ...cols('compact'),
    ...(full && n >= 5 ? ['tight', 'tight two', 'tight three'] : []),
  ].map(cls => ({ full, cls }));
  const LOOKS = ['two', 'three', 'compact', 'tight'];
  let opened: boolean | null = null;
  const apply = ({ full, cls }: { full: boolean; cls: string }) => {
    if (opened !== full) { ctx.open(node, full); opened = full; }
    node.classList.remove(...LOOKS);
    if (cls) node.classList.add(...cls.split(' '));
    shrinkText(node, '.ls-name, .er-name, .er-cat, .er-tag', 9);
    fitPhrases(node.querySelector<HTMLElement>('.er-title')!, 0.8);
  };
  let pages = onePage;
  let scrollMs = 0;
  if (scroll) {
    // RESULT_SCROLL_ROWS rows in view (fewer when even that does not fit), the rest scrolled to
    const cap = (l: { cls: string }) => (l.cls.includes('tight') ? 2 : 3);
    const view = (k: number) => {
      const rows = [...list.children] as HTMLElement[];
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      list.style.maxHeight = `${rows.slice(0, k).reduce((h, e) => h + e.offsetHeight, 0) + gap * (k - 1) + 2}px`;
    };
    const flat = [...looks(false), ...looks(true)].filter(l => !/two|three/.test(l.cls));
    const ok = (k: number) => flat.find(l => (apply(l), view(k), node.offsetHeight <= room() && across(cap(l))));
    let k = RESULT_SCROLL_ROWS;
    while (k > 2 && !ok(k)) k -= 1;
    if (!ok(k)) { apply(flat[flat.length - 1]); view(k); }
    const rowH = (list.scrollHeight - list.clientHeight) / Math.max(1, n - k);
    scrollMs = SCROLL_HOLD_MS * 2 + (n - k) * SCROLL_ROW_MS * Math.max(1, ctx.scale());
    let last = 0, hold = performance.now() + SCROLL_HOLD_MS, pos = 0;
    const tick = (t: number) => {
      if (!node.isConnected) return;
      if (last && t > hold && list.scrollTop < list.scrollHeight - list.clientHeight - 1) {
        pos = Math.max(pos, list.scrollTop) + ((t - last) * rowH) / SCROLL_ROW_MS;
        list.scrollTop = pos;
      }
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // a finger on the list: it scrolls by hand, the auto-scroll waits and goes on from there
    const handOn = () => { hold = performance.now() + SCROLL_HOLD_MS * 2; pos = list.scrollTop; };
    list.addEventListener('pointerdown', handOn);
    list.addEventListener('scroll', () => { if (performance.now() < hold) pos = list.scrollTop; }, { passive: true });
    list.addEventListener('wheel', handOn, { passive: true });
  } else if (pickLayout([...looks(false), ...looks(true)], apply, fitsFlat) === null && pickLayout([...looks(false), ...looks(true)], apply, fits) === null) {
    // The most compact layout whose rows still read (a long text on up to three lines), its rows on pages.
    const cap = (l: { cls: string }) => (l.cls.includes('tight') ? 2 : 3);
    const last = [...looks(true)].reverse().find(l => (apply(l), across(cap(l)))) ?? looks(true)[0];
    apply(last);
    pages = pageRows([...list.children] as HTMLElement[], list, () => node.offsetHeight <= room() && across(cap(last)));
  }
  const layer = node.parentElement;
  // The whole map takes the closing tap while the box is up (no info bubble, no drag underneath).
  if (layer) layer.style.pointerEvents = 'auto';
  // Longer for more rows (those of the page shown); a page turns by itself, a tap turns it or closes the box.
  const extra = Math.max(0, Math.ceil(r.lines.length / pages.count) - 1);
  const ms = Math.max(RESULT_MIN_MS + 350 * extra, (2600 + 500 * extra) * ctx.scale(), scrollMs);
  return new Promise(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      (layer ?? node).removeEventListener('pointerup', tap);
      if (layer) layer.style.pointerEvents = '';
      ctx.close();
      resolve();
    };
    const turn = () => { if (!pages.next()) return end(); clearTimeout(timer); timer = setTimeout(turn, ms); };
    // (a drag on the scrolling list is not a tap)
    let down: { x: number; y: number } | null = null;
    (layer ?? node).addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    const tap = (e: PointerEvent) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return; turn(); };
    let timer = setTimeout(turn, ms);
    // The pager's own buttons give the page shown its full time again.
    node.querySelector('.fl-pager')?.addEventListener('click', () => { clearTimeout(timer); timer = setTimeout(turn, ms); });
    setTimeout(() => {
      const y = subject?.(), top = node.getBoundingClientRect().top - ctx.area.getBoundingClientRect().top;
      if (!done && y != null && y > top - 12) node.classList.add('top');
    }, 450);
    setTimeout(() => {
      if (done) return;
      node.classList.add('can-close');
      (layer ?? node).addEventListener('pointerup', tap);
    }, RESULT_MIN_MS);
  });
}
