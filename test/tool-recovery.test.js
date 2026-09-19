'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { replacementPlan, bootstrapPickaxe } = require('../src/tool-recovery');
const { planningInventory } = require('../src/work');
const registry = require('minecraft-data')('26.1');

function fixture(tool = 'wooden_pickaxe', uses = 1) {
  const items = [{ name: tool, count: 1, type: registry.itemsByName[tool].id, durabilityUsed: registry.itemsByName[tool].maxDurability - uses },
    { name: 'cobblestone', count: 2 }, { name: 'stick', count: 2 }, { name: 'crafting_table', count: 1 }];
  const target = new Vec3(1, 51, 0), bot = { registry, game: { gameMode: 'survival', difficulty: 'peaceful' },
    entity: { position: new Vec3(.5, 51, .5) }, inventory: { items: () => items }, entities: {},
    canDigBlock: () => true, findBlocks: () => [target],
    blockAt: p => ({ position: p, name: p.y < 51 || p.equals(target) ? 'stone' : 'air',
      boundingBox: p.y < 51 || p.equals(target) ? 'block' : 'empty', diggable: true }),
    pathfinder: { movements: { canDig: true, scafoldingBlocks: [registry.itemsByName.cobblestone.id], allow1by1towers: true } } };
  return { bot, items, target };
}

test('a last-use wooden or stone pick can fund its replacement without becoming a generally usable tool', () => {
  for (const name of ['wooden_pickaxe', 'stone_pickaxe']) {
    const { bot } = fixture(name), proof = replacementPlan(bot);
    assert(proof);
    assert.equal(proof.step.tool, name);
    assert.equal(proof.step.count, 1);
    assert.equal(proof.plan.at(-1).item, 'stone_pickaxe');
    assert.equal(planningInventory(bot)[name], 0);
  }
});

test('replacement proof rejects insufficient swings, missing sticks or table, and zero durability', () => {
  for (const missing of ['stick', 'crafting_table', 'cobblestone']) {
    const { bot, items } = fixture(); items.splice(items.findIndex(i => i.name === missing), 1);
    assert.equal(replacementPlan(bot), null, missing);
  }
  assert.equal(replacementPlan(fixture('wooden_pickaxe', 0).bot), null);
  assert.equal(replacementPlan(fixture('wooden_pickaxe', 8).bot), null);
  const { bot, items } = fixture('wooden_pickaxe', 2); items.find(i => i.name === 'cobblestone').count = 1;
  assert.equal(replacementPlan(bot).plan[0].count, 2);
});

test('emergency mining preserves ingredients and requires actual pickup before reporting progress', async () => {
  for (const pickup of [true, false]) {
    const { bot, items, target } = fixture(), before = { ...bot.pathfinder.movements }, goal = {};
    const attempt = bootstrapPickaxe(bot, new Task('replacement'), goal, () => {}, { mine: async (_bot, task, step, _goal, _save, p) => {
      task.check(); assert(p.equals(target)); assert.equal(step.minimumToolDurability, 1);
      assert.equal(bot.pathfinder.movements.canDig, false);
      assert.deepEqual(bot.pathfinder.movements.scafoldingBlocks, []);
      assert.equal(bot.pathfinder.movements.allow1by1towers, false);
      items.shift(); // The worn tool breaks on this dig.
      if (pickup) items.find(i => i.name === 'cobblestone').count++;
    } });
    if (pickup) { assert(await attempt); assert.equal(goal.toolRecovery.collected, 1); }
    else { await assert.rejects(attempt, /pickup was not confirmed/); assert.equal(goal.toolRecovery, undefined); }
    assert.deepEqual(bot.pathfinder.movements, before);
  }
});

test('last-use recovery never travels to unseen stone, digs a wet ceiling, or ignores cancellation', async () => {
  for (const reason of ['unreachable', 'wet', 'cancelled']) {
    const { bot, target } = fixture(), task = new Task('replacement');
    if (reason === 'unreachable') bot.canDigBlock = () => false;
    if (reason === 'wet') { const at = bot.blockAt; bot.blockAt = p => p.equals(target.offset(0, 1, 0)) ? { name: 'water' } : at(p); }
    if (reason === 'cancelled') task.cancel();
    const call = bootstrapPickaxe(bot, task, {}, () => {}, { mine: async () => assert.fail('Must not spend the last swing') });
    if (reason === 'cancelled') await assert.rejects(call, { name: 'Cancelled' });
    else assert.equal(await call, false);
  }
});
