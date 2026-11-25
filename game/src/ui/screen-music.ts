/**
 * A screen's own piece while it is open — the map's own music set has one at that index (jq-music.ts: 長安's CN_THEME,
 * 清明上河's QM_THEME) — and the remembered background track again after (audio.restore). Without such a piece (another
 * map, 專屬音樂 off) nothing changes. One per screen: screenMusic() gives the switch, called (true, i) on open and
 * (false, i) on close.
 */
import { audio } from './audio';

export function screenMusic(): (on: boolean, i: number) => void {
  let themed = false;
  return (on, i) => {
    if (on && !themed && audio.hasTheme(i)) { audio.theme(i); themed = true; }
    else if (!on && themed) { audio.restore(); themed = false; }
  };
}
