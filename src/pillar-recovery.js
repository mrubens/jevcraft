'use strict';
const { Vec3 } = require('vec3');
const { dryPassable, damagingTerrain, supportCell } = require('./terrain');
const { reservedForConstruction } = require('./build-sites');
const { safeFromHostiles, checkThreats } = require('./danger');
const { equipBestTool } = require('./skills');
const { checkAir, digWithAirGuard } = require('./vitals');
const directions = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
// Every block a pillar is built of (SCAFFOLD below) can be dug back down:
// the live run built four of nether bricks toward its portal, ran out of
// blocks, and would not come down its own pillar again.
const material = /^(dirt|cobblestone|cobbled_deepslate|stone|deepslate|granite|diorite|andesite|tuff|netherrack|nether_bricks|blackstone|basalt|soul_soil)$|_log$/;
const fullCube = b => b && !damagingTerrain.has(b.name) && b.shapes?.some(s =>
  s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 1 && s[4] === 1 && s[5] === 1);
const unsafe = b => !b || damagingTerrain.has(b.name) || ['water', 'bubble_column'].includes(b.name);

// This is an inspected one-block descent, never a general shaft-digging rule.
// An exposed support and a full solid block immediately below distinguish a
// pillar step from digging blindly through ordinary terrain or a cave ceiling.
// `center`: the bot on its own pillar's top, anywhere over the block (the
// descent steps it to the middle first). mid-242-af stood 0.2 of a block off
// its pillar's middle for twelve minutes and was never offered the way down
// (note 590).
const CENTERED = .18, OVER = .3;
function pillarDescent(bot, goal, { combat = false, center = false } = {}) {
  const feet = bot.entity.position, blockPosition = supportCell(feet), block = bot.blockAt(blockPosition);
  const off = center ? OVER : CENTERED;
  if (bot.entity.onGround === false || Math.abs(feet.y - blockPosition.y - 1) > 0.05 ||
    Math.abs(feet.x - blockPosition.x - .5) > off || Math.abs(feet.z - blockPosition.z - .5) > off) return null;
  const ownedAccess = goal.buildPhase === 'cleanup' && goal.buildOwned?.[`${blockPosition.x},${blockPosition.y},${blockPosition.z}`] === (block?.stateId ?? block?.name) &&
    !goal.blueprint?.blocks?.some(p => p.x === blockPosition.x && p.y === blockPosition.y && p.z === blockPosition.z);
  if (!material.test(block?.name || '') || !block.diggable || !fullCube(block) || reservedForConstruction(goal, blockPosition) && !ownedAccess) return null;
  const floor = bot.blockAt(blockPosition.offset(0, -1, 0));
  if (!fullCube(floor) || !material.test(floor.name) && !['grass_block', 'bedrock'].includes(floor.name) && !(ownedAccess && !['sand', 'red_sand', 'gravel'].includes(floor.name))) return null;
  if (!dryPassable(bot.blockAt(blockPosition.offset(0, 1, 0))) || !dryPassable(bot.blockAt(blockPosition.offset(0, 2, 0)))) return null;
  if (directions.filter(d => dryPassable(bot.blockAt(blockPosition.plus(d)))).length < 2) return null;
  for (const d of directions) for (const dy of [-1, 0, 1]) if (unsafe(bot.blockAt(blockPosition.plus(d).offset(0, dy, 0)))) return null;
  const destination = blockPosition.offset(.5, 0, .5);
  // In a fight the mobs below are the reason to come down, not a bar to it.
  if ((!combat && !safeFromHostiles(bot, destination)) || block.harvestTools && !bot.inventory.items().some(i => block.harvestTools[i.type])) return null;
  return { block: { ...blockPosition }, blockName: block.name, floorName: floor.name, destination: { ...destination } };
}

// How high a pillar stands: the drop to the ground beside it, the least
// over its open sides, not the blocks stacked under the feet. In a cave the
// stone under the feet goes down for ever, and mid-237-a, a step above the
// floor of a tunnel among seven zombies, was told it stood three blocks up
// with no way off but digging, chose to, and dug under its own feet at
// thirteen health (2026-09-26). Null with no open side.
function pillarHeight(bot, feet, { deepest = 24 } = {}) {
  const at = feet.floored ? feet.floored() : feet;
  let least = null;
  for (const d of directions) {
    const side = at.plus(d);
    if (!dryPassable(bot.blockAt(side)) || !dryPassable(bot.blockAt(side.offset(0, 1, 0)))) continue;
    let drop = deepest;
    for (let dy = 1; dy <= deepest; dy++) {
      const b = bot.blockAt(side.offset(0, -dy, 0));
      if (!b) break;
      if (!dryPassable(b)) { drop = dy - 1; break; }
    }
    if (least === null || drop < least) least = drop;
  }
  return least;
}

async function descendPillar(bot, task, goal, save, expected, { combat = false } = {}) {
  // Chosen in a fight (the come_down stance), the mobs about do not stop it.
  const threatCheck = () => { if (!combat) checkThreats(bot); };
  task.check(); checkAir(bot); threatCheck();
  // Not a pillar raised on purpose, to a portal overhead: the climb went up
  // to 48 and this took it back down to 47, over and over. Chosen in a fight
  // it is the way down Jev took, the pillar the stance's own (note 590).
  const raised = bot._pillarUp, feet = bot.entity.position.floored();
  if (!combat && raised && raised.until > Date.now() && raised.x === feet.x && raised.z === feet.z) return false;
  // In a fight, off the block's middle but over it: stepped to the middle
  // first, so the drop lands on the block below.
  if (combat && !pillarDescent(bot, goal, { combat }) && pillarDescent(bot, goal, { combat, center: true })) {
    const mid = supportCell(bot.entity.position).offset(.5, 1, .5);
    const centered = () => Math.abs(bot.entity.position.x - mid.x) <= CENTERED - .03 && Math.abs(bot.entity.position.z - mid.z) <= CENTERED - .03;
    const { move } = require('./motion');
    await move(bot, task, { label: 'pillar_center', keys: ['forward'], sneak: true, look: mid.offset(0, 1.6, 0), until: centered, maxMs: 800 });
    bot.clearControlStates?.();
  }
  const candidate = pillarDescent(bot, goal, { combat });
  if (!candidate || expected && JSON.stringify(candidate) !== JSON.stringify(expected)) return false;
  bot.pathfinder.setGoal(null); bot.clearControlStates?.();
  const p = new Vec3(candidate.block.x, candidate.block.y, candidate.block.z);
  await equipBestTool(bot, bot.blockAt(p));
  task.check(); checkAir(bot); threatCheck();
  if (JSON.stringify(pillarDescent(bot, goal, { combat })) !== JSON.stringify(candidate)) throw new Error('Pillar footing changed before descent');
  goal.step = { action: 'descend_pillar', ...candidate }; save();
  // Mineflayer resolves dig() after its optimistic local air update. A dig
  // beneath our feet must wait for the server's block packet as well.
  let confirmed = false, landedSince = 0;
  const changed = packet => {
    if (packet.location?.x === p.x && packet.location.y === p.y && packet.location.z === p.z) confirmed = packet.type === 0;
  };
  const changedMany = packet => {
    // A log break can also update neighboring leaves in the same tick. The
    // server then batches both changes instead of sending block_change.
    const packed = bot.supportFeature('usesMultiblockSingleLong');
    const section = bot.supportFeature('usesMultiblock3DChunkCoords') ? packet.chunkCoordinates :
      { x: packet.chunkX, y: 0, z: packet.chunkZ };
    for (const record of packet.records) {
      const x = section.x * 16 + (packed ? (record >> 8) & 15 : record.horizontalPos >> 4);
      const y = section.y * 16 + (packed ? record & 15 : record.y);
      const z = section.z * 16 + (packed ? (record >> 4) & 15 : record.horizontalPos & 15);
      if (x === p.x && y === p.y && z === p.z) confirmed = (packed ? Math.floor(record / 4096) : record.blockId) === 0;
    }
  };
  bot._client.on('block_change', changed);
  bot._client.on('multi_block_change', changedMany);
  try {
    await digWithAirGuard(bot, task, bot.blockAt(p));
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      task.check(); checkAir(bot); threatCheck();
      const now = bot.entity.position;
      if (confirmed && dryPassable(bot.blockAt(p)) && fullCube(bot.blockAt(p.offset(0, -1, 0))) &&
        Math.abs(now.y - p.y) < .08 && Math.hypot(now.x - p.x - .5, now.z - p.z - .5) < .3 && bot.entity.onGround !== false) {
        landedSince ||= Date.now();
        if (Date.now() - landedSince >= 250) { goal.step.landed = { ...now }; save(); return true; }
      } else landedSince = 0;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Pillar descent did not reach its server-confirmed landing');
  } finally {
    bot._client.removeListener('block_change', changed);
    bot._client.removeListener('multi_block_change', changedMany);
  }
}
// Straight up, a block at a time: jump, put a block where the feet were,
// clear what is over the head. For a place overhead that no stairs reach:
// the dream run's Nether portal stood on a platform thirty blocks over a
// cavern floor, and the staircase went ninety-eight rounds beside a lava
// pool under it. Stops at the height asked for, at a block it must not dig
// (obsidian, the portal, a chest), or where lava or water is beside the
// next cell up; the pathfinder takes over from wherever it stops.
const SCAFFOLD = ['netherrack', 'cobblestone', 'cobbled_deepslate', 'dirt', 'nether_bricks', 'blackstone', 'basalt', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'soul_soil'];
const DIGGABLE_ABOVE = /^(netherrack|stone|deepslate|cobblestone|cobbled_deepslate|dirt|gravel|sand|soul_sand|soul_soil|basalt|blackstone|andesite|diorite|granite|tuff|nether_bricks|glowstone|magma_block|crimson_nylium|warped_nylium|nether_quartz_ore|nether_gold_ore|.*_leaves)$/;
// `canDig` says which blocks overhead may be dug: a climb out of the mine
// passes its own test, the one its column was looked over by.
const diggableAbove = block => DIGGABLE_ABOVE.test(block.name) && block.diggable;
// Why the climb stops before its next block from `feet`, or null: nothing
// wet or burning in or beside the cells the body will pass through, and
// over the head only what may be dug and has nothing falling over it
// (dug from beneath, the column comes down onto the head: mid-83-g
// pillared up at seven health into gravel and suffocated in four seconds,
// 2026-09-26). The one test for pillarUp and for the stance that offers a
// pillar: offered on a looser one (three cells of air over the feet),
// mid-244-ab-nether-3's pillar from two hoglins at 5.1 health stopped
// before its first block, "0 of 2 blocks went down", and the next
// question, 0.6 seconds on with the hoglin at 2.7, took the fight; two
// blows ended it (note 587).
const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$/;
function climbStop(bot, feet, { canDig = diggableAbove } = {}) {
  const head = feet.offset(0, 2, 0), above = bot.blockAt(head);
  if (!above) return 'the block over the head is not loaded';
  const liquid = c => /lava|water/.test(bot.blockAt(c)?.name || '');
  const passing = [feet.offset(0, 1, 0), head, head.offset(0, 1, 0)];
  const wet = passing.find(liquid) || passing.slice(0, 2).flatMap(c => directions.map(d => c.plus(d))).find(liquid);
  if (wet) return `${bot.blockAt(wet).name.replaceAll('_', ' ')} at ${wet.x}, ${wet.y}, ${wet.z}, in or beside the cells the body rises through`;
  if (dryPassable(above)) return null;
  if (!canDig(above)) return `${above.name.replaceAll('_', ' ')} over the head, which the climb does not dig`;
  if (FALLS.test(above.name) || FALLS.test(bot.blockAt(head.offset(0, 1, 0))?.name || '')) return `${above.name.replaceAll('_', ' ')} over the head with a block that falls in it or over it`;
  return null;
}
async function pillarUp(bot, task, targetY, { dig, maxBlocks = 40, threats = true, canDig = diggableAbove, blocks = SCAFFOLD } = {}) {
  const { move } = require('./motion');
  let placed = 0;
  while (bot.entity.position.y < targetY - 0.5 && placed < maxBlocks) {
    // A climb away from the threat itself does not stop for it.
    task.check(); checkAir(bot); if (threats) checkThreats(bot);
    const feet = bot.entity.position.floored();
    const head = feet.offset(0, 2, 0), above = bot.blockAt(head);
    if (climbStop(bot, feet, { canDig })) break;
    if (!dryPassable(above)) {
      await dig(bot, task, head, { requireDrops: false });
      continue;
    }
    // In the order the kinds are listed, not the pack's: rock before wood
    // before the gravel that falls.
    const block = blocks.map(n => bot.inventory.items().find(i => i.name === n)).find(Boolean);
    if (!block) break;
    await bot.equip(block, 'hand');
    await bot.look(bot.entity.yaw, -Math.PI / 2, true);
    const start = feet.y;
    const below = bot.blockAt(feet.offset(0, -1, 0));
    if (!below || below.boundingBox !== 'block') break;
    await move(bot, task, { label: 'pillar_up', keys: ['jump'], sneak: false, until: () => bot.entity.position.y >= start + 1.1, maxMs: 1200, tick: 20 });
    // The server has the position a tick behind: placed the moment the feet
    // cleared the cell here, it still saw the body in it and refused.
    await new Promise(resolve => setTimeout(resolve, 60));
    // Placed with the look already down (set before the jump): placeBlock's
    // own smooth turn took ticks, the bot fell back into the cell before the
    // packet went, and the server refused every block of a pillar from two
    // hoglins in the arena.
    const place = bot._placeBlockWithOptions ? () => bot._placeBlockWithOptions(below, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: true }) : () => bot.placeBlock(below, new Vec3(0, 1, 0));
    try { await place(); placed++; bot._pillarUp = { x: feet.x, z: feet.z, until: Date.now() + 600000 }; }
    catch (err) { task.check(); }
    for (let i = 0; i < 20 && !bot.entity.onGround; i++) { task.check(); await new Promise(resolve => setTimeout(resolve, 25)); }
    if (bot.entity.position.floored().y <= start) break;
  }
  return placed;
}

// Where to stand for the pillar: the nearest column, within a few blocks
// of the bot and six sideways of the target, with a floor to start from
// and every cell up to the target's height air or diggable, with no lava or
// water in or beside it. Under the portal the lava fall was beside the
// column the bot stood in, and the pillar stopped before its first block.
function pillarSite(bot, targetY, target, { radius = 5 } = {}) {
  const feet = bot.entity.position.floored();
  const liquid = c => /lava|water/.test(bot.blockAt(c)?.name || '');
  const sites = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 1; dy++) {
    const base = feet.offset(dx, dy, dz);
    if (target && Math.hypot(base.x - target.x, base.z - target.z) > 6) continue;
    if (bot.blockAt(base.offset(0, -1, 0))?.boundingBox !== 'block' || !dryPassable(bot.blockAt(base)) || !dryPassable(bot.blockAt(base.offset(0, 1, 0)))) continue;
    let ok = true;
    for (let y = base.y; y <= targetY + 1 && ok; y++) {
      const c = new Vec3(base.x, y, base.z), b = bot.blockAt(c);
      if (!b || liquid(c) || directions.some(d => liquid(c.plus(d)))) ok = false;
      else if (!dryPassable(b) && !(DIGGABLE_ABOVE.test(b.name) && b.diggable)) ok = false;
    }
    if (ok) sites.push(base);
  }
  const far = c => c.offset(0.5, 0, 0.5).distanceTo(bot.entity.position);
  return sites.sort((a, b) => far(a) - far(b))[0] || null;
}

module.exports = { pillarHeight, pillarDescent, descendPillar, pillarUp, pillarSite, climbStop, SCAFFOLD, DIGGABLE_ABOVE };
