/**
 * Who reacts with a line, and with which one (docs/rules/15-reactions.md). Pure selection rules taken from the
 * original's `_rich4_player_say` callers; map-fx.ts plays them (camera, cloud, voice). `coin` stands for the
 * original's `rand() & 1` (true = 1).
 */

/** Expression faces of map#(27 + character): frame face + 1. */
export const Face = { normal: 0, frown: 1, cry: 2, laugh: 3 } as const;

/** Face of the user's line card_strings[c][0][id − 1] (the `push` before each call in rich4_card_*.asm / *.c). */
export const CARD_USER_FACE: Record<number, number> = {
  1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 13: 3, 14: 3, 15: 3, 16: 3, 17: 3, 29: 3, 30: 3,
};

/**
 * The cards whose target (or the owner of the target lot) answers with card_strings[c][2][id − 1], and the face.
 * Card 7 (改建) has lines in the table but rich4_card_gaijianka.asm never says them; 16 (夢遊) uses event[21].
 */
export const CARD_VICTIM_FACE: Record<number, number> = {
  2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 8: 1, 11: 1, 12: 1, 13: 1, 14: 2, 17: 1, 18: 2, 19: 2, 20: 1, 26: 2, 29: 0, 30: 2,
};

/** card_strings[c][1][id − 1]: a card used on oneself (轉向 face 0, 停留 / 烏龜 face 3). */
export const CARD_SELF_FACE: Record<number, number> = { 6: 0, 14: 3, 30: 3 };

/** Index into lines.ts CARD_LINES / voices.ts CARD_VOICE: role 0 user, 1 self, 2 victim. */
export const cardLineIndex = (card: number, role: 0 | 1 | 2) => role * 30 + card - 1;

/** The face for a card line by role. */
export function cardFace(card: number, role: 0 | 1 | 2): number {
  return (role === 0 ? CARD_USER_FACE : role === 1 ? CARD_SELF_FACE : CARD_VICTIM_FACE)[card] ?? 0;
}

/** Owners (1-based, 0 = nobody) and levels of the two lots before a 換地 / 換屋 swap; A is the lot underfoot. */
export interface SwapBefore { ownerA: number; ownerB: number; levelA: number; levelB: number }

/**
 * 換地卡 / 換屋卡 (rich4_card_huandika.asm, rich4_card_huanwuka.asm): the user speaks (face 3) only when trading
 * one of their own lots for someone else's at least as built up, and then the other lot's owner, if any,
 * complains (face 2) after the swap. Any other swap passes in silence.
 */
export function swapReaction(me: number, b: SwapBefore): { user: boolean; victim: number } {
  const m = me + 1;
  if (b.ownerA === m && b.ownerB !== m && b.levelB >= b.levelA) return { user: true, victim: b.ownerB ? b.ownerB - 1 : -1 };
  if (b.ownerA !== m && b.ownerB === m && b.levelA >= b.levelB) return { user: true, victim: b.ownerA ? b.ownerA - 1 : -1 };
  return { user: false, victim: -1 };
}

/** The rules' turn-start notice 「%s坐牢中……還剩%d天！」 (game.ts playerTurn). */
export function parseStuck(text: string): { name: string; what: string; days: number } | null {
  const m = /^(.*?)(住宿中|消失中|坐牢中|住院中|冬眠中)……還剩(\d+)天！$/.exec(text);
  return m ? { name: m[1], what: m[2], days: Number(m[3]) } : null;
}

/**
 * fcn_0040c912 (rich4.asm:6561-6760): a player who starts the turn in prison or hospital says event[19] /
 * event[20] (face 2) on rand() & 1, before the message box. Hibernation has event[21] there too, but
 * `_rich4_player_say` drops every line of a hibernating player, so it is never heard. Returns the slot or null.
 */
export function stuckLament(what: string, coin: boolean): number | null {
  if (!coin) return null;
  return what === '坐牢中' ? 19 : what === '住院中' ? 20 : null;
}

/**
 * `_rich4_check_pay_toll_to_owner` (core_actions:5310-5445): when the fee is waived (sealed, ally, Death, the
 * owner in a hotel, away, in prison, in hospital, hibernating, sleepwalking), the message box and then the
 * payer's event[13] (face 3).
 */
export const isWaivedNotice = (text: string) => /免收.+！$/.test(text);

/** Fees paid to another player that make both speak like a toll (tolls core:908-966, facilities core:1533-1549; 消費 and 遊樂場費用: 歌舞伎町's shops). */
export const OWNER_FEES = new Set(['過路費', '住宿費', '購物費', '加油費', '漕運費', '消費', '遊樂場費用']);

/**
 * Who speaks after a payment: 'toll' = the payer (event[18] at the most hated owner for big sums, else
 * 9/10/11) and the owner (6/7/8); 'paid' = only the payer's 9/10/11 (a company's fee, core:2255-2262, when the
 * one paying is the player on the square, not a scapegoat).
 */
export function payReaction(s: { reason: string; quiet?: boolean; fromPlayer: boolean; toPlayer: boolean; toCompany: boolean; fromCurrent: boolean }): 'toll' | 'paid' | null {
  if (s.quiet || !s.fromPlayer) return null;
  if (s.toPlayer && OWNER_FEES.has(s.reason)) return 'toll';
  if (s.toCompany && s.fromCurrent) return 'paid';
  return null;
}

/**
 * `_rich4_player_say` keeps the last line's pointer (0x4762c8) and says nothing when asked for the same line
 * again right after (rich4.asm:23542-23544). A line is identified by its voice, or by speaker and text.
 */
export class LastLine {
  private key = '';
  /**
   * True when this line may be said (and remembers it); false for an immediate repeat of a table line (one
   * with a voice). The remake's own texts are never held back, but they still count as the last line.
   */
  take(character: number, text: string, voice?: number): boolean {
    const table = voice !== undefined && voice >= 0;
    const key = table ? `v${voice}` : `${character}:${text}`;
    const repeat = table && key === this.key;
    this.key = key;
    return !repeat;
  }
}

/**
 * The remake's eight expressions (docs/rules/15 §6; the user 2026-11-09: 「表情做豐富一點」): the original's four and
 * four more, drawn only in the redrawn faces (maps/remake/faces/<character>-<face>.webp, tools/tycoon-art/face_art.py).
 */
export const Expr = { normal: 0, frown: 1, cry: 2, laugh: 3, surprised: 4, smug: 5, nervous: 6, overjoyed: 7 } as const;
/** The original face standing in for each expression while the redrawn ones are not there. */
export const ORIG_FACE = [0, 1, 2, 3, 0, 3, 2, 3] as const;

const E = Expr;
/** event[s] by slot (eventOccasion in jq-quotes.ts names them): what the words of most characters say. */
export const EVENT_EXPR: readonly number[] = [
  E.overjoyed, E.laugh, E.laugh, // lucky
  E.surprised, E.cry, E.frown, // bad
  E.overjoyed, E.smug, E.normal, // receive
  E.cry, E.frown, E.nervous, // pay
  E.nervous, E.nervous, E.nervous, // spared
  E.smug, E.smug, E.smug, // build
  E.frown, E.cry, E.cry, // attacked, prison, hospital
  E.normal, E.surprised, E.nervous, // sleep, woken, the bad luck gone
  E.overjoyed, E.cry, E.frown, // win, lose, try again
];
/** tool_strings[s]: using a tool (mostly a trick on the others), riding, and being caught by one. */
export const TOOL_EXPR: readonly number[] = [
  E.smug, E.smug, E.smug, E.smug, E.laugh, E.laugh, E.smug, E.smug, E.smug, E.normal, E.laugh, E.smug, E.smug,
  E.normal, E.frown, E.surprised, E.nervous,
];
/** Cards used on a rival: the user grins slyly rather than laughs. */
const CARD_SLY = new Set([2, 3, 4, 5, 6, 8, 11, 12, 13, 14, 16, 17, 18, 19, 26, 30]);
/** Cards that hit hard and out of nowhere: the one they hit is shocked. */
const CARD_SHOCK = new Set([11, 12, 17, 19]);

/** The words themselves, when they say it plainly (the remake's own lines and the tables alike). */
export function textExpr(text: string): number | null {
  if (/[？?][！!]|[！!][？?]|天啊|我的天|媽媽咪呀|不可能|嚇/.test(text)) return E.surprised;
  if (/可恨|混帳|豈有此理|沒良心|記住|沒完|缺德/.test(text)) return E.frown;
  if (/好險|冷汗|撿回一條命|呼…|家在/.test(text)) return E.nervous;
  if (/哈哈|萬歲|中大獎|賺翻|大豐收|太棒|酷斃|帥呆/.test(text)) return E.overjoyed;
  if (/嘿嘿|嘻嘻|別忌妒/.test(text)) return E.smug;
  if (/慘|死了吧|倒楣|倒霉|嗚/.test(text)) return E.cry;
  return null;
}

/** Where a line comes from, for its expression. */
export type LineSource = { kind: 'event' | 'tool'; slot: number } | { kind: 'card'; card: number; role: 0 | 1 | 2 } | { kind: 'text' };

/**
 * The expression shown with a line: what the words say plainly, else what the occasion calls for, else the
 * original's face (`face`, 0–3).
 */
export function lineExpr(face: number, text: string, src: LineSource): number {
  const said = textExpr(text);
  if (said !== null) return said;
  if (src.kind === 'event') return EVENT_EXPR[src.slot] ?? face;
  if (src.kind === 'tool') return TOOL_EXPR[src.slot] ?? face;
  if (src.kind === 'card') {
    if (src.role === 0 && CARD_SLY.has(src.card)) return E.smug;
    if (src.role === 2 && CARD_SHOCK.has(src.card)) return E.surprised;
  }
  return face;
}
