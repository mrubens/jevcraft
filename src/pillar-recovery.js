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
// Over the block anywhere its top holds the feet (OVER): in a fight the
// descent steps to the middle first, sneaking (descendPillar). At .3, a bot
// 0.38 off the middle of its own pillar's top was offered no way down: 25585
// (mid-227-ah, 2026-10-01 11:31-11:36Z), six health, five blazes shooting,
// asked encounter_stance 30 times in three minutes with only fight and a
// retreat that had no way (note 799).
const CENTERED = .18, OVER = .49;
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
// The hand-dug Nether blocks last (block-stock.js HAND_BLOCKS, note 692).
// End stone too (note 1427): the island's own rock, dug for the climbs there; 25588 (dragon-12, 2026-10-13 06:45Z), its cobblestone laid, stood with 22 end stone and 'no block of the kinds the climb lays carried'.
// End stone first (note 1785): the dragon's body smashes every block it meets but end stone, obsidian and bedrock, and 25588's dragon-153 (2026-10-17 19:1xZ, 199 blocks carried, most of them end stone from its tunnels) had its pocket at the top of a walled climb roofed and walled in cobblestone, the charge opened it, and the cloud filled the cell, 14.3 to none. Elsewhere no end stone is carried and the order is as before.
// The badlands' terracotta and sandstone too (note 2548).
const TERRACOTTA = ['terracotta', ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map(c => `${c}_terracotta`), 'sandstone', 'red_sandstone'];
const SCAFFOLD = [...TERRACOTTA, 'end_stone', 'netherrack', 'cobblestone', 'cobbled_deepslate', 'dirt', 'nether_bricks', 'blackstone', 'basalt', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'end_stone', 'soul_soil', 'soul_sand', 'nether_wart_block', 'warped_wart_block', 'shroomlight'];
// The End island's end stone too (note 1420): a climb begun under its lip stopped 'end stone over the head' (25588, dragon-9, 2026-10-13 06:12Z).
const DIGGABLE_ABOVE = /^(netherrack|stone|terracotta|\w+_terracotta|sandstone|red_sandstone|red_sand|deepslate|cobblestone|cobbled_deepslate|dirt|gravel|sand|soul_sand|soul_soil|basalt|blackstone|andesite|diorite|granite|tuff|nether_bricks|glowstone|magma_block|crimson_nylium|warped_nylium|nether_quartz_ore|nether_gold_ore|.*_leaves|end_stone)$/;
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
// Water beside the climb let through on 'wet' (note 1657): the climb out of the
// dragon's breath is refused for water in or beside the cells, and the cloud
// takes six a second where water only pushes. 25588 (dragon-192, 2026-10-14
// 18:12Z) stood in the cloud at (30, 60, -20) beside the remnant of its own
// enderman pour, 'stopped before the first block: water at 31, 61, -20' twice,
// and went 20 to 14.7 to 9 to 3.3 to none in three seconds with 5 blocks carried.
// Lava is never let through.
function climbStop(bot, feet, { canDig = diggableAbove, wet: throughWater = false } = {}) {
  const head = feet.offset(0, 2, 0), above = bot.blockAt(head);
  if (!above) return 'the block over the head is not loaded';
  const liquid = c => (throughWater ? /lava/ : /lava|water/).test(bot.blockAt(c)?.name || '');
  // In water there is no climb, water beside or not (note 1689): a jump from water reaches 0.8, under the block's top, and the block never goes under the body. 25588 (dragon-223, 2026-10-15 02:0xZ) in its pool's pit at (-10, 62, -38): 'the jump reached 0.8 over the start, the body at -0.03 at the place' three times, one block of two laid; the one-block climbs out of the breath of dragon-214, 215, 216, 220, 221 and 222 stood in or beside their pools.
  if (/water/.test(bot.blockAt(feet)?.name || '')) return `water at the feet at ${feet.x}, ${feet.y}, ${feet.z}: a jump from water reaches 0.8, under the block's top`;
  const passing = [feet.offset(0, 1, 0), head, head.offset(0, 1, 0)];
  const wet = passing.find(liquid) || passing.slice(0, 2).flatMap(c => directions.map(d => c.plus(d))).find(liquid);
  if (wet) return `${bot.blockAt(wet).name.replaceAll('_', ' ')} at ${wet.x}, ${wet.y}, ${wet.z}, in or beside the cells the body rises through`;
  if (dryPassable(above)) return null;
  if (!canDig(above)) return `${above.name.replaceAll('_', ' ')} over the head, which the climb does not dig`;
  if (FALLS.test(above.name) || FALLS.test(bot.blockAt(head.offset(0, 1, 0))?.name || '')) return `${above.name.replaceAll('_', ' ')} over the head with a block that falls in it or over it`;
  return null;
}
// The ring about a climb's cell (note 1753): the four cells beside it at dy, each laid on the block under it (the ring of the level below) or against the climb's own block toward the middle; cells already solid are left. With a ring at the head's height on every level the dragon has no line from its eyes to the bot's, which its fireball needs (Fable, 2026-10-15; the sealed stubs of notes 1721 and 1731 took no fireball while the body stayed in them).
async function ringAround(bot, task, feet, dy, blocks = SCAFFOLD, { maxMs = 2500, skipSide = null } = {}) {
  const t0 = Date.now(); let laid = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // The pool's side left open (note 1861): rings at every level on all four neighbours walled the fall line to the pool, and from a walled top every side read 'a floor 0 down'; 25588's water drop fired 0 times in runs 190 to 219 (2026-10-18), every descent 25 to 40 blocks dug under the dragon's body. The side the pool lies on is left un-ringed, as the pocket at the top already leaves it.
    if (skipSide && skipSide[0] === dx && skipSide[1] === dz) continue;
    if (Date.now() - t0 > maxMs) break;
    task.check();
    const cell = feet.offset(dx, dy, dz);
    if (bot.blockAt(cell)?.boundingBox === 'block') continue;
    const below = bot.blockAt(cell.offset(0, -1, 0)), inner = bot.blockAt(cell.offset(-dx, 0, -dz));
    let ref = null, face = null;
    if (below?.boundingBox === 'block') { ref = below; face = new Vec3(0, 1, 0); }
    else if (inner?.boundingBox === 'block') { ref = inner; face = new Vec3(dx, 0, dz); }
    else continue;
    const item = blocks.map(n => bot.inventory.items().find(i => i.name === n)).find(Boolean); if (!item) break;
    try { await bot.equip(item, 'hand'); await bot.lookAt(ref.position.offset(.5 + face.x * .5, .5 + face.y * .5, .5 + face.z * .5), true); await bot.placeBlock(ref, face); } catch (_) { continue; }
    if (bot.blockAt(cell)?.boundingBox === 'block') laid++;
  }
  return laid;
}
async function pillarUp(bot, task, targetY, { dig, maxBlocks = 40, threats = true, canDig = diggableAbove, blocks = SCAFFOLD, wet = false, enclose = false, encloseUntil = Infinity, encloseFrom = -Infinity, skipSide = null } = {}) {
  const { move } = require('./motion');
  let placed = 0, lastPlaceError = null, lastJump = '';
  let rested = false;
  while (bot.entity.position.y < targetY - 0.5 && placed < maxBlocks) {
    // A climb away from the threat itself does not stop for it.
    task.check(); checkAir(bot); if (threats) checkThreats(bot);
    const feet = bot.entity.position.floored();
    const head = feet.offset(0, 2, 0), above = bot.blockAt(head);
    // Why a climb stops, said once when it placed nothing (note 1417): 25588
    // (dragon-7, 2026-10-13 05:55Z) was 'stopped 35 blocks short, 0 up' with
    // 80 cobblestone carried and no word of why.
    // Out of the water to a dry cell beside first (note 1804): a jump from water reaches 0.8 and the climb stops before its first block, the body standing in the breath. 25588's dragon-123, 136, 137 and 169 (2026-10-14 to 17) each ended 'stopped before the first block: water at the feet ... a jump from water reaches 0.8', 'up out of the breath first: 0 blocks up', dead in the cloud within seconds. Once a climb; the dry cell with a block under it beside the feet, none over the void.
    // The water at the feet taken up into an empty bucket first (note 1904): the dry cell beside is often none in a pool's trench, and 25588's dragon-281 (2026-10-19 10:5xZ) and dragon-258 were refused the climb at the pool's edge six and thirty-two times, 'water at the feet'. The source within two of the feet goes back into the bucket and the flow drains before the climb.
    if (!rested && /water/.test(bot.blockAt(feet)?.name || '') && bot.inventory.items().some(i => i.name === 'bucket')) {
      try {
        const { sourceWater, fillWaterBucket } = require('./water');
    // The source within the bucket's reach, not within two (note 2208): the pool poured three cells from the column's foot ran into it, and dragon-318 (25589, 2026-10-26 12:05 to 12:19Z) was refused the climb eight times, 'water at the feet', no source within two and no dry cell beside in the trench, stood at the foot fifteen minutes and died in the breath; dragon-301 nine refusals, 312 seven.
        const src = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 5, count: 12, useExtraInfo: sourceWater }).map(p => p.floored()).filter(p => Math.abs(p.y - feet.y) <= 1 && Math.abs(p.x - feet.x) <= 3 && Math.abs(p.z - feet.z) <= 3 && feet.offset(.5, 1.62, .5).distanceTo(p.offset(.5, .5, .5)) <= 4.3).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet));
        // Each source in reach tried in turn, and why one was not taken said (note 2271): dragon-368 (25589, 2026-10-27
        // 02:22Z) poured its bucket against an enderman a block over and two off its feet, the breath came, nothing was said
        // of the scoop, the climb stopped before its first block, 'water at the feet', and it died in the cloud, 20 to none.
        // The flow drains a level a quarter second once its source is gone: waited up to 2.5 s (dragon-367 was 'still
        // wet in 1559 ms' and refused).
        const tried = [];
        for (const one of src.slice(0, 3)) {
          try {
            const t0 = Date.now(); await fillWaterBucket(bot, task, one, { timeoutMs: 1500 });
            for (let i = 0; i < 50 && /water/.test(bot.blockAt(feet)?.name || ''); i++) await new Promise(r => setTimeout(r, 50));
            console.log(`[pillar up] water at the feet at ${feet}: the source at ${one} taken up into the bucket, the feet ${/water/.test(bot.blockAt(feet)?.name || '') ? 'still wet' : 'dry'} in ${Date.now() - t0} ms`);
            tried.length = 0; break;
          } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; tried.push(`${one}: ${String(err.message || err).slice(0, 80)}`); }
        }
        if (tried.length) console.log(`[pillar up] water at the feet at ${feet}: no source taken up (${tried.join('; ')})`);
        else if (!src.length) console.log(`[pillar up] water at the feet at ${feet}: no source within the bucket's reach`);
      } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; console.log(`[pillar up] water at the feet: the scoop failed: ${String(err.message || err).slice(0, 120)}`); }
    }
    if (!rested && /water/.test(bot.blockAt(feet)?.name || '')) {
      const dry = directions.map(d => feet.plus(d)).find(c => { const b = bot.blockAt(c), u = bot.blockAt(c.offset(0, -1, 0)), o = bot.blockAt(c.offset(0, 1, 0)); return b && /^(air|cave_air)$/.test(b.name) && o && /^(air|cave_air)$/.test(o.name) && u?.boundingBox === 'block' && !/water|lava/.test(u.name); });
      if (dry) { rested = true; console.log(`[pillar up] water at the feet at ${feet}: the dry cell beside at ${dry} taken before the climb`); try { await require('./bridging').creepTo(bot, task, dry, 1500); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } continue; }
    }
    const why = climbStop(bot, feet, { canDig, wet });
    // Said after the first block too (note 1679): 25588 (dragon-214, 2026-10-15 00:00Z) laid one of two in the cloud at (40, 62, -5) and nothing said why the second did not go; 20 to none in three seconds.
    if (why) { console.log(`[pillar up] stopped ${placed ? `after ${placed} block${placed === 1 ? '' : 's'}` : 'before the first block'}: ${why}`); break; }
    if (!dryPassable(above)) {
      await dig(bot, task, head, { requireDrops: false });
      continue;
    }
    // A thin block in the feet's own cell dug first (note 1712): iron bars, a
    // pane or a fence stand in the cell the body jumps out of, and the block
    // laid there is refused. 25588 (dragon-254, 2026-10-15 09:24Z) stood in
    // a caged crystal's bars at (35, 82, -26) in the breath, 'Server refused to
    // place end_stone at (35, 82, -26): the block is still iron_bars' three
    // jumps, and the dragon's body threw it off the cage's top.
    { const own = bot.blockAt(feet); if (own && own.name !== 'air' && own.boundingBox !== 'empty' && !/water|lava|bedrock|obsidian|end_portal/.test(own.name)) { console.log(`[pillar up] the ${own.name} in the feet's cell at ${feet} dug before the climb`); try { await dig(bot, task, feet, { requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } } }
    // In the order the kinds are listed, not the pack's: rock before wood
    // before the gravel that falls.
    // End stone kept for the top (note 1806): the dragon's body smashes every block but end stone, obsidian and bedrock, and it flies at the column's top, where the pocket, the roof and the upper rings stand. End stone first on the low lift and rings left the top cobblestone: 25588's dragon-173 (2026-10-18 00:19Z) walled 36 of 39 levels to crystal 10 with 2 end stone left of 204 blocks, was hit through its cobblestone at 93 and 91 on the way down, 20 to 13 to 3 to none; dragon-170 and 176 the same with none. The lift and the ring here take another kind while the end stone carried is no more than the top's want: five a walled level still above, and eight for the pocket and the roof.
    const endStone = bot.inventory.items().filter(i => i.name === 'end_stone').reduce((k, i) => k + i.count, 0);
    const topWant = (enclose ? Math.max(0, Math.min(targetY, encloseUntil) - Math.max(feet.y + 1, encloseFrom)) * 5 : 0) + 8;
    const order = endStone <= topWant && blocks.some(n => n !== 'end_stone' && bot.inventory.items().some(i => i.name === n)) ? [...blocks.filter(n => n !== 'end_stone'), 'end_stone'] : blocks;
    const block = order.map(n => bot.inventory.items().find(i => i.name === n)).find(Boolean);
    if (!block) { console.log(`[pillar up] stopped ${placed ? `after ${placed}` : 'before the first block'}: no block of the kinds the climb lays carried`); break; }
    await bot.equip(block, 'hand');
    await bot.look(bot.entity.yaw, -Math.PI / 2, true);
    const start = feet.y;
    let below = bot.blockAt(feet.offset(0, -1, 0));
    // In the air, not off the column (note 1705): a hit mid-climb lifts the body, the cell under it reads air, and the climb walked to a 'resting cell' as far as eleven blocks off; the arena's drill (2026-10-15, scripts/climb-drill.js, the dragon's magic dealt four times during a two-block climb on a column one wide) ended 0 of 8 on the column, the body walked 11 to 12 blocks away. The feet are waited for, up to six tenths of a second, before any walk.
    if ((!below || below.boundingBox !== 'block') && bot.entity.onGround === false) {
      for (let i = 0; i < 12 && !bot.entity.onGround; i++) { task.check(); await new Promise(resolve => setTimeout(resolve, 50)); }
      if (bot.entity.onGround) continue;
    }
    // The body at the edge of the block it stands on, its middle over air
    // (note 1456): onto the block it rests on first, as the span does
    // (restingCell, note 533). 25588 (dragon-36, 2026-10-13 11:16Z, full
    // iron, crystal 11 broken) stood on its column at (-13, -44) with its
    // middle over (-12, -45), 'air under the feet' fifteen times, and the
    // breath took it there.
    if ((!below || below.boundingBox !== 'block') && !rested) {
      const rest = require('./terrain').restingCell(bot);
      if (rest && !rest.equals(feet)) { rested = true; await require('./bridging').creepTo(bot, task, rest, 1500); continue; }
    }
    rested = false;
    if (!below || below.boundingBox !== 'block') { console.log(`[pillar up] stopped ${placed ? `after ${placed}` : 'before the first block'}: ${below ? below.name : 'nothing'} under the feet at ${feet}`); break; }
    // Placed with the look already down (set before the jump): placeBlock's
    // own smooth turn took ticks, the bot fell back into the cell before the
    // packet went, and the server refused every block of a pillar from two
    // hoglins in the arena.
    // The block laid under where the body is at the place (note 1687), not under where it stood before the jump: the jump carries the body a cell over at times ('the jump carried the body from (-14, 34) to (-14, 35)', 25588's dragon-222, 2026-10-15 01:4xZ), and a block laid under the old cell lifts nothing; 'the block was not placed in three jumps' was the climb out of the breath laying one of two in dragon-214, 215, 216, 220 and 221, each dead in its cloud. With air under the new cell the place is not tried.
    const place = async () => {
      // The block back in the hand at the place (note 1804): the clutch and the dig equip the bucket and the pickaxe between the equip above and the place, and the place said 'Server refused to place iron_pickaxe' or 'water_bucket' on 25588's dragon-111, 147, 152 and 161 (2026-10-14 to 17), the climb out of the breath stopped before its first block and the body dead in the cloud.
      if (bot.heldItem?.name !== block.name) { const again = bot.inventory.items().find(i => i.name === block.name); if (again) await bot.equip(again, 'hand'); }
      let ref = below;
      const now = bot.entity.position.floored();
      if (now.x !== feet.x || now.z !== feet.z) {
        const under = bot.blockAt(now.offset(0, -1, 0));
        if (!under || under.boundingBox !== 'block') throw new Error(`the body over (${now.x}, ${now.z}) with ${under ? under.name : 'nothing'} under it, not over its cell`);
        ref = under;
      }
      return bot._placeBlockWithOptions ? bot._placeBlockWithOptions(ref, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: true }) : bot.placeBlock(ref, new Vec3(0, 1, 0));
    };
    // A block the server refused is tried again, three jumps at most (note
    // 1415): on the live servers, fourteen trials to a machine, the
    // position runs further behind than the arena's, and a climb that gave up
    // at the first refusal placed nothing three times running (25588,
    // 2026-10-13 05:50Z, 'The pillar stopped 36 blocks short, 0 up').
    for (let attempt = 0; attempt < 3 && bot.entity.position.floored().y <= start; attempt++) {
      task.check();
      // The body still before the jump (note 1685): a jump with the run's momentum left in it lands a cell over, and on a stub one block wide that is off it. 25588 (dragon-220, 2026-10-15 01:06Z) laid one block of two in the cloud at (3, 64, -4), jumped three times for the second, 'the block was not placed in three jumps (on ground true)', and was found three blocks lower at (3, 62, -7), off its stub, 9.9 health; dragon-214, 215 and 216 laid one of two the same way. The keys are let go and up to three tenths of a second waited for the body to stand still; a jump that lands in another cell is said.
      // The pathfinder's goal let go too (note 2692): with a walk's goal still set it put its keys back every tick, and the
      // jump landed a cell or two over with air under it. full-248 (25587, 2026-10-31 08:19:33Z) at 12 health between a
      // husk and a zombie had 'the jump carried the body from (-453, 775) to (-453, 773)' and 'the block was not placed in
      // three jumps ... the body over (-453, 773) with air under it, not over its cell', fought on the ground instead and
      // was killed by a witch at 1.08; 51 such 'stopped before the first block' lines today, 37 of them with the body over
      // another cell.
      try { bot.pathfinder?.setGoal?.(null); } catch (_) { /* no pathfinder */ }
      bot.clearControlStates?.();
      for (let i = 0; i < 30 && bot.entity.velocity && Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z) > 0.03; i++) await new Promise(resolve => setTimeout(resolve, 20));
      const cellBefore = bot.entity.position.floored();
      let peak = bot.entity.position.y;
      await move(bot, task, { label: 'pillar_up', keys: ['jump'], sneak: false, until: () => { peak = Math.max(peak, bot.entity.position.y); return bot.entity.position.y >= start + 1.1; }, maxMs: 1200, tick: 20 });
      { const c = bot.entity.position.floored(); if (c.x !== cellBefore.x || c.z !== cellBefore.z) console.log(`[pillar up] the jump carried the body from (${cellBefore.x}, ${cellBefore.z}) to (${c.x}, ${c.z})`); }
      // The server has the position a tick behind: placed the moment the feet
      // cleared the cell here, it still saw the body in it and refused.
      await new Promise(resolve => setTimeout(resolve, 60 + attempt * 60));
      // The column's base kept with the record (note 1610): the lowest block laid, so that its own end stone above it is told from the island's without reading the sides.
      lastJump = `the jump reached ${Math.round((peak - start) * 100) / 100} over the start, the body at ${Math.round((bot.entity.position.y - start) * 100) / 100} at the place`;
      try { lastPlaceError = null; await place(); placed++; try { await require('./opportunistic-mining').mineWithinReach(bot, task); } catch (e2) { if (['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(e2.name)) throw e2; } const prev = bot._pillarUp; bot._pillarUp = { x: feet.x, z: feet.z, until: Date.now() + 600000, base: prev && prev.x === feet.x && prev.z === feet.z && prev.base != null && prev.until > Date.now() ? Math.min(prev.base, feet.y) : feet.y }; }
      catch (err) { task.check(); lastPlaceError = String(err.message || err).slice(0, 80); }
      for (let i = 0; i < 20 && !bot.entity.onGround; i++) { task.check(); await new Promise(resolve => setTimeout(resolve, 25)); }
      if (bot.entity.position.floored().y > start) break;
      if (bot.blockAt(feet)?.boundingBox === 'block') break;
    }
    // Said after the first block too, with the place's own error (note 1680): the climb out of the breath laid one of two and said nothing of the second; 25588 (dragon-216, 2026-10-15 00:2xZ, 1679 live) '1 blocks up' at (-6, 60, 35) at 9 health and '0 blocks up' at (-9, 61, 42), each three jumps of 1.2 s in a cloud of six a second.
    // The ring about the new cell (note 1753): at the feet (the level below's head ring, or the first level's) and at the head, while the blocks carried cover the rest of the climb and four more.
    // The walls from a height (note 1770): with too few blocks for every level, the top levels are walled and the lower climbed bare, the top being where the body waits for the perch and falls farthest from.
    if (enclose && bot.entity.position.floored().y > start && bot.entity.position.floored().y < encloseUntil && bot.entity.position.floored().y >= encloseFrom) {
      const nf = bot.entity.position.floored(), have = blocks.reduce((n, k) => n + bot.inventory.items().filter(i => i.name === k).reduce((m, i) => m + i.count, 0), 0);
      // From a level under the feet (note 1756): the cell beside the feet has nothing under it on a column one wide, and the first ring is laid against the column's own block below the feet; the arena's drill (2026-10-16 06:48Z, CLIMB_ENCLOSE=1) laid no ring block at the feet's and the head's levels alone. A level already ringed is skipped, so the first level is twelve blocks and each after it four.
      if (have >= Math.max(0, targetY - nf.y) + 4) { let n = 0; for (const dy of [-1, 0, 1]) n += await ringAround(bot, task, nf, dy, order, { skipSide }); if (n) bot._ringLaid = (bot._ringLaid || 0) + n; }
    }
    // The pool's fall line dug clear on the way up (note 1886): the drop steps off the open side and falls through the two cells beyond it, and a leftover block there, an earlier column's ring, stops the drop. 25588's dragon-237 (2026-10-18 23:5xZ, four crystals) climbed 38 over its pool at (-50, 61, -3), and at the top: 'end_stone in the fall's way at (-48, 69, -3), 7 over the floor', no drop, the way down dug at 4 health, dead at 78. Each level's two cells on the pool's side, at the feet and the head, are dug as the body passes them.
    if (skipSide && dig && bot.entity.position.floored().y > start) {
      const nf = bot.entity.position.floored();
      for (const k of [1, 2]) for (const dy of [0, 1]) {
        const c = nf.offset(skipSide[0] * k, dy, skipSide[1] * k), b = bot.blockAt(c);
        if (b?.boundingBox !== 'block' || /obsidian|bedrock|end_portal/.test(b.name)) continue;
        try { await dig(bot, task, c, { requireDrops: false }); bot._fallLineCleared = (bot._fallLineCleared || 0) + 1; console.log(`[pillar up] the pool's fall line cleared at ${c}: ${b.name} dug`); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
      }
    }
    if (bot.entity.position.floored().y <= start) { console.log(`[pillar up] stopped ${placed ? `after ${placed}` : 'before the first block'}: the block was not placed in three jumps from ${feet} (on ground ${bot.entity.onGround}, ${block.name} in hand${lastPlaceError ? `, the place said: ${lastPlaceError}` : ''}${lastJump ? `; ${lastJump}; the cell at the feet is ${bot.blockAt(feet)?.name || 'unloaded'}` : ''})`); break; }
  }
  return placed;
}

// Where to stand for the pillar: the nearest column, within a few blocks
// of the bot and six sideways of the target, with a floor to start from
// and every cell up to the target's height air or diggable, with no lava or
// water in or beside it. Under the portal the lava fall was beside the
// column the bot stood in, and the pillar stopped before its first block.
// The lee wall for a climb under the dragon's breath (note 1705): every hit of the breath knocks the body away from the dragon, 1.4 blocks in a fifth of a second, and on a top one block wide that is off it; the arena's drill (2026-10-15, scripts/climb-drill.js, the dragon's magic dealt four times during a two-block climb) ended 0 of 8 on the column bare and 8 of 8 with a wall on the side away from the dragon at the heights the body rises through. The wall is laid on the cardinal side away from 'from', from the level under the feet to three over them, each block against the one below, the first against the column's own side. Returns the blocks laid.
async function leeWall(bot, task, from, { blocks = SCAFFOLD, maxMs = 2500 } = {}) {
  const feet = bot.entity.position.floored(), dx0 = feet.x + .5 - from.x, dz0 = feet.z + .5 - from.z;
  const [dx, dz] = Math.abs(dx0) >= Math.abs(dz0) ? [Math.sign(dx0) || 1, 0] : [0, Math.sign(dz0) || 1];
  const t0 = Date.now(); let laid = 0;
  for (let dy = -1; dy <= 3 && Date.now() - t0 < maxMs; dy++) {
    task.check();
    const cell = feet.offset(dx, dy, dz);
    if (bot.blockAt(cell)?.boundingBox === 'block') continue;
    const below = bot.blockAt(cell.offset(0, -1, 0)), side = bot.blockAt(cell.offset(-dx, 0, -dz));
    let ref = null, face = null;
    if (below?.boundingBox === 'block') { ref = below; face = new Vec3(0, 1, 0); }
    else if (side?.boundingBox === 'block') { ref = side; face = new Vec3(dx, 0, dz); }
    else break;
    const item = blocks.map(n => bot.inventory.items().find(i => i.name === n)).find(Boolean); if (!item) break;
    try { await bot.equip(item, 'hand'); await bot.lookAt(ref.position.offset(.5 + face.x * .5, .5 + face.y * .5, .5 + face.z * .5), true); await bot.placeBlock(ref, face); } catch (_) { break; }
    if (bot.blockAt(cell)?.boundingBox === 'block') laid++; else break;
  }
  return laid;
}
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

module.exports = { ringAround, leeWall, pillarHeight, pillarDescent, descendPillar, pillarUp, pillarSite, climbStop, SCAFFOLD, DIGGABLE_ABOVE };
