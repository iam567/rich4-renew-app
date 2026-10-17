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
    // The faces' size is worked out here from the room the map area leaves (not from container units or the art's
    // own pixels, which WebKit sized differently): measure the card around a probe size, then take the biggest face
    // for 3×2 or 6×1 that fits inside the card, and the card inside the area. Again on rotation.
    const tray = ov.querySelector<HTMLElement>('.rd-tray')!, card = ov.querySelector<HTMLElement>('.rd-card')!;
    const fit = () => {
      if (!ov.isConnected) { ro.disconnect(); return; }
      const os = getComputedStyle(ov);
      const W = ov.clientWidth - parseFloat(os.paddingLeft) - parseFloat(os.paddingRight);
      const H = ov.clientHeight - parseFloat(os.paddingTop) - parseFloat(os.paddingBottom) - 26; // the ribbon over the top
      if (W <= 0 || H <= 0) return;
      const PROBE = 60;
      tray.style.setProperty('--cols', '3'); tray.style.setProperty('--d', `${PROBE}px`);
      const gap = parseFloat(getComputedStyle(tray).columnGap) || 0;
      const chromeW = card.offsetWidth - (3 * PROBE + 2 * gap), chromeH = card.offsetHeight - (2 * PROBE + gap);
      let best = { cols: 3, d: 0 };
      for (const [cols, rows] of [[3, 2], [6, 1]]) {
        const d = Math.min((W - chromeW - gap * (cols - 1)) / cols, (H - chromeH - gap * (rows - 1)) / rows, 116);
        if (d > best.d + 4) best = { cols, d };
      }
      tray.style.setProperty('--cols', String(best.cols));
      tray.style.setProperty('--d', `${Math.max(30, Math.floor(best.d))}px`);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(ov);
    fit();
  });
};
