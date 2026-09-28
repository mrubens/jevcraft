'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

// mid-242-bb (25581), 15:02 to 15:07 on 2026-09-28 (note 613): the bot at
// y 41 to 44 under a fortress whose bridge deck runs at y 73 over x -150 to
// -66, z 140 to 144, on a pier at x -72 to -70 rising from the lava. The
// ground as the region files had it when the trial was stopped: the bot's
// own nether bricks stand at (-79, 44..45, 127) (laid 14:54:22), (-74, 43,
// 139) and (-61, 42..43, 143), and a shaft it dug up the pier at 14:38
// leaves a brick at (-71, 43, 141) with seven of air over it.
const GROUND = require('./fixtures/fortress-pier-mid-242-bb.json');
// Carried at 15:07:23 (the flight's frame), what bears on the ways in.
const CARRIED = [['nether_bricks', 9], ['gravel', 16], ['stone_axe', 1], ['iron_sword', 1], ['crafting_table', 1], ['stick', 1], ['oak_planks', 1],
  ['coal', 64], ['cooked_mutton', 4], ['mutton', 8], ['beef', 14], ['water_bucket', 1], ['bucket', 1], ['flint_and_steel', 1]];
const OWN = ['-79,44,127', '-79,45,127', '-74,43,139', '-61,42,143', '-61,43,143'];
// The pier stands solid from the lava to the deck as the game builds it:
// every cell of it open in the saved ground is the bot's digging (14:38,
// the flight has it inside the pier at (-70.5, 44..49, 141.5)).
const { groundOf } = require('./fixtures/saved-ground');
const DUG = (() => {
  const blockAt = groundOf(GROUND), out = [];
  for (let x = -72; x <= -70; x++) for (let z = 140; z <= 144; z++) for (let y = 32; y <= 72; y++) if (blockAt(new Vec3(x, y, z))?.name === 'air') out.push(`${x},${y},${z}`);
  return out;
})();
const recorded = (keys, t = Date.parse('2026-09-28T14:54:22Z')) => Object.fromEntries(keys.map(k => [k, t]));

function pierBot(at = new Vec3(-84.3, 44, 124.2)) {
  const bot = groundBot(GROUND, { at, dimension: 'the_nether', items: CARRIED, indexed: true });
  bot.entities = {}; bot.players = {};
  return bot;
}
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ kind, state, questions }) => { asked.push({ kind, state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
}
test('under the bridge, the way in is asked about a floor of the fortress\'s own, not the bot\'s own bricks nor the stump of the pier it dug up (mid-242-bb, note 613)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const bot = pierBot();
  assert(DUG.includes('-71,44,141') && DUG.includes('-72,45,140'), 'the shaft read from the ground');
  const goal = { fortressSearch: { axis: 1, legs: 81, own: recorded(OWN), dug: recorded(DUG) } };
  const client = jevStub(['keep_searching']);
  const walked = [];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async (b, task, g) => { walked.push(g); throw new Error('No path to the goal!'); }, tunnel: async () => {}, dig: async () => {} });
  assert.equal(client.asked.length, 1);
  assert.equal(client.asked[0].kind, 'fortress');
  const { options, state } = client.asked[0];
  const found = goal.fortressSearch.approach.found;
  assert(found.y >= 65, `a floor of the fortress's own, twenty and more up, not ${JSON.stringify(found)}`);
  assert(!(found.x === -79 && found.z === 127), 'not the bricks it stacked');
  assert(!(found.x === -71 && found.z === 141 && found.y === 43), 'not the pier\'s stump at the foot of its own shaft');
  assert(state.fortress.height >= 20, `twenty and more up (${state.fortress.height})`);
  assert.doesNotMatch(options.walk_route || '', /7 blocks off and 2 blocks up/);
  if (options.pillar_up) assert.match(options.pillar_up, /they run out 25 up/, 'the pillar says its blocks run out');
});

test('a floor is a brick with a floor beside it: a lone brick top is none (note 613)', () => {
  const mh = require('../src/mob-hunt');
  const bot = pierBot();
  const bricks = [[-79, 45, 127], [-71, 43, 141], [-100, 73, 142], [-101, 73, 142], [-60, 73, 142]].map(p => new Vec3(...p));
  const floors = mh.fortressFloors(bot, bricks).map(b => `${b.x},${b.y},${b.z}`);
  assert.deepEqual(floors.sort(), ['-100,73,142', '-101,73,142'], 'the deck\'s pair only: the stack, the stump and a deck brick with its neighbours not listed are not floors');
});

test('bricks the bot lays are noted as they appear beside it, kept with the search and forgotten when dug (note 613)', () => {
  const own = require('../src/own-blocks');
  const { EventEmitter } = require('node:events');
  const registry = require('minecraft-data')('26.1');
  const Block = require('prismarine-block')(registry);
  const block = (name, p) => { const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = p; return b; };
  const world = new Map();
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt: p => world.get(`${p}`) || block('air', p) });
  own.ownBlocksPlugin(bot);
  const lay = (name, p) => { const was = bot.blockAt(p); world.set(`${p}`, block(name, p)); bot.emit('blockUpdate', was, bot.blockAt(p)); };
  lay('nether_bricks', new Vec3(1, 63, 0));
  lay('nether_bricks', new Vec3(1, 64, 0));
  lay('nether_bricks', new Vec3(40, 63, 0));
  lay('netherrack', new Vec3(0, 63, 1));
  const state = {};
  assert.deepEqual([...own.ownSet(bot, state)].sort(), ['1,63,0', '1,64,0'], 'the two laid within reach; one appearing forty off is not the bot\'s');
  // Dug again: forgotten, and the record kept with the search drops it too.
  const was = bot.blockAt(new Vec3(1, 64, 0)); world.delete(`${new Vec3(1, 64, 0)}`); bot.emit('blockUpdate', was, bot.blockAt(new Vec3(1, 64, 0)));
  assert.deepEqual([...own.ownSet(bot, state)], ['1,63,0']);
  // Across a restart: the search's record, read against the ground.
  const fresh = Object.assign(new EventEmitter(), { entity: bot.entity, blockAt: bot.blockAt });
  assert.deepEqual([...own.ownSet(fresh, state)], ['1,63,0']);
  world.set(`${new Vec3(1, 63, 0)}`, block('netherrack', new Vec3(1, 63, 0)));
  assert.deepEqual([...own.ownSet(fresh, state)], [], 'gone from the ground, gone from the record');
  // A brick of the fortress's dug out beside the bot is its digging, and the foot of that hole no floor; put back, it is the fortress's again.
  world.set(`${new Vec3(2, 62, 0)}`, block('nether_bricks', new Vec3(2, 62, 0)));
  const pier = bot.blockAt(new Vec3(2, 62, 0)); world.delete(`${new Vec3(2, 62, 0)}`); bot.emit('blockUpdate', pier, bot.blockAt(new Vec3(2, 62, 0)));
  own.ownSet(bot, state);
  assert.ok(own.dugOut(bot, new Vec3(2, 62, 0)) && state.dug['2,62,0'], 'noted as dug out, and kept');
  lay('nether_bricks', new Vec3(2, 62, 0));
  own.ownSet(bot, state);
  assert.ok(!own.dugOut(bot, new Vec3(2, 62, 0)), 'put back');
  assert.ok(!own.ownSet(bot, state).has('2,62,0'), 'and not counted the bot\'s own');
});

test('a row of the bot\'s own bricks by the bot is not taken for the fortress\'s floor (note 613)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const bot = pierBot();
  const own = require('../src/own-blocks');
  own.ownBlocksPlugin(bot);
  // A span of three laid east from the bot's feet level, two clear over it.
  for (const x of [-83, -82, -81]) {
    const p = new Vec3(x, 43, 123);
    const was = bot.blockAt(p);
    bot.changed.set(`${x},43,123`, 'nether_bricks');
    bot.emit('blockUpdate', was, bot.blockAt(p));
  }
  const goal = { fortressSearch: { axis: 1, legs: 81, own: recorded(OWN), dug: recorded(DUG) } };
  const client = jevStub(['keep_searching']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => {}, dig: async () => {} });
  assert.equal(client.asked[0]?.kind, 'fortress', 'the way in is asked, the bot not taken to stand in the fortress on its own span');
  assert(goal.fortressSearch.approach.found.y >= 65, 'a floor of the fortress\'s own');
  assert.deepEqual(Object.keys(goal.fortressSearch.own).filter(k => k.endsWith(',123')).sort(), ['-81,43,123', '-82,43,123', '-83,43,123']);
});

test('the place the way in is asked about is kept as the bot moves a few steps, not the nearest floor picked afresh (note 613)', async () => {
  // Live, the place moved fifteen to forty blocks at each asking as the bot walked a few steps under the deck.
  const { findFortressStep } = require('../src/mob-hunt');
  const bot = pierBot();
  const goal = { fortressSearch: { axis: 1, legs: 81, own: recorded(OWN), dug: recorded(DUG) } };
  const asked = [];
  const client = { systemOne: async ({ questions }) => { const o = questions.branch_0.criteria; asked.push(o); return { answers: { branch_0: { choice: o.walk_route ? 'walk_route' : 'tunnel', confidence: 0.9 } } }; } };
  // Each walk takes the bot a few blocks along under the deck, and no further.
  const moves = [new Vec3(-81.5, 44, 125.5), new Vec3(-78.5, 44, 128.5)];
  const nav = async () => { bot.entity.position = moves.shift() || bot.entity.position; throw new Error('No path to the goal!'); };
  const actions = { client, navigate: nav, tunnel: async () => { bot.entity.position = moves.shift() || bot.entity.position; }, dig: async () => {} };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const first = { ...goal.fortressSearch.approach.found };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert(bot.entity.position.distanceTo(new Vec3(-84.3, 44, 124.2)) > 6, 'the bot has moved');
  const byNear = mhFloorsNearest(bot, goal);
  assert.notDeepEqual(byNear, first, 'the nearest floor from here is another place');
  assert.deepEqual(goal.fortressSearch.approach.found, first, 'the same place both times');
});
// The nearest floor of the fortress from where the bot stands now.
function mhFloorsNearest(bot, goal) {
  const mh = require('../src/mob-hunt');
  const own = require('../src/own-blocks').ownSet(bot, goal.fortressSearch);
  const ids = ['nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_brick_slab', 'nether_wart'].map(n => bot.registry.blocksByName[n].id);
  const bricks = bot.findBlocks({ matching: ids, maxDistance: 128, count: 4096 }).filter(b => !own.has(`${b.x},${b.y},${b.z}`));
  const f = mh.fortressFloors(bot, bricks).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
  return { x: f.x, y: f.y, z: f.z };
}

test('the walk to the fortress goes on up to the floor once level beside it, and ends short only where it does not get there (note 613)', async () => {
  const mh = require('../src/mob-hunt');
  const bot = pierBot(new Vec3(-95.5, 71, 150.5));
  // The survey's route, as recorded at 15:07:23: a whole route of 3 cells.
  bot.pathfinder.getPathFromTo = function * () { yield { result: { status: 'success', path: [new Vec3(-96, 71, 149), new Vec3(-97, 71, 148), new Vec3(-98, 71, 147)] } }; };
  // A floor of the deck, walked to: the first goal level beside it comes
  // nearer, then the second puts the bot on it.
  const target = new Vec3(-100, 73, 142);
  const goals = [];
  const navigate = async (b, task, g) => { goals.push(g); bot.entity.position = goals.length === 1 ? new Vec3(-99.5, 71, 145.5) : new Vec3(-99.5, 74, 142.5); };
  const state = { legs: 1 };
  const goal = { fortressSearch: state };
  const client = jevStub(['walk_route']);
  const ended = await mh.approachFortress(bot, new Task('hunt'), goal, () => {}, { client, navigate }, state, target, [target]);
  assert.equal(goals.length, 2, 'on to the floor after the point level beside it');
  assert.equal(ended, null);
});

test('off the fortress\'s floors with every way into it from here come to nothing, going back to it is said and not offered: it only asks those ways again (mid-242-bb, note 613)', async () => {
  // 15:02 to 15:07: back_to_fortress chosen seven times, each followed within a second by fortress_approach asked again from the same spot.
  const { findFortressStep } = require('../src/mob-hunt');
  const tried = require('../src/tried');
  const bot = pierBot();
  const goal = { fortressSearch: { axis: 1, legs: 81, own: recorded(OWN), dug: recorded(DUG) } };
  const client = jevStub(['tunnel']);
  const actions = { client, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => {}, dig: async () => {} };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const found = goal.fortressSearch.approach.found;
  const offered = goal.tried.entries.filter(e => e.q === 'fortress_approach').at(-1).offered.map(o => o.key).filter(k => k !== 'none_good');
  assert(offered.length >= 2);
  for (const method of offered) tried.record(bot, goal, { q: 'fortress_approach', method, target: found, outcome: 'blocked', why: 'came no nearer' });
  goal.tried.escalations = [...(goal.tried.escalations || []), { from: 'fortress_approach', to: 'fortress_leg', why: 'fortress approach: every way it had from here rests', at: Date.now() }];
  delete goal.fortressSearch.approach.choice;
  const legs = jevStub(['leg_south']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { ...actions, client: legs });
  const asked = legs.asked.find(a => a.options.leg_south);
  assert(asked, 'the leg\'s question is asked');
  assert.equal(asked.options.back_to_fortress, undefined, 'going back is not offered from here');
  assert.match(asked.state.fortressInView.setAside, /from here every way into it last offered came to nothing \(.*tunnel.*\): going back from here is asking those same ways again/);
});

test('a pillar that tops out blocks off the floor says what lies between at that height (15:07:23, note 613)', async () => {
  // Offered as recorded: "Pillar straight up 2 blocks ... from a column 1 blocks from here ... the floor at (-79, 46, 127) is then
  // 6 blocks across", with nothing said of the six, and no block carried that a span is laid with.
  const mh = require('../src/mob-hunt');
  const bot = pierBot();
  const target = new Vec3(-79, 45, 127);
  const state = { legs: 81 };
  const client = jevStub(['keep_searching']);
  await mh.approachFortress(bot, new Task('hunt'), { fortressSearch: state }, () => {}, { client, navigate: async () => {}, tunnel: async () => {}, dig: async () => {} }, state, target, [target]);
  const pillar = client.asked[0].options.pillar_up;
  assert.match(pillar, /is then (\d+) blocks across, with \1 of open air with no floor between the top and it at that height \(a span, 0 blocks carried that a span is laid with\)/);
});
