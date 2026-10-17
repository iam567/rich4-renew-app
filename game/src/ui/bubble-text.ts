/**
 * Where the words go in a speech-bubble picture: the centre of its body — the balloon without its tail, its drop
 * shadow or a burst's spikes — as fractions of the picture (x from the left, y from the top). The text block is
 * centred there (optically: Huninn's ink sits centred in its line box), whatever the bubble's size on screen.
 *
 * Measured on the redrawn art (rich4-hd; the originals agree within about 2 %): the alpha mask opened by a disk of
 * 0.85 × its inradius (0.55 for the cloud, whose bumps a bigger disk cuts off), whose bounding box is the body.
 * Keys are `archive/id/frame`.
 */
export const BUBBLE_BODY: Record<string, { cx: number; cy: number }> = {
  // Month report (Panel #25): pink box with the tail down-left, blue round one and orange heart one with it left.
  'Panel/25/1': { cx: 0.5, cy: 0.374 },
  'Panel/25/3': { cx: 0.578, cy: 0.497 },
  'Panel/25/4': { cx: 0.57, cy: 0.5 },
  // Shop (Panel #10): the witch's blue round bubble, the girl's orange heart one with its green shadow (tails right).
  'Panel/10/15': { cx: 0.428, cy: 0.502 },
  'Panel/10/34': { cx: 0.41, cy: 0.476 },
  // Bank (Panel #23): the clerk's heart (tail left), the chairman's box (tail down-right).
  'Panel/23/21': { cx: 0.568, cy: 0.5 },
  'Panel/23/22': { cx: 0.499, cy: 0.43 },
  // Lottery: the cheetah girl's round bubble (#12.8, tail left); the draw's heart (#15.22, tail right), the
  // 沒人中獎 burst (#15.23) and the winner's burst (#15.24).
  'Panel/12/8': { cx: 0.575, cy: 0.502 },
  'Panel/15/22': { cx: 0.438, cy: 0.5 },
  'Panel/15/23': { cx: 0.508, cy: 0.506 },
  'Panel/15/24': { cx: 0.503, cy: 0.464 },
  // Auction (Panel #26): a bidder's starburst, the auctioneer's box.
  'Panel/26/1': { cx: 0.523, cy: 0.522 },
  'Panel/26/2': { cx: 0.5, cy: 0.505 },
  // Hospital (#65) / prison (#63): the nurse's box, the clouds over a bed / a cell (tail down), the bail tips
  // (tail right / up-left).
  'Panel/65/2': { cx: 0.5, cy: 0.5 },
  'Panel/65/1': { cx: 0.498, cy: 0.428 },
  'Panel/63/1': { cx: 0.5, cy: 0.427 },
  'Panel/65/3': { cx: 0.443, cy: 0.5 },
  'Panel/63/2': { cx: 0.588, cy: 0.506 },
  // Magic house (#18): the name plates, each with its tail at another corner.
  'Panel/18/6': { cx: 0.488, cy: 0.465 },
  'Panel/18/7': { cx: 0.515, cy: 0.473 },
  'Panel/18/9': { cx: 0.478, cy: 0.524 },
  'Panel/18/10': { cx: 0.508, cy: 0.527 },
  // The speech cloud over the map (Data #517.6, tail down).
  'Data/517/6': { cx: 0.498, cy: 0.436 },
};

/**
 * Centres `words` (absolutely placed in the element the picture fills, `.bubble-words`) on the body of the bubble
 * picture `key`, mirrored when the picture is. Its width stays the screen's own (a max-width or a width).
 */
export function centreWords(words: HTMLElement, key: string, flip = false): void {
  const b = BUBBLE_BODY[key] ?? { cx: 0.5, cy: 0.5 };
  words.classList.add('bubble-words');
  words.style.left = `${((flip ? 1 - b.cx : b.cx) * 100).toFixed(1)}%`;
  words.style.top = `${(b.cy * 100).toFixed(1)}%`;
}
