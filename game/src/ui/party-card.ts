/** 聯絡方式's card (the user 2026-11-08): a player's face, name and how to reach them, with 複製. */
import { audio } from './audio';
import { contactLabel, type Member } from './party-net';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * A player's card (the user 2026-11-08: tap a face, see how to reach them): face, name, and their 聯絡方式 with 複製.
 * `parent`: where it opens (the room's sheet, the game's screen).
 */
export function showContact(parent: HTMLElement, m: Member, face: string) {
  const old = parent.querySelector('.pt-card-ov');
  old?.remove();
  const ov = document.createElement('div');
  ov.className = 'slots-overlay pt-card-ov';
  const c = m.contact;
  ov.innerHTML = `<div class="msg sheet pt-card"><img src="${face}" alt=""><b>${esc(m.name)}</b>
    ${c ? `<p class="pt-card-c">${esc(contactLabel(c))}</p><div class="choices"><button class="candy opt" data-a="copy">複製</button><button class="candy ghost" data-a="close">關閉</button></div>`
      : '<p class="pt-card-c none">沒有留聯絡方式</p><div class="choices"><button class="candy ghost" data-a="close">關閉</button></div>'}</div>`;
  ov.addEventListener('pointerdown', e => e.stopPropagation());
  ov.onclick = e => {
    e.stopPropagation();
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'copy' && c) {
      void navigator.clipboard?.writeText(c.v).then(() => { const b = ov.querySelector<HTMLElement>('[data-a=copy]'); if (b) b.textContent = '已複製'; }, () => {});
      return;
    }
    if (a === 'close' || e.target === ov) { audio.ui('no'); ov.remove(); }
  };
  parent.append(ov);
}
