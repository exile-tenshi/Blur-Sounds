// Downloads the third-party pieces that are not committed to git:
//   models/vosk-model-small-en-us-0.15   (Vosk speech model, Apache-2.0) - "clip it" voice trigger
//   vendor/ffmpeg/ffmpeg.exe             (FFmpeg 6.1.1 GPL build from ffmpeg-static, GPL-3.0) - clips, recording, export
//   vendor/rnnoise/rnnoise.dll           (RNNoise 0.2, BSD-3-Clause, built from source with MinGW) - mic noise suppression
//   vendor/speexdsp/speexdsp.dll         (SpeexDSP 1.2.1, BSD-3-Clause, built from source with MinGW) - echo cancellation
//   models/deepfilter/DeepFilterNet3_onnx.tar.gz + vendor/deepfilter/df.dll
//                                        (DeepFilterNet3, MIT/Apache-2.0; df.dll is built with Rust if cargo is installed) - AI noise suppression
// Usage: node scripts/fetch-deps.cjs            (fetch whatever is missing)
//        node scripts/fetch-deps.cjs --natives  (copy rnnoise.dll into helper-bin after `dotnet publish`)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const P = (...a) => path.join(root, ...a);
const tmp = P('vendor', '.download');

const VOSK = { url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip', dir: P('models', 'vosk-model-small-en-us-0.15') };
const FF = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';
const RNN = 'https://github.com/xiph/rnnoise/releases/download/v0.2/rnnoise-0.2.tar.gz';
const SPX = 'https://github.com/xiph/speexdsp/archive/refs/tags/SpeexDSP-1.2.1.tar.gz';
const DFN_REV = '7b14b895fe7fc42cab72b4a4c1e49c982bd6404b';
const DFN_SRC = `https://github.com/Rikorose/DeepFilterNet/archive/${DFN_REV}.tar.gz`;
const DFN_MODEL = `https://github.com/Rikorose/DeepFilterNet/raw/${DFN_REV}/models/DeepFilterNet3_onnx.tar.gz`;

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  console.log('  downloading', url);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.part', Buffer.from(await r.arrayBuffer()));
  fs.renameSync(file + '.part', file);
  return file;
}
const has = (cmd) => { try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };
function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (has('python3')) execFileSync('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dest], { stdio: 'inherit' });
  else execFileSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' }); // Windows 10+ bsdtar reads zip
}

async function vosk() {
  if (fs.existsSync(path.join(VOSK.dir, 'am'))) return console.log('✓ Vosk model present');
  const z = await download(VOSK.url, path.join(tmp, 'vosk.zip'));
  unzip(z, P('models'));
  console.log('✓ Vosk model ->', path.relative(root, VOSK.dir));
}
async function ffmpeg() {
  const out = P('vendor', 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(out)) return console.log('✓ ffmpeg present');
  const gz = await download(FF + 'ffmpeg-win32-x64.gz', path.join(tmp, 'ffmpeg-win32-x64.gz'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(gz)));
  for (const n of ['win32-x64.LICENSE', 'win32-x64.README']) fs.copyFileSync(await download(FF + n, path.join(tmp, n)), P('vendor', 'ffmpeg', n.replace('win32-x64.', 'FFMPEG-')));
  console.log('✓ ffmpeg ->', path.relative(root, out));
}
async function rnnoise() {
  const out = P('vendor', 'rnnoise', 'rnnoise.dll');
  if (fs.existsSync(out)) return console.log('✓ rnnoise.dll present');
  const cc = process.platform === 'win32' ? 'gcc' : 'x86_64-w64-mingw32-gcc';
  if (!has(cc)) { console.warn(`! ${cc} not found - skipping rnnoise.dll (noise suppression falls back to off). Install MinGW-w64 to build it.`); return; }
  const tgz = await download(RNN, path.join(tmp, 'rnnoise-0.2.tar.gz'));
  execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
  const src = path.join(tmp, 'rnnoise-0.2');
  const files = ['denoise', 'rnn', 'pitch', 'kiss_fft', 'celt_lpc', 'nnet', 'nnet_default', 'parse_lpcnet_weights', 'rnnoise_data', 'rnnoise_tables'].map((f) => path.join(src, 'src', f + '.c'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(cc, ['-O2', '-w', '-shared', '-DRNNOISE_BUILD', '-DDLL_EXPORT', '-I', path.join(src, 'include'), '-I', path.join(src, 'src'), ...files, '-o', out, '-static-libgcc', '-lm'], { stdio: 'inherit' });
  fs.copyFileSync(path.join(src, 'COPYING'), P('vendor', 'rnnoise', 'RNNOISE-COPYING'));
  console.log('✓ rnnoise.dll ->', path.relative(root, out));
}
async function speexdsp() {
  const out = P('vendor', 'speexdsp', 'speexdsp.dll');
  if (fs.existsSync(out)) return console.log('✓ speexdsp.dll present');
  const cc = process.platform === 'win32' ? 'gcc' : 'x86_64-w64-mingw32-gcc';
  if (!has(cc)) { console.warn(`! ${cc} not found - skipping speexdsp.dll (echo cancellation unavailable).`); return; }
  const tgz = await download(SPX, path.join(tmp, 'speexdsp-1.2.1.tar.gz'));
  execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
  const src = path.join(tmp, 'speexdsp-SpeexDSP-1.2.1');
  fs.writeFileSync(path.join(src, 'include', 'speex', 'speexdsp_config_types.h'),
    '#ifndef __SPEEX_TYPES_H__\n#define __SPEEX_TYPES_H__\n#include <stdint.h>\ntypedef int16_t spx_int16_t; typedef uint16_t spx_uint16_t; typedef int32_t spx_int32_t; typedef uint32_t spx_uint32_t;\n#endif\n');
  const files = ['mdf', 'preprocess', 'filterbank', 'fftwrap', 'kiss_fft', 'kiss_fftr', 'smallft'].map((f) => path.join(src, 'libspeexdsp', f + '.c'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(cc, ['-O2', '-w', '-shared', '-DFLOATING_POINT', '-DUSE_KISS_FFT', '-DEXPORT=__declspec(dllexport)', '-I', path.join(src, 'include'), '-I', path.join(src, 'libspeexdsp'), ...files, '-o', out, '-static-libgcc', '-lm'], { stdio: 'inherit' });
  fs.copyFileSync(path.join(src, 'COPYING'), P('vendor', 'speexdsp', 'SPEEXDSP-COPYING'));
  console.log('✓ speexdsp.dll ->', path.relative(root, out));
}
async function deepfilter() {
  const model = P('models', 'deepfilter', 'DeepFilterNet3_onnx.tar.gz');
  if (!fs.existsSync(model)) { fs.mkdirSync(path.dirname(model), { recursive: true }); fs.copyFileSync(await download(DFN_MODEL, path.join(tmp, 'DeepFilterNet3_onnx.tar.gz')), model); console.log('✓ DeepFilterNet3 model ->', path.relative(root, model)); }
  else console.log('✓ DeepFilterNet3 model present');
  const out = P('vendor', 'deepfilter', 'df.dll');
  if (fs.existsSync(out)) return console.log('✓ df.dll present');
  if (!has('cargo')) { console.warn('! cargo (Rust) not found - skipping df.dll. The app falls back to RNNoise. Install Rust + the x86_64-pc-windows-gnu target to build it.'); return; }
  const tgz = await download(DFN_SRC, path.join(tmp, 'DeepFilterNet-src.tar.gz'));
  execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
  const src = path.join(tmp, `DeepFilterNet-${DFN_REV}`);
  const win = process.platform === 'win32';
  const args = ['build', '-p', 'deep_filter', '--lib', '--release', '--no-default-features', '--features', 'capi'];
  if (!win) args.push('--target', 'x86_64-pc-windows-gnu');
  const env = { ...process.env }; if (!win) env.CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = 'x86_64-w64-mingw32-gcc';
  execFileSync('cargo', args, { cwd: src, stdio: 'inherit', env });
  const built = path.join(process.env.CARGO_TARGET_DIR || path.join(src, 'target'), ...(win ? [] : ['x86_64-pc-windows-gnu']), 'release', 'df.dll');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(built, out);
  const strip = win ? 'strip' : 'x86_64-w64-mingw32-strip'; if (has(strip)) execFileSync(strip, ['--strip-unneeded', out]);
  for (const n of ['LICENSE-MIT', 'LICENSE-APACHE']) fs.copyFileSync(path.join(src, n), P('vendor', 'deepfilter', 'DEEPFILTERNET-' + n));
  fs.mkdirSync(P('models', 'deepfilter'), { recursive: true });
  for (const n of ['LICENSE-MIT', 'LICENSE-APACHE']) fs.copyFileSync(path.join(src, n), P('models', 'deepfilter', n));
  console.log('✓ df.dll ->', path.relative(root, out));
}
function natives() {
  const dll = P('vendor', 'rnnoise', 'rnnoise.dll'); const hb = P('helper-bin');
  if (fs.existsSync(dll)) fs.copyFileSync(dll, path.join(hb, 'rnnoise.dll'));
  for (const [d, f] of [['speexdsp', 'speexdsp.dll'], ['deepfilter', 'df.dll'], ['rnnoise', 'RNNOISE-COPYING'], ['speexdsp', 'SPEEXDSP-COPYING'], ['deepfilter', 'DEEPFILTERNET-LICENSE-MIT'], ['deepfilter', 'DEEPFILTERNET-LICENSE-APACHE']]) { const src = P('vendor', d, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(hb, f)); }
  for (const f of fs.readdirSync(hb)) if (f.endsWith('.pdb')) fs.unlinkSync(path.join(hb, f));
}

(async () => {
  if (process.argv.includes('--natives')) return natives();
  await vosk(); await ffmpeg(); await rnnoise(); await speexdsp(); await deepfilter();
})().catch((e) => { console.error('fetch-deps failed:', e.message); process.exit(1); });
