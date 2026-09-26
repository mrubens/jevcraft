'use strict';
const { DAY } = require('./day');
const { barterReady, goldOnHand, bastionKnown } = require('./bartering');
const { isSetAside, setAside, attemptsFor } = require('./progress');
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
// Rungs that may wait their turn. Twenty minutes of work on one without
// finishing puts the choice of what next to Jev again (timeRung): "a rung
// every couple of minutes", not a day on a shield. A wait only reorders
// the ladder. A set-aside rung comes back as soon as nothing
// else is left, so nothing on this list is ever skipped on the way to the
// Nether. Pickaxes and armour are not on it: nothing after them works
// without them.
// The bed too: nothing after it needs it to start, and on a savanna with no
// sheep trial 25 walked five hundred blocks for wool with the iron pickaxe
// never on offer (2026-09-24).
// And the home's pond, plot and pen: the armour does not need them, and a
// plot that would not till held trial 28's ladder short of the armour.
// The rest of the home too (its site, levelling, chest and bed): trial 39
// placed its bed and could not walk back to claim it, and the bed's step
// held the armour off the ladder with ninety-three raw iron in the pack.
const DEFERRABLE = new Set(['bed', 'home_site', 'home_level', 'home_stash', 'home_bed', 'home_water', 'home_plot', 'home_pen', 'shield', 'iron_sword', 'bucket', 'golden_boots', 'bow', 'arrows', 'diamond_sword']);
const RUNG_BUDGET_MS = 20 * 60 * 1000, RUNG_WAIT_MS = 30 * 60 * 1000;
function preparationRung(bot, goal = {}, now = Date.now()) {
  const waiting = new Set(Object.keys(attemptsFor(goal).of('rung', now)));
  if (waiting.size) {
    const open = ladderRung(bot, goal, waiting);
    if (open) return open;
  }
  return ladderRung(bot, goal, new Set());
}
// The rungs open now, in ladder order: the first, and then each rung the
// ladder would go on to if the ones before it waited their turn, for as long
// as those before it may wait (DEFERRABLE). A rung that may not wait, or one
// already set aside, closes the list. What Jev chooses among (strategy.js).
function openRungs(bot, goal = {}, now = Date.now()) {
  const skipped = new Set(Object.keys(attemptsFor(goal).of('rung', now)));
  const out = [];
  for (let i = 0; i < 12; i++) {
    const rung = ladderRung(bot, goal, skipped);
    if (!rung || out.some(r => r.phase === rung.phase)) break;
    out.push(rung);
    if (!DEFERRABLE.has(rung.phase)) break;
    skipped.add(rung.phase);
  }
  return out;
}
function ladderRung(bot, goal, waiting) {
  const ready = rung => rung && !waiting.has(rung.phase) ? rung : null;
  // Equipped gear lives outside inventory.items(): armour in slots 5 to 8,
  // the shield in the off-hand at 45. A shield on the arm is not a missing shield.
  const equipped = [5, 6, 7, 8, 45].map(slot => bot.inventory.slots?.[slot]).filter(Boolean);
  const carried = [...bot.inventory.items(), ...equipped].map(i => i.name);
  // A tool about to break does not count as a tool: the rung fires again
  // while the old one still works, so the spare is made above ground and
  // not after the shaft goes dark. Twenty percent of durability is enough
  // to finish a trip and get back to a crafting table.
  // Or sixty-four uses, whichever is less: a fifth of a diamond pickaxe is
  // three hundred uses, and at two hundred and two the dream run counted
  // both of its diamond pickaxes spent and made stone ones for an hour.
  const usable = item => { const max = bot.registry?.itemsByName?.[item.name]?.maxDurability; return !max || max - (item.durabilityUsed || 0) >= Math.min(max * 0.2, 64); };
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
  // Once the base's bed is claimed the rung is met: the carried one became
  // that bed, and a second sheep hunt before the plot and the pen is a
  // delay for a bed that far trips seldom get to use.
  // The bed, the home and the armour can each be left for later (a rung
  // that failed twice without progress, work.js persist): nothing after them
  // needs them to start. The tools before them cannot.
  if (!carried.some(n => /_bed$/.test(n)) && !goal.survival?.home?.bed?.claimedAt && !isSetAside(goal, 'bed_search', 'wool') && ready({ phase: 'bed' })) return bedRung(bot, goal);
  if (best('pickaxe') < 3) return another('iron_pickaxe');
  if (!carried.includes('shield') && ready({ phase: 'shield' })) return { phase: 'shield', action: 'acquire', item: 'shield', count: 1 };
  if (best('sword') < 3 && ready({ phase: 'iron_sword' })) return another('iron_sword');
  if (!carried.includes('bucket') && !carried.includes('water_bucket') && ready({ phase: 'bucket' })) return { phase: 'bucket', action: 'acquire', item: 'bucket', count: 1 };
  // Home before the long descents: a bed so a death costs a walk from the
  // base rather than from world spawn, a plot and a pen so food is a known
  // distance away. The walkthrough order every speedrunner keeps: iron
  // tools, then a base and a bed, then the mine.
  const home = homeStage(bot, goal);
  if (home && ready({ phase: home.phase })) return { ...home, action: 'home', home };
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
  const armourPhase = missing.length === 4 ? 'iron_armour' : `iron_${missing[0]?.replace('iron_', '')}`;
  if (missing.length && ready({ phase: armourPhase })) return { phase: missing.length === 4 ? 'iron_armour' : `iron_${missing[0].replace('iron_', '')}`, action: 'acquire_set', item: missing[0], items: missing, count: missing.length };
  if (!carried.includes('golden_boots') && ready({ phase: 'golden_boots' })) return { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  // Most of the run's deaths were arrows: skeletons in the caves, crossbow
  // piglins in the Nether, and a bot that could only answer at arm's length.
  // A bow and a quiver before the portal, so a shooter at ten blocks is a
  // target rather than a reason to run. A bow about to break is no bow.
  // The bow is a night rung. Its string comes off spiders, which the surface
  // has after dusk and the day does not: a daylight search for one walked
  // seven hundred blocks across the map and into the sea. By day, with no
  // spider in view and no string in hand, the ladder goes on to the sword.
  const t = bot.time?.timeOfDay, dark = t >= DAY.DARK && t < DAY.DAWN;
  const spiderNear = Object.values(bot.entities || {}).some(e => e.name === 'spider' && e.position?.distanceTo?.(bot.entity.position) < 32 &&
    !isSetAside(goal, 'hunt_target', e.uuid || e.id));
  const string = bot.inventory.items().filter(i => i.name === 'string').reduce((n, i) => n + (i.count || 1), 0);
  const arrows = bot.inventory.items().filter(i => i.name === 'arrow').reduce((n, i) => n + (i.count || 1), 0);
  if (dark || spiderNear || string >= 3 || sound.includes('bow')) {
    if (!sound.includes('bow') && ready({ phase: 'bow' })) return { phase: 'bow', action: 'acquire', item: 'bow', count: carried.filter(n => n === 'bow').length + 1 };
    if (sound.includes('bow') && arrows < 16 && ready({ phase: 'arrows' })) return { phase: 'arrows', action: 'acquire', item: 'arrow', count: 16 };
  }
  // Daylight is for the deep: two diamonds make the sword that ends a blaze
  // or a piglin in two swings, and the caves on the way are where spiders
  // live by day. The night rungs come round again at dusk.
  // With the sword in hand and the sun up, the ladder is done for now: the
  // walk to the portal takes the day, and dusk brings the bow rung back.
  if (best('sword') < 4 && ready({ phase: 'diamond_sword' })) return another('diamond_sword');
  return null;
}

// How a bed is had, the first one or one to carry: three wool of a colour
// carried is a craft; a remembered village with beds is a walk of known
// length, and a sheep is a search, so the village bed comes first when one
// is within reach; else the wool (sheep, shears, string, cobwebs:
// home-base.js gatherWool).
function bedRung(bot, goal, phase = 'bed') {
  const wool = woolCarried(bot);
  if (wool.count >= 3) return { phase, action: 'acquire', item: `${wool.colour}_bed`, count: 1 };
  const village = villageBedRung(bot, goal);
  if (village) return { ...village, phase };
  return { phase, action: 'gather_wool', count: 3 - wool.count };
}

// A second bed, to carry, once the base's bed is claimed and none is in
// the pockets: the bed rung is met by the base's, and the six midgame
// trials of 2026-09-26 carried none after the home was built but one. A
// night underground was then a pocket or a night mine, about seven real
// minutes, and the climb back up was 110 of their 408 minutes. Not a rung:
// strategy.js offers it beside the ladder, with what it buys and costs,
// and it is Jev's to take. A wool search set aside is not offered.
// The chest at home answers first, as it does the bed rung.
function carryBedRung(bot, goal = {}) {
  if (bot.game?.gameMode !== 'survival' || dimension(bot) !== 'overworld') return null;
  if (!goal.survival?.home?.bed?.claimedAt || bedCarried(bot) || isSetAside(goal, 'bed_search', 'wool')) return null;
  const rung = bedRung(bot, goal, 'carry_bed');
  const home = homeOf(bot, goal);
  if (home?.stash?.position) {
    const wants = rungWants(bot, rung, { home, goal });
    const restock = restockStage(bot, goal, wants);
    if (restock) return { ...restock, phase: 'carry_bed', action: 'home', home: { ...restock, wants } };
  }
  return rung;
}

// The rungs that are the fighting kit: tools, shield, armour, and the
// golden boots the Nether's piglins look for. The rest of the ladder (bed,
// bucket, bow, the better sword) waits while supplies are in hand.
const GEAR = /^(stone_pickaxe|stone_sword|iron_pickaxe|shield|iron_armour|iron_(helmet|chestplate|leggings|boots)|golden_boots)$/;
const NOT_GEAR = new Set(['iron_sword', 'bucket', 'bow', 'arrows', 'diamond_sword']);
function gearStage(bot, goal) {
  const rung = ladderRung(bot, goal, NOT_GEAR);
  if (!rung || !GEAR.test(rung.phase)) return null;
  const home = homeOf(bot, goal);
  if (home?.stash?.position) {
    const wants = rungWants(bot, rung, { home, goal });
    const restock = restockStage(bot, goal, wants);
    if (restock) return { ...restock, action: 'home', home: { ...restock, wants } };
  }
  return rung;
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
  // The kit a fight needs is rebuilt whatever supplies are carried: blaze
  // rods from the stash, taken before the armour lost in a lava death was
  // made again, skipped the ladder, and the bot went through the Nether and
  // back in no armour and died to one creeper on the far shore.
  if (where === 'overworld' && supplies) { const gear = gearStage(bot, goal); if (gear) return gear; }
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
  // Eyes, rods, powder and pearls in the stash chest are the chest's first:
  // the run set off for the fortress with six blaze rods left at home.
  if (where === 'overworld') {
    const wants = [];
    if (eyes < target) wants.push({ item: 'ender_eye', count: target - eyes });
    if (count(bot, 'blaze_rod') < rods) wants.push({ item: 'blaze_rod', count: rods - count(bot, 'blaze_rod') }, { item: 'blaze_powder', count: 2 * (rods - count(bot, 'blaze_rod')) });
    if (count(bot, 'ender_pearl') < target - eyes) wants.push({ item: 'ender_pearl', count: target - eyes - count(bot, 'ender_pearl') });
    const restock = wants.length && restockStage(bot, goal, wants);
    if (restock) { const supply = restock.items.filter(m => m.want); if (supply.length) return { ...restock, phase: 'restock_supplies', action: 'home', home: { ...restock, items: supply, wants } }; }
  }
  if (count(bot, 'blaze_rod') < rods) {
    return where === 'nether' ? { phase: 'obtain_blaze_rods', action: 'acquire', item: 'blaze_rod', count: rods } :
      { phase: 'reach_nether', action: 'enter_nether' };
  }
  // Short of pearls with gold on hand and a piglin in view: barter before
  // going back. The enderman hunt in the Overworld is the other way.
  if (where === 'nether' && count(bot, 'ender_pearl') < target - eyes && barterReady(bot, goal)) return { phase: 'obtain_ender_pearls', action: 'barter', item: 'ender_pearl', count: target - eyes };
  // No gold to throw, and a bastion remembered: its gold blocks first.
  if (where === 'nether' && count(bot, 'ender_pearl') < target - eyes && !goldOnHand(bot) && bastionKnown(bot, goal) && !isSetAside(goal, 'rung', 'bastion_gold'))
    return { phase: 'obtain_ender_pearls', action: 'bastion_gold', item: 'gold_ingot' };
  // Pearls from the warped forest while here: one known, or a sweep for one
  // (warped-pearls.js), before the walk back.
  const warped = require('./warped-pearls');
  if (where === 'nether' && count(bot, 'ender_pearl') < target - eyes && warped.warpedOpen(goal))
    return { phase: 'obtain_ender_pearls', action: 'warped_pearls', item: 'ender_pearl', count: target - eyes };
  if (where === 'nether') return { phase: 'return_with_blaze_supplies', action: 'return_overworld' };
  if (where !== 'overworld') return { phase: 'unknown_dimension', action: 'unsupported_dimension' };
  // A cleric's pearls, when a village is remembered and a pearl trade has
  // been read there (trading.js): a walk and some emeralds instead of an
  // enderman hunt. Set aside like any rung when it stops paying.
  const pearlOffer = Object.values(goal.trading?.offers || {}).some(o => (o.trades || []).some(t => t.outputItem?.name === 'ender_pearl' && !t.tradeDisabled));
  if (count(bot, 'ender_pearl') < target - eyes && pearlOffer && !isSetAside(goal, 'rung', 'trade_pearls') && require('./villages').knownVillages(bot, goal, 512).length)
    return { phase: 'obtain_ender_pearls', action: 'trade', item: 'ender_pearl', count: target - eyes };
  // A warped forest (remembered, or looked for) beats a night walk here:
  // the Overworld hunt is the fallback once the Nether search has rested.
  if (count(bot, 'ender_pearl') < target - eyes && warped.warpedOpen(goal))
    return { phase: 'obtain_ender_pearls', action: 'enter_nether', item: 'ender_pearl', count: target - eyes, via: 'warped_forest' };
  // Endermen when they show, and something worth doing while they do not:
  // walking rings about looking for one was the dullest hour of the run
  // (the user, 2026-09-23). The patrol hunts one in view and otherwise
  // goes on an expedition or explores new ground (work.js pearl_patrol).
  if (count(bot, 'ender_pearl') < target - eyes) return { phase: 'obtain_ender_pearls', action: 'pearl_patrol', item: 'ender_pearl', count: target - eyes };
  if (eyes < target) return { phase: 'craft_eyes', action: 'acquire', item: 'ender_eye', count: target };
  if (!m.stronghold_located) return { phase: 'find_stronghold', action: 'find_stronghold' };
  return { phase: 'enter_end', action: 'enter_end' };
}

// Working time on the current rung: gaps between steps (a night in a
// shelter, a stop) count at most half a minute, so only time spent on it
// runs the budget down.
// One clock per rung, kept while other steps come and go: a single clock
// reset on every change of phase, and a stash-restock step alternating
// with the rung restarted it each time, so twenty minutes never ran out.
function timeRung(bot, goal, phase, now = Date.now()) {
  const clocks = goal.rungClocks ||= {};
  // A clock untouched for half an hour belongs to a rung that was finished
  // and has come round again (a lost shield): it starts from nothing.
  if (clocks[phase] && now - clocks[phase].lastAt > 30 * 60000) delete clocks[phase];
  const rung = clocks[phase] ||= { activeMs: 0, lastAt: now };
  const previous = goal.rungTime?.phase === phase ? rung.lastAt : now;
  rung.activeMs += Math.min(30000, Math.max(0, now - previous)); rung.lastAt = now;
  goal.rungTime = { phase, ...rung };
  // Every twenty working minutes without finishing, the strategy is asked
  // again with the minutes said (minutesOnLadderNext): another open rung can
  // go first, and that is Jev's to weigh, not a set-aside by rule.
  if (!DEFERRABLE.has(phase) || rung.activeMs < RUNG_BUDGET_MS * ((rung.reasked || 0) + 1)) return false;
  rung.reasked = (rung.reasked || 0) + 1; delete goal.strategy;
  return true;
}

async function gameStep(bot, task, goal, save, actions) {
  task.check();
  if (bot.game.gameMode !== 'survival') throw Object.assign(new Error('The game-completion task requires Survival mode'), { name: 'Blocked' });
  const progress = observeProgress(bot, goal);
  await require('./mob-policy').wearBestArmour(bot);
  let stage = nextGameStage(bot, goal);
  // Back for what the last death dropped, before anything else: close to
  // the respawn its drops have five minutes (corpse-run.js).
  if (actions.corpse_run && stage.phase !== 'complete' && await actions.corpse_run(bot, task, goal, save)) return false;
  // Strategy: which of the open rungs, or a side trip, is Jev's to choose
  // (strategy.js). A side trip that ran is this step's work.
  if (actions.strategy && stage.phase !== 'complete') {
    const chosen = await actions.strategy(bot, task, goal, save, stage);
    if (chosen?.ran) return false;
    if (chosen?.stage) stage = chosen.stage;
  }
  // Back in the Overworld and not crossing: wolves left sitting stand up.
  if (actions.wolves && goal.wolfOrder?.sit && dimension(bot) === 'overworld' && !['enter_nether', 'reach_nether', 'enter_end'].includes(stage.action)) await actions.wolves(bot, task, goal, save, false);
  // Back in the Overworld with nothing left to cross for: a field cache in
  // reach is emptied before the ladder goes on.
  if (actions.take_cache && !['enter_nether', 'reach_nether'].includes(stage.action) && stage.phase !== 'complete') {
    if (await actions.take_cache(bot, task, goal, save)) return false;
  }
  progress.phase = stage.phase; goal.step = { action: 'game_progression', ...stage };
  timeRung(bot, goal, stage.phase);
  save();
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
    // Wolves sit here: they attack what the bot hits, and the far side is
    // zombified piglins and endermen.
    if (['enter_nether', 'enter_end'].includes(stage.action) && actions.wolves) await actions.wolves(bot, task, goal, save, true);
    // At home past the ladder, valuables go in whatever comes next, not
    // only before the Nether: the dream run walked a day with sixty lapis,
    // thirty-six raw iron and nineteen ingots, and after the kit restore was
    // stopped a death took all of it. The keepsakes' keeps hold back what
    // the stage spends (pearls, rods, eyes, the diamonds before the pickaxe).
    if (actions.stash_valuables && !await actions.stash_valuables(bot, task, goal, save)) return false;
    if (stage.action === 'enter_nether' && actions.food_reserve && !await actions.food_reserve(bot, task, goal, save)) return false;
    if (stage.action === 'enter_nether' && actions.prepare_combat && !await actions.prepare_combat(bot, task, goal, save)) return false;
    // Home too far to walk them back to: a chest on the spot, once the
    // preparations are done and the crossing is next (field-cache.js).
    if (stage.action === 'enter_nether' && actions.cache_valuables) await actions.cache_valuables(bot, task, goal, save);
    if (stage.action === 'enter_end' && actions.prepare_end && !await actions.prepare_end(bot, task, goal, save)) return false;
    const execute = actions[stage.action];
    if (!execute) throw Object.assign(new Error(`Game progression is blocked at ${stage.phase.replaceAll('_', ' ')}: the ${stage.action.replaceAll('_', ' ')} action is not implemented yet. Earlier progress is saved.`), { name: 'Blocked' });
    await execute(bot, task, goal, save);
  }
  return false;
}

// The steps still open on the ladder, each with what making it takes from
// the pockets as they are: said to Jev wherever it chooses how to spend
// time, so a choice to wait is made knowing what waiting leaves undone. A
// pocket sat out a night with a stone pickaxe and no iron, three of the
// steps ahead waiting on iron, told only that the bed was next.
function rungsAhead(bot, goal = {}, planFor = null) {
  if (goal.kind !== 'win') return [];
  let rungs;
  try { rungs = openRungs(bot, goal); } catch (_) { return []; }
  const words = s => String(s || '').replaceAll('_', ' ');
  return rungs.slice(0, 4).map(rung => {
    let takes = null;
    if (planFor && rung.item) {
      try {
        const plan = planFor(bot, rung.item, rung.count || 1, goal);
        if (plan?.length) takes = plan.map(st => `${st.action.replaceAll('_', ' ')} ${st.count || 1} ${words(st.item || st.block || st.mob)}`).join(', then ');
      } catch (_) { /* no plan from here */ }
    }
    const why = require('./strategy').RUNG_WHY[rung.phase];
    return { step: words(rung.phase), ...(why ? { for: why } : {}), ...(rung.item ? { item: `${rung.count > 1 ? `${rung.count} ` : ''}${words(rung.item)}` } : {}), ...(takes ? { takes } : {}) };
  });
}

module.exports = { bedRung, carryBedRung, rungsAhead, timeRung, preparationRung, openRungs, DEFERRABLE, RUNG_BUDGET_MS, RUNG_WAIT_MS, dimension, observeProgress, watchGameProgress, verifyGameCompletion, nextGameStage, preparationStage, gameStep };
