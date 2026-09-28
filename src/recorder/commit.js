'use strict';
// The git commit this process loaded, for the flight record's connection
// frame: bots restart onto new builds every ten to fifteen minutes, and a
// measure split by clock time could not say which build a run of frames
// belonged to (2026-09-28). Read once, at the first ask, in the checkout the
// code was loaded from; a checkout that is not a repository, or a machine
// without git, gives null and the record goes without it.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const cache = new Map();

function loadedCommit(root = ROOT, run = execFileSync) {
  if (cache.has(root)) return cache.get(root);
  let sha = null;
  try {
    const out = String(run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })).trim();
    if (/^[0-9a-f]{4,40}$/.test(out)) sha = out;
  } catch (_) { /* not a repository, or no git */ }
  cache.set(root, sha);
  return sha;
}

module.exports = { loadedCommit };
