/**
 * What another player just did with their money (issue #99, 2026-11-14: spectators and the waiting phones wanted to see
 * which stock a player buys, what they take from a shop — 「要不然等待時間太無聊了」): their holdings before and after
 * each of their answers, the difference in words under the waiting line. Every phone runs the same game, so it is
 * worked out here from the state alone; nothing extra goes over the network.
 */
import type { Game } from '../core/game';
import { cardName } from '../core/modules/cards';
import { toolDef } from '../core/modules/tools';

export interface Held { shares: number[]; tools: number[]; cards: number[]; pos: { id: number; slot: number; long: boolean; lev: number }[] }

export function heldOf(g: Game, p: number): Held | null {
  const pl = g.players[p];
  if (!pl) return null;
  const st = g.stocks as unknown as { holdings?: { shares: number }[][]; positions?: { id: number; p: number; slot: number; long: boolean; lev: number }[] };
  return {
    shares: (st.holdings?.[p] ?? []).map(h => h.shares),
    tools: [...pl.tools], cards: [...pl.cards],
    pos: (st.positions ?? []).filter(x => x.p === p).map(x => ({ id: x.id, slot: x.slot, long: x.long, lev: x.lev })),
  };
}

const count = (a: number[]) => { const m = new Map<number, number>(); for (const x of a) if (x) m.set(x, (m.get(x) ?? 0) + 1); return m; };
const fmt = (n: number) => n.toLocaleString('en-US');

/** The changes in words; `shop`: the question was a shop's (bought / sold), else got / used. */
export function heldDiff(g: Game, a: Held, b: Held, shop: boolean): string[] {
  const out: string[] = [];
  const names = (g.stocks as unknown as { stocks?: { name: string }[] }).stocks ?? [];
  b.shares.forEach((n, i) => {
    const d = n - (a.shares[i] ?? 0);
    if (d) out.push(`${d > 0 ? '買進' : '賣出'} ${names[i]?.name ?? '股票'} ${fmt(Math.abs(d))} 股`);
  });
  const opened = b.pos.filter(x => !a.pos.some(y => y.id === x.id)), closed = a.pos.filter(x => !b.pos.some(y => y.id === x.id));
  for (const x of opened) out.push(`開了 ${names[x.slot]?.name ?? '股票'} ${x.lev} 倍${x.long ? '做多' : '做空'}`);
  for (const x of closed) out.push(`平倉 ${names[x.slot]?.name ?? '股票'}`);
  for (const [kind, before, after, name] of [['道具', a.tools, b.tools, (id: number) => toolDef(id)?.name ?? '道具'], ['卡片', a.cards, b.cards, cardName]] as const) {
    const x = count(before), y = count(after);
    for (const id of new Set([...x.keys(), ...y.keys()])) {
      const d = (y.get(id) ?? 0) - (x.get(id) ?? 0);
      if (!d) continue;
      const what = `${kind}「${name(id) || kind}」${Math.abs(d) > 1 ? ` ×${Math.abs(d)}` : ''}`;
      out.push(d > 0 ? `${shop ? '買了' : '得到'}${what}` : `${shop ? '賣了' : '用掉'}${what}`);
    }
  }
  return out;
}

/** The lines under the waiting line: the newest three, each gone after a while. */
export class ActsLine {
  readonly el = document.createElement('div');
  private lines: { text: string; color: string; at: number }[] = [];
  private timer = 0;
  constructor() { this.el.className = 'pt-bought'; this.el.hidden = true; }
  add(who: string, color: string, texts: string[]) {
    const now = Date.now();
    for (const t of texts) this.lines.push({ text: `${who} ${t}`, color, at: now });
    this.lines = this.lines.slice(-3);
    this.draw();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.draw(), 1000);
  }
  private draw() {
    const now = Date.now();
    this.lines = this.lines.filter(l => now - l.at < 12_000);
    if (!this.lines.length) { clearInterval(this.timer); this.el.hidden = true; return; }
    this.el.hidden = false;
    this.el.replaceChildren(...this.lines.map(l => { const d = document.createElement('div'); d.textContent = l.text; d.style.borderColor = l.color; return d; }));
  }
}
