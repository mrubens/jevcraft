'use strict';
// Note 711: the trip home with rods carried. Measured on the flight records
// of 2026-09-29T00:00Z on (scripts/rod-trip-audit.js, kept at
// scripts/trials/rod-trip-audit.js): of 169 stretches with a blaze rod
// carried and the step aimed at the portal, 165 broke off within the
// recorder's own gap for some other action with the rods still in the
// Nether and 4 got out; mid-242-jb (25591) carried 5 rods at 1.6 to 3.8
// health for about two hours, never arriving. The gap: every other offer of
// the trip home reads mob-hunt.js tripHomeClosed (note 706) before it is
// offered, but the one call that runs once the rods (and pearls) the ladder
// wants are all carried (game-progress.js nextGameStage, "return_overworld"
// unconditionally) did not, and was not a held intention either, so a
// preemption lost the trip and the next pass walked into it again from
// wherever the bot now stood.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

const SPAN = require('./fixtures/nether-span-mid-242-af.json');
const AT = new Vec3(-29.5, 72, 48.5);
function netherBot({ health = 20, food = 20, items = [['iron_sword', 1], ['wooden_pickaxe', 1], ['netherrack', 150], ['blaze_rod', 7], ['ender_pearl', 13]] } = {}) {
  return groundBot(SPAN, { at: AT, items: items.map(i => [...i]), health, food, dimension: 'the_nether', indexed: true, worn: ['iron_helmet', 'iron_chestplate'] });
}
const PORTAL = { x: 391, y: 42, z: 48 };
function goalOf() {
  return { kind: 'win', request: 'beat the game', portals: [{ ...PORTAL, dimension: 'nether' }, { x: 3128, y: 64, z: 384, dimension: 'overworld' }], gameProgress: { phase: 'obtain_blaze_rods' } };
}
function waysResting(bot, goal) {
  const { setAside } = require('../src/progress');
  const p = new Vec3(PORTAL.x, PORTAL.y, PORTAL.z);
  setAside(goal, 'portal_leg', p, 'a walk toward it made no ground', 120000);
  const h = bot.entity.position;
  setAside(goal, 'crossing', `${Math.floor(h.x / 8)},${Math.floor(h.z / 8)}>${p.x},${p.z}`, 'came no nearer', 300000);
  const area = { x: Math.floor(p.x / 8) * 8, y: Math.floor(p.y / 8) * 8, z: Math.floor(p.z / 8) * 8 };
  setAside(goal, 'staircase', area, 'the staircase toward it is not gaining on it', 10 * 60000);
}

test('the rods (and pearls) the ladder wants are carried: the ladder is ready for the Overworld (note 711)', () => {
  const { nextGameStage } = require('../src/game-progress');
  const bot = netherBot(), goal = goalOf();
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.phase, 'return_with_blaze_supplies');
  assert.equal(stage.action, 'home_with_rods', 'not the bare return_overworld action run unconditionally, unguarded and unheld');
});

test('closed from here (every way home resting): the trip is not walked into, it waits and says why, not "cannot be reached" thrown at every pass (note 711)', async () => {
  const { readyForHomeStep } = require('../src/game-progress');
  const bot = netherBot(), goal = goalOf();
  waysResting(bot, goal);
  const holds = [];
  const actions = { hold_for_rest: async (_b, _t, _g, _sv, opts) => holds.push(opts), return_overworld: async () => assert.fail('closed: the walk should not be begun') };
  await readyForHomeStep(bot, new Task('win'), goal, () => {}, actions);
  assert.equal(holds.length, 1, 'other work in the Nether while it rests, not a bare throw');
  assert.equal(holds[0].reason, 'step:return_with_blaze_supplies');
  assert.match(holds[0].why, /cannot be reached from here/);
});

test('open from here, full health: going is one way, taken without asking (no real choice, none held: cheap to re-derive, note 711)', async () => {
  const { readyForHomeStep } = require('../src/game-progress');
  const bot = netherBot(), goal = goalOf();
  const left = [];
  const actions = { return_overworld: async () => left.push('portal'), client: { systemOne: async () => assert.fail('one option: not asked') } };
  await readyForHomeStep(bot, new Task('win'), goal, () => {}, actions);
  assert.equal(left.length, 1, 'the one way home is taken, not asked (decisions.js: "one way: taken and said, not asked")');
  assert.equal(goal.leaveNether?.pick, 'go_back');
});

test('open from here, hurt: a real second way (heal first) is asked, and going is held as the intention leave_nether/go_back, the same as any other trip home (note 689, note 711)', async () => {
  const { readyForHomeStep } = require('../src/game-progress');
  const bot = netherBot({ health: 14 }), goal = goalOf();
  const said = []; bot.chat = line => said.push(line);
  const left = [], asked = [];
  const actions = { return_overworld: async () => left.push('portal'),
    client: { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'go_back', confidence: 0.9 } } }; } } };
  await readyForHomeStep(bot, new Task('win'), goal, () => {}, actions);
  assert.deepEqual(Object.keys(asked[0]).filter(k => k !== 'none_good').sort(), ['go_back', 'heal_first'], 'hurt and able to heal: a real second way');
  assert.equal(left.length, 1);
  assert.equal(goal.leaveNether?.pick, 'go_back');
  assert.equal(goal.intention?.q, 'leave_nether', 'held as the intention: another loop\'s question does not silently drop the trip mid-way');
  assert.equal(goal.intention?.choice, 'go_back');
  assert.deepEqual(goal.intention?.target, PORTAL, 'the portal itself, not the question\'s own target (note 705)');
  // The same leave_nether/go_back is asked for food (note 495) and for the
  // rods carried (note 711); the chat line must say the real reason, not
  // always "for food" (src/intention.js SAYS table, note 495).
  assert.match(said[0], /^Going back through the portal with the rods carried/);
  assert.doesNotMatch(said[0], /for food/);
});

test('open from here, hurt, Jev chooses to heal first: held to wait, not walked home hurt (note 711)', async () => {
  const { readyForHomeStep } = require('../src/game-progress');
  const bot = netherBot({ health: 12 }), goal = goalOf();
  const holds = [], left = [];
  const actions = { return_overworld: async () => left.push('portal'), hold_for_rest: async (_b, _t, _g, _sv, opts) => holds.push(opts),
    client: { systemOne: async () => ({ answers: { branch_0: { choice: 'heal_first', confidence: 0.9 } } }) } };
  await readyForHomeStep(bot, new Task('win'), goal, () => {}, actions);
  assert.equal(left.length, 0, 'not walked home while healing');
  assert.equal(holds.length, 1);
  assert.equal(holds[0].reason, 'step:heal_before_home');
  assert.match(holds[0].why, /Healing before the walk home with the rods/);
});

test('the risk on the way home said plainly: a ghast and an angry piglin on it, not hidden (note 711)', () => {
  const gp = require('../src/game-progress');
  const bot = netherBot();
  const ghast = { id: 1, name: 'ghast', position: bot.entity.position.offset(20, 0, 0), isValid: true };
  const piglin = { id: 2, name: 'piglin', position: bot.entity.position.offset(6, 0, 0), isValid: true };
  bot.entities = { 1: ghast, 2: piglin };
  bot._hurtBy = { piglin: Date.now() - 1000 };
  const said = gp.routeThreatsSays(bot);
  assert.match(said, /1 ghast within 40 blocks \(nearest 20\)/);
  assert.match(said, /1 angry piglin within 24 blocks \(nearest 6\), hunting the bot any way round/);
  // Calm (no reason to be angry): not said as a threat.
  delete bot._hurtBy;
  const calm = gp.routeThreatsSays(bot);
  assert.doesNotMatch(calm, /piglin/);
  assert.match(calm, /ghast/, 'the ghast is said whether angered or not');
});

test('nothing about (the ordinary case): the way back says the lava and the health, and nothing more (note 711)', () => {
  const gp = require('../src/game-progress');
  const bot = netherBot();
  bot.entities = {};
  assert.equal(gp.routeThreatsSays(bot), '', 'nothing near: nothing said');
});
