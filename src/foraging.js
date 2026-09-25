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
const { strike } = require('./combat');
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
    if (!await makeRoom(bot, task, item, { away: target.position })) throw new Error(`No room in my pockets for ${item.replaceAll('_', ' ')}`);
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
        try { await actions.navigate(bot, task, new goals.GoalFollow(target, 2), { timeoutMs: 5000, stallMs: 2500, stopWhen: () => !valid() }); }
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

async function forageChoices(bot, task, goal, save, actions, state) {
  const choices = {};
  for (const [output, inputs] of Object.entries(knowledge(bot.registry).smelting)) {
    if (!safeFood(bot, { name: output })) continue;
    const input = inputs.find(name => count(bot, name) > 0);
    if (!input) continue;
    const amount = Math.min(count(bot, input), 4, Math.max(1, Math.ceil((12 - foodSupply(bot)) / bot.registry.foodsByName[output].foodPoints)));
    const targetCount = count(bot, output) + amount;
    choices[`cook_${output}`] = { description: { action: 'Cook carried ingredients into safe food using the recipe dependencies; gather a furnace, tool and fuel if needed.',
      input, carried: count(bot, input), output, amount, safeToEatRaw: safeFood(bot, { name: input }) },
    valid: () => count(bot, input) >= amount,
    run: async () => {
      goal.survivalAction = { action: 'cook_food', input, output, amount, at: new Date().toISOString() }; save();
      task.interruptCheck = () => checkThreats(bot);
      try { await actions.acquireStep(bot, task, output, targetCount, goal, save); }
      finally { task.interruptCheck = undefined; }
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
        task.interruptCheck = () => checkThreats(bot);
        try { await actions.acquireStep(bot, task, 'wooden_sword', 1, goal, save); }
        finally { task.interruptCheck = undefined; }
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
      nearestHostileToIt: (() => { const d = threats(bot).map(t => ({ name: t.entity.name, distance: Math.round(t.entity.position.distanceTo(target.position)) })).sort((a, b) => a.distance - b.distance)[0]; return d && d.distance <= 32 ? d : null; })() },
    valid: () => bot.entities[target.id] === target && target.isValid !== false && preyFood(bot, target) === item && target.position.distanceTo(observed) < 2,
    run: async () => {
      goal.survivalAction = { action: 'gather_food', animal: target.name, position: { ...target.position }, at: new Date().toISOString() }; save();
      task.interruptCheck = () => checkThreats(bot);
      try { await hunt(bot, task, target, actions, goal, save); }
      catch (err) {
        if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) {
          state.failedPrey ||= {}; state.failedPrey[target.uuid || target.id] = Date.now(); save();
        }
        throw err;
      } finally { task.interruptCheck = undefined; }
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
  const walkFacts = distance => {
    const seconds = Math.round(distance / 4.3), tod = bot.time?.timeOfDay ?? 6000;
    const dark = tod >= DAY.DARK && tod < DAY.DAWN;
    return { walkSeconds: seconds, ...(dark ? { dark: 'night: mobs spawn along the way' } : tod + seconds * 20 >= DAY.DARK && tod < DAY.DARK ? { dark: 'arrives after dark' } : {}),
      healthNow: Math.round(bot.health ?? 20), ...((bot.food ?? 20) < 18 ? { healing: `none meanwhile: hunger ${bot.food}, below eighteen` } : {}) };
  };
  const home = homeFood(bot, goal);
  if (home) choices.go_home_for_food = {
    description: { action: 'Walk back to the home base and eat from its stores: harvest the ripe wheat and bake bread, or take a steak from the cow pen (the breeding pair is kept).',
      distance: home.distance, loavesAvailable: home.loaves, steaksAvailable: home.steaks, plotLoaded: !home.unloaded, ...walkFacts(home.distance) },
    run: async () => {
      goal.survivalAction = { action: 'go_home_for_food', distance: home.distance, at: new Date().toISOString() }; save();
      task.interruptCheck = () => checkThreats(bot);
      try { await eatFromHome(bot, task, goal, save, actions); }
      finally { task.interruptCheck = undefined; }
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
      task.interruptCheck = () => checkThreats(bot);
      try { await eatFromVillage(bot, task, goal, save, village.village, actions); }
      finally { task.interruptCheck = undefined; }
    },
  };
  // Herds seen earlier and out of view now (sightings.js): a walk of known
  // length, where the search is a wander.
  const sightings = require('./sightings');
  const herds = ['cow', 'sheep'].flatMap(kind => sightings.sighted(bot, goal, kind).filter(s => s.distance > 32 && s.distance <= 192).map(s => ({ kind, s })))
    .sort((a, b) => a.s.distance - b.s.distance).slice(0, 3);
  herds.forEach(({ kind, s }, i) => {
    choices[`seen_food_${i}`] = { description: { action: `Walk back to where ${s.says} and hunt there; animals wander, but not far.`, animal: kind, count: s.count, distance: s.distance, direction: s.direction, minutesAgo: s.minutesAgo, ...walkFacts(s.distance) },
      run: async () => {
        goal.survivalAction = { action: 'search_food', toward: { x: s.x, y: s.y, z: s.z }, animal: kind, at: new Date().toISOString() }; save();
        task.interruptCheck = () => checkThreats(bot);
        try { await sightings.walkToSighting(bot, task, goal, save, kind, s, actions.navigate); }
        finally { task.interruptCheck = undefined; }
      } };
  });
  // Always on offer: the animals in view may be the wrong ones to go for.
  choices.search_food = {
    description: 'Walk to another observed dry area to search for passive animals; avoid remembered failed targets.',
    run: async () => {
      goal.survivalAction = { action: 'search_food', at: new Date().toISOString() }; save();
      task.interruptCheck = () => checkThreats(bot);
      try { await actions.explore(bot, task, goal, save, 'food animals', { surfaceOnly: true }); }
      finally { task.interruptCheck = undefined; }
    },
  };
  return choices;
}

module.exports = { foodSupply, forageChoices, hunt };
