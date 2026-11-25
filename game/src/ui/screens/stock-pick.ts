/**
 * 紅卡 / 黑卡's stock (core/modules/cards.ts, the user 2026-11-19: 「它為什麼不是彈出股票列表…你就直接讓我這麼選，這個沒有
 * 參考性啊」): every stock as a row of the market — its name, today's price, the change since yesterday, a small trend of
 * the last 30 days and the shares the player holds — so the pick is an informed one. A tap picks it; 取消 gives -1.
 */
import { askScreens } from './registry';
import { audio } from '../audio';
import { formatPrice } from '../../core/modules/stocks';
import type { Ask } from '../../core/types';
import './stock-pick.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

askScreens['choose:stock-pick'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as Extract<Ask, { t: 'choose' }>;
  const m = ctx.game.stocks, cur = m.cursor ?? 0;
  const spark = (slot: number) => {
    const s = m.stocks[slot], h: number[] = [];
    for (let k = 0; k < 144; k++) { const v = s.history[(cur + k) % 144]; if (v) h.push(v); }
    if (!h.length || h[h.length - 1] !== s.price) h.push(s.price);
    const t = h.slice(-30);
    if (t.length < 2) return '<i class="sp-none">—</i>';
    const hi = Math.max(...t), lo = Math.min(...t), span = hi - lo || 1, W = 90, H = 30;
    const pts = t.map((v, i) => `${((i / (t.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / span) * (H - 4)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="sp-line ${t[t.length - 1] >= t[0] ? 'u' : 'd'}"><polyline points="${pts}"/></svg>`;
  };
  const rows = a.options.map(o => {
    const s = m.stocks[o.value];
    if (!s) return '';
    const diff = s.price - s.prevClose, pct = s.prevClose ? (diff / s.prevClose) * 100 : 0;
    const mine = m.holding(a.p, o.value).shares, cls = diff > 0 ? 'u' : diff < 0 ? 'd' : '';
    return `<button class="sp-row" data-v="${o.value}"${o.disabled ? ' disabled' : ''}>
      <span class="sp-name">${esc(o.label)}</span><span class="sp-price">${formatPrice(s.price)}</span>
      <span class="sp-chg ${cls}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '－'}${Math.abs(pct).toFixed(1)}%</span>
      ${spark(o.value)}<span class="sp-mine">${mine ? `持有 ${mine.toLocaleString('en-US')}` : ''}</span></button>`;
  }).join('');
  const box = document.createElement('div');
  box.className = 'msg sheet stocks sp-box';
  box.innerHTML = `<div class="ribbon">${esc(a.title)}</div>
    <div class="sp-head"><span>股票</span><span>股價</span><span>漲跌</span><span>近30天</span><span>你的持股</span></div>
    <div class="sp-list">${rows}</div>
    ${a.cancellable ? '<div class="choices"><button class="candy ghost sp-cancel">取消</button></div>' : ''}`;
  const done = (v: number) => { ctx.close(); resolve(v); };
  box.querySelectorAll<HTMLButtonElement>('.sp-row').forEach(b => { b.onclick = () => { audio.ui('yes'); done(Number(b.dataset.v)); }; });
  box.querySelector<HTMLButtonElement>('.sp-cancel')?.addEventListener('click', () => { audio.ui('no'); done(-1); });
  ctx.open(box, true);
});
