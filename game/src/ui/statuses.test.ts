import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game } from '../core/game';
import type { GameEvent } from '../core/types';
import { StatusMemo, statusLine, timedStatuses } from './statuses';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const newGame = (seed = 4) => new Game({ mapId: 2, players: [0, 4, 9, 11].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
  daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 23), seed }, parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap));

describe('狀態條 (ui/statuses.ts)', () => {
  it.skipIf(!existsSync(mapFile(2)))('lists every timed state with its days, nothing when none runs', () => {
    const g = newGame();
    for (const p of g.players) { p.whoPlays = 2; p.placed = true; }
    const memo = new StatusMemo();
    expect(timedStatuses(g, memo)).toEqual([]);
    const [a, b, c, d] = g.players;
    g.current = 1; // player 0's turn has started this round, 2 and 3's not
    b.prison = 3; // 坐牢3天, just set
    c.vanish = 0x40 | 2; // 被外星人帶走2天
    d.hotel = 2; // 住宿3天 (stored as days - 1)
    a.bankRefused = 30;
    a.sleep = 0x80; // 冬眠: its last day
    d.traffic = 0x1f; // 工程車, 7 days
    a.god = 2; Object.assign(g.objects.slots[1], { node: 0, owner: 1, life: 4 }); // 大財神 4 more days
    g.stocks.restDays = 10;
    g.stocks.stocks[3].suspendDays = 2;
    const land = g.board.lands[0];
    for (const l of g.board.lands) if (l.name === land.name) l.tmpState = 0x31; // 查封卡: 3 days
    const got = timedStatuses(g, memo).map(s => [s.key, s.text, s.left, s.unit]);
    const name = (i: number) => g.name(i);
    expect(got).toEqual([
      ['p0:sleep', `${name(0)} 冬眠`, 1, '天'],
      ['p0:bank', `${name(0)} 銀行拒絕往來`, 30, '天'],
      ['p0:god', `${name(0)} 大財神附身`, 4, '天'],
      ['p1:prison', `${name(1)} 坐牢`, 3, '天'],
      ['p2:vanish', `${name(2)} 被外星人帶走`, 2, '天'],
      ['p3:hotel', `${name(3)} 住宿`, 3, '天'],
      ['p3:construction', `${name(3)} 工程車`, 7, '天'],
      ['stock-rest', '股市休市', 10, '天'],
      ['stock-susp3', `${g.stocks.stocks[3].name} 暫停交易`, 2, '天'],
      [`land:${land.name}:查封`, `${land.name} 查封`, 3, '天'],
    ]);
    // counted down at the next turn start: the days the turn start's notice says (「坐牢中……還剩3天！」 after 2 is left)
    b.prison = 2; d.hotel = 1; a.bankRefused = 29;
    const left = Object.fromEntries(timedStatuses(g, memo).map(s => [s.key, s.left]));
    expect([left['p1:prison'], left['p3:hotel'], left['p0:bank']]).toEqual([3, 2, 30]);
    b.prison = 0x80;
    expect(timedStatuses(g, memo).find(s => s.key === 'p1:prison')?.left).toBe(1);
    // gone when it ends; out players show nothing
    b.prison = 0; c.whoPlays = 0;
    const keys = timedStatuses(g, memo).map(s => s.key);
    expect(keys).not.toContain('p1:prison');
    expect(keys.some(k => k.startsWith('p2:'))).toBe(false);
    expect(statusLine(timedStatuses(g, memo)[0])).toBe(`${name(0)} 冬眠 還剩1天`);
  });

  it.skipIf(!existsSync(mapFile(2)))('agrees with the turn start\'s 「坐牢中……還剩N天！」 notices in a game played out', () => {
    const g = newGame(7);
    const memo = new StatusMemo();
    const flow = g.run();
    let checked = 0;
    // send someone to the prison and the hospital early, as the game would
    let sent = false;
    for (let r = flow.next(), n = 0; !r.done && g.daysElapsed < 60 && n < 400000; r = flow.next(), n++) {
      const e = r.value as GameEvent;
      if ('ask' in e) throw new Error('question');
      const list = timedStatuses(g, memo);
      if (!sent && e.t === 'day' && g.daysElapsed >= 2 && g.players.every(p => p.placed)) { // (at the day's start, as an event during a turn would)
        sent = true;
        // (on players with nothing else running: 冬眠 under a stay waits for it, and the walk out says 「還剩N天」 uncounted)
        const free = g.players.filter(p => p.whoPlays && !g.offRoad(p) && !p.sleep && !p.sleepwalk);
        if (free[0]) free[0].prison = 4;
        if (free[1]) free[1].hospital = 3;
        if (free[2]) free[2].sleep = 2;
        timedStatuses(g, memo);
      }
      if (e.t !== 'say') continue;
      const m = /^(.*?)(坐牢中|住院中|住宿中|冬眠中)……還剩(\d+)天！$/.exec(e.text);
      if (!m) continue;
      const kind = { 坐牢中: 'prison', 住院中: 'hospital', 住宿中: 'hotel', 冬眠中: 'sleep' }[m[2]]!;
      const p = g.players.find(q => g.name(q.id) === m[1])!;
      expect(list.find(s => s.key === `p${p.id}:${kind}`)?.left, e.text).toBe(Number(m[3]));
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });
});
