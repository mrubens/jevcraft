'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { MINEABLE, TOOL_TIERS } = require('./plan');

/** Best pickaxe tier carried: 0 bare hands, 1 wooden, 2 stone, 3 iron, ... */
function pickaxeTier(bot) {
  let best = 0;
  for (const item of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(item.name);
    if (m) best = Math.max(best, TOOL_TIERS.indexOf(m[1]) + 1);
  }
  return best;
}

/** How many of `item` the bot holds. */
function countOf(bot, item) {
  return bot.inventory.items().filter((i) => i.name === item).reduce((n, i) => n + i.count, 0);
}

// ---------------------------------------------------------------------------
// The skill library: everything the bot can actually do.
//
// No model is consulted in this file. Jev decides *which* skill runs and with
// what arguments; from here on it is ordinary, inspectable game code, so a
// wrong judgment produces a wrong-but-safe action rather than unpredictable
// behaviour. Every long-running skill checks `task.cancelled` between steps so
// "stop" always lands promptly.
// ---------------------------------------------------------------------------

class Task {
  constructor(label, description) {
    this.label = label;
    this.description = description;
    this.cancelled = false;
    this.startedAt = Date.now();
  }
  describe() {
    return this.cancelled ? 'idle' : this.description;
  }
  cancel() {
    this.cancelled = true;
  }
  /** Throws if the task was cancelled, unwinding whatever skill is running. */
  check() {
    if (this.cancelled) throw new Cancelled(this.label);
  }
}

class Cancelled extends Error {
  constructor(label) {
    super(`task cancelled: ${label}`);
    this.name = 'Cancelled';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Move somewhere, aborting cleanly if the task is cancelled mid-path. */
async function navigate(bot, task, goal) {
  task.check();
  let timer;
  const watchdog = new Promise((_, reject) => {
    const started = Date.now();
    timer = setInterval(() => {
      if (task.cancelled || Date.now() - started > 20000) {
        bot.pathfinder.setGoal(null);
        reject(task.cancelled ? new Cancelled(task.label) : new Error('navigation timed out'));
      }
    }, 100);
  });
  try {
    await Promise.race([bot.pathfinder.goto(goal), watchdog]);
    task.check();
    if (goal.isEnd && !goal.isEnd(bot.entity.position.floored())) {
      throw new Error('Navigation ended before reaching the destination');
    }
  } catch (err) {
    bot.pathfinder.setGoal(null);
    task.check();
    throw err;
  } finally {
    clearInterval(timer);
  }
}

/** Equip whichever carried item mines this block fastest. */
async function equipBestTool(bot, block) {
  let best = null;
  let bestTime = block.digTime(null, false, false, false, [], {});
  for (const item of bot.inventory.items()) {
    const time = block.digTime(item.type, false, false, false, [], {});
    if (time < bestTime) {
      bestTime = time;
      best = item;
    }
  }
  if (best && (!bot.heldItem || bot.heldItem.type !== best.type)) {
    await bot.equip(best, 'hand');
  }
}

// --- movement -------------------------------------------------------------

async function comeToSpeaker(bot, task, { target }) {
  const player = bot.players[target];
  if (!player || !player.entity) {
    bot.chat(`I can't see you, ${target}.`);
    return;
  }
  const p = player.entity.position;
  await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2));
  bot.chat(`Here, ${target}.`);
}

async function followSpeaker(bot, task, { target }) {
  const player = bot.players[target];
  if (!player || !player.entity) {
    bot.chat(`I can't see you, ${target}.`);
    return;
  }
  bot.chat(`Following you, ${target}.`);
  // A dynamic goal: pathfinder re-plans as the player moves, so this skill just
  // holds the goal open until something cancels it.
  bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
  try {
    while (!task.cancelled && bot.players[target] && bot.players[target].entity) {
      await sleep(250);
    }
  } finally {
    bot.pathfinder.setGoal(null);
  }
}

async function goToCoordinates(bot, task, { x, y, z }) {
  bot.chat(`Heading to ${x} ${y} ${z}.`);
  await navigate(bot, task, new goals.GoalNear(x, y, z, 2));
  bot.chat(`Arrived at ${x} ${y} ${z}.`);
}

// --- gathering ------------------------------------------------------------

async function gatherMaterial(bot, task, { material, amount }) {
  const blockType = bot.registry.blocksByName[material];
  if (!blockType) {
    bot.chat(`I don't know what ${material} is.`);
    return false;
  }

  // What actually lands in the inventory, and what it takes to get it. Stone
  // broken by hand drops nothing at all; counting digs instead of drops had
  // the bot announcing "collected 16 stone" while holding no cobblestone.
  const info = MINEABLE[material] || { drops: material, tier: 0 };
  const have = pickaxeTier(bot);
  if (have < info.tier) {
    const need = TOOL_TIERS[info.tier - 1];
    bot.chat(`I can't get ${material} without at least a ${need} pickaxe.`);
    return false;
  }

  bot.chat(`Going to get ${amount} ${material}.`);
  const startCount = countOf(bot, info.drops);
  const collected = () => countOf(bot, info.drops) - startCount;
  let digsWithoutDrop = 0;

  while (collected() < amount) {
    task.check();

    const positions = bot.findBlocks({ matching: blockType.id, maxDistance: 48, count: 24 });
    if (positions.length === 0) {
      bot.chat(
        collected() > 0
          ? `Got ${collected()} ${info.drops} — can't find any more ${material} nearby.`
          : `I can't find any ${material} around here.`,
      );
      return collected() > 0;
    }

    let minedAny = false;
    for (const pos of positions) {
      if (collected() >= amount) break;
      task.check();

      const block = bot.blockAt(pos);
      if (!block || block.name !== material) continue;

      try {
        await navigate(bot, task, new goals.GoalGetToBlock(pos.x, pos.y, pos.z));
        task.check();
        await equipBestTool(bot, block);
        if (!bot.canDigBlock(block)) continue;
        const before = collected();
        await bot.dig(block);
        minedAny = true;
        // The drop lands where the block was, and the pickup radius is about a
        // block — digging from two blocks away leaves it lying there. Step onto
        // the spot to collect it before deciding whether anything dropped.
        try {
          await navigate(bot, task, new goals.GoalBlock(pos.x, pos.y, pos.z));
        } catch (err) {
          if (err instanceof Cancelled) throw err;
        }
        await sleep(350);
        if (collected() > before) digsWithoutDrop = 0;
        else if (++digsWithoutDrop >= 8) {
          bot.chat(`I'm breaking ${material} but nothing is dropping — stopping.`);
          return collected() > 0;
        }
      } catch (err) {
        if (err instanceof Cancelled) throw err;
      }
    }

    if (!minedAny) {
      bot.chat(`Got ${collected()} ${info.drops} — I can't reach any more.`);
      return collected() > 0;
    }
  }

  bot.chat(`Done — collected ${collected()} ${info.drops}.`);
  return true;
}

// --- items ----------------------------------------------------------------

async function giveItems(bot, task, { item, amount, to }) {
  const player = bot.players[to];
  if (player && player.entity) {
    const p = player.entity.position;
    await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2));
    await bot.lookAt(p.offset(0, 1.2, 0));
  }
  task.check();

  const stacks = item === 'everything'
    ? bot.inventory.items()
    : bot.inventory.items().filter((i) => i.name === item);

  if (stacks.length === 0) {
    bot.chat(`I'm not carrying any ${item}.`);
    return;
  }

  let remaining = amount || Infinity;
  let tossed = 0;
  for (const stack of stacks) {
    if (remaining <= 0) break;
    task.check();
    const count = Math.min(stack.count, remaining);
    await bot.toss(stack.type, null, count);
    tossed += count;
    remaining -= count;
    await sleep(120);
  }
  bot.chat(`Dropped ${tossed} ${item === 'everything' ? 'items' : item} for you.`);
}

// --- combat ---------------------------------------------------------------

async function attackTarget(bot, task, { target }) {
  const findTarget = () =>
    Object.values(bot.entities).find(
      (e) => e !== bot.entity && (e.username || e.displayName || e.name) === target && e.position,
    );

  let entity = findTarget();
  if (!entity) {
    bot.chat(`I can't see ${target}.`);
    return;
  }

  bot.chat(`Going after ${target}.`);
  while (!task.cancelled) {
    entity = findTarget();
    if (!entity || !entity.isValid) break;

    const distance = entity.position.distanceTo(bot.entity.position);
    if (distance > 3) {
      try {
        await navigate(bot, task, new goals.GoalFollow(entity, 2));
      } catch (err) {
        if (err instanceof Cancelled) throw err;
        break;
      }
    } else {
      await bot.lookAt(entity.position.offset(0, entity.height * 0.5, 0));
      bot.attack(entity);
      await sleep(500);
    }
  }
  bot.pathfinder.setGoal(null);
  bot.chat(`Done with ${target}.`);
}

// --- talking --------------------------------------------------------------

function reportStatus(bot, { topic }) {
  const p = bot.entity.position;
  switch (topic) {
    case 'location':
      bot.chat(`I'm at ${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}.`);
      break;
    case 'inventory': {
      const items = bot.inventory.items();
      bot.chat(
        items.length === 0
          ? "I'm carrying nothing."
          : `Carrying: ${items.map((i) => `${i.count} ${i.name}`).join(', ')}.`,
      );
      break;
    }
    case 'health':
      bot.chat(`Health ${Math.round(bot.health)}/20, food ${Math.round(bot.food)}/20.`);
      break;
    case 'activity':
    default:
      bot.chat(`Right now: ${bot.currentTaskDescription || 'nothing'}.`);
      break;
  }
}


// --- crafting, smelting, descending -----------------------------------------

/** Find a nearby crafting table, or place one from the inventory. */
async function ensureCraftingTable(bot, task) {
  const tableId = bot.registry.blocksByName.crafting_table.id;
  let table = bot.findBlock({ matching: tableId, maxDistance: 32 });
  if (table) {
    await navigate(bot, task, new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2));
    return bot.blockAt(table.position);
  }

  const item = bot.inventory.items().find((i) => i.name === 'crafting_table');
  if (!item) return null;

  // Place it on whatever solid ground the bot is standing on.
  const ground = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (!ground || ground.name === 'air') return null;
  await bot.equip(item, 'hand');
  try {
    await bot.placeBlock(ground, new Vec3(0, 1, 0));
  } catch (err) {
    return null;
  }
  table = bot.findBlock({ matching: tableId, maxDistance: 8 });
  return table ? bot.blockAt(table.position) : null;
}

async function craftItem(bot, task, { item, count }) {
  task.check();
  const itemType = bot.registry.itemsByName[item];
  if (!itemType) {
    bot.chat(`I don't know how to make ${item}.`);
    return false;
  }

  // Try the 2x2 inventory grid first; fall back to a table.
  let recipes = bot.recipesFor(itemType.id, null, 1, null);
  let table = null;
  if (recipes.length === 0) {
    table = await ensureCraftingTable(bot, task);
    if (!table) {
      bot.chat(`I need a crafting table to make ${item}.`);
      return false;
    }
    recipes = bot.recipesFor(itemType.id, null, 1, table);
  }
  if (recipes.length === 0) {
    bot.chat(`I don't have what I need for ${item}.`);
    return false;
  }

  const recipe = recipes[0];
  const per = recipe.result.count || 1;
  const times = Math.max(1, Math.ceil(count / per));
  await bot.craft(recipe, times, table || undefined);
  return true;
}

async function smeltItems(bot, task, { item, from, count, fuel }) {
  task.check();
  const furnaceId = bot.registry.blocksByName.furnace.id;
  let furnaceBlock = bot.findBlock({ matching: furnaceId, maxDistance: 32 });

  if (!furnaceBlock) {
    const held = bot.inventory.items().find((i) => i.name === 'furnace');
    if (!held) {
      bot.chat('I need a furnace to smelt that.');
      return false;
    }
    const ground = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!ground || ground.name === 'air') return false;
    await bot.equip(held, 'hand');
    try {
      await bot.placeBlock(ground, new Vec3(0, 1, 0));
    } catch (err) {
      bot.chat("I couldn't find anywhere to put the furnace.");
      return false;
    }
    furnaceBlock = bot.findBlock({ matching: furnaceId, maxDistance: 8 });
    if (!furnaceBlock) return false;
  }

  await navigate(bot, task, new goals.GoalNear(
    furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2,
  ));
  task.check();

  const furnace = await bot.openFurnace(bot.blockAt(furnaceBlock.position));
  try {
    const input = bot.inventory.items().find((i) => i.name === from);
    if (!input) {
      bot.chat(`I have nothing to smelt into ${item}.`);
      return false;
    }
    const fuelItem = bot.inventory.items().find(
      (i) => i.name === 'coal' || i.name === 'charcoal' || i.name === 'oak_planks',
    );
    if (!fuelItem) {
      bot.chat('I have no fuel for the furnace.');
      return false;
    }

    await furnace.putInput(input.type, null, Math.min(input.count, count));
    await furnace.putFuel(fuelItem.type, null, Math.min(fuelItem.count, Math.max(1, fuel || 1)));

    // Smelting takes ~10s an item; poll rather than guess, and stay cancellable.
    const deadline = Date.now() + 30000 + count * 12000;
    let taken = 0;
    while (taken < count && Date.now() < deadline) {
      task.check();
      await sleep(1000);
      if (furnace.outputItem()) {
        const out = await furnace.takeOutput();
        if (out) taken += out.count;
      }
    }
    return taken > 0;
  } finally {
    furnace.close();
  }
}

/**
 * Get down to roughly `targetY`. Pathfinder does the digging and already
 * treats lava as a block to avoid, so this mostly watches for it stalling.
 */
async function descendTo(bot, task, { y }) {
  const startY = bot.entity.position.y;
  if (startY <= y + 3) return true;

  let lastY = startY;
  let stalledFor = 0;

  while (bot.entity.position.y > y + 3) {
    task.check();
    try {
      await navigate(bot, task, new goals.GoalY(y));
    } catch (err) {
      if (err instanceof Cancelled) throw err;
      // Pathfinder gives up when it cannot see a route; nudge sideways and retry.
    }

    const nowY = bot.entity.position.y;
    if (Math.abs(nowY - lastY) < 1) {
      stalledFor++;
      if (stalledFor >= 3) return false;
      // Shift a few blocks horizontally to find a diggable column.
      const p = bot.entity.position;
      const angle = Math.random() * Math.PI * 2;
      try {
        await navigate(bot, task, new goals.GoalNear(
          p.x + Math.cos(angle) * 6, p.y, p.z + Math.sin(angle) * 6, 1,
        ));
      } catch (err) {
        if (err instanceof Cancelled) throw err;
      }
    } else {
      stalledFor = 0;
    }
    lastY = nowY;
  }
  return true;
}

// --- self-preservation ------------------------------------------------------

async function eatSomething(bot, task) {
  const FOODS = new Set([
    'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
    'cooked_cod', 'cooked_salmon', 'baked_potato', 'carrot', 'apple', 'golden_apple',
    'melon_slice', 'sweet_berries', 'beef', 'porkchop', 'chicken', 'mutton',
  ]);
  const food = bot.inventory.items().find((i) => FOODS.has(i.name));
  if (!food) return false;
  await bot.equip(food, 'hand');
  try {
    await bot.consume();
    return true;
  } catch (err) {
    return false;
  }
}

/** Put distance between the bot and something dangerous. */
async function fleeFrom(bot, task, { entity, distance = 16 }) {
  const threat = entity || null;
  const from = threat && threat.position ? threat.position : bot.entity.position;
  const away = bot.entity.position.minus(from);
  const len = Math.max(0.001, Math.hypot(away.x, away.z));
  const tx = bot.entity.position.x + (away.x / len) * distance;
  const tz = bot.entity.position.z + (away.z / len) * distance;
  try {
    await navigate(bot, task, new goals.GoalNearXZ(tx, tz, 2));
    return true;
  } catch (err) {
    if (err instanceof Cancelled) throw err;
    return false;
  }
}

/** Place a torch nearby if the bot has one, to stop things spawning. */
async function lightArea(bot, task) {
  const torch = bot.inventory.items().find((i) => i.name === 'torch');
  if (!torch) return false;
  const ground = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (!ground || ground.name === 'air') return false;
  await bot.equip(torch, 'hand');
  try {
    await bot.placeBlock(ground, new Vec3(0, 1, 0));
    return true;
  } catch (err) {
    return false;
  }
}

/** Climb toward daylight — where the trees and the sky are. */
async function ascendTo(bot, task, { y }) {
  let lastY = bot.entity.position.y;
  let stalls = 0;
  while (bot.entity.position.y < y - 3) {
    task.check();
    try {
      await navigate(bot, task, new goals.GoalY(y));
    } catch (err) {
      if (err instanceof Cancelled) throw err;
    }
    const nowY = bot.entity.position.y;
    if (Math.abs(nowY - lastY) < 1) {
      if (++stalls >= 3) return false;
    } else stalls = 0;
    lastY = nowY;
  }
  return true;
}

/** Walk somewhere new, to bring fresh ground into view. */
async function explore(bot, task, { distance = 32 } = {}) {
  const p = bot.entity.position;
  const angle = Math.random() * Math.PI * 2;
  try {
    await navigate(bot, task, new goals.GoalNearXZ(
      p.x + Math.cos(angle) * distance, p.z + Math.sin(angle) * distance, 3,
    ));
    return true;
  } catch (err) {
    if (err instanceof Cancelled) throw err;
    return false;
  }
}

// --- building ---------------------------------------------------------------

/** Is this column a sane place to stand a wall on? */
function groundAt(bot, x, z, baseY) {
  for (let dy = 2; dy >= -3; dy--) {
    const below = bot.blockAt(new Vec3(x, baseY + dy - 1, z));
    const at = bot.blockAt(new Vec3(x, baseY + dy, z));
    if (below && at && below.boundingBox === 'block' && at.boundingBox === 'empty') {
      return baseY + dy;
    }
  }
  return null;
}

/**
 * Put up a small hut: four walls with a doorway, and a flat roof.
 *
 * The geometry is entirely code — where the walls go, where the door goes, what
 * order to place so every block has something to place against. Jev's part was
 * deciding that a shelter was wanted and roughly what out of; none of the
 * layout is a judgment.
 */
async function buildShelter(bot, task, { material = 'cobblestone', size = 5, height = 3 } = {}) {
  const half = Math.floor(size / 2);
  const origin = bot.entity.position.floored();
  const baseY = groundAt(bot, origin.x, origin.z, origin.y) ?? origin.y;

  const itemFor = () => bot.inventory.items().find((i) => i.name === material);
  const needed = size * 4 * height + size * size;
  const have = (itemFor() || { count: 0 }).count;
  // Starting with 40% of the blocks meant running dry at 39 of ~70 and leaving
  // a roofless wall. Require the lot; the option's description already tells
  // Jev to gather more first.
  if (have < needed) {
    bot.chat(`I need more ${material} first — got ${have}, want about ${needed}.`);
    return false;
  }

  bot.chat(`Building a ${size}x${size} shelter out of ${material}.`);

  // Walls, bottom layer up, so each block rests on the one beneath it.
  const spots = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        const edge = Math.abs(dx) === half || Math.abs(dz) === half;
        if (!edge) continue;
        // Leave a doorway two high in the middle of one wall.
        if (dz === -half && dx === 0 && dy < 2) continue;
        spots.push(new Vec3(origin.x + dx, baseY + dy, origin.z + dz));
      }
    }
  }
  // Roof last, once the walls can support it.
  for (let dx = -half; dx <= half; dx++) {
    for (let dz = -half; dz <= half; dz++) {
      spots.push(new Vec3(origin.x + dx, baseY + height, origin.z + dz));
    }
  }

  let placed = 0, skipped = 0;
  for (const target of spots) {
    task.check();
    const item = itemFor();
    if (!item) {
      bot.chat(`Ran out of ${material} after ${placed} blocks.`);
      return placed > 0;
    }

    const existing = bot.blockAt(target);
    if (existing && existing.boundingBox === 'block') continue;

    // Place against the block below wherever possible; fall back to a side.
    const candidates = [
      { ref: target.offset(0, -1, 0), face: new Vec3(0, 1, 0) },
      { ref: target.offset(1, 0, 0), face: new Vec3(-1, 0, 0) },
      { ref: target.offset(-1, 0, 0), face: new Vec3(1, 0, 0) },
      { ref: target.offset(0, 0, 1), face: new Vec3(0, 0, -1) },
      { ref: target.offset(0, 0, -1), face: new Vec3(0, 0, 1) },
    ];

    let done = false;
    for (const { ref, face } of candidates) {
      const refBlock = bot.blockAt(ref);
      if (!refBlock || refBlock.boundingBox !== 'block') continue;
      try {
        if (bot.entity.position.distanceTo(target) > 4) {
          await navigate(bot, task, new goals.GoalNear(target.x, target.y, target.z, 3));
        }
        task.check();
        if (!bot.heldItem || bot.heldItem.name !== material) await bot.equip(item, 'hand');
        await bot.placeBlock(refBlock, face);
        placed++;
        done = true;
        break;
      } catch (err) {
        if (err instanceof Cancelled) throw err;
        // Blocked, out of reach, or the bot is standing there; try another face.
      }
    }
    if (!done) skipped++;
    await sleep(60);
  }

  bot.chat(
    skipped > 0
      ? `Shelter done — placed ${placed} blocks, couldn't reach ${skipped}.`
      : `Shelter done — ${placed} blocks.`,
  );
  return true;
}

// --- composable building blocks ---------------------------------------------
//
// These sit between one-block primitives and whole-task verbs. Each is worth
// many blocks of work but takes arguments, so they compose: a hut is clear +
// box + roof, a mine is tunnel, a bridge is a line of placements. The geometry
// is code; which one to run and with what arguments is the judgment.

/** Flatten and clear a square so there is somewhere sane to build. */
async function clearArea(bot, task, { size = 5 } = {}) {
  const half = Math.floor(size / 2);
  const o = bot.entity.position.floored();
  let removed = 0;
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        task.check();
        const pos = o.offset(dx, dy, dz);
        const block = bot.blockAt(pos);
        if (!block || block.boundingBox !== 'block' || !block.diggable) continue;
        if (block.name === 'bedrock') continue;
        try {
          if (bot.entity.position.distanceTo(pos) > 4) {
            await navigate(bot, task, new goals.GoalNear(pos.x, pos.y, pos.z, 2));
          }
          await equipBestTool(bot, block);
          await bot.dig(bot.blockAt(pos));
          removed++;
        } catch (err) {
          if (err instanceof Cancelled) throw err;
        }
      }
    }
  }
  return `cleared ${removed} blocks`;
}

/**
 * Where a block laid at this column should sit: on top of the ground if there
 * is ground within reach, else at the requested height (a bridge over a gap).
 * A fixed y is wrong more often than not — after gathering, the bot stands in
 * the pit it dug, and a line "at feet level" runs straight into solid earth.
 */
function surfaceAt(bot, x, y, z) {
  for (let dy = 3; dy >= -3; dy--) {
    const below = bot.blockAt(new Vec3(x, y + dy - 1, z));
    const at = bot.blockAt(new Vec3(x, y + dy, z));
    if (below && at && below.boundingBox === 'block' && at.boundingBox === 'empty') {
      return new Vec3(x, y + dy, z);
    }
  }
  return new Vec3(x, y, z);
}

/** Lay a straight line of blocks between two points — a wall, a bridge, a path. */
async function buildLine(bot, task, { from, to, material }) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z));
  let placed = 0, alreadySolid = 0;
  for (let i = 0; i <= steps; i++) {
    task.check();
    const t = steps === 0 ? 0 : i / steps;
    const pos = surfaceAt(
      bot,
      Math.round(from.x + (to.x - from.x) * t),
      Math.round(from.y + (to.y - from.y) * t),
      Math.round(from.z + (to.z - from.z) * t),
    );
    const item = bot.inventory.items().find((it) => it.name === material) ||
                 bot.inventory.items().find((it) => bot.registry.blocksByName[it.name]);
    if (!item) break;
    const here = bot.blockAt(pos);
    if (here && here.boundingBox === 'block') { alreadySolid++; continue; }
    // Never wall the bot into its own body.
    const feet = bot.entity.position.floored();
    if (pos.x === feet.x && pos.z === feet.z && (pos.y === feet.y || pos.y === feet.y + 1)) continue;
    const faces = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
    for (const f of faces) {
      const ref = bot.blockAt(pos.plus(f));
      if (!ref || ref.boundingBox !== 'block') continue;
      try {
        if (bot.entity.position.distanceTo(pos) > 4) {
          await navigate(bot, task, new goals.GoalNear(pos.x, pos.y, pos.z, 3));
        }
        if (!bot.heldItem || bot.heldItem.name !== item.name) await bot.equip(item, 'hand');
        await bot.placeBlock(ref, f.scaled(-1));
        placed++;
        break;
      } catch (err) {
        if (err instanceof Cancelled) throw err;
      }
    }
    await sleep(50);
  }
  return alreadySolid && !placed
    ? `placed 0 blocks — the line was already solid ground`
    : `placed ${placed} blocks`;
}

/** Dig a corridor you can walk down, rather than a pit you fall into. */
async function digTunnel(bot, task, { length = 12, dy = 0 } = {}) {
  let dug = 0;
  const yaw = bot.entity.yaw;
  const step = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
  for (let i = 1; i <= length; i++) {
    task.check();
    const base = bot.entity.position.floored().offset(
      Math.round(step.x * i), dy * i, Math.round(step.z * i),
    );
    for (const up of [0, 1]) {
      const pos = base.offset(0, up, 0);
      const block = bot.blockAt(pos);
      if (!block || block.boundingBox !== 'block' || !block.diggable || block.name === 'bedrock') continue;
      try {
        if (bot.entity.position.distanceTo(pos) > 4) {
          await navigate(bot, task, new goals.GoalNear(pos.x, pos.y, pos.z, 2));
        }
        await equipBestTool(bot, block);
        await bot.dig(bot.blockAt(pos));
        dug++;
      } catch (err) {
        if (err instanceof Cancelled) throw err;
      }
    }
  }
  return `tunnelled ${dug} blocks`;
}

module.exports = {
  Task,
  Cancelled,
  comeToSpeaker,
  followSpeaker,
  goToCoordinates,
  gatherMaterial,
  giveItems,
  attackTarget,
  reportStatus,
  craftItem,
  smeltItems,
  descendTo,
  eatSomething,
  fleeFrom,
  lightArea,
  buildShelter,
  clearArea,
  buildLine,
  digTunnel,
  ascendTo,
  explore,
  ensureCraftingTable,
  navigate,
  equipBestTool,
  pickaxeTier,
  countOf,
};
