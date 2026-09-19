'use strict';

const dimension = bot => String(bot.game?.dimension || '').replace(/^minecraft:/, '').replace(/^the_/, '');
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const position = bot => bot.entity?.position && { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z };
function milliseconds(value) {
  try {
    const result = Array.isArray(value) ? Number((BigInt(value[0]) << 32n) | BigInt(value[1] >>> 0)) : Number(value);
    return Number.isSafeInteger(result) && result > 0 ? result : null;
  } catch (_) { return null; }
}

function observeProgress(bot, goal, now = Date.now()) {
  const progress = goal.gameProgress ||= { version: 1, startedAt: now, milestones: {} };
  const milestones = progress.milestones, where = dimension(bot);
  for (const [name, present] of [['nether_entered', where === 'nether'], ['end_entered', where === 'end'],
    ['eyes_obtained', count(bot, 'ender_eye') >= 12]]) {
    if (present && !milestones[name]) milestones[name] = { at: now, dimension: where, position: position(bot) };
  }
  return progress;
}

// These are observations, not permission to use server commands. The vanilla
// 26.1 kill_dragon advancement requires this player to kill an Ender Dragon.
// Old advancement timestamps, a despawn, or death/respawn cannot prove victory.
function watchGameProgress(bot, goal, save, { now = Date.now } = {}) {
  observeProgress(bot, goal, now());
  const onGame = () => { observeProgress(bot, goal, now()); save(); };
  const onAdvancements = packet => {
    const progress = goal.gameProgress;
    if (!progress.milestones.end_entered) return;
    for (const entry of packet.progressMapping || []) {
      if (entry.key !== 'minecraft:end/kill_dragon') continue;
      const at = milliseconds(entry.value?.find(c => c.criterionIdentifier === 'killed_dragon')?.criterionProgress);
      if (!at || at < progress.startedAt || at < progress.milestones.end_entered.at || at > now() + 60000) continue;
      progress.milestones.dragon_defeated = { at, source: 'minecraft:end/kill_dragon', criterion: 'killed_dragon' };
      save();
    }
  };
  const onExit = packet => {
    const progress = goal.gameProgress;
    if (![4, 'win_game'].includes(packet.reason) || dimension(bot) !== 'end' ||
      !progress.milestones.dragon_defeated || bot.health <= 0 || bot.isAlive === false) return;
    progress.milestones.exit_portal_used = { at: now(), dimension: 'end', position: position(bot), source: 'game_state_change:win_game' };
    save();
  };
  const onDeath = () => {
    goal.gameProgress.lastDeathAt = now();
    delete goal.gameProgress.milestones.exit_portal_used;
    delete goal.gameProgress.milestones.returned_alive;
    save();
  };
  bot.on('game', onGame); bot.on('spawn', onGame); bot.on('death', onDeath);
  bot._client.on('advancements', onAdvancements); bot._client.on('game_state_change', onExit);
  return () => {
    bot.removeListener('game', onGame); bot.removeListener('spawn', onGame); bot.removeListener('death', onDeath);
    bot._client.removeListener('advancements', onAdvancements); bot._client.removeListener('game_state_change', onExit);
  };
}

function verifyGameCompletion(bot, goal) {
  const progress = goal.gameProgress, m = progress?.milestones;
  if (!m?.nether_entered || !m.eyes_obtained || !m.end_entered || !m.dragon_defeated || !m.exit_portal_used) return false;
  const lastDeath = Math.max(progress.lastDeathAt || 0, ...(goal.survival?.deaths || []).map(d =>
    typeof d.at === 'number' ? d.at : Date.parse(d.at) || 0));
  return bot.game.gameMode === 'survival' && bot.health > 0 && bot.isAlive !== false && dimension(bot) === 'overworld' &&
    m.dragon_defeated.source === 'minecraft:end/kill_dragon' && m.dragon_defeated.at >= progress.startedAt &&
    m.dragon_defeated.at >= m.end_entered.at &&
    m.exit_portal_used.source === 'game_state_change:win_game' &&
    m.exit_portal_used.at >= m.dragon_defeated.at && m.exit_portal_used.at > lastDeath;
}

function nextGameStage(bot, goal) {
  if (verifyGameCompletion(bot, goal)) return { phase: 'complete' };
  const where = dimension(bot), m = goal.gameProgress?.milestones || {};
  if (where === 'end') return m.dragon_defeated ? { phase: 'return_alive', action: 'exit_end' } : { phase: 'defeat_dragon', action: 'fight_dragon' };
  // Carry a reserve for eye throws; execution always replans from inventory,
  // so loss, crafting batches and partial pickups do not advance a fake counter.
  const target = 16, eyes = count(bot, 'ender_eye');
  const rods = Math.ceil(Math.max(0, target - eyes - count(bot, 'blaze_powder')) / 2);
  if (count(bot, 'blaze_rod') < rods) {
    return where === 'nether' ? { phase: 'obtain_blaze_rods', action: 'acquire', item: 'blaze_rod', count: rods } :
      { phase: 'reach_nether', action: 'enter_nether' };
  }
  if (where === 'nether') return { phase: 'return_with_blaze_supplies', action: 'return_overworld' };
  if (where !== 'overworld') return { phase: 'unknown_dimension', action: 'unsupported_dimension' };
  if (count(bot, 'ender_pearl') < target - eyes) return { phase: 'obtain_ender_pearls', action: 'acquire', item: 'ender_pearl', count: target - eyes };
  if (eyes < target) return { phase: 'craft_eyes', action: 'acquire', item: 'ender_eye', count: target };
  if (!m.stronghold_located) return { phase: 'find_stronghold', action: 'find_stronghold' };
  return { phase: 'enter_end', action: 'enter_end' };
}

async function gameStep(bot, task, goal, save, actions) {
  task.check();
  if (bot.game.gameMode !== 'survival') throw Object.assign(new Error('The game-completion task requires Survival mode'), { name: 'Blocked' });
  const progress = observeProgress(bot, goal), stage = nextGameStage(bot, goal);
  progress.phase = stage.phase; goal.step = { action: 'game_progression', ...stage }; save();
  if (stage.phase === 'complete') {
    progress.milestones.returned_alive = { at: Date.now(), dimension: 'overworld', position: position(bot) }; save(); return true;
  }
  if (stage.action === 'acquire') await actions.acquireStep(bot, task, stage.item, stage.count, goal, save);
  else {
    // Gather combat supplies in the Overworld before a first Nether trip;
    // iron ore is not available to repair this dependency once inside.
    if (stage.action === 'enter_nether' && actions.prepare_combat && !await actions.prepare_combat(bot, task, goal, save)) return false;
    const execute = actions[stage.action];
    if (!execute) throw Object.assign(new Error(`Game progression is blocked at ${stage.phase.replaceAll('_', ' ')}: the ${stage.action.replaceAll('_', ' ')} action is not implemented yet. Earlier progress is saved.`), { name: 'Blocked' });
    await execute(bot, task, goal, save);
  }
  return false;
}

module.exports = { dimension, observeProgress, watchGameProgress, verifyGameCompletion, nextGameStage, gameStep };
