/**
 * 大富翁城's hall picker (docs/rules/19 §4): building on an empty plot or 改建卡 on a hall — one row of the five plates
 * (輪盤館 / 二十一點館 / 百家樂館 / 德州撲克館 / 骰寶館) like the original's facility picker (Data#517.4), each with its
 * game and the banker's big hands. The question is a `choose` with screen 'casino-hall' (core/casino-rules.ts).
 */
import type { Ask } from '../../core/types';
import * as C from '../../core/modules/casino';
import { HALL_GAME } from '../../core/casino-rules';
import { askScreens } from './registry';
import { esc } from './place-scene';
import { hallPlate } from './casino';
import { audio } from '../audio';
import './casino-hall.css';

askScreens['choose:casino-hall'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as Extract<Ask, { t: 'choose' }>;
  const box = document.createElement('div');
  // The original's facility picker (hud.ts 'facility-type'): one row of five, the plate above its name; the banker's
  // big hands of the hall under the pointer (or held down) in one line below the row.
  box.className = 'msg ask fac ch-box';
  const HINT = '輕點選擇・按住或指著看莊家大牌';
  box.innerHTML = `<div class="ribbon">${esc(a.title)}</div><div class="msg-text">${esc(a.text ?? '')}</div>
    <div class="choices facilities">${a.options.map(o => {
      const game = HALL_GAME[o.value] ?? 'roulette';
      return `<button class="candy cell fac-cell ch-hall" data-v="${o.value}"${o.disabled ? ' disabled' : ''}><span class="fac-pic">${hallPlate(o.value, game)}</span><span class="fac-name">${esc(o.label)}</span></button>`;
    }).join('')}</div><div class="ch-rule">${HINT}</div>${a.cancellable ? '<div class="choices tiles-cancel"><button class="candy ghost ch-cancel">取消</button></div>' : ''}`;
  const rule = box.querySelector<HTMLElement>('.ch-rule')!;
  const tell = (v: number | null) => {
    const game = v === null ? null : HALL_GAME[v];
    rule.textContent = game ? `${C.GAME_NAMES[game]}・莊家大牌：${C.BANKER_TABLE[game]}` : HINT;
    rule.classList.toggle('on', !!game);
  };
  const done = (v: number) => { ctx.close(); resolve(v); };
  box.querySelectorAll<HTMLButtonElement>('.ch-hall').forEach(b => {
    const v = Number(b.dataset.v);
    let held = 0, long = false;
    b.onpointerenter = e => { if (e.pointerType === 'mouse') { tell(v); if (!b.disabled) audio.ui('hover'); } };
    b.onfocus = () => tell(v);
    b.onpointerdown = () => { long = false; held = window.setTimeout(() => { long = true; tell(v); }, 450); };
    b.onpointerup = b.onpointerleave = () => clearTimeout(held);
    b.oncontextmenu = e => e.preventDefault();
    b.onclick = () => { if (long) { long = false; return; } audio.ui('yes'); done(v); };
  });
  box.querySelector<HTMLElement>('.choices.facilities')!.onpointerleave = e => { if (e.pointerType === 'mouse') tell(null); };
  box.querySelector<HTMLButtonElement>('.ch-cancel')?.addEventListener('click', () => { audio.ui('no'); done(-1); });
  ctx.open(box);
});
