/**
 * The remake's result box after a card whose effect the original only shows as changed numbers (docs/rules/15
 * §4): who used it on whom, what changed hands and how much, one row per player with the face, in the same box
 * as the news and fate results (event-result.ts). The red and black cards get a headline panel with the stock,
 * its price before and after and the change. Pure text building here; map-fx.ts decides when it shows.
 */
import { cardName } from '../../core/modules/cards';
import { formatPrice } from '../../core/modules/stocks';
import { TOOLS } from '../../core/modules/tools';
import type { Game } from '../../core/game';
import type { ResultLine } from '../../core/modules/events';
import type { GameEvent } from '../../core/types';
import type { BoxData } from './event-result';
import './card-result.css';

type Fx = Extract<GameEvent, { t: 'fx' }>;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const yuan = (n: number) => `${Math.abs(n).toLocaleString('zh-Hant')}元`;

/** A lot's name by reference (2001.. lands, 4001.. facilities). */
export function lotName(g: Game, ref: number): string {
  const b = g.board;
  return ref > 4000 && ref < 6000 ? b.facilities[ref - 4001]?.name ?? '' : ref > 2000 && ref < 4000 ? b.lands[ref - 2001]?.name ?? '' : '';
}
const lot = (g: Game, ref: number) => (ref > 4000 ? g.board.facilities[ref - 4001] : g.board.lands[ref - 2001]) as { owner: number; level: number } | undefined;

/** Per owner (0-based), how many of these lots changed level. */
function byOwner(g: Game, refs: number[], was: number[]): Map<number, number> {
  const m = new Map<number, number>();
  refs.forEach((r, i) => {
    const l = lot(g, r);
    if (!l || !l.owner || l.level === was[i]) return;
    m.set(l.owner - 1, (m.get(l.owner - 1) ?? 0) + 1);
  });
  return m;
}

/** The box for a card's result event, or null when the card has none. */
export function cardBox(g: Game, s: Fx): BoxData | null {
  const d = (s.data ?? {}) as Record<string, unknown>;
  const card = Number(d.card ?? (s.kind === 'angel' ? 9 : s.kind === 'devil' ? 10 : s.kind === 'monster' ? 11 : s.kind === 'demolish' ? 12 : s.kind === 'hibernate' ? 15 : 0));
  if (!card || s.p === undefined || !g.isPlayerId(s.p)) return null;
  const me = s.p, t = s.target ?? -1, who = g.name(me), whom = g.isPlayerId(t) ? g.name(t) : '';
  const base = { title: '卡片', tag: cardName(card) };
  const lines: ResultLine[] = [];
  switch (card) {
    case 1: { // 均富卡
      const avg = Number(d.avg);
      for (const [p, cash] of (d.before as [number, number][]) ?? []) lines.push({ p, text: `現金 ${cash.toLocaleString('zh-Hant')} → ${avg.toLocaleString('zh-Hant')}`, amount: avg - cash });
      return { ...base, fx: 'card-info', head: `${who}使用均富卡：所有人的現金平均分配，每人${yuan(avg)}`, lines };
    }
    case 2: { // 均貧卡
      const avg = Number(d.avg);
      for (const [p, cash] of (d.before as [number, number][]) ?? []) lines.push({ p, text: `現金 ${cash.toLocaleString('zh-Hant')} → ${avg.toLocaleString('zh-Hant')}`, amount: avg - cash });
      return { ...base, fx: 'card-bad', head: `${who}對${whom}使用均貧卡：兩人現金平分，各得${yuan(avg)}`, lines };
    }
    case 3: { // 購地卡
      const name = lotName(g, Number(d.ref)), price = Number(d.price);
      lines.push({ p: me, text: `以原價買下${name}`, amount: -price }, { p: t, text: `${name}被強行收購`, amount: price });
      return { ...base, fx: 'card-bad', head: `${who}用購地卡買下${whom}的${name}`, lines };
    }
    case 4: case 5: { // 換地卡 / 換屋卡
      const a = Number(d.a), b = Number(d.b), na = lotName(g, a), nb = lotName(g, b);
      const owner = (o: number) => (o ? g.name(o - 1) : '無人');
      if (card === 4) {
        lines.push({ p: Number(d.ownerB) ? Number(d.ownerB) - 1 : undefined, text: `${na}：${owner(Number(d.ownerA))} → ${owner(Number(d.ownerB))}` },
          { p: Number(d.ownerA) ? Number(d.ownerA) - 1 : undefined, text: `${nb}：${owner(Number(d.ownerB))} → ${owner(Number(d.ownerA))}` });
        return { ...base, fx: 'card-info', head: `${who}交換了${na}與${nb}的地主`, lines };
      }
      lines.push({ p: Number(d.ownerA) ? Number(d.ownerA) - 1 : undefined, text: `${na}的房屋：${d.levelA}級 → ${d.levelB}級` },
        { p: Number(d.ownerB) ? Number(d.ownerB) - 1 : undefined, text: `${nb}的房屋：${d.levelB}級 → ${d.levelA}級` });
      return { ...base, fx: 'card-info', head: `${who}交換了${na}與${nb}的房屋`, lines };
    }
    case 9: case 10: { // 天使卡 / 惡魔卡
      const refs = (d.lots as number[]) ?? [], was = (d.was as number[]) ?? [];
      const name = lotName(g, Number(d.ref)), street = refs.length > 1 ? `${name}路段` : name;
      for (const [p, n] of byOwner(g, refs, was)) lines.push({ p, text: card === 9 ? `${n}處房屋加蓋一層` : `${n}處建築被夷為平地` });
      if (!lines.length) lines.push({ text: card === 9 ? '沒有房屋可以加蓋' : '沒有建築受損' });
      return { ...base, fx: card === 9 ? 'card-good' : 'card-bad', head: card === 9 ? `${who}對${street}使用天使卡：整條路段加蓋一層` : `${who}對${street}使用惡魔卡：整條路段夷為平地`, lines };
    }
    case 11: case 12: { // 怪獸卡 / 拆除卡
      const ref = Number(d.ref), name = lotName(g, ref), l = lot(g, ref), from = Number(d.from);
      const owner = l?.owner ? l.owner - 1 : undefined;
      lines.push({ p: owner, text: card === 11 ? `${name}的建築（${from}級）被夷為平地` : `${name}的建築 ${from}級 → ${l?.level ?? 0}級` });
      return { ...base, fx: 'card-bad', head: `${who}對${owner !== undefined ? g.name(owner) + '的' : ''}${name}使用${cardName(card)}`, lines };
    }
    case 13: { // 搶奪卡
      const item = d.tool ? TOOLS[Number(d.tool) - 1]?.name ?? '道具' : cardName(Number(d.got));
      lines.push({ p: t, text: `失去${item}` }, { p: me, text: `得到${item}` });
      return { ...base, fx: 'card-bad', head: `${who}搶走${whom}的${item}`, lines };
    }
    case 15: { // 冬眠卡
      for (const p of (d.who as number[]) ?? []) lines.push({ p, text: '冬眠5天，不能行動' });
      if (!lines.length) lines.push({ text: '沒有人被催眠' });
      return { ...base, fx: 'card-bad', head: `${who}使用冬眠卡：其他人冬眠5天`, lines };
    }
    case 24: case 25: { // 紅卡 / 黑卡
      const up = card === 24, st = g.stocks.stocks[Number(d.slot)];
      if (!st) return null;
      const before = Number(d.before), after = Number(d.after), diff = after - before, pct = before ? (diff / before) * 100 : 0;
      for (const [p, shares] of (d.holders as [number, number][]) ?? []) {
        lines.push({ p, text: `持有${shares.toLocaleString('zh-Hant')}股${diff ? '' : '，市值不變'}`, amount: Math.round(shares * diff) });
      }
      if (!lines.length) lines.push({ text: '沒有玩家持有這支股票' });
      const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
      const hero = `<div class="sc-hero ${up ? 'up' : 'down'}">
        <div class="sc-name"><span class="sc-badge">${esc(cardName(card))}</span>${esc(st.name)}</div>
        <div class="sc-px"><span class="sc-old">${formatPrice(before)}</span><span class="sc-arr">${up ? '▲' : '▼'}</span><span class="sc-new">${formatPrice(after)}</span></div>
        <div class="sc-pct">${diff ? `${sign}${formatPrice(Math.abs(diff))}（${sign}${Math.abs(pct).toFixed(1)}%）` : '本來就在'}${up ? '強制漲停' : '強制跌停'}</div>
      </div>`;
      // A neutral (blue) tag: the panel carries the market's own colours, red up and green down.
      return { ...base, fx: 'card-info', head: `${who}對${st.name}使用${cardName(card)}！`, lines, hero };
    }
    case 26: { // 查稅卡
      const tax = Number(d.tax);
      lines.push({ p: t, text: '繳納現金的兩成作為稅金', amount: -tax }, { p: me, text: '收到稅金（存入存款）', amount: tax });
      return { ...base, fx: 'card-bad', head: `${who}對${whom}查稅：抽取${yuan(tax)}稅金！`, lines };
    }
    case 29: { // 同盟卡
      lines.push({ p: me, text: `與${whom}同盟7天` }, { p: t, text: `與${who}同盟7天` });
      return { ...base, fx: 'card-info', head: `${who}與${whom}結盟：7天內互不收過路費`, lines };
    }
  }
  return null;
}
