// Puts the iPhone app's icon (build/icon.ico) and the name into the Windows exe, without Wine (resedit is plain JS).
import { readFileSync, writeFileSync } from 'node:fs';
import * as ResEdit from 'resedit';
const [exePath, icoPath, version] = process.argv.slice(2);
const exe = ResEdit.NtExecutable.from(readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(readFileSync(icoPath));
for (const g of ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map(i => i.data));
}
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
if (vi) {
  const [a, b, c] = version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: '大富翁4', FileDescription: '大富翁4', CompanyName: 'Rich4 remake', OriginalFilename: 'Rich4.exe' });
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('icon set', exePath);
