'use strict';
// Gold in passing (note 653): the walk looks, mines and walks on; gold past
// four blocks, gilded blackstone and gold at low health are Jev's, priced.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('1.21.4');
const Block = require('prismarine-block')(registry);
const { Task, passingLook } = require('../src/skills');
const mining = require('../src/opportunistic-mining');

const pick = { name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 };
function netherWorld(blocks) {
  let stock = [pick];
  const world = new Map(Object.entries(blocks));
  const bot = { registry, game: { difficulty: 'normal', gameMode: 'survival', minY: 0, dimension: 'the_nether' }, health: 20, food: 20, entities: {}, oxygenLevel: 20,
    entity: { position: new Vec3(.5, 70, .5) }, inventory: { items: () => stock, emptySlotCount: () => 12 }, canSeeBlock: () => true,
    blockAt: p => { const f = p.floored(); const name = world.get(`${f}`) || (f.y < 70 ? 'netherrack' : 'air'); const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; return b; },
    findBlocks: ({ matching, maxDistance, useExtraInfo }) => [...world.entries()].map(([k, name]) => ({ p: new Vec3(...k.slice(1, -1).split(', ').map(Number)), name }))
      .filter(({ p, name }) => matching.includes(registry.blocksByName[name]?.id) && p.distanceTo(bot.entity.position) <= maxDistance && (!useExtraInfo || useExtraInfo(bot.blockAt(p)))).map(({ p }) => p),
    pathfinder: { movements: { canDig: true, scafoldingBlocks: [1], allow1by1towers: true }, getPathTo: () => ({ status: 'success', path: [{ x: 1, y: 70, z: 0 }, { x: 2, y: 70, z: 0 }] }) } };
  return { bot, world, stock: next => { stock = next; } };
}
const at = (x, y, z) => `${new Vec3(x, y, z)}`;

test('gold within four blocks is the rule; past four, gilded blackstone, and gold at low health are offered to Jev', () => {
  const { bot } = netherWorld({ [at(2, 70, 1)]: 'nether_gold_ore', [at(6, 70, 2)]: 'nether_gold_ore', [at(-2, 70, 1)]: 'gilded_blackstone' });
  const tiers = () => Object.fromEntries(mining.passingCandidates(bot, {}).map(c => [`${c.position}`, c.tier]));
  assert.deepEqual(tiers(), { [at(2, 70, 1)]: 'rule', [at(6, 70, 2)]: 'offer', [at(-2, 70, 1)]: 'offer' });
  assert.equal(mining.goldInPassing(bot, {}, 1e12), true, 'the near ore stops the walk');
  bot.health = 12;
  assert.equal(tiers()[at(2, 70, 1)], 'offer', 'under 16 health the near ore is a question, not a silent lock');
  assert.equal(mining.goldInPassing(bot, {}, 2e12), false, 'no Jev: nothing is taken below the rule\'s health');
  assert.equal(mining.goldInPassing(bot, {}, 3e12, { client: true }), true, 'with Jev: asked');
  bot.health = 20;
  bot.inventory.items = () => [pick, { name: 'ender_pearl', count: 16 }];
  assert.deepEqual(tiers(), {}, 'sixteen pearls: gold is walked past');
});

test('no gold against lava, and none the bot would stand on', () => {
  const { bot, world } = netherWorld({ [at(2, 70, 1)]: 'nether_gold_ore', [at(3, 70, 1)]: 'lava' });
  assert.equal(mining.passingCandidates(bot, {}).length, 0, 'lava against the block');
  world.delete(at(3, 70, 1));
  assert.equal(mining.passingCandidates(bot, {}).length, 1);
  assert(mining.passingCandidates(bot, {})[0].standing.every(s => !s.offset(0, -1, 0).equals(new Vec3(2, 70, 1))));
});

test('Jev is told the gold in nuggets, the share of a pearl and the seconds; continue leaves it, a pick mines it', async () => {
  const { bot } = netherWorld({ [at(6, 70, 2)]: 'nether_gold_ore' });
  const dug = [];
  let told, choice = 'continue';
  const client = { systemOne: async ({ questions, state }) => { told = { criteria: questions.passing.criteria, state }; return { answers: { passing: { choice } } }; } };
  const goal = { kind: 'win', step: { action: 'find_fortress' } };
  const actions = { navigate: async () => {}, dig: async (b, t, p) => { dug.push(`${p}`); } };
  assert.equal(await mining.mineInPassing(bot, new Task('walk'), goal, () => {}, actions, client), false);
  assert.match(told.criteria.gold_0, /2 to 6 gold nuggets, about 4, about 0\.44 of an ingot, about 1\/20 of a pearl at nine ingots a pearl/);
  assert.match(told.criteria.gold_0, /a detour of about \d+ s there and back with the dig, then the same walk goes on/);
  assert.equal(told.state.pearls, 0);
  assert.deepEqual(dug, []);
  assert(goal.opportunistic.skipped[at(6, 70, 2)], 'passed on, not asked again at once');
  assert.equal(await mining.mineInPassing(bot, new Task('walk'), goal, () => {}, actions, client), false, 'and not asked within fifteen seconds');
  goal.opportunistic.skipped = {}; bot._passingAskedAt = 0; choice = 'gold_0';
  assert.equal(await mining.mineInPassing(bot, new Task('walk'), goal, () => {}, actions, client), true);
  assert.deepEqual(dug, [at(6, 70, 2)]);
  assert.equal(goal.step.action, 'find_fortress', 'the walk\'s step is given back');
  bot.health = 10; bot._passingAskedAt = 0; goal.opportunistic.skipped = {};
  await mining.mineInPassing(bot, new Task('walk'), goal, () => {}, actions, client);
  assert.match(told.criteria.gold_0, /Health 10 of 20 and food 20 of 20: under the 16 health or 14 food/);
});

test('gilded blackstone is priced as what it is: about 0.35 nuggets a block', async () => {
  const { bot } = netherWorld({ [at(2, 70, 1)]: 'gilded_blackstone' });
  let told;
  const client = { systemOne: async ({ questions }) => { told = questions.passing.criteria; return { answers: { passing: { choice: 'continue' } } }; } };
  await mining.mineInPassing(bot, new Task('walk'), { kind: 'win' }, () => {}, { navigate: async () => {}, dig: async () => assert.fail('dug') }, client);
  assert.match(told.gold_0, /gilded blackstone: a 1 in 10 chance of 2 to 5 gold nuggets/);
  assert.match(told.gold_0, /about 1\/231 of a pearl/);
});

test('a walk stopped for gold mines it and walks on to the same goal, its time given back', async () => {
  const { bot, world } = netherWorld({ [at(2, 70, 1)]: 'nether_gold_ore' });
  const saved = [];
  bot._goal = { kind: 'win', step: { action: 'find_fortress' } }; bot._goalSave = () => saved.push(1);
  const task = new Task('walk');
  const look = passingLook(bot, task);
  const runs = [];
  // The detour's own walks are plain walks; the dig comes from work.js, so
  // it is stood in for here by breaking the block in the world.
  const work = require('../src/work'), realDig = work.dig;
  work.dig = async (b, t, p) => { world.delete(`${p}`); };
  try {
    await look.walk(30000, async timeout => { runs.push(timeout); if (look.due()) return; }, () => false);
  } finally { work.dig = realDig; }
  assert.equal(runs.length, 2, 'walked, stopped for the gold, walked again');
  assert(!world.has(at(2, 70, 1)), 'the gold was mined');
  assert.equal(bot._goal.opportunistic.history.at(-1).block, 'nether_gold_ore');
  assert.equal(bot._goal.step.action, 'find_fortress');
});
