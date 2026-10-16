// Links the player's locally extracted game art into public/assets for the dev server and app builds.
// Nothing here is committed: the original art belongs to its owner and is read from the player's own copy.
//   RICH4_MAPS_DIR  extracted map data and sprites   (default ../editor/site/assets)
//   RICH4_ORIG_DIR  all extracted original images    (default ../../rich4-assets)
//   RICH4_HD_DIR    redrawn HD frames aligned at 4x  (default ../../rich4-hd)
//   RICH4_AUDIO_DIR sound effects, voices and music  (default ../../rich4-audio, scripts/extract_audio.py)
//   RICH4_GROUND_DIR redrawn map grounds in tiles    (default ../../rich4-ground, tools/ground-redraw/ground.py)
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = {
  maps: process.env.RICH4_MAPS_DIR ?? resolve(root, '../editor/site/assets'),
  orig: process.env.RICH4_ORIG_DIR ?? resolve(root, '../../rich4-assets'),
  hd: process.env.RICH4_HD_DIR ?? resolve(root, '../../rich4-hd'),
  audio: process.env.RICH4_AUDIO_DIR ?? resolve(root, '../../rich4-audio'),
  ground: process.env.RICH4_GROUND_DIR ?? resolve(root, '../../rich4-ground'),
};
const target = resolve(root, 'public/assets');
mkdirSync(target, { recursive: true });
for (const [name, source] of Object.entries(sources)) {
  const link = resolve(target, name);
  rmSync(link, { force: true, recursive: false });
  if (!existsSync(source)) { console.warn(`missing ${name}: ${source}`); continue; }
  symlinkSync(source, link);
  console.log(`${name} -> ${source}`);
}
