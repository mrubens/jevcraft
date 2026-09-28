'use strict';
// mid-243-ag-fortress-5 (25589), 18:19:37Z on 2026-09-28, 3.5 health: Jev chose the
// pillar against a hoglin (priced at no damage, "two up, none of them reaches it"), the
// two blocks went up, and the edge reflex took the bot down off them into the hoglin's
// reach at once (the heavy hitter's toss counted whether or not its blow reaches the
// top). The bot was struck dead two seconds later (note 626).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');

// A pillar column at (0, 39..40) standing at the west edge of a platform of firm ground (y 38
// and under; a chasm over lava to the west), the bot on top of the column at y 41, the hoglin on the ground six blocks off (or on a
// ledge as high as the top), and firm ground beside the pillar's top (a rise of a block or
// two at x 8 to 14) for the reflex to step to.
function scene({ hoglinY, health = 3.5 }) {
  const hoglin = { id: 5, name: 'hoglin', type: 'hostile', position: new Vec3(6.5, hoglinY, 0.5), height: 1.4, isValid: true };
  const ledge = hoglinY > 39 ? hoglinY - 1 : 38;
  const solid = p => (p.x === 0 && p.z === 0 && p.y >= 39 && p.y <= 40) || (p.x >= 0 && p.x <= 30 && Math.abs(p.z) <= 30 && p.y <= 38 && p.y >= 20) || (p.x >= 6 && p.x <= 7 && Math.abs(p.z) <= 1 && p.y <= ledge && p.y >= 20)
    || (p.x >= 8 && p.x <= 14 && Math.abs(p.z) <= 6 && p.y <= 40 && p.y >= 20);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 5: hoglin }, health, food: 13, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 41, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), width: 0.6, height: 1.8 }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 12 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: solid(p) ? 'netherrack' : p.y <= 19 ? 'lava' : 'air', boundingBox: solid(p) ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  return bot;
}

async function run(bot) {
  let to = null;
  // Jev's pillar chosen a second ago and held (danger.js stanceHeld): the reflex block is the
  // one that runs with a stance held, as at 18:19:38.
  bot._stance = { choice: 'pillar', at: Date.now() - 1000, ranAt: Date.now(), running: true, health: bot.health, ids: [5], kinds: ['hoglin'], mobs: [] };
  const survival = new Survival(bot, { navigate: async (b, t, g) => { to = g; } }, { state: { shelters: [] } });
  survival.state.pillar = { x: 0, y: 39, z: 0 };
  const goal = {};
  await survival.step(new Task('leg'), goal, () => {});
  return { action: goal.survivalAction?.action, to };
}

test('on its own two-up pillar with a hoglin on the ground six blocks off, the edge reflex does not take the bot down', async () => {
  const { action, to } = await run(scene({ hoglinY: 39 }));
  assert.notEqual(action, 'off_the_edge');
  assert.equal(to, null, 'no walk to the ground');
});

test('a hoglin whose blow reaches the top (on ground as high as the bot\'s feet) still has the bot step off the edge', async () => {
  const { to } = await run(scene({ hoglinY: 41 }));
  assert(to && to.x >= 6, `walked to the firm ground beside: ${to && to.x}`);
});

test('not on a pillar at all, a hoglin about and a drop beside: off the edge as before', async () => {
  const bot = scene({ hoglinY: 39 });
  bot.entity.position = new Vec3(0.5, 39, 4.5);
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const goal = {};
  await survival.step(new Task('leg'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_the_edge');
});
