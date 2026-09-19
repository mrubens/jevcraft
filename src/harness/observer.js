'use strict';
const { Vec3 } = require('vec3');
const { clean, position, goalView, decisionSource } = require('./trace');
const water = new Set(['water', 'bubble_column', 'seagrass', 'kelp', 'tall_seagrass', 'kelp_plant']);

function terrain(bot, radius = 12) {
  if (!bot.entity?.position || !bot.blockAt) return null;
  const origin = bot.entity.position.floored(), palette = [], ids = new Map(), blocks = [], known = [];
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    let loaded = false;
    for (let y = -5; y <= 12; y++) {
      const block = bot.blockAt(origin.offset(x, y, z));
      if (!block) continue;
      loaded = true;
      if (block.boundingBox !== 'block' && !water.has(block.name)) continue;
      if (!ids.has(block.name)) { ids.set(block.name, palette.length); palette.push(block.name); }
      blocks.push([x, y, z, ids.get(block.name)]);
    }
    if (loaded) known.push([x, z]);
  }
  return { origin: position(origin), radius, minY: -5, maxY: 12, palette, blocks, known };
}

function observeBot(trace, bot, { getGoal = () => ({}), controls = {}, server = '' } = {}) {
  let alive = true, world = null, worldAt = 0, route = [], previousDecision, previousAction;
  const epoch = ++trace.epoch;
  trace.label = `${bot.username || 'Jev'} · ${server}`;
  trace.connected = false;
  const listeners = [];
  const on = (name, fn) => { bot.on(name, fn); listeners.push([name, fn]); };
  function snapshot(goal) {
    const now = Date.now();
    if (!world || now - worldAt >= 2000) { world = terrain(bot); worldAt = now; }
    const items = bot.inventory?.items?.() || [];
    return { connected: trace.connected, position: position(bot.entity?.position), dimension: bot.game?.dimension,
      gameMode: bot.game?.gameMode, flying: !!bot._creativeFlight?.active,
      health: bot.health, food: bot.food, oxygen: bot.oxygenLevel, yaw: bot.entity?.yaw, pitch: bot.entity?.pitch,
      inventory: Object.fromEntries([...new Set(items.map(i => i.name))].map(n => [n, items.filter(i => i.name === n).reduce((a, i) => a + i.count, 0)])),
      tools: items.filter(i => bot.registry?.itemsByName?.[i.name]?.maxDurability).map(i => ({ name: i.name,
        remaining: bot.registry.itemsByName[i.name].maxDurability - (i.durabilityUsed || 0) })),
      goal: goalView(goal), decision: goal.decisions?.at(-1), world, route,
      memory: bot.companionMemory ? { places: bot.companionMemory.state.places.length,
        notes: bot.companionMemory.state.notes.length, tasks: bot.companionMemory.state.history.length } : undefined,
      entities: Object.values(bot.entities || {}).filter(e => e !== bot.entity && e.position?.distanceTo(bot.entity.position) < 24)
        .slice(0, 50).map(e => ({ id: e.id, name: e.username || e.name, position: position(e.position), kind: e.type })),
    };
  }
  function sample(kind = 'observation', detail, goal) {
    try { return collect(kind, detail, goal || getGoal() || {}); }
    catch (err) { trace.observationError = String(err.message).slice(0, 160); }
  }
  function collect(kind, detail, goal) {
    if (!alive || trace.epoch !== epoch || !bot.entity?.position) return;
    const decision = goal.decisions?.at(-1), action = goal.survivalAction;
    const freshDecision = decision?.at && decision.at !== previousDecision;
    const freshAction = action?.at && action.at !== previousAction;
    if (kind === 'step') { previousDecision = decision?.at; previousAction = action?.at; }
    if (kind === 'step') kind = freshDecision ? 'decision' : goal.lastError ? 'error' : freshAction ? 'survival' : 'action';
    const label = kind === 'recovery_advice' ? 'Fable recovery advice' : kind === 'recovery_result' ? detail?.outcome || 'Recovery outcome' : kind === 'decision' ? decision.stale ? 'Discarded changed-state decision' : (decision.path || []).join(' → ') || 'Decision selected' : kind === 'survival' ? String(action.action || 'survival').replaceAll('_', ' ') :
      kind === 'error' ? goal.lastError || 'Action failed' : kind === 'action' ? [goal.step?.action, goal.step?.item || goal.step?.block].filter(Boolean).join(' ').replaceAll('_', ' ') : kind.replaceAll('_', ' ');
    trace.append({ kind, label, source: kind === 'recovery_advice' && detail?.model ? 'fable' : decisionSource(freshDecision ? decision : null, kind), snapshot: snapshot(goal), detail });
    delete trace.observationError;
  }
  on('spawn', () => { trace.connected = true; sample('connection', { connected: true }); });
  on('path_update', p => { route = (p.path || []).slice(0, 128).map(position).filter(Boolean); });
  on('flight_route', p => { route = (p.path || []).slice(0, 128).map(position).filter(Boolean); });
  on('goal_reached', () => { route = []; });
  on('path_reset', () => { route = []; });
  for (const kind of ['health', 'death', 'navigation_stall', 'navigation_recovery', 'handover', 'mob_hunt', 'stronghold_search', 'end_combat', 'fall_recovery', 'recovery_advice', 'recovery_result']) on(kind, detail => sample(kind === 'death' ? 'danger' : kind === 'health' ? 'vitals' : kind, clean(detail)));
  on('chat', (from, message) => sample('chat', { from, message }));
  const timer = setInterval(() => { if (trace.connected) sample(); }, 1000);
  timer.unref();
  function detach(reason = 'disconnected') {
    if (!alive) return;
    if (trace.epoch === epoch) { trace.connected = false; sample('connection', { connected: false, reason }); }
    alive = false; clearInterval(timer); for (const [name, fn] of listeners) bot.removeListener(name, fn);
  }
  on('end', detach);
  return { epoch, sample, detach, controls, get connected() { return alive && trace.connected && trace.epoch === epoch; } };
}
module.exports = { terrain, observeBot };
