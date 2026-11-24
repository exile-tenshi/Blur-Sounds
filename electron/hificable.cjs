// VB-Audio Hi-Fi Cable: detect, download (official vb-audio.com package, fetched at click time - not bundled),
// verify (SHA-256 pin + Authenticode signer), extract and run the official installer elevated (UAC).
// Hi-Fi Cable is VB-Audio donationware: https://vb-audio.com/Cable/  -  donate: https://vb-audio.com/Voicemeeter/Donationware.htm
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PKG = {
  url: 'https://download.vb-audio.com/Download_CABLE/HiFiCableAsioBridgeSetup_v1007.zip',
  file: 'HiFiCableAsioBridgeSetup_v1007.zip',
  exe: 'HiFiCableAsioBridgeSetup.exe',
  zipSha256: '3ecf204bfd8579d36bb918f9856eb1eaddd49c75146f5e8a8f59dcb8375ae89a',
  exeSha256: '8ad78652b0ac89cc34ce5cee05f66c9ca8a751feb4ed06af34532c996b4dbadd',
  signer: /CN=Vincent Burel\b/i, // VB-Audio's code-signing identity
  page: 'https://vb-audio.com/Cable/',
  donate: 'https://vb-audio.com/Voicemeeter/Donationware.htm',
};
const IN_RX = /hi-?fi cable input/i, OUT_RX = /hi-?fi cable output/i;
// v2.4.1: the standard VB-CABLE as a SECOND cable for the stream mix (Hi-Fi Cable carries the mic). Also VB-Audio
// donationware: free for personal use, never bundled or redistributed - the official package is downloaded from
// vb-audio.com when the user clicks Install, verified (pinned SHA-256 + Authenticode signer) and run elevated.
const VBC = {
  name: 'VB-CABLE',
  url: 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack46.zip',
  file: 'VBCABLE_Driver_Pack46.zip',
  exe: 'VBCABLE_Setup_x64.exe',
  zipSha256: 'bc44e8974191a5a2427d6c979e2dab08dbb09925f3f435dfa2f0ba3e45b6eb90',
  exeSha256: '734c35dfa6d98f48782a451633ceb471166ec70d60482fd89a1123d0ee3c4f41',
  signer: /CN=Vincent Burel\b/i,
  page: 'https://vb-audio.com/Cable/',
  donate: 'https://vb-audio.com/Voicemeeter/Donationware.htm',
  pnp: 'VB.Audio Virtual Cable',
};
const VB_IN_RX = /^cable input \(vb-audio virtual cable\)/i, VB_OUT_RX = /^cable output \(vb-audio virtual cable\)/i;
function detectVb(snapshot) {
  const outs = (snapshot && snapshot.outputs) || [], ins = (snapshot && snapshot.inputs) || [];
  const input = outs.find((o) => VB_IN_RX.test(o.name)) || null; const output = ins.find((i) => VB_OUT_RX.test(i.name)) || null;
  return { installed: !!(input && output), partial: !!(input || output) && !(input && output), inputId: input && input.id, inputName: input && input.name, outputId: output && output.id, outputName: output && output.name };
}

function detect(snapshot) {
  const outs = (snapshot && snapshot.outputs) || [], ins = (snapshot && snapshot.inputs) || [];
  const input = outs.find((o) => IN_RX.test(o.name)) || null; // render side: apps play into "Hi-Fi Cable Input"
  const output = ins.find((i) => OUT_RX.test(i.name)) || null; // capture side: VRChat/OBS record "Hi-Fi Cable Output"
  return { installed: !!(input && output), partial: !!(input || output) && !(input && output), inputId: input && input.id, inputName: input && input.name, outputId: output && output.id, outputName: output && output.name };
}

function ps(script, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 << 20 }, (err, stdout, stderr) => resolve({ err, out: String(stdout || '').trim(), errOut: String(stderr || '').trim() }));
  });
}
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Registry/PnP view, independent of the audio engine (also tells us "driver installed but needs a reboot").
async function driverInfo(pnp = 'Hi-?Fi Cable') {
  const r = await ps(`$u = Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | % { Get-ItemProperty $_.PSPath } | ? { $_.DisplayName -match '${pnp}' } | select -First 1
$d = Get-PnpDevice -ErrorAction SilentlyContinue | ? { $_.FriendlyName -match '${pnp}' } | select -First 1
$pend = (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') -or (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') -or [bool](Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue)
[pscustomobject]@{ registered = [bool]$u; name = $u.DisplayName; setup = $u.UninstallString; device = $d.FriendlyName; deviceStatus = "$($d.Status)"; problem = "$($d.Problem)"; rebootPending = $pend } | ConvertTo-Json -Compress`, 30000);
  try { return JSON.parse(r.out); } catch { return { registered: false, error: r.errOut || (r.err && r.err.message) }; }
}

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BlurSoundsPro (Hi-Fi Cable installer)' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume(); const next = new URL(res.headers.location, url).toString();
        if (!/^https:\/\/([a-z0-9-]+\.)*vb-audio\.com\//i.test(next)) return reject(new Error('Refusing to follow a redirect away from vb-audio.com: ' + next));
        return resolve(download(next, dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`vb-audio.com answered HTTP ${res.statusCode}`)); }
      const total = Number(res.headers['content-length']) || 0; let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { got += c.length; onProgress && onProgress(got, total); });
      res.pipe(out); out.on('finish', () => out.close(() => resolve(dest))); out.on('error', reject); res.on('error', reject);
    });
    req.setTimeout(60000, () => req.destroy(new Error('Download timed out')));
    req.on('error', reject);
  });
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function signature(file) {
  const r = await ps(`$s = Get-AuthenticodeSignature -LiteralPath ${q(file)}; [pscustomobject]@{ status = "$($s.Status)"; subject = $s.SignerCertificate.Subject; thumbprint = $s.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress`, 60000);
  try { return JSON.parse(r.out); } catch { return { status: 'Unknown', error: r.errOut }; }
}

// Download -> verify zip -> extract -> verify exe. Returns { exe, verified: {...} } or throws with a readable message.
async function prepare(workDir, onStep, PKG = module.exports.PKG) {
  const step = (s, extra) => onStep && onStep({ step: s, ...extra });
  fs.rmSync(workDir, { recursive: true, force: true }); fs.mkdirSync(workDir, { recursive: true });
  const zip = path.join(workDir, PKG.file);
  step('download', { pct: 0 });
  await download(PKG.url, zip, (got, total) => step('download', { pct: total ? Math.round((got / total) * 100) : null, got, total }));
  step('verify');
  const zipHash = sha256(zip); const zipPinned = zipHash === PKG.zipSha256;
  step('extract');
  const dir = path.join(workDir, 'setup');
  const ex = await ps(`Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dir)} -Force`, 60000);
  const exe = path.join(dir, PKG.exe);
  if (!fs.existsSync(exe)) throw new Error('The package did not contain ' + PKG.exe + (ex.errOut ? ': ' + ex.errOut : ''));
  step('verify');
  const exeHash = sha256(exe); const exePinned = exeHash === PKG.exeSha256;
  const sig = await signature(exe);
  const sigOk = sig.status === 'Valid' && PKG.signer.test(sig.subject || '');
  // Known package: hashes must match AND the signature must be valid. A newer VB-Audio release (different hash) is
  // accepted only with a valid Authenticode signature from VB-Audio's signing identity.
  if (!sigOk) throw new Error(`The installer's digital signature didn't check out (${sig.status || 'unknown'}${sig.subject ? ', signed by ' + sig.subject : ''}). Not running it.`);
  const verified = { zipSha256: zipHash, exeSha256: exeHash, pinned: zipPinned && exePinned, signature: sig.status, signer: sig.subject, thumbprint: sig.thumbprint };
  step('verified', { verified });
  return { exe, verified };
}

// Runs the official setup elevated and waits for it. The VB-Audio setup is interactive: the user clicks "Install Driver".
async function runInstaller(exe) {
  const r = await ps(`try { $p = Start-Process -FilePath ${q(exe)} -Verb RunAs -PassThru -Wait -ErrorAction Stop; "exit:" + $p.ExitCode } catch { "error:" + $_.Exception.Message }`, 30 * 60 * 1000);
  const out = r.out.split(/\r?\n/).pop() || '';
  if (out.startsWith('exit:')) return { ok: true, exitCode: Number(out.slice(5)) };
  const msg = out.startsWith('error:') ? out.slice(6) : (r.errOut || 'Installer did not start');
  if (/cancel/i.test(msg)) return { ok: false, cancelled: true, error: 'The Windows admin prompt was cancelled.' };
  return { ok: false, error: msg };
}

module.exports = { PKG, VBC, detect, detectVb, driverInfo, prepare, runInstaller, signature, sha256 };
