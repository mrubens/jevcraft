'use strict';
// Beds against the perched dragon. Outside the Overworld a bed explodes
// when slept in, power five, at its head half: beside the dragon's head it
// is the heaviest blow the bot can deal (the user, 2026-09-24).
//
// Measured on the rehearsal server (2026-09-24, iron armour, full health):
// clicking a bed three or four blocks off on open ground killed the
// clicker. From a trench one block deep, sneaking, the bed's foot three
// blocks off and its head four, the blast took 4.4 to 6.7: the ground in
// front covers the legs and body, and the bed's near side is still in
// plain sight, so the click is one a player makes. A trench two deep
// took none, but the bed cannot be seen from there, and a click through
// the ground is not a player's click; that one is never used.
//
// So: stand three blocks from the bed's foot in line with it, dig the block
// underfoot, drop into it, lay the bed toward the dragon, sneak, and click
// the foot half.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');

const DIRS = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const NATURAL = /^(end_stone|stone|cobblestone|dirt|netherrack|deepslate|cobbled_deepslate|andesite|diorite|granite|tuff|blackstone|basalt)$/;
const HEAD_REACH = 2.5;
const solid = b => b?.boundingBox === 'block';
const clear = b => !!b && b.boundingBox === 'empty' && !/water|lava|fire/.test(b.name);
const bedsCarried = bot => bot.inventory.items().filter(i => /_bed$/.test(i.name)).reduce((n, i) => n + i.count, 0);

// Where to lay a bed so its head half is by the dragon's head, and where to
// stand to blow it: null when the ground allows no such line.
function bedPlans(bot, head) {
  const h = new Vec3(Math.floor(head.x), Math.floor(head.y), Math.floor(head.z));
  const plans = [];
  for (let dy = -3; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const top = h.offset(dx, dy, dz);
    if (top.offset(0.5, 0.3, 0.5).distanceTo(head) > HEAD_REACH) continue;
    if (!clear(bot.blockAt(top)) || !solid(bot.blockAt(top.offset(0, -1, 0)))) continue;
    for (const d of DIRS) {
      const foot = top.minus(d), stand = foot.minus(d.scaled(3)), y = top.y;
      if (!clear(bot.blockAt(foot)) || !solid(bot.blockAt(foot.offset(0, -1, 0)))) continue;
      // The trench: the block under the stand dug, the one under that kept.
      const floor = bot.blockAt(stand.offset(0, -1, 0));
      if (!floor || !NATURAL.test(floor.name) || !solid(bot.blockAt(stand.offset(0, -2, 0)))) continue;
      if (!clear(bot.blockAt(stand)) || !clear(bot.blockAt(stand.offset(0, 1, 0)))) continue;
      // Cover in front and a clear line over it to the bed's near side.
      let line = true;
      for (let k = 1; k <= 2 && line; k++) {
        const cell = stand.plus(d.scaled(k));
        line = solid(bot.blockAt(cell.offset(0, -1, 0))) && clear(bot.blockAt(cell));
      }
      if (!line) continue;
      plans.push({ stand, foot, top, dir: d, y, gap: top.offset(0.5, 0.3, 0.5).distanceTo(head), walk: stand.distanceTo(bot.entity.position) });
    }
  }
  return plans.sort((a, b) => a.gap - b.gap || a.walk - b.walk);
}
const bedPlan = (bot, head) => bedPlans(bot, head)[0] || null;

// Walk, dig in, lay the bed, click it. `stillPerched()` is asked before
// the bed goes down: a dragon that has taken off is not bombed.
async function bedBomb(bot, task, plan, { navigate, dig, stillPerched = () => true }) {
  const { stand, foot, dir } = plan;
  await navigate(bot, task, new goals.GoalBlock(stand.x, stand.y, stand.z), { timeoutMs: 6000, stallMs: 2500 });
  task.check();
  const here = bot.entity.position.floored();
  if (here.x !== stand.x || here.z !== stand.z || here.y !== stand.y) throw new Error('Could not stand at the bed line');
  await dig(bot, task, stand.offset(0, -1, 0), { requireDrops: false });
  for (let i = 0; i < 20 && bot.entity.position.y > stand.y - 0.9; i++) { task.check(); await new Promise(r => setTimeout(r, 50)); }
  if (bot.entity.position.y > stand.y - 0.9) throw new Error('Did not drop into the trench');
  if (!stillPerched()) throw new Error('The dragon took off before the bed went down');
  const bed = bot.inventory.items().find(i => /_bed$/.test(i.name));
  if (!bed) throw new Error('No bed carried');
  await bot.equip(bed, 'hand');
  // Facing along the line, so the head half goes on toward the dragon.
  await bot.look(Math.atan2(-dir.x, -dir.z), -0.35, true);
  await bot.placeBlock(bot.blockAt(foot.offset(0, -1, 0)), new Vec3(0, 1, 0));
  const placed = bot.blockAt(foot);
  if (!/_bed$/.test(placed?.name || '')) throw new Error('The bed did not go down');
  bot.setControlState('sneak', true);
  try {
    await bot.lookAt(foot.offset(0.5 - dir.x * 0.48, 0.3, 0.5 - dir.z * 0.48), true);
    await bot.activateBlock(placed);
    for (let i = 0; i < 10; i++) { task.check(); await new Promise(r => setTimeout(r, 50)); }
  } finally { bot.setControlState('sneak', false); }
  return !/_bed$/.test(bot.blockAt(foot)?.name || '');
}

module.exports = { bedPlans, bedPlan, bedBomb, bedsCarried, HEAD_REACH };
