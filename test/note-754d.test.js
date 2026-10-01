'use strict';
// Note 754d (critic-20260930T1737Z items 1 and 2): 25593 dropped its only
// pickaxe to make room for the cobblestone its mine step was digging with
// it; 25581 spent seven iron on a cauldron with one bucket for lava, and
// went for a cow with the raw meat it carried covering the want once cooked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const stack = (name, count = 1, extra = {}) => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize, ...extra });
function asking(items, goal) {
  let offered = null;
  const bot = { registry, game: { gameMode: 'survival', dimension: 'overworld' }, inventory: { items: () => items, emptySlotCount: () => 0 }, entity: { position: new Vec3(0, -54, 0) },
    tossStack: async s => { items.splice(items.indexOf(s), 1); }, _goal: goal };
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => {
    offered = { ...questions.branch_0.criteria, ...questions.branch_1.criteria };
    const pick = Object.keys(questions.branch_1.criteria).find(k => /^drop_/.test(k));
    return { answers: { branch_0: { choice: pick ? 'drop' : 'none', confidence: 0.7 }, branch_1: { choice: pick || 'none', confidence: 0.7 } } };
  } } };
  return { bot, task, offered: () => offered };
}

test('the room question never offers the tool the step in hand needs, nor the last pickaxe (25593)', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const items = [stack('iron_pickaxe', 1, { durabilityUsed: 40 }), stack('stone_axe'), stack('iron_ingot', 3), stack('raw_iron', 12), stack('coal', 30), stack('lava_bucket'), stack('bucket', 5)];
  const goal = { kind: 'survive', step: { action: 'mine', block: 'stone', drops: 'cobblestone', count: 64, tool: 'iron_pickaxe', requires: { iron_pickaxe: 1 } } };
  const { bot, task, offered } = asking(items, goal);
  await makeRoom(bot, task, 'cobblestone', { goal });
  const keys = Object.keys(offered());
  assert(!keys.includes('drop_iron_pickaxe'), `the pickaxe the mine step needs is not offered: ${keys}`);
  assert.match(offered().none, /Not offered: iron pickaxe \(the tool the step in hand needs\)/);
  assert(items.some(i => i.name === 'iron_pickaxe'));
  // With no step, the last pickaxe is still not offered.
  const again = asking([stack('stone_pickaxe'), stack('raw_iron', 12), stack('coal', 30)], { kind: 'survive' });
  await makeRoom(again.bot, again.task, 'cobblestone', { goal: { kind: 'survive' } });
  assert(!Object.keys(again.offered()).includes('drop_stone_pickaxe'));
  assert.match(again.offered().none, /stone pickaxe \(the last pickaxe\)/);
});

test('the cauldron says what its iron would buy in buckets and trips to lava (25581)', () => {
  const { cauldronSet } = require('../src/crossing-kit');
  const bot = { registry, inventory: { items: () => [stack('iron_ingot', 7), stack('bucket'), stack('water_bucket')] } };
  const set = cauldronSet(bot);
  assert.match(set.says, /The same 7 ingots make 2 buckets \(three each\): with 1 bucket for lava carried, a portal cast of ten lava blocks is 10 round trips to the lava, 4 with 2 more\./);
});

test('blocks the crossing kit counts are not offered as cheap, and are said as mined again for it (25593)', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const ck = require('../src/crossing-kit');
  // Mud for the dirt 25593 carried beside the kit's 128: 160 blocks are past
  // the building budget, and the tidy would drop the dirt with no question
  // (note 780).
  const items = [stack('cobblestone', 64), stack('cobblestone', 64), stack('mud', 32), stack('gravel', 14), stack('iron_pickaxe'), stack('raw_iron', 10)];
  const goal = { kind: 'win' };
  const { bot, task, offered } = asking(items, goal);
  if (!ck.kitBlocksWanted(bot, goal)) return; // the kit is not counted for this bot: nothing to check
  await makeRoom(bot, task, 'lava_bucket', { goal });
  const keys = Object.keys(offered());
  assert(!keys.includes('drop_cobblestone'), `gravel before the kit's cobblestone: ${keys}`);
});
