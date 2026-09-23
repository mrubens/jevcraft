'use strict';
const { setAside, isSetAside, attemptsFor } = require('./progress');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { dryPassable, damagingTerrain, swimmableWater, waterLevel } = require('./terrain');
const { safeFromHostiles, immediateThreat } = require('./danger');
const { navigate, surveyRoute, countOf } = require('./skills');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const point = p => new Vec3(p.x, p.y, p.z);
const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const boatItem = name => /_boat$|^bamboo_raft$/.test(name) && !/chest/.test(name);
const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LIMITS = Object.freeze({ minimumWater: 16, radius: 80, nodes: 10000, tripMs: 90000 });

// Only level source water with room for the entire boat AND rider. Unknown
// chunks, currents, bubble columns, low bridges and dangerous banks are not
// navigable guesses. A boat is 1.375 blocks wide; sample every occupied cell.
function boatWater(bot, position, waterY) {
  if (Object.values(bot.entities || {}).some(e => e !== bot.vehicle && e !== bot.entity && e.isValid !== false && e.position &&
    (boatItem(e.name || '') || e.username || e.type === 'mob') && Math.abs(e.position.y - (waterY + .6)) < 1.5 &&
    Math.abs(e.position.x - position.x) < .69 + (e.width || 1.375) / 2 && Math.abs(e.position.z - position.z) < .69 + (e.width || 1.375) / 2)) return false;
  for (let x = Math.floor(position.x - .69); x <= Math.floor(position.x + .69); x++) {
    for (let z = Math.floor(position.z - .69); z <= Math.floor(position.z + .69); z++) {
      const water = bot.blockAt(new Vec3(x, waterY, z));
      if (!swimmableWater(water) || waterLevel(water) !== 0 ||
        !dryPassable(bot.blockAt(new Vec3(x, waterY + 1, z))) || !dryPassable(bot.blockAt(new Vec3(x, waterY + 2, z))) ||
        damagingTerrain.has(bot.blockAt(new Vec3(x, waterY - 1, z))?.name)) return false;
    }
  }
  return true;
}

function dockNear(bot, water, waterY) {
  for (const [dx, dz] of directions) for (const distance of [2, 3]) {
    const stand = new Vec3(Math.floor(water.x) + dx * distance, waterY + 1, Math.floor(water.z) + dz * distance);
    const floor = bot.blockAt(stand.offset(0, -1, 0));
    if (floor?.boundingBox !== 'block' || damagingTerrain.has(floor.name) ||
      !dryPassable(bot.blockAt(stand)) || !dryPassable(bot.blockAt(stand.offset(0, 1, 0))) || !safeFromHostiles(bot, stand)) continue;
    // The short swim out must not cross a wall, drop or waterfall.
    let clear = true;
    for (let i = 1; i < distance; i++) {
      const p = water.offset(dx * i, 0, dz * i);
      const b = bot.blockAt(p);
      if (!swimmableWater(b) || waterLevel(b) !== 0 || !dryPassable(bot.blockAt(p.offset(0, 1, 0)))) clear = false;
    }
    if (clear) return stand;
  }
  return null;
}

async function surveyBoatTrip(bot, task, destination) {
  if (!bot.blockAt || bot.game?.dimension?.includes('nether') || bot.vehicle ||
    bot.health < 16 || bot.food < 10 || immediateThreat(bot)) return null;
  const start = bot.entity.position, target = point(destination);
  if (flatDistance(start, target) < LIMITS.minimumWater) return null;
  const levels = [...new Set([Math.floor(start.y) - 1, Math.floor(start.y), Math.floor(start.y) - 2])];
  let best;
  for (const y of levels) {
    const candidates = [];
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
      const p = new Vec3(Math.floor(start.x) + dx + .5, y, Math.floor(start.z) + dz + .5);
      if (flatDistance(p, start) <= 7 && boatWater(bot, p, y)) {
        const dock = dockNear(bot, p, y);
        if (dock && dock.distanceTo(start) < 9) candidates.push({ water: p, dock });
      }
    }
    candidates.sort((a, b) => a.dock.distanceTo(start) - b.dock.distanceTo(start));
    for (const entry of candidates.slice(0, 2)) {
      const route = await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalBlock(entry.dock.x, entry.dock.y, entry.dock.z), 300);
      if (route.status !== 'success' || route.path?.some(p => p.toBreak?.length || p.toPlace?.length)) continue;
      const key = p => `${Math.floor(p.x)},${Math.floor(p.z)}`;
      const queue = [{ p: entry.water, parent: -1, distance: 0 }], visited = new Set([key(entry.water)]);
      let selected;
      for (let i = 0; i < queue.length && i < LIMITS.nodes; i++) {
        if (i % 128 === 0) { task.check(); await sleep(0); }
        const node = queue[i];
        if (node.distance >= LIMITS.minimumWater) {
          const landing = dockNear(bot, node.p, y), progress = landing && flatDistance(start, target) - flatDistance(landing, target);
          if (landing && progress >= 12 && node.distance <= progress * 2 + 12 && safeFromHostiles(bot, node.p) &&
            (!selected || progress - node.distance * .15 > selected.score)) selected = { index: i, landing, score: progress - node.distance * .15, progress };
        }
        for (const [dx, dz] of directions) {
          const next = node.p.offset(dx, 0, dz), k = key(next);
          if (visited.has(k)) continue;
          visited.add(k);
          if (flatDistance(next, start) > LIMITS.radius || !boatWater(bot, next, y)) continue;
          queue.push({ p: next, parent: i, distance: node.distance + 1 });
        }
      }
      if (selected) {
        const path = []; for (let i = selected.index; i >= 0; i = queue[i].parent) path.unshift(queue[i].p);
        const trip = { entry: entry.dock, landing: selected.landing, waterY: y, path, length: path.length - 1, progress: selected.progress };
        if (!best || selected.score > best.score) best = { ...trip, score: selected.score };
      }
      if (best) break;
    }
    if (best) break;
  }
  return best || null;
}

async function chooseBoat(client, state) {
  const response = await require('./decisions').ask(client, { state, questions: { travel: ['boat_crossing'] }, signal: AbortSignal.timeout(5000) });
  return response;
}

// Mineflayer suspends all player physics while mounted but does not simulate
// boats. This is the ordinary Java client vehicle controller for flat water:
// 20Hz, .9 drag, .04 forward/.005 reverse acceleration, inertial turning and
// .04 gravity with water buoyancy. It never moves onto land, through a solid,
// into unreceived chunks or faster than the game's ordinary paddling speed.
function boatTick(state, input, waterLevel) {
  const friction = Math.fround(.9);
  const rotation = state.rotation * friction + (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const yaw = state.yaw + rotation;
  const thrust = (input.forward ? Math.fround(.04) : 0) - (input.backward ? Math.fround(.005) : 0) +
    (!input.forward && !input.backward && input.left !== input.right ? Math.fround(.005) : 0);
  const vx = state.vx * friction - Math.sin(yaw * Math.PI / 180) * thrust;
  const vz = state.vz * friction + Math.cos(yaw * Math.PI / 180) * thrust;
  const submerged = Math.max(0, (waterLevel - state.y) / .5625);
  const vy = (state.vy - .04 + submerged * .04 / .65) * (submerged > 0 ? .75 : 1);
  return { x: state.x + vx, y: state.y + vy, z: state.z + vz, vx, vy, vz, yaw, rotation };
}
const angleDifference = (wanted, actual) => ((wanted - actual + 540) % 360 + 360) % 360 - 180;

async function awaitState(task, predicate, duration = 4000) {
  const deadline = Date.now() + duration;
  while (!predicate()) { task.check(); if (Date.now() > deadline) throw new Error('Boat action was not confirmed by the server'); await sleep(50); }
}

async function leaveBoat(bot) {
  if (!bot.vehicle) return;
  bot._client.write('steer_boat', { leftPaddle: false, rightPaddle: false });
  // Modern Java dismount is sneak, not jump (Mineflayer 4.39 sends jump).
  if (bot.supportFeature('newPlayerInputPacket')) bot._client.write('player_input', { inputs: { shift: true } });
  else bot.dismount();
  const deadline = Date.now() + 2500;
  while (bot.vehicle && Date.now() < deadline) await sleep(50);
  if (bot.supportFeature('newPlayerInputPacket')) bot._client.write('player_input', { inputs: {} });
  if (bot.vehicle) throw new Error('Boat dismount was not confirmed by the server');
}

async function clearOwnedBoatAtFeet(bot, task) {
  if (bot.vehicle || !bot._ownedBoats?.size) return;
  for (const boat of Object.values(bot.entities || {})) {
    if (!bot._ownedBoats.has(boat.uuid) || boat.passengers?.length || boat.position.distanceTo(bot.entity.position) > 2) continue;
    await bot.lookAt?.(boat.position.offset(0, .3, 0), true);
    for (let n = 0; n < 12 && bot.entities[boat.id] === boat; n++) { task.check(); bot.attack(boat); await sleep(300); }
    if (bot.entities[boat.id] === boat) throw new Error('Our empty boat is still blocking the walking route');
    bot._ownedBoats.delete(boat.uuid);
    if (bot.setControlState && bot.blockAt) await floatAfterBoat(bot, task, Math.floor(boat.position.y));
  }
}

async function floatAfterBoat(bot, task, waterY) {
  const deadline = Date.now() + 5000;
  // Picking up the boat can put our feet below the surface. The walking graph
  // cannot climb a column of deep water, so use ordinary swim-up controls first.
  bot.clearControlStates();
  try {
    while (bot.entity.position.y < waterY + .15) {
      task.check();
      const p = bot.entity.position;
      if (Date.now() >= deadline || !swimmableWater(bot.blockAt(new Vec3(p.x, waterY, p.z))) ||
        !dryPassable(bot.blockAt(new Vec3(p.x, waterY + 1, p.z)))) throw new Error('Cannot swim safely to the surface after leaving the boat');
      bot.setControlState('jump', true); await sleep(50);
    }
  } finally { bot.clearControlStates(); }
}

async function paddle(bot, task, boat, trip, report = () => {}) {
  const deadline = Date.now() + LIMITS.tripMs;
  let corrected = false;
  const correction = () => { corrected = true; };
  bot._client.on('vehicle_move', correction);
  let state = { ...boat.position, vx: 0, vy: 0, vz: 0, yaw: (Math.PI - (boat.yaw || 0)) * 180 / Math.PI, rotation: 0 };
  let index = 0, ticks = 0, lastProgress = Date.now();
  try {
    while (true) {
      task.check();
      if (bot.vehicle !== boat || boat.isValid === false) throw new Error('Lost the boat while crossing');
      if (corrected) throw new Error('Server corrected boat movement; stopping to recheck the route');
      if (Date.now() > deadline || Date.now() - lastProgress > 8000) throw new Error('Boat route stopped making progress');
      const here = point(state), finish = trip.path.at(-1);
      if (flatDistance(here, finish) < 1.1 && Math.hypot(state.vx, state.vz) < .045) break;
      // Steering looks several cells ahead and can pass a corner without
      // touching every earlier cell. Recognize later nearby waypoints too;
      // otherwise the old waypoint keeps the boat circling behind its route.
      let reached = index - 1;
      const end = Math.min(index + 9, trip.path.length - 1);
      for (let j = index; j < end; j++) if (flatDistance(here, trip.path[j]) < 1.3) reached = j;
      if (reached >= index) { index = reached + 1; lastProgress = Date.now(); }
      // Look a few cells ahead, but never cut a corner through land.
      let aim = trip.path[index];
      for (let j = index + 1; j < Math.min(index + 5, trip.path.length); j++) {
        const candidate = trip.path[j], d = flatDistance(here, candidate);
        let clear = true;
        for (let step = .25; step <= d; step += .25) if (!boatWater(bot, here.plus(candidate.minus(here).scaled(step / d)), trip.waterY)) { clear = false; break; }
        if (!clear) break; aim = candidate;
      }
      const desired = Math.atan2(-(aim.x - state.x), aim.z - state.z) * 180 / Math.PI;
      const error = angleDifference(desired, state.yaw), control = error - state.rotation * 5;
      const distance = flatDistance(here, finish), speed = Math.hypot(state.vx, state.vz);
      const braking = distance < Math.max(1.5, speed * 10 + .8);
      const input = { left: control < -3, right: control > 3, forward: !braking && Math.abs(error) < 30, backward: braking && speed > .07 };
      const next = boatTick(state, input, trip.waterY + 8 / 9);
      if (!boatWater(bot, point(next), trip.waterY) || !safeFromHostiles(bot, point(next))) throw new Error('Boat route is blocked or unsafe');
      bot._client.write('player_input', { inputs: { forward: input.forward, backward: input.backward, left: input.left, right: input.right } });
      bot._client.write('steer_boat', { leftPaddle: input.forward || input.right, rightPaddle: input.forward || input.left });
      bot._client.write('vehicle_move', { x: next.x, y: next.y, z: next.z, yaw: next.yaw, pitch: 0, onGround: false });
      // Client prediction only while mounted, just as ordinary player physics
      // predicts walking. Server corrections abort; live tests use a second
      // client and server boat-distance stats as independent evidence.
      state = next;
      boat.position.set(next.x, next.y, next.z);
      bot.entity.position.set(next.x, next.y + .35, next.z);
      bot.entity.yaw = Math.PI - next.yaw * Math.PI / 180;
      if (++ticks % 20 === 0) report({ position: { ...bot.entity.position }, ticks });
      await sleep(50);
    }
  } finally { bot._client.removeListener('vehicle_move', correction); }
}

function preferredBoat(bot) {
  const items = bot.inventory.items();
  const carried = items.find(i => boatItem(i.name));
  if (carried) return carried.name;
  const boats = bot.registry.itemsArray.filter(i => boatItem(i.name));
  return boats.map(item => ({ name: item.name, score: items.reduce((total, i) => total +
    (i.name === item.name.replace('_boat', '_planks') ? i.count :
      i.name === item.name.replace('_boat', '_log') || i.name === item.name.replace('_boat', '_wood') ? i.count * 4 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0]?.name || 'oak_boat';
}

async function boatTravelStep(bot, task, goal, save, destination, actions, client = task.opportunityClient) {
  if (!client || task.preparingBoat || !bot.inventory || bot.game.gameMode === 'creative') return false;
  const state = goal.boatTravel ||= { attempts: 0 };
  if (isSetAside(goal, 'boat', 'crossing')) return false;
  // Two failures rested boats for half an hour; once that rest is over,
  // they get a fresh budget rather than staying retired for the whole goal.
  if (state.failures >= 2) state.failures = 0;
  const trip = await surveyBoatTrip(bot, task, destination);
  if (!trip) return false;
  const area = `${Math.floor(trip.entry.x / 8)},${Math.floor(trip.entry.z / 8)}`;
  if (state.declinedArea === area && state.declinedUntil > Date.now()) return false;
  try {
    if (!state.preparing) {
      const response = await chooseBoat(client, { request: goal.request, waterBlocks: trip.length, progressBlocks: trip.progress,
        carriedBoat: bot.inventory.items().find(i => boatItem(i.name))?.name || null,
        inventory: Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])), safeShoreAtBothEnds: true });
      task.check(); state.decision = { at: new Date().toISOString(), ...response.answers.travel }; save();
      if (response.answers.travel.choice !== 'boat') { state.declinedArea = area; state.declinedUntil = Date.now() + 60000; save(); return false; }
      state.preparing = preferredBoat(bot); state.attempts = 0; save();
    }
    if (!countOf(bot, state.preparing)) {
      if (++state.attempts > 24) throw new Error('Could not prepare a boat in a short supply trip');
      task.preparingBoat = true;
      try { await actions.acquireStep(bot, task, state.preparing, 1, goal, save); }
      finally { task.preparingBoat = false; }
      return true;
    }
    const itemName = state.preparing;
    await navigate(bot, task, new goals.GoalBlock(trip.entry.x, trip.entry.y, trip.entry.z), { timeoutMs: 12000, stallMs: 4000 });
    task.check();
    if (!boatWater(bot, trip.path[0], trip.waterY) || !dockNear(bot, trip.path.at(-1), trip.waterY)) throw new Error('Boat launch or landing changed');
    const item = bot.inventory.items().find(i => i.name === itemName);
    await bot.equip(item, 'hand');
    const water = trip.path[0], ids = new Set(Object.keys(bot.entities));
    await bot.lookAt(water.offset(0, .9, 0), true);
    await sleep(250); task.check();
    bot.activateItem();
    let boat;
    await awaitState(task, () => { boat = Object.values(bot.entities).find(e => !ids.has(String(e.id)) && boatItem(e.name) && flatDistance(e.position, water) < 3); return boat; });
    state.placed = { uuid: boat.uuid, entityId: boat.id, item: itemName, position: { ...boat.position }, dimension: bot.game.dimension }; save();
    (bot._ownedBoats ||= new Set()).add(boat.uuid);
    if (boat.passengers?.length) throw new Error('Something else climbed into the boat');
    // Approach the placed boat in water if it spawned beyond interaction reach.
    if (boat.position.distanceTo(bot.entity.position) > 3) await navigate(bot, task, new goals.GoalNear(boat.position.x, trip.waterY, boat.position.z, 2), { timeoutMs: 5000 });
    bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.mount(boat);
    await awaitState(task, () => bot.vehicle === boat);
    goal.step = { action: 'boat_travel', destination: { ...trip.landing }, waterBlocks: trip.length }; save();
    try { await paddle(bot, task, boat, trip, data => { state.progress = data; save(); }); }
    finally { await leaveBoat(bot); bot.clearControlStates(); }
    task.check();
    // Dismount can put the player on the boat. Remove our empty boat before
    // walking; otherwise Mineflayer's player physics walks through its hull
    // and the server repeatedly corrects that collision.
    let recovered = false;
    if (bot.entities[boat.id] === boat && !(boat.passengers || []).length && boat.position.distanceTo(bot.entity.position) < 4) {
      const before = countOf(bot, itemName);
      await bot.lookAt(boat.position.offset(0, .3, 0), true);
      for (let n = 0; n < 12 && bot.entities[boat.id] === boat; n++) { task.check(); bot.attack(boat); await sleep(300); }
      if (bot.entities[boat.id] === boat) throw new Error('Empty boat is still blocking the exit; waiting before walking');
      await floatAfterBoat(bot, task, trip.waterY);
      const drop = Object.values(bot.entities).find(e => e.getDroppedItem?.()?.name === itemName && e.position.distanceTo(boat.position) < 3);
      if (drop) {
        await navigate(bot, task, new goals.GoalNear(drop.position.x, trip.waterY, drop.position.z, 1), { timeoutMs: 6000, stallMs: 3000 });
        await awaitState(task, () => countOf(bot, itemName) > before, 2000);
        delete state.placed; recovered = true; save();
      }
      if (countOf(bot, itemName) > before) { delete state.placed; recovered = true; }
      bot._ownedBoats.delete(boat.uuid);
    }
    await navigate(bot, task, new goals.GoalBlock(trip.landing.x, trip.landing.y, trip.landing.z), { timeoutMs: 12000, stallMs: 4000 });
    state.completed = { at: new Date().toISOString(), landing: { ...bot.entity.position }, item: itemName, recovered };
    // A finished crossing is evidence that boats work here. Clear the failure
    // budget so one bad stretch of water cannot retire them for the whole task.
    delete state.preparing; delete state.lastError; attemptsFor(goal).clear('boat', 'crossing');
    state.attempts = 0; state.failures = 0; save();
    return true;
  } catch (error) {
    // Stop, low air and threats interrupt the crossing without saying anything
    // about the route. Only real boat failures spend the budget that retires
    // this optional transport, and only they discard the prepared boat choice.
    const interrupted = ['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(error.name);
    state.lastError = error.message;
    if (!interrupted) {
      state.failures = (state.failures || 0) + 1;
      setAside(goal, 'boat', 'crossing', error, state.failures >= 2 ? 30 * 60000 : 60000);
      delete state.preparing;
    }
    save();
    if (bot.vehicle) await leaveBoat(bot);
    task.check();
    if (interrupted) throw error;
    // Optional transport must not replace the user's objective or keep
    // manufacturing boats after a failed placement, boarding or crossing.
    return false;
  }
}

module.exports = { LIMITS, boatItem, boatWater, dockNear, surveyBoatTrip, chooseBoat, boatTick, paddle, leaveBoat, clearOwnedBoatAtFeet, floatAfterBoat, preferredBoat, boatTravelStep };
