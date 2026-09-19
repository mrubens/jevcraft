'use strict';
const { goals } = require('mineflayer-pathfinder');
const { countOf, surveyRoute } = require('./skills');
const { dryMiningPositions, miningReach, miningMovement, dryStanding } = require('./mining-access');
const { checkThreats } = require('./danger');
const { checkAir } = require('./vitals');
const sourceWater = b => b?.name === 'water' && Number(b.getProperties?.().level ?? b.metadata ?? 0) === 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fillWaterBucket(bot, task, position, { timeoutMs = 2500, guard = () => {} } = {}) {
  const check = () => { task.check(); checkAir(bot); guard(); };
  check();
  if (!sourceWater(bot.blockAt(position))) throw new Error('Bucket filling requires an observed water source');
  const bucket = bot.inventory.items().find(i => i.name === 'bucket');
  if (!bucket) throw new Error('No empty bucket to fill');
  const before = countOf(bot, 'water_bucket'), emptyBefore = countOf(bot, 'bucket');
  await bot.equip(bucket, 'hand'); check();
  const checkReach = () => {
    const eye = bot.entity.position.offset(0, 1.62, 0), delta = position.offset(.5, .5, .5).minus(eye);
    const hit = bot.world.raycast(eye, delta.unit(), delta.norm());
    if (delta.norm() > 4.5 || hit && eye.distanceTo(hit.intersect || hit.position) < delta.norm() - .1) throw new Error('Water source is outside visible interaction reach');
  };
  checkReach();
  await bot.lookAt(position.offset(.5, .5, .5), false); check();
  checkReach();
  if (!sourceWater(bot.blockAt(position))) throw new Error('Water source changed before filling the bucket');
  bot.activateItem();
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      check();
      if (countOf(bot, 'water_bucket') === before + 1 && countOf(bot, 'bucket') === emptyBefore - 1) return;
      await sleep(25);
    }
    throw new Error('No water-bucket inventory conversion was confirmed');
  } finally { bot.deactivateItem(); }
}

async function collectWater(bot, task, goal, save, { navigate, explore }) {
  task.check(); checkAir(bot); checkThreats(bot);
  const sources = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 48, count: 24, useExtraInfo: sourceWater });
  const movement = miningMovement(bot);
  try {
    for (const p of sources) {
      const positions = dryStanding(bot, bot.entity.position) && miningReach(bot, bot.entity.position, p) ?
        [bot.entity.position.floored(), ...dryMiningPositions(bot, p)] : dryMiningPositions(bot, p);
      for (const q of positions.slice(0, 6)) {
        task.check(); checkThreats(bot);
        const destination = new goals.GoalBlock(q.x, q.y, q.z);
        const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 250);
        if (route.status !== 'success') continue;
        await navigate(bot, task, destination, { timeoutMs: 10000, stallMs: 3000 });
        await fillWaterBucket(bot, task, p, { guard: () => checkThreats(bot) });
        if (goal.search?.water) goal.search.water.attempts = 0;
        goal.step = { action: 'fill_bucket', position: { ...p }, item: 'water_bucket', confirmed: true }; save(); return;
      }
    }
  } finally { movement.restore(); }
  await explore(bot, task, goal, save, 'water', { surfaceOnly: true });
}
module.exports = { sourceWater, fillWaterBucket, collectWater };
