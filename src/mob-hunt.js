'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { handlers, combatGear, durable, carriedEquipment, equipped, readyEquipment, kitReady, observedDead, shooter, hasFood, FIGHT_FLOOR: HUNT_FLOOR } = require('./mob-policy');
const { threats, checkThreats, NeedsSafety } = require('./danger');
const { canStrike, defenseWeapon, bowReady, shoot } = require('./combat');
const { deflect } = require('./projectile-guard');
const { aimAtEntity } = require('./projectiles');
const { dryStanding } = require('./mining-access');
const { dryBodySpace, damagingTerrain, supportCell } = require('./terrain');
const { checkAir } = require('./vitals');
const { surveyRoute, countOf } = require('./skills');
const { collectNearbyDrops } = require('./drop-collection');
const { decideTree, announceFallback, firstOption } = require('./decisions');
const { descendTo } = require('./descent');
const { setAside, isSetAside, watch, unwatch } = require('./progress');
const { bridgeTo } = require('./bridging');
const { bunkerFight, digBunker, raiseCover, openToward, swarm, nearWall, centroid: bunkerCentroid } = require('./bunker');
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
  // Blazes come off a spawner two and three at a time: another of the
  // hunted kind blocks the fight only when it is close to the bot itself,
  // or no blaze in a fortress would ever be fought. A mob of another kind
  // is given more room, a shooter most of all.
  // Six blazes stood over a spawner with the bot seven blocks off and none
  // was ever "isolated". Kin out of sight cannot shoot; up to two more in
  // view is a fight, three is a swarm.
  const others = threats(bot).filter(t => t.entity !== target);
  const kinInView = others.filter(t => t.entity.name === target.name && t.visible && t.distance < 8).length;
  // A hoglin twelve blocks off is not a reason to leave a blaze alone. The
  // crimson forest above a fortress is full of them, and at twelve blocks
  // every blaze in the spawner room was "not isolated" and none was ever
  // fought. Something that shoots still gets a wide berth.
  // Three of the hunted kind in view was "too many" whatever the bot's
  // condition, and a spawner keeps eleven in the air: the live run stood
  // level with them at full health for half an hour and never opened a
  // fight. In the arena a swarm fought in the open at full health came
  // home with rods; watched, it came home with nothing. The crowd stops a
  // fight only once the bot is already hurt; whole, the nearest one is a
  // fight like any other.
  const crowd = (kinInView >= 3 && (bot.health ?? 20) < 16) || others.some(t => t.entity.name !== target.name &&
    (t.distance < (shooter(t.entity) ? 16 : 8) || t.entity.position.distanceTo(target.position) < 6));
  if (crowd) return false;
  // A sword sweep must not hit a nearby player or provoke another mob. A
  // flock of chickens is not a crowd of mobs: a passive animal only needs
  // the hostiles kept away.
  // Another of the same kind is the crowd rule's business above: counted
  // here as well, every blaze beside another at a spawner was "not
  // isolated", and there is no other kind of blaze at a spawner.
  return handler.passive || !Object.values(bot.entities).some(e => e !== target && e !== bot.entity && e.name !== target.name && valid(bot, e) &&
    e.position && bot.registry.entitiesByName[e.name]?.metadataKeys?.includes('health') && e.position.distanceTo(target.position) < 4);
}

// A passive animal is a chase with whatever is carried, not an encounter:
// no armour, no shield and a lower health floor. Mobs that fight back keep
// the full kit and near-full health.
function canBegin(bot, handler = {}) {
  const standing = bot.game.gameMode === 'survival' && bot.game.difficulty !== 'peaceful' &&
    bot.oxygenLevel > 12 && dryStanding(bot, bot.entity.position);
  // Burning is the normal state of a blaze fight: the fireball that lights
  // the bot is thrown by the thing it came to kill, and there is no water
  // in the Nether to put it out. Refusing to fight while alight meant
  // standing in the open on fire being shot by the blaze, over and over,
  // which is the whole reason two blazes cost thirty health where one costs
  // a single point. Fire ends a fight only when the fight is already lost.
  const burning = !!(bot.entity.metadata?.[0] & 1);
  if (handler.passive) return standing && !burning && bot.health >= 10 && bot.food >= 6;
  if (burning && bot.health < 10) return false;
  // A fight is only worth starting if the health spent in it can come back.
  // Below eighteen hunger with nothing to eat, regeneration is off: the
  // bot left its pocket at fifteen health and seventeen hunger, took on a
  // spawner, and every point it lost was gone for good. Without food the
  // right fight is the walk home for some.
  if (bot.food < 18 && !hasFood(bot)) return false;
  // Fourteen in full armour: eighteen was a bar the Nether could not meet
  // once the food ran out, and the wait for it never ends without regen.
  //
  // The armour is what has to be on; the hand is whatever the last action
  // needed. Requiring a sword in hand here meant that drawing the bow, or
  // placing one block, made the bot unfit to fight, and "unfit to fight"
  // is a half-second doze in the open. Two blazes shot it through five
  // rounds of that: thirty-four damage, one death, and the bow it was
  // holding was the reason it would not swing.
  return standing && bot.health >= HUNT_FLOOR && bot.food >= HUNT_FLOOR && kitReady(bot);
}

// A blaze hovers, so there is no standing room within two blocks of it: the
// route check refused every fight, the survival layer sealed the bot in
// instead, and three arena runs ended with no swing and no rod. The ground
// under it is reachable and a sword reaches three blocks, so standing
// beneath and swinging up is the second thing to try.
function approaches(bot, target) {
  const t = target.position, y = Math.round(bot.entity.position.y);
  const under = new goals.GoalNear(Math.floor(t.x), y, Math.floor(t.z), 1);
  const level = new goals.GoalNear(Math.floor(t.x), Math.round(t.y), Math.floor(t.z), 2);
  // Following a thing that is flying means towering up to it, and a tower
  // is a place to fall off. The one death in forty-five arena runs was not
  // a mob at all: the bot killed its blaze from the top of a pillar and
  // dropped twenty health's worth of blocks. Something overhead is reached
  // by standing under it.
  if (t.y > bot.entity.position.y + 1.5) return [under];
  // Something below is reached by going down to it. Standing on a fortress
  // roof, the only goal offered was a point at the bot's own height, which
  // it was already standing on: the route "succeeded" without moving, so
  // the fight never started and the live run watched blazes through the
  // floor for an hour.
  if (t.y < bot.entity.position.y - 1.5) return [level, under];
  return [new goals.GoalFollow(target, 2), under];
}
// `movement` is the combat movement policy, whose `allowed` vets each step;
// the survey itself runs on the pathfinder's own movements. Passing one for
// the other threw "undefined is not a function" in the middle of a fight.
async function combatRoute(bot, task, target, movement, timeoutMs = 400) {
  for (const destination of approaches(bot, target)) {
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, timeoutMs);
    if (route.status === 'success' && route.path.every(movement.allowed)) return { route, destination };
  }
  return null;
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
  const ready = () => handler.passive ? bot.health >= 8 && bot.food >= 4 : bot.health >= 12 && bot.food >= 12 && kitReady(bot);
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
      // A fireball in the air outranks everything else for half a second.
      if (!canStrike(bot, target) && await deflect(bot, task)) continue;
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
        const approach = await combatRoute(bot, task, target, movement);
        if (!approach) throw new Error(`No dry combat route to ${target.name}`);
        const destination = approach.destination;
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
    setAside(goal, 'hunt_target', target.uuid || target.id, result.outcome, 120000);
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
  // The hunt's claim on this kind of mob, renewed on every tick it is live.
  // It has to be staked here, first in the loop: staking it where the fight
  // runs was useless, because the survival layer sealed the bot in before
  // that code was ever reached, so the claim was never made and the blazes
  // stayed an emergency. Chicken, egg.
  bot._huntingEntity = { name: state.entity, until: Date.now() + 5000 };
  if (!canBegin(bot, handler)) return false;
  const candidates = Object.values(bot.entities).filter(e => e.name === state.entity && valid(bot, e) &&
    e.position.distanceTo(bot.entity.position) < 24 && isolated(bot, e, handler) &&
    !isSetAside(goal, 'hunt_target', e.uuid || e.id)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  const tree = {}, positions = new Map();
  for (const target of candidates.slice(0, 4)) {
    const restore = encounter(bot, task, target, Date.now() + 1500), movement = combatMovement(bot);
    try {
      if (!canStrike(bot, target) && !await combatRoute(bot, task, target, movement)) continue;
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
    for (const target of candidates) setAside(goal, 'hunt_target', target.uuid || target.id, 'Jev chose to leave it for now', 120000); save();
  } };
  const snapshot = { request: goal.request, resource: state.item, need: state.targetCount - countOf(bot, state.item), health: bot.health, food: bot.food, dimension: dimension(bot) };
  let decision;
  if (client) {
    const controller = new AbortController();
    const watcher = setInterval(() => { if (task.cancelled || !canBegin(bot, handler)) controller.abort(new Error('Combat decision interrupted')); }, 100);
    // Fresh means the fight is still the one Jev was shown. Health equal to
    // the snapshot was the test, and a bot on fire loses health every second:
    // alight in a fortress, every answer came back stale and the bot stood
    // in the open asking again. A few points lost in flight still leaves the
    // same fight, and canBegin holds the floor.
    // With Jev unreachable the nearest candidate is fought: it passed the
    // same checks, and standing in a blaze's sight waiting for an answer is
    // the worse choice.
    try { decision = await decideTree(client, { state: snapshot, tree, signal: controller.signal, kind: 'combat', fallback: firstOption,
      isFresh: () => canBegin(bot, handler) && bot.health >= snapshot.health - 4 && candidates.every(e => !positions.has(e.id) ||
        valid(bot, e) && e.position.distanceTo(positions.get(e.id)) < 2 && isolated(bot, e, handler)) }); }
    catch (err) { task.check(); if (controller.signal.aborted) return false; throw err; }
    finally { clearInterval(watcher); }
  } else decision = { path: [Object.keys(tree)[0]], action: Object.values(tree)[0] };
  task.check(); checkAir(bot);
  if (client && !decision.stale) announceFallback(bot, goal, decision);
  goal.decisions ||= []; goal.decisions.push({ at: new Date().toISOString(), state: snapshot, path: decision.path,
    options: JSON.parse(JSON.stringify(tree)), latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments, stale: decision.stale, fallback: decision.fallback });
  goal.decisions = goal.decisions.slice(-40); save();
  if (decision.stale) return false;
  await decision.action.run();
  return decision.path[0] !== 'defer';
}

// Cover the hunt raised stays up for a minute: the door rule is kept off
// it, or the two dig and build the same cell in turn.
const COVER_KEPT_MS = 60000;
function keepCover(state, cell) {
  if (!cell) return false;
  if (cell.offset) {
    const now = Date.now();
    state.cover = [...(state.cover || []).filter(c => c.until > now), ...[cell, cell.offset(0, 1, 0)].map(p => ({ key: `${p}`, until: now + COVER_KEPT_MS }))].slice(-8);
  }
  return true;
}
const coverKept = state => (state.cover || []).filter(c => c.until > Date.now()).map(c => c.key);

async function prepareMobHunt(bot, task, step, goal, save, actions) {
  const handler = handlers[step.entity];
  if (!handler || handler.item !== step.item) throw blocked(`Unsupported mob source ${step.entity} for ${step.item}`);
  if (bot.game.difficulty === 'peaceful') throw blocked(`${step.entity} does not spawn in Peaceful; cannot obtain ${step.item} by hunting here`);
  const previous = goal.mobHunt;
  goal.mobHunt = { ...(previous?.item === step.item ? previous : {}), item: step.item, entity: step.entity,
    targetCount: countOf(bot, step.item) + step.count };
  goal.stockFood = true; save();
  // While this runs, mobs of this kind are the hunt's business and not the
  // survival layer's emergency. Refreshed every tick; it lapses in seconds.
  bot._huntingEntity = { name: step.entity, until: Date.now() + 5000 };
  // A drop on the floor is a drop not carried. The arena killed a blaze and
  // scored nothing three times over because the rod lay where it fell: the
  // fight's own pickup only runs when the fight's own code did the killing.
  if (await collectNearbyDrops(bot, task, step.item, { radius: 12, timeoutMs: 5000, move: actions.navigate })) {
    goal.step = { action: 'collect_drop', item: step.item, carried: countOf(bot, step.item) }; save(); return;
  }
  // A rod on a floor the bot is standing on top of cannot be walked to. The
  // spawner drill killed all four blazes for no damage and came home with
  // nothing, because the drops were in the chamber and the bot was on its
  // roof. Where the walk fails and the drop is below, go down after it.
  const below = Object.values(bot.entities || {}).find(e => e.getDroppedItem?.()?.name === step.item &&
    e.position && e.position.distanceTo(bot.entity.position) < 24 && e.position.y < bot.entity.position.y - 2);
  if (below) {
    goal.step = { action: 'down_for_the_drop', item: step.item, drop: Math.round(bot.entity.position.y - below.position.y) }; save();
    try { if (await descendTo(bot, task, below.position, { arriveWith: HUNT_FLOOR }) >= 1) return; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; goal.mobHunt.lastDescentError = err.message; }
  }
  if (!handler.passive && !await prepareCombatGear(bot, task, goal, save, actions)) return;
  if (handler.dimension && dimension(bot) !== handler.dimension) { await actions.enterNether(bot, task, goal, save); return; }
  // Fit in every way but where it stands (a slab, a fence top, a ceiling at
  // the head): waiting was the answer to all of canBegin, and waiting does
  // not change the footing. It stood recovering at full health on a
  // fortress roof. The stalk below moves it; a fight begins wherever that
  // lands on dry ground.
  const fitButFooting = !handler.passive && !canBegin(bot, handler) && bot.health >= HUNT_FLOOR && bot.food >= HUNT_FLOOR && kitReady(bot) &&
    bot.oxygenLevel > 12 && bot.game.gameMode === 'survival' && bot.game.difficulty !== 'peaceful' &&
    !(bot.entity.metadata?.[0] & 1 && bot.health < 10) && !(bot.food < 18 && !hasFood(bot));
  if (!canBegin(bot, handler) && !fitButFooting) {
    // Nothing to eat and hunger under eighteen means no regeneration: the
    // recovery never comes. Off the Overworld that is a trip back for food.
    if (bot.food < 18 && !hasFood(bot) && dimension(bot) !== 'overworld' && actions.returnOverworld) {
      goal.step = { action: 'return_for_food', health: bot.health, food: bot.food }; goal.stockFood = true; save();
      await actions.returnOverworld(bot, task, goal, save); return;
    }
    goal.step = { action: 'recover_before_combat', health: bot.health, food: bot.food, neededHealth: handler.passive ? 10 : 14, neededFood: handler.passive ? 6 : 14 }; save();
    // Not in the open, if something out there shoots. Health comes back at
    // the same rate behind a wall and the wall is free.
    const shooters = threats(bot, 24).filter(t => t.visible && shooter(t.entity));
    if (shooters.length && bot.health < 18) {
      const from = bunkerCentroid(shooters);
      // No wall within walking distance: build one. Two blocks placed where
      // the bot already stands beat nine blocks walked under fire.
      if (!nearWall(bot, from)) {
        goal.step = { action: 'take_cover', shooters: shooters.length, health: bot.health }; save();
        try { if (await raiseCover(bot, task, from)) { await sleep(400); return; } }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; goal.mobHunt.lastCoverError = err.message; }
        await sleep(500); task.check(); return;
      }
      goal.step = { action: 'dig_in_to_recover', shooters: shooters.length, health: bot.health }; save();
      try { await digBunker(bot, task, goal, save, { from, navigate: actions.navigate }); return; }
      // Why it could not dig in matters as much as that it did not: a
      // swallowed failure here reads, from outside, as a bot that simply
      // chose to stand in the open and be shot.
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; goal.mobHunt.lastBunkerError = err.message; save(); }
    }
    await sleep(500); task.check(); return;
  }
  // A mob already in view is stalked where it is: the observed-hunt check at
  // the top of the loop takes it the moment the route and the odds allow.
  // Exploring for it instead climbed to the surface every time a cave spider
  // showed, and the diamond shaft was dug and left three times in a row.
  // A mob that stays out of reach for a minute is set aside for two.
  // Everything above reads `goal.mobHunt` by name: `state` is declared here,
  // and a reference to it earlier in this function is a temporal-dead-zone
  // crash, which is what "Cannot access 'state' before initialization"
  // was, thrown out of the recovery branch on every tick the bot was hurt.
  const state = goal.mobHunt;
  const near = Object.values(bot.entities || {}).filter(e => e.name === step.entity && e.isValid !== false &&
    !isSetAside(goal, 'hunt_target', e.uuid || e.id) && e.position.distanceTo(bot.entity.position) < 32)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
  if (near) {
    if (goal.fortressSearch) goal.fortressSearch.patrols = 0;
    rememberSighting(state, bot, near);
    if (countOf(bot, step.item) > (state.watchedWith ?? -1)) { delete state.watchingSince; state.watchedWith = countOf(bot, step.item); }
    // A spawner's worth of blazes is fought from a bunker, not in the open:
    // dig in beside them and take them at the door.
    // Hurt, not merely outnumbered. Held at the door the bot took nine
    // damage and got no rods in two runs, because blazes hover out of reach
    // of a doorway; fought in the open at full health it got two.
    // Two shooters at different angles cannot both be kept inside one
    // shield arc, and the arena charged twenty-six health a pair to prove
    // it. They are met at a tunnel mouth instead, where they have to arrive
    // one at a time. A single one is still fought in the open, which now
    // costs nothing at all.
    const inView = threats(bot, 24).filter(t => t.entity.name === step.entity && t.visible).length;
    // A wall at hand, not a wall somewhere. Sent to find one nine blocks
    // off, the bot took forty-one damage crossing the room and arrived with
    // nothing; fighting where it stood cost twenty-six.
    const cornered = handler.ranged && (inView >= 2 || (swarm(bot) && bot.health < 16));
    // A spawner keeps three or more in the air, and three of a kind in view
    // means none of them is isolated enough to fight: the live run stood
    // eight blocks from a fortress spawner watching blazes, one second at a
    // time, and took nothing home. With no wall to back into, build one.
    // Behind it most of them are out of sight, the rest have to come round,
    // and a fight the bot can actually start is worth more than a tidy
    // reason not to.
    if (cornered && !nearWall(bot, near.position) && !isSetAside(goal, 'hunt_cover', step.entity) &&
        !(state.stairsTo && state.stairsTo.until > Date.now())) {
      goal.step = { action: 'break_their_line', entity: step.entity, inView, health: bot.health }; save();
      try { if (keepCover(state, await raiseCover(bot, task, near.position))) { await sleep(300); return; } }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; state.lastCoverError = err.message; }
      setAside(goal, 'hunt_cover', step.entity, state.lastCoverError || 'no cover could be raised', 60000); save();
    }
    if (cornered && nearWall(bot, near.position) && !isSetAside(goal, 'hunt_bunker', step.entity)) {
      goal.step = { action: 'take_the_door', entity: step.entity, inView, health: bot.health }; save();
      // A hold that ends quietly with nothing gained is a failure too: the
      // arena measured the door at zero rods, and without a cooldown the
      // bot walked straight back into the same bunker for another two
      // minutes.
      try {
        if (!await bunkerFight(bot, task, goal, save, actions, { item: step.item, want: countOf(bot, step.item) + 1 })) { setAside(goal, 'hunt_bunker', step.entity, 'held the door and gained nothing', 120000); save(); }
        return;
      }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'hunt_bunker', step.entity, err, 120000); state.lastBunkerError = err.message; save(); }
    }
    const key = near.uuid || near.id;
    if (!state.stalking || state.stalking.key !== key) state.stalking = { key, since: Date.now() };
    const distance = near.position.distanceTo(bot.entity.position);
    goal.step = { action: 'stalk_mob', entity: step.entity, distance: Number(distance.toFixed(1)) }; save();
    // The supervisor: three quarters of a minute without getting any closer
    // sets the mob aside. A fixed timer set aside mobs the bot was closing on.
    if (watch(goal, 'hunt_target', key, distance, { stallMs: 45000, restMs: 120000, why: 'no closer in three quarters of a minute' }).stalled) { delete state.stalking; save(); }
    // A mob seen far off is closed on, not watched: a blaze at twenty-nine
    // blocks was stood in front of for sixteen persistence rounds while the
    // observed-hunt check, which looks within twenty-four, never saw it.
    if (distance > 10 && actions.navigate) {
      const from = bot.entity.position.clone();
      // The mob being closed on is the encounter for the walk: without
      // that, the threat check saw the blaze at sixteen blocks and the bot
      // fled the thing it was hunting.
      const restore = encounter(bot, task, near, Date.now() + 20000);
      try { await actions.navigate(bot, task, new goals.GoalNear(near.position.x, near.position.y, near.position.z, 8), { timeoutMs: 20000, stallMs: 5000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      finally { restore(); }
      // No way to it (a blaze on a wall across the lava): set it aside and
      // walk the fortress; the walk brings another into reach.
      if (bot.entity.position.distanceTo(from) < 1.5) {
        setAside(goal, 'hunt_target', key, 'no way to it', 120000); unwatch(goal, 'hunt_target', key); delete state.stalking; save();
        if (handler.dimension === 'nether' && actions.tunnel) { await findFortressStep(bot, task, goal, save, actions); }
      }
      return;
    }
    // Digging toward them, a step a tick, until they are within a sword.
    //
    // Not only downward, and not once every fifteen seconds. Level with the
    // blazes at last, the live bot sat in the one-block-high hole its own
    // descent had left: the ceiling of that hole blocked every line of
    // sight, so nothing was visible, nothing was a candidate, and it opened
    // one door a quarter of a minute and never moved. The staircase cuts a
    // passage the bot's own height and keeps cutting.
    const stairs = state.stairsTo;
    const target = stairs && new Vec3(stairs.x, stairs.y, stairs.z);
    if (stairs && stairs.until > Date.now() && actions.tunnel && target.distanceTo(bot.entity.position) > 3.5) {
      goal.step = { action: 'dig_toward_them', entity: step.entity, to: { x: stairs.x, y: stairs.y, z: stairs.z },
        away: Math.round(target.distanceTo(bot.entity.position)) }; save();
      try { await actions.tunnel(bot, task, goal, save, target, 'approach'); return; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastStairsError = err.message; save(); }
    } else if (stairs && (stairs.until <= Date.now() || target.distanceTo(bot.entity.position) <= 3.5)) { delete state.stairsTo; save(); }
    // Watching, not fighting. The observed hunt takes a target the moment it
    // is allowed to; a stalk that has watched the same mob for fifteen
    // seconds is not waiting for an opening, it is stuck.
    state.watchingSince ||= Date.now();
    if (Date.now() - state.watchingSince > 15000) {
      state.watchingSince = Date.now();
      state.watchFails = (state.watchFails || 0) + 1;
      // Change the situation, not the target. Setting the mob aside was
      // itself the bug: with a spawner room full of blazes the bot avoided
      // one every fifteen seconds until it had avoided all twelve and had
      // nothing left to hunt. Cover breaks their line and makes them come
      // round it, which is the thing that was missing.
      // Below and behind rock: go through the floor. A fortress roof is two
      // blocks of nether brick with the spawner room under it, and no amount
      // of walking round the outside ever reaches that.
      // Out of reach and watched too long: dig to it, whatever the reason
      // the walk did not work. Set here so the passage is cut a step a tick
      // by the branch above rather than a step every fifteen seconds.
      if (near.position.distanceTo(bot.entity.position) > 3.5) {
        state.stairsTo = { x: Math.floor(near.position.x), y: Math.floor(near.position.y), z: Math.floor(near.position.z), until: Date.now() + 90000 }; save();
      }
      const dy = near.position.y - bot.entity.position.y;
      // Two below counts: at exactly two the old test was one block short,
      // and the bot sat four blocks from the blazes' level building cover
      // on its own floor, which does nothing about a mob beneath it.
      if (dy <= -1.5) {
        goal.step = { action: 'dig_down_to_them', entity: step.entity, drop: Math.round(-dy) }; save();
        // What the descent saw and did, kept on the hunt: eight attempts
        // live and the bot's height never changed, and nothing recorded why.
        const feet = bot.entity.position.floored();
        const column = [-1, -2, -3, -4].map(d => bot.blockAt(feet.offset(0, d, 0))?.name || '?');
        try {
          const dropped = await descendTo(bot, task, near.position, { arriveWith: HUNT_FLOOR });
          state.lastDescent = { at: Date.now(), dropped, from: { ...feet }, column, health: bot.health }; save();
          if (dropped >= 1) return;
        }
        catch (err) {
          task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
          state.lastDescentError = err.message; state.lastDescent = { at: Date.now(), error: err.message, from: { ...feet }, column }; save();
          // A one-block roof over a room too deep to drop into: the live bot
          // stood on [netherrack, air, air, air] refusing the fall for an
          // hour. The staircase digs down through the rock beside the room
          // and comes in at floor level, a step a tick, until level with them.
          if (/too deep|lava/.test(err.message) && actions.tunnel) {
            state.stairsTo = { x: Math.floor(near.position.x), y: Math.floor(near.position.y), z: Math.floor(near.position.z), until: Date.now() + 60000 }; save();
          }
        }
      }
      // Level with them and something between: a door toward them, before
      // any wall. Cover is for a target that can see the bot, not one it
      // has already fenced itself off from.
      // Cover and doors are for a mob already in reach. While a shaft is
      // being dug at them, cover placed "one step toward them" goes into the
      // very cell the shaft is about to dig: the live bot got to within four
      // blocks, walled its own tunnel shut, dug it open, walled it again.
      const digging = state.stairsTo && state.stairsTo.until > Date.now();
      if (Math.abs(dy) <= 1.5 && !digging) {
        goal.step = { action: 'open_a_door', entity: step.entity }; save();
        try { if (await openToward(bot, task, near.position, { spare: coverKept(state) })) { await sleep(300); return; } }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
        goal.step = { action: 'break_their_line', entity: step.entity, watched: state.watchFails }; save();
        try { if (keepCover(state, await raiseCover(bot, task, near.position))) { await sleep(300); return; } }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      }
      if (state.watchFails >= 3) {
        setAside(goal, 'hunt_target', key, 'watched three times without getting anywhere', 120000); unwatch(goal, 'hunt_target', key); delete state.stalking; state.watchFails = 0; save();
        bot.chat?.(`Watching ${step.entity.replaceAll('_', ' ')}s and getting nowhere. Trying another angle.`);
      }
      return;
    }
    await sleep(1000); return;
  }
  delete state.stalking;
  // Where the blazes were last seen is where they will be again: a spawner
  // keeps its room full. After a death the bot swept from the portal as if
  // it had never been there. Head back to the freshest sighting first.
  const spot = rememberedSpot(state, bot);
  if (spot && actions.navigate) {
    spot.triedAt = Date.now(); spot.tries = (spot.tries || 0) + 1; save();
    goal.step = { action: 'return_to_blazes', target: { x: spot.x, y: spot.y, z: spot.z }, seen: spot.seen }; save();
    const from = bot.entity.position.clone();
    try { await actions.navigate(bot, task, new goals.GoalNear(spot.x, spot.y, spot.z, 6), { timeoutMs: 60000, stallMs: 10000 }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    if (bot.entity.position.distanceTo(from) < 2 && actions.tunnel) {
      try { await actions.tunnel(bot, task, goal, save, new Vec3(spot.x, spot.y, spot.z), 'fortress'); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    return;
  }
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

// Sightings of the hunted mob, clustered within sixteen blocks, newest
// first; a cluster seen many times is a spawner.
function rememberSighting(state, bot, entity) {
  const p = entity.position, dimension = bot.game?.dimension;
  state.sightings ||= [];
  const near = state.sightings.find(s => s.dimension === dimension && Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) < 16);
  if (near) { Object.assign(near, { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), at: Date.now(), seen: (near.seen || 1) + 1 }); }
  else state.sightings.unshift({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), dimension, at: Date.now(), seen: 1 });
  state.sightings = state.sightings.slice(0, 12);
}
// The freshest sighting in this dimension worth walking back to: not one
// just tried, not one the bot is already at, not one given up on.
function rememberedSpot(state, bot) {
  const here = bot.entity.position, dimension = bot.game?.dimension;
  return (state.sightings || []).filter(s => s.dimension === dimension && (s.tries || 0) < 4 && !(s.triedAt > Date.now() - 180000) &&
    Math.hypot(s.x - here.x, s.z - here.z) > 12 && Math.hypot(s.x - here.x, s.y - here.y, s.z - here.z) < 400)
    .sort((a, b) => (b.seen - a.seen) || (b.at - a.at))[0] || null;
}

const FORTRESS_MIN_BRICKS = 24;
const FORTRESS_BLOCKS = ['nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_brick_slab', 'nether_wart'];
const FORTRESS_LEG = 96;
// The next leg of the sweep: ninety-six blocks along x, one way, at a
// height between the lava sea and the ceiling.
// Legs run along x until a direction will not give; then the sweep turns.
const HEADINGS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function fortressLegTarget(state, position) {
  const y = Math.max(40, Math.min(80, Math.round(position.y)));
  const [dx, dz] = Number.isInteger(state.heading) ? HEADINGS[state.heading % 4] : [state.axis, 0];
  return new Vec3(Math.round(position.x + FORTRESS_LEG * dx), y, Math.round(position.z + FORTRESS_LEG * dz));
}
// A direction the sweep cannot make ground in for several ticks is given
// up for the next one round the compass: a leg toward an open cavern had
// the staircase shuffling along one ledge.
function turnSweep(state) {
  const current = Number.isInteger(state.heading) ? state.heading : (state.axis === -1 ? 2 : 0);
  state.heading = (current + 1) % 4; state.legFails = 0; delete state.target;
}
async function findFortressStep(bot, task, goal, save, actions) {
  const state = goal.fortressSearch ||= { axis: Math.round(bot.entity.position.x) % 2 === 0 ? 1 : -1, legs: 0 };
  const ids = FORTRESS_BLOCKS.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  // Bricks near a face that would not be approached are ignored for ten
  // minutes: the fortress was straight below a shelf with a cave between,
  // and every tick tried the same drop. The sweep meets it elsewhere.
  state.shunned = (state.shunned || []).filter(sh => sh.until > Date.now());
  const shunned = b => state.shunned.some(sh => Math.hypot(sh.x - b.x, sh.z - b.z) <= 16);
  // A fortress is hundreds of bricks. A handful is the bot's own: it
  // carries nether bricks and builds its pockets and bridges with them, and
  // the sweep "patrolled" three of its own blocks while starting a new leg
  // every tick, four hundred of them, never old enough to turn.
  const found = bot.findBlocks({ matching: ids, maxDistance: 128, count: 512 }).filter(b => !shunned(b));
  const bricks = found.length >= FORTRESS_MIN_BRICKS ? found : [];
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
          if (nearest.distanceTo(bot.entity.position) < nearest.distanceTo(from) - 1.5) { state.approachFails = 0; return; }
        }
      }
      // Above the structure with a gap between: straight down through the
      // shelf, when the landing is solid and close.
      const above = bot.entity.position;
      if (Math.hypot(nearest.x + 0.5 - above.x, nearest.z + 0.5 - above.z) <= 12 && nearest.y < above.y - 2) {
        goal.step = { action: 'find_fortress', found: state.found, descending: true, legs: state.legs }; save();
        try { if (await descendTo(bot, task, nearest) >= 1) { state.approachFails = 0; return; } }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastDescentError = err.message; }
      }
      // Across open air, level with the structure or above it: lay a span
      // straight at it. The pathfinder bridged a block a minute here.
      const flatGap = Math.hypot(nearest.x + 0.5 - above.x, nearest.z + 0.5 - above.z);
      if (flatGap > 1.5 && flatGap <= 64 && nearest.y <= above.y) {
        goal.step = { action: 'find_fortress', found: state.found, bridging: true, legs: state.legs }; save();
        const from = bot.entity.position.clone();
        try { await bridgeTo(bot, task, nearest, { maxBlocks: 64 }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastBridgeError = err.message; }
        if (nearest.distanceTo(bot.entity.position) < nearest.distanceTo(from) - 1.5) { state.approachFails = 0; return; }
      }
      const gapBefore = nearest.distanceTo(bot.entity.position);
      try { await actions.tunnel(bot, task, goal, save, nearest, 'fortress'); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      // Closer counts; a shuffle along the shelf does not.
      if (nearest.distanceTo(bot.entity.position) < gapBefore - 1.5) { state.approachFails = 0; return; }
      state.approachFails = (state.approachFails || 0) + 1;
      if (state.approachFails >= 6) {
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
    // Every stretch in view walked: patrol it again, blazes spawn as time
    // passes and the walk brings them into view; the sweep left the
    // structure for the lava shore after one pass. Six empty patrols and
    // the sweep goes on along the fortress's own axis to the next section.
    // Nothing twelve blocks off to walk to, walked or not: this is not a
    // stretch of fortress to patrol but a few bricks (the bot's own pocket
    // walls, often) or a corner seen through rock. Patrolling it was a
    // return that did nothing, six times over, then a fresh leg that the
    // next look undid: twenty seconds still, again and again. It is shunned
    // like an unapproachable face, and the sweep goes on.
    if (!next && !walkable.some(b => b.distanceTo(here) >= 12)) {
      state.shunned.push({ x: nearest.x, z: nearest.z, until: Date.now() + 600000 }); delete state.found; state.patrols = 0; save();
    }
    else if (!next) {
      state.patrols = (state.patrols || 0) + 1;
      if (state.patrols <= 6) {
        state.visited = state.visited.slice(-2);
        if (!(state.patrolSaidAt > Date.now() - 120000)) { state.patrolSaidAt = Date.now(); bot.chat?.('Walked this stretch. Patrolling the fortress for blazes.'); }
        return;
      }
      state.patrols = 0; delete state.target; state.heading = 1; state.visited = [];
    }
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
    const next = fortressLegTarget(state, here); state.target = { x: next.x, y: next.y, z: next.z }; state.legs++; state.legSince = Date.now();
  }
  goal.step = { action: 'find_fortress', target: state.target, legs: state.legs }; save();
  const leg = new Vec3(state.target.x, state.target.y, state.target.z);
  const flat = p => Math.hypot(leg.x - p.x, leg.z - p.z);
  const before = flat(here);
  // The pathfinder first: it walks open ground, bridges and climbs where a
  // staircase can only dig. The tunnel takes over where it finds no way.
  if (actions.navigate) {
    try { await actions.navigate(bot, task, new goals.GoalNearXZ(leg.x, leg.z, 6), { timeoutMs: 30000, stallMs: 8000 }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    if (flat(bot.entity.position) < before - 6) { state.legFails = 0; return; }
  }
  try { await actions.tunnel(bot, task, goal, save, leg, 'fortress'); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastLegError = err.message; }
  if (flat(bot.entity.position) < before - 1.5) { state.legFails = 0; return; }
  // Four failures and twenty seconds: a leg whose every attempt fails at
  // once turned the compass four times in half a minute.
  if (++state.legFails >= 4 && Date.now() - (state.legSince || 0) >= 20000) {
    turnSweep(state); save();
    if (!(state.turnSaidAt > Date.now() - 60000)) { state.turnSaidAt = Date.now(); bot.chat?.('No way on in this direction. Turning the search.'); }
  }
}

module.exports = { prepareCombatGear, combatMovement, canBegin, isolated, fightForDrop, huntObserved, prepareMobHunt, findFortressStep, fortressLegTarget, turnSweep, rememberSighting, rememberedSpot, approaches, combatRoute, FORTRESS_LEG };
