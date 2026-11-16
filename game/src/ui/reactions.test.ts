import { describe, expect, it } from 'vitest';
import { CARD_LINES } from './lines';
import { CARD_VOICE } from './voices';
import { cardFace, cardLineIndex, CARD_VICTIM_FACE, EVENT_EXPR, Expr, isWaivedNotice, LastLine, lineExpr, ORIG_FACE, parseStuck, payReaction, stuckLament, swapReaction, TOOL_EXPR } from './reactions';
import { EVENT_LINES, TOOL_LINES } from './lines';

describe('card reaction lines (docs/rules/15 §2)', () => {
  it('every victim card has a line and a voice for every character', () => {
    for (const card of Object.keys(CARD_VICTIM_FACE).map(Number)) {
      for (let c = 0; c < 12; c++) {
        const k = cardLineIndex(card, 2);
        expect(CARD_LINES[c][k], `card ${card} character ${c}`).toBeTruthy();
        expect(CARD_VOICE[c][k], `card ${card} character ${c}`).toBeGreaterThan(0);
      }
    }
  });

  it('uses the faces pushed before _rich4_player_say', () => {
    expect(cardFace(3, 0)).toBe(3);   // 購地卡 user
    expect(cardFace(3, 2)).toBe(1);   // seller frowns
    expect(cardFace(26, 2)).toBe(2);  // 查稅 payer cries
    expect(cardFace(29, 2)).toBe(0);  // 同盟 partner
    expect(cardFace(24, 0)).toBe(0);  // 紅卡 user
    expect(cardFace(6, 1)).toBe(0);   // 轉向 on oneself
    expect(cardFace(14, 1)).toBe(3);
  });

  it('改建卡 has victim lines in the table that the original never says', () => {
    expect(CARD_LINES[0][cardLineIndex(7, 2)]).toBeTruthy();
    expect(CARD_VICTIM_FACE[7]).toBeUndefined();
  });

  it('換地 / 換屋 speak only when the user trades up', () => {
    // My lot (A, level 1) for player 3's lot (B, level 4): I gloat, player 3 (index 2) complains.
    expect(swapReaction(0, { ownerA: 1, ownerB: 3, levelA: 1, levelB: 4 })).toEqual({ user: true, victim: 2 });
    // Equal levels count as trading up.
    expect(swapReaction(0, { ownerA: 1, ownerB: 3, levelA: 2, levelB: 2 })).toEqual({ user: true, victim: 2 });
    // Standing on someone else's lot and giving away my worse one.
    expect(swapReaction(0, { ownerA: 2, ownerB: 1, levelA: 3, levelB: 0 })).toEqual({ user: true, victim: 1 });
    // Trading down, two opponents' lots, or an ownerless lot: no victim.
    expect(swapReaction(0, { ownerA: 1, ownerB: 3, levelA: 4, levelB: 1 })).toEqual({ user: false, victim: -1 });
    expect(swapReaction(0, { ownerA: 2, ownerB: 3, levelA: 4, levelB: 1 })).toEqual({ user: false, victim: -1 });
    expect(swapReaction(0, { ownerA: 1, ownerB: 0, levelA: 0, levelB: 3 })).toEqual({ user: true, victim: -1 });
  });
});

describe('laments at the start of a turn (fcn_0040c912)', () => {
  it('reads the rules\' notice', () => {
    expect(parseStuck('約翰喬坐牢中……還剩3天！')).toEqual({ name: '約翰喬', what: '坐牢中', days: 3 });
    expect(parseStuck('阿土伯住院中……還剩1天！')).toEqual({ name: '阿土伯', what: '住院中', days: 1 });
    expect(parseStuck('使用購地卡')).toBeNull();
  });
  it('prison and hospital speak on rand() & 1; hibernation, hotel and abroad never', () => {
    expect(stuckLament('坐牢中', true)).toBe(19);
    expect(stuckLament('住院中', true)).toBe(20);
    expect(stuckLament('坐牢中', false)).toBeNull();
    expect(stuckLament('冬眠中', true)).toBeNull();
    expect(stuckLament('住宿中', true)).toBeNull();
    expect(stuckLament('消失中', true)).toBeNull();
  });
});

describe('payments', () => {
  const base = { quiet: false, fromPlayer: true, toPlayer: true, toCompany: false, fromCurrent: true };
  it('tolls and another player\'s facility fees make both speak', () => {
    for (const reason of ['過路費', '住宿費', '購物費', '加油費', '消費', '遊樂場費用']) expect(payReaction({ ...base, reason })).toBe('toll');
  });
  it('a company\'s fee: the payer only, and only the player on the square', () => {
    expect(payReaction({ ...base, reason: '旅遊費', toPlayer: false, toCompany: true })).toBe('paid');
    expect(payReaction({ ...base, reason: '過路費', toPlayer: false, toCompany: true, fromCurrent: false })).toBeNull();
  });
  it('quiet money, card money and taxes say nothing here', () => {
    expect(payReaction({ ...base, reason: '過路費', quiet: true })).toBeNull();
    expect(payReaction({ ...base, reason: '購地卡' })).toBeNull();
    expect(payReaction({ ...base, reason: '稅金' })).toBeNull();
  });
  it('a waived fee is the payer\'s lucky line', () => {
    expect(isWaivedNotice('阿土伯坐牢中，免收過路費！')).toBe(true);
    expect(isWaivedNotice('房屋查封中，免收住宿費！')).toBe(true);
    expect(isWaivedNotice('過路費免付！')).toBe(false);
  });
});

describe('no line twice in a row (rich4.asm:23542)', () => {
  it('holds back an immediate repeat of a table line only', () => {
    const l = new LastLine();
    expect(l.take(0, '我慘了', 1053)).toBe(true);
    expect(l.take(0, '我慘了', 1053)).toBe(false);
    expect(l.take(1, 'OH∼NO！', 1080)).toBe(true);
    expect(l.take(0, '我慘了', 1053)).toBe(true);
    expect(l.take(0, '您的現金不足！')).toBe(true);
    expect(l.take(0, '您的現金不足！')).toBe(true);
  });
});

describe('the eight expressions (docs/rules/15 §6)', () => {
  it('every event and tool slot has one, and each stands in for an original face', () => {
    expect(EVENT_EXPR).toHaveLength(EVENT_LINES[0].length);
    expect(TOOL_EXPR.length).toBeGreaterThanOrEqual(TOOL_LINES[0].filter(Boolean).length);
    expect(ORIG_FACE).toHaveLength(8);
    for (const e of [...EVENT_EXPR, ...TOOL_EXPR]) expect(e).toBeGreaterThanOrEqual(0), expect(e).toBeLessThan(8);
  });
  it('the words first: a shock, a curse, a close call, a jackpot', () => {
    expect(lineExpr(0, '喔！我的天啊！', { kind: 'event', slot: 4 })).toBe(Expr.surprised);
    expect(lineExpr(2, '可恨，混帳烏龜\n王八蛋！', { kind: 'event', slot: 3 })).toBe(Expr.frown);
    expect(lineExpr(3, '好險∼', { kind: 'event', slot: 14 })).toBe(Expr.nervous);
    expect(lineExpr(0, '萬歲！\n中大獎了！', { kind: 'event', slot: 0 })).toBe(Expr.overjoyed);
  });
  it('then the occasion: 耶穌保佑 is a close call, a trick on a rival a sly grin, a monster a shock', () => {
    expect(lineExpr(3, '耶穌保佑', { kind: 'event', slot: 13 })).toBe(Expr.nervous);
    expect(lineExpr(0, '我是個大地主', { kind: 'event', slot: 16 })).toBe(Expr.smug);
    expect(lineExpr(0, '送你們一個\n小禮物～', { kind: 'tool', slot: 3 })).toBe(Expr.smug);
    expect(lineExpr(3, '這塊地歸我了', { kind: 'card', card: 3, role: 0 })).toBe(Expr.smug);
    expect(lineExpr(1, '我的房子', { kind: 'card', card: 11, role: 2 })).toBe(Expr.surprised);
  });
  it('else the original face', () => {
    expect(lineExpr(3, '天使保佑我', { kind: 'card', card: 9, role: 0 })).toBe(3);
    expect(lineExpr(0, '到了', { kind: 'text' })).toBe(0);
    expect(lineExpr(2, '@03', { kind: 'text' })).toBe(2);
  });
});
