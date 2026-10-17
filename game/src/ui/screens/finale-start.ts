/**
 * 最終決戰 — the way into 大富翁城 (docs/rules/19 §2, fx 'finale-start'): the title, the four finalists with the
 * chips their whole game earned (each line of the formula and the badges, core/chips.ts), what the human had to sell (cards and tools that do not work there), then
 * 「前往大富翁城」. One page in landscape and portrait; a tap (or the button) goes on.
 */
import { CHARACTERS } from '../../core/characters';
import type { FinalistChips, Valuation } from '../../core/finale';
import { fxScreens } from './registry';
import { esc, face, openScene } from './place-scene';
import { audio, Sfx } from '../audio';
import { ASSETS } from '../assets';
import './finale-start.css';

fxScreens['finale-start'] = (ctx, fx) => new Promise<void>(done => {
  const d = fx.data ?? {};
  const vals = (d.valuations as Valuation[]) ?? [];
  const human = ctx.game.players.find(p => p.human);
  const mine = vals.find(v => v.p === human?.id);
  const caps = (d.caps as number[]) ?? [];
  const chips = (d.chips as FinalistChips[]) ?? [];
  const chip = Number(d.chip ?? 100);
  const n = (x: number) => Math.trunc(x).toLocaleString('en-US');
  audio.sfx(Sfx.fireworks);
  const s = openScene(ctx, 'fs-scene', portrait => (portrait ? [500, 880] : [880, 500]), sc => {
    const rows = vals.map((v, k) => {
      const ch = CHARACTERS[ctx.game.players[v.p]?.character ?? 0];
      const c = chips.find(x => x.p === v.p);
      const lines = (c?.lines ?? []).filter(l => l.chips > 0).map(l => `<span>${esc(l.label)}</span><b>${n(l.chips)}</b>`).join('');
      const badges = (c?.badges ?? []).map(b => `<em title="${esc(b.rule)}">${esc(b.label)} +${b.chips}</em>`).join('');
      return `<div class="fs-card" style="animation-delay:${0.9 + k * 0.35}s">
        <div class="fs-who">${face(ctx, ch?.id ?? 0, 'fs-face')}
        <div class="fs-name">${esc(ch?.name ?? '')}${v.p === human?.id ? '<i>你</i>' : ''}</div></div>
        <div class="fs-lines">${lines || '<span>（沒有記錄）</span><b>0</b>'}</div>
        ${badges ? `<div class="fs-badges">${badges}</div>` : ''}
        <div class="fs-total">籌碼<b>${n(c?.total ?? 0)}</b></div>
      </div>`;
    }).join('');
    const sold = mine?.sold.length
      ? `<div class="fs-sold"><span class="ph">以下卡片、道具在大富翁城無法使用，</span><span class="ph">已自動賣出：<b>${mine.sold.map(x => `${esc(x.name)}×${x.n}`).join('、')}</b>，</span><span class="ph">共得 <b>${n(mine.points)}</b> 點券</span></div>`
      : '';
    sc.box(`fs-root ${sc.portrait ? 'por' : 'land'}`, 0, 0, sc.w, sc.h, `
      <div class="fs-bg" style="background-image:url('${ASSETS}/maps/remake/finale-thumb.jpg')"></div>
      <div class="fs-rays"></div>
      <div class="fs-title">最終決戰<small>只剩 ${vals.length} 人！全體前往 大富翁城</small></div>
      <div class="fs-cards">${rows}</div>
      <div class="fs-rule">${[
        '整局的表現換成籌碼進城（原本的地產、股票、現金凍結保留到結局）・',
        '點券、卡片、道具保留・', '籌碼用完就出局',
      ].map(t => `<span class="ph">${t}</span>`).join('')}<br>${[
        '10 塊用地蓋五種賭場：', '停在別人的賭場先付門票再賭一局・',
        `贏錢上限 Lv1 ${n((caps[1] ?? 10000) / chip)} … Lv5 ${n((caps[5] ?? 80000) / chip)} 籌碼`,
      ].map(t => `<span class="ph">${t}</span>`).join('')}</div>
      ${sold}
      <button class="candy yes fs-go">前往大富翁城</button>`);
    sc.stage.querySelector<HTMLButtonElement>('.fs-go')!.onclick = e => { e.stopPropagation(); finish(); };
  });
  let over = false;
  const finish = () => { if (over) return; over = true; audio.ui('yes'); s.close(); done(); };
  // Computers only (tests, a human who is out): it goes on alone; the human taps the button.
  if (!human || human.bankrupt) void s.wait(5000).then(finish);
});
