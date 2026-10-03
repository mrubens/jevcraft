'use strict';
const { move } = require('./motion');
// A straight span over open ground. Fortresses stand over the lava sea and
// the pathfinder bridged toward one a block a minute, its search lost in
// the open air, while the bot stood on the span under blaze fire. This
// lays the span itself: one block ahead at a time, sneaking, digging what
// is in the way when it is natural rock, and stops beside the target.
const { Vec3 } = require('vec3');
const { equipBestTool } = require('./skills');

// nether_bricks (note 906): what a fortress's walls drop, laid like the rest.
const MATERIALS = ['netherrack', 'cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'andesite', 'diorite', 'granite', 'blackstone', 'basalt', 'nether_bricks'];
// The Nether's ores are its rock: gold and quartz lie through the
// netherrack, and a crossing or a leg that stopped at them ("nether gold ore
// in the way") stopped in plain rock. mid-242-ab-nether-4's legs east and
// north rested for it beside a fortress 102 blocks off (note 591).
const NATURAL = /^(netherrack|nether_gold_ore|nether_quartz_ore|crimson_nylium|warped_nylium|soul_sand|soul_soil|basalt|blackstone|magma_block|nether_wart_block|warped_wart_block|shroomlight|crimson_stem|warped_stem|crimson_hyphae|warped_hyphae|nether_sprouts|crimson_roots|warped_roots|crimson_fungus|warped_fungus|weeping_vines|twisting_vines|glowstone|gravel|stone|dirt|grass_block|sand|sandstone|andesite|diorite|granite|tuff|deepslate|cobblestone|cobbled_deepslate)/;
const passable = b => !b || b.boundingBox === 'empty';
const solid = b => b?.boundingBox === 'block';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The cell the feet stand in. Soul sand is two pixels short of a block: a
// bot on it stands at y 74.875 over the soul sand at 74, and its position
// floored is the soul sand's own cell (note 944). The tunnel laid with soul
// sand took that for its cell and went round 120 steps at the cavern's lip.
const standing = bot => {
  const p = bot.entity.position;
  return new Vec3(Math.floor(p.x), Math.floor(p.y + (bot.entity.onGround !== false ? 0.2 : 0)), Math.floor(p.z));
};
// What a span is laid with from the pack: the rock kinds first, then the
// nether and warped wart blocks, full blocks that hold where they are put
// and do not burn (shelter.js counts them for walls and cover since note
// 619). mid-242-ah-nether-1-fortress-5's trip back to the portal for food,
// at 1.1 health, laid its span out of netherrack twenty blocks over the
// cavern floor and stopped at its end "out of blocks (0 carried)" with
// thirty-two warped wart blocks in the pack, 98 blocks from the portal
// (note 622). Wool is left out: it burns, and lava sets it alight.
// The nether woods too, last (note 635; shelter.js NETHER_WOOD): full blocks
// that do not burn, and what a bot in the Nether has when the rock is gone.
// mid-242-ae-nether-2-fortress-6 stood at the end of its span over the lava
// sea with five warped stems, a warped plank and fourteen gravel, was told
// "0 blocks carried" by every price of the way back, and crafted its stems
// into planks for cover. The oak family burns beside lava and is left out.
const { NETHER_WOOD } = require('./shelter');
// Soul soil and soul sand too, after the wart blocks (note 944): full blocks
// a bare hand digs and that do not burn, laid by the pillars already
// (pillar-recovery.js SCAFFOLD) and gathered as blocks (block-stock.js
// HAND_BLOCKS). 25598 (mid-242-jc-nether-1, 2026-10-02 20:20 to 21:15Z)
// carried 83 soul sand and no pickaxe; its tunnel home stopped five times
// at the first open cell, "no blocks carried to lay the tunnel's floor",
// 338 to 421 blocks from its portal, and it went back to the search.
const LAID = [...MATERIALS, 'nether_wart_block', 'warped_wart_block', 'soul_soil', 'soul_sand', ...NETHER_WOOD];
// In the Nether the kinds a ghast's fireball does not break go down first
// (note 904): its blast takes netherrack (blast resistance 0.4) and dirt
// out from under the bot and leaves cobblestone, the stones, blackstone (6)
// and basalt (4.2) standing. 25598 (mid-242-df-nether-1, 2026-10-02
// 14:55:32Z) stood on its netherrack span twelve blocks over the lava sea,
// a ghast 57 off; at the third fireball it was off the span and in the lava,
// 20 health to none in four seconds (the blast, or its push); 25597 went the same way at 14:48Z and
// 25595 was "doomed to fall by Ghast" at 12:35Z.
const BLAST_PROOF = ['cobblestone', 'cobbled_deepslate', 'blackstone', 'basalt', 'nether_bricks', 'stone', 'andesite', 'diorite', 'granite'];
const laidOrder = bot => /nether/.test(String(bot?.game?.dimension || '')) ? [...BLAST_PROOF, ...LAID.filter(n => !BLAST_PROOF.includes(n))] : LAID;
const material = bot => laidOrder(bot).map(n => bot.inventory.items().find(i => i.name === n)).find(Boolean);
// A biter or a hopper that can push the bot off the span within its charge
// (narrow-footing.js, note 769): the span is walled on both sides as it is
// laid while one is about. Shooters stop the span outright (underFire).
// 25593 (19:14Z) laid its own cobblestone span three over the lava sea
// with magma cubes about, no wall, and a cube's blow put it in; 25585
// (15:31Z) and 25594 (15:43Z) stood on their own one-wide spans as a
// hoglin came along them.
function spanPusher(bot) {
  let about = [];
  try { about = require('./danger').threats(bot, 16); } catch (_) { return null; }
  return require('./narrow-footing').pushersAt(about, { bot }).find(p => p.how === 'blow') || null;
}
// The sides of `cell` a push along the span goes toward, open over a drop
// that kills: the two across the step (the way on and the way back are
// the span). [{ floor, wall }] still to lay.
function spanWallsAt(bot, cell, step, health = bot.health ?? 20) {
  const terrain = require('./terrain');
  const out = [];
  for (const side of [new Vec3(step.z, 0, step.x), new Vec3(-step.z, 0, -step.x)]) {
    const wall = cell.plus(side);
    if (solid(bot.blockAt(wall))) continue;
    const d = terrain.dropAt(bot, wall) ? terrain.dropNear(bot, wall, 0) : null;
    if (!d || !(d.into === 'lava' || d.into === 'unknown' || d.damage >= health / 2)) continue;
    out.push({ floor: solid(bot.blockAt(wall.offset(0, -1, 0))) ? null : wall.offset(0, -1, 0), wall, side });
  }
  return out;
}
const wallBlocksOf = walls => walls.reduce((n, w) => n + (w.floor ? 2 : 1), 0);

// Sneak to the middle of the next cell: a walk at full speed overshoots a
// one-block span. The sneak itself is held by bridgeTo for the whole span.
// `falling`: arrived once over the cell's middle while still coming down to it.
async function creepTo(bot, task, cell, ms = 2500, keys = ['forward'], { sneak = true, why = null, falling = false } = {}) {
  const centre = cell.offset(0.5, 0, 0.5);
  return move(bot, task, { label: 'bridge_step', keys, sneak, ...(why ? { why } : {}), look: centre.offset(0, 1.6, 0), maxMs: ms, tick: 40,
    until: () => { const p = bot.entity.position; return Math.hypot(p.x - centre.x, p.z - centre.z) < 0.35 && p.y < cell.y + (falling ? 1.3 : 0.6) && p.y > cell.y - 0.6; } });
}

// Never into lava: a body cell that is lava or fire is not walked into,
// and rock is dug only where nothing flows in behind it, as the staircase
// digs (tunneling.js safeExcavation). The span dug through the wall of the
// lava sea otherwise.
const BURNS = /lava|fire/;
// Nor a block laid or dug beside a floor that falls with it: gravel or sand
// resting on the lava sea drops on the next block changed beside it, and the
// body standing on it goes down with it (terrain.js floorDrops). The span's
// first block, laid against the side of the gravel mid-243-af-nether-1
// stood on at the sea's edge, dropped it and the body into the lava, 20
// health to none (note 592). `from` is the floor the body is on when the
// block changes; `changed` the block laid or dug.
function floorDropsAt(bot, changed, from) {
  const { floorDrops, floorDropDeadly, atOf } = require('./terrain');
  const h = floorDrops(atOf(bot), from, changed);
  return floorDropDeadly(h, bot.health ?? 20) ? h : null;
}
function guardFloor(bot, changed, what) {
  const feet = require('./terrain').restingCell(bot) || standing(bot);
  const from = feet.offset(0, -1, 0);
  const h = floorDropsAt(bot, changed, from);
  if (h) throw new Error(`Not ${what} at ${changed}: ${require('./terrain').floorDropSays(h, from)}`);
}
// A fortress's own wall (nether bricks, a fence) dug through where the way
// is into the fortress (`wall`): a player breaks into a corridor through its
// side. 25591 stood in the basalt between two corridors whose walls stood
// between every crossing and their floors (note 694).
const WALL = /^(nether_bricks|nether_brick_fence|cracked_nether_bricks)$/;
// And a block the bot laid itself (own-blocks.js laidAt, note 953): its own
// span's fence or wool is its own to dig through, as working free has dug
// them since note 615. 25594 (mid-242-xa-fortress-5, 2026-10-02 22:42Z),
// its rod on the bank's walk, had dig_across end at "oak fence in the way"
// 22 blocks from its portal again and again; 25598 (21:03Z) had its tunnel
// home stop at "The span is blocked by white_wool".
// In the Nether the Overworld's woods and wool are always the bot's own,
// past what laidAt keeps (its last 128).
const NOT_NETHER = /^((oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(fence|planks|log)|\w+_wool)$/;
const ownHere = (bot, block) => !!bot && (!!require('./own-blocks').laidAt(bot, block.position) || (/nether/.test(String(bot.game?.dimension || '')) && NOT_NETHER.test(block.name)));
const diggableHere = (block, wall, bot = null) => block.diggable && (NATURAL.test(block.name) || (wall && WALL.test(block.name)) || ownHere(bot, block));
// A cell dug with gravel or sand over it is dug again as the column comes
// down into it, until it stays open: the crossing does not step its head
// into a cell the column fills. 25588 (mid-243-hf, 00:26Z on 2026-09-30)
// crossed through a gravel seam, dug the head's cell, stepped in and was
// buried as the gravel over it fell, three times from 8.2 health to 1.2; each
// step aside out of it worked, and the crossing walked back in (note 705).
const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|\w+_concrete_powder)$/;
const FALL_COLUMN = 12;
async function clear(bot, task, p, { wall = false } = {}) {
  for (let n = 0; n < FALL_COLUMN; n++) {
    const block = bot.blockAt(p);
    if (block && BURNS.test(block.name)) throw new Error(`Lava in the way at ${p}`);
    if (passable(block)) return;
    if (!diggableHere(block, wall, bot)) throw new Error(`The span is blocked by ${block.name}`);
    if (!require('./tunneling').safeExcavation(bot, p)) throw new Error(`Lava or water behind the ${block.name.replaceAll('_', ' ')} at ${p}`);
    guardFloor(bot, p, 'dug');
    const column = FALLS.test(bot.blockAt(p.offset(0, 1, 0))?.name || '');
    await equipBestTool(bot, block); task.check();
    await bot.dig(block, true);
    if (!column) return;
    // The column comes down into the cell: waited for, and dug again.
    for (let t = 0; t < 30 && passable(bot.blockAt(p)); t++) { task.check(); await sleep(50); }
  }
  throw new Error(`Gravel or sand keeps falling into ${p} (more than ${FALL_COLUMN} blocks of it)`);
}

// The next cell of a straight crossing: along whichever axis has farther to
// go, one block. The survey and the span take the same cells.
function stepToward(here, target) {
  const dx = target.x - here.x, dz = target.z - here.z;
  if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) return null;
  return Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
}

// What a straight crossing at the feet's height toward `target` meets, cell
// by cell, before it is walked: rock to dig (what is natural, with nothing
// flowing behind it), open air or lava to lay a block over, and where it has
// to stop (lava in the body's way, a block that is not dug, the blocks
// carried running out). Up to `cells` cells. `tool`: the item type the
// rock would be dug with, for a crossing made after a pickaxe is (null is
// the hand); otherwise the cheapest carried.
function surveyCrossing(bot, target, { cells = 32, blocks = null, tool, from = null, wall = false } = {}) {
  const carried = blocks ?? blocksCarried(bot);
  // From the block the bot rests on, where the span begins (stepOntoFooting),
  // or `from`, the feet's cell it will stand in (a pillar's top, note 694).
  const start = from || require('./terrain').restingCell(bot) || standing(bot);
  const flat = p => Math.hypot(target.x - p.x, target.z - p.z);
  const pusher = spanPusher(bot);
  const out = { cells: 0, dig: 0, bridge: 0, overLava: 0, wallBlocks: 0, walledFor: pusher ? { name: pusher.name, distance: Math.round(pusher.distance) } : null, carried, noPickaxe: !require('./block-stock').pickaxeCarried(bot) && !tool, stoppedBy: null, from: flat(start), end: start, gain: 0, digSeconds: 0 };
  let here = start, digMs = 0;
  for (let n = 0; n < cells; n++) {
    const step = stepToward(here, target);
    if (!step) { out.stoppedBy = null; break; }
    const next = here.plus(step);
    let why = null, dig = 0, walls = 0; const before = digMs;
    for (const p of [next, next.offset(0, 1, 0)]) {
      const b = bot.blockAt(p);
      if (!b) { why = 'unloaded ground ahead'; break; }
      if (BURNS.test(b.name)) { why = 'lava in the way'; break; }
      if (passable(b)) continue;
      if (!diggableHere(b, wall, bot)) { why = `${b.name.replaceAll('_', ' ')} in the way`; break; }
      if (WALL.test(b.name)) walls++;
      if (!require('./tunneling').safeExcavation(bot, p)) { why = `lava or water behind the ${b.name.replaceAll('_', ' ')}`; break; }
      const drops = floorDropsAt(bot, p, here.offset(0, -1, 0));
      if (drops) { why = floorSays(drops, here); break; }
      dig++;
      // With the tool the dig would take (skills.js cheapestTool).
      if (typeof b.digTime === 'function' && bot.inventory?.items) { const type = tool !== undefined ? tool : require('./skills').cheapestTool(bot, b)?.type ?? null; digMs += b.digTime(type, false, false, false, [], {}); }
    }
    // A head's cell dug under a column of gravel or sand: the column comes
    // down into it and is dug too, a block at a time (clear).
    if (!why && !passable(bot.blockAt(next.offset(0, 1, 0)))) {
      let col = 0;
      for (let y = 2; y < 2 + FALL_COLUMN && FALLS.test(bot.blockAt(next.offset(0, y, 0))?.name || ''); y++) col++;
      if (col) { dig += col; digMs += col * 1000 * (require('./hand-dig').handSeconds(bot, 'gravel') ?? 0.9); }
    }
    const floor = bot.blockAt(next.offset(0, -1, 0));
    const lay = !solid(floor);
    if (!why && lay && out.bridge + 1 > carried) why = `out of blocks (${carried} carried)`;
    const drops = !why && lay && floorDropsAt(bot, next.offset(0, -1, 0), here.offset(0, -1, 0));
    if (drops) why = floorSays(drops, here);
    if (why) { out.stoppedBy = why; digMs = before; break; }
    // With a biter in reach, each cell's open sides walled as it is laid
    // (span, note 769): priced here, the blocks counted against those
    // carried.
    const w = pusher ? wallBlocksOf(spanWallsAt(bot, next, step)) : 0;
    if (w && out.bridge + (lay ? 1 : 0) + out.wallBlocks + w > carried) { out.stoppedBy = `out of blocks to wall the span's sides with the ${pusher.name.replaceAll('_', ' ')} ${Math.round(pusher.distance)} blocks off (${carried} carried)`; digMs = before; break; }
    out.wallBlocks += w;
    out.cells++; out.dig += dig; if (walls) out.wall = (out.wall || 0) + walls;
    if (lay) { out.bridge++; if (lavaBelow(bot, next.offset(0, -1, 0))) out.overLava++; }
    here = next;
  }
  out.end = here; out.digSeconds = Math.round(digMs / 100) / 10;
  out.gain = Math.round((out.from - flat(here)) * 10) / 10;
  return out;
}
// Where the crossing stops for a floor that falls (floorDropsAt).
const floorSays = (h, here) => require('./terrain').floorDropSays(h, here.offset(0, -1, 0));
// Lava is what lies under a laid block, below the open air: the lava sea.
function lavaBelow(bot, p, deepest = 48) {
  for (let dy = 0; dy <= deepest; dy++) {
    const b = bot.blockAt(p.offset(0, -dy, 0));
    if (!b) return false;
    if (/lava/.test(b.name)) return true;
    if (!passable(b)) return false;
  }
  return false;
}
const blocksCarried = bot => (bot.inventory?.items?.() || []).filter(i => LAID.includes(i.name)).reduce((n, i) => n + i.count, 0);

// Lay a level span toward `target` from where the bot stands, until beside
// or above it, out of blocks, or `maxBlocks` placed. Returns the blocks laid.
// The span is one block wide over whatever is below it, and the bot fell
// off one: it sneaked only while stepping onto each new block and stood
// upright at the end of the span while it dug ahead, turned and placed.
// Now it crouches from the first block to the last, and a sneaking player
// cannot walk off an edge. Nor is a span laid under fire: with a shooter
// that can see it, the bot stops rather than stand in the open on one
// block, and the approach finds another way.
const SHOOTER_RANGE = 24, FIRE_LANDS = 0.02;
// Each shooter within its own reach: a ghast's is forty, and mid-230-j laid
// a span toward its portal with one in sight thirty-nine blocks off, was hit
// by its fireball and thrown sixteen blocks down (2026-09-27).
function underFire(bot) {
  const { threats } = require('./danger'), { shooter } = require('./mob-policy'), ce = require('./combat-estimate'), { RANGE } = ce;
  // Not one whose shots, by the record's own measure at its distance, land
  // under one in fifty (note 913): a crossbow piglin eight blocks off and
  // more (3 bolts landed in 3,143 seconds from 8 to 12 blocks, none in
  // 13,000 beyond). 25595 (mid-242-rb-fortress-4, 2026-10-02 15:58Z), three
  // rods carried, had its tunnel home stop at the first open cell, "a piglin
  // 23 blocks off can see the bot", and stood five minutes with the tunnel
  // set aside. A shooter with no measure is counted as before.
  const lands = t => { try { const m = ce.shotModel(t.entity.name, t.distance); return m && Number.isFinite(m.lands) ? m.lands : null; } catch (_) { return null; } };
  return threats(bot, 64).find(t => t.visible && shooter(t.entity) && t.distance <= Math.max(SHOOTER_RANGE, RANGE[t.entity.name] || 0) && !(lands(t) !== null && lands(t) < FIRE_LANDS));
}
// The span's own check, the one it runs before each cell: offered by the
// same words it would stop with. 25591 (mid-242-jb, 22:19:52Z on
// 2026-09-29) was offered two crossings to crimson stems with a piglin in
// sight, chose each, and each stopped in its first second, "Not bridging
// with a piglin 17 blocks off able to see me" (note 695). A way that lays
// or digs its way across is not offered while this holds; it is said.
// -> null, or { fire, says }.
function spanRefused(bot) {
  let fire = null;
  try { fire = underFire(bot); } catch (_) { fire = null; }
  if (!fire) return null;
  const name = String(fire.entity?.name || 'mob').replaceAll('_', ' ');
  return { fire, says: `a ${name} ${Math.round(fire.distance)} blocks off can see the bot, and no span is laid while something that shoots can` };
}
// `maxSteps` cells at most: a crossing laid a stretch at a time, as far as
// its survey saw.
// While it is laid the bot is on the span (terrain.js onSpan): no reflex
// swings at a mob or turns to one until it is done.
async function bridgeTo(bot, task, target, { maxBlocks = 64, maxSteps = maxBlocks * 2, wall = false } = {}) {
  const spanning = { target: { x: target.x, y: target.y, z: target.z }, since: Date.now() };
  bot._spanning = spanning;
  bot.setControlState('sneak', true);
  try { return await span(bot, task, target, maxBlocks, maxSteps, { wall }); }
  finally {
    // The crouch let go only once the body has stopped: let go with the
    // walk, the step's way on carried mid-227-h off the end of its span, no
    // key held, fifteen blocks down among magma cubes (2026-09-27).
    bot.setControlState('forward', false);
    for (let n = 0; n < 10; n++) { const v = bot.entity?.velocity; if (!v || Math.hypot(v.x, v.z) < 0.01) break; await sleep(50); }
    bot.setControlState('sneak', false);
    if (bot._spanning === spanning) bot._spanning = null;
  }
}
async function span(bot, task, target, maxBlocks, maxSteps, { wall = false } = {}) {
  let placed = 0;
  for (let steps = 0; steps < maxSteps; steps++) {
    task.check();
    const refused = spanRefused(bot);
    if (refused) throw new Error(`Not bridging with a ${refused.fire.entity.name} ${Math.round(refused.fire.distance)} blocks off able to see me`);
    const here = standing(bot);
    const step = stepToward(here, target);
    if (!step) return placed;
    const next = here.plus(step);
    // Standing squarely on the support block first: a placement from the
    // edge misses the face.
    const support = bot.blockAt(here.offset(0, -1, 0));
    if (!solid(support)) {
      // Crouched over an edge, resting on the block beside: onto it first,
      // as the survey counted from it (note 533).
      const rest = require('./terrain').restingCell(bot);
      if (!rest || rest.equals(here) || !await creepTo(bot, task, rest, 1500)) throw new Error('Nothing solid underfoot to bridge from');
      continue;
    }
    await clear(bot, task, next, { wall }); await clear(bot, task, next.offset(0, 1, 0), { wall });
    if (!solid(bot.blockAt(next.offset(0, -1, 0)))) {
      if (placed >= maxBlocks) return placed;
      const item = material(bot);
      if (!item) throw new Error('No blocks to bridge with');
      const centre = here.offset(0.5, 0, 0.5), p = bot.entity.position;
      if (Math.hypot(p.x - centre.x, p.z - centre.z) > 0.3) await creepTo(bot, task, here, 1200);
      guardFloor(bot, next.offset(0, -1, 0), 'laid');
      await bot.equip(item, 'hand'); task.check();
      await bot.lookAt(support.position.offset(0.5 + step.x * 0.5, 0.5, 0.5 + step.z * 0.5), true);
      await bot.placeBlock(support, step);
      if (!solid(bot.blockAt(next.offset(0, -1, 0)))) throw new Error('The span block did not land');
      placed++;
    }
    // With a biter in reach, the new cell's open sides walled before it is
    // stepped onto: a floor beside the span's own, the wall on it.
    const pusher = spanPusher(bot);
    if (pusher) {
      const walls = spanWallsAt(bot, next, step);
      const need = wallBlocksOf(walls), have = blocksCarried(bot);
      if (need && have < need) throw new Error(`Not bridging with a ${pusher.name.replaceAll('_', ' ')} ${Math.round(pusher.distance)} blocks off: its blow knocks the bot off a span one wide, and ${have} block${have === 1 ? '' : 's'} carried do not wall this cell's ${walls.length} open side${walls.length === 1 ? '' : 's'} (${need})`);
      for (const w of walls) {
        for (const [p, ref, face] of [...(w.floor ? [[w.floor, next.offset(0, -1, 0), w.side]] : []), [w.wall, w.floor || w.wall.offset(0, -1, 0), new Vec3(0, 1, 0)]]) {
          if (solid(bot.blockAt(p))) continue;
          const item = material(bot);
          if (!item) throw new Error('No blocks left to wall the span');
          const refBlock = bot.blockAt(ref);
          if (!solid(refBlock)) throw new Error(`Nothing to lay the span's wall against at ${p}`);
          task.check();
          await bot.equip(item, 'hand'); task.check();
          await bot.lookAt(ref.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5), true);
          await bot.placeBlock(refBlock, face);
          if (!solid(bot.blockAt(p))) throw new Error(`The span's wall block at ${p} did not land`);
        }
      }
    }
    if (!await creepTo(bot, task, next)) throw new Error('Could not step onto the span');
    if (bot.entity.position.y < here.y - 0.5) throw new Error('Fell off the span');
  }
  return placed;
}

// Down a staircase of laid blocks to a floor below with open air between
// (note 839): a block laid ahead level with the one stood on, one laid
// under it, the first dug out, and a step down onto the second, a block
// down and a block on each time. A bridge built level toward a fortress
// left 25585 sixteen to twenty blocks over its one-wide bridge at (15, 60,
// -176) five times from 17:11 to 21:34Z on 2026-10-01, every way down
// refused (no rock to dig, a drop over lava), and it left the fortress each
// time. Stops level with `target` (its top, stood on at target.y + 1), at
// lava in the way, or after maxSteps. -> steps taken
async function stairsDown(bot, task, target, { maxSteps = 40 } = {}) {
  let steps = 0, last = null;
  const molten = b => /lava|water|fire/.test(b?.name || '');
  while (steps < maxSteps) {
    task.check();
    const here = standing(bot);
    if (here.y - 1 <= target.y) return steps;
    const dx = target.x - here.x, dz = target.z - here.z;
    // One way the whole flight: turned back, it would step into its own dug cells.
    const d = last || (Math.abs(dx) >= Math.abs(dz) && dx !== 0 ? new Vec3(Math.sign(dx), 0, 0) : dz !== 0 ? new Vec3(0, 0, Math.sign(dz)) : new Vec3(1, 0, 0));
    last = d;
    const support = bot.blockAt(here.offset(0, -1, 0));
    if (!solid(support)) throw new Error('Nothing solid underfoot to lay the stairs down from');
    const head = here.plus(d), a = head.offset(0, -1, 0), b = head.offset(0, -2, 0);
    // The cell over the one stepped through too (note 916): the step is
    // taken upright, and in a tunnel that cell is rock. 25585 and 25583
    // (2026-10-02 16:20Z on), their tunnels toward lava over a cave, had
    // every laid step down end at the lip ("not reached", ten in a row a
    // block on each time) and went on level.
    const over = head.offset(0, 1, 0);
    if ([over, head, a, b].some(c => molten(bot.blockAt(c)))) throw new Error(`Lava or water in the way of the stairs down at ${head}`);
    await clear(bot, task, over, { wall: true });
    await clear(bot, task, head, { wall: true });
    if (!solid(bot.blockAt(b))) {
      const item = material(bot);
      if (!item) throw new Error('No blocks to lay the stairs down with');
      const centre = here.offset(0.5, 0, 0.5), p = bot.entity.position;
      if (Math.hypot(p.x - centre.x, p.z - centre.z) > 0.3) await creepTo(bot, task, here, 1200);
      if (!solid(bot.blockAt(a))) {
        await bot.equip(item, 'hand'); task.check();
        await bot.lookAt(support.position.offset(0.5 + d.x * 0.5, 0.5, 0.5 + d.z * 0.5), true);
        await bot.placeBlock(support, d);
        if (!solid(bot.blockAt(a))) throw new Error('The block ahead did not land');
      }
      const again = material(bot);
      if (!again) throw new Error('No blocks to lay the stairs down with');
      await bot.equip(again, 'hand'); task.check();
      const above = bot.blockAt(a);
      await bot.lookAt(a.offset(0.5, 0, 0.5), true);
      await bot.placeBlock(above, new Vec3(0, -1, 0));
      if (!solid(bot.blockAt(b))) throw new Error('The step down did not land');
    }
    // A guard beyond the step, level with it: the step down is taken
    // upright, and upright the body goes on past a cell with open air
    // beyond it (motion.js refuses such a step over a deadly fall, rightly).
    // The next step digs it out as its headroom.
    const guard = a.plus(d);
    if (!solid(bot.blockAt(guard)) && solid(bot.blockAt(a))) {
      const item = material(bot);
      if (!item) throw new Error('No blocks to lay the stairs down with');
      if (molten(bot.blockAt(guard))) throw new Error(`Lava or water beyond the step at ${guard}`);
      await bot.equip(item, 'hand'); task.check();
      await bot.lookAt(a.offset(0.5 + d.x * 0.5, 0.5, 0.5 + d.z * 0.5), true);
      await bot.placeBlock(bot.blockAt(a), d);
      if (!solid(bot.blockAt(guard))) throw new Error('The guard beyond the step did not land');
    }
    await clear(bot, task, a);
    if (solid(bot.blockAt(a))) throw new Error(`The way onto the step at ${a} would not clear`);
    // Upright: a crouched step does not go over the edge a block down.
    // To the lip crouched first (note 907): from a standing start a block
    // back the upright body crossed the one-block hole before it had
    // fallen a step's height, came up onto the guard's top (level with the
    // floor it left) and walked on off the stairs: in the arena's cavern
    // drill five runs of eight ended nine blocks down on the cavern floor
    // for five or six health. Crouched it stops at the lip; from there the
    // upright step starts at rest and goes down into the cell.
    await creepTo(bot, task, a, 900, ['forward'], { sneak: true });
    bot.clearControlStates?.();
    await sleep(120);
    const okStep = await creepTo(bot, task, a, 1500, ['forward'], { sneak: false, why: 'a step a block down onto the stairs laid, the cell beyond it walled by nothing but stopped at its centre' });
    // Said in the log each time (note 915): 25595 (2026-10-02 16:12:48Z),
    // three rods carried, fell ten blocks from its span onto its portal's
    // floor a second into this step, and nothing recorded what stood under
    // it; the arena's drills do not show it.
    { const q = bot.entity.position; console.log(`[stairs] laid step down from ${here} to ${a}: ${okStep ? 'stepped' : 'not reached'}; at (${q.x.toFixed(1)}, ${q.y.toFixed(1)}, ${q.z.toFixed(1)}), under the step ${bot.blockAt(b)?.name}, beyond it ${bot.blockAt(guard)?.name}, health ${Math.round((bot.health ?? 0) * 10) / 10}`); }
    if (!okStep) throw new Error('Could not step down onto the stairs');
    if (bot.entity.position.y < a.y - 0.5) throw new Error('Fell off the stairs down');
    steps++;
  }
  return steps;
}

// A tunnel dug straight at `target` through the rock (note 860): two high
// and one wide, a step down or up with each block until level with the
// target, a block laid where the floor is missing, and over, under or round
// any lava met (no cell is dug with lava or water behind it, clear's rule).
// In the rock no ghast or blaze has a line to the bot and there is no drop
// beside it. 25592 (mid-220-ar, 2026-10-01 21:50 to 22:04Z), six blaze rods
// carried at full health and 255 blocks from its portal with the straight
// line to it "96 of 96 on ground", was offered a leg round to the left, one
// to the right and a wait; every walk and staircase had failed, and the
// trial ended there, the best rod run of the record. Ends within `near`
// blocks of the target across, after maxSteps, or where no way on is safe.
// -> { steps, laid, arrived }
const QUARRY_WANT = 24, QUARRY_BACK = 12, QUARRY_MOVES = 4;
// Arrived across and more than this over the target: the tunnel comes down (note 920).
const OVER = 1;
async function tunnelStraight(bot, task, target, { maxSteps = 96, near = 4, navigate = null, down = false } = {}) {
  let steps = 0, laid = 0, sideRun = 0, lastSide = null;
  const flatTo = p => Math.hypot(target.x - p.x, target.z - p.z);
  const molten = b => BURNS.test(b?.name || '') || /water/.test(b?.name || '');
  const step = async (here, d, dy) => {
    const n = here.plus(d).offset(0, dy, 0), floor = n.offset(0, -1, 0);
    // The cells the body passes through, top first.
    const body = dy === 0 ? [n.offset(0, 1, 0), n]
      : dy < 0 ? [here.plus(d).offset(0, 1, 0), here.plus(d), n]
        : [here.offset(0, 2, 0), n.offset(0, 1, 0), n];
    // Read before anything is dug: no lava in the way, under the step, or over the head.
    if ([...body, n.offset(0, 2, 0)].some(c => molten(bot.blockAt(c)))) throw new Error(`lava in the way at ${n}`);
    if (molten(bot.blockAt(floor)) && dy !== 0) throw new Error(`lava under the step at ${n}`);
    if (dy !== 0 && !solid(bot.blockAt(floor))) throw new Error(`no floor for a step ${dy < 0 ? 'down' : 'up'} at ${n}`);
    // A fortress's bricks and fences in the line are dug too (clear's wall): a
    // tunnel begun inside one stopped at its first wall (note 864).
    for (const c of body) await clear(bot, task, c, { wall: true });
    let laidHere = false;
    if (!solid(bot.blockAt(floor))) {
      const refused = spanRefused(bot);
      if (refused) throw new Error(`open air ahead, and a floor is not laid there: ${refused.says}`);
      const support = bot.blockAt(here.offset(0, -1, 0));
      if (!solid(support)) throw new Error('nothing solid underfoot to lay the tunnel\'s floor from');
      // None carried: one dug from the tunnel's own wall (note 906), its
      // drop picked up where it falls beside the feet. 25591
      // (mid-242-wb-fortress-3, 2026-10-02 14:51 to 15:03Z), a rod on its
      // bank's walk with two pickaxes and no block in its pack, had its
      // tunnel stop three times at the first open cell, 114 and 88 blocks
      // from its portal: "no blocks carried to lay the tunnel's floor".
      let item = material(bot);
      if (!item) { await quarry(here, d); item = material(bot); }
      if (!item) throw new Error('no blocks carried to lay the tunnel\'s floor over open air');
      const centre = here.offset(0.5, 0, 0.5), p = bot.entity.position;
      if (Math.hypot(p.x - centre.x, p.z - centre.z) > 0.3) await creepTo(bot, task, here, 1200);
      await bot.equip(item, 'hand'); task.check();
      await bot.lookAt(support.position.offset(0.5 + d.x * 0.5, 0.5, 0.5 + d.z * 0.5), true);
      await bot.placeBlock(support, d);
      if (!solid(bot.blockAt(floor))) throw new Error(`the floor block at ${floor} did not land`);
      laid++; laidHere = true;
    }
    // Crouched where the floor was laid or ends beyond: a crouched body does not go over an edge.
    const sneak = dy === 0 && (laidHere || !solid(bot.blockAt(floor.plus(d))));
    // A step down with nothing standing beyond it (note 916): upright from
    // a walk the body crosses the cell stepped to before it has fallen into
    // it, is not seen to arrive, and walks on for the rest of the three
    // seconds (twelve blocks along a cave's floor in the arena's drill; off
    // whatever edge lies that way anywhere else). So: crouched to the lip,
    // which a crouched body does not go over, then upright from rest, the
    // keys let go as it comes over the cell whatever its height, and the
    // landing waited for.
    const runsOn = dy < 0 && !solid(bot.blockAt(n.plus(d))) ;
    let ok;
    if (runsOn) {
      await creepTo(bot, task, n, 900, ['forward'], { sneak: true });
      bot.clearControlStates?.();
      await sleep(120);
      ok = await creepTo(bot, task, n, 1500, ['forward'], { sneak: false, falling: true, why: 'a step a block down in a tunnel onto a floor that stands, taken from rest at its lip' });
      bot.clearControlStates?.();
      for (let t = 0; t < 20 && !bot.entity.onGround; t++) { task.check(); await sleep(50); }
      const p = bot.entity.position;
      ok = ok && Math.hypot(p.x - (n.x + 0.5), p.z - (n.z + 0.5)) < 0.8;
    } else ok = await creepTo(bot, task, n, 3000, dy > 0 ? ['forward', 'jump'] : ['forward'], { sneak, why: 'a step along a tunnel dug two high through rock, its floor solid under the cell stepped to' });
    if (!ok) throw new Error(`could not step ${dy > 0 ? 'up ' : dy < 0 ? 'down ' : ''}to ${n}`);
    if (bot.entity.position.y < n.y - 0.6) throw new Error('fell from the tunnel\'s floor');
  };
  // Blocks for the floor from the tunnel's own walls (note 906): the cells
  // beside the feet and the head and the roof, where it stands and back
  // along the way it came (up to twelve cells, each stood in so its drops
  // are picked up), nothing molten against any, never the floor; then back
  // to where it stood. Up to QUARRY_WANT blocks.
  const quarry = async (here, d) => {
    // Only blocks the tools carried make drop (note 964): by hand netherrack
    // drops nothing, and the walk back along the tunnel for its walls was
    // for nothing. 25593 (mid-242-nc-fortress-6, 2026-10-03 02:34 to
    // 02:38Z), no pickaxe, crawled back 9 blocks through its own tunnel
    // away from its portal, about 17 seconds a block, digging walls that
    // gave nothing.
    const tools = (bot.inventory?.items?.() || []).filter(i => /_(pickaxe|shovel|axe)$/.test(i.name)).map(i => i.type);
    const yields = b => !b.harvestTools || tools.some(t => b.harvestTools[t]);
    const wallsAround = [new Vec3(d.z, 0, d.x), new Vec3(-d.z, 0, -d.x)].flatMap(v => [here.plus(v), here.plus(v).offset(0, 1, 0)]).map(c => bot.blockAt(c)).filter(b => solid(b));
    if (wallsAround.length && !wallsAround.some(b => LAID.includes(DROP_OF[b.name] || b.name) && yields(b))) return;
    const sides = [new Vec3(d.z, 0, d.x), new Vec3(-d.z, 0, -d.x)];
    const around = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0), new Vec3(0, -1, 0)];
    const digAround = async c => {
      for (const q of [...sides.map(v => c.plus(v)), ...sides.map(v => c.plus(v).offset(0, 1, 0)), c.offset(0, 2, 0)]) {
        task.check();
        if (blocksCarried(bot) >= QUARRY_WANT) return;
        const b = bot.blockAt(q);
        if (!solid(b) || !LAID.includes(DROP_OF[b.name] || b.name) || !yields(b)) continue;
        if (around.some(v => molten(bot.blockAt(q.plus(v))))) continue;
        const had = blocksCarried(bot);
        try { await clear(bot, task, q, { wall: true }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; continue; }
        for (let i = 0; i < 12 && blocksCarried(bot) <= had; i++) { await sleep(100); task.check(); }
      }
    };
    await digAround(here);
    const trail = [];
    for (let k = 1; k <= QUARRY_BACK && blocksCarried(bot) < QUARRY_WANT; k++) {
      const c = here.minus(d.scaled(k));
      // Only along a floor that stands, through cells open two high: the tunnel it dug.
      if (!solid(bot.blockAt(c.offset(0, -1, 0))) || solid(bot.blockAt(c)) || solid(bot.blockAt(c.offset(0, 1, 0)))) break;
      if (!await creepTo(bot, task, c, 2500)) break;
      trail.push(c);
      await digAround(c);
    }
    // Back to where the floor is wanted, cell by cell along its own way.
    for (const c of [...trail.slice(0, -1).reverse(), here]) { if (trail.length) await creepTo(bot, task, c, 2500); }
    return blocksCarried(bot) > 0;
  };
  while (steps < maxSteps) {
    task.check();
    // From the cell over the block the body rests on (terrain.js restingCell):
    // at an edge the feet's own cell has air under it (note 864).
    let here = standing(bot);
    if (!solid(bot.blockAt(here.offset(0, -1, 0)))) {
      let rest = null; try { rest = require('./terrain').restingCell(bot); } catch (_) { rest = null; }
      if (rest && solid(bot.blockAt(rest.offset(0, -1, 0)))) { here = rest; await creepTo(bot, task, here, 1200); }
    }
    // Arrived across but still over its target (note 920): down from here,
    // a step a block, each to the cell that keeps nearest the target (toward
    // it, beside it, back under where it stood: a stair turned on itself),
    // dug where rock stands under the step and laid where it is open air.
    // "Arrived" at any height left 25592 (mid-242-gd-nether-1, 2026-10-02
    // 17:11 to 17:20Z) twelve blocks straight over its portal, one across:
    // its tunnel home ended as it began, the walk in had no route past the
    // drop, the legs round went thirty-two blocks off and back; and 25595
    // (16:12Z, three rods carried) ten over its portal on its own span.
    // Where the caller asks for it (`down`: the tunnel home to a portal).
    const high = here.y - target.y;
    if (down && flatTo(here.offset(0.5, 0, 0.5)) <= near && high > OVER) {
      const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
        .map(v => ({ v, far: flatTo(here.plus(v).offset(0.5, 0, 0.5)) })).filter(x => x.far <= near + 2).sort((p, q) => p.far - q.far);
      const whys = [];
      let went = false;
      for (const { v } of dirs) {
        for (const how of ['dug', 'laid']) {
          try {
            const before = standing(bot).y;
            if (how === 'dug') await step(here, v, -1);
            // Short of the blocks the laid steps left will take (two a
            // step: the one under it and the guard beyond), they are dug
            // from the walls of its own way first, while it still stands
            // in rock (notes 906, 924): on the laid steps in open air there
            // is no wall to dig.
            else { if (blocksCarried(bot) < Math.min(QUARRY_WANT, 2 * high + 2)) await quarry(here, v); await stairsDown(bot, task, new Vec3(here.x + v.x * 16, here.y - 2, here.z + v.z * 16), { maxSteps: 1 }); laid += 2; }
            if (standing(bot).y >= before) throw new Error('the step did not go down');
            went = true; if (process.env.TUNNEL_DEBUG) console.log(`[tunnel-debug] over the target, ${high} up: ${here} ${how} down -> ${standing(bot)} hp ${bot.health}`);
            break;
          } catch (err) {
            task.check();
            if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err;
            whys.push(`${how} down ${v.x ? (v.x > 0 ? 'east' : 'west') : (v.z > 0 ? 'south' : 'north')}: ${String(err.message).slice(0, 60)}`);
            if (!standing(bot).equals(here)) { went = true; break; }
          }
        }
        if (went) break;
      }
      if (!went) throw Object.assign(new Error(`The tunnel stopped ${high} blocks over its target, ${Math.round(flatTo(here))} across, after ${steps} blocks: ${whys.join('; ')}`), { steps, laid });
      steps++;
      continue;
    }
    if (flatTo(here.offset(0.5, 0, 0.5)) <= near) return { steps, laid, arrived: true };
    const d = stepToward(here, target);
    if (!d) return { steps, laid, arrived: true };
    const want = here.y > target.y ? -1 : here.y < target.y ? 1 : 0;
    const sides = [new Vec3(d.z, 0, d.x), new Vec3(-d.z, 0, -d.x)].filter(v => !lastSide || !(v.x === -lastSide.x && v.z === -lastSide.z));
    if (lastSide) sides.sort((a, b) => (b.x === lastSide.x && b.z === lastSide.z) - (a.x === lastSide.x && a.z === lastSide.z));
    const tries = [[d, want], [d, 0], [d, 1], [d, -1]].filter(([, y], i, all) => all.findIndex(([, q]) => q === y) === i).map(([v, y]) => ({ v, y, side: false }));
    // Over open air with the target below and near (note 867): a step down
    // on blocks laid (stairsDown's own step), so the tunnel does not arrive
    // level over a drop to its target. Only once the way left across is no
    // more than the drop left and a few blocks: farther off the rock may
    // come back under it, and each laid step is two or three blocks.
    if (want === -1 && flatTo(here.offset(0.5, 0, 0.5)) <= (here.y - target.y) + 3) tries.splice(1, 0, { v: d, y: -1, side: false, laid: true });
    if (sideRun < 6) for (const v of sides) tries.push({ v, y: 0, side: true });
    const whys = [];
    let went = null;
    for (const t of tries) {
      try {
        if (t.laid) {
          const before = standing(bot).y;
          await stairsDown(bot, task, new Vec3(here.x + t.v.x * 16, here.y - 2, here.z + t.v.z * 16), { maxSteps: 1 });
          if (standing(bot).y >= before) throw new Error('the laid step down did not go down');
          laid += 2;
        } else await step(here, t.v, t.y);
        went = t; if (process.env.TUNNEL_DEBUG) console.log(`[tunnel-debug] ${here} ${t.laid ? 'laid-down' : t.side ? 'aside' : t.y} -> ${standing(bot)} hp ${bot.health}`); break;
      }
      catch (err) {
        task.check();
        if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err;
        if (process.env.TUNNEL_DEBUG) console.log(`[tunnel-debug] ${here} ${t.laid ? 'laid-down' : t.side ? 'aside' : t.y} FAILED ${err.message} at ${standing(bot)} hp ${bot.health}`);
        whys.push(`${t.laid ? 'down on laid blocks' : t.side ? 'aside' : t.y > 0 ? 'up' : t.y < 0 ? 'down' : 'level'}: ${String(err.message).slice(0, 80)}`);
        // Moved off the cell by a step that failed part way: read again from where it is.
        if (!standing(bot).equals(here)) break;
      }
    }
    if (!went) {
      if (!standing(bot).equals(here) && steps < maxSteps) { steps++; continue; }
      throw Object.assign(new Error(`The tunnel stopped ${Math.round(flatTo(here))} blocks from its target after ${steps} blocks: ${whys.join('; ')}`), { steps, laid });
    }
    steps++;
    if (went.side) { sideRun++; lastSide = went.v; } else { sideRun = 0; }
  }
  return { steps, laid, arrived: false };
}

// A way across along the ground, as fortress-map.js crossing found it,
// walked cell by cell, crouched: lava lying on the floor covered (a block
// laid into it from the floor under it takes its place, and the way goes on
// a block up), or its source scooped with an empty bucket when `scoop`;
// rock filling the way dug (clear: natural rock with nothing flowing behind
// it); open air with no floor spanned from the block stood on. Every cell
// is read again as it is reached: lava that has run onto the way since the
// look is not walked into. mid-242-aa-fortress-2's corridor was cut off
// from its spawners by a lava fall onto its floor, every way across "lava
// in the way" (note 564). Returns what it laid, dug and scooped.
async function crossAlong(bot, task, crossing, { navigate = null, scoop = false } = {}) {
  const { goals } = require('mineflayer-pathfinder');
  const [fx, fs, fz] = crossing.from;
  const start = new Vec3(fx, fs, fz);
  if (standing(bot).distanceTo(start) >= 1 && navigate) {
    await navigate(bot, task, new goals.GoalBlock(fx, fs, fz), { timeoutMs: 30000, stallMs: 6000, onFoot: true });
  }
  if (standing(bot).distanceTo(start) >= 1.5) throw new Error(`Not at the start of the crossing at (${fx}, ${fs}, ${fz})`);
  const done = { laid: 0, dug: 0, scooped: 0 };
  const spanning = { target: { x: crossing.to[0], y: crossing.to[1], z: crossing.to[2] }, since: Date.now() };
  bot._spanning = spanning;
  bot.setControlState('sneak', true);
  const lay = async (ref, face, what) => {
    const item = material(bot);
    if (!item) throw new Error(`No blocks left to lay ${what}`);
    guardFloor(bot, ref.position.plus(face), `laid ${what}`);
    await bot.equip(item, 'hand'); task.check();
    await bot.lookAt(ref.position.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5), true);
    await bot.placeBlock(ref, face);
    if (!solid(bot.blockAt(ref.position.plus(face)))) throw new Error(`The block laid ${what} did not land`);
    done.laid++;
  };
  try {
    for (const q of crossing.cells) {
      task.check();
      const refused = spanRefused(bot);
      if (refused) throw new Error(`Not crossing with a ${refused.fire.entity.name} ${Math.round(refused.fire.distance)} blocks off able to see me`);
      const here = standing(bot), cell = new Vec3(q.x, q.y, q.z), bed = cell.offset(0, -1, 0);
      const step = cell.minus(here);
      if (Math.abs(step.x) + Math.abs(step.z) !== 1 || Math.abs(step.y) > 1) throw new Error(`Off the crossing at ${here}, the next cell ${cell}`);
      // Lava lying where the feet go down: scooped where it is a source and
      // a bucket is carried, else covered by a block laid on the floor under it.
      const under = bot.blockAt(bed);
      if (/lava/.test(under?.name || '')) {
        const level = require('./fortress-map').lavaLevel(under);
        if (scoop && level === 0 && bot.inventory.items().some(i => i.name === 'bucket')) {
          await require('./water').fillBucket(bot, task, bed, { fluid: 'lava' }); done.scooped++;
        }
        if (/lava/.test(bot.blockAt(bed)?.name || '')) {
          const floor = bot.blockAt(bed.offset(0, -1, 0));
          if (!solid(floor)) throw new Error(`No floor under the lava at ${bed}`);
          await lay(floor, new Vec3(0, 1, 0), `into the lava at ${bed}`);
        }
      }
      await clear(bot, task, cell); await clear(bot, task, cell.offset(0, 1, 0));
      if (!solid(bot.blockAt(bed))) {
        // Open air with no floor: laid level from the block stood on.
        const support = bot.blockAt(here.offset(0, -1, 0));
        if (step.y !== 0 || !solid(support)) throw new Error(`Nothing to lay the next block from at ${here}`);
        await lay(support, new Vec3(step.x, 0, step.z), `over the open air at ${bed}`);
      }
      if (step.y > 0 && !passable(bot.blockAt(here.offset(0, 2, 0)))) throw new Error(`No room to step up from ${here}`);
      if (!await creepTo(bot, task, cell, 2500, step.y > 0 ? ['forward', 'jump'] : ['forward'])) throw new Error(`Could not step onto ${cell}`);
      if (bot.entity.position.y < cell.y - 0.6) throw new Error('Fell off the crossing');
    }
  } finally {
    bot.setControlState('forward', false); bot.setControlState('jump', false);
    for (let n = 0; n < 10; n++) { const v = bot.entity?.velocity; if (!v || Math.hypot(v.x, v.z) < 0.01) break; await sleep(50); }
    bot.setControlState('sneak', false);
    if (bot._spanning === spanning) bot._spanning = null;
  }
  return done;
}

// Crouched over an edge with the block under the middle open, a step back
// onto the block the body rests on, crouched all the way: every way on is
// measured from a cell with a floor. mid-235-p-nether-3 stood so for twenty
// seconds while the pathfinder pressed no key, and then every way to its
// fortress failed at once, fifteen questions in three seconds (note 533).
// True when it stepped.
async function stepOntoFooting(bot, task) {
  const here = bot.entity?.position?.floored?.();
  if (!here || typeof bot.blockAt !== 'function' || typeof bot.setControlState !== 'function' || solid(bot.blockAt(here.offset(0, -1, 0)))) return false;
  const rest = require('./terrain').restingCell(bot);
  if (!rest || rest.equals(here)) return false;
  const crouched = !!bot.getControlState?.('sneak');
  bot.setControlState('sneak', true);
  try { return await creepTo(bot, task, rest, 1500); }
  finally {
    bot.setControlState('forward', false);
    for (let n = 0; n < 10; n++) { const v = bot.entity?.velocity; if (!v || Math.hypot(v.x, v.z) < 0.01) break; await sleep(50); }
    if (!crouched) bot.setControlState('sneak', false);
  }
}

// The blocks a span is laid with that can be dug from ground walked to from
// here, and those within `reach` that cannot. mid-244-ad-nether-2 stood at
// the end of its own span over the lava sea, 61 carried and every leg
// needing more than 90, and chose to mine "64 netherrack, the nearest 10
// blocks off": the nearest was across the drop, nothing reachable on foot
// was counted apart, each mine step walked back along the span, dug
// nothing, and the next offer counted the span's own cobblestone, "the
// nearest 1 blocks off" (note 561). Walked from the cell the bot stands in
// (a step up, level or down, no digging, placing or jumping a gap), a block
// counts where some cell of that walk has it within reach of the eye and it
// has an open face, no lava beside it, and something under it for its drop
// to land on; a floor with open air under it (a span, the bot's own among
// them) is not counted: dug, the way back is a hole.
// `names`: other blocks looked for the same way (the Nether's gathering
// looks so for wood within reach, nether-gather.js).
// `cells`: the most cells the walk takes in, nearest first: the far look
// back along a span (mob-hunt.js RESTOCK_FAR) is a few dozen cells of floor
// there, and on open ground its reach would be thousands.
const DROP_OF = { stone: 'cobblestone' };
function spanBlockSources(bot, { reach = 16, walk = 32, skip = () => false, names = MATERIALS, cells: most = Infinity } = {}) {
  const out = { sources: [], reachable: {}, unreachable: {}, walkCells: 0 };
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function' || !bot.entity?.position) return out;
  const { restingCell } = require('./terrain'), { miningReach } = require('./mining-access');
  const at = p => bot.blockAt(p), open = b => !!b && b.boundingBox === 'empty' && !/lava|fire|water/.test(b.name || '');
  const { hotFloor } = require('./terrain');
  const standing = c => open(at(c)) && open(at(c.offset(0, 1, 0))) && solid(at(c.offset(0, -1, 0))) && !/lava/.test(at(c.offset(0, -1, 0))?.name || '') && !hotFloor(at(c.offset(0, -1, 0)));
  const here = bot.entity.position, start = restingCell(bot) || here.floored();
  const cells = new Map();
  if (standing(start)) cells.set(`${start}`, { c: start, walk: 0 });
  for (const queue = [...cells.values()]; queue.length;) {
    const { c, walk: w } = queue.shift();
    if (w >= walk || cells.size >= most) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
      const n = c.offset(dx, dy, dz), key = `${n}`;
      if (cells.has(key) || Math.hypot(n.x - start.x, n.z - start.z) > reach || !standing(n)) continue;
      if (dy === 1 && !open(at(c.offset(0, 2, 0)))) continue;
      if (dy === -1 && !open(at(c.offset(dx, 1, dz)))) continue;
      const cell = { c: n, walk: w + 1 };
      cells.set(key, cell); queue.push(cell);
    }
  }
  out.walkCells = cells.size;
  const ids = names.map(n => bot.registry?.blocksByName?.[n]?.id).filter(id => id !== undefined);
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Keyed by number from where the walk began: a string key for each of
  // the few hundred cells in reach of each of the thousands of blocks was
  // a second of the event loop.
  const num = p => ((p.x - start.x + 128) * 1024 + (p.y - start.y + 512)) * 256 + (p.z - start.z + 128);
  const candidates = new Map();
  for (const p of bot.findBlocks({ matching: ids, maxDistance: reach, count: 4096 }) || []) {
    const b = at(p);
    if (!b || !names.includes(b.name) || skip(p)) continue;
    // A floor over a gap a block deep with ground under it is no span: dug,
    // the way is a step down and up again. The planks mid-242-af-nether-2-
    // fortress-3 laid on its span as cover, two high, were each a floor over
    // air once the lower was dug (note 608).
    const floorOverAir = standing(p.offset(0, 1, 0)) && !solid(at(p.offset(0, -1, 0))) && !solid(at(p.offset(0, -2, 0)));
    const diggable = !floorOverAir && !faces.some(f => /lava/.test(at(p.offset(...f))?.name || '')) && faces.some(f => open(at(p.offset(...f)))) &&
      (solid(at(p.offset(0, -1, 0))) || solid(at(p.offset(0, -2, 0))));
    if (diggable) candidates.set(num(p), { p, b, from: null });
    else out.unreachable[b.name] = (out.unreachable[b.name] || 0) + 1;
  }
  // The cells in the order walked, so the first to reach a block is the
  // nearest walk to it.
  for (const cell of cells.values()) {
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -3; dy <= 5; dy++) {
      const k = candidates.get(num(cell.c.offset(dx, dy, dz)));
      if (!k || k.from || k.p.equals(cell.c.offset(0, -1, 0))) continue;
      if (miningReach(bot, cell.c.offset(0.5, 0, 0.5), k.p)) k.from = cell;
    }
  }
  for (const { p, b, from } of candidates.values()) {
    const tally = from ? out.reachable : out.unreachable;
    tally[b.name] = (tally[b.name] || 0) + 1;
    if (from) out.sources.push({ p, name: b.name, drops: DROP_OF[b.name] || b.name, from: from.c, walk: from.walk, block: b });
  }
  out.sources.sort((a, b) => a.walk - b.walk || a.p.distanceTo(here) - b.p.distanceTo(here));
  return out;
}
// The blocks gathered in one go, near where the bot stands: the nearest it
// can dig from ground it walks to, one after another until `want` are
// carried, none is left within reach, three in a row gain nothing, or the
// deadline passes. `mineAt` digs a block from where the bot stands and
// picks up its drop (work.js mine). Returns what it gained and why it
// stopped; a block that gained nothing is not tried again this round.
// `names`, `carried` and `what`: other blocks gathered the same way, how
// many of them are carried, and what they are called.
async function gatherSpanBlocks(bot, task, want, { navigate, mineAt, deadline = null, reach = 16, walk = 32, cells = Infinity, skip = () => false, onBlock = () => {}, names = MATERIALS, carried = blocksCarried, what = 'what a span is laid with' }) {
  const { goals } = require('mineflayer-pathfinder');
  const start = carried(bot), tried = new Set();
  let misses = 0, why = null;
  while (carried(bot) < want) {
    task.check();
    if (deadline && Date.now() > deadline) { why = 'the time it was said to take ran out twice over'; break; }
    const { sources } = spanBlockSources(bot, { reach, walk, cells, names, skip: p => tried.has(`${p}`) || skip(p) });
    const s = sources[0];
    if (!s) { why = `nothing more of ${what} can be dug from ground walked to from here`; break; }
    tried.add(`${s.p}`); onBlock(s);
    const before = carried(bot);
    try {
      const feet = standing(bot);
      // A walk back along a span to the rock it came from is longer than
      // one within the near reach: timed by its cells. Skipped where the
      // block is already in reach from right here, even when the source's
      // own walk-cell (`s.from`, from the survey's BFS) is some other cell:
      // a stale survey or a stance the BFS did not model exactly can name a
      // walk that gains nothing a dig in place already has (note 745,
      // 25590: blocks_then_cross at (-23, 32, 44) chose four times running,
      // "no route" each time to a target a few blocks off, and never mined
      // the netherrack in reach).
      const { miningReach } = require('./mining-access');
      const already = miningReach(bot, bot.entity.position, s.p);
      if (!feet.equals(s.from) && !already) await navigate(bot, task, new goals.GoalBlock(s.from.x, s.from.y, s.from.z), { timeoutMs: Math.max(15000, s.walk * 600), stallMs: 4000 });
      await mineAt(s);
    } catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name)) throw err;
      why = err.message;
    }
    if (carried(bot) > before) { misses = 0; why = null; continue; }
    if (++misses >= 3) { why = `three blocks in a row gave nothing${why ? ` (the last: ${why})` : ''}`; break; }
  }
  return { gained: carried(bot) - start, why: carried(bot) >= want ? null : why };
}

// Blocks dug where the bot stands (note 960): the walls round the feet and
// the head and the cell over the head, of a kind a span or tunnel lays and
// that drops itself to the tools carried, each over a floor its drop lands
// on beside the bot. No walk: the gather's walk to a known place was the
// only way, and it came to nothing a block or five off. 25593 (mid-242-nc,
// 2026-10-03 02:05:55Z), with a pickaxe, was told "No way to netherrack
// from here: 508 netherracks known at (82, 48, 98), 5 blocks west and 2
// up"; 25595 and 25597 walked 64-block legs away from their portals for 12.
// -> { gained, dug }.
async function quarryHere(bot, task, want, { names = LAID } = {}) {
  const out = { gained: 0, dug: 0, moves: 0 };
  const start = blocksCarried(bot);
  const tools = (bot.inventory?.items?.() || []).filter(i => /_(pickaxe|shovel|axe)$/.test(i.name)).map(i => i.type);
  const drops = b => !b.harvestTools || tools.some(t => b.harvestTools[t]);
  const molten = c => /lava|water|fire/.test(bot.blockAt(c)?.name || '');
  const near = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  // A ring where it stands, then into a cell it dug and a ring there, up to
  // QUARRY_MOVES times: a ring is four to five blocks.
  for (let round = 0; round <= QUARRY_MOVES && blocksCarried(bot) - start < want; round++) {
    const feet = standing(bot), opened = [];
    const cells = [...near.map(v => feet.plus(v)), ...near.map(v => feet.plus(v).offset(0, 1, 0)), feet.offset(0, 2, 0)];
    for (const q of cells) {
      if (blocksCarried(bot) - start >= want) break;
      task.check();
      const b = bot.blockAt(q);
      if (!solid(b) || !b.diggable || !names.includes(DROP_OF[b.name] || b.name) || !drops(b)) continue;
      // Its drop lands on a floor beside the bot: the cell under it solid,
      // at the head the feet-level cell under that, or over the head onto
      // the bot itself.
      const overHead = q.x === feet.x && q.z === feet.z;
      if (!overHead && !solid(bot.blockAt(q.offset(0, -1, 0))) && !(q.y === feet.y + 1 && solid(bot.blockAt(q.offset(0, -2, 0))))) continue;
      if ([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([x, y, z]) => molten(q.offset(x, y, z)))) continue;
      if (overHead && FALLS.test(bot.blockAt(q.offset(0, 1, 0))?.name || '')) continue;
      if (!require('./tunneling').safeExcavation(bot, q)) continue;
      const had = blocksCarried(bot);
      try { await clear(bot, task, q, { wall: true }); out.dug++; if (q.y === feet.y) opened.push(q); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; continue; }
      for (let i = 0; i < 12 && blocksCarried(bot) <= had; i++) { await sleep(100); task.check(); }
    }
    if (round === QUARRY_MOVES || blocksCarried(bot) - start >= want) break;
    // Into a cell it opened, on a floor that stands with its head clear.
    const next = opened.find(c => solid(bot.blockAt(c.offset(0, -1, 0))) && !solid(bot.blockAt(c)) && !solid(bot.blockAt(c.offset(0, 1, 0))));
    if (!next || !await creepTo(bot, task, next, 2500)) break;
    out.moves++;
  }
  out.gained = blocksCarried(bot) - start;
  return out;
}

module.exports = { quarryHere, spanMaterial: material, BLAST_PROOF, tunnelStraight, stairsDown, spanPusher, spanWallsAt, clearCell: clear, stepOntoFooting, bridgeTo, crossAlong, underFire, spanRefused, surveyCrossing, stepToward, blocksCarried, spanBlockSources, gatherSpanBlocks, MATERIALS, LAID, NETHER_WOOD, NATURAL };
