'use strict';
// The flight recorder: every live frame, written to disk as it happens. The
// dashboard's trace lives in memory and goes with the process, so the
// frames around a death were gone after the restart that fixed it, and
// "why did it fall" meant reconstructing a line from a rejoin position and
// the last logged step. One file per run, newest ten kept.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 10, MAX_BYTES = 200 * 1024 * 1024, WORLD_EVERY_MS = 30000;
// The terrain snapshot is most of a frame. It is kept every half minute and
// on the frames that matter after the fact.
const KEEP_WORLD = new Set(['danger', 'connection', 'error']);

function flightRecorder(directory, label = 'jev', { now = () => new Date() } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const started = now().toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${started}.jsonl`);
  for (const old of fs.readdirSync(directory).filter(f => f.endsWith('.jsonl')).sort().slice(0, -(KEEP - 1))) {
    try { fs.unlinkSync(path.join(directory, old)); } catch (_) {}
  }
  let bytes = 0, worldAt = 0, closed = false;
  const stream = fs.createWriteStream(file, { flags: 'a' });
  stream.on('error', () => { closed = true; });
  function record(frame) {
    if (closed || bytes > MAX_BYTES) return;
    const at = Date.parse(frame.at) || Date.now();
    let row = frame;
    if (frame.snapshot?.world) {
      if (KEEP_WORLD.has(frame.kind) || at - worldAt >= WORLD_EVERY_MS) worldAt = at;
      else row = { ...frame, snapshot: { ...frame.snapshot, world: undefined } };
    }
    const line = JSON.stringify(row) + '\n';
    bytes += Buffer.byteLength(line);
    stream.write(line);
  }
  return { file, record, close() { closed = true; stream.end(); } };
}

module.exports = { flightRecorder };
