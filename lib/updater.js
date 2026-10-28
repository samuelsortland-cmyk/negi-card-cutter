// Checks GitHub for a newer Negi and installs it file by file.
// Your settings (config.json) and saved cards (data/) are never touched.
// Every replaced file is backed up first, and the launcher rolls back if the new version crashes on start.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const INSTALLED = path.join(DATA, 'installed.json');
const ROLLBACK_MARK = path.join(DATA, 'pending-rollback.json');
// Never written by an update, whatever a manifest says.
const PROTECTED = /^(config\.json|data\/|\.claude-work\/|start\.(bat|sh|command)$|server\.js$|negi-.*\.zip$)/;
const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const localVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version; } catch { return '0.0.0'; } };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
// NEGI_UPDATE_BASE lets you test updates from a local folder server.
const rawUrl = (repo, file) => `${process.env.NEGI_UPDATE_BASE || `https://raw.githubusercontent.com/${repo}/main`}/${file}?t=${Date.now()}`;

const state = { current: localVersion(), latest: null, notes: '', available: false, checkedAt: null, error: '', installing: false };

async function get(url, asText) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return asText ? await r.text() : Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

async function check(repo) {
  state.current = localVersion();
  try {
    const m = JSON.parse(await get(rawUrl(repo, 'version.json'), true));
    state.latest = m.version; state.notes = m.notes || ''; state.manifest = m;
    let skip = ''; try { skip = JSON.parse(fs.readFileSync(path.join(DATA, 'skip-version.json'), 'utf8')).version; } catch {}
    state.available = newer(m.version, state.current) && m.version !== skip;
    if (m.version === skip) { state.error = `Update ${skip} failed to start, so Negi is waiting for a fixed version`; state.checkedAt = new Date().toISOString(); return status(); }
    state.error = '';
    if (m.version !== skip) try { fs.unlinkSync(path.join(DATA, 'skip-version.json')); } catch {}
  } catch (e) {
    state.error = /404/.test(e.message) ? 'Update channel not set up yet' : `Couldn't reach the update server (${e.cause?.code || e.message})`;
  }
  state.checkedAt = new Date().toISOString();
  return status();
}

function status() { const { manifest, ...s } = state; return s; }

async function install(repo) {
  if (state.installing) throw new Error('Already updating');
  if (!state.manifest || !state.available) await check(repo);
  if (!state.available) throw new Error('Already up to date');
  state.installing = true;
  try {
    const m = state.manifest;
    const installed = (() => { try { return JSON.parse(fs.readFileSync(INSTALLED, 'utf8')); } catch { return {}; } })();
    const todo = [];
    for (const [file, hash] of Object.entries(m.files || {})) {
      if (!SAFE_PATH.test(file) || PROTECTED.test(file) || file.split('/').includes('..')) continue;
      const dest = path.join(ROOT, file);
      let cur = null; try { cur = sha(fs.readFileSync(dest)); } catch {}
      if (cur === hash) continue;
      todo.push({ file, hash, dest, cur, edited: cur && installed[file] && cur !== installed[file] });
    }
    // Download and verify everything before changing anything.
    for (const t of todo) {
      t.body = await get(rawUrl(m.repo || repo, t.file));
      if (sha(t.body) !== t.hash) throw new Error(`Download check failed for ${t.file}. Nothing was changed.`);
    }
    const backupDir = path.join(DATA, 'rollback', state.current);
    fs.mkdirSync(backupDir, { recursive: true });
    const backed = [];
    for (const t of todo) {
      if (t.cur) { const b = path.join(backupDir, t.file); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(t.dest, b); backed.push(t.file); }
      if (t.edited) fs.copyFileSync(t.dest, t.dest.replace(/(\.\w+)?$/, '.my-edits$1')); // keep your own edits (e.g. knowledge file)
    }
    try { fs.copyFileSync(path.join(ROOT, 'version.json'), path.join(backupDir, 'version.json')); } catch {}
    fs.writeFileSync(ROLLBACK_MARK, JSON.stringify({ from: state.current, to: m.version, dir: backupDir, files: todo.map((t) => t.file), backed }));
    for (const t of todo) {
      fs.mkdirSync(path.dirname(t.dest), { recursive: true });
      fs.writeFileSync(t.dest + '.tmp', t.body);
      fs.renameSync(t.dest + '.tmp', t.dest);
    }
    fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify(m, null, 2));
    fs.writeFileSync(INSTALLED, JSON.stringify(m.files, null, 2));
    return { updated: todo.map((t) => t.file), keptEdits: todo.filter((t) => t.edited).map((t) => t.file), version: m.version };
  } finally { state.installing = false; }
}

// Called once the new version has run fine for a while: the rollback is no longer needed.
function confirmHealthy() { try { fs.unlinkSync(ROLLBACK_MARK); } catch {} }

module.exports = { check, install, status, confirmHealthy, localVersion, ROLLBACK_MARK };
