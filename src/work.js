'use strict';

const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, equipBestTool, pickaxeTier, countOf } = require('./skills');
const { planFor, MINEABLE } = require('./plan');
const { houseBlueprint, verifyHouse } = require('./objectives');
const { deliver } = require('./delivery');
const { reservedForConstruction, portalSiteClear, selectPortalSite } = require('./build-sites');
const { updateDigCapabilities } = require('./movement');
const { tunnelStep } = require('./tunneling');
const { maintainVitals } = require('./vitals');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pos = p => new Vec3(p.x, p.y, p.z);
const air = b => b && ['air', 'cave_air', 'void_air'].includes(b.name);
const faces = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];

class Blocked extends Error { constructor(message) { super(message); this.name = 'Blocked'; } }

function inventory(bot) {
  return bot.inventory.items().reduce((o, i) => { o[i.name] = (o[i.name] || 0) + i.count; return o; }, {});
}

function planningInventory(bot) {
  const stock = inventory(bot);
  for (const item of bot.inventory.items()) {
    const durability = bot.registry.itemsByName[item.name]?.maxDurability;
    if (item.name.endsWith('_pickaxe') && durability && durability - (item.durabilityUsed || 0) < 8) stock[item.name] -= item.count;
  }
  return stock;
}

async function prepareExpeditionStep(bot, task, goal, save) {
  if (pickaxeTier(bot) < 2) { await acquireStep(bot, task, 'stone_pickaxe', 1, goal, save); return false; }
  if (countOf(bot, 'oak_log') < 8) { await acquireStep(bot, task, 'oak_log', 8, goal, save); return false; }
  if (!countOf(bot, 'crafting_table')) { await acquireStep(bot, task, 'crafting_table', 1, goal, save, { portable: true }); return false; }
  goal.expeditionReady = true; save(); return true;
}

async function waitFor(task, predicate, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { task.check(); if (predicate()) return; await sleep(100); }
  throw new Error('Timed out waiting for world/inventory update');
}

async function stepOff(bot, task, p) {
  const feet = bot.entity.position.floored();
  if (feet.x !== p.x || feet.z !== p.z || Math.abs(feet.y - p.y) > 1) return;
  const exits = faces.slice(1, 5).flatMap(d => [0, 1, -1].map(dy => feet.plus(d).offset(0, dy, 0)));
  const exit = exits.find(q => air(bot.blockAt(q)) && air(bot.blockAt(q.offset(0, 1, 0))) &&
    bot.blockAt(q.offset(0, -1, 0))?.boundingBox === 'block');
  if (!exit) throw new Error('No solid adjacent footing to move out of the work position');
  await navigate(bot, task, new goals.GoalBlock(exit.x, exit.y, exit.z));
}

async function dig(bot, task, p) {
  task.check();
  let block = bot.blockAt(p);
  if (air(block)) return;
  if (!block?.diggable) throw new Error(`Cannot dig ${block?.name || 'unloaded block'}`);
  if (p.equals(bot.entity.position.floored().offset(0, -1, 0))) await stepOff(bot, task, p);
  if (!bot.canDigBlock(block)) {
    await navigate(bot, task, new goals.GoalGetToBlock(p.x, p.y, p.z));
  }
  task.check();
  block = bot.blockAt(p);
  if (p.equals(bot.entity.position.floored().offset(0, -1, 0))) throw new Error('Refusing to dig directly beneath feet');
  await equipBestTool(bot, block);
  if (block.harvestTools && !block.harvestTools[bot.heldItem?.type]) throw new Error(`Missing harvest tool for ${block.name}`);
  await bot.dig(block);
  await waitFor(task, () => bot.blockAt(p)?.type !== block.type);
}

async function place(bot, task, p, material) {
  task.check();
  if (bot.blockAt(p)?.name === material) return;
  if (!air(bot.blockAt(p)) && !['water', 'short_grass', 'tall_grass', 'fern', 'snow'].includes(bot.blockAt(p)?.name)) {
    throw new Error(`Placement obstructed by ${bot.blockAt(p)?.name} at ${p}`);
  }
  await stepOff(bot, task, p);
  const eye = bot.entity.position.offset(0, 1.62, 0);
  if (eye.distanceTo(p.offset(0.5, 0.5, 0.5)) > 4.5) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 4));
  const item = bot.inventory.items().find(i => i.name === material);
  if (!item) throw new Blocked(`Need more ${material}`);
  await bot.equip(item, 'hand');
  let placementError = 'no adjacent solid anchor';
  for (const f of faces) {
    const ref = bot.blockAt(p.plus(f));
    if (ref?.boundingBox !== 'block') continue;
    task.check();
    try {
      await bot.placeBlock(ref, f.scaled(-1));
      await waitFor(task, () => bot.blockAt(p)?.name === material ||
        (material.endsWith('_concrete_powder') && bot.blockAt(p)?.name === material.replace('_powder', '')));
      return;
    } catch (err) { task.check(); placementError = err.message; }
  }
  throw new Error(`Cannot place ${material} at ${p}: ${placementError}`);
}

function find(bot, names, distance = 48, count = 32) {
  const ids = names.map(n => bot.registry.blocksByName[n]?.id).filter(n => n !== undefined);
  return ids.length ? bot.findBlocks({ matching: ids, maxDistance: distance, count }) : [];
}

async function explore(bot, task, goal, save, resource) {
  goal.search ||= {};
  const search = goal.search[resource] ||= { attempts: 0, origin: { ...bot.entity.position.floored() } };
  if (search.attempts >= 128) throw new Blocked(`Could not find reachable ${resource} after 128 exploration steps`);
  search.attempts++;
  search.leg ||= 0;
  const angle = (search.leg % 8) * Math.PI / 4;
  const radius = 24 * (1 + Math.floor(search.leg / 8));
  let target = pos(search.origin).offset(Math.round(Math.cos(angle) * radius), 0, Math.round(Math.sin(angle) * radius));
  const resourceNames = Object.entries(MINEABLE).filter(([name, data]) => name === resource || data.drops === resource).map(([name]) => name);
  const observed = find(bot, resourceNames, 128, 8).filter(p => !reservedForConstruction(goal, p));
  if (observed.length) {
    target = observed[0];
    search.observedTarget = { ...target };
  }
  // When a known resource is well below us, circling the same mountain does
  // not get closer. Approach through a dry, supported staircase. Stay above
  // a water-covered deposit rather than tunnelling into the water itself.
  if (observed.length && search.attempts > 3 && target.y < bot.entity.position.y - 8 && pickaxeTier(bot) >= 1) {
    let surface = target.clone();
    for (let y = target.y + 1; y <= target.y + 16; y++) {
      const b = bot.blockAt(new Vec3(target.x, y, target.z));
      if (b?.name === 'water') surface.y = y + 2;
    }
    await tunnelStep(bot, task, goal, save, surface, { dig, navigate });
    return;
  }
  save();
  // Keep the same waypoint until reached. Rotating on every short walk made
  // the bot circle the mountain forever instead of reaching the wider ring.
  const landIds = ['grass_block', 'dirt', 'stone', 'sand'].map(n => bot.registry.blocksByName[n]?.id).filter(n => n !== undefined);
  // Filter surface blocks before truncating results. Taking the nearest 512
  // solids first filled the list with underground stone and hid every shore.
  const land = bot.findBlocks({ matching: landIds, maxDistance: 48, count: 256,
    useExtraInfo: b => b.position.distanceTo(bot.entity.position) > 8 &&
      air(bot.blockAt(b.position.offset(0, 1, 0))) && air(bot.blockAt(b.position.offset(0, 2, 0))),
  }).map(p => p.offset(0, 1, 0))
    .sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
  if (!land.length) throw new Error(`No visible dry landing while searching for ${resource}`);
  search.visited ||= {};
  const key = p => `${Math.floor(p.x / 8)},${Math.floor(p.y / 8)},${Math.floor(p.z / 8)}`;
  const distance = p => observed.length ? p.distanceTo(target) : Math.hypot(p.x - target.x, p.z - target.z);
  land.sort((a, b) => distance(a) + (search.visited[key(a)] || 0) * 24 -
    distance(b) - (search.visited[key(b)] || 0) * 24);
  let destination;
  const checked = new Set();
  for (const candidate of land) {
    if (checked.has(key(candidate))) continue;
    checked.add(key(candidate));
    if (checked.size > 16) break;
    const targetGoal = new goals.GoalBlock(candidate.x, candidate.y, candidate.z);
    const route = bot.pathfinder.getPathTo ? bot.pathfinder.getPathTo(bot.pathfinder.movements, targetGoal, 500) : { status: 'success' };
    if (route.status === 'success') { destination = candidate; break; }
    search.visited[key(candidate)] = (search.visited[key(candidate)] || 0) + 1;
  }
  if (!destination) { search.leg++; save(); throw new Error(`No reachable surveyed ground while searching for ${resource}`); }
  search.visited[key(destination)] = (search.visited[key(destination)] || 0) + 1;
  save();
  try {
    await navigate(bot, task, new goals.GoalBlock(destination.x, destination.y, destination.z));
    search.failedLegs = 0;
    if (Math.hypot(bot.entity.position.x - target.x, bot.entity.position.z - target.z) < 6) search.leg++;
  } catch (err) {
    task.check();
    if ((search.failedLegs = (search.failedLegs || 0) + 1) >= 2) { search.leg++; search.failedLegs = 0; }
    throw new Error(`Searching for ${resource}: ${err.message}`);
  }
}

async function mine(bot, task, step, goal, save) {
  const names = Object.entries(MINEABLE).filter(([, info]) => info.drops === step.drops).map(([name]) => name);
  if (step.drops === 'flint') names.push('gravel');
  const ids = names.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  const candidates = bot.findBlocks({ matching: ids, maxDistance: 48, count: 32,
    useExtraInfo: b => faces.some(f => {
      const neighbor = bot.blockAt(b.position.plus(f));
      return air(neighbor) || neighbor?.name === 'water';
    }) && !reservedForConstruction(goal, b.position) &&
      (step.drops !== 'dirt' || (b.position.y >= bot.entity.position.floored().y - 1 && air(bot.blockAt(b.position.offset(0, 1, 0))))),
  }).filter(p => {
    const k = `${p}`;
    return !goal.unreachable?.[k] || Date.now() - goal.unreachable[k] > 120000;
  });
  if (!candidates.length) {
    if (step.depth !== null && step.depth !== undefined) {
      const ore = find(bot, names, 64, 16)[0];
      const target = ore || bot.entity.position.floored().offset(24, step.depth - bot.entity.position.floored().y, 0);
      await tunnelStep(bot, task, goal, save, target, { dig, navigate });
    } else await explore(bot, task, goal, save, step.block);
    return;
  }
  for (const p of candidates.slice(0, 8)) {
    task.check();
    try {
      const before = countOf(bot, step.drops);
      await dig(bot, task, p);
      await sleep(650);
      if (countOf(bot, step.drops) > before) return;
      const drop = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === step.drops)
        .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
      if (drop) {
        const d = drop.position.floored();
        try { await navigate(bot, task, new goals.GoalNear(d.x, d.y, d.z, 1)); } catch (e) { task.check(); }
        await sleep(650);
      }
      if (countOf(bot, step.drops) > before) return;
    } catch (e) { task.check(); goal.lastMiningError = e.message; }
    goal.unreachable ||= {};
    goal.unreachable[`${p}`] = Date.now();
  }
  save();
  await explore(bot, task, goal, save, step.block);
}

async function workstation(bot, task, name) {
  let p = find(bot, [name], 32, 1)[0];
  if (!p) {
    const o = bot.entity.position.floored();
    for (let dx = -2; dx <= 2 && !p; dx++) for (let dz = -2; dz <= 2 && !p; dz++) {
      if (!dx && !dz) continue;
      const q = o.offset(dx, 0, dz);
      if (air(bot.blockAt(q)) && bot.blockAt(q.offset(0, -1, 0))?.boundingBox === 'block') {
        await place(bot, task, q, name); p = q;
        bot._ownedWorkstations ||= new Set(); bot._ownedWorkstations.add(`${name}:${q}`);
      }
    }
  }
  if (!p) throw new Error(`No place for ${name}`);
  await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2));
  return bot.blockAt(p);
}

async function craft(bot, task, step, goal) {
  const table = step.needs_table ? await workstation(bot, task, 'crafting_table') : null;
  const id = bot.registry.itemsByName[step.item]?.id;
  const recipe = bot.recipesFor(id, null, step.count, table)[0];
  if (!recipe) throw new Error(`No usable recipe for ${step.count} ${step.item}`);
  const before = countOf(bot, step.item);
  task.check();
  // Mineflayer's 26.1 table window can desynchronize between repeated crafts.
  // Close and confirm one table batch at a time, then replan from real stock.
  const batches = step.needs_table ? 1 : Math.ceil(step.count / recipe.result.count);
  await bot.craft(recipe, batches, table);
  await waitFor(task, () => countOf(bot, step.item) >= before + batches * recipe.result.count);
  if (table && goal?.expeditionReady && bot._ownedWorkstations?.has(`crafting_table:${table.position}`)) {
    const count = countOf(bot, 'crafting_table');
    await dig(bot, task, table.position);
    await navigate(bot, task, new goals.GoalNear(table.position.x, table.position.y, table.position.z, 1));
    await waitFor(task, () => countOf(bot, 'crafting_table') > count);
    bot._ownedWorkstations.delete(`crafting_table:${table.position}`);
  }
}

async function smelt(bot, task, step) {
  const block = await workstation(bot, task, 'furnace');
  const before = countOf(bot, step.item);
  const needed = Math.min(step.count, 16);
  const furnace = await bot.openFurnace(block);
  let taken = 0;
  const collect = async () => {
    const output = furnace.outputItem();
    if (!output) return;
    if (output.name !== step.item) throw new Error('Furnace contains a different output');
    const amount = output.count;
    await furnace.takeOutput();
    taken += amount;
  };
  try {
    await collect();
    if (taken < needed) {
      const existing = furnace.inputItem();
      if (existing && existing.name !== step.from) throw new Error('Furnace contains another input');
      const amount = needed - taken;
      const missingInput = Math.max(0, amount - (existing?.count || 0));
      if (missingInput) await furnace.putInput(bot.registry.itemsByName[step.from].id, null, missingInput);
      if (!furnace.fuelItem()) await furnace.putFuel(bot.registry.itemsByName.oak_planks.id, null, Math.ceil(amount / 1.5));
      const deadline = Date.now() + amount * 12000 + 10000;
      while (taken < needed) {
        task.check();
        if (Date.now() > deadline) throw new Error(`Smelting ${step.item} timed out`);
        await collect();
        if (taken < needed) await sleep(250);
      }
    }
  } finally {
    try { if (bot._syncWindow) await bot._syncWindow(furnace); }
    finally { furnace.close(); }
  }
  if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  await waitFor(task, () => countOf(bot, step.item) >= before + needed);
}

async function harden(bot, task, goal, save) {
  if (pickaxeTier(bot) < 1) throw new Error('Concrete needs a pickaxe');
  if (!goal.concreteStation) {
    const water = find(bot, ['water'], 48, 64);
    for (const w of water) {
      const bank = faces.slice(1, 5).map(f => w.plus(f)).find(p => {
        const at = bot.blockAt(p);
        return (air(at) || ['dirt', 'grass_block', 'sand', 'gravel'].includes(at?.name)) &&
          bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block';
      });
      if (bank) { goal.concreteStation = { ...bank }; save(); break; }
    }
  }
  if (!goal.concreteStation) { await explore(bot, task, goal, save, 'water bank for concrete'); return; }
  const p = pos(goal.concreteStation);
  if (bot.entity.position.distanceTo(p) > 4) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2));
  const existing = bot.blockAt(p);
  if (!['purple_concrete', 'purple_concrete_powder'].includes(existing?.name)) {
    if (!air(existing) && existing?.name !== 'water') await dig(bot, task, p);
    await place(bot, task, p, 'purple_concrete_powder');
  }
  await waitFor(task, () => bot.blockAt(p)?.name === 'purple_concrete');
  const before = countOf(bot, 'purple_concrete');
  await dig(bot, task, p);
  await sleep(650);
  if (countOf(bot, 'purple_concrete') <= before) {
    await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 1));
    await waitFor(task, () => countOf(bot, 'purple_concrete') > before);
  }
}

async function acquireStep(bot, task, item, count, goal, save, { portable = false } = {}) {
  if (countOf(bot, item) >= count) return true;
  const inv = planningInventory(bot);
  for (const station of ['crafting_table', 'furnace']) if (!(portable && station === item) && find(bot, [station], 32, 1).length) inv[station] = Math.max(inv[station] || 0, 1);
  const step = planFor(item, count, inv)[0];
  if (!step) throw new Error(`No progress step for ${item}`);
  goal.step = step;
  save();
  if (step.action === 'mine') await mine(bot, task, step, goal, save);
  else if (step.action === 'craft') await craft(bot, task, step, goal);
  else if (step.action === 'smelt') await smelt(bot, task, step);
  else if (step.action === 'harden') await harden(bot, task, goal, save);
  else throw new Error(`Unknown action ${step.action}`);
  return false;
}

function selectSite(bot, material) {
  const o = bot.entity.position.floored();
  for (let radius = 0; radius <= 12; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const heights = [];
      for (let x = -2; x <= 2; x++) for (let z = -3; z <= 2; z++) {
        let surface = null;
        for (let y = o.y + 3; y >= o.y - 3; y--) {
          const p = new Vec3(o.x + dx + x, y, o.z + dz + z);
          const ground = bot.blockAt(p.offset(0, -1, 0));
          const above = bot.blockAt(p);
          if (ground?.boundingBox === 'block' && !['ice', 'magma_block'].includes(ground.name) &&
              (air(above) || ['short_grass', 'tall_grass', 'fern', 'snow'].includes(above?.name))) { surface = y; break; }
        }
        heights.push(surface);
      }
      if (heights.some(y => y === null) || Math.max(...heights) - Math.min(...heights) > 1) continue;
      const origin = new Vec3(o.x + dx, Math.max(...heights), o.z + dz);
      const blueprint = houseBlueprint(origin, material);
      const clear = [...blueprint.blocks, ...blueprint.empty].filter(p => p.y >= origin.y).every(p => {
        const b = bot.blockAt(pos(p)); return air(b) || ['short_grass', 'tall_grass', 'fern', 'snow'].includes(b?.name);
      });
      if (clear) return blueprint;
    }
  }
  return null;
}

async function buildHouseStep(bot, task, goal, save) {
  if (!goal.blueprint) {
    goal.blueprint = selectSite(bot, goal.material);
    if (!goal.blueprint) { await explore(bot, task, goal, save, 'flat building site'); return false; }
    save();
  }
  const blueprint = goal.blueprint;
  if (!bot.blockAt(pos(blueprint.origin))) {
    const home = pos(blueprint.entrance);
    await navigate(bot, task, new goals.GoalNear(home.x, home.y, home.z, 2));
    return false;
  }
  const missing = blueprint.blocks.filter(p => bot.blockAt(pos(p))?.name !== p.material);
  if (missing.length && countOf(bot, goal.material) < missing.length) {
    await acquireStep(bot, task, goal.material, missing.length, goal, save);
    return false;
  }
  goal.step = { action: 'build', remainingBlocks: missing.length, origin: blueprint.origin };
  save();
  const o = pos(blueprint.origin);
  if (bot.entity.position.distanceTo(o) > 4) await navigate(bot, task, new goals.GoalNear(o.x, o.y, o.z, 1));
  // Prevent pathfinding from dismantling the house while navigating around it.
  const movements = bot.pathfinder.movements;
  const previous = movements.canDig;
  movements.canDig = false;
  try {
    const obstruction = blueprint.empty.find(p => !air(bot.blockAt(pos(p))));
    if (obstruction) { await dig(bot, task, pos(obstruction)); return false; }
    // Floor/walls first; within a layer start where there is already an anchor.
    const ordered = missing.sort((a, b) => a.y - b.y ||
      Number(faces.some(f => bot.blockAt(pos(b).plus(f))?.boundingBox === 'block')) -
      Number(faces.some(f => bot.blockAt(pos(a).plus(f))?.boundingBox === 'block')));
    for (const p of ordered.slice(0, 8)) {
      const target = pos(p);
      if (!air(bot.blockAt(target))) {
        // Floor replacement: step off it before digging.
        const feet = bot.entity.position.floored();
        if (target.equals(feet.offset(0, -1, 0))) await navigate(bot, task, new goals.GoalBlock(o.x, o.y, o.z - 3));
        await dig(bot, task, target);
      }
      await place(bot, task, target, p.material);
      save();
    }
  } finally { movements.canDig = previous; }
  return verifyHouse(bot, blueprint).ok;
}

async function netherStep(bot, task, goal, save) {
  if (String(bot.game.dimension).includes('nether')) return true;
  const portal = find(bot, ['nether_portal'], 64, 1)[0];
  if (portal) {
    goal.portal = { ...portal }; save();
    await navigate(bot, task, new goals.GoalBlock(portal.x, portal.y, portal.z));
    await waitFor(task, () => String(bot.game.dimension).includes('nether'), 12000);
    return true;
  }
  // A frame with no placed blocks can be relocated when its original ground
  // was excavated. Once construction begins its coordinates stay fixed.
  if (goal.portalFrame && goal.portalFrame.blocks.every(p => bot.blockAt(pos(p))?.name !== 'obsidian') &&
      !portalSiteClear(bot, goal.portalFrame.origin)) { delete goal.portalFrame; save(); }
  if (!goal.portalFrame) {
    if (!await acquireStep(bot, task, 'flint_and_steel', 1, goal, save)) return false;
    if (!await acquireStep(bot, task, 'obsidian', 10, goal, save)) return false;
    // Gather scaffolding before choosing the building site, so we never mine
    // its foundations to obtain temporary supports.
    if (!await acquireStep(bot, task, 'dirt', 3, goal, save)) return false;
    const site = selectPortalSite(bot);
    if (!site) { await explore(bot, task, goal, save, 'portal site'); return false; }
    const o = pos(site);
    // Minimal frame: two bottom/top blocks, three on each side, no corners.
    goal.portalFrame = { origin: { ...o }, blocks: [
      ...[1, 2].flatMap(x => [o.offset(x, 0, 0), o.offset(x, 4, 0)]),
      ...[1, 2, 3].flatMap(y => [o.offset(0, y, 0), o.offset(3, y, 0)]),
    ].sort((a, b) => a.y - b.y).map(p => ({ ...p })) };
    save();
  }
  const frame = goal.portalFrame;
  const missing = frame.blocks.filter(p => bot.blockAt(pos(p))?.name !== 'obsidian');
  if (missing.length) {
    if (!await acquireStep(bot, task, 'obsidian', missing.length, goal, save)) return false;
    // The cornerless frame still needs temporary placement anchors. The top
    // beam cannot be placed in midair: build its left corner after the column.
    const o = pos(frame.origin);
    const scaffold = [o.offset(0, 0, 0), o.offset(3, 0, 0), o.offset(0, 4, 0)];
    const neededDirt = scaffold.filter(p => air(bot.blockAt(p))).length;
    if (!await acquireStep(bot, task, 'dirt', neededDirt, goal, save)) return false;
    await navigate(bot, task, new goals.GoalBlock(o.x, o.y, o.z - 1));
    for (const p of scaffold.slice(0, 2)) if (air(bot.blockAt(p))) await place(bot, task, p, 'dirt');
    for (const p of missing) {
      if (p.y === o.y + 4 && air(bot.blockAt(scaffold[2]))) await place(bot, task, scaffold[2], 'dirt');
      await place(bot, task, pos(p), 'obsidian');
    }
  }
  if (!await acquireStep(bot, task, 'flint_and_steel', 1, goal, save)) return false;
  const bottom = pos(frame.origin).offset(1, 0, 0);
  await navigate(bot, task, new goals.GoalNear(bottom.x, bottom.y, bottom.z, 2));
  await bot.equip(bot.inventory.items().find(i => i.name === 'flint_and_steel'), 'hand');
  task.check();
  await bot.activateBlock(bot.blockAt(bottom), new Vec3(0, 1, 0));
  await waitFor(task, () => bot.blockAt(bottom.offset(0, 1, 0))?.name === 'nether_portal');
  return false;
}

async function runGoal(bot, task, goal, store, { maxSteps = 2000, onStep = () => {} } = {}) {
  const save = () => store.save(goal);
  const movements = bot.pathfinder.movements;
  movements.exclusionAreasBreak = (movements.exclusionAreasBreak || []).filter(rule => rule !== bot._constructionProtection);
  bot._constructionProtection = block => reservedForConstruction(goal, block.position) ? 100 : 0;
  movements.exclusionAreasBreak.push(bot._constructionProtection);
  goal.status = 'running'; goal.failures = 0; save();
  for (let n = 0; n < maxSteps; n++) {
    task.check();
    updateDigCapabilities(bot);
    const before = JSON.stringify(inventory(bot));
    const location = bot.entity.position.clone();
    try {
      let complete = false;
      await maintainVitals(bot, task, step => { goal.survivalAction = { ...step, at: new Date().toISOString() }; save(); });
      const needsSupplies = !goal.expeditionReady && (
        (goal.kind === 'concrete' && countOf(bot, 'purple_concrete') + (goal.delivered || 0) < goal.count && !goal.pendingDelivery) ||
        (goal.kind === 'nether' && !String(bot.game.dimension).includes('nether') && !find(bot, ['nether_portal'], 64, 1).length && !goal.portalFrame));
      const prepared = !needsSupplies || await prepareExpeditionStep(bot, task, goal, save);
      if (prepared && goal.kind === 'house') complete = await buildHouseStep(bot, task, goal, save);
      if (prepared && goal.kind === 'concrete') {
        if ((goal.delivered || 0) >= goal.count) complete = true;
        else if (goal.pendingDelivery || await acquireStep(bot, task, 'purple_concrete', goal.count - (goal.delivered || 0), goal, save)) {
          goal.step = { action: 'deliver', count: goal.count - (goal.delivered || 0), recipient: goal.from }; save();
          complete = await deliver(bot, task, goal, save);
        }
      }
      if (prepared && goal.kind === 'nether') complete = await netherStep(bot, task, goal, save);
      task.check();
      goal.failures = 0;
      delete goal.lastError;
      goal.history ||= [];
      goal.history.push({ time: new Date().toISOString(), step: goal.step, inventory: inventory(bot), position: { ...bot.entity.position }, dimension: bot.game.dimension });
      goal.history = goal.history.slice(-40);
      if (complete) {
        goal.status = 'complete'; goal.completedAt = new Date().toISOString(); save();
        bot.chat(goal.kind === 'concrete' ? `Delivered ${goal.count} purple concrete to ${goal.from}; pickup confirmed.` :
          goal.kind === 'house' ? `House verified at ${pos(goal.blueprint.origin)}: floor, walls, roof and clear doorway.` : 'Nether route verified: I entered the Nether.');
        return { ok: true, goal };
      }
      const unchanged = before === JSON.stringify(inventory(bot)) && location.distanceTo(bot.entity.position) < 1;
      goal.stalls = unchanged ? (goal.stalls || 0) + 1 : 0;
      if (goal.stalls > 30) throw new Blocked(`No measurable progress on ${JSON.stringify(goal.step)}`);
    } catch (err) {
      task.check();
      goal.lastError = err.message;
      // A partial craft/build can change inventory before its promise fails.
      // Replan that observed progress; only consecutive no-progress errors
      // exhaust retries.
      goal.failures = before === JSON.stringify(inventory(bot)) && location.distanceTo(bot.entity.position) < 2 ? goal.failures + 1 : 0;
      if (err.name === 'Blocked' || goal.failures >= 5) {
        goal.status = 'blocked'; save();
        bot.chat(`Blocked: ${err.message}. Progress saved; say resume to retry.`);
        return { ok: false, reason: err.message, goal };
      }
      await sleep(300);
    }
    save(); onStep(goal);
  }
  goal.status = 'blocked'; goal.lastError = 'Action budget reached'; save();
  bot.chat('Action budget reached. Progress saved; say resume to continue.');
  return { ok: false, reason: goal.lastError, goal };
}

module.exports = { runGoal, acquireStep, inventory, planningInventory, selectSite, explore, smelt, dig, place, waitFor, Blocked };
