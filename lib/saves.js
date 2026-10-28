// Auto-save: your cards and form drafts live in data/ on your computer, with daily backups.
'use strict';

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const BACKUPS = path.join(DATA, 'backups');
const KEEP_BACKUPS = 14;
fs.mkdirSync(BACKUPS, { recursive: true });

function file(name) { return path.join(DATA, `${name}.json`); }

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}

function write(name, value) {
  const f = file(name);
  fs.writeFileSync(f + '.tmp', JSON.stringify(value, null, 1));
  fs.renameSync(f + '.tmp', f); // atomic, so a crash never leaves a half-written file
  if (name === 'cards') backup(f);
}

function backup(f) {
  const day = new Date().toISOString().slice(0, 10);
  const b = path.join(BACKUPS, `cards-${day}.json`);
  fs.copyFileSync(f, b);
  const all = fs.readdirSync(BACKUPS).filter((x) => x.startsWith('cards-')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(BACKUPS, old));
}

module.exports = { read, write };
