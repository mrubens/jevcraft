'use strict';
// Note 596: mid-208-k-nether-4-fortress-1 (25589), 06:27 to 06:48 on
// 2026-09-28. Off its pillar, the bot stood on a one-wide netherrack ledge at
// y 46, 7.9 health, nothing to eat, with a hoglin two to three blocks below
// on the nylium that never came nearer, never struck and never left.
// encounter_stance was asked 499 times in twenty minutes, fight 467 of them,
// none_good 365: every stance priced the hoglin as at the bot in 0.4 seconds
// (walk-reach began every walker's search from a creeper's three and a half
// blocks, so a hoglin under the ledge "got to" the bot), each fight ended at
// once or stood swinging at nothing (distance 2.98 counted as in reach with
// the ledge's edge between the eye and the hoglin), and was asked again, 350
// times in two and a half minutes and then every seven seconds. A player
// steps to the ledge's end and strikes down: the hoglin cannot strike up.
// The ground is the saved region, read from a copy (test/fixtures).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { walkersApart } = require('../src/walk-reach');
const { strikeStand } = require('../src/strike-below');
const { canStrike } = require('../src/combat');

const ground = require('./fixtures/ledge-hoglin-25589.json');
const EMPTY = /^(air|crimson_roots|warped_roots|crimson_fungus|warped_fungus|weeping_vines|weeping_vines_plant|twisting_vines|twisting_vines_plant|nether_sprouts|fire|soul_fire|lava|water)$/;
function nameAt(x, y, z) {
  const { box, palette, rows } = ground;
  if (x < box.x[0] || x > box.x[1] || y < box.y[0] || y > box.y[1] || z < box.z[0] || z > box.z[1]) return null;
  const row = rows[(y - box.y[0]) * (box.z[1] - box.z[0] + 1) + (z - box.z[0])];
  const c = row.charCodeAt(x - box.x[0]);
  return palette[c >= 97 ? c - 97 : c - 65 + 26];
}
const blockAt = p => {
  const f = p.floored(), name = nameAt(f.x, f.y, f.z);
  if (!name) return null;
  const solid = !EMPTY.test(name);
  return { position: f, name, boundingBox: solid ? 'block' : 'empty', shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [], diggable: solid };
};
// The game's ray, stepped finely: the first full block it enters.
function raycast(from, dir, max) {
  for (let t = 0; t <= max; t += 0.01) {
    const p = from.plus(dir.scaled(t)), b = blockAt(p);
    if (b?.boundingBox === 'block') return { ...b, intersect: p };
  }
  return null;
}
// As recorded at 06:47:06: the bot at the ledge's near end, the hoglin
// (entity 1795) on the nylium two below and two across.
const AT_LEDGE = new Vec3(-38.501672368165316, 46, 65.71967111480403);
const HOGLIN_AT = new Vec3(-38.89972599089484, 44, 67.88736222718367);
function ledgeBot({ at = AT_LEDGE, hoglinAt = HOGLIN_AT, health = 7.9333343505859375 } = {}) {
  const hoglin = { id: 1795, name: 'hoglin', type: 'hostile', position: hoglinAt.clone(), height: 1.4, width: 1.3965, isValid: true };
  const attacks = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 16, oxygenLevel: 20,
    entities: { 1795: hoglin }, time: { timeOfDay: 0 }, registry: require('minecraft-data')('26.1'),
    entity: { position: at.clone(), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, -0.08, 0), eyeHeight: 1.62 },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'sandstone', count: 17 }, { name: 'gravel', count: 16 }, { name: 'crimson_stem', count: 11 }, { name: 'iron_pickaxe', count: 1 }, { name: 'coal', count: 128 }, { name: 'arrow', count: 6 }],
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt, world: { raycast }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} },
    lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: e => attacks.push(e.id),
    clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  const threat = () => ({ entity: hoglin, distance: hoglin.position.distanceTo(bot.entity.position), visible: true });
  return { bot, hoglin, threat, attacks };
}

test('a hoglin two below the ledge has no way to the bot; a creeper there still lights through the floor (walk-reach, note 596)', () => {
  const { bot, threat } = ledgeBot();
  const hog = threat();
  const apart = walkersApart(bot, [hog]);
  assert.ok(apart.ids.has(1795), 'the hoglin is kept off: no ground it walks brings its body within its reach of the bot');
  // A creeper in its place lights within three and a half blocks, floor or
  // no floor: searched with the hoglin, each by its own reach.
  const creeper = { entity: { id: 7, name: 'creeper', position: HOGLIN_AT.offset(0, -1, 0.2), height: 1.7, width: 0.6 }, distance: 3.4, visible: true };
  const both = walkersApart(bot, [hog, creeper]);
  assert.ok(both.ids.has(1795));
  assert.ok(!both.ids.has(7), 'the creeper still gets to the bot');
});

test('from the ledge\'s end, a block on, the sword reaches the hoglin and its blow cannot reach up (the recorded 06:47:06 ground)', () => {
  const { bot, hoglin } = ledgeBot();
  // Where the bot stood, the ledge's own edge is between the eye and it:
  // 2.98 blocks off by distance, no swing to be made.
  assert.equal(canStrike(bot, hoglin), false);
  const stand = strikeStand(bot, hoglin);
  assert.ok(stand);
  assert.deepEqual([stand.cell.x, stand.cell.y, stand.cell.z], [-39, 46, 66]);
  assert.equal(stand.steps, 1);
  assert.equal(stand.below, 2);
  assert.equal(stand.clearance, 0.6);
});

test('the stance question on the recorded 06:47:06 state offers striking from above, the hoglin out of the figures, and the run steps to the edge and strikes', async () => {
  const { bot, threat, attacks } = ledgeBot();
  const moved = [];
  const survival = new Survival(bot, { navigate: async (b, t, goal) => { moved.push([goal.x, goal.y, goal.z]); bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); } }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  const strike = options.strike_from_above;
  assert.ok(strike, `offered: ${Object.keys(options)}`);
  assert.match(strike.description, /^Step 1 block along this ground to \(-39, 46, 66\), crouched, and from there strike down at the hoglin 3 blocks off with the iron sword\. It stands 2 blocks below that ground, its top 0\.6 under the bot's feet there: a mob's blow reaches out from its body sideways and not up \(the game's rule\), so while it stands down there it cannot strike the bot/);
  assert.match(strike.description, /To kill: about 7 swings that land/);
  assert.match(strike.description, /A sword's knockback barely moves a hoglin/);
  assert.match(strike.description, /Any way up to the bot it has goes round, \d+ blocks of walking or more/);
  assert.match(strike.description, /Killed, it drops two to four raw porkchops, now and then leather on its floor 2 blocks below, fetched by going down there \(food: raw porkchop is safe to eat[^)]*\); nothing to eat is carried now\./);
  assert.match(strike.description, /Nothing else here reaches the bot meanwhile: about 0 damage/);
  // Every stance no longer prices the hoglin as at the bot in 0.4 seconds.
  assert.match(options.fight.description, /None of them can get to the bot and none of them shoots/);
  assert.doesNotMatch(options.fight.description, /can be at arm's length in about 0\.4 seconds/);
  // Carried out: the step to the ledge's end, then swings at the hoglin.
  bot._defenseAttackAt = 0;
  const real = Date.now; let t = real();
  Date.now = () => (t += 50);
  try { assert.equal(await strike.run(), true); } finally { Date.now = real; }
  assert.deepEqual(moved, [[-39, 46, 66]]);
  assert.ok(attacks.length >= 1 && attacks.every(id => id === 1795), `struck: ${attacks}`);
});

test('a fight that ends at once without acting is not offered again while nothing changes, and is when the scene does (the 06:27:21 burst; note 659)', async () => {
  // Asked every quarter second, fight answered each time, each run at the
  // hoglin three below finding no way: 350 askings in two and a half minutes.
  const { bot, hoglin, threat } = ledgeBot({ at: new Vec3(-38.5, 46, 63.78), hoglinAt: new Vec3(-38.72, 43, 65.71) });
  const survival = new Survival(bot, { navigate: async () => { throw Object.assign(new Error('No path to the goal!'), { name: 'NoPath' }); } }, { state: { shelters: [] } });
  survival.scoutRetreat = async () => {};
  const trees = [], states = [];
  survival.decide = async (task, goal, save, q) => { trees.push(q.tree); states.push(q.state); return { path: [q.tree.fight ? 'fight' : 'keep_working' in q.tree ? 'keep_working' : Object.keys(q.tree)[0]] }; };
  // Stand in for everything but the fight: the fight runs as it does.
  const build = survival.stanceOptions.bind(survival);
  survival.stanceOptions = (...a) => { const o = build(...a); for (const [k, v] of Object.entries(o)) if (k !== 'fight') v.run = async () => true; return o; };
  // The charge's own refusals aside (the drop beside the ledge), the run
  // at it finds no way.
  survival.charge = async (task, goal, save, nearest) => { bot._unreachable = { ids: [nearest.entity.id], until: Date.now() + 20000 }; return false; };
  await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
  assert.ok(trees[0].fight, 'offered the first time');
  assert.equal(survival.state.stance, undefined, 'the fight failed at once');
  assert.match(survival.state.stanceFailed.at(-1).why, /^nothing was struck, and the run at the hoglin [\d.]+ blocks off found no way to it$/);
  await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
  assert.equal(trees[1].fight, undefined, 'nothing has changed: not offered as if it might end otherwise');
  assert.match(states[1].notOfferedNow[0].why, /^ended here without acting, the last \d+ seconds? ago: nothing was struck, and the run at the hoglin [\d.]+ blocks off found no way to it; nothing has changed here since \(the bot, the mobs and the health as they were\), so it would end the same; offered again when something changes$/);
  // The hoglin walks a block and a half, still below the ledge with no way up
  // to the bot: nothing the fight turns on changed (the stance's scene, note
  // 659), and it is still left out, said so.
  delete survival.state.stance;
  hoglin.position = hoglin.position.offset(1.5, 0, 0);
  await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
  assert.equal(trees[2].fight, undefined, 'a block and a half along below the ledge is the same scene');
  assert.match(states[2].notOfferedNow.find(f => f.choice === 'fight').why, /^came to nothing once in this same scene, the last \d+ seconds? ago: nothing was struck, and the run at the hoglin [\d.]+ blocks off found no way to it; nothing a stance turns on has changed since \(sameSceneSoFar\), so it would come to the same; offered again when the scene changes$/);
  assert.match(states[2].sameSceneSoFar, /the hoglin unable to get to the bot, in sight/);
  // A heart of health gone: the scene changed, and the fight is offered.
  delete survival.state.stance;
  bot.health -= 2.5;
  await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
  assert.ok(trees[3].fight, 'offered again once the scene has changed');
  assert.equal(states[3].notOfferedNow, undefined);
});

// Timed: on the old code the fight's second of swinging at nothing never
// ends under the stubbed clock.
test('a fight held to its end with nothing struck, nothing changed, is a fight that failed: asked once, not every seven seconds (06:29 to 06:48)', { timeout: 20000 }, async () => {
  const { bot, threat } = ledgeBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.scoutRetreat = async () => {};
  // As recorded: the fight whenever it is offered.
  const asked = [];
  survival.decide = async (task, goal, save, q) => { asked.push(Object.keys(q.tree)); return { path: [q.tree.fight ? 'fight' : 'keep_working' in q.tree ? 'keep_working' : 'strike_from_above' in q.tree ? 'strike_from_above' : Object.keys(q.tree)[0]] }; };
  const build = survival.stanceOptions.bind(survival);
  // Everything but the fight stands in; the fight runs as it does, its
  // charge refused beside the drop as the charge refuses it.
  survival.stanceOptions = (...a) => { const o = build(...a); for (const [k, v] of Object.entries(o)) if (k !== 'fight') v.run = async () => true; return o; };
  const real = Date.now, t0 = real();
  let fights = 0;
  try {
    for (let s = 0; s <= 60; s += 1) {
      Date.now = () => t0 + s * 1000;
      await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false);
      if (survival.state.stance?.choice === 'fight' && survival.state.stance.at === t0 + s * 1000) fights++;
    }
  } finally { Date.now = real; }
  // The fight here swings at nothing: before, "in reach" at 2.98 blocks by
  // distance, it stood its seconds and was chosen again, eight a minute.
  assert.equal(fights, 1, `chosen ${fights} times in a minute: ${asked.map(a => a.includes('fight')).join(',')}`);
  assert.ok(asked.length >= 2 && !asked.at(-1).includes('fight'));
  assert.ok(asked.at(-1).includes('strike_from_above'), 'the way to strike it is on offer');
});
