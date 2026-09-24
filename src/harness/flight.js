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
//   - heartbeats and work steps are written slim: where, how healthy, which
//     keys, who holds them, and the step;
//   - other frames carry a compact goal, the whole of it once a minute and
//     on a death or a connection, and the decision only on decision frames;
//   - terrain only on a death or a connection;
//   - a file that reaches its size starts the next part, and each bot keeps
//     its own newest ten, by age, so two bots sharing the directory never
//     prune each other.
const fs = require('node:fs');
const path = require('node:path');

// The newest ten, and everything from the last day under half a gigabyte:
// kept by count alone, a day of restarts after fixes (a file each) pruned
// two wither-skeleton deaths from an hour before, and they could not be
// read back.
const KEEP = 10, PART_BYTES = 50 * 1024 * 1024, KEEP_MS = 24 * 3600 * 1000, KEEP_BYTES = 500 * 1024 * 1024;
const KEEP_WORLD = new Set(['danger', 'connection']);
// Step frames come one or two a second while working, and the goal changes
// on every one (its step counter), so "only when it changes" never skipped
// it: forty megabytes in half an hour. They are written slim like the
// heartbeats; the full goal goes with deaths, connections and once a minute.
const HEARTBEAT = new Set(['observation', 'vitals', 'motion', 'action']);
const FULL_GOAL = new Set(['danger', 'connection']), FULL_GOAL_EVERY_MS = 60000;
const compact = goal => goal && { request: goal.request, kind: goal.kind, status: goal.status, step: goal.step,
  survivalAction: goal.survivalAction, lastError: goal.lastError, lastErrorAt: goal.lastErrorAt, lastErrorFrom: goal.lastErrorFrom };

function slim(frame) {
  const s = frame.snapshot || {};
  return { ...frame, snapshot: { position: s.position, dimension: s.dimension, health: s.health, food: s.food, oxygen: s.oxygen,
    held: s.held, controller: s.controller, pathing: s.pathing,
    step: s.goal?.step, survivalAction: s.goal?.survivalAction } };
}

function flightRecorder(directory, label = 'jev', { now = () => new Date(), partBytes = PART_BYTES, keep = KEEP, keepMs = KEEP_MS, keepBytes = KEEP_BYTES } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const prefix = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const started = now().toISOString().replace(/[:.]/g, '-');
  let part = 0, file, stream, bytes = 0, closed = false, fullGoalAt = 0;
  function prune() {
    const mine = fs.readdirSync(directory).filter(f => f.startsWith(`${prefix}-`) && f.endsWith('.jsonl'))
      .map(f => { const st = fs.statSync(path.join(directory, f)); return { f, at: st.mtimeMs, size: st.size }; }).sort((a, b) => b.at - a.at);
    const cutoff = now().getTime() - keepMs;
    let total = 0;
    mine.forEach(({ f, at, size }, i) => {
      total += size;
      if (i < keep || (at >= cutoff && total <= keepBytes)) return;
      try { fs.unlinkSync(path.join(directory, f)); } catch (_) {}
    });
  }
  function open() {
    stream?.end();
    file = path.join(directory, `${prefix}-${started}${part ? `-part${part + 1}` : ''}.jsonl`);
    // On disk before the prune counts files: the stream creates it later.
    fs.writeFileSync(file, '', { flag: 'a' });
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => { closed = true; });
    bytes = 0; fullGoalAt = 0;
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
      const at = Date.parse(frame.at) || Date.now();
      if (FULL_GOAL.has(frame.kind) || at - fullGoalAt >= FULL_GOAL_EVERY_MS) fullGoalAt = at;
      else snapshot.goal = compact(snapshot.goal);
      if (frame.kind !== 'decision') delete snapshot.decision;
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
