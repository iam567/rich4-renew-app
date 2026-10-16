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

/** Fees paid to another player that make both speak like a toll (tolls core:908-966, facilities core:1533-1549). */
export const OWNER_FEES = new Set(['過路費', '住宿費', '購物費', '加油費']);

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
