'use strict';
// Note 657: mid-243-ch (25581), a fortress crossing on 2026-09-29, no rods
// yet, full iron but golden boots, an iron sword and a shield. At 03:33:39Z
// it chose close_in at three blazes 11 to 13 blocks off behind the walls;
// the walk went for the nearest (out of sight) and on past one that came
// into sight nearer (9.2 off at 03:33:44), in under it. At 03:33:47 a
// fireball set it alight at 20 health; the fire's reflex took the turn from
// the close-in, body_way offered the cauldron and burning out with nothing
// said of the blaze 2.3 blocks off behind it, and the cauldron's steps on
// the rim ran five seconds while that blaze struck it at the back a second
// apart, six blows of about 3.4, from 17.6 to none. Nothing turned it to
// the blaze. test/fixtures/crossing-blazes-mid-243-ch.json is the crossing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const { Task } = require('../src/skills');

const CROSSING = require('./fixtures/crossing-blazes-mid-243-ch.json');
const KIT = [['iron_sword', 1], ['iron_pickaxe', 1], ['cauldron', 1], ['water_bucket', 1], ['bucket', 9], ['netherrack', 128], ['coal', 128], ['iron_ingot', 9], ['stone_axe', 1]];
const WORN = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'];
function crossingBot({ at, yaw = 0, health = 20, blazes }) {
  const bot = groundBot(CROSSING, { at, health, dimension: 'the_nether', worn: WORN, held: 'iron_sword', items: KIT,
    mobs: blazes.map(([id, x, y, z]) => ({ id, name: 'blaze', at: new Vec3(x, y, z), height: 1.8, width: 0.6 })) });
  // The cauldron it put down after it was asked was not there yet.
  bot.changed.set('-167,57,505', 'air');
  bot.entity.yaw = yaw;
  bot.inventory.slots[45] = { name: 'shield' };
  return bot;
}

// 03:33:47.68Z, as body_way was asked: alight at 17.3, facing north (yaw
// -0.077) at the blazes at the crossing, the third 2.3 off behind it.
function alightBot() {
  const bot = crossingBot({ at: new Vec3(-166.65, 57, 506.2), yaw: -0.077, health: 17.3,
    blazes: [[24104, -168.08, 58.78, 507.32], [24105, -166.21, 57, 501.3], [24103, -163.94, 57.61, 501.3]] });
  bot.entity.metadata = [1];
  bot._alightUntil = Date.now() + 4600;
  return bot;
}

test('alight with a blaze at arm\'s length behind it, the body is told of its blows and offered to turn and strike it (mid-243-ch, note 657)', t => {
  const vitals = require('../src/vitals');
  // The fire left is read against the clock: held still, so a loaded
  // machine's lost half second does not turn five seconds into four.
  const at = Date.now(); t.mock.method(Date, 'now', () => at);
  const bot = alightBot();
  const blows = vitals.blowsAtBody(bot);
  assert.ok(blows, 'the blaze 2.3 off is at arm\'s length');
  assert.deepEqual(blows.mobs.map(k => k.id), [24104]);
  assert.ok(blows.mobs[0].behind && blows.mobs[0].off >= 120, `off ${blows.mobs[0].off}`);
  assert.match(blows.says, /the blaze 2\.\d blocks off, behind the bot \(1\d\d degrees from where it faces\): a blaze swings instead of shooting once within two blocks, and it keeps closing: 6 a blow before armour, about 3\.\d through the armour worn, a blow a second, each blow knocking the body back/);
  assert.match(blows.says, /A raised shield takes only what comes from the half in front of where the bot faces, so nothing from behind/);
  const ways = vitals.fireWays(bot, new Task('t'));
  assert.ok(ways.set_down_cauldron, `offered: ${Object.keys(ways)}`);
  assert.ok(ways.strike_at_arm, `offered: ${Object.keys(ways)}`);
  assert.match(ways.strike_at_arm.description, /^Over the next 5 seconds this way: about [\d.]+ health, 1 blow \([\d.]+\) and [\d.]+ of fire, from 17\.3\. Turn to the blaze 2\.\d blocks off, behind the bot, and strike it with the iron sword: it has 20 health, about 4 swings, about 3\.6 seconds/);
  // The cauldron says what the blows come to while it is set down and stepped into, and that a blow stops its steps.
  assert.match(ways.set_down_cauldron.description, /In its about 1\.5 seconds, about 1 blow from the blaze 2\.\d blocks off, about 3\.\d health through the armour worn, each knocking the body back; and after it the blaze is still there, a blow a second, until something turns to it\. A blow knocks the body off the rim or out of line with the bowl: the steps stop at the first blow that lands and the way is asked again\. The 1\.5 seconds were measured with nothing striking; the blows come a second apart, so one is due before the steps are done/);
  // Every way over the same five seconds (the fire left): the cauldron lets the blows land, the strike ends them.
  assert.match(ways.set_down_cauldron.description, /^Over the next 5 seconds this way, if nothing turns to the blaze: about 18\.5 health, 5 blows \(17\) and 1\.5 of fire, from 17\.3: more than the bot has\. /);
  assert.match(ways.burn_out.description, /^Over the next 5 seconds this way, if nothing turns to the blaze: about 21\.[56] health, 5 blows \(17\) and 4\.[56] of fire, from 17\.3: more than the bot has\. /);
  assert.match(ways.strike_at_arm.description, /^Over the next 5 seconds this way: about (8|7\.9) health, 1 blow \(3\.4\) and 4\.[56] of fire, from 17\.3\. .*Killed, it strikes no more and drops a rod about half the time/);
  // Note 1018: the ways the next seconds leave the bot alive come before the ways they do not.
  const order = Object.keys(ways), last = k => /more than the bot has/.test(ways[k].description);
  assert.ok(order.indexOf('strike_at_arm') < order.indexOf('burn_out') && last('burn_out') && !last('strike_at_arm'), order.join(', '));
  assert.ok(order.slice(order.findIndex(last)).every(last), order.join(', '));
  // The burn out is still there, the old order's fallback.
  assert.ok(ways.burn_out);
});

test('body_way says the blows at arm\'s length, and after a blow stopped the cauldron\'s steps, that it stopped (note 657)', async () => {
  const body = require('../src/body');
  const bot = alightBot();
  let asked = null;
  const decide = async (id, q) => { asked = q; return { path: ['set_down_cauldron'] }; };
  const ways = { burn_out: { description: 'burn', run: async () => false },
    set_down_cauldron: { description: 'cauldron', run: async () => { bot._blowAt = Date.now() + 1; bot._blowBy = 'blaze'; await new Promise(r => setTimeout(r, 5)); return false; } } };
  const r = await body.answer(bot, new Task('t'), 'fire', ways, { client: {}, decide, facts: { inFire: false } });
  assert.equal(r.key, 'set_down_cauldron');
  assert.match(asked.state.atArmsLength, /At arm's length now: the blaze 2\.\d blocks off, behind the bot/);
  assert.equal(asked.state.lastWay, undefined);
  await body.answer(bot, new Task('t'), 'fire', ways, { client: {}, decide, facts: { inFire: false } });
  assert.match(asked.state.lastWay, /^set down cauldron was chosen 0(\.\d)? seconds ago and stopped 0(\.\d)? seconds in: a blow from the blaze at arm's length knocked the body back\.$/);
});

test('the cauldron\'s steps in stop at a blow and let go of the keys (note 657)', async () => {
  const cauldron = require('../src/cauldron');
  const bot = alightBot();
  const released = [];
  bot.clearControlStates = () => released.push('clear');
  const plan = { cell: new Vec3(-167, 57, 505), from: new Vec3(-167, 57, 506), d: [0, -1] };
  const since = Date.now();
  bot._blowAt = since + 1;
  await new Promise(r => setTimeout(r, 5));
  const motion = require('../src/motion'), move = motion.move;
  let moved = 0;
  motion.move = async () => { moved++; };
  try { assert.equal(await cauldron.stepIn(bot, new Task('t'), plan, () => {}, since), false); }
  finally { motion.move = move; }
  assert.equal(moved, 0, 'no hop onto the rim after the blow');
  assert.ok(released.length);
  assert.equal(cauldron.struck(bot, Date.now()), false, 'a blow before the way began does not stop it');
});

test('close_in and the charge say the blaze behind the cell they strike from (03:33:39Z, note 657)', () => {
  const stand = require('../src/blaze-stand');
  const danger = require('../src/danger');
  // At the foot of the stair east of the crossing, the three at the crossing behind the walls.
  const bot = crossingBot({ at: new Vec3(-156.53, 51, 505.41), yaw: 2.83,
    blazes: [[24103, -165.51, 57, 503.43], [24104, -168.08, 57, 507.32], [24105, -166.3, 57, 503.78]] });
  const target = bot.entities[24103];
  const says = stand.behindAtStrike(bot, target, Object.values(bot.entities));
  // Round by the corridor the bot took, in under the blaze at (-169, 57, 507).
  assert.match(says, /^ The walk there, 3\d steps as the ground stands, passes within arm's length of the blaze now at \(-169, 57, 507\) \(1\.9 blocks from its nearest cell, 3\d steps in\)/);
  assert.match(says, /a blaze within two blocks swings instead of shooting, 6 a blow before armour, a blow a second, and one walked past is left behind the bot\./);
  assert.match(says, / Where the bot strikes that one from, \(-167, 5\d, 50\d\), facing it: the blaze now at \(-169, 57, 507\), 2\.\d blocks from that cell, is behind the bot \(1\d\d degrees from where it faces\); its fireballs come at the back, where a shield raised toward the one struck does not face\.$/);
  const options = stand.blazeStands(bot, danger.threats(bot, 24), { hunted: true });
  assert.ok(options.close_in, `offered: ${Object.keys(options)}`);
  assert.match(options.close_in.description, /passes within arm's length of the blaze now at \(-169, 57, 507\).*is behind the bot/);
  assert.match(options.charge_nearest.description, /passes within arm's length of the blaze now at \(-169, 57, 507\).*is behind the bot/);
  // A lone blaze has nothing behind it.
  assert.equal(stand.behindAtStrike(bot, target, [target]), '');
});

// The close-in run over the crossing: the walk moves the bot half a block a
// look toward its goal's z (the corridor at x -167 runs north), and at the
// look `appear` names, a blaze comes (flies in from out of sight).
async function closeInRun({ at, blazes, appear, stepsFirst = 12 }) {
  const stand = require('../src/blaze-stand');
  const bot = crossingBot({ at, yaw: 0, blazes });
  const walks = [], struck = [];
  const combat = require('../src/combat'), strike = combat.strike;
  combat.strike = async (b, task, e) => { struck.push(e.id); };
  let looks = 0;
  const navigate = async (b, task, goal, opts) => {
    walks.push({ goal: new Vec3(goal.x, goal.y, goal.z), from: b.entity.position.clone() });
    for (let i = 0; i < (walks.length === 1 ? stepsFirst : 12); i++) {
      const p = b.entity.position;
      b.entity.position = p.offset(0, 0, Math.sign(goal.z + 0.5 - p.z) * 0.5);
      if (++looks === appear?.at) { const [id, x, y, z] = appear.blaze; b.entities[id] = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: [] }; }
      if (opts.stopWhen?.()) return;
    }
  };
  try { await stand.closeIn(bot, new Task('t'), {}, () => {}, { navigate, seconds: 1.5, stallMs: 5000 }); }
  finally { combat.strike = strike; }
  return { bot, walks, struck };
}

test('the close-in walk stops for another blaze in sight come within the sword\'s reach, and strikes it (note 657)', async () => {
  // Going at the blaze in sight at the crossing up the corridor, when the one
  // over the corridor comes in: the walk stops under it and strikes it, not
  // walked on past with it at the back.
  const { walks, struck } = await closeInRun({ at: new Vec3(-166.5, 57, 512.5), blazes: [[24105, -166.3, 57, 503.78]], appear: { at: 1, blaze: [24104, -168.08, 59.2, 507.32] } });
  assert.ok(walks[0].goal.z <= 505, `went at the one at the crossing: ${walks[0].goal}`);
  assert.equal(struck[0], 24104, `struck: ${struck}`);
});

test('the close-in gives up a target out of sight for a blaze come into sight nearer (03:33:44Z, note 657)', async () => {
  // The target at the crossing behind the wall; the one over the corridor
  // comes into sight nearer after the first steps (the walk cut short).
  const stand = require('../src/blaze-stand');
  const { bot, walks, struck } = await closeInRun({ at: new Vec3(-166.5, 57, 514.5), blazes: [[24103, -163.94, 57.61, 501.3]], appear: { at: 1, blaze: [24104, -168.08, 59.2, 510.32] }, stepsFirst: 1 });
  assert.ok(walks.length >= 2, `walks: ${walks.length}`);
  const cells = stand.strikeCells(bot, bot.entities[24104]).map(c => `${c}`);
  assert.ok(cells.includes(`${walks[1].goal}`), `second walk to ${walks[1].goal}, struck ${struck}`);
  assert.ok(struck.includes(24104), `struck: ${struck}`);
});
