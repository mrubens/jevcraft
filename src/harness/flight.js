'use strict';
// The flight recorder: every live frame, written to disk as it happens. The
// dashboard's trace lives in memory and goes with the process, so the
// frames around a death were gone after the restart that fixed it, and
// "why did it fall" meant reconstructing a line from a rejoin position and
// the last logged step.
//
// It has to keep the newest frames, not the oldest, and stay small enough to
// run all day. The first version wrote the whole goal view with every
// once-a-second heartbeat, about ninety megabytes an hour, and at its cap it
// stopped writing: the deaths after the second hour were lost. Now:
//   - heartbeats are written slim: where, how healthy, which keys, who holds
//     them, and the step;
//   - the goal is written only when it has changed;
//   - terrain only on a death or a connection;
//   - a file that reaches its size starts the next part, and each bot keeps
//     its own newest ten, by age, so two bots sharing the directory never
//     prune each other.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 10, PART_BYTES = 50 * 1024 * 1024;
const KEEP_WORLD = new Set(['danger', 'connection']);
const HEARTBEAT = new Set(['observation', 'vitals', 'motion']);

function slim(frame) {
  const s = frame.snapshot || {};
  return { ...frame, snapshot: { position: s.position, dimension: s.dimension, health: s.health, food: s.food, oxygen: s.oxygen,
    held: s.held, controller: s.controller, pathing: s.pathing,
    step: s.goal?.step, survivalAction: s.goal?.survivalAction } };
}

function flightRecorder(directory, label = 'jev', { now = () => new Date(), partBytes = PART_BYTES, keep = KEEP } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const prefix = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const started = now().toISOString().replace(/[:.]/g, '-');
  let part = 0, file, stream, bytes = 0, closed = false, lastGoal = null;
  function prune() {
    const mine = fs.readdirSync(directory).filter(f => f.startsWith(`${prefix}-`) && f.endsWith('.jsonl'))
      .map(f => ({ f, at: fs.statSync(path.join(directory, f)).mtimeMs })).sort((a, b) => a.at - b.at);
    for (const { f } of mine.slice(0, Math.max(0, mine.length - keep))) { try { fs.unlinkSync(path.join(directory, f)); } catch (_) {} }
  }
  function open() {
    stream?.end();
    file = path.join(directory, `${prefix}-${started}${part ? `-part${part + 1}` : ''}.jsonl`);
    // On disk before the prune counts files: the stream creates it later.
    fs.writeFileSync(file, '', { flag: 'a' });
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => { closed = true; });
    bytes = 0; lastGoal = null;
    prune();
  }
  open();
  function record(frame) {
    if (closed) return;
    let row;
    if (HEARTBEAT.has(frame.kind)) row = slim(frame);
    else {
      const snapshot = { ...(frame.snapshot || {}) };
      if (!KEEP_WORLD.has(frame.kind)) delete snapshot.world;
      const goal = JSON.stringify(snapshot.goal ?? null);
      if (goal === lastGoal) delete snapshot.goal; else lastGoal = goal;
      row = { ...frame, snapshot };
    }
    const line = JSON.stringify(row) + '\n';
    if (bytes + line.length > partBytes) { part++; open(); }
    bytes += Buffer.byteLength(line);
    stream.write(line);
  }
  return { get file() { return file; }, record, close() { closed = true; stream.end(); } };
}

module.exports = { flightRecorder, slim };
