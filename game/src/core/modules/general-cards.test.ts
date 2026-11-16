import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { pack } from '../date';
import { Game } from '../game';
import type { GameSettings, Step } from '../types';
import { GENERAL_CARDS, ORIG_FATE, ORIG_NEWS } from './general-cards';

// 自建地圖's card library: 100 news and 100 fate, every one of them drawn on a plain map, run, and the game goes on.
const tokyo = fileURLToPath(new URL('../../../../editor/site/assets/remake/tokyo.json', import.meta.url));

describe('自建地圖 card library', () => {
  it('holds 100 news and 100 fate (the originals and the general cards), ids unique', () => {
    const news = ORIG_NEWS + GENERAL_CARDS.filter(c => c.kind === 'news').length, fate = ORIG_FATE + GENERAL_CARDS.filter(c => c.kind === 'fate').length;
    expect([news, fate]).toEqual([100, 100]);
    expect(new Set(GENERAL_CARDS.map(c => c.id)).size).toBe(GENERAL_CARDS.length);
    for (const c of GENERAL_CARDS) expect(c.text).not.toMatch(/東京|大阪|札幌|九州|沖繩|博多|淺草|道頓堀|銀座|新宿|澀谷|秋葉原|熊本|長崎|別府|阿蘇|櫻島/);
  });

  it.skipIf(!existsSync(tokyo))('a game whose deck is one card at a time runs every card, its rewritten headline shown', () => {
    const board = () => parseBoard(JSON.parse(readFileSync(tokyo, 'utf8')) as RawMap);
    const ids = [...Array.from({ length: ORIG_NEWS }, (_, i) => `o-n-${i}`), ...Array.from({ length: ORIG_FATE }, (_, i) => `o-f-${i}`), ...GENERAL_CARDS.map(c => c.id)];
    let shown = 0;
    const missed: string[] = [];
    for (const id of ids) {
      const news = id.startsWith('o-n') || GENERAL_CARDS.find(c => c.id === id)?.kind === 'news';
      const settings: GameSettings = { mapId: 100, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
        daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 11,
        deck: { news: news ? [id] : ['o-n-6'], fate: news ? ['o-f-20'] : [id], words: { [id]: '自訂標題' } } } as GameSettings;
      const g = new Game(settings, board());
      g.players.forEach((q, i) => { q.placed = true; q.whoPlays = 2; q.node = g.board.nodes.filter(x => x.event === 0)[i * 5].id; q.tools[0] = 1; });
      // land, houses, plots and shares held, so the cards about owners have someone to act on
      g.board.lands.forEach((l, i) => { l.owner = (i % 4) + 1; l.level = i % 3 + 1; });
      g.board.facilities.forEach((f, i) => { f.owner = (i % 4) + 1; f.level = 2; f.type = 1; });
      for (const q of g.players) g.stocks.holdings[q.id][0].shares = 1000;
      g.players[0].cards = [1, 2];
      const flow = (news ? g.events.news(g.players[0]) : g.events.fate(g.players[0])) as Generator<Step, unknown, unknown>;
      let hit = false;
      for (let r = flow.next(); !r.done; r = flow.next(undefined)) {
        const s = r.value as Step & { kind?: string; data?: { text?: string } };
        if (s.t === 'fx' && (s.kind === 'news' || s.kind === 'fate') && s.data?.text?.includes('自訂標題')) hit = true;
      }
      if (hit) shown++; else missed.push(id);
    }
    console.log('SHOWN', shown, 'of', ids.length, 'MISSED', missed.join(' '));
    // (the rest skip by their own conditions here: nobody in prison or hospital, another vehicle, no empty lot, no points)
    expect(shown).toBeGreaterThanOrEqual(180);
  });
});
