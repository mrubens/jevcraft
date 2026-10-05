'use strict';
// Straight up through blocks that fall (note 768). Sand, red sand, gravel
// and concrete powder dug from below come down one after another, and a
// falling block passes through the body's cells and lands on the floor it
// stands on: the feet cell, then the head, and the body suffocates. 25590
// (mid-239-ai, 2026-09-30 20:04 to 20:14Z) sat under seven blocks of sand at
// y 56 for twelve minutes, straight_up never offered ("sand in it would fall
// on the head"), its staircase walking level at y 56 as each stair's cells
// filled from the sand over them; at 20:24 an unstuck dig_up of the
// sandstone over the head brought five sand down into the feet and head
// cells and it took 8 health "in wall".
// The ways a player climbs such a column, both standing still:
//   torch: a torch put on the floor in the feet cell; a falling block that
//     lands in a torch's cell breaks and drops as an item, so the block over
//     the head is dug again and again as the next comes down, until what is
//     over it is air to open sky or a block that stays. The torch is taken
//     up after (it is in the way of the block put under the feet).
//   side: the column beside, dug at head height from where the bot stands:
//     what falls in it lands on the block at its foot, in the cell beside the
//     head, not in the body's; it is dug again as each comes down. Then its
//     foot is dug, the bot steps in, and climbs that column.
// The climb then goes on as a pillar (pillar-recovery.js pillarUp), whose
// own stop (climbStop) still refuses a block that falls over the head: this
// drain is what it is handed to.
const { Vec3 } = require('vec3');

const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$|_concrete_powder$/;
const falls = b => FALLS.test(b?.name || '');
// A falling block landing in a torch's cell breaks (the game drops it as an
// item where the landing cell holds a block it cannot replace).
const BREAKS_FALL = /(^|_)torch$/;
const breaksFall = b => BREAKS_FALL.test(b?.name || '');
const open = b => !!b && b.boundingBox !== 'block' && !/water|lava|bubble_column/.test(b.name || '');
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/;
const liquid = b => LIQUID.test(b?.name || '') || [true, 'true'].includes(b?.getProperties?.().waterlogged);
// The farthest a block is dug from the eyes.
const REACH = 4.5;
const AROUND = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
// Seconds a falling block takes to come down after the block under it goes:
// two ticks before it moves, then its fall (a block in about seven ticks,
// three in about twelve). A run of them comes down together, each two ticks
// behind the one under it (FALL_EACH): under a torch the whole run is gone
// with one dig of the block holding it; dug from the side, one comes into
// the cell beside the head for each dig.
const FALL_SECONDS = { torch: 0.7, side: 0.45 }, FALL_EACH = 0.1;
const TORCH_PLACE_SECONDS = 1.5, TORCH_CRAFT_SECONDS = 1, STEP_SECONDS = 1;

const count = (bot, re) => (bot.inventory?.items?.() || []).filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
// A torch to put down: carried, or made in the pockets' own grid from a coal
// or charcoal and a stick (four torches; no table needed).
function torchSource(bot) {
  if (count(bot, /^torch$/) > 0) return { carried: true, says: `${count(bot, /^torch$/)} torch${count(bot, /^torch$/) === 1 ? '' : 'es'} carried` };
  if (count(bot, /^(coal|charcoal)$/) > 0 && count(bot, /^stick$/) > 0) return { carried: false, says: 'no torch carried: four made first from a coal and a stick carried, in the pockets\' own grid' };
  return null;
}

// The column over `feet` read for a climb through what falls: the cells from
// the one over the head (feet + 2) to open sky, each block and whether it
// falls, and what stops the read (not loaded, water or lava in or beside it,
// or a block the climb may not dig by `canDig`). Null when the column has
// nothing that falls.
function fallColumn(bot, feet, { canDig, top } = {}) {
  const cells = [];
  let fallsIn = 0;
  const limit = Number.isFinite(top) ? top + 1 : feet.y + 96;
  for (let y = feet.y + 2; y <= limit; y++) {
    const c = new Vec3(feet.x, y, feet.z), b = bot.blockAt(c);
    if (!b) return { blocked: 'not all of it is loaded' };
    if (liquid(b) || AROUND.some(d => liquid(bot.blockAt(c.plus(d))))) return { blocked: 'water or lava in or beside it' };
    if (open(b)) continue;
    if (!falls(b) && canDig && !canDig(b)) return { blocked: `${b.name.replaceAll('_', ' ')} in the way` };
    if (falls(b)) fallsIn++;
    cells.push(b);
  }
  return fallsIn ? { cells, falls: fallsIn } : null;
}

// Where the bot can drain a column beside it, standing still: a side whose
// cell beside the head and cell beside the feet are ground it can dig or
// open air, whose floor holds, with no water or lava about, and whose column
// over the cell beside the head holds blocks that fall. The one with the
// fewest blocks over it.
function sideColumn(bot, feet, { canDig } = {}) {
  let best = null;
  for (const d of AROUND) {
    const foot = feet.plus(d), head = foot.offset(0, 1, 0);
    const fb = bot.blockAt(foot), hb = bot.blockAt(head), floor = bot.blockAt(foot.offset(0, -1, 0));
    if (!fb || !hb || !floor || floor.boundingBox !== 'block' || falls(floor) || liquid(floor)) continue;
    if ([fb, hb].some(b => liquid(b) || (!open(b) && (b.diggable === false || (canDig && !falls(b) && !canDig(b)))))) continue;
    if ([foot, head].some(c => AROUND.some(e => liquid(bot.blockAt(c.plus(e)))))) continue;
    // Read from the foot: its column from the cell over the head of a body
    // standing there, with the cell beside the head counted in.
    const col = fallColumn(bot, foot.offset(0, -1, 0), { canDig });
    if (!col?.cells) continue;
    const digs = col.cells.length + (open(fb) ? 0 : 1);
    if (!best || digs < best.digs) best = { dir: d, foot, head, column: col, digs };
  }
  return best;
}

// The plan and its price: `seconds` for the drain and the climb after it
// (each block its own dig time with the tool the dig would take, a fall's
// wait for each that falls, a second a block risen), `mode` torch or side.
// `digSeconds(block)` is the caller's (surface.js), so the pickaxe's uses and
// the hand's times are read the one way every climb is priced.
function drainPlan(bot, feet, { up, top, canDig, digSeconds }) {
  const own = fallColumn(bot, feet, { canDig, top });
  if (!own) return null;
  if (own.blocked) return { blocked: own.blocked };
  const torch = torchSource(bot);
  const dig = cells => cells.reduce((n, b) => n + digSeconds(b), 0);
  if (torch) {
    // A torch put down afresh under each run of falling blocks the climb
    // meets (sandstone between two runs of sand is a second drain).
    let runs = 0, prev = false;
    for (const b of own.cells) { if (falls(b) && !prev) runs++; prev = falls(b); }
    // Only what holds a run up is dug: the run comes down whole onto the
    // torch and breaks (a run whose lowest block is over the head cell's
    // air cannot rest there, so each has a block under it to dig).
    const held = own.cells.filter(b => !falls(b));
    const seconds = dig(held) + runs * FALL_SECONDS.torch + own.falls * FALL_EACH + runs * TORCH_PLACE_SECONDS + (torch.carried ? 0 : TORCH_CRAFT_SECONDS) + up;
    return { mode: 'torch', cells: own.cells, falls: own.falls, runs, digs: held.length, torch, seconds, up };
  }
  const side = sideColumn(bot, feet, { canDig });
  if (!side) return { blocked: `${own.cells.find(falls).name.replaceAll('_', ' ')} in it would fall on the head, no torch carried or makeable to break it, and no column beside to dig from the side` };
  const footBlock = bot.blockAt(side.foot);
  const seconds = dig(side.column.cells) + (open(footBlock) ? 0 : digSeconds(footBlock)) + side.column.falls * FALL_SECONDS.side + STEP_SECONDS + up;
  return { mode: 'side', side, cells: side.column.cells, falls: side.column.falls, digs: side.digs, seconds, up };
}

function drainSays(plan) {
  if (!plan || plan.blocked) return '';
  const kinds = [...new Set(plan.cells.filter(falls).map(b => b.name.replaceAll('_', ' ')))].join(' and ');
  if (plan.mode === 'torch') return `${plan.falls} block${plan.falls === 1 ? '' : 's'} of ${kinds} in it come down once the block holding ${plan.falls === 1 ? 'it' : 'them'} is dug, through the body's cells onto its floor: a torch goes on the floor at the feet first (${plan.torch.says}), and each that lands in its cell breaks and drops, standing still; the block over the head is dug again while anything comes down into it, until what is over the head is open or stays put; then the torch is taken up and the climb goes on a block put under the feet at a time.${plan.runs > 1 ? ` ${plan.runs} runs of falling blocks, a torch put down under each.` : ''}`;
  const d = plan.side.dir, dir = d.x > 0 ? 'east' : d.x < 0 ? 'west' : d.z > 0 ? 'south' : 'north';
  return `${plan.falls} block${plan.falls === 1 ? '' : 's'} of ${kinds} over it fall as each under it is dug, and no torch is carried or makeable to break them: the column ${dir} is dug at head height from where the bot stands, what holds them up dug from below and each falling block landing beside the body (not in its cells) and dug again as the next comes down, until it is open overhead; then its foot is dug, the bot steps in, and climbs it a block put under the feet at a time.`;
}

// Waits until nothing is falling in a column (no falling_block entity over
// the cell within it) or `ms` pass.
async function settle(bot, task, cell, ms = 1500) {
  const deadline = Date.now() + ms;
  const fallingOver = () => Object.values(bot.entities || {}).some(e => e?.name === 'falling_block' && Math.floor(e.position.x) === cell.x && Math.floor(e.position.z) === cell.z && e.position.y >= cell.y - 1);
  // A tick for the server to start what the dig let go.
  await new Promise(resolve => setTimeout(resolve, 150));
  while (Date.now() < deadline && fallingOver()) { task?.check?.(); await new Promise(resolve => setTimeout(resolve, 50)); }
}

// The first block over `cell`, and whether it falls.
function firstOver(bot, cell, limit = 96) {
  for (let y = 1; y <= limit; y++) {
    const b = bot.blockAt(cell.offset(0, y, 0));
    if (!b) return null;
    if (!open(b)) return b;
  }
  return null;
}

// Digs `cell` again and again as what falls comes down into it, until it
// stays open with nothing that falls over it, or it holds a block that does
// not fall with nothing that falls over it (the pillar digs that one).
// `guard()` is checked before every dig and ends the drain when it fails.
async function drainCell(bot, task, cell, { dig, guard, max = 96 }) {
  let dug = 0;
  for (let i = 0; i < max; i++) {
    task?.check?.();
    await settle(bot, task, cell);
    const b = bot.blockAt(cell);
    if (!b) break;
    if (open(b)) {
      const next = firstOver(bot, cell);
      if (!next || !falls(next)) break;
      // Still coming down: waited for once more.
      await settle(bot, task, cell, 1000);
      if (open(bot.blockAt(cell)) && falls(firstOver(bot, cell)) && !Object.values(bot.entities || {}).some(e => e?.name === 'falling_block')) break;
      continue;
    }
    if (!falls(b) && !falls(bot.blockAt(cell.offset(0, 1, 0)))) break;
    const why = guard?.();
    if (why) throw Object.assign(new Error(`Stopped draining the column at (${cell.x}, ${cell.y}, ${cell.z}): ${why}`), { name: 'DrainStopped' });
    await dig(bot, task, cell, { requireDrops: false });
    dug++;
  }
  return dug;
}

async function craftTorch(bot) {
  const id = bot.registry?.itemsByName?.torch?.id;
  const recipe = id !== undefined && bot.recipesFor?.(id, null, 1, null)?.[0];
  if (!recipe) throw new Error('No torch can be made from the pockets');
  await bot.craft(recipe, 1, null);
}

// The drain, by the plan's mode, from where the bot stands. Returns what it
// did: { mode, dug, stepped }.
async function drainOverhead(bot, task, plan, { dig, place, navigate } = {}) {
  const feet = bot.entity.position.floored();
  if (plan.mode === 'torch') {
    if (count(bot, /^torch$/) === 0) await craftTorch(bot);
    const torch = bot.inventory.items().find(i => i.name === 'torch');
    if (!torch) throw new Error('No torch to put down under the falling blocks');
    const floor = bot.blockAt(feet.offset(0, -1, 0));
    if (!floor || floor.boundingBox !== 'block') throw new Error('No floor at the feet to put the torch on');
    if (!breaksFall(bot.blockAt(feet))) {
      await bot.equip(torch, 'hand');
      await (place ? place(floor, new Vec3(0, 1, 0)) : bot.placeBlock(floor, new Vec3(0, 1, 0)));
    }
    if (!breaksFall(bot.blockAt(feet))) throw new Error('The torch did not go down at the feet');
    // The safety rule: never a dig over the head without the torch in the
    // feet cell to break what comes down, nor with the bot moved off it.
    const guard = () => !bot.entity.position.floored().equals(feet) ? 'the bot is no longer on the cell the torch is in'
      : !breaksFall(bot.blockAt(feet)) ? 'no torch in the feet cell to break what falls' : null;
    const dug = await drainCell(bot, task, feet.offset(0, 2, 0), { dig, guard });
    // The torch taken up: the block put under the feet goes in its cell.
    if (breaksFall(bot.blockAt(feet))) { try { await bot.dig(bot.blockAt(feet)); } catch (_) { /* the pillar says it if it cannot place */ } }
    return { mode: 'torch', dug, stepped: false };
  }
  const { foot, head } = plan.side;
  // Standing still, the cell beside the head dug again as each block comes
  // down into it; nothing here is over the body.
  const guard = () => !bot.entity.position.floored().equals(feet) ? 'the bot has moved off the cell it drains from' : null;
  // What holds the run up in the column beside is dug first, from below, up
  // to the block the run sits on (note 1287): the drain digs a cell only with
  // what falls straight over it. 25597 (2026-10-05 07:34 to 07:50Z), its feet
  // at y 64 under sandstone at 65 and 66 and four sand to open sky, its twelve
  // eyes in the pack sixty blocks from its End portal, had the side drain
  // chosen and dig nothing: the sandstone at head height beside it had
  // sandstone, not sand, over it.
  // What comes down lies on the lowest floor in the column: the foot where
  // it is open, else the cell beside the head.
  const landing = open(bot.blockAt(foot)) ? foot : head;
  let held = 0;
  if (plan.side.column?.falls > 0) {
    const eye = bot.entity.position.offset(0, 1.62, 0);
    for (let c = head, i = 0; i < 8; c = c.offset(0, 1, 0), i++) {
      const b = bot.blockAt(c);
      if (!b || falls(b)) break;
      if (open(b)) continue;
      if (eye.distanceTo(c.offset(0.5, 0.5, 0.5)) > REACH) throw Object.assign(new Error(`Stopped draining the column at (${c.x}, ${c.y}, ${c.z}): the ${b.name.replaceAll('_', ' ')} holding the run up is out of reach`), { name: 'DrainStopped' });
      const why = guard();
      if (why) throw Object.assign(new Error(`Stopped draining the column at (${c.x}, ${c.y}, ${c.z}): ${why}`), { name: 'DrainStopped' });
      const under = falls(bot.blockAt(c.offset(0, 1, 0)));
      await dig(bot, task, c, { requireDrops: false });
      held++;
      if (under) break;
    }
  }
  const dug = held + await drainCell(bot, task, landing, { dig, guard });
  if (!open(bot.blockAt(foot))) await dig(bot, task, foot, { requireDrops: false });
  const { goals } = require('mineflayer-pathfinder');
  const movements = bot.pathfinder?.movements, canDig = movements?.canDig;
  if (movements) movements.canDig = false;
  try { await navigate(bot, task, new goals.GoalBlock(foot.x, foot.y, foot.z), { timeoutMs: 8000, stallMs: 3000 }); }
  finally { if (movements) movements.canDig = canDig; }
  const stepped = bot.entity.position.floored().equals(foot);
  return { mode: 'side', dug: dug + 1, stepped };
}

module.exports = { FALL_EACH, FALLS, falls, breaksFall, torchSource, fallColumn, sideColumn, drainPlan, drainSays, drainCell, drainOverhead, settle, FALL_SECONDS };
