'use strict';
const { Vec3 } = require('vec3');
const { dryPassable, damagingTerrain, supportCell } = require('./terrain');
const { reservedForConstruction } = require('./build-sites');
const { safeFromHostiles, checkThreats } = require('./danger');
const { equipBestTool } = require('./skills');
const { checkAir, digWithAirGuard } = require('./vitals');
const directions = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const material = /^(dirt|cobblestone|cobbled_deepslate|stone|deepslate|granite|diorite|andesite|tuff|netherrack)$|_log$/;
const fullCube = b => b && !damagingTerrain.has(b.name) && b.shapes?.some(s =>
  s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 1 && s[4] === 1 && s[5] === 1);
const unsafe = b => !b || damagingTerrain.has(b.name) || ['water', 'bubble_column'].includes(b.name);

// This is an inspected one-block descent, never a general shaft-digging rule.
// An exposed support and a full solid block immediately below distinguish a
// pillar step from digging blindly through ordinary terrain or a cave ceiling.
function pillarDescent(bot, goal) {
  const feet = bot.entity.position, blockPosition = supportCell(feet), block = bot.blockAt(blockPosition);
  if (bot.entity.onGround === false || Math.abs(feet.y - blockPosition.y - 1) > 0.05 ||
    Math.abs(feet.x - blockPosition.x - .5) > .18 || Math.abs(feet.z - blockPosition.z - .5) > .18) return null;
  const ownedAccess = goal.buildPhase === 'cleanup' && goal.buildOwned?.[`${blockPosition.x},${blockPosition.y},${blockPosition.z}`] === (block?.stateId ?? block?.name) &&
    !goal.blueprint?.blocks?.some(p => p.x === blockPosition.x && p.y === blockPosition.y && p.z === blockPosition.z);
  if (!material.test(block?.name || '') || !block.diggable || !fullCube(block) || reservedForConstruction(goal, blockPosition) && !ownedAccess) return null;
  const floor = bot.blockAt(blockPosition.offset(0, -1, 0));
  if (!fullCube(floor) || !material.test(floor.name) && !['grass_block', 'bedrock'].includes(floor.name) && !(ownedAccess && !['sand', 'red_sand', 'gravel'].includes(floor.name))) return null;
  if (!dryPassable(bot.blockAt(blockPosition.offset(0, 1, 0))) || !dryPassable(bot.blockAt(blockPosition.offset(0, 2, 0)))) return null;
  if (directions.filter(d => dryPassable(bot.blockAt(blockPosition.plus(d)))).length < 2) return null;
  for (const d of directions) for (const dy of [-1, 0, 1]) if (unsafe(bot.blockAt(blockPosition.plus(d).offset(0, dy, 0)))) return null;
  const destination = blockPosition.offset(.5, 0, .5);
  if (!safeFromHostiles(bot, destination) || block.harvestTools && !bot.inventory.items().some(i => block.harvestTools[i.type])) return null;
  return { block: { ...blockPosition }, blockName: block.name, floorName: floor.name, destination: { ...destination } };
}

async function descendPillar(bot, task, goal, save, expected) {
  task.check(); checkAir(bot); checkThreats(bot);
  const candidate = pillarDescent(bot, goal);
  if (!candidate || expected && JSON.stringify(candidate) !== JSON.stringify(expected)) return false;
  bot.pathfinder.setGoal(null); bot.clearControlStates?.();
  const p = new Vec3(candidate.block.x, candidate.block.y, candidate.block.z);
  await equipBestTool(bot, bot.blockAt(p));
  task.check(); checkAir(bot); checkThreats(bot);
  if (JSON.stringify(pillarDescent(bot, goal)) !== JSON.stringify(candidate)) throw new Error('Pillar footing changed before descent');
  goal.step = { action: 'descend_pillar', ...candidate }; save();
  // Mineflayer resolves dig() after its optimistic local air update. A dig
  // beneath our feet must wait for the server's block packet as well.
  let confirmed = false, landedSince = 0;
  const changed = packet => {
    if (packet.location?.x === p.x && packet.location.y === p.y && packet.location.z === p.z) confirmed = packet.type === 0;
  };
  bot._client.on('block_change', changed);
  try {
    await digWithAirGuard(bot, task, bot.blockAt(p));
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      task.check(); checkAir(bot); checkThreats(bot);
      const now = bot.entity.position;
      if (confirmed && dryPassable(bot.blockAt(p)) && fullCube(bot.blockAt(p.offset(0, -1, 0))) &&
        Math.abs(now.y - p.y) < .08 && Math.hypot(now.x - p.x - .5, now.z - p.z - .5) < .3 && bot.entity.onGround !== false) {
        landedSince ||= Date.now();
        if (Date.now() - landedSince >= 250) { goal.step.landed = { ...now }; save(); return true; }
      } else landedSince = 0;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Pillar descent did not reach its server-confirmed landing');
  } finally { bot._client.removeListener('block_change', changed); }
}
module.exports = { pillarDescent, descendPillar };
