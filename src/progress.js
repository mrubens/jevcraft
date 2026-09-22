'use strict';
// Two things every long activity needs, kept once.
//
// Progress: an activity names the number that should get better (distance to
// its target, food points carried) and this says whether it has. Steps that
// succeed are not progress: the night mine paced four blocks back and forth
// for an hour on steps that all worked, and nothing measured whether the
// ore got any closer.
//
// Attempts: one memory of what was tried and failed, by action and target,
// with a reason and a rest. Without it the chooser picked the same nearest
// ore again, the same chest, the same heading, and every module grew its own
// "set aside" map with its own name and its own expiry; there were eight.

// A new best is an improvement by more than `epsilon`; `looks` counts the
// looks since the last one.
function advance(record, value, { better = 'lower', epsilon = 0.5 } = {}) {
  const improved = !Number.isFinite(record.best) ||
    (better === 'lower' ? value < record.best - epsilon : value > record.best + epsilon);
  if (improved) { record.best = value; record.looks = 0; record.bestAt = Date.now(); }
  else record.looks = (record.looks || 0) + 1;
  return !improved;
}

const keyOf = (action, target) => `${action}:${target && typeof target === 'object' && Number.isFinite(target.x)
  ? `${Math.floor(target.x)},${Math.floor(target.y)},${Math.floor(target.z)}` : String(target ?? '')}`;

class Attempts {
  constructor(state = {}) { this.state = state; this.state.attempts ||= {}; }
  get entries() { return this.state.attempts; }
  prune(now = Date.now()) {
    for (const [key, entry] of Object.entries(this.entries)) if (!(entry.until > now) && now - entry.at > 3600000) delete this.entries[key];
  }
  fail(action, target, why, { restMs = 600000, now = Date.now() } = {}) {
    this.prune(now);
    const key = keyOf(action, target), previous = this.entries[key];
    const entry = { action, target: target && typeof target === 'object' ? { x: target.x, y: target.y, z: target.z } : target,
      why: String(why?.message || why || 'failed').slice(0, 200), at: now, until: now + restMs, count: (previous?.count || 0) + 1 };
    this.entries[key] = entry;
    return entry;
  }
  resting(action, target, now = Date.now()) { return this.entries[keyOf(action, target)]?.until > now; }
  why(action, target) { return this.entries[keyOf(action, target)]?.why; }
  clear(action, target) { delete this.entries[keyOf(action, target)]; }
}

// The shared memory lives with the survival state, which every goal of the
// world carries and which is saved per world.
const attemptsFor = holder => new Attempts(holder?.survival || holder?.state || holder || {});

module.exports = { advance, Attempts, attemptsFor, keyOf };
