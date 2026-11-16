/**
 * 強制修復 (the user 2026-11-14: 「玩家實在不知道該怎麼改的時候，讓系統幫玩家改成正確的」): what 檢查 finds, put right
 * on the map itself as far as it can be — road ends joined, the road's pieces connected and its dead ends looped back,
 * one hospital, one prison, a bank, lots on plain squares, enough lots, a deck the game can use, pieces moved off the
 * road. Returns what it did, in words; the editor makes it one undo step. A road under 12 squares it cannot invent.
 */
import { DECK_MIN } from './deck';
import { covering } from './layers';
import { CELL, type MakerMap, type MkLot, type MkNode } from './model';

const HOSPITAL = 5, PRISON = 4, BANK = 14;

function linkNodes(a: MkNode, b: MkNode) {
  if (a === b) return;
  if (!a.links.includes(b.id)) a.links.push(b.id);
  if (!b.links.includes(a.id)) b.links.push(a.id);
}

/**
 * Two road ends almost on one spot become one square; ends a step apart (a little more or less where a 45° road meets a
 * straight one) join. The editor runs it after every road stroke and before the check; returns how many it changed.
 */
export function joinEnds(m: MakerMap): number {
  let made = 0;
  for (let again = true; again;) {
    again = false;
    const ends = m.nodes.filter(n => n.links.length < 2);
    for (let i = 0; i < ends.length && !again; i++) for (let j = i + 1; j < ends.length && !again; j++) {
      const a = ends[i], b = ends[j];
      if (a.links.includes(b.id) || Math.hypot(a.cx - b.cx, a.cy - b.cy) >= 0.6) continue;
      for (const id of b.links) {
        const o = m.nodes.find(x => x.id === id);
        if (!o || o === a) continue;
        o.links = o.links.filter(x => x !== b.id);
        linkNodes(a, o);
      }
      if (!a.ev && b.ev) a.ev = b.ev;
      for (const l of m.lots) l.nodes = [...new Set(l.nodes.map(id => (id === b.id ? a.id : id)))];
      m.nodes = m.nodes.filter(x => x !== b);
      made++; again = true;
    }
  }
  const ends = m.nodes.filter(n => n.links.length < 2);
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const a = ends[i], b = ends[j];
    if (a.links.length >= 2 || b.links.length >= 2 || a.links.includes(b.id)) continue;
    if (Math.abs(Math.hypot(a.cx - b.cx, a.cy - b.cy) - 1) > 0.3) continue;
    linkNodes(a, b); made++;
  }
  return made;
}

const lotCells = (l: Pick<MkLot, 'cx' | 'cy' | 'kind'>) => (l.kind ? [[l.cx, l.cy], [l.cx + 1, l.cy], [l.cx, l.cy + 1], [l.cx + 1, l.cy + 1]] : [[l.cx, l.cy]]);

/** The grid as the road's way sees it: cells with a lot on them are closed; cells with a square name it. */
function grid(m: MakerMap) {
  const lotCell = new Set<number>(), nodeCell = new Map<number, MkNode>();
  for (const l of m.lots) for (const [x, y] of lotCells(l)) lotCell.add(y * m.w + x);
  for (const n of m.nodes) { const x = Math.round(n.cx), y = Math.round(n.cy); if (x >= 0 && y >= 0 && x < m.w && y < m.h) nodeCell.set(y * m.w + x, n); }
  return { lotCell, nodeCell };
}

/**
 * The shortest way of new squares from `from` over open cells (straight steps) to a square `ok` accepts; the new
 * squares are made and linked, the last one to that square. False: no way.
 */
function roadTo(m: MakerMap, from: MkNode, ok: (n: MkNode) => boolean): boolean {
  const { lotCell, nodeCell } = grid(m);
  const W = m.w, H = m.h, start = Math.round(from.cy) * W + Math.round(from.cx);
  const prev = new Int32Array(W * H).fill(-2);
  prev[start] = -1;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi], x = c % W, y = (c - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (prev[k] !== -2 || lotCell.has(k)) continue;
      prev[k] = c;
      const hit = nodeCell.get(k);
      if (hit) {
        if (hit === from || !ok(hit)) continue;
        // found: the open cells between become squares
        const path: number[] = [];
        for (let p = c; p !== start && p >= 0; p = prev[p]) path.unshift(p);
        let last = from;
        for (const p of path) {
          const n: MkNode = { id: m.nextId++, cx: p % W, cy: (p - (p % W)) / W, links: [], ev: 0, style: from.style };
          m.nodes.push(n); linkNodes(last, n); last = n;
        }
        linkNodes(last, hit);
        return true;
      }
      queue.push(k);
    }
  }
  return false;
}

/** The road's connected pieces, the largest first. */
function pieces(m: MakerMap): MkNode[][] {
  const byId = new Map(m.nodes.map(n => [n.id, n])), seen = new Set<number>(), out: MkNode[][] = [];
  for (const n of m.nodes) {
    if (seen.has(n.id)) continue;
    const part: MkNode[] = [], todo = [n.id];
    while (todo.length) { const id = todo.pop()!; if (seen.has(id)) continue; seen.add(id); const x = byId.get(id); if (!x) continue; part.push(x); todo.push(...x.links); }
    out.push(part);
  }
  return out.sort((a, b) => b.length - a.length);
}

export function autoFix(m: MakerMap): string[] {
  const did: string[] = [];
  if (m.nodes.length < 12) return [m.nodes.length ? `路只有 ${m.nodes.length} 格，沒辦法自動修：請先畫一條至少 12 格的路` : '還沒有路，沒辦法自動修：請先到「道路」頁畫一條路'];

  // 1. ends on one spot or a step apart
  const joined = joinEnds(m);
  if (joined) did.push(`接上了 ${joined} 處挨著的路`);

  // 2. the road in one piece: each smaller piece joined to the largest by the shortest way
  let tied = 0;
  const stuck = new Set<number>();   // pieces with no way to the main road (walled in by lots): left as they are
  for (let guard = 0; guard < 50; guard++) {
    const ps = pieces(m), main = ps[0] ? new Set(ps[0].map(n => n.id)) : new Set<number>();
    const part = ps.slice(1).find(p => !stuck.has(p[0].id));
    if (!part) break;
    if (part.some(n => roadTo(m, n, h => main.has(h.id)))) tied++; else stuck.add(part[0].id);
  }
  if (tied) did.push(`把 ${tied} 段沒連上的路接到主路上`);

  // 3. dead ends looped back: each end led to the nearest other square that is not its own neighbour
  let looped = 0;
  const tried = new Set<number>();
  for (let guard = 0; guard < 60; guard++) {
    const end = m.nodes.find(n => n.links.length < 2 && !tried.has(n.id));
    if (!end) break;
    tried.add(end.id);
    const near = new Set([end.id, ...end.links]);
    if (roadTo(m, end, h => !near.has(h.id))) looped++;
  }
  if (looped) did.push(`把 ${looped} 個路的盡頭接回路上（不會再掉頭）`);

  // 4. one hospital, one prison, a bank: on plain squares no lot belongs to, spread apart
  const owned = () => new Set(m.lots.flatMap(l => l.nodes));
  const pick = (prefer: (n: MkNode) => number) => {
    const own = owned(), free = m.nodes.filter(n => !n.ev && !own.has(n.id));
    const pool = free.length ? free : m.nodes.filter(n => !n.ev);
    const marks = m.nodes.filter(n => n.ev === HOSPITAL || n.ev === PRISON || n.ev === BANK);
    let best: MkNode | null = null, score = -Infinity;
    for (const n of pool) {
      const away = marks.length ? Math.min(...marks.map(o => Math.hypot(o.cx - n.cx, o.cy - n.cy))) : 0;
      const s = away + prefer(n);
      if (s > score) { score = s; best = n; }
    }
    if (best) for (const l of m.lots) l.nodes = l.nodes.filter(id => id !== best!.id);
    return best;
  };
  for (const [ev, name] of [[HOSPITAL, '醫院'], [PRISON, '監獄']] as const) {
    const ns = m.nodes.filter(n => n.ev === ev);
    if (ns.length > 1) { for (const n of ns.slice(1)) n.ev = 0; did.push(`${name}只留一個，多的 ${ns.length - 1} 個改成普通格`); }
    else if (!ns.length) { const n = pick(x => (x.links.length === 2 ? 2 : 0)); if (n) { n.ev = ev; did.push(`放了一個${name}`); } }
  }
  if (!m.nodes.some(n => n.ev === BANK)) { const n = pick(x => (x.links.length >= 3 ? 50 : 0)); if (n) { n.ev = BANK; did.push('放了一個銀行（盡量放在路口）'); } }

  // 5. lots: only plain squares, every lot on some
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  let offEvents = 0;
  for (const l of m.lots) { const k = l.nodes.length; l.nodes = l.nodes.filter(id => { const n = byId.get(id); return n && !n.ev; }); if (l.nodes.length !== k) offEvents++; }
  if (offEvents) did.push(`${offEvents} 塊地不再屬於事件格`);
  let relinked = 0, dropped = 0;
  for (const l of [...m.lots]) {
    if (l.nodes.length) continue;
    const own = owned(), cells = lotCells(l);
    const near = m.nodes.filter(n => !n.ev && !own.has(n.id) && cells.some(([x, y]) => Math.hypot(n.cx - x, n.cy - y) <= 1.08));
    const use = l.kind ? near.flatMap(a => near.filter(b => b !== a && a.links.includes(b.id)).map(b => [a, b]))[0] : near.slice(0, 1);
    if (use?.length) { l.nodes = use.map(n => n.id); relinked++; }
    else { m.lots = m.lots.filter(x => x !== l); dropped++; }
  }
  if (relinked) did.push(`${relinked} 塊地關聯到旁邊的格子`);
  if (dropped) did.push(`刪掉了 ${dropped} 塊旁邊沒有路、接不上的地`);

  // 6. at least four lots: small ones beside plain squares
  let added = 0;
  if (m.lots.length < 4) {
    const { lotCell } = grid(m);
    const busy = (x: number, y: number) => x < 0 || y < 0 || x >= m.w || y >= m.h || lotCell.has(y * m.w + x) || m.nodes.some(n => Math.hypot(n.cx - x, n.cy - y) < 0.7);
    for (const n of m.nodes) {
      if (m.lots.length >= 4) break;
      if (n.ev || owned().has(n.id)) continue;
      const spot = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => [Math.round(n.cx) + dx, Math.round(n.cy) + dy]).find(([x, y]) => !busy(x, y));
      if (!spot) continue;
      const st = { id: m.nextId++, name: `新街${m.streets.length + 1}`, price: 1000 };
      m.streets.push(st);
      m.lots.push({ id: m.nextId++, kind: 0, cx: spot[0], cy: spot[1], nodes: [n.id], price: 1000, name: `地段${m.lots.length + 1}`, street: st.id });
      lotCell.add(spot[1] * m.w + spot[0]);
      added++;
    }
  }
  if (added) did.push(`加了 ${added} 塊地（至少要 4 塊）`);

  // 7. a deck the game can use: too few chosen → the original cards
  if (m.deck) for (const [k, name] of [['news', '新聞'], ['fate', '命運']] as const) {
    const n = m.deck[k].length;
    if (n > 0 && n < DECK_MIN) { m.deck[k] = []; did.push(`${name}卡只選了 ${n} 張，改回用原版的卡`); }
  }

  // 8. pieces off the road and the lots: moved a little, else taken away
  let moved = 0, gone = 0;
  for (const t of [...m.things]) {
    if (!covering(m, t)) continue;
    const x0 = t.x, y0 = t.y;
    let ok = false;
    for (let r = 1; r <= 12 && !ok; r++) for (let k = 0; k < 8 * r && !ok; k++) {
      const a = (k / (8 * r)) * Math.PI * 2;
      t.x = Math.round(x0 + Math.cos(a) * r * 24); t.y = Math.round(y0 + Math.sin(a) * r * 24);
      if (t.x > 0 && t.y > 0 && t.x < m.w * CELL && t.y < m.h * CELL && !covering(m, t)) ok = true;
    }
    if (ok) moved++;
    else { t.x = x0; t.y = y0; m.things = m.things.filter(x => x !== t); gone++; }
  }
  if (moved) did.push(`把 ${moved} 個壓住路或地的建築挪開`);
  if (gone) did.push(`拿掉了 ${gone} 個挪不開的建築`);

  return did;
}
