'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { replacementPlan, bootstrapPickaxe } = require('../src/tool-recovery');
const { planningInventory, acquireStep } = require('../src/work');
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

test('a mining request uses the last safe swing for a replacement instead of searching for new wood', async () => {
  const { bot, items, target } = fixture(); let removed = false;
  const originalAt = bot.blockAt;
  bot.blockAt = p => {
    const b = originalAt(p);
    if (removed && p.equals(target)) { b.name = 'air'; b.boundingBox = 'empty'; }
    b.type = registry.blocksByName[b.name].id; b.digTime = () => 1;
    return b;
  };
  bot.findBlocks = ({ matching }) => matching.includes(registry.blocksByName.stone.id) && !removed ? [target] : [];
  bot.equip = async item => { bot.heldItem = item; };
  bot.dig = async () => { removed = true; items.shift(); items.find(i => i.name === 'cobblestone').count++; };
  const goal = { kind: 'obtain', item: 'cobblestone', count: 8, request: 'Get eight cobblestone' };
  await acquireStep(bot, new Task('mining with a worn pick'), 'cobblestone', 8, goal, () => {});
  assert.equal(goal.toolRecovery?.collected, 1);
  assert.equal(items.find(i => i.name === 'cobblestone').count, 3);
  assert.equal(goal.request, 'Get eight cobblestone');
});

test('replacement proof continues from carried ingredients after the worn pick breaks', () => {
  const { bot, items } = fixture(); items.shift(); items.find(i => i.name === 'cobblestone').count = 3;
  const proof = replacementPlan(bot);
  assert(proof, 'Three stone, two sticks and a table can make the replacement without new wood');
  assert.equal(proof.step.action, 'craft'); assert.equal(proof.step.item, 'stone_pickaxe');
});

test('a verified world table can fund replacement, but virtual ingredients cannot', () => {
  const { bot, items } = fixture(); items.splice(items.findIndex(i => i.name === 'crafting_table'), 1);
  assert.equal(replacementPlan(bot), null);
  assert(replacementPlan(bot, { crafting_table: 1 }));
  items.splice(items.findIndex(i => i.name === 'stick'), 1);
  assert.equal(replacementPlan(bot, { crafting_table: 1, stick: 2 }), null);
});

test('replacement crafting confirms the new tool and restores restrictions after stop or missing output', async () => {
  for (const result of ['made', 'missing', 'cancelled']) {
    const { bot, items } = fixture(); items.shift(); items.find(i => i.name === 'cobblestone').count = 3;
    const before = { ...bot.pathfinder.movements }, task = new Task('craft replacement'), goal = {};
    const attempt = bootstrapPickaxe(bot, task, goal, () => {}, { mine: async () => assert.fail('Ingredients already carried'),
      craft: async (_b, _t, step) => {
        assert.equal(step.item, 'stone_pickaxe'); assert.equal(bot.pathfinder.movements.canDig, false);
        assert.deepEqual(bot.pathfinder.movements.scafoldingBlocks, []);
        if (result !== 'missing') items.push({ name: 'stone_pickaxe', count: 1 });
        if (result === 'cancelled') { task.cancel(); task.check(); }
      } });
    if (result === 'made') { assert(await attempt); assert.equal(goal.toolRecovery.item, 'stone_pickaxe'); }
    else await assert.rejects(attempt, result === 'cancelled' ? { name: 'Cancelled' } : /not confirmed/);
    assert.deepEqual(bot.pathfinder.movements, before);
  }
});

test('recovery preserves minimum mining height and does not spend a healthy tool on a replacement', async () => {
  const { bot, target } = fixture();
  assert.equal(await bootstrapPickaxe(bot, new Task('keep foundation'), {}, () => {}, { minimumMiningY: target.y + 1,
    mine: async () => assert.fail('Below the permitted mining layer') }), false);
  const healthy = fixture('iron_pickaxe', 8); healthy.items.find(i => i.name === 'cobblestone').count = 3;
  assert.equal(replacementPlan(healthy.bot), null);
});
