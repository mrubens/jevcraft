'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

// mid-242-jb (25591), 21:50:55 to 21:56:27Z on 2026-09-29 (note 694): the
// bot stood in its own tunnel at (148-155, 45, 296-304), in the basalt
// between two of its fortress's corridors, 231 blocks carried and no
// pickaxe; the approach's brick (144, 60, 318) 15 up and 18 across. The
// stall's question was asked five times with none good on top, its options a
// level crossing, a walk off and working free.
const GROUND = require('./fixtures/fortress-overhead-25591.json');
const BRICK = { x: 144, y: 60, z: 318 };
const ITEMS = [['cobblestone', 64], ['dirt', 10], ['netherrack', 157], ['mutton', 9], ['beef', 11]];

function tunnelBot({ at = new Vec3(150.5, 45, 300.5), items = ITEMS } = {}) {
  const bot = groundBot(GROUND, { at, items: items.map(i => [...i]), dimension: 'the_nether', indexed: true });
  bot.entities = {}; bot.players = {};
  return bot;
}
const searchGoal = () => ({ kind: 'win', step: { action: 'find_fortress', target: { ...BRICK } },
  fortressSearch: { approach: { found: { ...BRICK }, failed: [] }, found: { x: 143, y: 56, z: 317 }, legs: 12, since: Date.now() - 60 * 60000 } });
const stallActions = extra => ({ navigate: async () => {}, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false, ...extra });

test('the fortress floor overhead is the approach\'s, not the first brick the search saw (25591, note 694)', () => {
  const { fortressOverhead } = require('../src/mob-hunt');
  const bot = tunnelBot();
  assert.deepEqual({ ...fortressOverhead(bot, searchGoal()) }, BRICK);
  // A floor on the map comes first; none above within reach is none.
  const goal = searchGoal(); goal.fortressSearch.map = { cells: { '146,60,300': [0, 15, 0] } };
  assert.deepEqual({ ...fortressOverhead(bot, goal) }, { x: 146, y: 60, z: 300 });
  assert.equal(fortressOverhead(tunnelBot({ at: new Vec3(150.5, 61, 300.5) }), searchGoal()), null, 'level with it: no climb');
});

test('the stall\'s question under a fortress floor offers the climb with what is carried: up through the rock, across, the wall dug, priced (25591, note 694)', () => {
  const { netherAnswers } = require('../src/nether-travel');
  const bot = tunnelBot();
  const goal = searchGoal();
  const answers = netherAnswers(bot, new Task('work'), goal, () => {}, { actions: stallActions() });
  assert(answers.cross_toward, 'the level crossing is still there');
  const climb = answers.pillar_up;
  assert(climb, Object.keys(answers).join(', '));
  assert.deepEqual(climb.target, { x: 144, y: 61, z: 318 });
  assert.match(climb.description, /^Pillar straight up 16 blocks from a column 1 block from here, then span \d+ cells across at that height to the fortress floor at \(144, 61, 318\): 16 blocks laid of 231 carried, about \d+ seconds\./);
  assert.match(climb.description, /It digs 16 blocks of [a-z ]+ over the head on the way up, about \d+ seconds by hand, none of which drops anything\./);
  assert.match(climb.description, /Across, it digs \d+ blocks, 2 of them the fortress's wall \(nether bricks\), about \d+ seconds\./);
  assert.match(climb.description, /The column is walled by rock on every side above y 47; below that a push is a fall of up to 1 block, no harm\./);
  // The stall's catalogue has it, and taken it is an intention of its own.
  const definition = id => require('../src/decisions').question(id);
  const keys = (definition('stillness_detour').options || []).map(o => o.key);
  assert(keys.includes('pillar_up') && keys.includes('blocks_then_pillar'));
  assert(require('../src/intention').TIMED.stillness_detour.test('pillar_up'));
  assert(require('../src/intention').TIMED.rung_progress.test('blocks_then_pillar'));
});

test('short of blocks and with nothing to dig for them, no climb is offered and why is said on the level crossing (note 694)', () => {
  const { netherAnswers } = require('../src/nether-travel');
  const bot = tunnelBot({ items: [['netherrack', 5], ['mutton', 9]] });
  const answers = netherAnswers(bot, new Task('work'), searchGoal(), () => {}, { actions: stallActions() });
  assert.equal(answers.pillar_up, undefined);
  assert.equal(answers.blocks_then_pillar, undefined, 'no pickaxe, and a hand digs nothing that drops here');
  assert.match(answers.cross_toward.description, /Up to the fortress floor: the climb to the floor is not offered: 16 blocks wanted \(16 up, 0 across\), 5 carried and none to be had here\.$/);
});

test('chosen, the climb takes the fortress off the set-aside list, and one that stops short fails with why (note 694)', async t => {
  const pr = require('../src/pillar-recovery');
  const real = pr.pillarUp;
  t.after(() => { pr.pillarUp = real; });
  pr.pillarUp = async () => 0;
  const { netherAnswers } = require('../src/nether-travel');
  const bot = tunnelBot();
  const goal = searchGoal();
  const navigate = async (b, task, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  const answers = netherAnswers(bot, new Task('work'), goal, () => {}, { actions: stallActions({ navigate }) });
  goal.fortressSearch.shunned = [{ x: 143, z: 317, until: Date.now() + 600000 }, { x: 500, z: 500, until: Date.now() + 600000 }];
  await assert.rejects(answers.pillar_up.run(), /The climb to the fortress floor at \(144, 61, 318\) ended: the pillar stopped 16 short of the floor's height/);
  assert.deepEqual(goal.fortressSearch.shunned.map(s => s.x), [500], 'this fortress is no longer set aside; another is');
});

test('the approach offers the climb across where the floor is more than twelve across (25591, note 694)', async t => {
  process.env.JEV_INTENTION = '0'; t.after(() => { delete process.env.JEV_INTENTION; });
  const { approachFortress } = require('../src/mob-hunt');
  const bot = tunnelBot();
  const goal = searchGoal();
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'keep_searching', confidence: 0.9 } } }; } };
  await approachFortress(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => {}, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false },
    goal.fortressSearch, new Vec3(BRICK.x, BRICK.y, BRICK.z), []);
  const options = asked.find(o => o.keep_searching);
  assert(options, 'the way in was asked');
  assert.match(options.pillar_up, /^Pillar straight up 16 blocks from a column 1 block from here, then span/);
  assert.match(options.cross_level, /ends 15 blocks under the nearest brick/);
});

test('the leg\'s question offers the climb to a fortress known overhead (note 694)', () => {
  const definition = id => require('../src/decisions').question(id);
  const keys = (definition('fortress_leg').options || []).map(o => o.key);
  assert(keys.includes('pillar_up') && keys.includes('blocks_then_pillar'));
  assert(require('../src/intention').TIMED.fortress_leg.test('pillar_up'));
});

// 25593 (mid-242-ig) set the reach nether aside at the rung's question at
// 21:50:13Z; win_strategy took it straight back 65 seconds later and twice
// more, the option saying only the kit.
function overworld() {
  const items = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 });
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival' },
    health: 20, food: 20, isAlive: true, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items } });
  return bot;
}
function asideGoal(ago = 65000) {
  const { setAside } = require('../src/progress');
  const goal = { version: 1, kind: 'win', request: 'beat the game' };
  const realNow = Date.now;
  Date.now = () => realNow() - ago;
  try { setAside(goal, 'rung', 'reach_nether', 'Jev set it aside at the rung\'s question, worked on 11 minutes', 30 * 60000); }
  finally { Date.now = realNow; }
  goal.rungAside = { phase: 'reach_nether', at: Date.now() - ago, why: 'the lava bucket: No route from here to the lava pool (noPath)' };
  return goal;
}

test('a rung set aside is said on the option that takes it back, with why and until when, even alone (25593, note 694)', () => {
  const { strategyOptions } = require('../src/strategy');
  const stage = { phase: 'reach_nether', action: 'enter_nether' };
  const options = strategyOptions(overworld(), asideGoal(), stage);
  assert(options, 'asked even with the stage alone');
  const o = options.stage_reach_nether;
  assert.equal(o.takeBack, 'reach_nether');
  assert.match(o.description, /^Take the reach nether back up now after all\./);
  assert.match(o.description, /The reach nether was set aside 65 seconds ago \(Jev set it aside at the rung's question, worked on 11 minutes\)\. Stuck on, as it stood when set aside: the lava bucket: No route from here to the lava pool \(noPath\)\. It comes back on its own in 29 minutes \(\d\d:\d\dZ\); taken now, that rest is cut short and what it was stuck on is before it again\./);
  // Not set aside: as before, and not asked alone.
  assert.equal(strategyOptions(overworld(), { version: 1, kind: 'win' }, stage), null);
});

test('taken back, the rest is cut short and said in chat (note 694)', async () => {
  const { strategyStep } = require('../src/strategy');
  const { isSetAside } = require('../src/progress');
  const bot = overworld(); const said = []; bot.chat = l => said.push(l);
  const goal = asideGoal();
  const asked = [];
  const decide = async (id, args) => { asked.push(args.tree); return { path: ['stage_reach_nether'] }; };
  const out = await strategyStep(bot, new Task('win'), goal, () => {}, { phase: 'reach_nether', action: 'enter_nether' }, { decide });
  assert.equal(out, null);
  assert.equal(asked.length, 1);
  assert.equal(isSetAside(goal, 'rung', 'reach_nether'), false);
  assert.equal(goal.rungAside, undefined);
  assert.match(said.join('\n'), /^Back to the way to the Nether after all: I set it aside 65 seconds ago\.$/m);
});
