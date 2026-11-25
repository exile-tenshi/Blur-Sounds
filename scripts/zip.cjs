// Zips release/win-unpacked -> release/BlurSoundsPro-<version>-win-x64.zip (uses python's zipfile).
const { execFileSync } = require('child_process');
const v = require('../package.json').version;
// v2.6.1 release guard: 2.5.3 and 2.6.0 shipped without rnnoise.dll / df.dll / speexdsp.dll because the build machine
// lacked MinGW / Rust and fetch-deps only warned. A release zip must contain every native the mic chain needs.
{
  const fs = require('fs'); const path = require('path'); const r = path.join('release', 'win-unpacked', 'resources');
  const need = ['helper/rnnoise.dll', 'helper/df.dll', 'helper/speexdsp.dll', 'helper/libvosk.dll', 'helper/onnxruntime.dll', 'helper/DirectML.dll', 'models/deepfilter/DeepFilterNet3_onnx.tar.gz'];
  const miss = need.filter((f) => !fs.existsSync(path.join(r, f)));
  if (miss.length && process.env.BSP_ALLOW_MISSING_NATIVES !== '1') { console.error('✗ release is missing: ' + miss.join(', ') + '\n  Install MinGW-w64 and Rust (x86_64-pc-windows-gnu), then rebuild. (BSP_ALLOW_MISSING_NATIVES=1 skips this for dev builds.)'); process.exit(1); }
  console.log('✓ natives present: ' + need.length + ' files');
}
execFileSync('python3', ['-c', `
import zipfile,os
os.chdir('release/win-unpacked')
z=zipfile.ZipFile('../BlurSoundsPro-${v}-win-x64.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9)
for r,d,f in os.walk('.'):
  for x in f:
    p=os.path.join(r,x); z.write(p,os.path.relpath(p,'.'))
z.close()
import hashlib
n='BlurSoundsPro-${v}-win-x64.zip'; h=hashlib.sha256(open('../'+n,'rb').read()).hexdigest()
open('../'+n+'.sha256','w').write(h+'  '+n+chr(10)); print('sha256', h)`], { stdio: 'inherit' });
