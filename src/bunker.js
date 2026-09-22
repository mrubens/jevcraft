'use strict';
// A blaze spawner keeps six in the air at once, and walking into that room
// burned the bot to a crisp twice. Players fight a spawner from a doorway:
// a one-wide tunnel dug into the rock, the shield up, and every blaze that
// comes round the corner is cut down within a sword's reach while the rest
// have no line of sight. Code digs the bunker, holds it and picks up the
// rods; the sword and shield rhythm is the ordinary defence.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { threats } = require('./danger');
const { defendNearby, raiseShield, lowerShield, defenseWeapon } = require('./combat');
const { countOf, equipBestTool } = require('./skills');
const { checkAir } = require('./vitals');

const SWARM = 3;
const DEPTH = 3;
const HOLD_MS = 120000;
const QUIET_MS = 20000;
// Fortress brick counts: the live run stood inside a fortress and reported
// "no rock to dig a bunker into", because the only rock around was the
// fortress itself.
const NATURAL = /^(netherrack|soul_sand|soul_soil|basalt|blackstone|nether_wart_block|warped_wart_block|crimson_nylium|warped_nylium|magma_block|nether_quartz_ore|nether_gold_ore|gravel|stone|dirt|deepslate|andesite|diorite|granite|tuff|nether_bricks|red_nether_bricks|nether_brick_stairs|nether_brick_slab)$/;
const solid = b => b?.boundingBox === 'block';
const passable = b => !b || b.boundingBox === 'empty';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

function blazes(bot, radius = 24) {
  return threats(bot, radius).filter(t => t.entity.name === 'blaze');
}
const swarm = (bot, radius = 24) => blazes(bot, radius).length >= SWARM;

// A side whose next DEPTH cells at feet and head height are natural rock
// on solid floor, facing away from the blazes: the bunker goes there.
function bunkerSide(bot, feet, from) {
  const away = SIDES.filter(s => !from || (s.x * (from.x - feet.x) + s.z * (from.z - feet.z)) <= 0);
  for (const side of [...away, ...SIDES.filter(s => !away.includes(s))]) {
    let ok = true;
    for (let d = 1; d <= DEPTH && ok; d++) {
      const cell = feet.plus(side.scaled(d));
      for (const p of [cell, cell.offset(0, 1, 0)]) { const b = bot.blockAt(p); if (!solid(b) || !NATURAL.test(b.name) || !b.diggable) ok = false; }
      if (!solid(bot.blockAt(cell.offset(0, -1, 0)))) ok = false;
    }
    if (ok) return side;
  }
  return null;
}

// Open the adjacent cell toward `from` when something diggable stands in
// it. Live, the bot sat in a pocket it had dug beside a fortress corridor
// with a nether brick fence between it and the blazes, and every fifteen
// seconds it built more cover on its own side of the fence. A door, not a
// wall.
const DOORWAY = /nether_brick|fence|netherrack|blackstone|basalt/;
async function openToward(bot, task, from) {
  if (!from) return false;
  const here = bot.entity.position.floored();
  const dx = from.x - here.x, dz = from.z - here.z;
  const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
  const cell = here.plus(step);
  let opened = false;
  for (const p of [cell.offset(0, 1, 0), cell]) {
    const block = bot.blockAt(p);
    if (!block || passable(block) || !block.diggable || !DOORWAY.test(block.name)) continue;
    task.check();
    await digCell(bot, task, p); opened = true;
  }
  return opened;
}

// One step to the side at the end of the tunnel. A straight shaft is a
// shooting gallery along its own axis: anything lined up with it can see
// all the way to the back, which is how the first bunker took fireballs at
// the far end and brought no rods home. Around a corner there is no line
// from outside at all, so a blaze that wants to see the bot has to come in
// and turn it, arriving inside a sword's reach.
function cornerCell(bot, inside, side) {
  const turns = SIDES.filter(s => s.x * side.x + s.z * side.z === 0);
  for (const turn of turns) {
    const cell = inside.plus(turn);
    const diggable = p => { const b = bot.blockAt(p); return solid(b) && NATURAL.test(b.name) && b.diggable; };
    if (diggable(cell) && diggable(cell.offset(0, 1, 0)) && solid(bot.blockAt(cell.offset(0, -1, 0)))) return cell;
  }
  return null;
}

async function digCell(bot, task, p) {
  const block = bot.blockAt(p);
  if (passable(block)) return;
  await equipBestTool(bot, block); task.check();
  await bot.dig(block, true);
}

async function stepTo(bot, task, cell) {
  const centre = cell.offset(0.5, 0, 0.5);
  await bot.lookAt(centre.offset(0, 1.6, 0), true);
  bot.setControlState('forward', true);
  const started = Date.now();
  try {
    while (Date.now() - started < 2000) {
      task.check();
      const p = bot.entity.position;
      if (Math.hypot(p.x - centre.x, p.z - centre.z) < 0.35) return true;
      await sleep(40);
    }
    return false;
  } finally { bot.setControlState('forward', false); }
}

// Dig DEPTH cells into the wall and stand at the far end facing out.
// The middle of a group, so the bunker is dug away from all of it rather
// than away from whichever one happens to be nearest.
function centroid(threats) {
  if (!threats.length) return null;
  return threats.reduce((total, t) => total.plus(t.entity.position), new Vec3(0, 0, 0)).scaled(1 / threats.length);
}

// The rock face to back into: a stand cell beside natural rock, as far from
// the threats as the search allows. In the middle of a room `bunkerSide`
// finds nothing adjacent, so the branch never fired and the herd drill
// stayed in the open and died.
function wallStands(bot, from, { distance = 16, count = 512 } = {}) {
  const ids = (bot.registry?.blocksArray || []).filter(b => NATURAL.test(b.name)).map(b => b.id);
  if (!ids.length) return [];
  const here = bot.entity.position, feet = here.floored();
  const stands = new Map();
  for (const p of bot.findBlocks({ matching: ids, maxDistance: distance, count })) {
    // A wall, not the floor. Every block in the room's floor is natural
    // rock and every one of them is nearer than the walls, so an unfiltered
    // search returned five hundred floor tiles and no wall: the bot stood
    // in the open being shot and reported that there was no rock to dig
    // into, in a room made of rock.
    if (p.y !== feet.y) continue;
    for (const side of SIDES) {
      const cell = p.plus(side);
      if (!passable(bot.blockAt(cell)) || !passable(bot.blockAt(cell.offset(0, 1, 0))) || !solid(bot.blockAt(cell.offset(0, -1, 0)))) continue;
      const key = `${cell}`;
      if (stands.has(key)) continue;
      // Facing into the rock, and the rock between the bot and the threats.
      const into = cell.minus(p);
      const away = from ? (cell.x - from.x) * into.x + (cell.z - from.z) * into.z : 1;
      stands.set(key, { cell, score: cell.distanceTo(here) + (away > 0 ? 0 : 8) });
    }
  }
  return [...stands.values()].sort((a, b) => a.score - b.score).map(s => s.cell);
}

// Close enough that walking there is cheaper than being shot on the way.
// Crossing nine blocks of open ground to reach a wall cost the arena's
// blaze pair forty-one health against twenty-six for simply fighting where
// it stood: a doorway is worth having, not worth travelling for.
const WALK_TO_WALL = 5;
function nearWall(bot, from, { within = WALK_TO_WALL } = {}) {
  if (bunkerSide(bot, bot.entity.position.floored(), from)) return true;
  const here = bot.entity.position;
  return wallStands(bot, from, { distance: within + 2 }).some(cell => cell.distanceTo(here) <= within);
}

async function reachWall(bot, task, from, navigate) {
  if (bunkerSide(bot, bot.entity.position.floored(), from)) return true;
  if (!navigate) return false;
  for (const cell of wallStands(bot, from).slice(0, 4)) {
    task.check();
    try { await navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 6000, stallMs: 2500 }); }
    catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; continue; }
    if (bunkerSide(bot, bot.entity.position.floored(), from)) return true;
  }
  return false;
}

async function digBunker(bot, task, goal, save, { from = null, navigate = null } = {}) {
  const centre = from || centroid(blazes(bot));
  await reachWall(bot, task, centre, navigate);
  const feet = bot.entity.position.floored();
  const side = bunkerSide(bot, feet, centre);
  if (!side) throw new Error('No rock to dig a bunker into here');
  goal.step = { action: 'dig_bunker', side: { x: side.x, z: side.z }, depth: DEPTH }; save();
  for (let d = 1; d <= DEPTH; d++) {
    task.check(); checkAir(bot);
    const cell = feet.plus(side.scaled(d));
    await digCell(bot, task, cell.offset(0, 1, 0)); await digCell(bot, task, cell);
    if (!await stepTo(bot, task, cell)) throw new Error('Could not step into the bunker');
  }
  const mouth = feet.plus(side), end = feet.plus(side.scaled(DEPTH));
  // The turn, when the rock allows one. Without it the bunker is a corridor
  // with the bot at one end and the shooters at the other.
  const corner = cornerCell(bot, end, side);
  if (corner) {
    task.check(); checkAir(bot);
    await digCell(bot, task, corner.offset(0, 1, 0)); await digCell(bot, task, corner);
    if (await stepTo(bot, task, corner)) {
      goal.step = { action: 'dig_bunker', side: { x: side.x, z: side.z }, depth: DEPTH, turned: true }; save();
      return { mouth, inside: corner, watch: end, side, turned: true };
    }
  }
  return { mouth, inside: end, watch: mouth, side, turned: false };
}

// Hold the bunker: shield up, strike whatever comes within reach, until
// the rods are in hand, the blazes have gone quiet, or the hold runs out.
async function holdBunker(bot, task, goal, save, bunker, { item = 'blaze_rod', want = 1 } = {}) {
  const started = Date.now(); let lastSeen = Date.now(), kills = 0;
  const onDeath = entity => { if (entity?.name === 'blaze') kills++; };
  bot.on('entityDead', onDeath);
  const sword = defenseWeapon(bot);
  try {
    if (sword && bot.heldItem?.name !== sword.name) await bot.equip(sword, 'hand');
    const watch = bunker.watch || bunker.mouth;
    await bot.lookAt(watch.offset(0.5, 1.2, 0.5), true);
    raiseShield(bot);
    while (Date.now() - started < HOLD_MS) {
      task.check(); checkAir(bot);
      if (countOf(bot, item) >= want) break;
      if ((bot.health ?? 20) < 8) throw new Error('Too hurt to hold the bunker');
      const near = blazes(bot, 20);
      if (near.length) lastSeen = Date.now();
      else if (Date.now() - lastSeen > QUIET_MS) break;
      goal.step = { action: 'hold_bunker', blazes: near.length, kills, health: bot.health, held: Math.round((Date.now() - started) / 1000) }; save();
      const swung = await defendNearby(bot, task, goal, save);
      if (!swung) {
        // Back in place and facing the door between swings.
        const p = bot.entity.position, c = bunker.inside.offset(0.5, 0, 0.5);
        if (Math.hypot(p.x - c.x, p.z - c.z) > 0.6) { lowerShield(bot); await stepTo(bot, task, bunker.inside); }
        await bot.lookAt((bunker.watch || bunker.mouth).offset(0.5, 1.2, 0.5), true);
        raiseShield(bot);
        await sleep(150);
      }
    }
  } finally { lowerShield(bot); bot.removeListener('entityDead', onDeath); }
  return kills;
}

// Rods that fell at the door are collected when no blaze has a line of
// sight; the walk out is short and the bunker is behind.
async function collectRods(bot, task, goal, save, bunker, actions, item = 'blaze_rod') {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    task.check();
    if (blazes(bot, 16).some(t => t.visible)) { await sleep(500); continue; }
    const drop = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === item && e.position.distanceTo(bunker.mouth) < 10)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    if (!drop) return;
    const before = countOf(bot, item), d = drop.position.floored();
    goal.step = { action: 'collect_rods', position: { x: d.x, y: d.y, z: d.z } }; save();
    try { await actions.navigate(bot, task, new goals.GoalNear(d.x, d.y, d.z, 0.5), { timeoutMs: 6000, stallMs: 2500, stopWhen: () => countOf(bot, item) > before || bot.entities[drop.id] !== drop }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return; }
    await sleep(300);
    try { await actions.navigate(bot, task, new goals.GoalBlock(bunker.inside.x, bunker.inside.y, bunker.inside.z), { timeoutMs: 6000, stallMs: 2500 }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
}

// One bunker fight: dig, hold, collect. Returns the rods gained.
async function bunkerFight(bot, task, goal, save, actions, { item = 'blaze_rod', want = 1 } = {}) {
  const before = countOf(bot, item);
  const state = goal.mobHunt ||= {};
  const bunker = await digBunker(bot, task, goal, save, { navigate: actions.navigate });
  state.bunker = { mouth: { ...bunker.mouth }, inside: { ...bunker.inside }, at: Date.now() }; save();
  bot.chat?.('Too many blazes to face in the open. Digging in beside them and taking them at the door.');
  const kills = await holdBunker(bot, task, goal, save, bunker, { item, want });
  await collectRods(bot, task, goal, save, bunker, actions, item);
  const gained = countOf(bot, item) - before;
  state.bunkerResults = [...(state.bunkerResults || []), { at: new Date().toISOString(), kills, gained, health: bot.health }].slice(-12); save();
  return gained;
}

// A wall where the bot stands, when there is no wall to walk to. Two blocks
// one step toward the shooters and the line is broken: the same doorway the
// bunker digs, built rather than found. The pair drill spent its health
// standing in the open waiting for health to come back, which it cannot do
// while the thing that took it is still looking.
const COVER = new Set(['netherrack', 'cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'andesite', 'diorite', 'granite', 'blackstone', 'basalt', 'nether_bricks']);
async function raiseCover(bot, task, from) {
  const material = bot.inventory.items().find(item => COVER.has(item.name));
  if (!material || !from) return false;
  const here = bot.entity.position.floored();
  const dx = from.x - here.x, dz = from.z - here.z;
  const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
  const cell = here.plus(step), floor = bot.blockAt(cell.offset(0, -1, 0));
  if (!solid(floor) || !passable(bot.blockAt(cell)) || !passable(bot.blockAt(cell.offset(0, 1, 0)))) return false;
  await bot.equip(material, 'hand');
  task.check();
  await bot.lookAt(cell.offset(0.5, 0.5, 0.5), true);
  await bot.placeBlock(floor, new Vec3(0, 1, 0));
  const lower = bot.blockAt(cell);
  if (solid(lower)) {
    task.check();
    await bot.lookAt(cell.offset(0.5, 1.5, 0.5), true);
    await bot.placeBlock(lower, new Vec3(0, 1, 0));
  }
  return solid(bot.blockAt(cell));
}

module.exports = { bunkerFight, digBunker, cornerCell, raiseCover, openToward, reachWall, wallStands, nearWall, swarm, blazes, bunkerSide, centroid, WALK_TO_WALL, SWARM };
