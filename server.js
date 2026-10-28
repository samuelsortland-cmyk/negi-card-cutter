#!/usr/bin/env node
// Negi launcher. Runs the app (lib/app.js), restarts it after an update,
// and rolls an update back if the new version crashes while starting.
'use strict';

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MARK = path.join(ROOT, 'data', 'pending-rollback.json');
const RESTART = 42;
let firstRun = true;

function rollback() {
  let m; try { m = JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch { return false; }
  for (const f of m.files) {
    const dest = path.join(ROOT, f);
    if (m.backed.includes(f)) fs.copyFileSync(path.join(m.dir, f), dest);
    else { try { fs.unlinkSync(dest); } catch {} }
  }
  try { fs.copyFileSync(path.join(m.dir, 'version.json'), path.join(ROOT, 'version.json')); } catch {}
  fs.unlinkSync(MARK);
  fs.writeFileSync(path.join(ROOT, 'data', 'skip-version.json'), JSON.stringify({ version: m.to })); // don't retry this one
  console.log(`\n  ↩ The update to ${m.to} didn't start correctly, so Negi went back to ${m.from}.\n`);
  return true;
}

function start() {
  const started = Date.now();
  const args = process.argv.slice(2).concat(firstRun ? [] : ['--no-open']);
  firstRun = false;
  const child = fork(path.join(ROOT, 'lib', 'app.js'), args, { stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code === RESTART) { console.log('\n  🔄 Restarting Negi with the new version…\n'); return start(); }
    if (code && Date.now() - started < 20000 && fs.existsSync(MARK) && rollback()) return start();
    process.exit(code || 0);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { child.kill(sig); });
}

start();
