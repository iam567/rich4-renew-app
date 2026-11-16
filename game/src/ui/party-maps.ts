/**
 * The maps as picture cards (the user 2026-11-03: the name buttons were a jumble), for the new room and for 換地圖's
 * sheet, which looks like the new room's (the user 2026-11-04: a page of name buttons was ugly).
 */
import type { MapInfo } from './assets';
import { audio } from './audio';
import { fitToScreen } from './saves';
import { shrinkText } from './text';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const MAP_PAGE = 6;
/** 「地圖05・星座主題」 → 「星座主題」 (the number says nothing on a picture card). */
const shortName = (n: string) => n.replace(/^地[圖图]\s*\d+\s*[・·•‧]\s*/, '');

export function mapCards(maps: MapInfo[], selected: number, page: number): string {
  const pages = Math.max(1, Math.ceil(maps.length / MAP_PAGE)), pg = Math.min(page, pages - 1);
  return `<div class="pt-mgrid">${maps.slice(pg * MAP_PAGE, pg * MAP_PAGE + MAP_PAGE).map(m => `<button class="pt-mcard${m.id === selected ? ' on' : ''}" data-map="${m.id}">
      <img src="${m.thumbnail}" alt="" loading="lazy"><span>${esc(shortName(m.name))}</span></button>`).join('')}</div>
    <div class="pt-pager"><button data-mp="-1"${pg === 0 ? ' disabled' : ''} aria-label="上一頁">‹</button><span>${pg + 1} / ${pages}</span><button data-mp="1"${pg >= pages - 1 ? ' disabled' : ''} aria-label="下一頁">›</button></div>`;
}

/** 換地圖: the way to go on and the map (not the one being played); `go` when 發起投票. Returns what closes it. */
export function openMapSheet(root: HTMLElement, all: MapInfo[], current: number, go: (map: number, keep: boolean) => void): () => void {
  const maps = all.filter(m => m.id !== current);
  let keep = false, map = 0, page = 0;
  const overlay = document.createElement('div'), box = document.createElement('div');
  overlay.className = 'slots-overlay';
  box.className = 'msg sheet pt';
  overlay.append(box);
  root.append(overlay);
  fitToScreen(overlay, box);
  const close = () => overlay.remove();
  const draw = () => {
    box.innerHTML = `<div class="ribbon">換地圖</div>
      <div class="pt-types">
        <button class="pt-type${keep ? '' : ' on'}" data-keep="0"><b>重新開局</b><small>大家的錢和地都從頭開始</small></button>
        <button class="pt-type${keep ? ' on' : ''}" data-keep="1"><b>保留現在的錢</b><small>帶走現金和存款，其他清零</small></button>
      </div>
      <div class="pt-sec">選擇地圖</div>
      ${mapCards(maps, map, page)}
      <p class="pt-mapnote">在線的玩家全部同意就換，不用退出房間</p>
      <div class="choices"><button class="candy ghost" data-a="back">返回</button><button class="candy yes" data-a="go"${map ? '' : ' disabled'}>發起投票</button></div>`;
    shrinkText(box, '.pt-type b, .pt-type small', 8);
  };
  draw();
  overlay.addEventListener('pointerdown', e => e.stopPropagation());
  overlay.addEventListener('click', e => e.stopPropagation());
  box.onclick = e => {
    const t = e.target as HTMLElement;
    const k = t.closest<HTMLElement>('[data-keep]'), m = t.closest<HTMLElement>('[data-map]'), pg = t.closest<HTMLButtonElement>('[data-mp]'), a = t.closest<HTMLButtonElement>('[data-a]');
    if (k) { audio.ui('click'); keep = k.dataset.keep === '1'; draw(); return; }
    if (m) { audio.ui('click'); map = Number(m.dataset.map); draw(); return; }
    if (pg && !pg.disabled) { audio.ui('click'); page = Math.max(0, page + Number(pg.dataset.mp)); draw(); return; }
    if (a?.dataset.a === 'back') { audio.ui('no'); close(); return; }
    if (a?.dataset.a === 'go' && map) { audio.ui('yes'); close(); go(map, keep); }
  };
  return close;
}
