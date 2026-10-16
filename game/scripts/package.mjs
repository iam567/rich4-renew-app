// Builds the installable packages into release/: an Android APK and an unsigned iOS IPA (sign it yourself before installing).
//
//   npm run package            # both
//   npm run package -- apk     # Android only (debug-signed, installs directly: adb install, or open the file on the phone)
//   npm run package -- ipa     # iOS only (unsigned)
//   npm run package -- --no-build apk   # reuse the last dist/
//
// Needs the assets in public/assets (npm run assets, or the release's rich4-assets.tar), Xcode for the IPA, and
// the Android SDK plus JDK 21 for the APK (Android Studio brings both).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const want = argv.filter(a => a === 'apk' || a === 'ipa');
const targets = want.length ? want : ['apk', 'ipa'];
const out = join(root, 'release');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
mkdirSync(out, { recursive: true });

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
};

if (!argv.includes('--no-build')) {
  run('npx', ['tsc', '--noEmit']);
  run('npx', ['vite', 'build'], { env: { ...process.env, RICH4_NO_ASSETS: '1' } });
  run('node', ['scripts/bundle-assets.mjs'], { env: { ...process.env, RICH4_WEBP: '1' } });
}

if (targets.includes('apk')) {
  const env = { ...process.env };
  const studioJdk = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  if (!env.JAVA_HOME && existsSync(studioJdk)) env.JAVA_HOME = studioJdk;
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? join(homedir(), 'Library/Android/sdk');
  const local = join(root, 'android/local.properties');
  if (!existsSync(local) && existsSync(sdk)) writeFileSync(local, `sdk.dir=${sdk}\n`);
  run('npx', ['cap', 'sync', 'android']);
  run('./gradlew', ['assembleDebug', '-q'], { cwd: join(root, 'android'), env });
  const apk = join(out, `rich4-${version}.apk`);
  cpSync(join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), apk);
  console.log(`APK → ${apk}`);
}

if (targets.includes('ipa')) {
  run('npx', ['cap', 'sync', 'ios']);
  const derived = join(root, '.cache/ipa-build');
  run('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-sdk', 'iphoneos',
    '-destination', 'generic/platform=iOS', '-derivedDataPath', derived,
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'build', '-quiet']);
  const stage = join(derived, 'ipa');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'Payload'), { recursive: true });
  cpSync(join(derived, 'Build/Products/Release-iphoneos/App.app'), join(stage, 'Payload/App.app'), { recursive: true });
  const ipa = join(out, `rich4-${version}-unsigned.ipa`);
  rmSync(ipa, { force: true });
  run('zip', ['-qry', ipa, 'Payload'], { cwd: stage });
  console.log(`IPA（未簽名）→ ${ipa}`);
}
