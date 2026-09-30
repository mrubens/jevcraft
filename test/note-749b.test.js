'use strict';
// Note 749b: 25591's night mine on note 749's code (its record began
// 13:17:32Z, after the deploy): night_mine_target asked 25 times in 70 s from
// 13:20:13Z, coal after coal at 135 to 148 carried, each under a new number
// (the detour's scratch goal made afresh, so the ids began again at 0), and
// the spell never went up: each coal read as something gained, and 90 s
// never passed. The pickaxe wore out and it dug by hand from y 22 to 53.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const K = require('../src/decisions/keys');
const loops = require('../src/decisions/loops');
const decisions = require('../src/decisions');
const fixture = require('./fixtures/night-mine-25591.json');

test('ids are kept with the world\'s survival state: a detour\'s scratch goal made afresh does not number its ores from 0 again', () => {
  const survival = {};
  const scratch = () => ({ kind: 'survive', request: 'Something useful meanwhile', survival });
  assert.deepEqual(K.ids(scratch(), 'ore', [{ x: 1, y: 2, z: 3 }, { x: 5, y: 2, z: 3 }], { near: 0.5 }), [0, 1]);
  assert.deepEqual(K.ids(scratch(), 'ore', [{ x: 5, y: 2, z: 3 }, { x: 9, y: 2, z: 3 }], { near: 0.5 }), [1, 2]);
  assert.ok(survival.keyIds.ore);
});

test('25591\'s night mine replayed: more coal past the 128 worth keeping is not a gain, and twelve askings going nowhere send it up, 36 s in, not 25 in 70', () => {
  const asks = fixture.asks.map(a => ({ t: Date.parse(a.at), id: 'night_mine_target', choice: a.choice, pos: a.position, dimension: 'overworld', inventory: a.inventory, noneGood: a.top === 'none_good' }));
  assert.equal(asks.length, 23);
  assert.equal(fixture.asks[0].inventory.coal, 135);
  assert.equal(fixture.asks.at(-1).inventory.coal, 148);
  const r = loops.replay(asks);
  assert.ok(r.ups.length >= 1);
  const up = r.ups[0];
  assert.equal(up.n, 12);
  assert.ok(up.t - asks[0].t <= 40000, `${up.t - asks[0].t} ms in`);
  assert.match(up.why, /^12 askings over 36 seconds have gone nowhere: \d+ blocks from where they began with nothing new carried$/);
  assert.match(up.says, /more coal \(144 carried, past the 128 worth keeping\)/);
  assert.doesNotMatch(up.says, /cobblestone/, 'the tunnel\'s own rock is not said');
});

test('a coal option past the worth keeping says so, and every ore says what its dig costs in pickaxe wear', async () => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const registry = require('minecraft-data')('26.1');
  const ores = { '3,39,0': 'coal_ore', '6,39,0': 'iron_ore' };
  const pick = { name: 'iron_pickaxe', count: 1, durabilityUsed: registry.itemsByName.iron_pickaxe.maxDurability - 12 };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 40, 0.5) },
    inventory: { items: () => [pick, { name: 'coal', count: 137 }], emptySlotCount: () => 10, slots: [] },
    findBlocks: ({ matching }) => Object.keys(ores).filter(k => [].concat(matching).includes(registry.blocksByName[ores[k]].id)).map(k => new Vec3(...k.split(',').map(Number))),
    blockAt: p => ({ name: ores[`${p.x},${p.y},${p.z}`] || 'stone', boundingBox: 'block', position: p }) });
  const survival = new Survival(bot, {}, {});
  survival.client = { systemOne: async () => ({}) };
  let tree;
  survival.decide = async (task, goal, save, q) => { tree = q.tree; return { path: ['branch'], stale: false }; };
  await survival.nightTarget(new Task('night'), {}, () => {}, new Vec3(0, 40, 0));
  const coal = Object.values(tree).find(o => /coal ore/.test(o.description)), iron = Object.values(tree).find(o => /iron ore/.test(o.description));
  assert.match(coal.description, /\(137 coal carried; fuel for every smelt, and torches\)\. That is already past the 128 worth keeping: more is not wanted\. The dig takes about 4 blocks of pickaxe wear, of the 12 uses left on the best pickaxe carried\./);
  assert.doesNotMatch(iron.description, /past the/);
  assert.match(iron.description, /The dig takes about 7 blocks of pickaxe wear, of the 12 uses left/);
});

test('a question asked aside (the shield against a shot) keeps its spell too, said with the health lost, never sent up (25583, 13:26Z)', async () => {
  const log = console.log; console.log = () => {};
  try {
    const bot = { entity: { position: new Vec3(90.5, 22, 151.5) }, health: 20, food: 20, game: { dimension: 'overworld' }, inventory: { items: () => [{ name: 'shield', count: 1 }] } };
    const goal = { kind: 'win', request: 'beat the game' };
    const seen = [];
    const client = { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: 'shield_up', confidence: 0.8 } } }; } };
    for (const hp of [20, 18, 17, 15]) {
      bot.health = hp;
      await decisions.decide('shot_answer', { client, bot, goal, aside: true, tree: { shield_up: { description: 'Raise the shield.' }, keep_on: { description: 'Keep on.' } }, state: { shooters: [{ name: 'skeleton', distance: 4 }] } });
    }
    assert.equal(seen[1].spellSoFar, undefined);
    assert.match(seen[2].spellSoFar, /^shot answer was asked 3 times in the last \d+ seconds?, .*answered shield up 2 times.*; health 20 then, 17 now/);
    assert.match(seen[3].spellSoFar, /health 20 then, 15 now/);
  } finally { console.log = log; }
});
