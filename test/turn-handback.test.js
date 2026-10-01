'use strict';
// Note 586: the turn handed back to the work without Jev being asked, with a mob at its reach of the bot or a
// push over a deadly drop live. The recorded states, moved to the origin: the bot at (0.5, 64, 0.5).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const arbiter = require('../src/arbiter');
const danger = require('../src/danger');

const claim = (layer, urgency = 'routine', extra = {}) => ({ layer, action: `${layer}_step`, urgency, facts: {}, run: async () => true, ...extra });
const scene = ({ health, food = 20, ground, entities = {} }) => {
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, width: 0.6, height: 1.8, metadata: [0] }, health, food, oxygenLevel: 20,
    game: { dimension: 'the_nether', difficulty: 'normal', gameMode: 'survival', minY: 0, height: 256 },
    time: { timeOfDay: 6000, age: 100000 }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} }, world: { raycast: () => null },
    blockAt: p => ground(p) ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p },
    stopDigging: () => {}, clearControlStates: () => {}, pathfinder: { setGoal: () => {} }, entities };
  return bot;
};
const claimsOf = (bot, goal) => [require('../src/survival').claim(bot, goal, { state: goal.survival, currentShelter: () => null }), require('../src/vitals').claim(bot),
  require('../src/mob-hunt').claim(bot, goal), { layer: 'work', action: goal.step?.action || 'step', urgency: 'routine', facts: {} }];

// mid-242-ae at 04:47:56.9: the eat stance done at 7.7 health, a golden-spear piglin 4.1 blocks off and two below,
// set aside for twenty seconds as out of reach when the fight's run at it went nowhere.
const aeScene = () => {
  const piglin = { id: 8356, name: 'piglin', type: 'hostile', position: new Vec3(2.62, 62, -2.35), height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'golden_spear' } };
  // The bot's floor for x under 2, the piglin's two lower beyond.
  return { bot: scene({ health: 7.67, ground: p => p.y < (p.x < 2 ? 64 : 62), entities: { 8356: piglin } }), piglin };
};

test('mid-242-ae: after the meal, a spear piglin two below that the fight\'s run could not reach is survival\'s claim, and the turn is asked, not handed to the work', async () => {
  // Survival claimed nothing, the work was given the turn alone (combat_kit, upkeep, recover_before_combat), and the
  // piglin came to its reach and speared the bot from 7.7 to none.
  const now = Date.now();
  const { bot } = aeScene();
  bot._unreachable = { ids: [8356], until: now + 16000 };
  bot._recentHurtAt = now - 6700;
  const goal = { kind: 'win', step: { action: 'cross_toward' }, survival: {} };
  const claims = claimsOf(bot, goal);
  assert.equal(claims[0]?.layer, 'survival', 'the piglin is survival\'s claim');
  assert.equal(claims[0].action, 'escape_threat'); assert.equal(claims[0].facts.threat.name, 'piglin');
  // Its way to the bot is walk-reach's to judge, not the charge's: a spear lands from the lower floor, two across.
  assert.equal(danger.noWayIds(bot).has(8356), false, 'a spear reaches the bot from the floor below');
  const asked = [];
  const turn = await arbiter.take(bot, claims.map(c => c && { ...c, run: async () => true }),
    { decide: async (id, q) => { asked.push([id, Object.keys(q.tree).sort()]); return { path: ['survival'] }; }, now });
  assert.deepEqual(asked, [['turn_priority', ['survival', 'work']]]);
  assert.equal(turn.layer, 'survival');
});

test('mid-242-ae: the work holding the turn, the piglin coming to its spear\'s reach stops it and asks whose turn it is, at any health, once', () => {
  const now = Date.now();
  const { bot, piglin } = aeScene();
  bot._arbiter = { holder: { layer: 'work', action: 'recover_before_combat', since: now - 500, ids: [8356], knew: { reach: false, push: false } } };
  const lines = [];
  assert.equal(arbiter.watchOnce(bot, { live: true, log: line => lines.push(line) }), null, 'four blocks off and two below: not at its reach');
  // 04:47:58.0: 1.3 across and 1.6 below, where it struck.
  piglin.position = new Vec3(1.75, 62.4, 0.3);
  const p = arbiter.watchOnce(bot, { live: true, log: line => lines.push(line) });
  assert.equal(p?.by, 'reach'); assert.equal(p.facts.mob, 'piglin');
  assert.match(lines[0], /^\[arbiter\] preempted work recover_before_combat/);
  // Picked up, the arbiter rules: a held ruling for the work made without a mob at its reach is asked again.
  const claims = [claim('survival', 'pressing', { action: 'escape_threat' }), claim('work')];
  const state = { ruling: { winner: 'work', fingerprint: arbiter.fingerprintOf(claims), at: now - 1000, until: now + 59000, ids: [8356], health: 7.67, band: arbiter.foodBand(20), reach: false, push: false } };
  assert.equal(arbiter.rule(bot, claims, { state, now, mobs: [], dry: true }).why, 'a mob came within its reach of the bot');
  // A holder given the turn with it (asked, or known then) is not stopped for it again.
  delete bot._preempt;
  bot._arbiter.holder.knew = { reach: true, push: false };
  assert.equal(arbiter.watchOnce(bot, { live: true, log: () => {} }), null);
  // Nor survival's own step, which answers it.
  bot._arbiter.holder = { layer: 'survival', action: 'escape_threat', since: now, ids: [], knew: { reach: false, push: false } };
  assert.equal(arbiter.watchOnce(bot, { live: true, log: () => {} }), null);
});

test('a spear\'s reach is the 26.1.2 jar\'s: 2.25 past a mob\'s box sideways, not up or down; an arm\'s is three', () => {
  const { bot } = aeScene();
  const at = (x, y, z, held) => danger.atItsReach(bot, { entity: { name: 'piglin', position: new Vec3(0.5 + x, 64 + y, 0.5 + z), width: 0.6, height: 1.95, heldItem: held ? { name: held } : undefined }, distance: Math.hypot(x, y, z) });
  assert.equal(at(2.5, 0, 2.5, 'golden_spear'), true, 'the diagonal, 3.5 off');
  assert.equal(at(2.5, 0, 2.5, 'golden_sword'), false, 'an arm does not reach 3.5');
  assert.equal(at(2.9, 0, 0, 'golden_spear'), false, 'past 2.85 straight ahead');
  assert.equal(at(2.8, 0, 0, 'golden_spear'), true);
  assert.equal(at(1, -2.1, 0, 'golden_spear'), false, 'its box below the bot\'s feet: not widened down');
  assert.equal(at(2.9, 0, 0, 'crossbow'), false, 'a crossbow piglin shoots: a push, not a reach');
});

// mid-242-ac-nether-3 at 05:07:30: 10.6 health, a nineteen-block drop one block west, the ground three lower to the
// east; a crossbow piglin came on from 28 blocks to 6 while the work held one turn for 57 seconds, and its arrow put
// the bot over.
const spanScene = piglinAt => {
  const piglin = { id: 5505, name: 'piglin', type: 'hostile', position: piglinAt, height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'crossbow' } };
  const ground = p => p.x === -1 ? p.y < 45 : p.x < 2 ? p.y < 64 : p.y < 61;
  return { bot: scene({ health: 10.56, food: 15, ground, entities: { 5505: piglin } }), piglin };
};

test('mid-242-ac-nether-3: a crossbow piglin come within its reach of the bot by a deadly drop stops the work\'s long turn and asks; survival\'s claim says the drop', () => {
  const now = Date.now();
  const { bot, piglin } = spanScene(new Vec3(25.5, 61, 12.5));
  bot._arbiter = { holder: { layer: 'work', action: 'step', since: now - 55000, ids: [], knew: { reach: false, push: false } } };
  assert.equal(arbiter.watchOnce(bot, { live: true, log: () => {} }), null, 'twenty-eight blocks off: nothing to push the bot yet');
  piglin.position = new Vec3(5.5, 61, 3.2);
  delete bot._pushers;
  assert.equal(arbiter.watchOnce(bot, { live: true, log: () => {} })?.by, 'push');
  const goal = { kind: 'win', step: { action: 'persist' }, survival: {} };
  const mine = require('../src/survival').claim(bot, goal, { state: goal.survival, currentShelter: () => null });
  assert.equal(mine.action, 'escape_threat'); assert.equal(mine.facts.threat.name, 'piglin'); assert.equal(mine.facts.threat.shoots, true);
  assert.match(mine.facts.edge, /^A drop of 19 blocks is 1 block off: a hit's knockback or a step back over it is about 16 health from the fall, more than the 11 the bot has\.$/);
  assert.match(arbiter.claimSays(mine), /A drop of 19 blocks is 1 block off/);
  // A ruling for the work made with nothing to push the bot is asked again.
  const claims = [mine, claim('work')];
  const state = { ruling: { winner: 'work', fingerprint: arbiter.fingerprintOf(claims), at: now - 55000, until: now + 5000, ids: [], health: 10.56, band: arbiter.foodBand(15), reach: false, push: false } };
  assert.equal(arbiter.rule(bot, claims, { state, now, mobs: [], dry: true }).why, 'something that can push the bot is about, a deadly drop beside it');
});

test('mid-242-af-nether-3: a ghast forty blocks off in sight by a deadly drop is a push; left be by Jev it waits out his fifteen seconds, then the work\'s turn is stopped and asked about', () => {
  // 05:36:53 keep_working with a ghast 34 blocks off; the work's rest hold kept the turn past the fifteen seconds, and
  // at 05:37:30 its fireball from 41 blocks put the bot in the lava ten blocks down.
  const now = Date.now();
  const { bot } = spanScene(new Vec3(40.5, 90, 0.5));
  bot.entities = { 77: { id: 77, name: 'ghast', type: 'hostile', position: new Vec3(0.5, 70, 41.5), height: 4, width: 4, isValid: true } };
  bot._wavedOff = { ids: [77], until: now + 10000 };
  // Hunger where health comes back: at 15 with nothing to eat and 10.6
  // health, food is the survival layer's claim in the Nether too (note 771c),
  // and this case is the push's.
  bot.food = 18;
  bot._arbiter = { holder: { layer: 'work', action: 'find_fortress', since: now - 1000, ids: [], knew: { reach: false, push: false } } };
  assert.equal(arbiter.watchOnce(bot, { live: true, log: () => {} }), null, 'left be as Jev chose (keep_working)');
  assert.equal(require('../src/survival').claim(bot, { kind: 'win', survival: {} }, { state: {}, currentShelter: () => null }), null);
  bot._wavedOff.until = now - 1; delete bot._pushers;
  assert.equal(arbiter.watchOnce(bot, { live: true, log: () => {} })?.by, 'push');
  const mine = require('../src/survival').claim(bot, { kind: 'win', survival: {} }, { state: {}, currentShelter: () => null });
  assert.equal(mine.facts.threat.name, 'ghast'); assert.match(mine.facts.edge, /A drop of 19 blocks/);
});

test('the turn given to the work records what it was given against, and a ruling made with a push is not asked again for it', async () => {
  const now = Date.now();
  const { bot } = spanScene(new Vec3(5.5, 61, 3.2));
  const decide = async () => ({ path: ['work'] });
  await arbiter.take(bot, [claim('survival', 'pressing', { action: 'escape_threat' }), claim('work')], { decide, now });
  assert.deepEqual(bot._arbiter.holder.knew, { reach: false, push: true });
  assert.equal(bot._arbiter.ruling.push, true);
  assert.equal(arbiter.watchOnce(bot, { live: true, log: () => {} }), null, 'Jev chose the work with it said');
  const again = arbiter.rule(bot, [claim('survival', 'pressing', { action: 'escape_threat' }), claim('work')], { now: now + 1000, mobs: [], dry: true });
  assert.equal(again.by, 'held');
});

// mid-242-af-nether-1 at 05:32:22: 15.2 health, iron helmet and chestplate, an iron sword and a shield, a golden-spear
// piglin 2.6 blocks off, a three-block edge into lava one block west. Jev answered none of these (0.44) twice; the
// fight was taken, and the piglin's one hit that landed (15.2 to 9.5) knocked the bot into the lava.
const { Survival } = require('../src/survival');
const { Task } = require('../src/skills');
const { EventEmitter } = require('node:events');
const edgeBot = ({ piglinAt = new Vec3(3.1, 64, 0.5), shield = true } = {}) => {
  const piglin = { id: 1, name: 'piglin', type: 'hostile', position: piglinAt, height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'golden_spear' } };
  const block = p => p.x === -1 ? (p.y <= 60 ? { name: 'lava', boundingBox: 'empty' } : { name: 'air', boundingBox: 'empty' }) : p.y < 64 ? { name: 'netherrack', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
  const activated = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 1: piglin }, health: 15.2, food: 16, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), width: 0.6, height: 1.8 }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, ...(shield ? [{ name: 'shield', count: 1 }] : [])], emptySlotCount: () => 10, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, ...(shield ? { 45: { name: 'shield' } } : {}) } },
    blockAt: p => ({ position: p, ...block(p) }), world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {},
    activateItem: offhand => activated.push(offhand), deactivateItem() {}, lookAt: async () => {} });
  return { bot, piglin, activated };
};

test('mid-242-af-nether-1: a spear piglin by a drop into lava is met as a player meets it, shield up, and every open stance is priced by the knock over the drop; its hits are the ones seen', () => {
  const { bot, piglin } = edgeBot();
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {}, dig: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('t'), { step: { action: 'restock_blocks' } }, () => {}, [{ entity: piglin, distance: 2.6, visible: true }], false);
  const guard = options.shield_the_charge;
  assert(guard, `offered: ${Object.keys(options).join(', ')}`);
  assert.match(guard.description, /Face the piglin with a spear 3 blocks off with the shield raised, and strike it with the iron sword as it comes within the sword's reach on its run in/);
  assert.match(guard.description, /runs in with the spear raised from as far as ten blocks .* backs off six or seven blocks and comes again; a shield raised facing it a quarter second before takes the hit/);
  assert.match(guard.description, /A spear hit the shield takes knocks the bot nowhere/);
  // Seen, not reckoned at thirteen: 6.7 through the armour worn, the piglin's own blow.
  assert.match(options.fight.description, /^The piglin 3 blocks off hits for about 6\.7 a blow through the armour worn/);
  // The knock over the drop said on every stance that leaves the bot open, the fight saying its own jabs to it.
  for (const [k, o] of Object.entries(options)) {
    if (['fight', 'seal', 'bunker', 'rail_and_fight', 'fight_from_footing'].includes(k)) continue;
    assert.match(o.description, /Open here to the piglin with a spear 3 blocks off: .* the drop 1 block off is into lava 3 blocks down\. So each of its hits that lands here is priced by that fall/, k);
  }
  if (options.rail_and_fight) assert.match(options.rail_and_fight.description, /Walled on the drop side, a spear's knock stops at the wall\./);
  assert.match(options.fight.description, /The drop 1 block off is 1 jab away/);
  // No shield carried: not offered.
  const bare = edgeBot({ shield: false });
  const without = new Survival(bare.bot, { navigate: async () => {} }, { state: { shelters: [] } }).stanceOptions(new Task('t'), {}, () => {}, [{ entity: bare.piglin, distance: 2.6, visible: true }], false);
  assert.equal(without.shield_the_charge, undefined);
});

test('the shield stance faces the spear with the shield up and strikes when it comes to reach; the fight\'s hold facing a mob out of reach raises it too (mid-242-ac-nether-3-fortress-2)', async () => {
  // 05:26:55: the fight stood facing a spear piglin a block below at 3.3 blocks, the shield down, and took its hits.
  const { bot, piglin, activated } = edgeBot({ piglinAt: new Vec3(4.5, 63, 0.5) });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [{ entity: piglin, distance: 4.1, visible: true }];
  const task = new Task('t');
  const fight = survival.stanceOptions(task, {}, () => {}, danger, false).fight;
  assert.equal(await fight.run(), true, 'held, facing it');
  assert.deepEqual(activated, [true], 'the shield up in the off hand while it holds');
  // The shield stance: the piglin gone after a look, so it ends.
  bot._shieldRaised = false; activated.length = 0;
  const guard = survival.stanceOptions(task, {}, () => {}, danger, false).shield_the_charge;
  setTimeout(() => { delete bot.entities[1]; }, 150);
  assert.equal(await guard.run(), true);
  assert(activated.length >= 1, 'raised facing it');
});
