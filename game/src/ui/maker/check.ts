/**
 * 自建地圖's 檢查: what keeps a map from being played, most important first, each with where it is on the map (the
 * user 2026-11-12: say exactly which lot or piece, show it) — the editor lists them, a tap goes there and rings it.
 * `hard` ones the game cannot run without (no road, no hospital or prison); the others 強制試玩 may play through
 * anyway (the user: an unusual map, or the check mistaken — if it plays, it may be published once won).
 * The map design rules the user set (memory: bank on crossings, steps, spread events) are advice for later.
 */
import { DECK_MIN } from './deck';
import { covering, lotGeom, wx, wy } from './layers';
import type { MakerMap, MkNode } from './model';

export interface Problem { text: string; hard?: boolean; /** where on the map (world px), none: the whole map */ at?: { x: number; y: number }[] }

const pt = (n: MkNode) => ({ x: wx(n), y: wy(n) });

export function problemList(m: MakerMap): Problem[] {
  const out: Problem[] = [];
  if (m.nodes.length < 12) { out.push({ text: m.nodes.length ? `路太短了（${m.nodes.length} 格，至少要 12 格）` : '還沒有路：到「道路」頁畫一條路', hard: true }); return out; }
  const count = (ev: number) => m.nodes.filter(n => n.ev === ev);
  for (const [ev, name] of [[5, '醫院'], [4, '監獄']] as const) {
    const ns = count(ev);
    if (ns.length !== 1) out.push({ text: ns.length ? `${name}只能有一個（現在 ${ns.length} 個）` : `還沒有${name}：到「格子」頁放一個`, hard: true, at: ns.length ? ns.map(pt) : undefined });
  }
  // one road: every square reachable from the first
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  const seen = new Set<number>(), todo = [m.nodes[0].id];
  while (todo.length) { const id = todo.pop()!; if (seen.has(id)) continue; seen.add(id); todo.push(...(byId.get(id)?.links ?? [])); }
  const apart = m.nodes.filter(n => !seen.has(n.id));
  if (apart.length) out.push({ text: `路沒有全部連在一起（有 ${apart.length} 格接不上）`, at: apart.slice(0, 30).map(pt) });
  const ends = m.nodes.filter(n => n.links.length < 2);
  if (ends.length) out.push({ text: `有 ${ends.length} 個路的盡頭（走到那裡會掉頭）`, at: ends.map(pt) });
  if (m.lots.length < 4) out.push({ text: `地塊太少（${m.lots.length} 塊，至少要 4 塊）` });
  if (!count(14).length) out.push({ text: '還沒有銀行' });
  for (const [k, n] of [['新聞', m.deck?.news.length ?? 0], ['命運', m.deck?.fate.length ?? 0]] as const)
    if (n > 0 && n < DECK_MIN) out.push({ text: `${k}卡只選了 ${n} 張，至少要 ${DECK_MIN} 張（或者都不選，用原版的卡）` });
  for (const l of m.lots) {
    const g = lotGeom(m, l), at = [{ x: g.x, y: g.y }], name = (l.street !== undefined && m.streets.find(x => x.id === l.street)?.name) || l.name;
    if (!l.nodes.length) out.push({ text: `「${name}」還沒有關聯路上的格子`, at });
    else if (l.nodes.some(id => byId.get(id)?.ev)) out.push({ text: `「${name}」關聯到了事件格（地塊只能屬於普通格）`, at: [...at, ...l.nodes.map(id => byId.get(id)).filter((n): n is MkNode => !!n?.ev).map(pt)] });
  }
  for (const t of m.things) {
    const on = covering(m, t);
    if (on) out.push({ text: `有建築或樹壓住了${on === '路' ? '路上的格子' : on}：用「微調」把它挪開`, at: [{ x: t.x, y: t.y - 10 }] });
  }
  return out;
}

/** The problems' texts (the tests' and the old callers' form). */
export const problems = (m: MakerMap): string[] => problemList(m).map(p => p.text);
