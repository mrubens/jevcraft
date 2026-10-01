'use strict';
// Note 708. 25591 (mid-242-nb, 01:12 to 01:19Z on 2026-09-30) stood boxed
// 6 blocks from the cage at (-108, 77, 155), its window facing rock, every
// blaze out of sight: turn_priority's hunt was chosen about 30 times and
// did nothing, empty_spawner offered the box as "hold it for its next
// blazes", and keep_on said "no fight is started" in the second the chat
// said "I'm going after a blaze". 25584 (mid-242-nh, 01:17:52Z) saw a
// fortress 104 blocks off and was offered only the staircase and a crossing
// that ended 71 short. The ground is each trial's own region as saved
// (test/fixtures/spawner-box-25591.json, fortress-far-25584.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');
const T = require('../src/blaze-tactics');
const es = require('../src/empty-spawner');
const arbiter = require('../src/arbiter');
require('../src/decisions/travel');

const ROOM = require('./fixtures/spawner-box-25591.json');
const FAR = require('./fixtures/fortress-far-25584.json');
const CAGE = new Vec3(-108, 77, 155);
// Inside the box as the trial had it: the cell (-104, 78, 150), its window
// (-104, 79, 151) facing the netherrack north of the spawner room.
const IN_BOX = new Vec3(-103.5, 78, 150.5);
// A blaze behind the room's wall, out of the bot's sight from the box.
const HIDDEN = [{ id: 100, name: 'blaze', at: new Vec3(-110.5, 78, 154.5), height: 1.8 }];

function boxBot({ at = IN_BOX, mobs = HIDDEN, food = 17, items = [['netherrack', 64], ['iron_sword', 1], ['iron_pickaxe', 1]] } = {}) {
  return groundBot(ROOM, { at, health: 18.1, food, items, dimension: 'the_nether', mobs, indexed: true });
}
const huntGoal = extra => ({ kind: 'win', survival: { deaths: [] }, mobHunt: { item: 'blaze_rod', entity: 'blaze', targetCount: 7 },
  fortressSearch: { legs: 3, map: { cells: {}, failed: {}, spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }], chests: [] } }, ...extra });
function jev(pick = null) {
  const asked = [];
  return { asked, model: 'x', systemOne: async req => {
    const criteria = req.questions.branch_0.criteria;
    asked.push({ state: req.state, options: criteria });
    const keys = Object.keys(criteria);
    return { answers: { branch_0: { choice: pick && keys.includes(pick) ? pick : keys.find(k => k !== 'none_good'), confidence: 0.9 } } };
  } };
}
const noIntention = t => { process.env.JEV_INTENTION = '0'; t.after(() => { delete process.env.JEV_INTENTION; }); };

test('the box 25591 held sees none of the cells round the cage where the spawner puts its blazes; the box by the cage sees most', () => {
  const bot = boxBot();
  const held = T.boxFits(bot, T.boxPlan(bot, new Vec3(-104, 78, 150), CAGE.offset(0.5, 0.5, 0.5)));
  assert.equal(`${held.window}`, '(-104, 79, 151)');
  assert.deepEqual(T.windowLine(bot, held, CAGE), { cells: 0, of: 83, per100: 0 });
  const byCage = T.boxSite(bot, { cage: CAGE, from: CAGE.offset(0.5, 0.5, 0.5) });
  assert.equal(`${byCage.cell}`, '(-108, 78, 151)');
  assert.ok(byCage.line.per100 >= 80, JSON.stringify(byCage.line));
  // Where it stands, walls and all as they are: next to nothing.
  const here = T.standLine(bot, IN_BOX.floored(), CAGE);
  assert.equal(here.per100, 0);
  assert.equal(T.lineWords(here), 'where fewer than 1 in 100 of the spawner\'s blazes come');
  assert.equal(T.windowSays({ cells: 0, of: 83, per100: 0 }), ' Its window sees none of where the spawner\'s blazes come: it gains no rod this way, none of the spawner\'s blazes ever crossing it.');
});

test('empty_spawner at 25591\'s box: where the bot stands is said against where the blazes come, the box with no line is not held "for its next blazes", and a slit toward the cage is offered with what it then sees', async () => {
  const bot = boxBot(), goal = huntGoal();
  const client = jev('stand_by_spawner');
  const done = await es.atSpawner(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, dig: async () => {}, waitAtSpawner: async () => {} });
  assert.equal(done, true);
  const { state, options } = client.asked[0];
  assert.equal(state.lineHere, 'From here, 6 blocks from the cage, it sees where fewer than 1 in 100 of the spawner\'s blazes come; the blaze within 16 out of sight.');
  // Note 774: a box whose window sees none of where the blazes come is no
  // way to the rods, and empty_spawner (the rods' question) leaves it out;
  // the box by the cage, which sees most, is offered.
  assert.equal(options.box_here, undefined, 'the box here sees none: not offered');
  assert.match(options.box_at_spawner, /hold it for its next blazes: only a blaze in line with the window sees in, from the front\. Its window sees where about \d+ in 100 of the spawner's blazes come\./);
  assert.match(options.open_slit, /^Open a slit toward the cage: dig the 2 blocks on the line from the eyes to it \(the nether brick fence at \(-105, 78, 152\); the nether brick fence at \(-106, 78, 152\)\), then stay a minute and fight what comes into that line\. Then it sees where fewer than 1 in 100 of the spawner's blazes come\./);
});

test('the nearest box is said with its line, and the nearby box that sees most is kept beside it', () => {
  // From the room's north-east corner the nearest box faces the wall; one a
  // few steps off sees into the room.
  const bot = boxBot({ at: new Vec3(-104.5, 78, 149.5) });
  const here = T.boxSite(bot, { from: CAGE.offset(0.5, 0.5, 0.5), sightOf: CAGE });
  // (Note 774: the window is cut where the line from the eyes to the cage
  // leaves the box, so the nearest fitting box is the bot's own cell's
  // neighbour here; its line is still next to none.)
  assert.equal(`${here.cell}`, '(-104, 78, 149)');
  assert.ok(here.line.per100 <= 1, 'the nearest box carries its line: next to none');
  assert.equal(`${here.inLine.cell}`, '(-108, 78, 151)');
  assert.ok(here.inLine.line.per100 >= 80, JSON.stringify(here.inLine.line));
});

test('a stand chosen at the cage with no cell of its own walks within four of it where the bot\'s spot sees none of the blazes\' cells; it waits where it sees them', async t => {
  noIntention(t);
  const { findFortressStep } = require('../src/mob-hunt');
  const bot = boxBot(), goal = huntGoal(), state = goal.fortressSearch;
  state.spawnerWait = { x: CAGE.x, y: CAGE.y, z: CAGE.z, until: Date.now() + 60000, startedAt: Date.now(), chosen: 'empty_spawner' };
  const walks = [];
  const navigate = async (b, task, g) => { walks.push(g); };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { navigate, tunnel: async () => {} });
  assert.equal(walks.length, 1);
  assert.equal(walks[0].constructor.name, 'GoalNear');
  assert.equal(state.spawnerWait.nearTried, true);
  // Walked once: then it waits.
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { navigate, tunnel: async () => {} });
  assert.equal(walks.length, 1);
});

test('a hunt whose turn could do nothing claims none: a visit answer held from before, no blaze in sight (25591)', () => {
  const fv = require('../src/fortress-visit');
  const { claim } = require('../src/mob-hunt');
  const bot = boxBot();
  const held = { pick: 'get_food_here', at: Date.now() - 20000, health: 18.1, food: 17, deaths: 0 };
  const goal = huntGoal({ fortressVisit: held });
  assert.equal(fv.holdsOff(bot, goal).pick, 'get_food_here');
  assert.equal(claim(bot, goal), null);
  // Going in held: the hunt claims, the blaze said out of sight.
  const goIn = huntGoal({ fortressVisit: { ...held, pick: 'go_in' } });
  assert.equal(fv.holdsOff(bot, goIn), null);
  const c = claim(bot, goIn);
  assert.ok(c, 'claimed');
  assert.equal(c.facts.outOfSight, true);
  assert.match(arbiter.claimSays(c), /^Hunt the blaze [\d.]+ blocks off \(out of sight\) for blaze rods \(0 of 7 carried\): /);
  // Walled in, said so.
  assert.match(arbiter.claimSays({ ...c, facts: { ...c.facts, walledIn: '3 of the 8 blocks round it its own' } }), /the bot is walled in \(3 of the 8 blocks round it its own\), so it closes on it only by digging out first; which one, and the fight's cost, is asked next\./);
});

test('the visit held on an answer carried out before is "held", and the hunt says it did nothing', async () => {
  const fv = require('../src/fortress-visit');
  const bot = boxBot();
  const goal = huntGoal({ fortressVisit: { pick: 'hoglin_hunt', at: Date.now() - 10000, health: 18.1, food: 17, deaths: 0 } });
  assert.equal(await fv.ask(bot, new Task('hunt'), goal, () => {}, { client: jev() }, {}), 'held');
  const { huntObserved } = require('../src/mob-hunt');
  assert.equal(await huntObserved(bot, new Task('hunt'), goal, () => {}, { navigate: async () => {} }, jev()), false);
});

test('a blaze behind the rock is no newcomer until it comes into sight or within four (the arbiter\'s ruling, as the watch has it)', async () => {
  let asked = 0;
  const decide = async () => { asked++; return { path: ['hunt'] }; };
  const state = {}, claims = () => [{ layer: 'hunt', action: 'hunt', urgency: 'routine', facts: {}, run: async () => true }, { layer: 'work', action: 'work_step', urgency: 'routine', facts: {}, run: async () => true }];
  const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 18, food: 17, oxygenLevel: 20, entities: {} };
  const mob = (d, id, visible) => ({ entity: { name: 'blaze', id }, distance: d, visible });
  const at = (now, mobs) => arbiter.arbitrate(bot, claims(), { state, decide, now, mobs });
  assert.equal((await at(0, [mob(5, 1, false)])).by, 'jev');
  assert.equal((await at(1000, [mob(5, 1, false), mob(5.5, 2, false)])).by, 'held', 'a new one behind the rock');
  assert.equal(asked, 1);
  assert.equal((await at(2000, [mob(5, 1, true), mob(5.5, 2, false)])).why, 'a newcomer within six blocks', 'one comes into sight');
  assert.equal((await at(3000, [mob(5, 1, true), mob(5.5, 2, false), mob(3.5, 3, false)])).why, 'a newcomer within six blocks', 'one within four, seen or not');
});

test('going on without food says what it does to the fights: no blaze gone after, one met in reach still a fight', () => {
  const nv = require('../src/nether-travel');
  const hungry = { food: 17, health: 18.1, inventory: { items: () => [] } };
  assert.equal(nv.keepOnFightSays(hungry), 'The hunt goes looking for no blaze meanwhile (the search goes on), but a blaze met in reach is still offered as a fight.');
  // "No fight is started" is said nowhere.
  for (const f of ['mob-hunt.js', 'nether-travel.js', 'nether-food.js']) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), /no fight is started/i, f);
  // The chat on the hunt's step says the same.
  const narration = require('../src/narration');
  const { setAside } = require('../src/progress');
  const goal = { kind: 'win' };
  setAside(goal, 'nether_return', 'food', 'Jev chose to stay', 20 * 60000);
  assert.equal(narration.stepLine(goal, { action: 'hunt_mob', entity: 'blaze', item: 'blaze_rod' }, null, null, hungry), 'Going on without food for now: I won\'t go after a blaze, but I\'ll fight one that comes.');
  assert.match(narration.stepLine({ kind: 'win' }, { action: 'hunt_mob', entity: 'blaze', item: 'blaze_rod' }, null, null, hungry), /blaze/);
});

test('food got at full hunger is said as a stock-up (25584: "Getting food here first: hunger 20")', () => {
  const { startSays } = require('../src/intention');
  const bot = { food: 20, health: 20 };
  assert.equal(startSays(bot, {}, { q: 'nether_food_kit', choice: 'restock_food' }, {}), 'Stocking up on food here first: hunger 20, health 20.');
  assert.equal(startSays({ food: 12, health: 20 }, {}, { q: 'nether_food_kit', choice: 'restock_food' }, {}), 'Getting food here first: hunger 12, health 20.');
});

// 25584's ground: the bot in its leg's tunnel at (-60, 57, -171), the
// fortress's nearest brick (-162, 54, -182), 103 blocks of netherrack between.
function farBot() {
  const bot = groundBot(FAR, { at: new Vec3(-59.5, 57, -170.5), items: [['iron_pickaxe', 1], ['netherrack', 64], ['cobblestone', 64], ['cooked_mutton', 4]], dimension: 'the_nether', indexed: true });
  bot.entities = {}; bot.players = {};
  return bot;
}
function bricksOf(bot) {
  const out = [];
  for (let x = -170; x <= -50; x++) for (let y = 44; y <= 70; y++) for (let z = -195; z <= -160; z++) { const b = bot.blockAt(new Vec3(x, y, z)); if (b && /^nether_brick/.test(b.name)) out.push(new Vec3(x, y, z)); }
  return out.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
}

test('a fortress in view 103 blocks off across the rock: heading toward it the way the legs go is a way in, and chosen, a pass walks, crosses and digs toward it (25584)', async t => {
  noIntention(t);
  const { approachFortress } = require('../src/mob-hunt');
  const bot = farBot(), bricks = bricksOf(bot);
  assert.equal(`${bricks[0]}`, '(-162, 54, -182)');
  const goal = { kind: 'win', portals: [], fortressSearch: { legs: 10, since: Date.now() - 9 * 60000, shunned: [] } };
  const client = jev('head_toward');
  const went = [];
  const why = await approachFortress(bot, new Task('hunt'), goal, () => {}, { client, navigate: async (b, task, g) => { went.push(g.constructor.name); throw new Error('No path to the goal!'); },
    tunnel: async () => { went.push('tunnel'); }, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false }, goal.fortressSearch, bricks[0], bricks.slice(0, 200));
  const { options } = client.asked[0];
  assert.equal(options.head_toward, 'Head west toward it the way the search\'s legs go, a pass at a time: the pathfinder\'s walk where it finds ground, straight across at this height where the cells ahead allow, the staircase where neither does. The way in is asked again within 48 blocks of it, or after a pass that gains nothing.');
  assert.ok(options.cross_level && options.tunnel && options.keep_searching);
  assert.deepEqual(went, ['GoalNearXZ', 'tunnel'], 'the walk first, then (the crossing finding nothing to lay here) the staircase');
  assert.match(why, /^head toward: /, 'no nearer in the stub: said as a failure of this way');
  // Within 48 it is not offered: the ways in are.
  const near = groundBot(FAR, { at: new Vec3(-139.5, 56, -181.5), items: [['iron_pickaxe', 1], ['netherrack', 64]], dimension: 'the_nether', indexed: true });
  near.entities = {}; near.players = {};
  const c2 = jev('keep_searching');
  await approachFortress(near, new Task('hunt'), { kind: 'win', portals: [], fortressSearch: { legs: 1, shunned: [] } }, () => {}, { client: c2, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => {}, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false },
    { legs: 1, shunned: [] }, bricks[0], bricks.slice(0, 200));
  assert.ok(c2.asked.length, 'the ways in were asked');
  assert.equal(c2.asked[0].options.head_toward, undefined);
});

test('each leg says where it ends against a fortress in view: toward, away or across (25584 took leg_east away from it)', async () => {
  const { chooseLeg } = require('../src/mob-hunt');
  const bot = farBot(), bricks = bricksOf(bot);
  const goal = { kind: 'win', portals: [], fortressSearch: { legs: 10, since: Date.now(), shunned: [] } }, state = goal.fortressSearch;
  const client = jev('none_good');
  const fortress = { key: 'back_to_fortress', bricks: bricks.slice(0, 200), description: 'Go back into the fortress in view.', run: () => 'back', facts: {} };
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, tunnel: async () => {} }, state, fortress);
  const { options } = client.asked[0];
  assert.match(options.leg_west, /^Toward the fortress in view: its end is 13 blocks from its nearest brick \(103 now\)\. /);
  assert.match(options.leg_east, /^Away from the fortress in view: its end is 198 blocks from its nearest brick \(103 now\)\. /);
});
