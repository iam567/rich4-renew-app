/**
 * 歌舞伎町's shop picker (docs/rules/21 §2): the owner of an empty large plot (or 改建卡 on a shop) picks one of the five
 * shops — 居酒屋 / 陪酒店 / 泡泡浴 / 情人酒店 / 研究所 — in one row of plates like the original's facility picker
 * (Data#517.4) and 大富翁城's hall picker (casino-hall.ts). The option's rule line shows under the row while a plate is
 * pointed at or held down. The question is a `choose` with screen 'kb-shop' (core/kabukicho.ts askShop); the answer is
 * the facility type, or -1 (cancelled).
 */
import type { Ask } from '../../core/types';
import { askScreens } from './registry';
import { esc } from './place-scene';
import { audio } from '../audio';
import { ASSETS } from '../assets';
import './casino-hall.css';
import './kb-shop.css';

/** The shops' plates (tools/tycoon-art, maps/remake/kabukicho/plate-<type>.webp). */
export const KB_PLATE = (type: number) => `${ASSETS}/maps/remake/kabukicho/plate-${type}.webp`;

askScreens['choose:kb-shop'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as Extract<Ask, { t: 'choose' }>;
  const box = document.createElement('div');
  box.className = 'msg ask fac ch-box kb-shop';
  const HINT = '輕點選擇・按住或指著看店的規則';
  box.innerHTML = `<div class="ribbon">${esc(a.title)}</div><div class="msg-text">${esc(a.text ?? '')}</div>
    <div class="choices facilities">${a.options.map(o => `<button class="candy cell fac-cell ch-hall" data-v="${o.value}"${o.disabled ? ' disabled' : ''}>
      <span class="fac-pic"><img class="kb-plate" src="${KB_PLATE(Number(o.value))}" alt="" draggable="false"></span><span class="fac-name">${esc(o.label)}</span></button>`).join('')}</div>
    <div class="ch-rule">${HINT}</div>${a.cancellable ? '<div class="choices tiles-cancel"><button class="candy ghost ch-cancel">取消</button></div>' : ''}`;
  const rule = box.querySelector<HTMLElement>('.ch-rule')!;
  const tell = (v: number | null) => {
    const o = v === null ? undefined : a.options.find(x => x.value === v);
    rule.textContent = o?.detail ? `${o.label}：${o.detail}` : HINT;
    rule.classList.toggle('on', !!o?.detail);
  };
  const done = (v: number) => { ctx.close(); resolve(v); };
  box.querySelectorAll<HTMLButtonElement>('.ch-hall').forEach(b => {
    const v = Number(b.dataset.v);
    let held = 0, long = false;
    b.onpointerenter = e => { if (e.pointerType === 'mouse') { tell(v); if (!b.disabled) audio.ui('hover'); } };
    b.onfocus = () => tell(v);
    // A long press shows the rule without choosing (a phone has no pointer to hover with).
    b.onpointerdown = () => { long = false; held = window.setTimeout(() => { long = true; tell(v); }, 450); };
    b.onpointerup = b.onpointerleave = () => clearTimeout(held);
    b.oncontextmenu = e => e.preventDefault();
    b.onclick = () => { if (long) { long = false; return; } audio.ui('yes'); done(v); };
  });
  box.querySelector<HTMLElement>('.choices.facilities')!.onpointerleave = e => { if (e.pointerType === 'mouse') tell(null); };
  box.querySelector<HTMLButtonElement>('.ch-cancel')?.addEventListener('click', () => { audio.ui('no'); done(-1); });
  ctx.open(box);
});
