/**
 * 手把測試 (the user 2026-11-08, from 遊戲設定): its own screen to see that every controller of a family game is
 * connected and which player it is (1P–4P in the order the system numbers them, pad.ts padFor), with each button lit as
 * it is pressed and the sticks shown; the button layout (PlayStation / Xbox way) and what each button does.
 * The game's own controller play is paused here, so testing a button does nothing else; holding START / OPTIONS on any
 * controller for a second, Esc, or 關閉 leaves.
 */
import { PAD_LAYOUT_KEY, padSuspend } from './pad';
import { audio } from './audio';
import './pad-test.css';

/** The standard mapping's buttons as drawn: index, PlayStation name, Xbox name, place on the little controller. */
const BTN: [number, string, string, string][] = [
  [12, '↑', '↑', 'du'], [13, '↓', '↓', 'dd'], [14, '←', '←', 'dl'], [15, '→', '→', 'dr'],
  [3, '△', 'Y', 'fu'], [0, '✕', 'A', 'fd'], [2, '□', 'X', 'fl'], [1, '○', 'B', 'fr'],
  [4, 'L1', 'LB', 'l1'], [6, 'L2', 'LT', 'l2'], [5, 'R1', 'RB', 'r1'], [7, 'R2', 'RT', 'r2'],
  [8, 'SELECT', 'VIEW', 'se'], [9, 'OPTIONS', 'MENU', 'sb'], [10, 'L3', 'L3', 'l3'], [11, 'R3', 'R3', 'r3'],
];

const ROLES_PS: [string, string][] = [
  ['○', '確定'], ['✕', '返回；在地圖上跳到下面的資金／地產／股票／其他'], ['△', '跳到上面的工具列（←→ 切換）'], ['□', '直接擲骰子'],
  ['方向鍵／左搖桿', '移動游標；GO 上 ←→ 改骰子數，↑ 工具列，↓ 資產欄'], ['L1／L2、R1／R2', '轉地圖'],
  ['右搖桿', '移動地圖'], ['按下右搖桿（R3）', '看地圖模式：方向鍵移動地圖，再按一下結束'], ['按下左搖桿（L3）', '鏡頭回到角色'],
  ['OPTIONS', '系統選單'], ['SELECT', '資訊'],
];
const ROLES_XBOX: [string, string][] = [
  ['A', '確定'], ['B', '返回'], ['X', '鏡頭回到角色'], ['Y', '地圖'], ['LB／RB', '在工具列左右移動'], ['LT／RT', '轉地圖'],
  ['方向鍵／左搖桿', '移動游標；GO 上 ←→ 改骰子數'], ['右搖桿', '移動地圖'], ['按下右搖桿（R3）', '看地圖模式'],
  ['MENU', '系統選單'], ['VIEW', '資訊'],
];

const layout = () => { try { return localStorage.getItem(PAD_LAYOUT_KEY) === '1' ? 1 : 0; } catch { return 0; } };

export function openPadTest(onClose?: () => void) {
  const ov = document.createElement('div');
  ov.className = 'padt';
  ov.innerHTML = `<div class="padt-box">
    <header><b>搖桿測試</b><button class="padt-x" data-close>關閉</button></header>
    <p class="padt-tip">每個人按一下自己手把上的任意鍵，看自己是幾號。1 號手把是 1P、2 號是 2P……（新遊戲裡設成「玩家」的座位依序對應）。輪到誰，就只有誰的手把能操作。<br>在這個畫面按鍵只會亮燈，不會操作遊戲；按住 OPTIONS / MENU 一秒離開。</p>
    <div class="padt-slots"></div>
    <section><h3>按鍵習慣</h3><div class="chips padt-layout"><button class="chip" data-l="0">○ 確定（PS）</button><button class="chip" data-l="1">A 確定（Xbox、掌機）</button></div></section>
    <section><h3>按鍵說明</h3><table class="padt-roles"></table></section>
  </div>`;
  const slots = ov.querySelector<HTMLElement>('.padt-slots')!;
  slots.innerHTML = [0, 1, 2, 3].map(i => `<div class="padt-slot" data-i="${i}"><div class="padt-head"><b>${i + 1}P</b><span class="padt-name">未連接</span></div>
    <div class="padt-pad">${BTN.map(([n, , , pos]) => `<i class="b ${pos}" data-b="${n}"></i>`).join('')}<u class="stk sl"><s></s></u><u class="stk sr"><s></s></u></div></div>`).join('');
  const drawLayout = () => {
    const l = layout();
    ov.querySelectorAll<HTMLElement>('[data-l]').forEach(b => b.classList.toggle('on', Number(b.dataset.l) === l));
    ov.querySelectorAll<HTMLElement>('.padt-pad .b').forEach(b => { const d = BTN.find(x => x[0] === Number(b.dataset.b))!; b.textContent = l ? d[2] : d[1]; });
    ov.querySelector('.padt-roles')!.innerHTML = (l ? ROLES_XBOX : ROLES_PS).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  };
  drawLayout();
  let raf = 0, holdStart = 0;
  const close = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    padSuspend(false);
    ov.remove();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  ov.onclick = e => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) { audio.ui('no'); close(); return; }
    const l = t.closest<HTMLElement>('[data-l]');
    if (l) { audio.ui('click'); try { localStorage.setItem(PAD_LAYOUT_KEY, l.dataset.l!); } catch { /* not kept */ } drawLayout(); }
  };
  const seen = new Set<number>();
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    let pads: Gamepad[] = [];
    try { pads = [...(navigator.getGamepads?.() ?? [])].filter((g): g is Gamepad => !!g && g.connected); } catch { /* none */ }
    let start = false;
    slots.querySelectorAll<HTMLElement>('.padt-slot').forEach((el, i) => {
      const g = pads[i];
      el.classList.toggle('on', !!g);
      const name = el.querySelector<HTMLElement>('.padt-name')!;
      const label = g ? g.id.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:.*$/i, '').slice(0, 40) || '手把' : '未連接';
      if (name.textContent !== label) name.textContent = label;
      let any = false;
      el.querySelectorAll<HTMLElement>('.b').forEach(b => {
        const btn = g?.buttons[Number(b.dataset.b)];
        const on = !!btn && (btn.pressed || btn.value > 0.5);
        any ||= on;
        b.classList.toggle('lit', on);
      });
      if (g && any && !seen.has(i)) { seen.add(i); audio.ui('hover'); }
      el.classList.toggle('press', any);
      if (g?.buttons[9]?.pressed) start = true;
      const ax = g?.axes ?? [];
      const sticks = el.querySelectorAll<HTMLElement>('.stk s');
      sticks[0].style.transform = `translate(${(ax[0] ?? 0) * 7}px, ${(ax[1] ?? 0) * 7}px)`;
      sticks[1].style.transform = `translate(${(ax[2] ?? 0) * 7}px, ${(ax[3] ?? 0) * 7}px)`;
    });
    // START / OPTIONS held a second: out
    if (start) { if (!holdStart) holdStart = now; else if (now - holdStart > 1000) close(); } else holdStart = 0;
  };
  padSuspend(true);
  window.addEventListener('keydown', onKey, true);
  document.body.append(ov);
  raf = requestAnimationFrame(loop);
}
