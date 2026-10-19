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
  let lines = r.lines;
  const many = lines.length > 4;
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
  node.className = `msg er-box ${tone(r.fx)}${many ? ' many' : ''}${common ? ' bare' : ''}`;
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
  const across = (textLines: number) => node.offsetWidth <= (node.parentElement?.clientWidth ?? 0) + 1
    && list.scrollWidth <= list.clientWidth + 1 && rowsReadable(node, ONE_LINE, '.er-text', textLines);
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
  if (pickLayout([...looks(false), ...looks(true)], apply, fits) === null) {
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
  const ms = Math.max(RESULT_MIN_MS + 350 * extra, (2600 + 500 * extra) * ctx.scale());
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
    const tap = () => turn();
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
