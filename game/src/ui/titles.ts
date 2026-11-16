/**
 * 派對模式's 稱號 (the user 2026-11-08: a small slim tag under each player's ms on the map, funny for live streams): each
 * real player wears ONE title, the latest won. Won from the game's own numbers (core/stats.ts's ledger and the board),
 * so every phone sees the same: a title once won stays won, the newest is shown. The tags' art: tools/tycoon-art/
 * title_badges.py (maps/remake/party/title-<key>.webp), the name written over its empty band by the game.
 */
import type { Game } from '../core/game';
import { ledgerOf, type PlayerStats } from '../core/stats';
import type { GameEvent, Player } from '../core/types';
import { ASSETS } from './assets';

interface Ctx { g: Game; p: Player; s: PlayerStats; F: number; extra: Extra }
/** What the ledger does not count, seen in the events (this phone's: lost on a rejoin). */
interface Extra { burst: number[] }
export interface TitleDef { key: string; name: string; test(c: Ctx): boolean }

const sum = (m: Record<number, number>) => Object.values(m).reduce((a, b) => a + b, 0);
const lots = (g: Game, p: Player) => g.board.lands.filter(l => l.owner === p.id + 1).length + g.board.facilities.filter(f => f.owner === p.id + 1).length;

/** In this order when several are won at once (the last of them is shown). `F`: the game's 總資金 per player. */
export const TITLES: readonly TitleDef[] = [
  { key: 'koi', name: '錦鯉附體', test: c => c.s.lucky >= 8 },
  { key: 'unlucky', name: '非酋本酋', test: c => c.s.unlucky >= 8 },
  { key: 'cards', name: '卡牌戲精', test: c => sum(c.s.cardsUsed) >= 10 },
  { key: 'weapon', name: '人形兵器', test: c => sum(c.s.toolsUsed) >= 8 },
  { key: 'hospital', name: '醫院年卡', test: c => c.s.hospitalStays >= 3 },
  { key: 'prison', name: '牢飯吃到飽', test: c => c.s.prisonStays >= 3 },
  { key: 'god', name: '財神親兒子', test: c => (c.s.gods[1] ?? 0) + (c.s.gods[2] ?? 0) >= 2 },
  { key: 'land', name: '圈地狂魔', test: c => lots(c.g, c.p) >= 10 },
  { key: 'rent', name: '包租公本公', test: c => c.s.tollsReceived >= c.F },
  { key: 'build', name: '基建狂魔', test: c => c.s.maxLv5 >= 3 },
  { key: 'leek', name: '韭菜收割機', test: c => c.s.stockProfit >= c.F / 2 },
  { key: 'debt', name: '負翁', test: c => c.p.loan >= c.F },
  { key: 'lotto', name: '天選之子', test: c => c.s.lotteryWins >= 1 },
  { key: 'boom', name: '爆倉戰神', test: c => (c.extra.burst[c.p.id] ?? 0) >= 1 },
  { key: 'bust', name: '破產製造機', test: c => c.s.rivalsBankrupted >= 1 },
  { key: 'rich', name: '小目標達成', test: c => c.s.maxAssets >= c.F * 3 },
  { key: 'beggar', name: '丐幫幫主', test: c => c.g.isBeggar(c.p) },
  // back from 乞丐 (派對模式's 乞丐: bankrupt once, playing again)
  { key: 'roach', name: '打不死小強', test: c => c.s.bankruptDay >= 0 && !c.p.bankrupt },
];
export const titleArt = (key: string) => `${ASSETS}/maps/remake/party/title-${key}.webp`;
/** Where each tag's empty band is (% of the picture: left, top, bottom; measured by title_badges.py's split): the name goes there. */
export const TITLE_BAND: Record<string, [number, number, number]> = { leek: [40, 22, 89], land: [36, 20, 88], rent: [35, 22, 89], build: [37, 26, 89], rich: [38, 24, 88], koi: [38, 18, 87], lotto: [40, 18, 87], cards: [40, 18, 87], weapon: [43, 18, 84], bust: [43, 19, 83], roach: [44, 21, 84], god: [41, 17, 84], unlucky: [40, 24, 86], hospital: [42, 18, 88], prison: [38, 15, 87], beggar: [41, 18, 88], debt: [46, 18, 85], boom: [41, 18, 86] };
/** A tag: its picture and the name over its band. */
export function titleHtml(t: TitleDef): string {
  const [x, top, bottom] = TITLE_BAND[t.key] ?? [40, 20, 85];
  return `<img src="${titleArt(t.key)}" alt=""><b class="${[...t.name].length >= 5 ? 'long' : ''}" style="left:${x + 1}%;top:${top}%;bottom:${100 - bottom}%">${t.name}</b>`;
}

/** Who wears what: each real player's titles won and the latest; `see` every game event. */
export class TitleBook {
  private won = new Map<number, Set<string>>();
  private latest = new Map<number, TitleDef>();
  private extra: Extra = { burst: [] };

  /** The titles already won when it starts (a game resumed) count quietly; the last of them is worn. */
  constructor(private g: Game) { this.check(); }

  /** The title a player wears, or null. */
  of(seat: number): TitleDef | null { return this.latest.get(seat) ?? null; }

  /** An event: its counts, then the titles; returns the ones just won ([] mostly). */
  see(e: GameEvent): { p: number; title: TitleDef }[] {
    if (e.t === 'fx' && e.kind === 'position-liquidated' && e.p !== undefined) this.extra.burst[e.p] = (this.extra.burst[e.p] ?? 0) + 1;
    return this.check();
  }

  private check(): { p: number; title: TitleDef }[] {
    const ledger = ledgerOf(this.g.players);
    if (!ledger) return [];
    const out: { p: number; title: TitleDef }[] = [];
    for (const p of this.g.players) {
      if (!p.human || this.g.isOut(p)) continue;
      const c: Ctx = { g: this.g, p, s: ledger.of(p.id), F: this.g.fund, extra: this.extra };
      let won = this.won.get(p.id);
      if (!won) this.won.set(p.id, (won = new Set()));
      for (const t of TITLES) {
        if (won.has(t.key) || !t.test(c)) continue;
        won.add(t.key);
        this.latest.set(p.id, t);
        out.push({ p: p.id, title: t });
      }
    }
    return out;
  }
}
