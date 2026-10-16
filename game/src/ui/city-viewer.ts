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

/** The summary of a city: who is there, who owns how much, the hospital and prison. */
function summary(w: World, i: number, bank: SpriteBank): string {
  const c = w.cities[i], b = c.board;
  const face = (ch: number) => { const f = bank.art('Data', 2, ch); return f ? `<img src="${f.src}" alt="">` : ''; };
  const here = w.players.filter(p => !p.bankrupt && p.map === i && !p.trip);
  const coming = w.players.filter(p => p.trip?.to === i);
  const owners = w.players.map(p => {
    const me = p.id + 1;
    const lots = b.lands.filter(l => l.owner === me).length + b.facilities.filter(f => f.owner === me).length;
    const houses = b.lands.filter(l => l.owner === me && (l.level > 0 || l.chain)).length + b.facilities.filter(f => f.owner === me && f.level > 0).length;
    return { p, lots, houses };
  }).filter(x => x.lots > 0).sort((a, z) => z.lots - a.lots);
  const who = (ps: typeof here) => ps.map(p => `<span class="cv-face" style="--c:${hex(CHARACTERS[p.character].color)}" title="${CHARACTERS[p.character].name}">${face(p.character)}</span>`).join('');
  const free = b.lands.filter(l => !l.owner).length + b.facilities.filter(f => !f.owner).length;
  return `<div class="cv-sum">
    <div><b>在這裡</b>${who(here) || '<em>沒有人</em>'}${coming.length ? `<b class="cv-coming">在路上</b>${who(coming)}` : ''}</div>
    <div><b>地主</b>${owners.map(o => `<span class="cv-own" style="--c:${hex(CHARACTERS[o.p.character].color)}">${esc(CHARACTERS[o.p.character].name)} ${o.lots}塊${o.houses ? `・${o.houses}棟` : ''}</span>`).join('') || '<em>還沒有人買地</em>'}<span class="cv-own free">空地 ${free}</span></div>
    <div><b>醫院</b>${w.occupancy(i, 'hospital')}/${PLACES_PER_HOUSE}　<b>監獄</b>${w.occupancy(i, 'prison')}/${PLACES_PER_HOUSE}　<b>地價</b>×${(LAND_INDEX[w.mapId(i)] ?? 1).toFixed(1)}${RESORT[w.mapId(i)] ? `　<b>度假勝地</b>旅館收入×${RESORT[w.mapId(i)].base}（夏季×${RESORT[w.mapId(i)].summer}）` : ''}</div>
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
      return `<button class="chip${i === shown ? ' on' : ''}" data-city="${i}" style="--cc:${CITY_COLORS[id]}">${i === w.view() ? '<i class="cv-here"></i>' : ''}${esc(w.cityName(i))} <small>${n}人 ×${(LAND_INDEX[id] ?? 1).toFixed(1)}</small></button>`;
    }).join('');
  };
  const show = async (i: number) => {
    const my = ++token;
    view?.destroy(); view = null;
    box.querySelectorAll('canvas, .info-bubble').forEach(e => e.remove());
    shown = i; renderTabs();
    info.innerHTML = summary(w, i, bank);
    box.querySelector('.cv-load')?.removeAttribute('hidden');
    let art: MapArt;
    try { art = await cityArt(w, i); } catch (e) { if (my === token) box.querySelector('.cv-load')!.textContent = (e as Error).message; return; }
    if (my !== token || !node.isConnected) return;
    bank.addMapSprites(art.sprites);
    w.mask(i);                      // the board's players as that city sees them (the game waits at the turn menu)
    view = new BoardView(box, w.cities[i], art, bank);
    view.setMode('free');
    view.syncAll();
    // Look at the human there, else at the first player there, else the middle.
    const p = (human && human.map === i ? human : null) ?? w.players.find(q => !q.bankrupt && q.map === i && !q.trip);
    if (p) view.snapTo(p.id); else view.lookAt(w.cities[i].board.size ? w.cities[i].board.size! / 2 : 1152, 1152);
    box.querySelector('.cv-load')?.setAttribute('hidden', '');
  };
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
