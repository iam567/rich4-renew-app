/**
 * The game's own message boxes in place of the browser's alert / confirm / prompt (the user 2026-11-12: the system's
 * box did not fit the game): the same sheet as every other window, over everything, the text in the UI's words.
 */
import { audio } from './audio';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function open(inner: string): { ov: HTMLElement; box: HTMLElement } {
  const ov = document.createElement('div');
  ov.className = 'slots-overlay ui-dialog';
  ov.innerHTML = `<div class="msg sheet ui-dialog-box">${inner}</div>`;
  document.body.append(ov);
  ov.addEventListener('pointerdown', e => e.stopPropagation());
  return { ov, box: ov.querySelector<HTMLElement>('.ui-dialog-box')! };
}
const text = (t: string) => `<p class="ui-dialog-text">${esc(t).replace(/\n/g, '<br>')}</p>`;

/** A message and 好. */
export function uiAlert(message: string, title = '提示'): Promise<void> {
  return new Promise(done => {
    const { ov } = open(`<div class="ribbon">${esc(title)}</div>${text(message)}<div class="choices"><button class="candy yes" data-d="ok">好</button></div>`);
    ov.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-d]')) { audio.ui('click'); ov.remove(); done(); } });
  });
}

/** A question: true for `yes`. */
export function uiConfirm(message: string, yes = '確定', no = '取消', title = '確認'): Promise<boolean> {
  return new Promise(done => {
    const { ov } = open(`<div class="ribbon">${esc(title)}</div>${text(message)}<div class="choices"><button class="candy ghost" data-d="no">${esc(no)}</button><button class="candy yes" data-d="yes">${esc(yes)}</button></div>`);
    ov.addEventListener('click', e => {
      const d = (e.target as HTMLElement).closest<HTMLElement>('[data-d]')?.dataset.d;
      if (!d) return;
      audio.ui(d === 'yes' ? 'yes' : 'no'); ov.remove(); done(d === 'yes');
    });
  });
}

/** A line to type: the text (trimmed, at most `max`), or null when cancelled. */
export function uiPrompt(title: string, value = '', max = 16, hint = ''): Promise<string | null> {
  return new Promise(done => {
    const { ov, box } = open(`<div class="ribbon">${esc(title)}</div>${hint ? text(hint) : ''}<input class="ui-dialog-input" maxlength="${max}" value="${esc(value)}">
      <div class="choices"><button class="candy ghost" data-d="no">取消</button><button class="candy yes" data-d="yes">好</button></div>`);
    const input = box.querySelector<HTMLInputElement>('input')!;
    setTimeout(() => { input.focus(); input.select(); }, 50);
    const end = (ok: boolean) => { audio.ui(ok ? 'yes' : 'no'); ov.remove(); done(ok ? input.value.trim().slice(0, max) : null); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); });
    ov.addEventListener('click', e => { const d = (e.target as HTMLElement).closest<HTMLElement>('[data-d]')?.dataset.d; if (d) end(d === 'yes'); });
  });
}
