/**
 * 黑市 (docs/rules/10): the remake's night-market stall in place of the trade board. Six listings at most,
 * bought with cash; the rules check every purchase (modules/blackmarket.ts).
 */
import './black-market.css';
import { playerName } from '../../core/characters';
import { format } from '../../core/date';
import { cardDef } from '../../core/modules/cards';
import { TOOLS } from '../../core/modules/tools';
import type { Listing } from '../../core/modules/blackmarket';
import { askScreens, fxScreens } from './registry';
import { audio, Sfx, Theme } from '../audio';
import { phrases } from '../text';

const money = (n: number) => `$${Math.trunc(n).toLocaleString('en-US')}`;
const LAND_STAGES = ['空地', '平房', '店舖', '商場', '商業大樓', '摩天大樓'];

askScreens['black-market'] = (ctx, ask) => new Promise(resolve => {
  if (ask.t !== 'black-market') { resolve(-1); return; }
  const g = ctx.game, bm = g.blackMarket, p = g.players[ask.p];
  const months = g.world ? '六' : '三'; // 大富豪模式: 6 months (17 §5.1), normal UNSOLD_MONTHS = 3
  const root = document.createElement('div');
  root.className = 'bm-overlay';
  const board = document.createElement('div');
  board.className = 'bm';
  root.append(board);
  const fit = () => {
    const w = root.clientWidth, h = root.clientHeight, portrait = h > w * 1.1;
    board.classList.toggle('portrait', portrait);
    const [dw, dh] = portrait ? [500, 820] : [880, 500];
    board.style.transform = `translate(-50%, -50%) scale(${Math.min((w - 10) / dw, (h - 10) / dh)})`;
  };
  const picture = (l: Listing): string => {
    if (l.kind === 'tool') { const a = ctx.bank.art('Panel', 11, l.id + 1); return a ? `<img class="bm-tool" src="${a.src}" alt="">` : ''; }
    if (l.kind === 'card') { const a = ctx.bank.art('Data', 570 + l.id); return a ? `<img class="bm-card" src="${a.src}" alt="">` : ''; }
    const lot = g.board.lands[l.id - 1];
    return `<div class="bm-lot"><b>${lot?.name ?? ''}</b><span>${LAND_STAGES[lot?.level ?? 0]}</span></div>`;
  };
  const detail = (l: Listing): string => {
    if (l.kind === 'tool') return `${TOOLS[l.id - 1]?.name ?? ''}　持有 ${p.tools[l.id - 1]}/9`;
    if (l.kind === 'card') return cardDef(l.id)?.text ?? '';
    const lot = g.board.lands[l.id - 1];
    return `${months}個月沒人買的土地　原價 ${money((lot?.price ?? 0) * g.priceIndex)}`;
  };
  const render = () => {
    const face = ctx.bank.art('Data', 2, p.character)?.src ?? '';
    const items = bm.listings.map((l, i) => {
      const why = bm.blocked(p, l);
      return `<div class="bm-item ${l.kind}${why ? ' off' : ''}">
        <div class="bm-tag">${l.kind === 'tool' ? '道具' : l.kind === 'card' ? '卡片' : '土地'}</div>
        <div class="bm-pic">${picture(l)}</div>
        <div class="bm-name">${bm.name(l)}</div>
        <div class="bm-desc">${phrases(detail(l))}</div>
        <div class="bm-price">${money(bm.price(l))}</div>
        <button class="candy ${why ? 'ghost' : 'yes'}" data-buy="${i}" ${why ? 'disabled' : ''}>${why || '買下'}</button>
        <div class="bm-since">${format(l.since)} 上架</div></div>`;
    }).join('');
    const empty = Array.from({ length: Math.max(0, 6 - bm.listings.length) }, () => '<div class="bm-item empty"><span>每月一日進新貨</span></div>').join('');
    board.innerHTML = `<div class="bm-lanterns"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="bm-sign">黑市</div>
      <div class="bm-who"><img src="${face}" alt=""><span>${playerName(p)}</span><b>現金 ${money(p.cash)}</b></div>
      <div class="bm-grid">${items}${empty}</div>
      <div class="bm-foot"><span>只收現金 · 每月進一個道具、一張卡片；${months}個月沒人買的土地以五十倍地價出售</span>
        <button class="candy ghost" data-leave="1">離開黑市</button></div>`;
  };
  board.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-buy],[data-leave]');
    if (!t) return;
    // Remake-only screen, original sounds: the lottery's till for a purchase (Effect#31), cancel #4 to leave;
    // the stall plays the shop theme MIDI07 while open.
    if (t.dataset.leave) { audio.ui('no'); audio.restore(); } else audio.sfx(Sfx.lotteryBuy);
    root.remove();
    window.removeEventListener('resize', fit);
    resolve(t.dataset.leave ? -1 : { buy: Number(t.dataset.buy) });
  });
  window.addEventListener('resize', fit);
  render();
  ctx.shell.append(root);
  fit();
  // One question per purchase: the theme starts once per visit (it is not playing yet).
  if (audio.music?.kind !== 'theme' || audio.music.index !== Theme.shop) audio.theme(Theme.shop);
});

// Monthly restock and purchases by anyone: a short notice.
fxScreens['black-market'] = async (ctx, fx) => { await ctx.flash(String(fx.data?.text ?? '黑市進貨了'), 1600); };
fxScreens['black-market-buy'] = async (ctx, fx) => { await ctx.flash(String(fx.data?.text ?? ''), 1400); };
