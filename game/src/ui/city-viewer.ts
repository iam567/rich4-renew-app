/**
 * 大富豪模式 「地圖」 (docs/rules/17 §12): look at any of the five cities as it is now — the board with its players,
 * buildings, owner colours, gods, NPCs and objects, which can be dragged and turned (read only) — with a summary of
 * who is there, who owns what, and the hospital and prison. Only the city looked at has its ground loaded; it is
 * released when another city is chosen or the sheet closes. Open only at the human's turn menu (the game waits).
 */
import { parseBoard, type RawMap } from '../core/board';
import { CHARACTERS } from '../core/characters';
import { LAND_INDEX, PLACES_PER_HOUSE, RESORT, type World } from '../core/world';
import { ASSETS, loadMapData, type MapArt, type MapDecor, type MapSprites } from './assets';
import { BoardView } from './board-view';
import type { Hud } from './hud';
import type { SpriteBank } from './sprites';
import { CITY_COLORS } from './tycoon';
import { audio } from './audio';
import { pickLayout } from './fit-list';
import { groundStyle, groundStylesFor, TiledGround } from './ground';
import { preloadBoard } from './board-preload';
import './loading.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };

/** A city's art without the shared image cache (so closing the viewer frees the ground). */
async function cityArt(w: World, i: number): Promise<MapArt> {
  const mapId = w.mapId(i);
  const raw = await loadMapData(mapId) as RawMap & { sprites?: MapSprites; decorations?: MapDecor[]; step_marks?: boolean; tycoon?: { sprites?: MapSprites } };
  const ground = new Image();
  ground.decoding = 'async';
  await new Promise<void>((ok, fail) => { ground.onload = () => ok(); ground.onerror = () => fail(new Error('地圖載入失敗')); ground.src = `${ASSETS}/maps/remake/${KEYS[mapId]}.png`; });
  return { board: parseBoard(raw), ground, sprites: { ...(raw.sprites ?? {}), ...(raw.tycoon?.sprites ?? {}) }, decor: raw.decorations ?? [], stepMarks: !!raw.step_marks };
}

/** The summary of a city: its 霸主, who is there (and on the way), the hospital and prison (no owners' list: the user 2026-10-19). */
function summary(w: World, i: number, bank: SpriteBank): string {
  const c = w.cities[i], b = c.board;
  const face = (ch: number) => { const f = bank.art('Data', 2, ch); return f ? `<img src="${f.src}" alt="">` : ''; };
  const here = w.players.filter(p => !p.bankrupt && p.map === i && !p.trip);
  const coming = w.players.filter(p => p.trip?.to === i);
  const who = (ps: typeof here) => ps.map(p => `<span class="cv-face" style="--c:${hex(CHARACTERS[p.character].color)}" title="${CHARACTERS[p.character].name}">${face(p.character)}</span>`).join('');
  // 城市霸主 (17 §3.8): more than half of the regular lots.
  const lord = w.overlordOf(i), mine = (q: number) => b.lands.filter(l => l.owner === q + 1).length;
  const lordLine = lord >= 0
    ? `<div class="cv-lord"><b>${esc(w.cityName(i))}霸主</b>${face(w.players[lord].character)}${esc(CHARACTERS[w.players[lord].character].name)}（普通用地 ${mine(lord)}/${b.lands.length}）</div>`
    : `<div class="cv-lord none"><b>霸主</b><span class="ph">從缺</span><span class="ph">（需超過半數普通用地：</span><span class="ph">${Math.floor(b.lands.length / 2) + 1}/${b.lands.length}）</span></div>`;
  return `<div class="cv-sum">${lordLine}
    <div><b>在這裡</b>${who(here) || '<em>沒有人</em>'}${coming.length ? `<b class="cv-coming">在路上</b>${who(coming)}` : ''}</div>
    <div><span class="cv-kv"><b>醫院</b>${w.occupancy(i, 'hospital')}/${PLACES_PER_HOUSE}</span><span class="cv-kv"><b>監獄</b>${w.occupancy(i, 'prison')}/${PLACES_PER_HOUSE}</span><span class="cv-kv"><b>地價</b>×${(LAND_INDEX[w.mapId(i)] ?? 1).toFixed(1)}</span>${RESORT[w.mapId(i)] ? `<span class="cv-kv"><b>度假勝地</b>旅館收入×${RESORT[w.mapId(i)].base}（夏季×${RESORT[w.mapId(i)].summer}）</span>` : ''}</div>
  </div>`;
}

export async function openCityViewer(hud: Hud, w: World, bank: SpriteBank, start: number): Promise<void> {
  const node = document.createElement('div');
  node.className = 'cv';
  node.innerHTML = '<div class="cv-tabs"></div><div class="cv-board"><div class="cv-load">載入中…</div></div><div class="cv-info"></div>';
  const tabs = node.querySelector<HTMLElement>('.cv-tabs')!, box = node.querySelector<HTMLElement>('.cv-board')!, info = node.querySelector<HTMLElement>('.cv-info')!;
  let view: BoardView | null = null, shown = -1, token = 0;
  const human = w.human();
  const renderTabs = () => {
    tabs.innerHTML = w.cities.map((_c, i) => {
      const id = w.mapId(i), n = w.population(i);
      return `<button class="chip${i === shown ? ' on' : ''}" data-city="${i}" style="--cc:${CITY_COLORS[id]}">${i === w.view() ? '<i class="cv-here"></i>' : ''}${esc(w.cityName(i))}${w.overlordOf(i) >= 0 ? '<i class="cv-crown"></i>' : ''} <small>${n}人 ×${(LAND_INDEX[id] ?? 1).toFixed(1)}</small></button>`;
    }).join('');
  };
  const show = async (i: number) => {
    const my = ++token;
    view?.destroy(); view = null;
    box.querySelectorAll('canvas, .info-bubble').forEach(e => e.remove());
    shown = i; renderTabs();
    info.innerHTML = summary(w, i, bank);
    fitInfo();
    requestAnimationFrame(fitInfo);
    // The city is covered (with its progress) until its first view is complete (ui/board-preload.ts).
    const load = box.querySelector<HTMLElement>('.cv-load')!;
    load.removeAttribute('hidden');
    load.innerHTML = '<div class="cv-load-bar"><div class="boot-track"><i class="boot-fill"></i><b class="boot-pct">0%</b></div></div>';
    const fill = load.querySelector<HTMLElement>('.boot-fill')!, pct = load.querySelector<HTMLElement>('.boot-pct')!;
    let shownPct = 0;
    const progress = (f: number) => { shownPct = Math.max(shownPct, Math.min(1, f)); fill.style.width = `${(shownPct * 100).toFixed(1)}%`; pct.textContent = `${Math.floor(shownPct * 100)}%`; };
    let art: MapArt, ground: TiledGround | null;
    try {
      // The chosen ground style, as in the game (its preview instead of decoding the original picture).
      const mapId = w.mapId(i), styles = await groundStylesFor(mapId), want = styles.includes(groundStyle()) ? groundStyle() : '';
      [art, ground] = await Promise.all([cityArt(w, i), want ? TiledGround.load(mapId, want) : null]);
    } catch (e) { if (my === token) load.textContent = (e as Error).message; return; }
    if (my !== token || !node.isConnected) { ground?.dispose(); return; }
    progress(0.15);
    bank.addMapSprites(art.sprites);
    w.mask(i);                      // the board's players as that city sees them (the game waits at the turn menu)
    const v = new BoardView(box, w.cities[i], art, bank);
    view = v;
    v.setGround(ground);
    v.setMode('free');
    v.syncAll();
    // Look at the human there, else at the first player there, else the middle.
    const p = (human && human.map === i ? human : null) ?? w.players.find(q => !q.bankrupt && q.map === i && !q.trip);
    if (p) v.snapTo(p.id); else v.lookAt(w.cities[i].board.size ? w.cities[i].board.size! / 2 : 1152, 1152);
    await preloadBoard(v, { aim: false, alive: () => my === token && node.isConnected, onProgress: f => progress(0.15 + 0.85 * f) });
    if (my !== token) return;
    load.setAttribute('hidden', '');
    fitInfo();
  };
  // Twelve faces beside the board on a short screen: smaller ones until the summary fits (關閉 under the viewer
  // never covers its last line).
  const fitInfo = () => {
    const sum = info.querySelector<HTMLElement>('.cv-sum');
    if (!sum || !info.clientHeight) return;
    const fits = () => info.scrollHeight <= info.clientHeight + 1 && info.scrollWidth <= info.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1;
    pickLayout(['', 'tight'], cls => { sum.classList.toggle('tight', !!cls); }, fits);
  };
  new ResizeObserver(() => fitInfo()).observe(info);
  tabs.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-city]');
    if (!b) return;
    audio.ui('click');
    void show(Number(b.dataset.city));
  });
  renderTabs();
  const closed = hud.sheetNode('各城市地圖', node);
  void show(start);
  await closed;
  token++;
  (view as BoardView | null)?.destroy();
  w.mask(w.view());
}
