'use strict';
const { homeStage, bedCarried, woolCarried, homeOf } = require('./home-base');
const { restockStage, rungWants } = require('./home-stash');
const { villageBedRung } = require('./villages');

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

// The early rungs of the ladder, each visible within minutes. "Reach the
// Nether" as a first stage hid hours of preparation behind one label.
const TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
const tierOf = name => { const m = /^(\w+)_(pickaxe|sword|axe)$/.exec(name); return m ? TIERS.indexOf(m[1]) + 1 : 0; };
// The stash first: a respawn at the bed with empty pockets, or a rung the
// chest beside the bed can answer, is a walk of two blocks rather than an
// hour of gathering. Read from memory of the chest, so a chest with nothing
// in it costs nothing.
function preparationStage(bot, goal = {}) {
  const rung = preparationRung(bot, goal);
  const home = homeOf(bot, goal);
  if (!home?.stash?.position) return rung;
  const wants = rungWants(bot, rung, { home, goal });
  const restock = restockStage(bot, goal, wants);
  if (restock) return { ...restock, action: 'home', home: { ...restock, wants } };
  return rung;
}
function preparationRung(bot, goal = {}) {
  // Equipped gear lives outside inventory.items(): armour in slots 5 to 8,
  // the shield in the off-hand at 45. A shield on the arm is not a missing shield.
  const equipped = [5, 6, 7, 8, 45].map(slot => bot.inventory.slots?.[slot]).filter(Boolean);
  const carried = [...bot.inventory.items(), ...equipped].map(i => i.name);
  // A tool about to break does not count as a tool: the rung fires again
  // while the old one still works, so the spare is made above ground and
  // not after the shaft goes dark. Twenty percent of durability is enough
  // to finish a trip and get back to a crafting table.
  const usable = item => { const max = bot.registry?.itemsByName?.[item.name]?.maxDurability; return !max || max - (item.durabilityUsed || 0) >= max * 0.2; };
  const sound = [...bot.inventory.items(), ...equipped].filter(usable).map(i => i.name);
  const best = kind => Math.max(0, ...sound.filter(n => n.endsWith(`_${kind}`)).map(tierOf));
  // A worn tool is still in the inventory, so the replacement is one more
  // than what is carried; asking for one would be satisfied by the worn one.
  const another = item => ({ phase: item, action: 'acquire', item, count: carried.filter(n => n === item).length + 1 });
  if (best('pickaxe') < 2) return another('stone_pickaxe');
  if (best('sword') < 2) return another('stone_sword');
  // A bed before the mine. Walled in and waiting was the largest share of
  // the run's standing still, and a night slept passes in seconds; the bed
  // is carried, not left at home, so any dusk anywhere can end that way.
  // Three wool from a sheep, three planks; a search that finds no sheep
  // is set aside for twenty minutes rather than wandering all day.
  if (!carried.some(n => /_bed$/.test(n)) && !(goal.bedSearch?.deferredUntil > Date.now())) {
    const wool = woolCarried(bot);
    if (wool.count >= 3) return { phase: 'bed', action: 'acquire', item: `${wool.colour}_bed`, count: 1 };
    // A remembered village with beds is a walk of known length; a sheep
    // is a search. The village bed comes first when one is within reach.
    const village = villageBedRung(bot, goal);
    if (village) return village;
    return { phase: 'bed', action: 'gather_wool', count: 3 - wool.count };
  }
  if (best('pickaxe') < 3) return another('iron_pickaxe');
  if (!carried.includes('shield')) return { phase: 'shield', action: 'acquire', item: 'shield', count: 1 };
  if (best('sword') < 3) return another('iron_sword');
  if (!carried.includes('bucket') && !carried.includes('water_bucket')) return { phase: 'bucket', action: 'acquire', item: 'bucket', count: 1 };
  // Home before the long descents: a bed so a death costs a walk from the
  // base rather than from world spawn, a plot and a pen so food is a known
  // distance away. The walkthrough order every speedrunner keeps: iron
  // tools, then a base and a bed, then the mine.
  const home = homeStage(bot, goal);
  if (home) return { ...home, action: 'home', home };
  // Armour is four rungs, not one label. The Nether trip needs all of it,
  // and each piece is a visible step rather than "reach the Nether" for an
  // hour while twenty-four ingots accumulate.
  // One rung for the whole set, planned together: twenty-four ingots in one
  // smelt with one fuel allowance, instead of four mine-smelt-craft trips.
  const worn = carried;
  // Golden boots count for the feet: one piece of gold keeps piglins
  // neutral, which is the whole encounter class that shot the run dead.
  const missing = ['helmet', 'chestplate', 'leggings', 'boots']
    .filter(piece => !worn.some(name => (/^(iron|diamond|netherite)_/.test(name) || (piece === 'boots' && name === 'golden_boots')) && name.endsWith(`_${piece}`)))
    .map(piece => `iron_${piece}`);
  if (missing.length) return { phase: missing.length === 4 ? 'iron_armour' : `iron_${missing[0].replace('iron_', '')}`, action: 'acquire_set', item: missing[0], items: missing, count: missing.length };
  if (!carried.includes('golden_boots')) return { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  // Most of the run's deaths were arrows: skeletons in the caves, crossbow
  // piglins in the Nether, and a bot that could only answer at arm's length.
  // A bow and a quiver before the portal, so a shooter at ten blocks is a
  // target rather than a reason to run. A bow about to break is no bow.
  // The bow is a night rung. Its string comes off spiders, which the surface
  // has after dusk and the day does not: a daylight search for one walked
  // seven hundred blocks across the map and into the sea. By day, with no
  // spider in view and no string in hand, the ladder goes on to the sword.
  const t = bot.time?.timeOfDay, dark = t >= 12000 && t < 23000;
  const spiderNear = Object.values(bot.entities || {}).some(e => e.name === 'spider' && e.position?.distanceTo?.(bot.entity.position) < 32 &&
    !(goal.mobHunt?.avoided?.[e.uuid || e.id] > Date.now() - 120000));
  const string = bot.inventory.items().filter(i => i.name === 'string').reduce((n, i) => n + (i.count || 1), 0);
  const arrows = bot.inventory.items().filter(i => i.name === 'arrow').reduce((n, i) => n + (i.count || 1), 0);
  if (dark || spiderNear || string >= 3 || sound.includes('bow')) {
    if (!sound.includes('bow')) return { phase: 'bow', action: 'acquire', item: 'bow', count: carried.filter(n => n === 'bow').length + 1 };
    if (arrows < 16) return { phase: 'arrows', action: 'acquire', item: 'arrow', count: 16 };
  }
  // Daylight is for the deep: two diamonds make the sword that ends a blaze
  // or a piglin in two swings, and the caves on the way are where spiders
  // live by day. The night rungs come round again at dusk.
  // With the sword in hand and the sun up, the ladder is done for now: the
  // walk to the portal takes the day, and dusk brings the bow rung back.
  if (best('sword') < 4) return another('diamond_sword');
  return null;
}

function nextGameStage(bot, goal) {
  if (verifyGameCompletion(bot, goal)) return { phase: 'complete' };
  const where = dimension(bot), m = goal.gameProgress?.milestones || {};
  // Early game only: once any Nether or End supply is in hand, the run has
  // moved past preparation and the later stages own what to fetch next.
  // The first Nether entry is not that line: a death empties the pockets,
  // and a climb that skips the ladder because the milestone is set walks
  // back to the portal with a stone pickaxe, no bucket and no gold, which
  // is how three Nether trips went in with less than the first one.
  const supplies = ['ender_eye', 'blaze_rod', 'blaze_powder', 'ender_pearl'].reduce((n, name) => n + count(bot, name), 0);
  if (where === 'overworld' && !supplies) { const prep = preparationStage(bot, goal); if (prep) return prep; }
  if (where === 'end') return m.dragon_defeated ? { phase: 'return_alive', action: 'exit_end' } : { phase: 'defeat_dragon', action: 'fight_dragon' };
  // Survey throws deliberately spend eyes. Do not send Jev back to the Nether
  // after each throw while it still has a spare and twelve portal eyes. A
  // pending pickup gets a chance before deciding whether supplies are short.
  const portalNeed = m.stronghold_located && goal.endPortal?.neededEyes;
  if (where === 'overworld' && m.stronghold_located && (!Number.isInteger(portalNeed) || count(bot, 'ender_eye') >= portalNeed)) return { phase: 'enter_end', action: 'enter_end' };
  if (where === 'overworld' && !m.stronghold_located && goal.strongholdSearch && (count(bot, 'ender_eye') >= 13 || goal.strongholdSearch.pendingPickup)) {
    return { phase: 'find_stronghold', action: 'find_stronghold' };
  }
  // Carry a reserve for eye throws; execution always replans from inventory,
  // so loss, crafting batches and partial pickups do not advance a fake counter.
  const target = Number.isInteger(portalNeed) ? portalNeed : 16, eyes = count(bot, 'ender_eye');
  const rods = Math.ceil(Math.max(0, target - eyes - count(bot, 'blaze_powder')) / 2);
  if (count(bot, 'blaze_rod') < rods) {
    return where === 'nether' ? { phase: 'obtain_blaze_rods', action: 'acquire', item: 'blaze_rod', count: rods } :
      { phase: 'reach_nether', action: 'enter_nether' };
  }
  if (where === 'nether') return { phase: 'return_with_blaze_supplies', action: 'return_overworld' };
  if (where !== 'overworld') return { phase: 'unknown_dimension', action: 'unsupported_dimension' };
  // TODO: a cleric villager sells ender pearls for emeralds; with a village
  // remembered (goal.villages), trading would make this rung a walk rather
  // than an enderman hunt. Trading is not implemented.
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
  else if (stage.action === 'gather_wool') {
    if (!actions.gather_wool) throw Object.assign(new Error('Game progression is blocked at the bed: the gather wool action is not implemented here. Earlier progress is saved.'), { name: 'Blocked' });
    await actions.gather_wool(bot, task, goal, save, stage);
  }
  else if (stage.action === 'home') {
    if (!actions.home) throw Object.assign(new Error('Game progression is blocked at the home base: the home action is not implemented here. Earlier progress is saved.'), { name: 'Blocked' });
    await actions.home(bot, task, goal, save, stage.home);
  }
  else if (stage.action === 'village_bed') {
    if (!actions.village_bed) throw Object.assign(new Error('Game progression is blocked at the bed: the village bed action is not implemented here. Earlier progress is saved.'), { name: 'Blocked' });
    await actions.village_bed(bot, task, goal, save, stage);
  }
  else if (stage.action === 'acquire_set') await (actions.acquireSetStep || (async (b, t, items, g, sv) => { for (const item of items) if (!await actions.acquireStep(b, t, item, 1, g, sv)) return false; return true; }))(bot, task, stage.items, goal, save);
  else {
    // Gather combat supplies in the Overworld before a first Nether trip;
    // iron ore is not available to repair this dependency once inside.
    // Valuables stay home before the crossing: nothing in the chest burns
    // with the body, and the Nether needs none of it.
    if (stage.action === 'enter_nether' && actions.stash_valuables && !await actions.stash_valuables(bot, task, goal, save)) return false;
    if (stage.action === 'enter_nether' && actions.prepare_combat && !await actions.prepare_combat(bot, task, goal, save)) return false;
    if (stage.action === 'enter_end' && actions.prepare_end && !await actions.prepare_end(bot, task, goal, save)) return false;
    const execute = actions[stage.action];
    if (!execute) throw Object.assign(new Error(`Game progression is blocked at ${stage.phase.replaceAll('_', ' ')}: the ${stage.action.replaceAll('_', ' ')} action is not implemented yet. Earlier progress is saved.`), { name: 'Blocked' });
    await execute(bot, task, goal, save);
  }
  return false;
}

module.exports = { dimension, observeProgress, watchGameProgress, verifyGameCompletion, nextGameStage, preparationStage, gameStep };
