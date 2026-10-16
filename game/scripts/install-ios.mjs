// Builds the iOS app, installs it on the connected iPhone, and backs the game's assets up into the app's
// Documents folder (Documents/rich4-assets-backup.tar), so the other computer can take them from the phone.
//
//   npm run ios                 # build, install, back up
//   npm run ios -- --no-build   # install the last build and back up
//   npm run ios -- --backup-only
//
// The backup is the assets the app bundles (dist/assets: hd, orig, maps, audio, ground), only re-sent when they changed.
// Restore on another computer:
//   xcrun devicectl device copy from --device <id> --domain-type appDataContainer --domain-identifier pro.areu.rich4 \
//     --source Documents/rich4-assets-backup.tar --destination ~/Downloads/rich4-assets-backup.tar
//   (and the .sha256 next to it; check it with shasum -a 256 -c), then: tar -xf ~/Downloads/rich4-assets-backup.tar -C game/public
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const BUNDLE_ID = 'pro.areu.rich4';
const NAME = 'rich4-assets-backup';
const cache = join(root, '.cache/ios');
mkdirSync(cache, { recursive: true });

const run = (cmd, a, opts = {}) => {
  const r = spawnSync(cmd, a, { stdio: 'inherit', cwd: root, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')} failed (${r.status})`);
};
const devicectl = (...a) => {
  const out = join(tmpdir(), `devicectl-${process.pid}.json`);
  const r = spawnSync('xcrun', ['devicectl', ...a, '--json-output', out, '--quiet'], { encoding: 'utf8' });
  const json = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  return { ok: r.status === 0, json, err: r.stderr };
};

// 1. The connected iPhone (CoreDevice id for devicectl, hardware UDID for xcodebuild).
const list = devicectl('list', 'devices').json?.result?.devices ?? [];
const phones = list.filter(d => d.hardwareProperties?.deviceType === 'iPhone' && d.connectionProperties?.pairingState === 'paired'
  && d.connectionProperties?.tunnelState !== 'unavailable');
const phone = phones.find(d => d.connectionProperties?.tunnelState === 'connected') ?? phones[0];
if (!phone) throw new Error('找不到已連接的 iPhone：用數據線接上、解鎖並信任這台電腦');
const id = phone.identifier, udid = phone.hardwareProperties.udid;
console.log(`iPhone: ${phone.deviceProperties?.name ?? id} (${udid})`);

if (!args.has('--backup-only')) {
  // 2. Web build + bundled assets + cap copy, then the native build signed with the development team.
  if (!args.has('--no-build')) run('npm', ['run', 'build:app']);
  const derived = join(root, '.cache/ios-build');
  run('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
    '-destination', `id=${udid}`, '-derivedDataPath', derived, '-allowProvisioningUpdates', 'build', '-quiet']);
  const app = join(derived, 'Build/Products/Debug-iphoneos/App.app');
  // 3. Install (keeps the app's data, so the backup and saved games survive).
  run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', id, app]);
}

// 4. Back the assets up into the app's Documents, when they changed since the copy on the phone.
const assets = join(root, 'dist/assets');
const parts = ['hd', 'orig', 'maps', 'audio', 'ground'].filter(p => existsSync(join(assets, p)));
if (!parts.length) throw new Error('dist/assets 沒有素材：先執行 npm run build:app');
const h = createHash('sha256');
const walk = dir => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    // Contents, not times: every build copies the files again, so their times always change.
    else { h.update(`${p.slice(assets.length)}\t${statSync(p).size}\n`); h.update(readFileSync(p)); }
  }
};
for (const p of parts) walk(join(assets, p));
const fingerprint = h.digest('hex');

const remoteInfo = join(cache, 'phone-info.json');
const got = devicectl('device', 'copy', 'from', '--device', id, '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE_ID,
  '--source', `Documents/${NAME}.json`, '--destination', remoteInfo);
const onPhone = got.ok && existsSync(remoteInfo) ? JSON.parse(readFileSync(remoteInfo, 'utf8')) : null;
if (onPhone?.fingerprint === fingerprint) {
  console.log(`素材備份已是最新（${onPhone.date}，${(onPhone.bytes / 1e6).toFixed(0)} MB），不用再傳`);
  process.exit(0);
}

const tar = join(cache, `${NAME}.tar`);
console.log(`打包素材（${parts.join('、')}）…`);
run('tar', ['-cf', tar, ...parts.map(p => `assets/${p}`)], { cwd: dirname(assets), env: { ...process.env, COPYFILE_DISABLE: '1' } });
const sha = execFileSync('shasum', ['-a', '256', `${NAME}.tar`], { cwd: cache, encoding: 'utf8' });
writeFileSync(join(cache, `${NAME}.tar.sha256`), sha);
const info = { fingerprint, date: new Date().toISOString(), bytes: statSync(tar).size, parts, sha256: sha.split(' ')[0] };
writeFileSync(join(cache, `${NAME}.json`), JSON.stringify(info, null, 1));
for (const f of [`${NAME}.tar`, `${NAME}.tar.sha256`, `${NAME}.json`]) {
  console.log(`傳到手機 Documents/${f}`);
  const r = devicectl('device', 'copy', 'to', '--device', id, '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE_ID,
    '--source', join(cache, f), '--destination', `Documents/${f}`);
  if (!r.ok) throw new Error(`複製到手機失敗：${r.err}`);
}
console.log(`素材已備份到手機（${(info.bytes / 1e6).toFixed(0)} MB）`);
// And into the AREU 素材空間 (tools/vault), dated, when the vault host is reachable.
const vault = join(root, '../tools/vault/vault.py');
if (existsSync(vault) && !args.has('--no-vault')) {
  const day = new Date().toISOString().slice(0, 10);
  const r = spawnSync('python3', [vault, 'put', tar, join(cache, `${NAME}.tar.sha256`), join(cache, `${NAME}.json`), '--to', `大富翁4重制/完整素材備份/${day}`], { stdio: 'inherit' });
  if (r.status !== 0) console.log('（素材空間備份失敗，下次再試）');
}
