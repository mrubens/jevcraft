'use strict';
// Note 634: a cauldron of water puts a burning body out, in the Nether too,
// where nothing else does (a poured bucket evaporates). Measured on the
// arena server (2026-09-28): a cauldron put down on netherrack and filled
// from a water bucket, level 3 in half a second, the bucket left empty; the
// fire out a tenth of a second after the feet went under the water, the
// cauldron one level lower; four of four entries by a hop onto the rim and
// steps along it. These pin the ways offered to Jev and what they say.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const vitals = require('../src/vitals');
const body = require('../src/body');
const cauldron = require('../src/cauldron');
const registry = require('minecraft-data')('26.1');

// A flat netherrack floor at y 99 with air over it, blocks overridden by
// 'x,y,z' keys: { name, boundingBox }.
function world(overrides = {}) {
  return p => {
    const q = p.floored(), key = `${q.x},${q.y},${q.z}`;
    if (overrides[key]) { const o = overrides[key]; return { position: q, boundingBox: 'empty', getProperties: () => ({}), ...o }; }
    const solid = q.y <= 99;
    return { position: q, name: solid ? 'netherrack' : 'air', boundingBox: solid ? 'block' : 'empty', getProperties: () => ({}) };
  };
}
function waterCauldron(level = 3) { return { name: 'water_cauldron', boundingBox: 'block', getProperties: () => ({ level: String(level) }) }; }
function bot({ items = [], overrides = {}, health = 12, fireLeft = 4, dimension = 'the_nether', at = new Vec3(0.5, 100, 0.5) } = {}) {
  const blockAt = world(overrides);
  const b = {
    registry, health, food: 20, oxygenLevel: 20, entities: {}, game: { dimension, gameMode: 'survival' }, _alightUntil: Date.now() + fireLeft * 1000,
    entity: { position: at, width: 0.6, height: 1.8, metadata: [1], onGround: true, yaw: 0 },
    inventory: { items: () => items.map(([name, count = 1]) => ({ name, count })), slots: {} },
    blockAt,
    findBlocks: ({ matching, maxDistance, count }) => {
      const out = [];
      for (let x = -maxDistance; x <= maxDistance; x++) for (let y = -3; y <= 3; y++) for (let z = -maxDistance; z <= maxDistance; z++) {
        const p = at.floored().offset(x, y, z);
        if (matching(blockAt(p))) out.push(p);
      }
      return out.slice(0, count);
    },
  };
  return b;
}

test('a water cauldron three blocks off is a way in the Nether: the hop, the seconds, the fire and health it saves, the level it costs', () => {
  const b = bot({ overrides: { '3,100,0': waterCauldron(3) } });
  const ways = vitals.fireWays(b, new Task('t'));
  assert.ok(ways.extinguish_in_cauldron, `offered: ${Object.keys(ways)}`);
  const d = ways.extinguish_in_cauldron.description;
  assert.match(d, /Step into the cauldron of water 3 blocks off at \(3, 100, 0\) \(3 of 3 levels of water\)/);
  assert.match(d, /a hop onto its rim/);
  assert.match(d, /the fire is out the moment the feet are under the water/);
  assert.match(d, /about \d\.\d seconds from now, burning meanwhile; it saves the 4 seconds of fire left, about (?:3\.[5-9]|4) of the 12 health/);
  assert.match(d, /costs the cauldron one level of its 3/);
  assert.ok(!ways.set_down_cauldron, 'nothing carried to put down');
  assert.match(ways.burn_out.description, /in the Nether only a cauldron's water puts it out/);
  assert.ok(vitals.fireToAnswer(b), 'the reflex has something to offer in the Nether');
});

test('an empty cauldron, or one out of reach or with no room to go in from, is not offered', () => {
  const empty = bot({ overrides: { '3,100,0': { name: 'cauldron', boundingBox: 'block', getProperties: () => ({}) } } });
  assert.ok(!vitals.fireWays(empty, new Task('t')).extinguish_in_cauldron);
  assert.ok(!vitals.fireToAnswer(empty), 'in the Nether with no water to be had, nothing to answer');
  const far = bot({ overrides: { '9,100,0': waterCauldron(3) } });
  assert.ok(!vitals.fireWays(far, new Task('t')).extinguish_in_cauldron, 'nine blocks off');
  // A ceiling two blocks over the rim leaves no room for the hop.
  const low = bot({ overrides: { '3,102,0': { name: 'netherrack', boundingBox: 'block' } } });
  low.blockAt = ((was) => p => { const q = p.floored(); return q.x === 3 && q.y === 100 && q.z === 0 ? waterCauldron(3).name && { position: q, ...waterCauldron(3) } : was(p); })(low.blockAt);
  assert.ok(!vitals.fireWays(low, new Task('t')).extinguish_in_cauldron, 'a ceiling over the cauldron');
});

test('a carried cauldron and water bucket are a way to put it down beside the bot, fill it and step in, with what it leaves', () => {
  const b = bot({ items: [['cauldron'], ['water_bucket'], ['iron_sword']] });
  const ways = vitals.fireWays(b, new Task('t'));
  assert.ok(ways.set_down_cauldron, `offered: ${Object.keys(ways)}`);
  const d = ways.set_down_cauldron.description;
  assert.match(d, /Put the cauldron carried down beside the bot at \(-?\d, 100, -?\d\)/);
  assert.match(d, /the bucket is left empty, and no water bucket is left for a fall or the portal cast/);
  assert.match(d, /the fire out 0\.8 to 1 second after the first step/);
  assert.match(d, /it saves the 4 seconds of fire left/);
  assert.match(d, /What it spends: the water bucket's water \(the Nether has none to refill it from\).*the cauldron staying where it is put \(two levels of water left in it/);
  assert.ok(vitals.fireToAnswer(b));
  assert.ok(!vitals.fireWays(bot({ items: [['cauldron'], ['bucket']] }), new Task('t')).set_down_cauldron, 'an empty bucket fills nothing');
  assert.ok(!vitals.fireWays(bot({ items: [['water_bucket']] }), new Task('t')).set_down_cauldron, 'no cauldron carried');
  assert.ok(!vitals.fireToAnswer(bot({ items: [['water_bucket']] })), 'the bucket alone does nothing in the Nether');
});

test('a fall or lava beside the cell it goes in from is said', () => {
  const overrides = { '3,100,0': waterCauldron(3) };
  // The cell it goes in from is (2, 100, 0); a hole into lava at x 1 beside it.
  overrides['1,99,0'] = { name: 'lava', boundingBox: 'empty' };
  overrides['1,98,0'] = { name: 'lava', boundingBox: 'empty' };
  const b = bot({ overrides, at: new Vec3(2.5, 100, 0.5) });
  const d = vitals.fireWays(b, new Task('t')).extinguish_in_cauldron?.description || '';
  assert.match(d, /Beside the cell it goes in from there is a drop into lava/);
});

test('the burning said in every question names the cauldron, near or carried, and only then', () => {
  const near = bot({ overrides: { '3,100,0': waterCauldron(2) } });
  assert.match(body.burningSays(near), /A cauldron of water puts it out at once too, in the Nether as anywhere, by stepping into it: one with water \(2 of 3 levels\) stands 3 blocks off at \(3, 100, 0\)/);
  assert.match(body.conditionSays(near, 'fire', { inFire: false }), /one with water \(2 of 3 levels\) stands/);
  const carried = bot({ items: [['cauldron'], ['water_bucket']] });
  assert.match(body.burningSays(carried), /a cauldron and a water bucket are carried, and there is room to put the cauldron down and fill it/);
  assert.doesNotMatch(body.burningSays(bot()), /cauldron/);
});

test('the way in is along the side it enters by: the aim, and the offsets across and along', () => {
  const east = cauldron.frame([1, 0]);
  assert.ok(Math.abs(east.fwd[0] - 1) < 1e-9 && Math.abs(east.fwd[1]) < 1e-9, 'east is forward');
  assert.ok(Math.abs(east.right[1] - 1) < 1e-9 && Math.abs(east.right[0]) < 1e-9, 'facing east, right is south (+z)');
  const b = bot({ at: new Vec3(3.2, 100, 0.4) });
  const spot = cauldron.placeSpot(b);
  assert.ok(spot && spot.cell.y === 100 && spot.from.equals(new Vec3(3, 100, 0)), 'put down beside the bot\'s own cell');
});

test('the crossing kit says the set when it is carried or could be made, and never counts it short', () => {
  const { kitItems, kitSummary, cauldronSet } = require('../src/crossing-kit');
  const kit = items => Object.assign(bot({ items, dimension: 'overworld' }), { game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' } });
  assert.equal(cauldronSet(kit([['iron_ingot', 6], ['bucket']])), null, 'six iron is not a cauldron');
  assert.equal(cauldronSet(kit([['iron_ingot', 9]])), null, 'no bucket, no water to carry');
  const offer = cauldronSet(kit([['iron_ingot', 9], ['bucket']]));
  assert.equal(offer.offer, true);
  assert.match(offer.says, /a cauldron \(7 iron ingots in a U at a crafting table, 9 carried, one slot\) and a bucket of water \(1 empty bucket carried/);
  assert.match(offer.says, /the fire out a tenth of a second after the feet are under the water/);
  assert.match(offer.says, /Its cost is 7 iron ingots \(the bot carries 9; an iron pickaxe is three\) and a slot or two/);
  assert.match(offer.says, /The bucket is emptied into it, so it is no longer a water bucket for a fall or a portal cast/);
  const items = kitItems(kit([['iron_ingot', 9], ['water_bucket']]));
  const item = items.find(i => i.key === 'cauldron');
  assert.ok(item && item.short === false && item.offer === true, 'said, offered, never short');
  const done = cauldronSet(kit([['cauldron'], ['water_bucket']]));
  assert.equal(done.offer, false);
  assert.match(done.says, /1 cauldron and 1 water bucket carried, one slot each/);
  assert.match(kitSummary(kit([['iron_ingot', 9], ['bucket'], ['cobblestone', 128], ['stone_pickaxe'], ['golden_boots'], ['oak_log', 8], ['crafting_table']]), {}), /a cauldron and a water bucket to put a fire out in the Nether, which the bot could make now \(an option, not a gap\)/);
});

test('crossing_kit offers top_up_cauldron with nothing short, and never as the fallback', async () => {
  const { crossingKitReady } = require('../src/work');
  const b = bot({ items: [['iron_ingot', 9], ['bucket'], ['cobblestone', 128], ['stone_pickaxe'], ['golden_boots'], ['oak_log', 8], ['crafting_table'], ['cooked_beef', 12]], dimension: 'overworld' });
  b.game.difficulty = 'peaceful';
  b.game.gameMode = 'survival';
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.7 } } }; } };
  const goal = { kind: 'win' };
  const ready = await crossingKitReady(b, { check() {}, opportunityClient: client }, goal, () => {}, client);
  assert.equal(ready, true);
  assert.ok(asked, 'asked, though nothing is short');
  assert.ok(asked.cross_now && asked.top_up_cauldron, Object.keys(asked).join(','));
  assert.match(asked.top_up_cauldron, /Make the cauldron set for the Nether's fire first: craft a cauldron \(7 of the 9 iron ingots carried, at a crafting table carried\)/);
  assert.equal(goal.crossingKit.choice.pick, 'cross_now');
  // Nothing on offer and nothing short: not asked.
  asked = null;
  // Two pickaxes, so no spare is on offer either (note 943).
  const plain = bot({ items: [['cobblestone', 128], ['stone_pickaxe'], ['stone_pickaxe'], ['golden_boots'], ['oak_log', 8], ['crafting_table'], ['chest']], dimension: 'overworld' });
  plain.game.difficulty = 'peaceful';
  assert.equal(await crossingKitReady(plain, { check() {}, opportunityClient: client }, { kind: 'win' }, () => {}, client), true);
  assert.equal(asked, null);
});

test('the inventory-room question says what the cauldron and the water bucket are for', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const items = [{ name: 'cauldron', count: 1, type: 1 }, { name: 'water_bucket', count: 1, type: 2 }, { name: 'dirt', count: 20, type: 3 }];
  const b = { registry, inventory: { items: () => items, emptySlotCount: () => 0 }, entity: { position: { x: 0, y: 64, z: 0 } }, tossStack: async () => {} };
  let offered;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { offered = { ...questions.branch_0.criteria, ...(questions.branch_1?.criteria || {}) }; return { answers: { branch_0: { choice: 'none', confidence: 0.6 }, branch_1: { choice: 'drop_dirt', confidence: 0.6 } } }; } } };
  await makeRoom(b, task, 'oak_planks', {}).catch(() => {});
  assert.match(offered.drop_cauldron || '', /for a fire on the body in the Nether: put down and filled from a water bucket \(1 carried\), a body that steps into it is put out at once/);
  assert.match(offered.drop_water_bucket || '', /and the water for the cauldron carried: emptied into it, it fills it, in the Nether as anywhere \(a poured bucket evaporates there\)/);
});
