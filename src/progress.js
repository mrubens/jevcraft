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
function advance(record, value, { better = 'lower', epsilon = 0.5, now = Date.now() } = {}) {
  const improved = !Number.isFinite(record.best) ||
    (better === 'lower' ? value < record.best - epsilon : value > record.best + epsilon);
  if (improved) { record.best = value; record.looks = 0; record.bestAt = now; }
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
  // Failed within the last `ms`, whatever rest it was given: the bed route
  // is tried again in two minutes from the open but in ten from a pocket.
  failedWithin(action, target, ms, now = Date.now()) { const entry = this.entries[keyOf(action, target)]; return !!entry && now - entry.at < ms; }
  why(action, target) { return this.entries[keyOf(action, target)]?.why; }
  clear(action, target) { delete this.entries[keyOf(action, target)]; }
  clearAction(action) { for (const [key, entry] of Object.entries(this.entries)) if (entry.action === action) delete this.entries[key]; }
  // The resting targets of one action, as { target: { at, until, why } }.
  of(action, now = Date.now()) {
    return Object.fromEntries(Object.values(this.entries).filter(e => e.action === action && e.until > now).map(e => [String(e.target), { at: e.at, until: e.until, why: e.why }]));
  }
}

// The shared memory lives with the survival state, which every goal of the
// world carries and which is saved per world.
const home = holder => holder?.survival || holder?.state || holder || {};
const attemptsFor = holder => new Attempts(home(holder));
const setAside = (holder, action, target, why, restMs) => attemptsFor(holder).fail(action, target, why, { restMs });
const isSetAside = (holder, action, target, now) => attemptsFor(holder).resting(action, target, now);
const failedWithin = (holder, action, target, ms, now) => attemptsFor(holder).failedWithin(action, target, ms, now);

// The supervisor. An activity says each tick what it is after and how far
// off it is; this keeps the best, and when there has been no new best for
// `stallLooks` looks or `stallMs` of time, the attempt is recorded as failed
// with the reason and the record cleared, and the activity is told to give
// the target up. It is the one place a pace-in-place is noticed, whatever
// the activity: before this, each noticed it in its own way or not at all.
function watch(holder, action, target, value, { better = 'lower', epsilon = 0.5, stallLooks = Infinity, stallMs = Infinity, restMs = 600000, why, now = Date.now() } = {}) {
  const state = home(holder), key = keyOf(action, target);
  const records = state.progress ||= {};
  const record = records[key] ||= { startedAt: now };
  advance(record, value, { better, epsilon, now });
  const looked = record.looks >= stallLooks, waited = now - record.bestAt >= stallMs;
  if (!looked && !waited) return { stalled: false, record };
  const reason = why || (looked ? `no progress in ${record.looks} steps (best ${Math.round(record.best * 10) / 10})`
    : `no progress in ${Math.round((now - record.bestAt) / 60000)} minutes (best ${Math.round(record.best * 10) / 10})`);
  delete records[key];
  attemptsFor(holder).fail(action, target, reason, { restMs, now });
  return { stalled: true, reason, record };
}
const unwatch = (holder, action, target) => { delete home(holder).progress?.[keyOf(action, target)]; };

module.exports = { advance, Attempts, attemptsFor, keyOf, setAside, isSetAside, failedWithin, watch, unwatch };
