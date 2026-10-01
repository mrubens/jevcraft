'use strict';
const { goals } = require('mineflayer-pathfinder');
const { safeFood, checkAir } = require('./vitals');
const { threats, checkThreats } = require('./danger');
const { surfaceMovement } = require('./surface');
const { knowledge } = require('./knowledge');
const { surveyRoute } = require('./skills');
const { homeFood, eatFromHome } = require('./home-base');
const { villageFood, eatFromVillage } = require('./villages');
const { makeRoom } = require('./inventory-tidy');
const { strike, shooter } = require('./combat');
const vanilla = require('../data/vanilla-26.1.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Raw chicken is an ingredient, never edible reserve. Its cooking dependency
// comes from the same server recipe catalog used for requested items.
// These land animals share the surface chase handler. Other food-bearing mobs
// (fish, hostile mobs) need their own mechanics before becoming candidates.
// No chickens and no pigs: never hurt (protected-animals.js).
const landPrey = new Set(['cow', 'mooshroom', 'sheep', 'rabbit']);
function preyFood(bot, entity) {
  if (!landPrey.has(entity.name)) return undefined;
  const keys = bot.registry.entitiesByName[entity.name]?.metadataKeys || [];
  if (entity.metadata?.[keys.indexOf('baby')] === true ||
    (entity.name === 'rabbit' && entity.metadata?.[keys.indexOf('type')] === 99)) return undefined;
  return vanilla.entityLoot[entity.name]?.pools?.flatMap(pool => pool.entries || [])
    .filter(entry => entry.type === 'minecraft:item').map(entry => entry.name.replace('minecraft:', ''))
    .find(name => bot.registry.foodsByName[name]);
}
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
function foodSupply(bot) {
  return bot.inventory.items().filter(i => safeFood(bot, i))
    .reduce((sum, i) => sum + i.count * bot.registry.foodsByName[i.name].foodPoints, 0);
}
// The last-resort food beside it, counted apart: the reserve the stock and
// the crossing are measured by stays safe food, and rotten flesh is not
// stocked for a trip; but it is food, and a bot carrying five was told "0
// food points carried" at four health (note 515). Its points, and what it
// may cost, said together.
function lastResortSupply(bot) {
  const { lastResortFoods, sideEffectSays } = require('./vitals');
  const items = bot.inventory.items().filter(i => lastResortFoods.has(i.name) && bot.registry.foodsByName?.[i.name]);
  const counts = {};
  for (const i of items) counts[i.name] = (counts[i.name] || 0) + i.count;
  const points = Object.entries(counts).reduce((sum, [name, n]) => sum + n * bot.registry.foodsByName[name].foodPoints, 0);
  const says = Object.entries(counts).map(([name, n]) => `${n} ${name === 'chicken' ? 'raw chicken' : name.replaceAll('_', ' ')}, ${bot.registry.foodsByName[name].foodPoints} hunger each; ${sideEffectSays(name)}`).join('; ');
  return { points, says };
}

async function candidates(bot, task, state) {
  const surface = surfaceMovement(bot);
  try {
    const danger = threats(bot);
    const observed = Object.values(bot.entities).filter(e => preyFood(bot, e) && e.isValid !== false &&
      surface.isSurface(e.position) &&
      e.position.distanceTo(bot.entity.position) < 32 && !(state.failedPrey?.[e.uuid || e.id] > Date.now() - 120000))
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
    const reachable = [];
    // A partial path is an unfinished search, not an unreachable animal.
    // Bound the whole survey by checking at most eight nearby candidates.
    for (const target of observed.slice(0, 8)) {
      const route = await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalFollow(target, 2), 500);
      if (route.status === 'success' && bot.entities[target.id] === target && target.isValid !== false && preyFood(bot, target) &&
        surface.isSurface(target.position) && (route.path || []).every(p => surface.allowed(p))) reachable.push(target);
      if (reachable.length === 3) break;
    }
    return reachable;
  } finally { surface.restore(); }
}

async function hunt(bot, task, target, actions, goal, save) {
  const surface = surfaceMovement(bot);
  try {
    const item = preyFood(bot, target);
    if (!item) throw new Error(`Food target ${target.name} is not an eligible passive adult`);
    // No slot for the meat is no reason to kill: make room first, and if
    // there is none to make, say so rather than leave another carcass.
    if (!await makeRoom(bot, task, item, { goal, away: target.position })) throw new Error(`No room in my pockets for ${item.replaceAll('_', ' ')}`);
    const before = count(bot, item), foodBefore = foodSupply(bot);
    const deadline = Date.now() + 45000;
    const weapon = bot.inventory.items().filter(i => /_(sword|axe)$/.test(i.name))
      .sort((a, b) => ['wooden', 'stone', 'iron', 'diamond', 'netherite'].findIndex(t => b.name.startsWith(t)) -
        ['wooden', 'stone', 'iron', 'diamond', 'netherite'].findIndex(t => a.name.startsWith(t)))[0];
    if (weapon) await bot.equip(weapon, 'hand');
    else if (bot.heldItem) await bot.unequip('hand');
    const valid = () => bot.entities[target.id] === target && target.isValid !== false;
    let attacks = 0, missed = 0, nearest = Infinity;
    while (valid() && Date.now() < deadline) {
      task.check(); checkAir(bot); checkThreats(bot);
      if (preyFood(bot, target) !== item) throw new Error(`Food target ${target.name} is no longer an eligible passive adult`);
      if (!surface.isSurface(target.position)) throw new Error(`Food target ${target.name} moved away from safe surface terrain`);
      if (bot.entity.position.distanceTo(target.position) > 2.8) {
        // Done at the swing's own distance, not at the follow's two blocks.
        try { await actions.navigate(bot, task, new goals.GoalFollow(target, 2), { timeoutMs: 5000, stallMs: 2500, stopWhen: () => !valid() || bot.entity.position.distanceTo(target.position) <= 2.8 }); }
        catch (err) {
          task.check(); checkAir(bot); checkThreats(bot); if (err.name === 'NeedsAir') throw err;
          // Two walks that failed and got no nearer: this one cannot be got
          // to from here. The first trial on a fresh world stood at the foot
          // of its own stone pit for the whole forty-five seconds, walking
          // at a sheep every five (2026-09-24).
          const gap = bot.entity.position.distanceTo(target.position);
          if (gap < nearest - 1) { nearest = gap; missed = 0; } else if (++missed >= 2) throw new Error(`Cannot get to the ${target.name} from here: ${err.message}`);
        }
        continue;
      }
      if (!valid()) break;
      const eye = bot.entity.position.offset(0, 1.62, 0);
      const aim = target.position.offset(0, Math.min((target.height || 1) / 2, 1), 0);
      const direction = aim.minus(eye);
      const hit = bot.world.raycast(eye, direction.unit(), direction.norm());
      if (hit && eye.distanceTo(hit.intersect || hit.position) < direction.norm() - 0.25) throw new Error(`Food target ${target.name} is behind solid cover`);
      await bot.lookAt(aim, true);
      if (await strike(bot, task, target) !== 'missed') attacks++;
      for (let i = 0; i < 8; i++) { task.check(); checkThreats(bot); await sleep(100); }
    }
    bot.pathfinder.setGoal(null); bot.clearControlStates();
    if (valid()) throw new Error(`Could not finish gathering food from ${target.name} within 45 seconds`);
    await sleep(500);
    const drops = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === item && e.position.distanceTo(target.position) < 8);
    for (const drop of drops) {
      if (count(bot, item) > before) break;
      const p = drop.position.floored();
      await actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 1), { timeoutMs: 10000, stopWhen: () => count(bot, item) > before });
      await sleep(500);
    }
    if (count(bot, item) <= before) throw new Error(`No food ingredient pickup confirmed after hunting ${target.name}`);
    if (goal.search?.['food animals']) goal.search['food animals'].attempts = 0;
    goal.survivalAction = { action: 'food_collected', source: target.name, item, count: count(bot, item) - before,
      needsCooking: !safeFood(bot, { name: item }), attacks, foodPointsGained: foodSupply(bot) - foodBefore, at: new Date().toISOString() };
    save();
  } finally { surface.restore(); }
}

// `target`: the reserve the food is for, in points (the kit's 12 unless said).
// Cooked toward it, a raw item that is food already adds only the difference:
// 25595 carried 15 beef and 14 mutton 1 point short of the Nether's 80 and was
// offered one steak (note 702).
async function forageChoices(bot, task, goal, save, actions, state, { target = 12 } = {}) {
  const choices = {};
  for (const [output, inputs] of Object.entries(knowledge(bot.registry).smelting)) {
    if (!safeFood(bot, { name: output })) continue;
    const input = inputs.find(name => count(bot, name) > 0);
    if (!input) continue;
    const cooked = bot.registry.foodsByName[output].foodPoints;
    const gain = cooked - (safeFood(bot, { name: input }) ? bot.registry.foodsByName[input]?.foodPoints || 0 : 0);
    const amount = Math.min(count(bot, input), target > 12 ? 8 : 4, Math.max(1, Math.ceil((target - foodSupply(bot)) / Math.max(1, gain))));
    const targetCount = count(bot, output) + amount;
    choices[`cook_${output}`] = { description: { action: 'Cook carried ingredients into safe food using the recipe dependencies; gather a furnace, tool and fuel if needed.',
      input, carried: count(bot, input), output, amount, safeToEatRaw: safeFood(bot, { name: input }), pointsAdded: amount * gain, cookSeconds: amount * 10,
      // With no free slot the cooked food has nowhere to go: the drop
      // question comes first (note 754c).
      ...((bot.inventory.emptySlotCount?.() ?? 1) <= 0 ? { pocketsFull: 'no free slot: what to drop for the cooked food is asked first' } : {}) },
    valid: () => count(bot, input) >= amount,
    run: async () => {
      goal.survivalAction = { action: 'cook_food', input, output, amount, at: new Date().toISOString() }; save();
      const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
      try { await actions.acquireStep(bot, task, output, targetCount, goal, save); }
      finally { task.interruptCheck = outerCheck; }
    } };
  }
  const prey = await candidates(bot, task, state);
  const weapon = bot.inventory.items().find(i => /_(sword|axe)$/.test(i.name));
  const logs = bot.registry.blocksArray.filter(b => /_log$|^(crimson|warped)_stem$/.test(b.name)).map(b => b.id);
  if (prey.length && !weapon && actions.acquireStep && bot.findBlocks?.({ matching: logs, maxDistance: 32, count: 1 }).length) {
    choices.prepare_hunting_sword = {
      description: { action: 'Craft a wooden sword from nearby observed wood before hunting. Fewer hits reduce repeated chasing, especially for rabbits.',
        animals: prey.map(e => e.name), weapon: 'wooden_sword', currentWeapon: 'bare hands' },
      run: async () => {
        goal.survivalAction = { action: 'prepare_hunting_weapon', item: 'wooden_sword', at: new Date().toISOString() }; save();
        const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
        try { await actions.acquireStep(bot, task, 'wooden_sword', 1, goal, save); }
        finally { task.interruptCheck = outerCheck; }
      },
    };
  }
  for (const target of prey) {
    const observed = target.position.clone();
    const item = preyFood(bot, target), raw = item.replaceAll('_', ' ');
    // Said of this animal's own food. Every hunt used to say "chicken must be
    // cooked before eating", and a rabbit came with needsCooking false.
    const needsCooking = !safeFood(bot, { name: item });
    choices[`hunt_${target.id}`] = { description: { action: `Hunt this ${target.name.replaceAll('_', ' ')} and pick up its ${raw}. ${needsCooking
      ? `Raw ${raw} can poison; it must be cooked before eating.` : `Raw ${raw} is safe to eat, and worth much more cooked.`}`,
      animal: target.name, position: { ...target.position.floored() }, distance: Math.round(target.position.distanceTo(bot.entity.position)),
      availableWeapon: bot.inventory.items().find(i => /_(sword|axe)$/.test(i.name))?.name || 'bare hands', food: item, needsCooking,
      // How many of this kind are known about: in view, and remembered out of
      // view within 128 (sightings.js). Two cows are a pen's breeding pair.
      sameKindKnown: (() => { const k = require('./sightings').known(bot, goal, target.name); return { ...k, note: k.total <= 2 ? `killing it leaves ${k.total - 1} ${target.name.replaceAll('_', ' ')} known nearby; a pen needs two to breed` : undefined }; })(),
      // Said, not filtered: an animal near a hostile was dropped from the list.
      // Every hostile near the animal, not only near the bot (the decision
      // audit, 2026-09-25): threats(bot) looked twenty-four blocks from the
      // bot, and a creeper beyond the animal was never said.
      ...(() => {
        const near = threats(bot, 56).map(t => ({ t, distance: t.entity.position.distanceTo(target.position) })).filter(h => h.distance <= 32).sort((a, b) => a.distance - b.distance);
        if (!near.length) return { nearestHostileToIt: null };
        return { nearestHostileToIt: { name: near[0].t.entity.name, distance: Math.round(near[0].distance) },
          hostilesWithin32OfIt: { count: near.length, kinds: [...new Set(near.map(h => h.t.entity.name))], creepers: near.filter(h => h.t.entity.name === 'creeper').length,
            shooters: near.filter(h => shooter(h.t.entity)).length, outOfSight: near.filter(h => !h.t.visible).length } };
      })() },
    valid: () => bot.entities[target.id] === target && target.isValid !== false && preyFood(bot, target) === item && target.position.distanceTo(observed) < 2,
    run: async () => {
      goal.survivalAction = { action: 'gather_food', animal: target.name, position: { ...target.position }, at: new Date().toISOString() }; save();
      // A new animal chased this errand, said in its yield (note 719: 25588
      // was asked survival_priority 76 times over 8 minutes chasing cows,
      // a different one picked most re-askings, and nothing in the errand's
      // words said so; note 702's 3-minute no-yield rest never caught it
      // because a small gain kept coming, on average every 1 to 2 minutes,
      // just never absent for a full 3).
      const id = target.uuid || target.id;
      if (state.foodErrand && state.foodErrand.lastTargetId !== id) {
        state.foodErrand.targetsChased = (state.foodErrand.targetsChased || 0) + 1;
        state.foodErrand.lastTargetId = id;
      }
      const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
      try { await hunt(bot, task, target, actions, goal, save); }
      catch (err) {
        if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) {
          state.failedPrey ||= {}; state.failedPrey[target.uuid || target.id] = Date.now(); save();
        }
        throw err;
      } finally { task.interruptCheck = outerCheck; }
    } };
  }
  // Bread and steak at the base are a reserve within reach: when the base
  // is close enough, walking home replaces the wander for animals, and it
  // stands beside any hunt that is actually in view for Jev to weigh.
  // A walk for food, said with its time, the dark and whether health comes
  // back meanwhile (the decision audit): mid-110-e's walk to remembered
  // cows at seven health, hunger sixteen, at night met a skeleton and two
  // zombies on the way.
  const { DAY } = require('./day');
  // The hostiles near the straight way there, in view or not: mid-218-g ran
  // from a skeleton, then chose sheep sixty blocks on the far side of it,
  // told nothing of it, and was shot on the way back (2026-09-27).
  const passes = to => {
    if (!to) return {};
    const from = bot.entity.position, dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz) || 1;
    const near = require('./danger').hostileEntities(bot, 96).map(e => {
      const t = Math.max(0, Math.min(1, ((e.position.x - from.x) * dx + (e.position.z - from.z) * dz) / (len * len)));
      return { e, off: Math.hypot(from.x + dx * t - e.position.x, from.z + dz * t - e.position.z), along: Math.round(t * len) };
    }).filter(n => n.off <= 10).sort((a, b) => a.along - b.along);
    return near.length ? { passes: near.slice(0, 4).map(n => `a ${n.e.name.replaceAll('_', ' ')} ${Math.round(n.off)} blocks from the way, ${n.along} blocks along it`).join('; ') } : {};
  };
  const walkFacts = (distance, to = null) => {
    const seconds = Math.round(distance / 4.3), tod = bot.time?.timeOfDay ?? 6000;
    const dark = tod >= DAY.DARK && tod < DAY.DAWN;
    // A walk at the surface from under cover is a climb first (note 763).
    const leg = require('./levels').surfaceLeg(bot, { back: false });
    return { walkSeconds: seconds, ...(leg.seconds ? { climbFirst: `about ${leg.depth} blocks up to the surface first, ${leg.says.replace(/^the climb to open sky first, \d+ blocks up, /, '')}` } : {}), ...passes(to), ...(dark ? { dark: 'night: mobs spawn along the way' } : tod + seconds * 20 >= DAY.DARK && tod < DAY.DARK ? { dark: 'arrives after dark' } : {}),
      healthNow: Math.round(bot.health ?? 20), ...((bot.food ?? 20) < 18 && (bot.health ?? 20) < 20 ? { healing: `none meanwhile: hunger ${bot.food}, below eighteen` } : {}) };
  };
  const home = homeFood(bot, goal);
  if (home) choices.go_home_for_food = {
    description: { action: 'Walk back to the home base and eat from its stores: harvest the ripe wheat and bake bread, or take a steak from the cow pen (the breeding pair is kept).',
      distance: home.distance, loavesAvailable: home.loaves, steaksAvailable: home.steaks, plotLoaded: !home.unloaded, ...walkFacts(home.distance) },
    run: async () => {
      goal.survivalAction = { action: 'go_home_for_food', distance: home.distance, at: new Date().toISOString() }; save();
      const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
      try { await eatFromHome(bot, task, goal, save, actions); }
      finally { task.interruptCheck = outerCheck; }
    },
  };
  // A remembered village within reach has wheat already grown and hay
  // already stacked: ripe crops are taken and replanted, a bale or two is
  // dug for bread. Read off the world when the village is loaded, off
  // memory when it is not, and weighed by Jev beside any hunt in view.
  const village = villageFood(bot, goal);
  if (village) choices.village_food = {
    description: { action: 'Walk to the remembered village and take what is ripe from its farms (wheat, carrots, potatoes, putting the seed back) and a hay bale or two, then bake bread from the wheat. The villagers keep their houses and their bell.',
      distance: village.distance, ripeCrops: village.ripeCrops, hayBales: village.hayBales, villageLoaded: village.loaded, ...walkFacts(village.distance) },
    run: async () => {
      goal.survivalAction = { action: 'village_food', distance: village.distance, at: new Date().toISOString() }; save();
      const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
      try { await eatFromVillage(bot, task, goal, save, village.village, actions); }
      finally { task.interruptCheck = outerCheck; }
    },
  };
  // Herds seen earlier and out of view now (sightings.js): a walk of known
  // length, where the search is a wander.
  const sightings = require('./sightings');
  const herds = ['cow', 'sheep', 'rabbit'].flatMap(kind => sightings.sighted(bot, goal, kind).filter(s => s.distance > 32 && s.distance <= 192).map(s => ({ kind, s })))
    .sort((a, b) => a.s.distance - b.s.distance).slice(0, 3);
  // Each herd keyed by the number it was given when first offered (keys.js,
  // note 749), not its place in this list: the ledger's tries and the least
  // bad go by it.
  const herdIds = require('./decisions/keys').ids(goal, 'seen_food', herds.map(h => h.s), { near: 24 });
  herds.forEach(({ kind, s }, i) => {
    const key = `seen_food_${herdIds[i]}`;
    choices[key] = { target: { x: Math.round(s.x), y: Math.round(s.y ?? bot.entity.position.y), z: Math.round(s.z) }, description: { action: `Walk back to where ${s.says} and hunt there; animals wander, but not far.`, animal: kind, count: s.count, distance: s.distance, direction: s.direction, minutesAgo: s.minutesAgo, ...walkFacts(s.distance, s) },
      run: async () => {
        goal.survivalAction = { action: 'search_food', toward: { x: s.x, y: s.y, z: s.z }, animal: kind, at: new Date().toISOString() }; save();
        const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
        const out = {};
        try { await sightings.walkToSighting(bot, task, goal, save, kind, s, actions.navigate, out); }
        finally { task.interruptCheck = outerCheck; }
        // A walk that found no way there is a try that came to nothing,
        // recorded as such (note 771): it had returned quietly, so the
        // ledger had no failure to say or rest, and 25589 (2026-09-30
        // 23:53:42 to 23:55:03Z) chose seen_food_0, sheep 37 blocks up at
        // (236, 73, 452) from 30 blocks under rock, four times, each "no
        // route" within a second, the herd seen again and offered again.
        if (out.walk === 'failed') {
          const tried = require('./tried'), entry = tried.latestOf(goal, 'survival_priority');
          const why = `no way to the ${kind} seen at (${Math.round(s.x)}, ${Math.round(s.y ?? 0)}, ${Math.round(s.z)}) from (${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}): ${out.why}`;
          if (entry && entry.outcome === 'pending' && String(entry.method).endsWith(`/${key}`)) tried.markBlocked(entry, why);
          throw new Error(`The walk to the ${kind} seen came to nothing: ${why}`);
        }
      } };
  });
  // Always on offer: the animals in view may be the wrong ones to go for.
  // Unless it has just found nowhere to walk: mid-92-d stood on a lily pad
  // in the open sea with no dry ground within the search's forty-eight
  // blocks, and chose the search three hundred and eighty-five times in
  // eight minutes, each failing at once (2026-09-25). Rested two minutes
  // then, so the other ways (a boat, a herd seen) are chosen instead.
  const { isSetAside, setAside } = require('./progress');
  // Said with what the walk costs, as the others are: mid-207-l, at 5.2
  // health with no healing, chose it told nothing more than "walk to another
  // dry area", climbed out of its cave toward the surface, and a zombie and
  // a spider met it on the way (note 466).
  const searchFacts = () => {
    const facts = walkFacts(0);
    delete facts.walkSeconds;
    const { climbToSurface, climbMinutes, surfaceObserver } = require('./surface');
    let underground = false, climb = 0;
    try { underground = bot.game?.dimension === 'overworld' && !surfaceObserver(bot)(bot.entity.position); climb = underground ? climbToSurface(bot, bot.entity.position) : 0; } catch (_) {}
    if (underground && !facts.climbFirst) facts.climbFirst = climb != null ? `about ${climb} blocks up to the surface first, roughly ${climbMinutes(climb)} minutes` : 'up to the surface first, how far not known';
    // What is owed at each level, the climb at the bot's own pace (note 763).
    if (underground) { const owed = require('./levels').levelsSays(bot, goal, { going: 'up' }).trim(); if (owed) facts.owedByLevel = owed; }
    const about = require('./danger').hostileEntities(bot, 24);
    if (about.length) facts.hostilesWithin24 = [...new Set(about.map(e => e.name))].map(n => `${about.filter(e => e.name === n).length} ${n.replaceAll('_', ' ')}`).join(', ');
    return facts;
  };
  if (!isSetAside(goal, 'forage', 'search_food')) choices.search_food = {
    description: { action: 'Walk to another observed dry area on the surface to search for passive animals, how far not known until they are seen; avoid remembered failed targets.', ...searchFacts() },
    run: async () => {
      goal.survivalAction = { action: 'search_food', at: new Date().toISOString() }; save();
      const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
      try { await actions.explore(bot, task, goal, save, 'food animals', { surfaceOnly: true }); }
      catch (err) {
        if (/No reachable surveyed ground/.test(err.message || '')) { setAside(goal, 'forage', 'search_food', 'no dry ground to walk to within forty-eight blocks', 120000); save(); }
        throw err;
      }
      finally { task.interruptCheck = outerCheck; }
    },
  };
  return choices;
}

module.exports = { foodSupply, lastResortSupply, forageChoices, hunt, preyFood };
