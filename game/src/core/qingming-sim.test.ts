import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard } from './board';
import { Game } from './game';
import { pack } from './date';
import { QingmingRules } from './qingming';
it('清明上河: computers play a long game; the boat, 梁山 and its squares are used, nothing hangs, nobody starts on 梁山', () => {
  const raw = JSON.parse(readFileSync('../editor/site/assets/remake/qingming.json', 'utf8'));
  const seen: Record<string, number> = {};
  for (let seed = 1; seed <= 3; seed++) {
    const g = new Game({ mapId: 111, players: [0, 4, 9, 11].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 19), seed }, parseBoard(raw));
    expect(g.rules).toBeInstanceOf(QingmingRules);
    const r4 = g.rules as QingmingRules, ls = r4.liangshan();
    expect(ls.size).toBe(65);
    const f = g.run();
    let n = 0, sailedBeforeDay31 = false;
    for (let r = f.next(); !r.done && n < 600000; n++) {
      const s = r.value as { t: string; kind?: string; ask?: boolean; p?: number; data?: { back?: boolean } };
      if (s.ask) throw new Error('a computer asked: ' + JSON.stringify(s));
      if (s.t === 'airdrop') expect(ls.has((s as unknown as { node: number }).node), 'airdrop on 梁山').toBe(false);
      for (const p of g.players) { expect(p.cash).toBeGreaterThanOrEqual(0); expect(p.points).toBeGreaterThanOrEqual(0); }
      if (s.t === 'fx' && s.kind?.startsWith('qm-')) {
        const k = s.kind === 'qm-sail' ? `qm-sail-${s.data?.back ? 'back' : 'go'}` : s.kind;
        seen[k] = (seen[k] ?? 0) + 1;
        if (k === 'qm-sail-go' && r4.day() < 31) sailedBeforeDay31 = true;
      }
      if (s.t === 'fx' && s.kind === 'cn-exam-result') seen.exam = (seen.exam ?? 0) + 1;
      if (g.daysElapsed > 300) break;
      r = f.next(undefined as never);
    }
    expect(n).toBeLessThan(600000);
    expect(sailedBeforeDay31).toBe(false);
    // gods only inside the wall, gift boxes outside it, the chest anywhere
    for (const o of g.objects.slots) {
      if (!o.node || o.owner) continue;
      const nd = g.node(o.node);
      if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].includes(o.type)) expect(r4.liangshan().has(nd.id), 'god on 梁山 ' + o.type).toBe(false);
    }
  }
  console.log('seen', seen);
  for (const k of ['qm-sail-go', 'qm-sail-back', 'qm-ling', 'exam']) expect(seen[k] ?? 0).toBeGreaterThan(0);
}, 300000);
