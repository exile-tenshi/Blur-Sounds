// v2.4.2 in-app updater: checks the public GitHub "latest" release, downloads the Windows zip, verifies its SHA-256
// (a <zip>.sha256 asset, or a 64-hex hash next to the file name in the release notes), then hands over to a small
// PowerShell script that waits for the app to close, swaps the folder (keeping the old one as a backup), relaunches,
// and rolls back if the new version doesn't start. No tokens, no account, nothing personal is sent.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO = 'exile-tenshi/Blur-Sounds';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TASK = 'BlurSoundsPro-Update';
const ZIP_RX = /^BlurSoundsPro-.*-win-x64\.zip$/i;

function parseVer(v) { const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/); return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || '' } : null; }
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b); if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i] ? 1 : -1;
  if (x.pre === y.pre) return 0; if (!x.pre) return 1; if (!y.pre) return -1; return x.pre > y.pre ? 1 : -1; // 2.5.0 > 2.5.0-beta
}

class Updater {
  constructor({ app, log, send }) {
    this.app = app; this.log = log || (() => {}); this.send = send || (() => {});
    this.state = { status: 'idle', current: app.getVersion() };
    this.feed = process.env.BSP_UPDATE_FEED || API; // test hook: a local JSON file shaped like the GitHub API
  }
  set(p) { this.state = { ...this.state, ...p }; this.send(this.state); return this.state; }

  async getJson(url) {
    if (!/^https?:/i.test(url)) return JSON.parse(fs.readFileSync(url, 'utf8'));
    let r;
    try { r = await fetch(url, { headers: { 'User-Agent': 'BlurSoundsPro-Updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(12000) }); }
    catch (e) { const err = new Error("Couldn't reach GitHub. Check your internet connection and try again."); err.code = 'offline'; throw err; }
    if (r.status === 403 || r.status === 429) {
      const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000; const left = r.headers.get('x-ratelimit-remaining');
      const err = new Error(left === '0' || r.status === 429 ? `GitHub's update check limit was reached for now. Try again ${reset ? 'after ' + new Date(reset).toLocaleTimeString() : 'in a while'}.` : `GitHub refused the update check (HTTP ${r.status}).`);
      err.code = 'ratelimit'; err.retryAt = reset || null; throw err;
    }
    if (r.status === 404) { const err = new Error('No published release was found.'); err.code = 'none'; throw err; }
    if (!r.ok) { const err = new Error(`GitHub answered HTTP ${r.status}.`); err.code = 'http'; throw err; }
    return r.json();
  }

  async check({ quiet } = {}) {
    if (this.state.status === 'downloading' || this.state.status === 'installing') return this.state;
    this.set({ status: 'checking', error: null });
    try {
      const rel = await this.getJson(this.feed);
      const latest = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const zip = assets.find((a) => ZIP_RX.test(a.name));
      const shaAsset = zip && assets.find((a) => a.name.toLowerCase() === (zip.name + '.sha256').toLowerCase());
      const available = !!parseVer(latest) && cmpVer(latest, this.state.current) > 0;
      return this.set({
        status: available ? (zip ? 'available' : 'noasset') : 'current', checkedAt: Date.now(), latest, notes: String(rel.body || '').slice(0, 6000),
        url: rel.html_url || `https://github.com/${REPO}/releases/latest`, publishedAt: rel.published_at || null,
        asset: zip ? { name: zip.name, size: zip.size, url: zip.browser_download_url, sha: shaAsset ? shaAsset.browser_download_url : null } : null,
        error: available && !zip ? 'This release has no Windows zip attached yet.' : null,
      });
    } catch (e) {
      this.log('update check: ' + e.message);
      return this.set({ status: 'error', error: e.message, errorCode: e.code || 'error', checkedAt: Date.now(), quiet: !!quiet });
    }
  }

  async expectedSha(a) {
    if (a.sha) {
      try {
        const t = /^https?:/i.test(a.sha) ? await (await fetch(a.sha, { headers: { 'User-Agent': 'BlurSoundsPro-Updater' }, signal: AbortSignal.timeout(15000) })).text() : fs.readFileSync(a.sha, 'utf8');
        const m = t.match(/\b([a-f0-9]{64})\b/i); if (m) return m[1].toLowerCase();
      } catch {}
    }
    // fall back to the release notes: "<64 hex>  BlurSoundsPro-x.y.z-win-x64.zip" or "SHA-256 ...: <64 hex>"
    const notes = this.state.notes || '';
    const near = notes.split(/\r?\n/).find((l) => l.includes(a.name) && /[a-f0-9]{64}/i.test(l)) || notes.split(/\r?\n/).find((l) => /sha-?256/i.test(l) && /[a-f0-9]{64}/i.test(l));
    const m = near && near.match(/([a-f0-9]{64})/i); return m ? m[1].toLowerCase() : null;
  }

  async download() {
    const a = this.state.asset; if (this.state.status !== 'available' || !a) return this.set({ status: 'error', error: 'Check for updates first.' });
    const want = await this.expectedSha(a);
    if (!want) return this.set({ status: 'error', error: "This release has no published SHA-256, so it can't be verified. Update manually from the release page.", errorCode: 'nosha' });
    const dir = path.join(os.tmpdir(), 'bsp-update'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, a.name.replace(/[^\w.-]/g, '_'));
    this.set({ status: 'downloading', progress: 0, error: null });
    try {
      const hash = crypto.createHash('sha256');
      if (/^https?:/i.test(a.url)) {
        const r = await fetch(a.url, { headers: { 'User-Agent': 'BlurSoundsPro-Updater' }, signal: AbortSignal.timeout(15 * 60 * 1000) });
        if (!r.ok) throw new Error(`Download failed (HTTP ${r.status}).`);
        const total = Number(r.headers.get('content-length')) || a.size || 0; let got = 0, lastSend = 0;
        const out = fs.createWriteStream(file);
        for await (const chunk of r.body) {
          hash.update(chunk); got += chunk.length;
          if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
          if (Date.now() - lastSend > 250) { lastSend = Date.now(); this.set({ progress: total ? got / total : 0 }); }
        }
        await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
      } else { const b = fs.readFileSync(a.url); hash.update(b); fs.writeFileSync(file, b); }
      const sha = hash.digest('hex');
      if (sha !== want) { try { fs.unlinkSync(file); } catch {} throw new Error(`The download didn't match its published SHA-256 (got ${sha.slice(0, 12)}…, expected ${want.slice(0, 12)}…). Nothing was changed.`); }
      return this.set({ status: 'ready', progress: 1, file, sha });
    } catch (e) {
      const offline = /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|aborted|timeout/i.test(String(e && (e.cause?.code || e.message)));
      this.log('update download: ' + e.message);
      return this.set({ status: 'error', error: offline ? 'The download was interrupted (no internet?). Nothing was changed; try again.' : e.message });
    }
  }

  // Writes the swap script, starts it detached and returns; the caller then quits the app.
  install() {
    if (this.state.status !== 'ready' || !this.state.file) return { ok: false, error: 'Download the update first.' };
    const appDir = path.dirname(process.execPath);
    if (!/BlurSoundsPro\.exe$/i.test(process.execPath)) return { ok: false, error: 'Updating only works in the installed app (not a dev build).' };
    try { const t = path.join(appDir, '.bsp-write-test'); fs.writeFileSync(t, '1'); fs.unlinkSync(t); }
    catch { return { ok: false, error: `Blur Sounds Pro can't write to ${appDir}. Update manually from the release page.` }; }
    const userData = this.app.getPath('userData'); const logs = path.join(userData, 'logs'); fs.mkdirSync(logs, { recursive: true });
    const marker = path.join(userData, 'update-ok.json'); try { fs.unlinkSync(marker); } catch {}
    const dir = path.join(os.tmpdir(), 'bsp-update'); fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, 'bsp-updater.ps1'); const argsFile = path.join(dir, 'update-args.json'); const beat = path.join(dir, 'started.txt');
    fs.writeFileSync(script, '\uFEFF' + UPDATER_PS1, 'utf8'); try { fs.unlinkSync(beat); } catch {}
    const env = {}; for (const k of ['BSP_PROFILE_DIR', 'BSP_SELFTEST_UPDATE', 'BSP_UPDATE_FEED']) if (process.env[k]) env[k] = process.env[k]; // test hooks only
    fs.writeFileSync(argsFile, JSON.stringify({ AppPid: process.pid, AppDir: appDir, Zip: this.state.file, Sha: this.state.sha, From: this.state.current, To: this.state.latest, Marker: marker, Log: path.join(logs, 'update.log'), Beat: beat, Env: env }));
    const psLog = path.join(logs, 'update.log'); const note = (m) => { try { fs.appendFileSync(psLog, `[${new Date().toISOString()}] ${m}\n`); } catch {} };
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const psExe = fs.existsSync(ps) ? ps : 'powershell.exe';
    const waitBeat = () => { const t = Date.now() + 6000; while (Date.now() < t) { if (fs.existsSync(beat)) return true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); } return false; };
    note(`starting the updater for ${this.state.current} -> ${this.state.latest}`);
    // The swap has to outlive this app. A one-time Task Scheduler task runs it outside the app's process tree (launchers such as
    // game clients can kill everything an app started when it exits); if that's not possible, a detached process is used.
    let started = false;
    try {
      const sch = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe');
      const tr = `"${psExe}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`;
      if (tr.length > 260) throw new Error('task command too long');
      execFileSync(sch, ['/Create', '/TN', TASK, '/TR', tr, '/SC', 'ONCE', '/ST', '00:00', '/F'], { windowsHide: true, stdio: 'ignore' });
      execFileSync(sch, ['/Run', '/TN', TASK], { windowsHide: true, stdio: 'ignore' });
      started = waitBeat(); note(started ? 'updater running (scheduled task)' : 'scheduled task did not start');
    } catch (e) { note('scheduled task not available: ' + e.message); }
    if (!started) {
      try { const p = spawn(psExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], { detached: true, stdio: 'ignore', windowsHide: true }); p.unref(); started = waitBeat(); }
      catch (e) { note('detached start failed: ' + e.message); }
      note(started ? 'updater running (detached)' : 'updater did not start');
    }
    if (!started) return { ok: false, error: "The updater couldn't start, so nothing was changed. Update manually from the release page." };
    this.set({ status: 'installing' });
    return { ok: true };
  }

  // Called by the new version once it is up: tells a waiting updater script the launch worked.
  markHealthy() {
    const marker = path.join(this.app.getPath('userData'), 'update-ok.json');
    try { fs.writeFileSync(marker, JSON.stringify({ version: this.state.current, pid: process.pid, at: new Date().toISOString() })); } catch {}
    try {
      const st = JSON.parse(fs.readFileSync(path.join(this.app.getPath('userData'), 'logs', 'update-result.json'), 'utf8'));
      if (st && !st.seen) { fs.writeFileSync(path.join(this.app.getPath('userData'), 'logs', 'update-result.json'), JSON.stringify({ ...st, seen: true })); return st; }
    } catch {}
    return null;
  }
}

const UPDATER_PS1 = String.raw`
param([string]$ArgsFile = (Join-Path $PSScriptRoot 'update-args.json'))
$ErrorActionPreference = 'Stop'
$a = Get-Content -LiteralPath $ArgsFile -Raw | ConvertFrom-Json
$AppPid = [int]$a.AppPid; $AppDir = $a.AppDir; $Zip = $a.Zip; $Sha = $a.Sha; $From = $a.From; $To = $a.To; $Marker = $a.Marker; $Log = $a.Log
try { [IO.File]::WriteAllText($a.Beat, "$PID") } catch {}
function DelTask { try { schtasks.exe /Delete /TN 'BlurSoundsPro-Update' /F 2>&1 | Out-Null } catch {} }
if ($a.Env) { foreach ($p in $a.Env.PSObject.Properties) { Set-Item -Path ("Env:" + $p.Name) -Value $p.Value } }
function L($m) { try { Add-Content -LiteralPath $Log -Value ("[{0}] {1}" -f (Get-Date -Format o), $m) } catch {} }
$resultFile = Join-Path (Split-Path $Log) 'update-result.json'
function Result($ok, $msg) { try { @{ ok = $ok; from = $From; to = $To; message = $msg; at = (Get-Date -Format o) } | ConvertTo-Json | % { [IO.File]::WriteAllText($resultFile, $_) } } catch {} }
$exe = 'BlurSoundsPro.exe'
$parent = Split-Path $AppDir -Parent; $name = Split-Path $AppDir -Leaf
$backup = Join-Path $parent "$name (previous version)"
$stage = Join-Path $parent "$name (update $To)"
L "update $From -> $To in $AppDir"
try {
  # 1. wait for the app (and its audio helper) to close
  for ($i = 0; $i -lt 60 -and (Get-Process -Id $AppPid -EA SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  Get-Process BlurSoundsPro, BspAudioHelper -EA SilentlyContinue | ? { $_.Path -and $_.Path.StartsWith("$AppDir\", [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -EA SilentlyContinue
  Start-Sleep -Milliseconds 800
  # 2. verify again and unpack next to the app
  if ((Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLower() -ne $Sha.ToLower()) { throw 'downloaded file changed since it was verified' }
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force
  $root = $stage; $kids = @(Get-ChildItem -LiteralPath $stage)
  if (-not (Test-Path -LiteralPath (Join-Path $stage $exe)) -and $kids.Count -eq 1 -and $kids[0].PSIsContainer) { $root = $kids[0].FullName }
  if (-not (Test-Path -LiteralPath (Join-Path $root "$exe")) -or -not (Test-Path -LiteralPath (Join-Path $root 'resources\app.asar'))) { throw 'the update zip does not contain Blur Sounds Pro' }
  # 3. swap: current -> "(previous version)", new -> current
  if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
  $moved = $false
  for ($i = 0; $i -lt 20 -and -not $moved; $i++) { try { Rename-Item -LiteralPath $AppDir -NewName (Split-Path $backup -Leaf); $moved = $true } catch { Start-Sleep -Milliseconds 500 } }
  if (-not $moved) { throw 'the app folder is still in use' }
  try { Move-Item -LiteralPath $root -Destination $AppDir } catch { Rename-Item -LiteralPath $backup -NewName $name; throw }
  if ($root -ne $stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force -EA SilentlyContinue }
  L "swapped; old version kept in $backup"
} catch {
  L ("update failed before launch: " + $_.Exception.Message)
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -EA SilentlyContinue }
  Result $false ("Update to $To failed: " + $_.Exception.Message + ". You're still on $From.")
  if (Test-Path -LiteralPath (Join-Path $AppDir $exe)) { try { Start-Process (Join-Path $AppDir $exe) } catch {} }
  DelTask; exit 1
}
# 4. launch the new version and wait for it to report in; roll back if it doesn't
if (Test-Path -LiteralPath $Marker) { Remove-Item -LiteralPath $Marker -Force }
Result $true "Updated from $From to $To."
$ok = $false; $p = $null
try { $p = Start-Process (Join-Path $AppDir $exe) -PassThru } catch { L ("could not start the new version: " + $_.Exception.Message) }
for ($i = 0; $p -and $i -lt 90; $i++) { Start-Sleep -Milliseconds 500; if (Test-Path -LiteralPath $Marker) { $ok = $true; break }; if ($p.HasExited -and -not (Get-Process BlurSoundsPro -EA SilentlyContinue | ? { $_.Path -and $_.Path.StartsWith("$AppDir\", [StringComparison]::OrdinalIgnoreCase) })) { break } }
if ($ok) { L "new version $To started"; Remove-Item -LiteralPath $Zip -Force -EA SilentlyContinue; DelTask; exit 0 }
L "new version $To did not start; rolling back to $From"
Get-Process BlurSoundsPro, BspAudioHelper -EA SilentlyContinue | ? { $_.Path -and $_.Path.StartsWith("$AppDir\", [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -EA SilentlyContinue
Start-Sleep 1
try {
  $failed = Join-Path $parent "$name (failed update $To)"
  if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
  Rename-Item -LiteralPath $AppDir -NewName (Split-Path $failed -Leaf)
  Rename-Item -LiteralPath $backup -NewName $name
  Remove-Item -LiteralPath $failed -Recurse -Force -EA SilentlyContinue
  Result $false "Version $To didn't start on this PC, so Blur Sounds Pro was put back to $From."
  L "rolled back"
} catch { L ("rollback failed: " + $_.Exception.Message); Result $false ("Version $To didn't start and the rollback failed; the old version is in $backup") }
try { Start-Process (Join-Path $AppDir $exe) } catch { L ("could not start: " + $_.Exception.Message) }
DelTask
`;

module.exports = { Updater, cmpVer, parseVer };
