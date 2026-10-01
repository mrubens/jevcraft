'use strict';
// Note 722: a stand taken as the least bad still holds.
//
// (1) 25590 chose cast_at_lava as portal_method's least bad (none_good on
// top at 0.48, cast_at_lava 0.22): "the least bad is not Jev's choice, it
// begins no intention" (note 693) meant the stand at the lava was never
// held, so nine seconds later surface_trip's climb (never withheld, since
// there was no intention for it to be a way of) undid it, and the frame
// left 6 of ten standing became a new one, 0 of ten, thirty blocks from the
// lava. Fixed: a none-good fallback still holds when the answer taken is a
// stand (portal_method's cast_at_lava, not a walk); a walk taken as the
// least bad (nether_gather's leg_east, note 693's own case) still begins no
// intention, since a walk's own yield measure already ends it and it costs
// nothing to abandon.
// (2) A frame already begun is progress by the rung's measure (its
// obsidian standing): surface_trip's climb and mine_first now say what
// leaving it costs, whether or not the intention holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { decide } = require('../src/decisions');

// npm test runs with JEV_NONE_GOOD=0 (the test runner's own env, so other
// tests can name every option a question offers without none_good among
// them); these tests are about none_good itself, so it is turned back on
// for them, as test/none-good-693.test.js's withNoneGood does.
function withNoneGood(t) {
  const prior = process.env.JEV_NONE_GOOD;
  process.env.JEV_NONE_GOOD = '1';
  t.after(() => { if (prior === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = prior; });
}

function overworldBot({ at = new Vec3(16, 68, 60), health = 20, food = 20, items = [] } = {}) {
  const inv = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, said: [],
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] }, chat(m) { this.said.push(m); }, blockAt: () => null,
  });
}
const opt = d => ({ description: d });

test('a stand taken as the least bad still holds: surface_trip is asked without the climb that would undo it (25590, note 722)', async t => {
  withNoneGood(t);
  const bot = overworldBot(), goal = { kind: 'win' };
  // None good on top (0.48), beside_pool_1 the highest of the real options
  // (0.22): exactly 25590's judgment at 04:34:57.
  const client = { systemOne: async ({ questions }) => {
    const keys = Object.keys(questions.branch_0.criteria);
    if (keys.includes('beside_pool_1')) return { answers: { branch_0: { choice: 'none_good', confidence: 0.48,
      probabilities: { new_site_pool_1: 0.16, build_new: 0.14, beside_pool_1: 0.22, none_good: 0.48 } } } };
    return { answers: { branch_0: { choice: 'dig_site', confidence: 0.75, probabilities: { climb: 0.1, dig_site: 0.75 } } } };
  } };
  const d1 = await decide('portal_plan', { client, bot, goal, tree: {
    build_new: opt('Build from obsidian.'), beside_pool_1: opt('Cast beside the known lava.'), new_site_pool_1: opt('Leave the frame and start again.'),
  }, state: {} });
  assert.equal(d1.noneGood, true, 'recorded as the least bad, not a confident pick');
  assert.deepEqual(d1.path, ['beside_pool_1']);
  // Even though it was none good, a stand still holds: it is not a walk,
  // and abandoning it loses real, already-placed progress.
  assert.equal(goal.intention?.q, 'portal_plan');
  assert.equal(goal.intention?.choice, 'beside_pool_1');
  const s = await decide('surface_trip', { client, bot, goal, tree: {
    climb: opt('Climb to open sky.'), mine_first: opt('Mine ore first, then climb.'), dig_site: opt('Dig a site for the frame here.'),
  }, state: {} });
  assert.deepEqual(s.path, ['dig_site'], 'climb and mine_first were withheld: dig_site was the only way left');
  assert.equal(goal.intention.choice, 'beside_pool_1', 'the stand still holds');
});

test('a walk taken as the least bad still begins no intention (note 693 unchanged)', async t => {
  withNoneGood(t);
  const bot = overworldBot(); bot.game.dimension = 'the_nether';
  const goal = { kind: 'win' };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.47,
    probabilities: { leg_east: 0.3, without: 0.23, none_good: 0.47 } } } }) };
  const d = await decide('nether_gather', { client, bot, goal, tree: { leg_east: opt('A leg east.'), without: opt('Go on without.') }, state: {} });
  assert.equal(d.noneGood, true);
  assert.deepEqual(d.path, ['leg_east']);
  assert.equal(goal.intention, undefined, 'a leg taken as the least bad is still not the bot\'s intention');
});

test('a portal frame already begun says what leaving it costs, in the climb and mine_first options', async () => {
  const { pos } = (() => ({ pos: p => new Vec3(p.x, p.y, p.z) }))();
  const bot = overworldBot({ at: new Vec3(107, 52, 155), items: [['iron_pickaxe', 1]] });
  const origin = { x: 110, y: 67, z: 155 };
  // Six of ten obsidian standing at the frame begun; the rest air; open sky
  // above y 67 so tripCost (surface.js) can price the climb.
  const blocks = Array.from({ length: 10 }, (_, i) => ({ x: origin.x, y: origin.y + i, z: origin.z }));
  bot.blockAt = p => {
    if (blocks.slice(0, 6).some(b => b.x === p.x && b.y === p.y && b.z === p.z)) return { position: p, name: 'obsidian', boundingBox: 'block' };
    const open = p.y > 67;
    return { position: p, name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block' };
  };
  const goal = { kind: 'win', portalFrame: { origin, blocks, cast: true }, gameProgress: { phase: 'reach_nether' } };
  const { surfaceTrip } = require('../src/work');
  let tree;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { tree = questions; return { answers: { branch_0: { choice: 'dig_site', confidence: 0.6 } } }; } } };
  await surfaceTrip(bot, task, goal, () => {}, 'a portal site (none level and dry down here)', {
    siteDig: { origin: pos(bot.entity.position), cells: [] }, lava: { x: 90, y: 48, z: 155 },
  }).catch(() => {});
  const climbSays = tree.branch_0.criteria.climb;
  assert.match(climbSays, /frame already begun at \(110, 67, 155\), 6 of ten standing/);
  assert.match(climbSays, /is left as it stands if a new site is picked up top/);
});

test('a climb for water with water in view: digging to it is offered beside the climb, priced (25588 mid-220-ak 14:46:32Z, note 816)', async () => {
  const bot = overworldBot({ at: new Vec3(107, 52, 155), items: [['iron_pickaxe', 1]] });
  bot.blockAt = p => { const open = p.y > 67; return { position: p, name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block' }; };
  bot.registry = require('minecraft-data')('26.1');
  bot.findBlocks = ({ matching }) => matching === bot.registry.blocksByName.water.id ? [new Vec3(125, 50, 160)] : [];
  const goal = { kind: 'win', gameProgress: { phase: 'reach_nether' } };
  const { surfaceTrip } = require('../src/work');
  let tree;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { tree = questions; return { answers: { branch_0: { choice: 'climb', confidence: 0.6 } } }; } } };
  await surfaceTrip(bot, task, goal, () => {}, 'water').catch(() => {});
  assert(tree, 'asked');
  const c = tree.branch_0.criteria;
  assert.match(c.dig_to_water, /^Dig a way through the rock to the water in view at \(125, 50, 160\), \d+ blocks off \(\d+ across, 2 down\), a step at a time with rock round the bot, about \d+ (seconds|minutes) and about \d+ blocks dug, and fill the bucket there; no climb\./);
});
