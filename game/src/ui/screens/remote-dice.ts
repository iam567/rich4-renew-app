/**
 * Remote dice (遙控骰子, docs/rules/09 §7.5: Panel#72.0, the 256×55 green tray with the six faces, at (92,300);
 * face i is clickable from x 104 + 40i). Here the tray is a card over the map: the six faces (Panel#72.1-6) as big
 * buttons, the chosen one spins before the answer goes back. Answer: 1..6, or -1 to cancel.
 */
import type { Ask } from '../../core/types';
import { askScreens } from './registry';
import { audio } from '../audio';
import { face } from './place-scene';
import './remote-dice.css';

type Choose = Extract<Ask, { t: 'choose' }>;

askScreens['choose:remote-dice'] = (ctx, ask) => {
  const a = ask as Choose;
  const p = ctx.game.players[a.p];
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'rd-ov';
    const dice = [1, 2, 3, 4, 5, 6].map(n => {
      const f = ctx.bank.art('Panel', 72, n);
      return `<button class="rd-die" data-v="${n}" style="--i:${n - 1}" aria-label="${n}">${f ? `<img src="${f.src}" alt="">` : `<b>${n}</b>`}</button>`;
    }).join('');
    ov.innerHTML = `<div class="rd-card">
      <div class="rd-ribbon">${p ? `<span class="rd-face">${face(ctx, p.character)}</span>` : ''}遙控骰子</div>
      <div class="rd-text">選擇要擲出的點數</div>
      <div class="rd-tray">${dice}</div>
      <button class="candy ghost rd-cancel">取消</button></div>`;
    let done = false;
    const finish = (v: number) => {
      if (done) return;
      done = true;
      ov.classList.add('out');
      setTimeout(() => { ov.remove(); resolve(v); }, v > 0 ? 420 : 160);
    };
    ov.addEventListener('click', e => {
      const t = e.target as HTMLElement, b = t.closest<HTMLElement>('.rd-die');
      if (b) { audio.ui('yes'); b.classList.add('pick'); finish(Number(b.dataset.v)); return; }
      if (t.closest('.rd-cancel') || t === ov) { audio.ui('no'); finish(-1); }
    });
    ctx.area.append(ov);
  });
};
