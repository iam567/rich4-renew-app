// Copies only the art and data the game loads into a build (default dist/assets), following the manifests,
// so an app bundle carries ~700 MB instead of every extracted file. Run after `RICH4_NO_ASSETS=1 vite build`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public/assets');
const out = resolve(process.argv[2] ?? join(root, 'dist/assets'));
let count = 0, bytes = 0;

function copy(rel) {
  const from = join(src, rel), to = join(out, rel);
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  count++; bytes += readFileSync(from).length;
}
const json = rel => JSON.parse(readFileSync(join(src, rel), 'utf8'));

for (const dir of ['maps', 'orig', 'hd', 'audio', 'ground']) rmSync(join(out, dir), { recursive: true, force: true });

// Maps: list, thumbnails, board records and ground textures.
copy('maps/maps.json');
for (const m of json('maps/maps.json').maps) {
  copy(`maps/${m.thumbnail}`);
  copy(`maps/map-${m.id}.json`);
  copy(`maps/map-${m.id}.png`);
}

// The remake's own maps (editor/build_tokyo.py): records, ground, thumbnail and the sprites they bring along.
if (existsSync(join(src, 'maps/remake/index.json'))) {
  copy('maps/remake/index.json');
  for (const m of json('maps/remake/index.json').maps) {
    for (const f of [m.data, m.image, m.thumbnail]) copy(`maps/${f}`);
    for (const s of Object.values(json(`maps/${m.data}`).sprites ?? {})) for (const f of s.frames) copy(`maps/${s.dir}/${f.file}`);
  }
  // 大富豪模式 (docs/rules/17): the travel pads and the airport / station buildings (read at run time from frames.json).
  for (const res of ['9017', '9018', '1501', '1502', '1503']) {
    const fj = `maps/remake/sprites/${res}/frames.json`;
    if (!existsSync(join(src, fj))) continue;
    copy(fj);
    for (const f of json(fj)) copy(`maps/remake/sprites/${res}/${f.file}`);
  }
  // 派對模式's bar icons and the characters' reaction stickers (party-chat.ts, tools/tycoon-art/party_icons.py).
  if (existsSync(join(src, 'maps/remake/party'))) for (const f of readdirSync(join(src, 'maps/remake/party'))) if (f.endsWith('.webp')) copy(`maps/remake/party/${f}`);
  // The 旅館's redrawn levels 4 and 5 (ui/hotels.ts: map/0091, 0092 on the first stage's maps), and the APARTMENT
  // HOTEL 11 towers (ui/ah11.ts: map/2611..2615 on 日本 and the five cities).
  for (const res of ['2604', '2605', '2611', '2612', '2613', '2614', '2615']) {
    const fj = `maps/remake/sprites/${res}/frames.json`;
    if (!existsSync(join(src, fj))) continue;
    copy(fj);
    for (const f of json(fj)) copy(`maps/remake/sprites/${res}/${f.file}`);
  }
  // The five cities' own lot buildings (ui/city-lots.ts: map/2701..2724 東京, 2801.. 大阪, 2901.. 札幌, 3001.. 九州, 3101.. 沖繩).
  for (const base of [2700, 2800, 2900, 3000, 3100]) for (let n = 1; n <= 24; n++) {
    const fj = `maps/remake/sprites/${base + n}/frames.json`;
    if (!existsSync(join(src, fj))) continue;
    copy(fj);
    for (const f of json(fj)) copy(`maps/remake/sprites/${base + n}/${f.file}`);
  }
  // 歌舞伎町's street life (docs/rules/21 §8.3): vehicles, the train, the street characters (map/1901..1911, registered at run time).
  for (let res = 1901; res <= 1911; res++) {
    const fj = `maps/remake/sprites/${res}/frames.json`;
    if (!existsSync(join(src, fj))) continue;
    copy(fj);
    for (const f of json(fj)) copy(`maps/remake/sprites/${res}/${f.file}`);
  }
  // The tycoon cards' art (Data#601..606), the lab tools' icons (Data#614..616) and the 在路上 animation layers.
  const cards = [601, 602, 603, 604, 605, 606, 609].map(n => `cards/0${n}.webp`), tools = [614, 615, 616].map(n => `tools/0${n}.webp`);
  const shots = [1, 2, 3, 4].map(n => `icbm/shot-${n}.webp`); // 洲際飛彈's flight (ui/icbm-flight.ts)
  shots.push('title/party.webp', 'title/party-hover.webp'); // 派對模式's title button (ui/main.ts)
  for (const f of [...cards, ...tools, ...shots, 'onway/layers.json', 'onway/plane.webp', 'onway/train.webp', 'onway/sky.webp', 'onway/land.webp']) {
    if (existsSync(join(src, `maps/remake/${f}`))) copy(`maps/remake/${f}`);
  }
  // 大富翁城 (docs/rules/19): the five halls' sprites (map/1601..1645, read at run time) and the casino screens' art.
  for (let t = 0; t < 5; t++) for (let k = 1; k <= 5; k++) {
    const fj = `maps/remake/sprites/${1600 + t * 10 + k}/frames.json`;
    if (!existsSync(join(src, fj))) continue;
    copy(fj);
    for (const f of json(fj)) copy(`maps/remake/sprites/${1600 + t * 10 + k}/${f.file}`);
  }
  if (existsSync(join(src, 'maps/remake/casino'))) {
    for (const f of readdirSync(join(src, 'maps/remake/casino'))) if (f.endsWith('.webp')) copy(`maps/remake/casino/${f}`);
    // The tables' cartoon props (tools/tycoon-art/props.py): wheel layers, chips, cards, dice, felts.
    if (existsSync(join(src, 'maps/remake/casino/props'))) for (const f of readdirSync(join(src, 'maps/remake/casino/props'))) if (f.endsWith('.webp')) copy(`maps/remake/casino/props/${f}`);
  }
  // 歌舞伎町 (docs/rules/21): the shop picker's plates, the 柏青哥 / 拉霸 machines' art and the exclusive tools' icons
  // (Data#617, 618) and cards (Data#607, 608); its shops, houses, NPCs, walkers and pads come with its map file's sprites above.
  for (const dir of ['maps/remake/kabukicho', 'maps/remake/kabukicho/machines']) {
    if (existsSync(join(src, dir))) for (const f of readdirSync(join(src, dir))) if (f.endsWith('.webp')) copy(`${dir}/${f}`);
  }
  // 激情歲月 (docs/rules/24): the facility plates, the UI skin, the intro's backgrounds and the icons (maps/remake/jiqing/);
  // its houses, facilities, walkers, street life and pads come with its map file's sprites, its cards' pictures with events/.
  if (existsSync(join(src, 'maps/remake/jiqing'))) for (const f of readdirSync(join(src, 'maps/remake/jiqing'))) if (f.endsWith('.webp')) copy(`maps/remake/jiqing/${f}`);
  // …and its place screens' backgrounds and hostesses (tools/tycoon-art/jq_places.py): places.json + places/NNNN/frame-XXX.webp.
  if (existsSync(join(src, 'maps/remake/jiqing/places/places.json'))) {
    copy('maps/remake/jiqing/places/places.json');
    for (const d of readdirSync(join(src, 'maps/remake/jiqing/places'))) {
      if (!/^\d{4}$/.test(d)) continue;
      for (const f of readdirSync(join(src, `maps/remake/jiqing/places/${d}`))) if (f.endsWith('.webp')) copy(`maps/remake/jiqing/places/${d}/${f}`);
    }
  }
  for (const n of [617, 618]) if (existsSync(join(src, `maps/remake/tools/0${n}.webp`))) copy(`maps/remake/tools/0${n}.webp`);
  for (const n of [607, 608]) if (existsSync(join(src, `maps/remake/cards/0${n}.webp`))) copy(`maps/remake/cards/0${n}.webp`);
  // The results screen's statistics icons (docs/rules/20 §4, tools/tycoon-art/stats_icons.py): maps/remake/stats/<name>.webp.
  if (existsSync(join(src, 'maps/remake/stats'))) {
    for (const f of readdirSync(join(src, 'maps/remake/stats'))) if (f.endsWith('.webp')) copy(`maps/remake/stats/${f}`);
  }
  // 大富豪模式 local news / fate pictures (docs/rules/18): maps/remake/events/<id>.webp.
  if (existsSync(join(src, 'maps/remake/events'))) {
    for (const f of readdirSync(join(src, 'maps/remake/events'))) if (f.endsWith('.webp')) copy(`maps/remake/events/${f}`);
  }
}

// The old workshop maps (editor/export_custom.py, maps/custom/) are no longer offered (the 自製地圖 are the remake's
// six maps above), so the app does not carry them (2026-10-17).

// Clips the game no longer plays: Data#523, the level-5 fireworks, is drawn in code (src/ui/fireworks.ts).
const UNUSED_DATA = new Set([523]);

// Original sprites of the archives the game draws from.
copy('orig/manifest.json');
copy('orig/outline-colors.json');
const orig = json('orig/manifest.json').archives;
for (const archive of ['Data.mkf', 'map.mkf', 'Panel.mkf']) {
  const dir = archive.replace('.mkf', '');
  for (const e of orig[archive] ?? []) {
    if (archive === 'Data.mkf' && UNUSED_DATA.has(e.id)) continue;
    for (const f of e.frames ?? []) if (f.file) copy(`orig/${dir}/${f.file}`);
    if (e.file) copy(`orig/${dir}/${e.file}`); // whole pictures (card art, holiday photos)
    if (e.frames_dir) for (let i = 0; i < e.frame_count; i++) copy(`orig/${dir}/${e.frames_dir}/frame-${String(i).padStart(3, '0')}.png`);
  }
}

// Redrawn 4x frames. With RICH4_WEBP=1 they are converted to WebP (about 5x smaller; Safari 14+ and Chrome read
// it) and the copied manifest points at the .webp files.
const webp = !!process.env.RICH4_WEBP;
const hdManifest = json('hd/manifest-hd.json');
const jobs = [];
for (const [key, e] of Object.entries(hdManifest.resources)) {
  if (key.startsWith('Data/') && UNUSED_DATA.has(Number(key.slice(5)))) { delete hdManifest.resources[key]; continue; }
  for (const f of e.frames ?? []) {
    const rel = `hd/${key}-${e.type}/${f.file}`;
    if (webp && f.file.endsWith('.png')) { jobs.push(rel); f.file = f.file.replace(/\.png$/, '.webp'); } else copy(rel);
  }
  if (e.file) {
    const rel = `hd/${key.split('/')[0]}/${e.file}`;
    if (webp && e.file.endsWith('.png')) { jobs.push(rel); e.file = e.file.replace(/\.png$/, '.webp'); } else copy(rel);
  }
}
mkdirSync(join(out, 'hd'), { recursive: true });
writeFileSync(join(out, 'hd/manifest-hd.json'), JSON.stringify(hdManifest));
if (jobs.length) {
  // cwebp in parallel, one process per core.
  const cores = Math.max(1, availableParallelism() - 1);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: cores }, async () => {
    while (next < jobs.length) {
      const rel = jobs[next++], from = join(src, rel), to = join(out, rel.replace(/\.png$/, '.webp'));
      if (!existsSync(from)) continue;
      mkdirSync(dirname(to), { recursive: true });
      await new Promise((ok, fail) => execFile('cwebp', ['-quiet', '-q', '88', '-alpha_q', '100', '-m', '4', from, '-o', to], err => (err ? fail(err) : ok())));
      count++; bytes += statSync(to).size;
      if (++done % 2000 === 0) console.log(`webp ${done}/${jobs.length}`);
    }
  }));
}

// Sound (scripts/extract_audio.py): every effect, voice and music file the manifest lists.
if (existsSync(join(src, 'audio/manifest.json'))) {
  copy('audio/manifest.json');
  const a = json('audio/manifest.json');
  for (const kind of ['effect', 'voice']) for (const id of Object.keys(a[kind] ?? {})) copy(`audio/${kind}/${id.padStart(4, '0')}.m4a`);
  for (const name of Object.keys(a.music ?? {})) copy(`audio/music/${name}.m4a`);
}

// Redrawn map grounds (tools/ground-redraw/ground.py): the index, then each style's manifest, tiles and preview.
if (existsSync(join(src, 'ground/index.json'))) {
  copy('ground/index.json');
  const g = json('ground/index.json');
  for (const [map, styles] of Object.entries(g.maps ?? {})) {
    for (const style of styles) {
      const dir = `ground/${map}/${style}`;
      if (!existsSync(join(src, dir, 'manifest.json'))) continue;
      copy(`${dir}/manifest.json`);
      const m = json(`${dir}/manifest.json`);
      copy(`${dir}/${m.preview}`);
      for (const row of m.tiles) for (const f of row) copy(`${dir}/${f}`);
    }
  }
}

console.log(`bundled ${count} files, ${(bytes / 1e6).toFixed(0)} MB → ${out}`);
