/**
 * 大富翁城's results (docs/rules/19 §8): after the last rival falls (or the human), before the 大富豪模式 ending
 * (tycoon-ending.ts) — the four finalists in their final order, what each held in the five cities when the finale
 * began (frozen there: lots, houses, large plots, stocks, the cash it became) and their nights at the casinos.
 */
import { CHARACTERS } from '../core/characters';
import { FINALE_NAME, HALL_NAMES, isHall } from '../core/finale';
import type { World } from '../core/world';
import { audio, Sfx } from './audio';
import type { ScreenContext } from './screens/registry';
import { CITY_COLORS } from './tycoon';
import './finale-ending.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => Math.trunc(n).toLocaleString('en-US');
const FAC = ['公園', '旅館', '購物中心', '加油站', '研究所', '輪盤館', '二十一點館', '百家樂館', '德州撲克館', '骰寶館'];

/** Shows the finale's results when the world ended in 大富翁城; resolves at once otherwise. */
export function finaleResults(ctx: ScreenContext, w: World, winner: number): Promise<void> {
  const f = w.finale;
  if (!f.active || !f.valuations.length) return Promise.resolve();
  // Final order: the winner, then the finalists by how late they fell.
  const fellAt = (p: number) => { const i = w.fallen.findIndex(x => x.p === p); return i < 0 ? Infinity : i; };
  const order = [...f.finalists].sort((a, b) => (a === winner ? -1 : b === winner ? 1 : fellAt(b) - fellAt(a)));
  const g = w.cities[f.index];
  const rows = order.map((p, k) => {
    const v = f.valuations.find(x => x.p === p)!, ch = CHARACTERS[w.players[p].character], st = f.stats[p];
    const a = ctx.bank.art('Data', 2, ch.id);
    const cities = v.cities.filter(c => c.lots || c.facilities.length || c.stocks).map(c => `<div class="fe-city" style="--cc:${CITY_COLORS[c.map] ?? '#888'}">
        <b>${esc(c.name)}</b><span>土地 ${c.lots}・房屋 ${c.houses}級${c.facilities.length ? `・${c.facilities.map(x => `${esc(x.name)}${FAC[x.type] ?? ''}${x.level}級`).join('、')}` : ''}${c.stocks ? `・股票 ${money(c.stocks)}` : ''}</span></div>`).join('')
      || '<div class="fe-city none">五座城市沒有地產或股票</div>';
    const casinos = g?.board.facilities.filter(x => x.owner === p + 1 && isHall(x.type) && x.level).map(x => `${esc(x.name)}${HALL_NAMES[x.type]} Lv${x.level}`).join('、');
    const fell = w.fallen.find(x => x.p === p);
    return `<div class="fe-row${p === winner ? ' win' : ''}">
      <div class="fe-rank">${k + 1}</div>
      <div class="fe-who">${a ? `<img src="${a.src}" alt="">` : ''}<b>${esc(ch.name)}</b><small>${p === winner ? '首富大富豪' : fell ? `第${fell.day - f.startDay + 1}天破產` : ''}</small></div>
      <div class="fe-body">
        <div class="fe-val">進城結算 <b>${money(Math.max(0, v.total))}</b>（現金存款 ${money(v.cash + v.bank - v.loan)}・股票 ${money(v.stocks)}・地產 ${money(v.property)}）</div>
        <div class="fe-cities">${cities}</div>
        <div class="fe-casino">賭場：去了 ${st?.visits ?? 0} 次・贏 ${money(st?.won ?? 0)}・輸 ${money(st?.lost ?? 0)}・當莊收 ${money(st?.bankerIn ?? 0)} 付 ${money(st?.bankerOut ?? 0)}${casinos ? `・持有 ${casinos}` : ''}</div>
      </div></div>`;
  }).join('');
  audio.sfx(Sfx.fireworks);
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'fe-cover';
    root.innerHTML = `<div class="fe-box"><div class="fe-head">${FINALE_NAME} 決戰結果<small>第 ${w.daysElapsed - f.startDay + 1} 天分出勝負・賭場共開了 ${f.visits} 局</small></div>
      <div class="fe-rows">${rows}</div><button class="candy yes fe-go">繼續</button></div>`;
    (ctx.shell ?? ctx.area).append(root);
    root.querySelector('.fe-go')!.addEventListener('click', () => { audio.ui('yes'); root.classList.add('out'); setTimeout(() => root.remove(), 250); resolve(); });
  });
}
