/**
 * 大富豪模式 local news and fate on screen (docs/rules/18 §5): the board is the original news / fate box (news.ts);
 * a local event's fx carries `local` (its id) and `city`, and its picture is maps/remake/events/<id>.webp, drawn in the
 * style of the HD news pictures (tools/still-redraw/regional-events). No voice: the originals' board voices are per
 * original entry.
 */
import { ASSETS } from '../assets';
import './regional.css';

export const regionalPictureUrl = (id: string) => `${ASSETS}/maps/remake/events/${id}.webp`;

/** The picture and city of a local event's board, or null for an original entry. */
export function regionalPicture(data: Record<string, unknown> | undefined): { src: string; city: string } | null {
  const id = data?.local;
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) return null;
  return { src: regionalPictureUrl(id), city: typeof data?.city === 'string' ? data.city : '' };
}
