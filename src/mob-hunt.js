'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { handlers, combatGear, durable, carriedEquipment, equipped, readyEquipment, observedDead } = require('./mob-policy');
const { threats, checkThreats, NeedsSafety } = require('./danger');
const { canStrike, defenseWeapon, bowReady, shoot } = require('./combat');
const { aimAtEntity } = require('./projectiles');
const { dryStanding } = require('./mining-access');
const { dryBodySpace, damagingTerrain, supportCell } = require('./terrain');
const { checkAir } = require('./vitals');
const { surveyRoute, countOf } = require('./skills');
const { decideTree } = require('./decisions');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dimension = bot => String(bot.game.dimension).replace(/^minecraft:/, '').replace(/^the_/, '');
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });
const valid = (bot, target) => bot.entities[target.id] === target && target.isValid !== false && !observedDead(bot, target);

// Gold on the feet in the Nether, where it keeps piglins neutral; the
// better boots everywhere else. Worn iron boots passed the readiness
// check, so the golden pair stayed in the pockets through the trip.
function preferredBoots(bot) {
  const carried = new Set(carriedEquipment(bot).map(i => i.name));
  if (bot.game?.dimension && dimension(bot) === 'nether') return carried.has('golden_boots') ? 'golden_boots' : null;
  return ['netherite_boots', 'diamond_boots', 'iron_boots'].find(name => carried.has(name)) || null;
}

async function prepareCombatGear(bot, task, goal, save, actions) {
  for (const [destination, names] of Object.entries(combatGear)) {
    task.check(); checkAir(bot);
    const current = equipped(bot, destination);
    const preferred = destination === 'feet' ? preferredBoots(bot) : null;
    if (names.includes(current?.name) && durable(bot.registry, current) && (!preferred || current.name === preferred)) continue;
    const carried = (preferred && carriedEquipment(bot).find(item => item.name === preferred)) ||
      carriedEquipment(bot).filter(item => names.includes(item.name)).sort((a, b) => names.indexOf(b.name) - names.indexOf(a.name))[0];
    if (!carried) {
      goal.step = { action: 'prepare_combat_equipment', destination, item: names[0] }; save();
      // Worn equipment is still physically present; require an additional
      // item rather than accepting that worn stack as its own replacement.
      await actions.acquireStep(bot, task, names[0], countOf(bot, names[0]) + 1, goal, save);
      return false;
    }
    await bot.equip(carried, destination);
    task.check();
    if (equipped(bot, destination)?.name !== carried.name) throw new Error(`Server did not confirm ${carried.name} equipped in ${destination}`);
    goal.step = { action: 'equip_combat', item: carried.name, destination }; save();
  }
  return readyEquipment(bot);
}

function combatMovement(bot) {
  const movements = bot.pathfinder.movements;
  const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers,
    allowParkour: movements.allowParkour, allowedPosition: movements.allowedPosition, scafoldingBlocks: movements.scafoldingBlocks };
  const allowed = p => dryBodySpace(bot, p) && !damagingTerrain.has(bot.blockAt(supportCell(p))?.name) &&
    (!previous.allowedPosition || previous.allowedPosition(p));
  Object.assign(movements, { canDig: false, allow1by1towers: false, allowParkour: false, scafoldingBlocks: [], allowedPosition: allowed });
  return { allowed, restore: () => Object.assign(movements, previous) };
}

function isolated(bot, target, handler = handlers[target.name] || {}) {
  if (threats(bot).some(t => t.entity !== target && (t.distance < 20 || t.entity.position.distanceTo(target.position) < 16))) return false;
  // A sword sweep must not hit a nearby player or provoke another mob. A
  // flock of chickens is not a crowd of mobs: a passive animal only needs
  // the hostiles kept away.
  return handler.passive || !Object.values(bot.entities).some(e => e !== target && e !== bot.entity && valid(bot, e) &&
    e.position && bot.registry.entitiesByName[e.name]?.metadataKeys?.includes('health') && e.position.distanceTo(target.position) < 4);
}

// A passive animal is a chase with whatever is carried, not an encounter:
// no armour, no shield and a lower health floor. Mobs that fight back keep
// the full kit and near-full health.
function canBegin(bot, handler = {}) {
  const standing = bot.game.gameMode === 'survival' && bot.game.difficulty !== 'peaceful' &&
    bot.oxygenLevel > 12 && !(bot.entity.metadata?.[0] & 1) && dryStanding(bot, bot.entity.position);
  if (handler.passive) return standing && bot.health >= 10 && bot.food >= 6;
  // Fourteen in full armour: eighteen was a bar the Nether could not meet
  // once the food ran out, and the wait for it never ends without regen.
  return standing && bot.health >= 14 && bot.food >= 14 && readyEquipment(bot);
}

// The route exception names one live entity and expires with this action.
// Other mobs, liquid, cliffs, cancellations and low health still interrupt it.
function encounter(bot, task, target, expiresAt) {
  const previous = bot._combatEncounter;
  bot._combatEncounter = { task, target, dimension: bot.game.dimension, expiresAt };
  return () => { bot._combatEncounter = previous; };
}

async function fightForDrop(bot, task, target, goal, save, actions, { timeoutMs = 30000, pickupWaitMs = 2500 } = {}) {
  task.check(); checkAir(bot);
  const state = goal.mobHunt, handler = handlers[target.name];
  if (!handler || handler.item !== state?.item || !valid(bot, target) || !canBegin(bot, handler) || !isolated(bot, target, handler)) throw new Error('Mob encounter is no longer feasible');
  const before = countOf(bot, state.item), start = bot.entity.position.clone(), deadline = Date.now() + timeoutMs;
  const shieldWear = () => equipped(bot, 'off-hand')?.durabilityUsed || 0;
  const initialShieldWear = shieldWear(), guarded = !handler.passive && equipped(bot, 'off-hand')?.name === 'shield';
  const ready = () => handler.passive ? bot.health >= 8 && bot.food >= 4 : bot.health >= 12 && bot.food >= 12 && readyEquipment(bot, handler.ranged ? ['bow'] : []);
  const sword = () => carriedEquipment(bot).find(item => combatGear.hand.includes(item.name));
  const restoreEncounter = encounter(bot, task, target, deadline), movement = combatMovement(bot);
  const previousInterrupt = task.interruptCheck;
  let dead = false, attacks = 0, shield = false, shots = 0, failedShots = 0;
  const onDeath = entity => {
    if (entity === target) { dead = true; bot._defeatedMobs ||= new WeakSet(); bot._defeatedMobs.add(entity); }
  };
  bot.on('entityDead', onDeath);
  task.interruptCheck = () => {
    previousInterrupt?.(); checkAir(bot); checkThreats(bot);
    if (!ready() || !isolated(bot, target, handler)) throw new NeedsSafety({ entity: target, distance: target.position.distanceTo(bot.entity.position) });
    if (Date.now() >= deadline) throw new Error(`Timed out fighting ${target.name} after ${Math.round(timeoutMs / 1000)} seconds`);
    if (bot.entity.position.distanceTo(start) > 48) throw new Error(`${target.name} moved beyond the bounded combat area`);
  };
  const guard = () => task.check();
  const lowerShield = () => { if (shield) { bot.deactivateItem(); shield = false; } };
  try {
    // The kit's sword is already in hand for a mob that fights back; a
    // passive animal is struck with the best thing carried, or bare hands.
    if (handler.passive) {
      const weapon = defenseWeapon(bot);
      if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand');
      guard();
    }
    while (valid(bot, target) && !dead) {
      guard();
      if (!canStrike(bot, target)) {
        lowerShield();
        // A blaze shoots. Answer from range with the bow while it is in clear
        // view and an arrow can reach it; close to the sword when none can,
        // or after three draws that could not be released.
        const range = target.position.distanceTo(bot.entity.position);
        if (handler.ranged && failedShots < 3 && range >= 4 && range <= 20 && bowReady(bot) && aimAtEntity(bot, target)) {
          try {
            await shoot(bot, task, target, { cover: false }); shots++;
            goal.step = { action: 'hunt_mob', entity: target.name, entityId: target.id, item: state.item, attacks, shots, health: bot.health }; save();
          } catch (err) {
            task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
            failedShots++;
          }
          continue;
        }
        const destination = new goals.GoalFollow(target, 2);
        const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 400);
        if (route.status !== 'success' || !route.path.every(movement.allowed)) throw new Error(`No dry combat route to ${target.name}`);
        await actions.navigate(bot, task, destination, { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500,
          stopWhen: () => dead || !valid(bot, target) || canStrike(bot, target) });
        continue;
      }
      bot.pathfinder.setGoal(null); bot.clearControlStates();
      // Back to the sword after the bow.
      if (shots && !combatGear.hand.includes(bot.heldItem?.name) && sword()) { await bot.equip(sword(), 'hand'); guard(); }
      await bot.lookAt(target.position.offset(0, Math.min((target.height || 1.8) / 2, 1.5), 0), true);
      guard();
      if (!valid(bot, target) || dead || !canStrike(bot, target)) continue;
      lowerShield();
      if (target.name === 'enderman') {
        bot._provokedMobs ||= new Map();
        bot._provokedMobs.set(target.id, target);
        if (bot._provokedMobs.size > 64) bot._provokedMobs.delete(bot._provokedMobs.keys().next().value);
      }
      bot.attack(target); attacks++;
      goal.step = { action: 'hunt_mob', entity: target.name, entityId: target.id, item: state.item, attacks, health: bot.health }; save();
      const wearBefore = shieldWear(), swungAt = Date.now();
      if (!guarded) {
        // Nothing to block: wait out the swing cooldown, keep facing the animal.
        while (Date.now() < Math.min(deadline, swungAt + 600) && valid(bot, target) && !dead) {
          await sleep(50); guard();
          await bot.lookAt(target.position.offset(0, Math.min((target.height || 1.8) / 2, 1.5), 0), true);
        }
        continue;
      }
      bot.activateItem(true); shield = true;
      // Raising a shield has a startup delay. Blindly lowering it every 700 ms
      // repeatedly exposed Jev exactly when an Enderman swung. Keep facing the
      // target, then use observed shield wear as evidence of a blocked hit;
      // the following sword swing fits inside the mob's attack cooldown.
      const guardUntil = Math.min(deadline, swungAt + 1500);
      while (Date.now() < guardUntil && valid(bot, target) && !dead) {
        await sleep(50); guard();
        if (Date.now() - swungAt >= 700 && shieldWear() > wearBefore) break;
        await bot.lookAt(target.position.offset(0, Math.min((target.height || 1.8) / 2, 1.5), 0), true);
      }
    }
    lowerShield();
    // Entity removal can mean teleport/unload. Record it separately from death
    // and never infer a drop from either event.
    const pickupDeadline = Math.min(deadline, Date.now() + pickupWaitMs);
    const unreachableDrops = new Set();
    do {
      await sleep(100); guard();
      const drops = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === state.item && e.position.distanceTo(target.position) < 8);
      for (const drop of drops.slice(0, 4)) {
        if (countOf(bot, state.item) > before) break;
        guard();
        const p = drop.position.floored(), key = `${drop.id}:${p}`, destination = new goals.GoalNear(p.x, p.y, p.z, 1);
        // A drop still falling from a flying mob has no standing position yet.
        // Reobserve it during the bounded pickup window instead of declaring
        // no loot from one early snapshot.
        if (!dryStanding(bot, p) || unreachableDrops.has(key)) continue;
        const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 300);
        if (route.status !== 'success' || !route.path.every(movement.allowed)) { unreachableDrops.add(key); continue; }
        await actions.navigate(bot, task, destination, { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500,
          stopWhen: () => countOf(bot, state.item) > before });
        for (let i = 0; i < 10 && countOf(bot, state.item) <= before; i++) { await sleep(50); guard(); }
      }
    } while (countOf(bot, state.item) <= before && Date.now() < pickupDeadline);
    const pickedUp = Math.max(0, countOf(bot, state.item) - before);
    const result = { at: new Date().toISOString(), entity: target.name, entityId: target.id, item: state.item,
      deathObserved: dead, attacks, shots, pickedUp, shieldWear: Math.max(0, shieldWear() - initialShieldWear),
      health: bot.health, outcome: pickedUp ? 'pickup_confirmed' : dead ? 'no_pickup' : 'target_lost' };
    state.history = [...(state.history || []), result].slice(-40);
    state.encountersWithoutPickup = pickedUp ? 0 : (state.encountersWithoutPickup || 0) + 1;
    state.avoided ||= {}; state.avoided[target.uuid || target.id] = Date.now();
    if (pickedUp && goal.search?.[target.name]) goal.search[target.name] = { attempts: 0, origin: { ...bot.entity.position.floored() } };
    bot.emit('mob_hunt', result); save();
    if (!dead && !pickedUp) throw new Error(`${target.name} disappeared without a confirmed drop`);
    if (state.encountersWithoutPickup >= 64) throw blocked(`No ${state.item} pickup in 64 encounters; progress saved`);
    return result;
  } finally {
    lowerShield(); bot.pathfinder.setGoal(null); bot.clearControlStates();
    // The next candidate check wants the sword in hand, not the bow.
    if (shots && !combatGear.hand.includes(bot.heldItem?.name) && sword()) await bot.equip(sword(), 'hand').catch(() => {});
    bot.removeListener('entityDead', onDeath); movement.restore(); restoreEncounter();
    task.interruptCheck = previousInterrupt;
    if (dead) bot._provokedMobs?.delete(target.id);
  }
}

async function huntObserved(bot, task, goal, save, actions, client) {
  const state = goal.mobHunt;
  if (!state) return false;
  if (countOf(bot, state.item) >= state.targetCount) { delete goal.mobHunt; save(); return false; }
  const handler = handlers[state.entity] || {};
  if (!canBegin(bot, handler)) return false;
  const candidates = Object.values(bot.entities).filter(e => e.name === state.entity && valid(bot, e) &&
    e.position.distanceTo(bot.entity.position) < 24 && isolated(bot, e, handler) &&
    !(state.avoided?.[e.uuid || e.id] > Date.now() - 120000)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  const tree = {}, positions = new Map();
  for (const target of candidates.slice(0, 4)) {
    const restore = encounter(bot, task, target, Date.now() + 1500), movement = combatMovement(bot);
    try {
      const route = canStrike(bot, target) ? { status: 'success', path: [] } :
        await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalFollow(target, 2), 400);
      if (route.status !== 'success' || !route.path.every(movement.allowed)) continue;
      positions.set(target.id, target.position.clone());
      tree[`hunt_${target.id}`] = { description: { action: handler.passive ? 'Chase this observed animal and strike it with what is carried, then verify item pickup.' :
        handler.ranged && bowReady(bot) ? 'Fight this observed isolated mob: arrows from range while it is in view, then the sword, shield and armor up close; verify item pickup.' :
        'Fight this observed isolated mob with carried armor, sword and shield, then verify item pickup.',
        entity: target.name, position: { ...target.position }, distance: target.position.distanceTo(bot.entity.position),
        item: state.item, randomDrop: true }, run: () => fightForDrop(bot, task, target, goal, save, actions) };
    } finally { movement.restore(); restore(); }
  }
  if (!Object.keys(tree).length) return false;
  tree.defer = { description: 'Leave these targets alone for now if the observed situation is unsuitable; keep the resource goal saved.', run: async () => {
    state.avoided ||= {}; for (const target of candidates) state.avoided[target.uuid || target.id] = Date.now(); save();
  } };
  const snapshot = { request: goal.request, resource: state.item, need: state.targetCount - countOf(bot, state.item), health: bot.health, food: bot.food, dimension: dimension(bot) };
  let decision;
  if (client) {
    const controller = new AbortController();
    const watcher = setInterval(() => { if (task.cancelled || !canBegin(bot, handler)) controller.abort(new Error('Combat decision interrupted')); }, 100);
    try { decision = await decideTree(client, { state: snapshot, tree, signal: controller.signal, kind: 'combat',
      isFresh: () => canBegin(bot, handler) && bot.health === snapshot.health && candidates.every(e => !positions.has(e.id) ||
        valid(bot, e) && e.position.distanceTo(positions.get(e.id)) < 2 && isolated(bot, e, handler)) }); }
    catch (err) { task.check(); if (controller.signal.aborted) return false; throw err; }
    finally { clearInterval(watcher); }
  } else decision = { path: [Object.keys(tree)[0]], action: Object.values(tree)[0] };
  task.check(); checkAir(bot);
  goal.decisions ||= []; goal.decisions.push({ at: new Date().toISOString(), state: snapshot, path: decision.path,
    options: JSON.parse(JSON.stringify(tree)), latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments, stale: decision.stale });
  goal.decisions = goal.decisions.slice(-40); save();
  if (decision.stale) return false;
  await decision.action.run();
  return decision.path[0] !== 'defer';
}

async function prepareMobHunt(bot, task, step, goal, save, actions) {
  const handler = handlers[step.entity];
  if (!handler || handler.item !== step.item) throw blocked(`Unsupported mob source ${step.entity} for ${step.item}`);
  if (bot.game.difficulty === 'peaceful') throw blocked(`${step.entity} does not spawn in Peaceful; cannot obtain ${step.item} by hunting here`);
  const previous = goal.mobHunt;
  goal.mobHunt = { ...(previous?.item === step.item ? previous : {}), item: step.item, entity: step.entity,
    targetCount: countOf(bot, step.item) + step.count };
  goal.stockFood = true; save();
  if (!handler.passive && !await prepareCombatGear(bot, task, goal, save, actions)) return;
  if (handler.dimension && dimension(bot) !== handler.dimension) { await actions.enterNether(bot, task, goal, save); return; }
  if (!canBegin(bot, handler)) {
    // Nothing to eat and hunger under eighteen means no regeneration: the
    // recovery never comes. Off the Overworld that is a trip back for food.
    const { chooseFood } = require('./vitals');
    if (bot.food < 18 && !chooseFood(bot) && dimension(bot) !== 'overworld' && actions.returnOverworld) {
      goal.step = { action: 'return_for_food', health: bot.health, food: bot.food }; goal.stockFood = true; save();
      await actions.returnOverworld(bot, task, goal, save); return;
    }
    goal.step = { action: 'recover_before_combat', health: bot.health, food: bot.food, neededHealth: handler.passive ? 10 : 14, neededFood: handler.passive ? 6 : 14 }; save();
    await sleep(500); task.check(); return;
  }
  // A mob already in view is stalked where it is: the observed-hunt check at
  // the top of the loop takes it the moment the route and the odds allow.
  // Exploring for it instead climbed to the surface every time a cave spider
  // showed, and the diamond shaft was dug and left three times in a row.
  // A mob that stays out of reach for a minute is set aside for two.
  const state = goal.mobHunt;
  const near = Object.values(bot.entities || {}).filter(e => e.name === step.entity && e.isValid !== false &&
    !(state?.avoided?.[e.uuid || e.id] > Date.now() - 120000) && e.position.distanceTo(bot.entity.position) < 32)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
  if (near) {
    const key = near.uuid || near.id;
    if (!state.stalking || state.stalking.key !== key) state.stalking = { key, since: Date.now() };
    const distance = near.position.distanceTo(bot.entity.position);
    goal.step = { action: 'stalk_mob', entity: step.entity, distance: Number(distance.toFixed(1)) }; save();
    if (Date.now() - state.stalking.since > 45000) { (state.avoided ||= {})[key] = Date.now(); delete state.stalking; save(); }
    // A mob seen far off is closed on, not watched: a blaze at twenty-nine
    // blocks was stood in front of for sixteen persistence rounds while the
    // observed-hunt check, which looks within twenty-four, never saw it.
    if (distance > 10 && actions.navigate) {
      const from = bot.entity.position.clone();
      try { await actions.navigate(bot, task, new goals.GoalNear(near.position.x, near.position.y, near.position.z, 8), { timeoutMs: 20000, stallMs: 5000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      // No way to it (a blaze on a wall across the lava): set it aside and
      // walk the fortress; the walk brings another into reach.
      if (bot.entity.position.distanceTo(from) < 1.5) {
        (state.avoided ||= {})[key] = Date.now(); delete state.stalking; save();
        if (handler.dimension === 'nether' && actions.tunnel) { await findFortressStep(bot, task, goal, save, actions); }
      }
      return;
    }
    await sleep(1000); return;
  }
  delete state.stalking;
  // Blazes live in fortresses, and a fortress is found by sweeping, not by
  // rings around the portal: fortress strips run north to south, so a walk
  // east or west crosses one. Nether bricks in view end the sweep.
  if (handler.dimension === 'nether' && actions.tunnel) { await findFortressStep(bot, task, goal, save, actions); return; }
  // A hunt circles where it started, in rings of twenty-four blocks, rather
  // than walking the map's frontier: the mob comes to the bot at night. By
  // day underground the caves are the hunting ground, not the surface.
  // Required here, not at the top: surface.js reaches this module through work.js.
  const { surfaceObserver } = require('./surface');
  const underground = dimension(bot) === 'overworld' && !surfaceObserver(bot)(bot.entity.position);
  await actions.explore(bot, task, goal, save, step.entity, { surfaceOnly: dimension(bot) === 'overworld' && !underground, frontier: false });
}

const FORTRESS_BLOCKS = ['nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_brick_slab', 'nether_wart'];
const FORTRESS_LEG = 96;
// The next leg of the sweep: ninety-six blocks along x, one way, at a
// height between the lava sea and the ceiling.
function fortressLegTarget(state, position) {
  const y = Math.max(40, Math.min(80, Math.round(position.y)));
  return new Vec3(Math.round(position.x + FORTRESS_LEG * state.axis), y, Math.round(position.z));
}
async function findFortressStep(bot, task, goal, save, actions) {
  const state = goal.fortressSearch ||= { axis: Math.round(bot.entity.position.x) % 2 === 0 ? 1 : -1, legs: 0 };
  const ids = FORTRESS_BLOCKS.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  // Bricks near a face that would not be approached are ignored for ten
  // minutes: the fortress was straight below a shelf with a cave between,
  // and every tick tried the same drop. The sweep meets it elsewhere.
  state.shunned = (state.shunned || []).filter(sh => sh.until > Date.now());
  const shunned = b => state.shunned.some(sh => Math.hypot(sh.x - b.x, sh.z - b.z) <= 16);
  const bricks = bot.findBlocks({ matching: ids, maxDistance: 128, count: 512 }).filter(b => !shunned(b));
  if (bricks.length) {
    const here = bot.entity.position;
    const nearest = bricks.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    state.found = { x: nearest.x, y: nearest.y, z: nearest.z };
    if (nearest.distanceTo(here) > 6) {
      goal.step = { action: 'find_fortress', found: state.found, legs: state.legs }; save();
      // The pathfinder first: it pillars and scaffolds, and the brick was
      // nine blocks below a ledge the staircase could not step off. The
      // tunnel is the fallback.
      if (actions.navigate) {
        // A point level with the bot above the fortress first: the
        // pathfinder bridges a gap with blocks and digs down into the
        // structure, where a slanted goal from a ledge found no path.
        const from = bot.entity.position.clone();
        const goalsToTry = [new goals.GoalNear(nearest.x, Math.round(here.y), nearest.z, 4), new goals.GoalNear(nearest.x, nearest.y + 1, nearest.z, 3)];
        for (const g of goalsToTry) {
          try { await actions.navigate(bot, task, g, { timeoutMs: 45000, stallMs: 8000 }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
          if (bot.entity.position.distanceTo(from) > 2) { state.approachFails = 0; return; }
        }
      }
      const before = bot.entity.position.clone();
      try { await actions.tunnel(bot, task, goal, save, nearest, 'fortress'); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      if (bot.entity.position.distanceTo(before) > 1.5) { state.approachFails = 0; return; }
      state.approachFails = (state.approachFails || 0) + 1;
      if (state.approachFails >= 3) {
        state.shunned.push({ x: nearest.x, z: nearest.z, until: Date.now() + 600000 }); state.approachFails = 0; delete state.target; save();
        bot.chat?.("No way down to the fortress here. Following it along to find a way in.");
      }
      return;
    }
    // Inside: walk the structure. The farthest brick not yet walked to is
    // the next stretch of corridor; blazes come into view on the way and
    // the observed hunt takes them. Standing on the first brick found was
    // twenty rounds of no progress.
    state.visited ||= [];
    // Floor bricks only: two blocks of air over them and near the bot's
    // level. Aiming at a ceiling brick had the bot pillaring up to it and
    // being sent back down, twice a second.
    const clear = q => { const b = bot.blockAt(q); return !b || b.boundingBox === 'empty'; };
    const floors = bricks.filter(b => clear(b.offset(0, 1, 0)) && clear(b.offset(0, 2, 0)) && Math.abs(b.y + 1 - here.y) <= 6);
    const walkable = floors.length ? floors : bricks;
    // The nearest fresh stretch beyond twelve blocks, not the farthest: the
    // farthest brick in view is the one across the lava.
    const fresh = walkable.filter(b => !state.visited.some(v => Math.hypot(v.x - b.x, v.z - b.z) < 12));
    const byDistance = fresh.sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
    const next = byDistance.find(b => b.distanceTo(here) >= 12);
    // Every stretch in view walked: this part of the fortress is done, and
    // the sweep goes on from here to the next one.
    if (!next) { delete state.target; }
    else {
    state.visited.push({ x: next.x, y: next.y, z: next.z }); state.visited = state.visited.slice(-32);
    goal.step = { action: 'find_fortress', found: state.found, walking: { x: next.x, y: next.y, z: next.z }, legs: state.legs }; save();
    if (actions.navigate) {
      try { await actions.navigate(bot, task, new goals.GoalNear(next.x, next.y + 1, next.z, 3), { timeoutMs: 30000, stallMs: 6000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; await actions.tunnel(bot, task, goal, save, next, 'fortress'); }
    } else await actions.tunnel(bot, task, goal, save, next, 'fortress');
    return;
    }
  }
  const here = bot.entity.position;
  if (!state.target || Math.hypot(state.target.x - here.x, state.target.z - here.z) < 8) {
    const next = fortressLegTarget(state, here); state.target = { x: next.x, y: next.y, z: next.z }; state.legs++;
  }
  goal.step = { action: 'find_fortress', target: state.target, legs: state.legs }; save();
  await actions.tunnel(bot, task, goal, save, new Vec3(state.target.x, state.target.y, state.target.z), 'fortress');
}

module.exports = { prepareCombatGear, combatMovement, canBegin, isolated, fightForDrop, huntObserved, prepareMobHunt, findFortressStep, fortressLegTarget, FORTRESS_LEG };
