#!/usr/bin/env node
// Maintainer tool: bump the version and write version.json (the update manifest Negi checks).
// Usage: node scripts/release.js 1.4.0 "What changed"
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const [version, notes = ''] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('Usage: node scripts/release.js <x.y.z> "notes"'); process.exit(2); }
const SKIP = /^(config\.json|version\.json|data\/|\.claude-work\/|\.git\/|node_modules\/|negi-.*\.zip$)/;

const files = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name), rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (SKIP.test(rel + (e.isDirectory() ? '/' : ''))) continue;
    if (e.isDirectory()) walk(abs);
    else files[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  }
})(ROOT);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
pkg.version = version;
fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
files['package.json'] = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package.json'))).digest('hex');
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ version, notes, date: new Date().toISOString().slice(0, 10), files }, null, 2) + '\n');
console.log(`version.json written for ${version} (${Object.keys(files).length} files)`);
