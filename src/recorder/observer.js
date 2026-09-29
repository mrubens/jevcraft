'use strict';
const { Vec3 } = require('vec3');
const { clean, position, goalView, decisionSource } = require('./trace');
const { turnHeld } = require('../turn');
const { loadedCommit } = require('./commit');
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

function shieldUp(bot) {
  const f = bot.entity?.metadata?.[8];
  return typeof f === 'number' ? (f & 3) === 3 && bot.inventory?.slots?.[45]?.name === 'shield' : !!bot._shieldRaised;
}
// Up less than the quarter second a raised shield takes to block (combat.js
// SHIELD_BLOCKS_AFTER_MS): a blow then lands whole. recent.js printed
// "(shield up)" for such blows, and they read as the shield failing
// (note 683).
function shieldRising(bot, now = Date.now()) {
  return !!bot._shieldRaised && now - (bot._shieldRaisedAt || 0) < require('../combat').SHIELD_BLOCKS_AFTER_MS;
}

function observeBot(trace, bot, { getGoal = () => ({}), getLedger = () => null, controls = {}, server = '', commit = loadedCommit(), arm = process.env.JEV_ARM || null } = {}) {
  let alive = true, world = null, worldAt = 0, route = [], previousDecision, previousAction;
  const epoch = ++trace.epoch;
  trace.label = `${bot.username || 'Jev'} · ${server}`;
  trace.connected = false;
  const listeners = [];
  const on = (name, fn) => { bot.on(name, fn); listeners.push([name, fn]); };
  function mobsAbout(bot) {
    try {
      const here = bot.entity?.position;
      if (!here) return undefined;
      const { threats } = require('../danger');
      // Shooters out to forty-eight: a ghast fires from forty, and
      // mid-242-s's was never in the record that its fireballs burned down.
      const { shooter } = require('../mob-policy');
      return threats(bot, 64).filter(t => t.distance <= 24 || shooter(t.entity)).slice(0, 8).map(t => ({ name: t.entity.name, id: t.entity.id, d: Math.round(t.distance * 10) / 10,
        at: { x: Math.round(t.entity.position.x * 10) / 10, y: Math.round(t.entity.position.y * 10) / 10, z: Math.round(t.entity.position.z * 10) / 10 }, seen: !!t.visible }));
    } catch (_) { return undefined; }
  }
  function snapshot(goal) {
    const now = Date.now();
    if (!world || now - worldAt >= 2000) { world = terrain(bot); worldAt = now; }
    const items = bot.inventory?.items?.() || [];
    return { connected: trace.connected, position: position(bot.entity?.position), dimension: bot.game?.dimension,
      gameMode: bot.game?.gameMode, flying: !!bot._creativeFlight?.active,
      health: bot.health, food: bot.food, oxygen: bot.oxygenLevel, yaw: bot.entity?.yaw, pitch: bot.entity?.pitch,
      // How it was moving and what keys were down: mid-243-g went west and
      // over the edge into the lava with its route east, and the record
      // could not say what moved it (note 320).
      velocity: bot.entity?.velocity ? position(bot.entity.velocity) : undefined, onGround: bot.entity?.onGround,
      // The shield by the server's word where it has said (the bot's own
      // living entity flags): the code's flag stayed up through meals and
      // draws that had ended the shield's use (note 676); 'shield_rising'
      // beside it in the quarter second before it blocks (note 683).
      keys: bot.controlState ? [...Object.keys(bot.controlState).filter(k => bot.controlState[k]), ...(shieldUp(bot) ? ['shield', ...(shieldRising(bot) ? ['shield_rising'] : [])] : [])] : undefined,
      // Held behind the shield for a shot on its way (shot-reflex.js), and
      // why; or why a hold was refused a moment ago.
      ...(bot._shotHold ? { shotHold: bot._shotHold.why } : bot._shotRefused && Date.now() - bot._shotRefused.at < 1000 ? { shotRefused: bot._shotRefused.why } : {}),
      inventory: Object.fromEntries([...new Set(items.map(i => i.name))].map(n => [n, items.filter(i => i.name === n).reduce((a, i) => a + i.count, 0)])),
      tools: items.filter(i => bot.registry?.itemsByName?.[i.name]?.maxDurability).map(i => ({ name: i.name,
        remaining: bot.registry.itemsByName[i.name].maxDurability - (i.durabilityUsed || 0) })),
      // Worn, which items() leaves out: the armour and the off-hand.
      equipment: Object.fromEntries([[5, 'head'], [6, 'torso'], [7, 'legs'], [8, 'feet'], [45, 'offhand']]
        .map(([slot, name]) => [name, bot.inventory?.slots?.[slot]?.name || null])),
      goal: goalView(goal), decision: goal.decisions?.at(-1), world, route,
      // Who is moving the bot, and how: the step on the goal went stale
      // while other code held the keys, and a fall had to be reconstructed.
      controller: bot._controller ? { ...bot._controller } : null,
      // Who has the turn and for how long (turn.js): the survival step, a
      // stance held, a question out to Jev, a meal, the work's step. Seconds
      // of silence while hurt (notes 358, 366, 391) had no holder in the
      // record.
      turn: turnHeld(bot, now),
      // The question out, and how far it has got (decisions/index.js): the
      // stages a question that never came back had reached (note 540).
      question: bot._asking ? { id: bot._asking.id, at: bot._asking.at, stages: bot._asking.stages.map(s => ({ ...s })), ...(bot._asking.lookedMs !== undefined ? { lookedMs: bot._asking.lookedMs } : {}) } : undefined,
      // What the arbiter, in shadow, would have given the last pass to,
      // beside the layer that took it (src/arbiter.js shadow).
      arbiter: bot._arbiterShadow ? { would: bot._arbiterShadow.would, gave: bot._arbiterShadow.gave } : undefined,
      // The mobs about, where they stand: mid-211-p's creeper went off two
      // seconds after the last frame without one, and several deaths could
      // not say where the mob that hit it stood (notes 424, 437).
      mobs: mobsAbout(bot),
      held: Object.entries(bot.controlState || {}).filter(([, on]) => on).map(([key]) => key),
      pathing: !!bot.pathfinder?.isMoving?.(),
      memory: bot.companionMemory ? { places: bot.companionMemory.state.places.length,
        notes: bot.companionMemory.state.notes.length, preferences: bot.companionMemory.state.preferences.length, tasks: bot.companionMemory.state.history.length } : undefined,
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
    if (kind === 'decision' && !decision) return;
    if (kind === 'step') { previousDecision = decision?.at; previousAction = action?.at; }
    // A decision framed when it was made: the step's report after it is not
    // the decision again.
    else if (kind === 'decision') previousDecision = decision.at;
    if (kind === 'step') kind = freshDecision ? 'decision' : goal.lastError ? 'error' : freshAction ? 'survival' : 'action';
    // An idle step with nothing to name is a heartbeat, not an activity. The
    // idle loop reports one every second, and hundreds of blank "action"
    // cards buried the requests and decisions between them.
    if (kind === 'action' && !goal.step?.action) kind = 'observation';
    const label = kind === 'recovery_advice' ? detail?.source === 'jev' ? 'Jev chose a recovery action' : 'Fable recovery advice'
      : kind === 'recovery_result' ? detail?.outcome || 'Recovery outcome'
      : kind === 'damage' ? `hurt: ${String(detail?.type ?? 'unknown').replaceAll('_', ' ')}${detail?.cause ? ` by ${detail.cause}` : ''}`
      : kind === 'request' ? `Understood: ${String(detail?.kind || 'request').replaceAll('_', ' ')}`
      : kind === 'clarify' ? `Asked back: ${detail?.message || 'a clarifying question'}`
      : kind === 'dream' ? `Dream ${({ clear: 'taken away', query: 'asked about', pause: 'set aside', resume: 'picked back up' })[detail?.operation] || `given: ${String(detail?.key || '').replaceAll('_', ' ')}`}`
      : kind === 'decision' ? decision.stale ? 'Discarded changed-state decision' : decision.fallback ? `${(decision.path || []).join(' → ')} (code default: Jev unreachable)` : decision.judgments?.length ? (decision.path || []).join(' → ') : decision.committed ? `Kept working ${String(decision.path?.at(-1) || 'the chosen source').replaceAll('_', ' ')}` : `${(decision.path || []).join(' → ')} (only feasible option)` : kind === 'survival' ? String(action.action || 'survival').replaceAll('_', ' ') :
      kind === 'error' ? goal.lastError || 'Action failed' : kind === 'action' ? [goal.step?.action, goal.step?.item || goal.step?.block].filter(Boolean).join(' ').replaceAll('_', ' ') : kind.replaceAll('_', ' ');
    const source = kind === 'recovery_advice' ? (detail?.source === 'jev' ? 'jev' : 'fable')
      : kind === 'decision' && decision.fallback ? 'fallback'
      : kind === 'decision' && !decision.stale && !decision.judgments?.length ? 'rules'
      : decisionSource(freshDecision ? decision : null, kind);
    trace.append({ kind, label, source, snapshot: snapshot(goal), detail });
    delete trace.observationError;
  }
  // The commit rides on every connection frame: the first frame of a run, and
  // the one a rejoin writes, say which build the run is (scripts/lib/flight-commit.js),
  // and the arm of a two-arm trial it was started on (JEV_ARM, scripts/lib/arms.js).
  on('spawn', () => { trace.connected = true; sample('connection', { connected: true, ...(commit ? { commit } : {}), ...(arm ? { arm } : {}) }); });
  on('path_update', p => { route = (p.path || []).slice(0, 128).map(position).filter(Boolean); });
  on('flight_route', p => { route = (p.path || []).slice(0, 128).map(position).filter(Boolean); });
  on('goal_reached', () => { route = []; });
  on('path_reset', () => { route = []; });
  for (const kind of ['shot', 'health', 'death', 'no_route', 'navigation_stall', 'navigation_recovery', 'view_resync', 'dig_unconfirmed', 'handover', 'mob_hunt', 'stronghold_search', 'end_combat', 'fall_recovery', 'recovery_advice', 'recovery_result']) on(kind, detail => sample(kind === 'death' ? 'danger' : kind === 'health' ? 'vitals' : kind, clean(detail)));
  on('chat', (from, message) => sample('chat', { from, message }));
  // Every answer from Jev, at the moment it came (decisions/index.js decide).
  on('jev_decision', goal => sample('decision', undefined, goal));
  // What hurt the bot, from the server's own damage event: its damage type
  // (by name where the registry was seen) and the mob that caused it. The
  // vitals frames showed a point lost and nothing of why: mid-241-d lost its
  // last two climbing a staircase and "suffocated in a wall" (note 293).
  const client = bot._client;
  const damageTypes = bot._damageTypeNames ||= [];
  const registry = packet => { if (/damage_type/.test(String(packet?.id || '')) && Array.isArray(packet.entries)) packet.entries.forEach((e, i) => { damageTypes[i] = String(e.key || e.id || '').replace('minecraft:', ''); }); };
  const hurt = packet => {
    if (!bot.entity || packet.entityId !== bot.entity.id) return;
    const by = id => id > 0 ? bot.entities[id - 1]?.name || null : null;
    sample('damage', { type: damageTypes[packet.sourceTypeId] || packet.sourceTypeId, cause: by(packet.sourceCauseId), direct: by(packet.sourceDirectId), ...(packet.sourcePosition ? { from: packet.sourcePosition } : {}) });
  };
  if (client?.on) {
    client.on('registry_data', registry); client.on('damage_event', hurt);
    listeners.push(['__client', () => { client.removeListener('registry_data', registry); client.removeListener('damage_event', hurt); }]);
  }
  const timer = setInterval(() => { if (trace.connected) sample(); }, 1000);
  timer.unref();
  // While keys are held outside the pathfinder, four looks a second: a fall
  // off an edge takes two, and one look a second saw its start and its end.
  const motion = setInterval(() => {
    if (!trace.connected || bot.pathfinder?.isMoving?.()) return;
    if (Object.values(bot.controlState || {}).some(Boolean)) sample('motion');
  }, 250);
  motion.unref();
  function detach(reason = 'disconnected') {
    if (!alive) return;
    if (trace.epoch === epoch) { trace.connected = false; sample('connection', { connected: false, reason }); }
    alive = false; clearInterval(timer); clearInterval(motion); for (const [name, fn] of listeners) name === '__client' ? fn() : bot.removeListener(name, fn);
  }
  on('end', detach);
  // The run's cost so far, read fresh on every poll; a ledger that cannot
  // be read hides the panel rather than the whole view.
  function ledger() { try { return getLedger() ?? null; } catch { return null; } }
  return { epoch, sample, detach, controls, ledger, get connected() { return alive && trace.connected && trace.epoch === epoch; } };
}
module.exports = { terrain, observeBot };
