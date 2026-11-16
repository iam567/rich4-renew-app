/**
 * 重慶's 扶梯 / 直梯 (docs/rules/33 §2): a little scene when a player takes one — the three levels stacked as a cut
 * through the hill, the player's face riding from one level to the other, the pad's picture and 「一層 → 三層」 — so it
 * is clear where they went (the user 2026-11-09).
 */
import { fxScreens } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { ASSETS } from '../assets';
import './cq-link.css';

const NAMES = ['', '一層', '二層', '三層'];

fxScreens['cq-link'] = (ctx, fx) => new Promise(resolve => {
  const d = (fx.data ?? {}) as { how?: string; from?: number; to?: number; text?: string };
  const from = Math.min(3, Math.max(1, d.from ?? 1)), to = Math.min(3, Math.max(1, d.to ?? 2)), lift = d.how === '直梯';
  const p = fx.p !== undefined ? ctx.game.players[fx.p] : undefined;
  const face = p ? ctx.bank.art('Data', 2, p.character)?.src : undefined;
  const ov = fitOverlay(ctx.area, 'cql-ov', tall => (tall ? [320, 330] : [470, 250]), undefined, 10);
  const { scene } = ov;
  scene.classList.add('cql-scene');
  const floors = [3, 2, 1].map(k => `<div class="cql-floor f${k}${k === from ? ' from' : ''}${k === to ? ' to' : ''}"><span>${NAMES[k]}</span></div>`).join('');
  scene.innerHTML = `<div class="cql-card ${lift ? 'lift' : 'esc'}">
    <div class="cql-hill">${floors}<div class="cql-shaft"></div>
      <div class="cql-rider" style="--from:${3 - from};--to:${3 - to}">${face ? `<img src="${face}" alt="">` : ''}</div></div>
    <div class="cql-side"><img class="cql-pad" src="${ASSETS}/maps/remake/sprites/${lift ? 9202 : 9201}/frame-000.webp" alt="">
      <div class="cql-how">搭${d.how ?? ''}</div><div class="cql-way">${NAMES[from]} <b>${to > from ? '▲' : '▼'}</b> ${NAMES[to]}</div></div></div>`;
  audio.ui('click');
  const rider = scene.querySelector<HTMLElement>('.cql-rider');
  requestAnimationFrame(() => requestAnimationFrame(() => rider?.classList.add('go')));
  setTimeout(() => { ov.close(); resolve(); }, Math.max(1900, 2600 * ctx.scale()));
});
