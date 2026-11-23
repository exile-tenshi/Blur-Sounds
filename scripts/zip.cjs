// Zips release/win-unpacked -> release/BlurSoundsPro-<version>-win-x64.zip (uses python's zipfile).
const { execFileSync } = require('child_process');
const v = require('../package.json').version;
execFileSync('python3', ['-c', `
import zipfile,os
os.chdir('release/win-unpacked')
z=zipfile.ZipFile('../BlurSoundsPro-${v}-win-x64.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9)
for r,d,f in os.walk('.'):
  for x in f:
    p=os.path.join(r,x); z.write(p,os.path.relpath(p,'.'))
z.close()`], { stdio: 'inherit' });
