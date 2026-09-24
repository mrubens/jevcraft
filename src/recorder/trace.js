'use strict';

const MAX_FRAMES = 600;
const MAX_TRACE_BYTES = 12 * 1024 * 1024;
const secret = /(^authorization$|(?:^|[_-])api[_-]?key$|secret|(?:^|[_-])(?:access|refresh)[_-]?token$|password)/i;
// A depth limit alone is not a size limit: an object graph with shared
// references fans out combinatorially, and the bot's main thread spun for
// five minutes serialising one frame, three evenings running. Every call
// has a node budget and a cycle guard, and the first path that trips the
// budget is logged so the offending object can be named.
const NODE_BUDGET = 40000;
let lastTripLog = 0;
function clean(value, depth = 0, budget = { left: NODE_BUDGET, seen: new WeakSet(), path: [] }) {
  if (depth > 13) return '[depth limit]';
  if (--budget.left < 0) {
    if (budget.left === -1 && Date.now() - lastTripLog > 60000) { lastTripLog = Date.now(); console.log(`[trace] clean budget exhausted at ${budget.path.join('.')}`); }
    return '[truncated]';
  }
  if (typeof value === 'string') return value.slice(0, 12000);
  if (typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) {
    if (budget.seen.has(value)) return '[cycle]'; budget.seen.add(value);
    const out = value.slice(0, 2000).map((v, i) => { budget.path.push(i); const r = clean(v, depth + 1, budget); budget.path.pop(); return r; });
    budget.seen.delete(value); return out;
  }
  if (value && typeof value === 'object') {
    if (budget.seen.has(value)) return '[cycle]'; budget.seen.add(value);
    const out = Object.fromEntries(Object.entries(value).slice(0, 256)
      .filter(([, v]) => typeof v !== 'function').map(([k, v]) => { budget.path.push(k); const r = [k, secret.test(k) ? '[redacted]' : clean(v, depth + 1, budget)]; budget.path.pop(); return r; }));
    budget.seen.delete(value); return out;
  }
  return value;
}
function position(p) { return p && [p.x, p.y, p.z].every(Number.isFinite) ? { x: p.x, y: p.y, z: p.z } : null; }
const human = value => String(value || '').replaceAll('_', ' ');
function goalView(goal = {}) {
  return clean({ kind: goal.kind, request: goal.request || goal.retainedRequest, status: goal.status,
    item: goal.item, count: goal.count, delivered: goal.delivered, from: goal.from,
    interpretation: goal.interpretation, itemResolution: goal.itemResolution,
    step: goal.step, error: goal.lastError, survivalAction: goal.survivalAction,
    gameProgress: goal.gameProgress,
    tasks: goal.tasks?.map(({ kind, item, count, delivered, status, step }) => ({ kind, item, count, delivered, status, step })),
    activeTask: goal.activeTask, batch: goal.batch, discoveryTarget: goal.discoveryTarget, discovery: goal.discovery,
    opportunistic: goal.opportunistic, boatTravel: goal.boatTravel,
    destination: goal.destination,
    mobHunt: goal.mobHunt,
    strongholdSearch: goal.strongholdSearch,
    endPortal: goal.endPortal,
    endCombat: goal.endCombat,
    endReturn: goal.endReturn,
    fallRecoveries: goal.fallRecoveries,
    recoveryAction: goal.recoveryAdvice?.active ? goal.recoveryAction : undefined,
    recoveryAdvice: goal.recoveryAdvice?.history?.at(-1) && (({ model, source, diagnosis, status, steps, outcome, jev }) =>
      ({ model, source, diagnosis, status, steps, outcome, jev }))(goal.recoveryAdvice.history.at(-1)),
    designReview: goal.designReview && { fits: goal.designReview.fits, accepted: goal.designReview.accepted, threshold: goal.designReview.threshold },
    dream: goal.dream, villagePart: goal.villagePart, villageScore: goal.villageScore, gamePhase: goal.gameProgress?.phase,
    dependencies: goal.decisions?.at(-1)?.state?.acquisition?.dependencies,
    blueprint: goal.blueprint && { origin: goal.blueprint.origin, blocks: goal.blueprint.blocks?.slice(0, 6000) },
  });
}
function decisionSource(decision, kind) {
  // A chat request is understood by Jev before anything else happens, and a
  // clarifying question is Jev saying it was not sure enough to act.
  if (['request', 'clarify', 'dream'].includes(kind)) return 'jev';
  if (['connection', 'result', 'start', 'chat', 'observation', 'vitals'].includes(kind)) return 'observed';
  if (decision?.stale) return 'stale';
  if (decision?.fallback) return 'fallback';
  if (decision?.judgments?.length && ['decision', 'action'].includes(kind)) return 'jev';
  return kind === 'survival' || kind === 'danger' ? 'survival' : 'rules';
}

// A once-a-second heartbeat fills the window in ten minutes and would carry
// the interesting frames out with it. Heartbeats are the first to go, so a
// chat request and the decisions it caused stay inspectable for far longer
// than the terrain samples around them.
const HEARTBEAT = new Set(['observation', 'vitals', 'motion']);

class Trace {
  constructor({ id = 'live', label = 'Jev', mode = 'live', onFrame = () => {} } = {}) {
    this.id = id; this.label = label; this.mode = mode; this.frames = []; this.serial = 0; this.epoch = 0;
    this.connected = false; this.onFrame = onFrame; this.bytes = 0; this.sizes = [];
  }
  evict() {
    let index = this.frames.findIndex(f => HEARTBEAT.has(f.kind));
    if (index < 0 || index === this.frames.length - 1) index = 0;
    this.frames.splice(index, 1); this.bytes -= this.sizes.splice(index, 1)[0];
  }
  append(frame) {
    const next = { ...clean(frame), id: ++this.serial, at: frame.at || new Date().toISOString() };
    this.frames.push(next);
    const size = Buffer.byteLength(JSON.stringify(next)); this.bytes += size; this.sizes.push(size);
    while (this.frames.length > MAX_FRAMES || (this.bytes > MAX_TRACE_BYTES && this.frames.length > 1)) this.evict();
    this.onFrame(next); return next;
  }
  view(after = 0) { return { id: this.id, label: this.label, mode: this.mode, epoch: this.epoch,
    connected: this.connected, frames: this.frames.filter(f => f.id > after), oldestId: this.frames[0]?.id || 0,
    latestId: this.serial, limited: this.serial > this.frames.length }; }
}

module.exports = { MAX_FRAMES, clean, position, goalView, decisionSource, Trace };
