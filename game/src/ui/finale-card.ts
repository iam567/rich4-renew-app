/**
 * The 最終決戰 page as one picture (1080 px wide) for 「儲存到相簿」 / 「分享」 (the user 2026-10-19): the title over 大富翁城,
 * the four finalists with their chips, each line of the formula and the badges, as the screen shows them.
 */
import { CHARACTERS } from '../core/characters';
import type { FinalistChips, Valuation } from '../core/finale';
import { ASSETS, image } from './assets';
import { drawFace, faceImage, FONT, round, text } from './results-card';

const W = 1080;
const n = (x: number) => Math.trunc(x).toLocaleString('en-US');

export async function drawFinaleCard(o: { vals: Valuation[]; chips: FinalistChips[]; human?: number; characterOf: (p: number) => number; faceSrc?: (c: number) => string | undefined; date?: string }): Promise<HTMLCanvasElement> {
  try { await document.fonts?.load(`32px ${FONT}`); } catch { /* fallback fonts */ }
  const cards = o.vals.map(v => ({ v, c: o.chips.find(x => x.p === v.p), ch: o.characterOf(v.p) }));
  const lineH = 44, cardW = (W - 60 * 2 - 30) / 2;
  const cardH = Math.max(...cards.map(({ c }) => 150 + Math.ceil(((c?.lines ?? []).filter(l => l.chips > 0).length || 1) / 2) * lineH + Math.ceil((c?.badges.length ?? 0) / 2) * 52 + 90));
  const H = 330 + Math.ceil(cards.length / 2) * (cardH + 30) + 120;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d')!;
  // 大富翁城 behind, darkened, with rays.
  const bg = await image(`${ASSETS}/maps/remake/finale-postcard.webp`).catch(() => null);
  g.fillStyle = '#3a1450'; g.fillRect(0, 0, W, H);
  if (bg) { const k = Math.max(W / bg.naturalWidth, H / bg.naturalHeight); g.drawImage(bg, (W - bg.naturalWidth * k) / 2, (H - bg.naturalHeight * k) / 2, bg.naturalWidth * k, bg.naturalHeight * k); }
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(40,10,60,.55)'); shade.addColorStop(.5, 'rgba(40,10,60,.35)'); shade.addColorStop(1, 'rgba(30,5,40,.75)');
  g.fillStyle = shade; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W / 2, 170); g.globalAlpha = .18; g.fillStyle = '#ffe9a0';
  for (let k = 0; k < 18; k++) { g.rotate(Math.PI / 9); g.beginPath(); g.moveTo(0, 0); g.lineTo(-60, -1400); g.lineTo(60, -1400); g.closePath(); g.fill(); }
  g.restore();
  // The title.
  const tg = g.createLinearGradient(0, 80, 0, 220);
  tg.addColorStop(0, '#fff6c0'); tg.addColorStop(1, '#ffb52e');
  g.font = `900 132px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = '#6a1a10'; g.strokeText('最終決戰', W / 2, 160);
  g.fillStyle = tg; g.fillText('最終決戰', W / 2, 160);
  text(g, `只剩 ${cards.length} 人！全體前往 大富翁城`, W / 2, 262, 40, '#fff', 'center');
  // The four finalists.
  for (const [k, { v, c, ch }] of cards.entries()) {
    const x = 60 + (k % 2) * (cardW + 30), y = 320 + Math.floor(k / 2) * (cardH + 30);
    round(g, x, y, cardW, cardH, 30);
    const cg = g.createLinearGradient(0, y, 0, y + cardH);
    cg.addColorStop(0, '#fffbe8'); cg.addColorStop(1, '#ffd77a');
    g.fillStyle = cg; g.fill();
    g.lineWidth = 6; g.strokeStyle = v.p === o.human ? '#ff5a3a' : '#fff'; g.stroke();
    drawFace(g, await faceImage(ch, o.faceSrc?.(ch)), ch, x + 70, y + 72, 46);
    text(g, CHARACTERS[ch]?.name ?? '', x + 132, y + 72, 44, '#4a2a00', 'left', false, cardW - 220);
    if (v.p === o.human) { round(g, x + cardW - 92, y + 50, 64, 44, 22); g.fillStyle = '#e8402a'; g.fill(); text(g, '你', x + cardW - 60, y + 72, 30, '#fff', 'center', false); }
    const lines = (c?.lines ?? []).filter(l => l.chips > 0);
    lines.forEach((l, i) => {
      const lx = x + 28 + (i % 2) * ((cardW - 56) / 2), ly = y + 150 + Math.floor(i / 2) * lineH, colW = (cardW - 56) / 2 - 14;
      text(g, l.label, lx, ly, 27, '#6a4210', 'left', false, colW - 70);
      text(g, n(l.chips), lx + colW, ly, 28, '#3a1a00', 'right', false);
    });
    const by = y + 150 + Math.ceil((lines.length || 1) / 2) * lineH + 10;
    (c?.badges ?? []).forEach((b, i) => {
      const bw = (cardW - 70) / 2, bx = x + 28 + (i % 2) * (bw + 14), yy = by + Math.floor(i / 2) * 52;
      round(g, bx, yy, bw, 42, 21); g.fillStyle = '#e8402a'; g.fill();
      text(g, `${b.label} +${b.chips}`, bx + bw / 2, yy + 21, 24, '#fff', 'center', false, bw - 16);
    });
    g.strokeStyle = 'rgba(200,120,20,.5)'; g.setLineDash([12, 10]); g.lineWidth = 3;
    g.beginPath(); g.moveTo(x + 24, y + cardH - 80); g.lineTo(x + cardW - 24, y + cardH - 80); g.stroke(); g.setLineDash([]);
    text(g, '籌碼', x + cardW / 2 - 70, y + cardH - 40, 32, '#8a4a10', 'right', false);
    text(g, n(c?.total ?? 0), x + cardW / 2 - 50, y + cardH - 40, 54, '#d0261a', 'left', false);
  }
  text(g, `大富翁4 重製版・大富豪模式${o.date ? `・${o.date}` : ''}`, W / 2, H - 56, 30, 'rgba(255,255,255,.85)', 'center');
  return canvas;
}
