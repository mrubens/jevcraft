'use strict';
// Note 739b: arrival is arrival. The coordinator's own addition to note 739
// (artifacts/critic newest reports, items 2-4): find_fortress's "found"
// target equals the bot's own cell once arrived, so a stall's own leg
// toward it is a crossing to itself and the stall never clears — 25590 and
// 25588 (~09:00Z) chatted "I know where the fortress is ... but I'm not
// getting any closer" while standing on the fortress's own bricks; 25583
// (mid-242-vh, 08:57-09:02Z) had stillness_detour pick cross_toward "the
// fortress search's leg, 3 blocks off" four times while inside the
// fortress with blazes near, and fortress_leg sent it back to "blazes seen
// at (-139,74,96)" where it had been at 08:55.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

// ---------------------------------------------------------------------------
// legTarget/netherAnswers (src/nether-travel.js): standing on or among a
// found fortress's own bricks (state.inFortressSince) is arrival, not a leg
// still under way. A stall's "cross_toward" is not offered toward the
// bot's own found point once arrived; away from it (still approaching),
// the same crossing is offered as before.
test('note 739b: a stall\'s cross_toward is not offered toward a found fortress once arrived, only while still approaching it', () => {
  const { netherAnswers } = require('../src/nether-travel');
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 39, 0.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] },
    blockAt: p => { const name = p.y <= 31 ? 'lava' : p.y === 38 && p.x <= 0 ? 'netherrack' : 'air'; return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p }; },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {}, equip: async () => {}, lookAt: async () => {}, placeBlock: async () => {} });
  const target = { x: 60, y: 39, z: 0 };
  // Still approaching: found is a real leg's own target, offered as before.
  const approaching = { survival: {}, step: { action: 'find_fortress', found: target }, fortressSearch: {} };
  assert(netherAnswers(bot, new Task('stall'), approaching, () => {}).cross_toward, 'offered while still approaching');
  assert.match(netherAnswers(bot, new Task('stall'), approaching, () => {}).cross_toward.description, /the fortress search's leg/);
  // Arrived: the same `found` is wherever the bot already stands (or a
  // brick right beside it), and is not offered as a leg to cross to.
  const arrived = { survival: {}, step: { action: 'find_fortress', found: target }, fortressSearch: { inFortressSince: Date.now() - 5000 } };
  assert.equal(netherAnswers(bot, new Task('stall'), arrived, () => {}).cross_toward, undefined, 'not offered once arrived');
  // The fortress search's own leg target (goal.fortressSearch.target, the
  // sweep's own aim before anything is found) is likewise not offered as a
  // leg while arrived -- it should not be set then, but the guard holds
  // either way.
  const arrivedWithTarget = { survival: {}, step: {}, fortressSearch: { inFortressSince: Date.now() - 5000, target } };
  assert.equal(netherAnswers(bot, new Task('stall'), arrivedWithTarget, () => {}).cross_toward, undefined, 'not offered once arrived, even with a stray leg target');
});

// ---------------------------------------------------------------------------
// stillness.js stepWait: once state.inFortressSince is set the bot is
// standing on the fortress's own floors, whatever a stall's own escalation
// has since renamed the step to; the unchanged-passes count does not read
// that as "no measurable progress" either.
test('note 739b: stillness stepWait excuses any step while state.inFortressSince is set, not only a bare find_fortress step', () => {
  const { stepWait } = require('../src/stillness');
  const bot = { entity: { position: new Vec3(-72, 66, 144) }, health: 20, food: 20 };
  // A stray cross_toward left over from the very bug this note fixes: even
  // if one is asked (a race, an older saved goal), being at a known
  // fortress excuses it exactly as find_fortress itself already was.
  const goal = { step: { action: 'cross_toward', target: { x: -72, y: 66, z: 144 } }, fortressSearch: { inFortressSince: Date.now() - 30000 } };
  assert.equal(stepWait(bot, goal), 'at a known fortress');
  // Away from any fortress, an ordinary cross_toward stall is not excused.
  const away = { step: { action: 'cross_toward', target: { x: -72, y: 66, z: 144 } }, fortressSearch: {} };
  assert.equal(stepWait(bot, away), null);
});

// ---------------------------------------------------------------------------
// mob-hunt.js findFortressStep: a fortress once found and stood in keeps
// its own bricks a few seconds through a look that happens to catch too
// few of them (turned toward a wall, down a bare corridor), instead of the
// whole "Inside" branch being skipped for that one look and falling
// through to the blind sweep's fortress_leg tree.
function netherWorld(position, solid, items = [{ name: 'netherrack', count: 64, type: 1 }]) {
  const dug = new Set(), laid = new Set();
  const at = p => {
    const key = `${p}`;
    const name = laid.has(key) ? 'netherrack' : dug.has(key) ? null : solid(p);
    return { name: name || 'air', boundingBox: name && name !== 'lava' ? 'block' : 'empty', diggable: name !== 'bedrock', position: p, digTime: () => 400 };
  };
  let look = null;
  const controls = {};
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position }, entities: {}, world: { raycast: () => null },
    inventory: { items: () => items }, findBlocks: () => [], chat() {}, blockAt: at, equip: async () => {}, lookAt: async p => { look = p; },
    placeBlock: async (ref, face) => { const p = ref.position.plus(face); laid.add(`${p}`); items[0].count--; },
    dig: async block => { dug.add(`${block.position}`); },
    setControlState: (name, on) => { controls[name] = on; if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, Math.floor(bot.entity.position.y), Math.floor(look.z) + 0.5); },
    getControlState: name => !!controls[name], clearControlStates() {} };
  return { bot, dug, laid };
}
function findIn(bot, box) {
  return ({ matching, maxDistance = 128, count = 1 }) => {
    const ids = new Set(Array.isArray(matching) ? matching : [matching]), here = bot.entity.position, out = [];
    for (let x = box.x[0]; x <= box.x[1]; x++) for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
      const p = new Vec3(x, y, z), b = bot.blockAt(p);
      if (ids.has(registry.blocksByName[b.name]?.id) && p.distanceTo(here) <= maxDistance) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(here) - b.distanceTo(here)).slice(0, count);
  };
}
function corridor({ length = 40 } = {}) {
  const floor = p => p.y === 64 && p.z >= -1 && p.z <= 1 && p.x >= 0 && p.x <= length;
  const rock = p => p.y <= 31 ? 'lava' : floor(p) ? 'nether_bricks' : null;
  const world = netherWorld(new Vec3(0.5, 65, 0.5), rock);
  world.bot.findBlocks = findIn(world.bot, { x: [-3, length + 3], y: [58, 69], z: [-6, 6] });
  return world;
}
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => {
    const keys = Object.keys(questions.branch_0.criteria);
    asked.push({ keys, state, options: questions.branch_0.criteria });
    const choice = picks.find(p => keys.includes(p)) || keys[0];
    return { answers: { branch_0: { choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } } };
  } };
}
function walker(bot, walks) {
  return async (b, t, g, o = {}) => { walks.push({ x: g.x, y: g.y, z: g.z, onFoot: !!o.onFoot }); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
}
test('note 739b: a blank look while already inside a found fortress keeps the fortress\'s own tree, not the blind sweep\'s', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = corridor({ length: 20 });
  const goal = { fortressSearch: { axis: 1, legs: 15 } };
  const walks = [];
  const client = jevStub(['stay_in_fortress', 'leg_north']);
  const actions = { client, navigate: walker(bot, walks), tunnel: async () => {} };
  // Walk the whole corridor and reach the point where fortress_leg is
  // asked with nothing left to walk to: the ordinary, working path.
  for (let i = 0; i < 20 && !client.asked.length; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert(client.asked.length, 'fortress_leg was asked');
  assert.match(client.asked[0].options.stay_in_fortress, /^Stay in the fortress/, 'the fortress\'s own tree, arrived');
  assert(goal.fortressSearch.inFortressSince, 'known to be inside');
  // Answer it (staying), then simulate a look that catches nothing at all
  // -- behind a wall, or the raycast finding no bricks this one tick --
  // right after, still well within the five-second cache.
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const realFindBlocks = bot.findBlocks;
  bot.findBlocks = () => [];
  goal.fortressSearch.patrolUntil = Date.now() - 1; // the stay's own minutes are up: ask again at once
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 2, 'asked again, not silently stuck');
  const { options } = client.asked[1];
  assert(options.stay_in_fortress || Object.keys(options).some(k => /^unwalked_|^go_to_spawner|^wait_at_spawner|^back_to_fortress/.test(k)),
    `a blank look kept the fortress's own tree, not the blind sweep: ${Object.keys(options).join(', ')}`);
  assert(!('go_to_blazes' in options) || options.stay_in_fortress, `should not have collapsed to the blind sweep's go_to_blazes alone: ${Object.keys(options).join(', ')}`);
  bot.findBlocks = realFindBlocks;
});
