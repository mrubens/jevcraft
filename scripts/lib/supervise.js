'use strict';
// A trial's bot needs a supervisor (scripts/trials/supervisor.sh) or nothing
// starts it again when it quits for a new build: mid-242-bd had none, quit
// at minute 33 and stayed down three hours (note 640). Starting a trial
// starts its port's supervisor when none is running, as retry.sh does.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { supervised } = require('../../src/quiet-restart');

function ensureSupervisor(port, root, { has = supervised, start = defaultStart } = {}) {
  if (has(port)) return false;
  start(port, root);
  return true;
}
function defaultStart(port, root) {
  const dir = path.join(root, 'artifacts', 'supervisors');
  fs.mkdirSync(dir, { recursive: true });
  const out = fs.openSync(path.join(dir, `${port}.log`), 'a');
  spawn('sh', ['scripts/trials/supervisor.sh', String(port)], { cwd: root, detached: true, stdio: ['ignore', out, out] }).unref();
}

// The stretches in which a bot left no flight frame: any gap of five
// minutes or more, and the tail to the window's end when the window closed.
function absences(frames, from, to, { gapMs = 5 * 60000, closed = true } = {}) {
  const ts = frames.map(f => f.t).filter(Number.isFinite).sort((a, b) => a - b);
  const out = [];
  let prev = from;
  for (const t of ts) { if (t - prev >= gapMs) out.push({ from: prev, to: t }); prev = t; }
  if (closed && to - prev >= gapMs) out.push({ from: prev, to });
  return out;
}
module.exports = { ensureSupervisor, absences };
