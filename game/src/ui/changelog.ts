/**
 * 更新日誌 (the user 2026-11-04): a small 「更新日誌」 at the top left of the title (first the bottom middle; it crowded the buttons); a tap opens a sheet with each
 * version's changes (dist/changelog.json, scripts/changelog.mjs) — one version at a time, the newest first, its lines
 * in pages when they don't fit (no scrolling: some devices can't), ‹ › and a swipe to go on.
 */
import { audio } from './audio';
import './changelog.css';
import { canUpdate, pickVersion } from './update';

interface Version { title: string; lines: string[] }
let cache: Promise<Version[]> | null = null;
const load = () => (cache ??= fetch(`${import.meta.env.BASE_URL}changelog.json`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : [])).catch(() => []) as Promise<Version[]>);

/** Opens the sheet over `parent`; resolves when closed. */
export async function openChangelog(parent: HTMLElement): Promise<void> {
  const versions = await load();
  const overlay = document.createElement('div');
  overlay.className = 'slots-overlay cl-ov';
  overlay.innerHTML = `<div class="msg sheet cl-sheet"><div class="ribbon">更新日誌</div>
    <div class="cl-head"><button class="chip" data-v="-1" aria-label="較新">‹</button><b></b><button class="chip" data-v="1" aria-label="較舊">›</button></div>
    <ul class="cl-list"></ul>
    <div class="cl-foot"><span class="cl-page"></span></div>
    <div class="choices">${canUpdate() ? '<button class="candy yes" data-check>檢查更新</button>' : ''}<button class="candy ghost" data-close>關閉</button></div></div>`;
  parent.append(overlay);
  const title = overlay.querySelector<HTMLElement>('.cl-head b')!, list = overlay.querySelector<HTMLElement>('.cl-list')!, page = overlay.querySelector<HTMLElement>('.cl-page')!;
  if (!versions.length) { title.textContent = ''; list.innerHTML = '<li>暫時沒有更新日誌</li>'; }
  // a version and where its pages start (its lines filled until the list is full)
  let vi = 0, starts: number[] = [0], pi = 0;
  const fill = (from: number) => {
    list.innerHTML = '';
    const lines = versions[vi].lines;
    let i = from;
    for (; i < lines.length; i++) {
      const li = document.createElement('li'); li.textContent = lines[i]; list.append(li);
      if (i > from && list.scrollHeight > list.clientHeight + 1) { li.remove(); break; }
    }
    return i;
  };
  const draw = () => {
    if (!versions.length) return;
    const v = versions[vi];
    // 「v1.0.1（2026-11-04，遊戲內更新）」: the version big, what is in the brackets small under it
    const m = /^(.*?)[（(](.*)[）)]\s*$/.exec(v.title);
    title.textContent = m ? m[1] : v.title;
    if (m) { const sm = document.createElement('small'); sm.textContent = m[2]; title.append(sm); }
    starts = [0];
    for (let i = fill(0); i < v.lines.length; i = fill(i)) starts.push(i);
    pi = Math.min(pi, starts.length - 1);
    fill(starts[pi]);
    page.textContent = starts.length > 1 ? `第 ${pi + 1} / ${starts.length} 頁` : '';
    overlay.querySelector<HTMLButtonElement>('[data-v="-1"]')!.disabled = vi === 0 && pi === 0;
    overlay.querySelector<HTMLButtonElement>('[data-v="1"]')!.disabled = vi === versions.length - 1 && pi === starts.length - 1;
  };
  /** ‹ newer, › older: through a version's pages, then on to the next version. */
  const step = (d: number) => {
    if (!versions.length) return;
    if (d > 0) { if (pi < starts.length - 1) pi++; else if (vi < versions.length - 1) { vi++; pi = 0; } else return; }
    else { if (pi > 0) pi--; else if (vi > 0) { vi--; pi = Number.MAX_SAFE_INTEGER; } else return; }
    audio.ui('click');
    draw();
  };
  return new Promise(resolve => {
    const close = () => { audio.ui('no'); ro.disconnect(); overlay.remove(); resolve(); };
    overlay.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      if (t === overlay || t.closest('[data-close]')) { close(); return; }
      // 檢查更新 (the user 2026-11-15): the versions to pick from, the newest first (update.ts 版本選擇)
      if (t.closest('[data-check]')) { audio.ui('yes'); ro.disconnect(); overlay.remove(); resolve(); void pickVersion(parent); return; }
      const v = t.closest<HTMLElement>('[data-v]')?.dataset.v;
      if (v) step(Number(v));
    });
    let x0: number | null = null;
    list.addEventListener('pointerdown', e => { x0 = e.clientX; });
    list.addEventListener('pointerup', e => { if (x0 !== null && Math.abs(e.clientX - x0) > 40) step(e.clientX < x0 ? 1 : -1); x0 = null; });
    const ro = new ResizeObserver(() => { if (overlay.isConnected) draw(); });
    ro.observe(list);
    audio.ui('click');
    draw();
  });
}
