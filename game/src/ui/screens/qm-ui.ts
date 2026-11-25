/**
 * 清明上河's screens' shared bits (qm-dock, qm-ling, qm-juyi, qm-slot): where the map's art is, the painted pieces put
 * on a stage (qm-ui.css), the money line, and a wait that a tap ends.
 */
import { ASSETS, cssUrl } from '../assets';
import './qm-ui.css';

export const QM_ART = `${ASSETS}/maps/remake/qingming`;
export const qmMoney = (n: number) => `${Math.round(n).toLocaleString('en-US')} 元`;
export const qmEsc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const qmWait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Makes a stage a 清明上河 one: its font and the painted buttons / dialog / tag / board. */
export function qmStage(scene: HTMLElement) {
  scene.classList.add('qm-scene');
  for (const k of ['btn-gold', 'btn-ink', 'dialog', 'tag', 'title']) scene.style.setProperty(`--qm-${k}`, cssUrl(`${QM_ART}/ui/${k}.webp`));
}

/** Resolves after `ms`, or at a tap on `root` (or a key) once `armMs` has gone by (so the tap that opened it does not count). */
export function qmHold(root: HTMLElement, ms: number, armMs = 300): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true; clearTimeout(t);
      root.removeEventListener('pointerup', end); window.removeEventListener('keydown', end);
      resolve();
    };
    const t = window.setTimeout(end, ms);
    window.setTimeout(() => { if (!done) { root.addEventListener('pointerup', end); window.addEventListener('keydown', end); } }, armMs);
  });
}
