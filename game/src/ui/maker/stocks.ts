/**
 * 自建地圖's 股票 (the user 2026-11-12): the map picks one of the eight stock tables as its template and may rename any of
 * its 12 stocks. Only names: every stock stays, with its price, its swings and what the events and companies do with
 * its slot — the 銀行, 保險 and 百貨 stocks and the others the table means for companies are marked 特別.
 */
import { STOCK_TABLE } from '../../core/modules/stocks';
import { audio } from '../audio';
import { t as tr } from '../lang';
import { companyKind, type MakerMap } from './model';

export const STOCK_TEMPLATES = ['台灣', '中國大陸', '日本', '美國', '星際', '武俠', '恐龍', '假期'];

/**
 * Each template's companies as the original map of it has them (editor/site/assets/map-N.json): stock slot, category,
 * worth, base fee. A player's map gets them all (compile.ts records): the bank on every 銀行 square, the department
 * store on every 道具店, the rest with no square of their own — the insurer still pays the 理賠金.
 */
export const TEMPLATE_COMPANIES: [slot: number, cat: number, value: number, fee: number][][] = [
  [[1, 4, 400000, 750], [2, 10, 200000, 0], [0, 7, 900000, 0]],
  [[3, 6, 120000, 500], [1, 4, 288000, 600], [0, 7, 560000, 0], [2, 10, 160000, 0]],
  [[2, 10, 176000, 0], [5, 5, 270000, 700], [3, 11, 244000, 5000], [1, 4, 790000, 1000], [4, 3, 2400000, 150], [0, 7, 1000000, 0]],
  [[4, 5, 120000, 700], [3, 1, 244000, 2500], [1, 4, 440000, 800], [5, 3, 4000000, 200], [2, 10, 160000, 0], [0, 7, 1000000, 0]],
  [[1, 4, 440000, 800], [0, 7, 100000, 0], [2, 10, 176000, 0]],
  [[1, 4, 440000, 800], [5, 12, 270000, 700], [4, 12, 440000, 800], [6, 12, 270000, 700], [7, 12, 120000, 500], [8, 12, 270000, 700], [11, 2, 790000, 1000], [9, 12, 120000, 500], [3, 12, 790000, 1000], [10, 12, 440000, 800], [0, 7, 560000, 0], [2, 10, 176000, 0]],
  [[1, 4, 400000, 750], [0, 7, 560000, 0], [2, 10, 176000, 0]],
  [[2, 2, 790000, 1000], [3, 2, 440000, 800], [5, 2, 288000, 600], [4, 2, 400000, 750], [6, 2, 288000, 600], [0, 7, 900000, 0], [1, 10, 200000, 0]],
];
/** What a template's company stock does on a player's map (the user 2026-11-13: tell the maker), by category. */
const ROLE: Record<number, string> = {
  7: '銀行：最大股東在銀行格可以申請融資',
  10: '百貨：最大股東停在道具店會收到禮物',
  4: '保險：保險期間的理賠金由它支付',
};
/** The others work only on a building of their own (stopping there pays its fee): a 企業大樓 on the map (格子). */
const OWN: Record<number, [string, string]> = { 6: ['石油', '加油費'], 5: ['汽車', '修車費'], 3: ['電腦', '電腦費'], 11: ['建設', '工程費'], 1: ['航空', '旅遊費'], 2: ['飯店', '住宿費'], 12: ['門派', '過路費'] };

/** A 企業大樓's company: its stock slot, category and record (`tpl` the template company it is, -1 a new one). */
export interface CoBind { slot: number; cat: number; value: number; fee: number; tpl: number }
/**
 * Which stock each 企業大樓 is (the lots' order, the same on every phone): the template's company of its kind first,
 * else a stock no company uses, else a template company that has no square of its own on a player's map (not the bank,
 * the department store or the insurer). None left (12 stocks): not in the map — the editor refuses such a building.
 */
export function companySlots(m: MakerMap): Map<number, CoBind> {
  const group = ((m.stocks?.group ?? 0) % 8 + 8) % 8, tpl = TEMPLATE_COMPANIES[group];
  const out = new Map<number, CoBind>(), taken = new Set<number>();
  const used = new Set(tpl.map(c => c[0]));
  const free = Array.from({ length: 12 }, (_, i) => i).filter(i => !used.has(i));
  const spare = tpl.map((_, k) => k).filter(k => ![7, 10, 4].includes(tpl[k][1]));
  for (const l of m.lots) {
    const kind = l.kind === 2 ? companyKind(l.co) : undefined;
    if (!kind) continue;
    let k = tpl.findIndex((c, i) => c[1] === kind.cat && !taken.has(i));
    if (k >= 0) { taken.add(k); out.set(l.id, { slot: tpl[k][0], cat: kind.cat, value: tpl[k][2], fee: tpl[k][3], tpl: k }); continue; }
    const s = free.shift();
    if (s !== undefined) { out.set(l.id, { slot: s, cat: kind.cat, value: kind.value, fee: kind.fee, tpl: -1 }); continue; }
    k = spare.find(i => !taken.has(i)) ?? -1;
    if (k >= 0) { taken.add(k); out.set(l.id, { slot: tpl[k][0], cat: kind.cat, value: kind.value, fee: kind.fee, tpl: k }); }
  }
  return out;
}

/** The 12 stocks' names before the maker's own: the template's, a 企業大樓's new company its kind's (石油公司, 航空公司 2 …). */
function baseNames(m: MakerMap, binds = companySlots(m)): string[] {
  const g = ((m.stocks?.group ?? 0) % 8 + 8) % 8, tpl = TEMPLATE_COMPANIES[g];
  const names = STOCK_TABLE[g].map(d => d.name), seen = new Map<string, number>();
  for (const [id, b] of binds) {
    if (b.tpl >= 0 && tpl[b.tpl][1] === b.cat) continue;                    // the template's own company keeps its name
    const firm = companyKind(m.lots.find(l => l.id === id)?.co)?.firm ?? '企業';
    const n = (seen.get(firm) ?? 0) + 1;
    seen.set(firm, n);
    names[b.slot] = n > 1 ? `${firm}${n}` : firm;
  }
  return names;
}

/** What a stock slot is on this map (the sheet's line under it): its building, its square, or nothing yet. */
export function companyRole(m: MakerMap, slot: number): string {
  for (const b of companySlots(m).values()) {
    if (b.slot !== slot) continue;
    const k = companyKind(b.cat);
    return `${k?.name}：地圖上的企業大樓，${k?.what}`;
  }
  const c = TEMPLATE_COMPANIES[((m.stocks?.group ?? 0) % 8 + 8) % 8]?.find(x => x[0] === slot);
  if (!c) return '';
  const own = OWN[c[1]], kind = companyKind(c[1]);
  return ROLE[c[1]] ?? (kind ? `${own?.[0] ?? '企業'}：在「格子」蓋一座${kind.name}大樓才有用，沒蓋就當普通股票` : `${own?.[0] ?? '企業'}：自建地圖沒有這種公司的大樓，當普通股票`);
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The map's 12 stock names: its own where given, else a 企業大樓's company's, else its template's. */
export function stockNames(m: MakerMap): string[] {
  const base = baseNames(m);
  return base.map((d, i) => m.stocks?.names[i]?.trim() || d);
}

/** Opens the sheet over `root`; `changed` after every change (the editor saves at once). */
export function stockSheet(root: HTMLElement, m: MakerMap, changed: () => void) {
  m.stocks ??= { group: 0, names: [] };
  const st = m.stocks;
  const ov = document.createElement('div');
  ov.className = 'slots-overlay mk-ov mk-deck-ov';
  ov.innerHTML = `<div class="msg sheet mk-deck"><div class="ribbon">股票</div>
    <div class="mk-deck-top"><span class="mk-dim">模板</span><div class="chips mk-stock-tpl"></div></div>
    <p class="mk-deck-hint">先選一套股票做模板，再給每支股票改名字（空著就用模板的名字）。12 支股票都會在，股價和漲跌照模板。標「特別」的是公司股票，下面寫著它在這張地圖上管什麼：改名時最好名字也像銀行、百貨、保險，玩家才看得懂。</p>
    <div class="mk-deck-list mk-stock-list"></div>
    <div class="choices"><button class="candy ghost" data-s="clear">名字全部恢復模板</button><button class="candy yes" data-s="ok">好</button></div></div>`;
  root.append(ov);
  const tpl = ov.querySelector<HTMLElement>('.mk-stock-tpl')!, list = ov.querySelector<HTMLElement>('.mk-stock-list')!;
  function draw() {
    tpl.innerHTML = STOCK_TEMPLATES.map((n, i) => `<button class="chip${i === st.group ? ' on' : ''}" data-g="${i}">${n}</button>`).join('');
    const base = baseNames(m);
    list.innerHTML = STOCK_TABLE[st.group].map((d, i) => { const role = companyRole(m, i); return `<label class="mk-deck-row mk-stock-row"><b class="mk-stock-no">${i + 1}</b>
      <span class="mk-deck-main"><input class="mk-deck-name" data-n="${i}" maxlength="8" placeholder="${esc(tr(base[i]))}" value="${esc(st.names[i] ?? '')}">${d.linked || role ? '<b class="mk-tag">特別</b>' : ''}
      <small>模板：${esc(tr(d.name))}　股價 ${d.price} 元　${d.vol >= 1.5 ? '大起大落' : d.vol <= .8 ? '穩' : '一般'}</small>${role ? `<small class="mk-stock-role">${role}</small>` : ''}</span></label>`; }).join('');
  }
  draw();
  ov.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.n) return;
    const i = Number(t.dataset.n), v = t.value.trim().slice(0, 8);
    const own = baseNames(m)[i];
    st.names[i] = v === own || v === tr(own) ? '' : v;
    while (st.names.length && !st.names[st.names.length - 1]) st.names.pop();
    changed();
  });
  ov.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.g) { st.group = Number(b.dataset.g); audio.ui('click'); changed(); draw(); return; }
    if (b.dataset.s === 'clear') { st.names = []; audio.ui('click'); changed(); draw(); return; }
    if (b.dataset.s === 'ok') { audio.ui('yes'); ov.remove(); }
  });
}
