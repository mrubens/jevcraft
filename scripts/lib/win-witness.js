'use strict';
// Acceptance observer: consumes live packets and inventory, never goal state.
// A runtime witness is necessary, but saved server data and fresh-world/setup
// provenance must still be audited separately before claiming acceptance.
const where = bot => String(bot.game.dimension).replace(/^minecraft:/, '').replace(/^the_/, '');
const stock = bot => bot.inventory.items().reduce((out, item) => {
  out[item.name] = (out[item.name] || 0) + item.count; return out;
}, {});
function packetTime(value) {
  try {
    const n = Number(Array.isArray(value) ? BigInt(value[0]) * 4294967296n + BigInt(value[1] >>> 0) : value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch (_) { return null; }
}
function watchWinAcceptance(bot, { resumed = false, scenario = 'natural', now = Date.now, record = () => {} } = {}) {
  const initial = { at: now(), inventory: stock(bot), dimension: where(bot), mode: bot.game.gameMode,
    difficulty: bot.game.difficulty, position: { ...bot.entity.position }, health: bot.health };
  if (resumed || scenario !== 'natural' || Object.keys(initial.inventory).length || initial.dimension !== 'overworld' ||
    initial.mode !== 'survival' || initial.difficulty !== 'normal' || !(initial.health > 0)) {
    throw new Error('Winning acceptance requires an uninterrupted empty Normal Survival start in a natural Overworld');
  }
  const state = { version: 1, initial, resources: {}, milestones: {}, violations: [], deaths: 0 };
  const listeners = [], on = (emitter, name, fn) => { emitter.on(name, fn); listeners.push([emitter, name, fn]); };
  const emit = (kind, detail) => record({ at: now(), kind, ...detail });
  const violate = reason => {
    if (state.violations.some(v => v.reason === reason)) return;
    const detail = { at: now(), reason }; state.violations.push(detail); emit('violation', detail);
  };
  const milestone = (name, details = {}) => {
    if (state.milestones[name]) return;
    state.milestones[name] = { at: now(), dimension: where(bot), ...details };
    emit('milestone', { name, ...state.milestones[name] });
  };
  const sample = () => {
    if (bot.game.gameMode !== 'survival') violate('Left Survival mode');
    if (bot.game.difficulty !== 'normal') violate('Difficulty changed from Normal');
    // Mineflayer temporarily clears isAlive on every dimension respawn packet.
    // Positive health during that loading interval is not a witnessed death.
    if (!(bot.health > 0)) violate('Player had no health');
    const dimension = where(bot);
    if (dimension === 'nether') milestone('nether_entered');
    if (dimension === 'end') milestone('end_entered');
    const items = stock(bot);
    for (const name of ['blaze_rod', 'ender_pearl', 'ender_eye']) {
      if ((items[name] || 0) <= (state.resources[name]?.maximum || 0)) continue;
      state.resources[name] = { firstAt: state.resources[name]?.firstAt ?? now(),
        firstDimension: state.resources[name]?.firstDimension || dimension, at: now(), dimension, maximum: items[name] };
      emit('inventory', { item: name, ...state.resources[name] });
    }
    if ((items.ender_eye || 0) >= 12 && dimension === 'overworld') milestone('eyes_before_end', { count: items.ender_eye });
    if (dimension === 'overworld' && state.milestones.exit_portal_used && bot.health > 0 && bot.isAlive !== false) {
      milestone('living_return', { health: bot.health, position: { ...bot.entity.position } });
    }
  };
  on(bot, 'game', sample); on(bot, 'spawn', sample); on(bot, 'health', sample); on(bot.inventory, 'updateSlot', sample);
  // The upstream difficulty listener updates state without emitting 'game'.
  // Compatibility has normalized the value by the time this listener runs.
  on(bot._client, 'difficulty', sample);
  on(bot, 'death', () => { state.deaths++; violate('Death during winning acceptance'); });
  on(bot, 'end', () => violate('Connection ended before witness was detached'));
  on(bot._client, 'advancements', packet => {
    for (const entry of packet.progressMapping || []) {
      if (entry.key !== 'minecraft:end/kill_dragon') continue;
      const at = packetTime(entry.value?.find(v => v.criterionIdentifier === 'killed_dragon')?.criterionProgress);
      const entered = state.milestones.end_entered;
      if (!entered || where(bot) !== 'end' || !at || at < initial.at || at < entered.at || at > now() + 60000) continue;
      milestone('dragon_kill_credit', { at, source: entry.key });
    }
  });
  on(bot._client, 'game_state_change', packet => {
    if (![4, 'win_game'].includes(packet.reason) || where(bot) !== 'end' || !state.milestones.dragon_kill_credit ||
      !(bot.health > 0) || bot.isAlive === false) return;
    milestone('exit_portal_used', { source: 'game_state_change:win_game' });
  });
  emit('initial', initial);
  return {
    state, sample,
    verify() {
      sample();
      const m = state.milestones, missing = [];
      for (const name of ['nether_entered', 'eyes_before_end', 'end_entered', 'dragon_kill_credit', 'exit_portal_used', 'living_return']) {
        if (!m[name]) missing.push(name);
      }
      for (const name of ['blaze_rod', 'ender_pearl']) if (!state.resources[name]) missing.push(`inventory:${name}`);
      for (const name of ['blaze_rod', 'ender_pearl']) if (m.end_entered && state.resources[name]?.firstAt > m.end_entered.at) missing.push(`${name}_before_first_end_entry`);
      if (state.resources.blaze_rod && (state.resources.blaze_rod.firstDimension !== 'nether' ||
        state.resources.blaze_rod.firstAt < m.nether_entered?.at)) missing.push('blaze_rod_observed_in_nether');
      if (m.end_entered && m.eyes_before_end?.at > m.end_entered.at) missing.push('eyes_obtained_before_first_end_entry');
      if (m.end_entered && m.nether_entered?.at > m.end_entered.at) missing.push('nether_before_first_end_entry');
      if (m.exit_portal_used?.at < m.dragon_kill_credit?.at || m.living_return?.at < m.exit_portal_used?.at) missing.push('ordered_living_return');
      if (where(bot) !== 'overworld') missing.push('currently_in_overworld');
      if (bot.isAlive === false) missing.push('currently_alive');
      return { ok: !missing.length && !state.violations.length && state.deaths === 0, missing,
        violations: state.violations, state, independentServerVerification: 'required' };
    },
    detach() { for (const [emitter, name, fn] of listeners.splice(0)) emitter.removeListener(name, fn); },
  };
}
module.exports = { watchWinAcceptance };
