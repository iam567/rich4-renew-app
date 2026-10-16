/**
 * The 15th's 「上市公司分紅」 table (fcn_0042ba97, rich4_ui_stock.asm:3052-3330, docs/rules/03 §6.2): Panel#76
 * (592×432 at (24,24) of the 640×480 screen), title 28 px white at (296,25); the corner cell 人名 / 公司 (12 px);
 * the living players' names centred at x 160 + 98·i, y 88, 本月盈餘 at 542; one row per linked stock from y 116,
 * 24 px apart: the company centred at 62, each player's share right-aligned at 198 + 98·i, the surplus at 572;
 * 紅  利 and the totals on y 404. Effect#61 sounds when it opens; it closes by itself after three 1 s timer ticks
 * (fcn_0042b3eb) or on a tap. The remake draws its own table (see draw()) in both orientations.
 */
import { fitOverlay } from './bank';
import { fxScreens } from './registry';
import { charColor, face } from './place-scene';
import { audio } from '../audio';
import './dividends.css';

type Row = { company: string; profit: number; each: number[] };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** `_rich4_num_to_currency_string`: digits grouped by three. */
const money = (n: number) => (n || 0).toLocaleString('en-US');

/** Effect#61 (ref_004755a8). */
const OPEN_SOUND = 61;
/** The original closes after 3 s; the remake gives 5 s to read the bigger table (a tap closes it sooner). */
const SHOW_MS = 5000;

fxScreens['dividends'] = (ctx, fx) => {
  const rows = (fx.data?.rows as Row[] | undefined) ?? [];
  const pay = (fx.data?.pay as number[] | undefined) ?? [];
  const g = ctx.game;
  const who = g.players.filter(p => p.whoPlays !== 0);
  let ready = false;
  const ov = fitOverlay(ctx.shell, 'dv-ov', tall => (tall ? [440, 640] : [640, 432]), tall => { if (ready) draw(tall); }, 12);
  const { root, scene } = ov;
  ready = true;
  scene.classList.add('dv-scene');

  // One designed table in both orientations (the remake's look; the original's Panel#76 grid is a plain grey
  // sheet): a gold ribbon, the players' faces in their colours, zeros as a faint dash, the dividend row counting up.
  function draw(tall: boolean) {
    const num = (v: number, cls = '') => v === 0 ? `<td class="dv-zero ${cls}">—</td>` : `<td class="${cls}${v < 0 ? ' dv-neg' : ''}">${money(v)}</td>`;
    const head = who.map(p => `<th class="dv-who" style="--c:${charColor(ctx, p.id)}"><span class="dv-face">${face(ctx, p.character)}</span><b>${esc(g.name(p.id))}</b></th>`).join('');
    scene.classList.toggle('tall', tall);
    scene.innerHTML = `<div class="dv-board">
      <div class="dv-ribbon"><span>上市公司分紅</span></div>
      <table>
        <thead><tr><th class="dv-corner"><span>人名</span><span>公司</span></th>${head}<th class="dv-profit-h">本月盈餘</th></tr></thead>
        <tbody>${rows.map(r => `<tr><th class="dv-co">${esc(r.company)}</th>${who.map(p => num(r.each[p.id] ?? 0)).join('')}${num(r.profit, 'dv-profit')}</tr>`).join('')}</tbody>
        <tfoot><tr><th class="dv-sum">紅　利</th>${who.map(p => `<td class="dv-total${(pay[p.id] ?? 0) < 0 ? ' dv-neg' : ''}" data-v="${pay[p.id] ?? 0}">0</td>`).join('')}<td class="dv-coin"></td></tr></tfoot>
      </table></div>
      <div class="dv-tap">點一下關閉</div>`;
    // The totals count up.
    const cells = [...scene.querySelectorAll<HTMLElement>('.dv-total')], t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 900), e = 1 - (1 - k) ** 3;
      for (const c of cells) c.textContent = money(Math.round(Number(c.dataset.v) * e));
      if (k < 1 && c0 === draws) requestAnimationFrame(tick);
    };
    const c0 = ++draws;
    requestAnimationFrame(tick);
  }
  let draws = 0;
  draw(ov.isTall());
  audio.sfx(OPEN_SOUND);

  return new Promise<void>(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      root.classList.add('out');
      setTimeout(() => { ov.close(); resolve(); }, 160);
    };
    const timer = setTimeout(end, SHOW_MS);
    setTimeout(() => { if (!done) root.addEventListener('pointerup', end); }, 200);
  });
};
