/**
 * The results as a picture (「儲存到相簿」 / 「分享」, docs/rules/20 §4): drawn on a canvas in the results screen's style
 * (the blue board with the orange and purple frame, the gold ribbon), 1080 px wide, portrait: the winner, the ranking
 * and one player's main figures. Text follows the chosen script (lang.ts).
 */
import { CHARACTERS } from '../core/characters';
import { format } from '../core/date';
import { sum, type GameResults, type PlayerResult } from '../core/stats';
import { ASSETS, image, portrait } from './assets';
import { t } from './lang';

/** The statistics icons (tools/tycoon-art/stats_icons.py → maps/remake/stats/<name>.webp); also drawn on the share card. */
export type StatIcon = 'assets' | 'money' | 'land' | 'build' | 'facility' | 'stock' | 'toll-in' | 'toll-out' | 'cards' | 'tools'
  | 'lucky' | 'unlucky' | 'rivals' | 'confine' | 'lottery' | 'minigame' | 'casino' | 'trophy' | 'cities' | 'crown' | 'gods' | 'days';
export const statIcon = (name: StatIcon) => `${ASSETS}/maps/remake/stats/${name}.webp`;


const W = 1080;
const FONT = '"Huninn", "PingFang TC", "Hiragino Sans CNS", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const money = (n: number) => Math.trunc(n).toLocaleString('en-US');
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;

function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', shadow = true, maxW?: number) {
  c.font = `${size}px ${FONT}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if (shadow) { c.fillStyle = 'rgba(11, 33, 96, .9)'; c.fillText(t(s), x + 2, y + 3, maxW); }
  c.fillStyle = color;
  c.fillText(t(s), x, y, maxW);
}

/** The face as the screen shows it (the redrawn one when there is one), else the original portrait. */
async function faceImage(character: number, src?: string): Promise<HTMLImageElement | null> {
  try { return src ? await image(src) : await portrait(character); } catch {
    try { return await portrait(character); } catch { return null; }
  }
}

function drawFace(c: CanvasRenderingContext2D, img: HTMLImageElement | null, character: number, x: number, y: number, r: number, grey = false) {
  c.save();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.closePath();
  c.fillStyle = '#fff'; c.fill();
  c.clip();
  if (img) {
    if (grey) c.filter = 'grayscale(1) brightness(.85)';
    const s = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight);
    c.drawImage(img, x - (img.naturalWidth * s) / 2, y - (img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    c.filter = 'none';
  }
  c.restore();
  c.lineWidth = Math.max(4, r / 9);
  c.strokeStyle = hex(CHARACTERS[character].color);
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
}

function crown(c: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const h = w * 0.58;
  const g = c.createLinearGradient(0, y - h, 0, y);
  g.addColorStop(0, '#fff07a'); g.addColorStop(1, '#e0a000');
  c.fillStyle = g;
  c.beginPath();
  const l = x - w / 2;
  c.moveTo(l, y); c.lineTo(l, y - h * 0.7); c.lineTo(l + w * 0.22, y - h * 0.4); c.lineTo(x, y - h);
  c.lineTo(l + w * 0.78, y - h * 0.4); c.lineTo(l + w, y - h * 0.7); c.lineTo(l + w, y); c.closePath();
  c.fill();
  c.lineWidth = 4; c.strokeStyle = '#a06000'; c.stroke();
}

export interface CardOptions {
  mapName: string;
  featured: PlayerResult;
  /** The face picture of a character as on screen (SpriteBank.art('Data', 2, c).src). */
  faceSrc?: (character: number) => string | undefined;
}

/** Draws the results picture. */
export async function drawResultsCard(r: GameResults, o: CardOptions): Promise<HTMLCanvasElement> {
  try { await document.fonts?.load(`32px ${FONT}`); } catch { /* the fallback fonts draw it */ }
  const many = r.players.length > 4;
  const rowH = many ? 64 : 108;
  // The figures of the player shown, each with its icon (tools/tycoon-art/stats_icons.py).
  const s = o.featured.stats;
  const tiles: [StatIcon, string, string, string?][] = [
    ['land', '買地', `${s.landsBought} 塊`], ['build', '蓋房', `${s.buildings} 次`], ['facility', '大型設施', `${sum(s.facilitiesBuilt)} 座`],
    ['stock', '股票獲利', signed(s.stockProfit), s.stockProfit >= 0 ? '#9af5a4' : '#ffb0b0'], ['toll-in', '過路費收入', money(s.tollsReceived)], ['toll-out', '過路費支出', money(s.tollsPaid)],
    ['cards', '用了卡片', `${sum(s.cardsUsed)} 張`], ['tools', '用了道具', `${sum(s.toolsUsed)} 個`], ['rivals', '打倒對手', `${s.rivalsBankrupted}`],
    ['lucky', '幸運事件', `${s.lucky}`, '#9af5a4'], ['unlucky', '倒楣事件', `${s.unlucky}`, '#ffb0b0'], ['trophy', '最高資產', money(Math.max(s.maxAssets, o.featured.assets))],
    // 大富豪模式: cities visited, 霸主 titles, days in hospital / prison.
    ...(r.cityNames ? [['cities', '去過城市', `${s.cities.length} 座`], ['crown', '城市霸主', `${s.overlordCities.length} 座`],
      ['confine', '住院／坐牢', `${s.hospitalDays}／${s.prisonDays} 天`]] as [StatIcon, string, string][] : []),
  ];
  const statsRows = Math.ceil(tiles.length / 3);
  const H = 120 + 360 + 40 + r.players.length * rowH + 60 + 70 + statsRows * 118 + 40;
  const icons = new Map<string, HTMLImageElement | null>();
  await Promise.all([...tiles.map(x => x[0]), 'days' as StatIcon].map(async n => { icons.set(n, await image(statIcon(n)).catch(() => null)); }));
  const drawIcon = (n: string, x: number, y: number, size: number) => {
    const img = icons.get(n);
    if (!img) return false;
    const k = size / Math.max(img.naturalWidth, img.naturalHeight);
    c.drawImage(img, x + (size - img.naturalWidth * k) / 2, y + (size - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
    return true;
  };
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!;
  const faces = new Map<number, HTMLImageElement | null>();
  await Promise.all(r.players.map(async p => { faces.set(p.character, await faceImage(p.character, o.faceSrc?.(p.character))); }));

  // Background and the board.
  const bg = c.createRadialGradient(W / 2, 200, 50, W / 2, H / 2, H);
  bg.addColorStop(0, '#5a2d9a'); bg.addColorStop(1, '#170a33');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const bx = 40, by = 80, bw = W - 80, bh = H - 120;
  round(c, bx - 12, by - 12, bw + 24, bh + 24, 52); c.fillStyle = '#8a3bd1'; c.fill();
  round(c, bx - 6, by - 6, bw + 12, bh + 12, 46); c.fillStyle = '#ffa21f'; c.fill();
  const board = c.createRadialGradient(W / 2, by, 40, W / 2, by + bh * 0.4, bh);
  board.addColorStop(0, '#4b95f5'); board.addColorStop(0.55, '#2160cf'); board.addColorStop(1, '#17469e');
  round(c, bx, by, bw, bh, 40); c.fillStyle = board; c.fill();
  c.setLineDash([10, 8]); c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.5)';
  round(c, bx + 12, by + 12, bw - 24, bh - 24, 30); c.stroke(); c.setLineDash([]);

  // Ribbon.
  const rw = 320, rx = (W - rw) / 2, ry = by - 36;
  round(c, rx, ry, rw, 72, 36);
  const rg = c.createLinearGradient(0, ry, 0, ry + 72); rg.addColorStop(0, '#fff07a'); rg.addColorStop(1, '#ffbf2e');
  c.fillStyle = rg; c.fill(); c.lineWidth = 6; c.strokeStyle = '#fff'; c.stroke();
  text(c, '遊戲結算', W / 2, ry + 38, 40, '#5a2d00', 'center', false);

  // The winner (or the player shown).
  const win = r.players.find(p => p.winner) ?? o.featured;
  const hy = by + 200;
  if (r.players.some(p => p.winner)) crown(c, 250, hy - 118, 120);
  drawFace(c, faces.get(win.character) ?? null, win.character, 250, hy, 112, !win.winner);
  const name = CHARACTERS[win.character].name;
  text(c, win.winner ? `${name}獲勝！` : '遊戲結束', 400, hy - 50, 72, '#ffe14a', 'left', true, 600);
  const dx = drawIcon('days', 400, hy + 8, 44) ? 452 : 404;
  text(c, `${o.mapName}・${r.days} 天・${format(r.date)}`, dx, hy + 30, 34, '#fff', 'left', true, 620 - (dx - 404));
  if (win.titles.length) text(c, win.titles[win.titles.length - 1], 404, hy + 82, 32, '#ffd27a', 'left', true, 600);

  // Ranking.
  let y = by + 380;
  text(c, '排名', bx + 50, y, 34, '#ffe14a');
  y += 40;
  for (const p of r.players) {
    const ch = CHARACTERS[p.character];
    round(c, bx + 36, y, bw - 72, rowH - 10, 20);
    c.fillStyle = p.winner ? 'rgba(255, 225, 74, .28)' : p.p === o.featured.p ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.1)'; c.fill();
    const cy = y + (rowH - 10) / 2, fr = (rowH - 26) / 2;
    const medal = ['#ffd84a', '#e8eef8', '#e0a070'][p.rank - 1] ?? '#7a8ab8';
    c.fillStyle = medal; c.beginPath(); c.arc(bx + 84, cy, many ? 22 : 30, 0, Math.PI * 2); c.fill();
    text(c, String(p.rank), bx + 84, cy + 1, many ? 26 : 36, '#3a2000', 'center', false);
    drawFace(c, faces.get(p.character) ?? null, p.character, bx + 160, cy, fr, p.bankrupt);
    text(c, `${ch.name}${p.human ? '（玩家）' : ''}`, bx + 160 + fr + 22, cy - (many ? 0 : 16), many ? 30 : 38, '#fff', 'left', true, 360);
    if (!many) text(c, p.bankrupt ? `第 ${p.fellDay + 1} 天破產` : `土地 ${p.lots}・房屋 ${p.houses} 級・大型 ${p.plots}`, bx + 160 + fr + 22, cy + 26, 26, '#cfe0ff', 'left', false, 380);
    text(c, p.bankrupt ? '破產' : `$${money(p.assets)}`, bx + bw - 70, cy, many ? 30 : 40, p.bankrupt ? '#c8d0e0' : '#ffe14a', 'right', true);
    y += rowH;
  }

  // The figures of the player shown.
  y += 30;
  text(c, `${CHARACTERS[o.featured.character].name}的成績`, bx + 50, y, 34, '#ffe14a');
  y += 36;
  const tw = (bw - 72 - 2 * 16) / 3;
  tiles.forEach(([ic, label, value, color], i) => {
    const tx = bx + 36 + (i % 3) * (tw + 16), ty = y + Math.floor(i / 3) * 118;
    round(c, tx, ty, tw, 104, 20); c.fillStyle = 'rgba(255,255,255,.14)'; c.fill();
    const left = drawIcon(ic, tx + 12, ty + 16, 72) ? 84 : 0, cx = tx + left + (tw - left) / 2;
    text(c, label, cx, ty + 30, 26, '#cfe0ff', 'center', false, tw - left - 14);
    text(c, value, cx, ty + 70, 36, color ?? '#fff', 'center', true, tw - left - 14);
  });
  y += statsRows * 118 + 20;
  text(c, `大富翁4 重製版・${format(r.date)}`, W / 2, H - 80, 26, 'rgba(255,255,255,.75)', 'center', false);
  return canvas;
}
