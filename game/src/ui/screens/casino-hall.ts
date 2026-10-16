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
  box.className = 'msg ask ch-box';
  box.innerHTML = `<div class="ribbon">${esc(a.title)}</div><div class="msg-text">${esc(a.text ?? '')}</div>
    <div class="ch-row">${a.options.map(o => {
      const game = HALL_GAME[o.value] ?? 'roulette';
      return `<button class="ch-hall" data-v="${o.value}"${o.disabled ? ' disabled' : ''}>${hallPlate(o.value, game)}
        <b>${esc(o.label)}</b><small>${esc(C.BANKER_TABLE[game]).replace(/・/g, '<br>')}</small></button>`;
    }).join('')}</div>${a.cancellable ? '<div class="choices"><button class="candy no ch-cancel">取消</button></div>' : ''}`;
  const done = (v: number) => { ctx.close(); resolve(v); };
  box.querySelectorAll<HTMLButtonElement>('.ch-hall').forEach(b => b.onclick = () => { audio.ui('yes'); done(Number(b.dataset.v)); });
  box.querySelector<HTMLButtonElement>('.ch-cancel')?.addEventListener('click', () => { audio.ui('no'); done(-1); });
  ctx.open(box);
});
