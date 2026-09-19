'use strict';

const MAX_FRAMES = 600;
const MAX_TRACE_BYTES = 12 * 1024 * 1024;
const secret = /(^authorization$|(?:^|[_-])api[_-]?key$|secret|(?:^|[_-])(?:access|refresh)[_-]?token$|password)/i;
function clean(value, depth = 0) {
  if (depth > 13) return '[depth limit]';
  if (typeof value === 'string') return value.slice(0, 12000);
  if (typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.slice(0, 20000).map(v => clean(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 256)
    .filter(([, v]) => typeof v !== 'function').map(([k, v]) => [k, secret.test(k) ? '[redacted]' : clean(v, depth + 1)]));
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
    mobHunt: goal.mobHunt,
    strongholdSearch: goal.strongholdSearch,
    endPortal: goal.endPortal,
    endCombat: goal.endCombat,
    endReturn: goal.endReturn,
    recoveryAction: goal.recoveryAdvice?.active ? goal.recoveryAction : undefined,
    recoveryAdvice: goal.recoveryAdvice?.history?.at(-1) && (({ model, diagnosis, status, steps, outcome }) =>
      ({ model, diagnosis, status, steps, outcome }))(goal.recoveryAdvice.history.at(-1)),
    dependencies: goal.decisions?.at(-1)?.state?.acquisition?.dependencies,
    blueprint: goal.blueprint && { origin: goal.blueprint.origin, blocks: goal.blueprint.blocks?.slice(0, 6000) },
  });
}
function classify(row) {
  if (row.disconnected || row.connection) return ['connection', 'Connection changed'];
  if (row.death) return ['danger', 'Player died'];
  if (row.acceptance || row.result) return ['result', `Run ${row.acceptance || row.result}`];
  if (row.navigationStall) return ['error', 'Navigation stalled'];
  if (row.navigationRecovery) return ['recovery', 'Navigation recovery'];
  if (row.handover) return ['action', `Item handover · ${row.handover.event || 'update'}`];
  if (row.mobHunt) return ['action', `Mob encounter · ${row.mobHunt.outcome}`];
  if (row.strongholdSearch) return ['action', `Stronghold search · ${human(row.strongholdSearch.kind)}`];
  if (row.error || row.lastError) return ['error', row.error || row.lastError];
  if (row.survivalAction?.action) return ['survival', human(row.survivalAction.action)];
  if (row.step?.action) return ['action', `${human(row.step.action)} ${human(row.step.item || row.step.block || '')}`.trim()];
  if (row.chat) return ['chat', row.chat];
  if (row.start) return ['start', 'Request started'];
  if (row.scenario) return ['start', row.scenario];
  if (row.resumed) return ['start', 'Saved request resumed'];
  if (row.health !== undefined) return ['vitals', 'Vitals updated'];
  return ['observation', 'World observed'];
}
function decisionSource(decision, kind) {
  if (['connection', 'result', 'start', 'chat', 'observation', 'vitals'].includes(kind)) return 'observed';
  if (decision?.stale) return 'stale';
  if (decision?.judgments?.length && ['decision', 'action'].includes(kind)) return 'jev';
  return kind === 'survival' || kind === 'danger' ? 'survival' : 'rules';
}

function legacyFrames(rows, goal = {}) {
  // Goal files provide current context, never retroactive inventory or health.
  let state = { goal: goalView({ kind: goal.kind, request: goal.request, item: goal.item, count: goal.count,
    interpretation: goal.interpretation, itemResolution: goal.itemResolution }), connected: null };
  let lastAction, lastDecision;
  const frames = [], sizes = []; let bytes = 0;
  for (const [index, row] of rows.entries()) {
    const decision = row.decision && !row.decision.stale ? row.decision : row.decision || state.decision;
    const action = row.survivalAction;
    const newSurvival = action?.at && action.at !== lastAction;
    const newDecision = row.decision?.at && row.decision.at !== lastDecision;
    let [kind, label] = classify({ ...row, survivalAction: newSurvival ? action : undefined });
    if (newDecision && kind === 'observation') [kind, label] = ['decision', 'Decision selected'];
    if (action?.at) lastAction = action.at;
    if (row.decision?.at) lastDecision = row.decision.at;
    const at = row.at || row.time || (newSurvival ? action.at : newDecision ? row.decision.at : null);
    const nested = row.navigationStall || row.navigationRecovery || row.handover || row.start || {};
    state = { ...state, goal: { ...state.goal,
      ...(row.start && { request: row.start.request, kind: row.start.kind, count: row.start.count }),
      ...(row.scenario && !state.goal.request && { request: row.scenario }),
      ...(row.step && { step: row.step }), ...(action && { survivalAction: action }),
      ...(row.status && { status: row.status }), error: row.error || row.reason || null,
      ...(decision?.state?.acquisition?.dependencies && { dependencies: decision.state.acquisition.dependencies }),
    }, decision,
    ...(position(row.position || nested.position) && { position: position(row.position || nested.position) }),
    ...(row.inventory && { inventory: row.inventory }), ...(row.tools && { tools: row.tools }),
    ...Object.fromEntries(['health', 'food', 'oxygen', 'dimension'].filter(k => row[k] !== undefined).map(k => [k, row[k]])),
    };
    const frame = { id: index + 1, at, kind, label: String(label).slice(0, 240), source: decisionSource(newDecision ? row.decision : null, kind),
      snapshot: clean(state), detail: clean(row) };
    frames.push(frame); const size = Buffer.byteLength(JSON.stringify(frame)); sizes.push(size); bytes += size;
    while (frames.length > MAX_FRAMES || (bytes > MAX_TRACE_BYTES && frames.length > 1)) { frames.shift(); bytes -= sizes.shift(); }
  }
  return frames.slice(-MAX_FRAMES);
}

class Trace {
  constructor({ id = 'live', label = 'Jev', mode = 'live', onFrame = () => {} } = {}) {
    this.id = id; this.label = label; this.mode = mode; this.frames = []; this.serial = 0; this.epoch = 0;
    this.connected = false; this.onFrame = onFrame; this.bytes = 0; this.sizes = [];
  }
  append(frame) {
    const next = { ...clean(frame), id: ++this.serial, at: frame.at || new Date().toISOString() };
    this.frames.push(next);
    const size = Buffer.byteLength(JSON.stringify(next)); this.bytes += size; this.sizes.push(size);
    while (this.frames.length > MAX_FRAMES || (this.bytes > MAX_TRACE_BYTES && this.frames.length > 1)) { this.frames.shift(); this.bytes -= this.sizes.shift(); }
    this.onFrame(next); return next;
  }
  view(after = 0) { return { id: this.id, label: this.label, mode: this.mode, epoch: this.epoch,
    connected: this.connected, frames: this.frames.filter(f => f.id > after), oldestId: this.frames[0]?.id || 0,
    latestId: this.serial, limited: this.serial > this.frames.length }; }
}

module.exports = { MAX_FRAMES, clean, position, goalView, classify, decisionSource, legacyFrames, Trace };
