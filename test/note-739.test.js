'use strict';
// Note 739: two deferred items from note 732 (its own text: "these want
// their own read of the fortress-record plumbing (state.found,
// state.approach.found, state.fortressAt) to find where the two copies
// diverge") and stay_in_fortress's own text never weighing its pacing
// against the nearest unwalked branch. Read from artifacts/critic/
// critic-20260930T0839Z.md items 1 and 2, confirmed against
// scripts/trials/recent.js and .bot-state/flight/*.jsonl for 25595
// (mid-242-vh, 08:34-08:40Z) and 25588 (mid-242-we-fortress-1, 08:30-
// 08:39Z), both 2026-09-30.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

// ---------------------------------------------------------------------------
// Item 1 — 25595: the anchor was replaced, not kept, as the nearest visible
// brick moved between distant, disjoint parts of the one fortress
// ((-106,66,93), then (-70,37,140), then (-98,66,103)), each replacement
// read by fortress_leg, fortress_approach and rung_progress as a new find
// in the same second. A region holds one fortress or one bastion, never
// both (nether-regions.js): fortressAnchor and sameFortress now keep the
// one anchor when the new bricks are in the anchor's own known region,
// however far beyond its measured extent or unlinked by any chain of seen
// bricks.
test('25595 (note 739): the fortress\'s anchor is kept, not replaced, across bricks far beyond its extent but in its own region', () => {
  const mh = require('../src/mob-hunt');
  const state = {};
  const first = mh.fortressAnchor(state, [new Vec3(-106, 66, 93)], new Vec3(-106, 66, 93));
  assert.deepEqual([first.x, first.y, first.z], [-106, 66, 93]);
  const firstAt = state.fortressAt.firstAt;
  // 59 blocks off in x/z and 29 in y: far past SAME_FORTRESS (32) and past
  // any link a handful of seen bricks could chain, but the same 432-block
  // region (regionOf(-106,93) === regionOf(-70,140), both rx -1, rz 0).
  const second = mh.fortressAnchor(state, [new Vec3(-70, 37, 140)], new Vec3(-70, 37, 140));
  assert.deepEqual([second.x, second.y, second.z], [-106, 66, 93], 'kept, not replaced by the far brick');
  assert.equal(state.fortressAt.firstAt, firstAt, 'the same record, not a new one');
  const third = mh.fortressAnchor(state, [new Vec3(-98, 66, 103)], new Vec3(-98, 66, 103));
  assert.deepEqual([third.x, third.y, third.z], [-106, 66, 93], 'still the one anchor on a third, closer brick');
  // Read by both: fortress_leg, fortress_approach and rung_progress all
  // consult sameFortress or fortressAt directly, so a region match here
  // is what stops them pulling toward three different points.
  assert(mh.sameFortress(state, { x: -70, z: 140 }, { x: -98, z: 103 }), 'two far places of the one fortress read as the same one');
  // A truly different fortress (a different region) is still a new anchor.
  const other = mh.fortressAnchor(state, [new Vec3(500, 66, 500)], new Vec3(500, 66, 500));
  assert.deepEqual([other.x, other.y, other.z], [500, 66, 500], 'a different region is a different fortress');
});

// ---------------------------------------------------------------------------
// Item 2(a) — 25588, 08:32:31-08:33:14Z: "Leaving the fortress at
// (-115,74,178) for now, 3 blocks off" (fortress-hold.js's leave, chosen
// from an option that said the nearest brick 39 blocks off), then "1 blocks
// off" 21 seconds later, then "A fortress! I'm heading for it." — the same
// fortress, in use, announced as a new find. Two parts: leave() now reports
// the same point the option (reachSays) measured, `target`, not the far
// anchor; and narration does not say "A fortress!" again for a fortress
// already announced (by the anchor's own firstAt).
test('25588 (note 739): the leave chat says the same distance reachSays said for the option just chosen, not the anchor\'s own', () => {
  const hold = require('../src/fortress-hold');
  const said = [];
  const bot = { entity: { position: new Vec3(0, 74, 0) }, chat: m => said.push(m), inventory: { items: () => [] } };
  const goal = {};
  // The anchor is the fortress's own kept point, far from here; the target
  // is the nearest brick actually asked about, close by (as a large
  // fortress's nearest visible brick can be far from where it was first
  // found and anchored).
  const anchor = { x: -115, y: 74, z: 178 }, target = { x: 3, y: 74, z: 0 };
  const says = hold.reachSays(bot, goal, { target, anchor });
  const across = Number(says.match(/is (\d+) blocks across/)[1]);
  hold.leave(bot, {}, { anchor, target, left: [], save: () => {} });
  const off = Number(said.at(-1).match(/for now, (\d+) blocks off/)[1]);
  assert.equal(off, across, `the option said ${across} blocks across, the leave should say the same, not the anchor's own distance: ${said.at(-1)}`);
  assert.match(said.at(-1), /^Leaving the fortress at \(-115, 74, 178\) for now, \d+ blocks off\. Searching on for another\.$/);
  // Without a target passed (an older call site), the anchor is still the
  // fallback: no caller is broken by the new parameter.
  const said2 = [];
  hold.leave({ ...bot, chat: m => said2.push(m) }, {}, { anchor, left: [], save: () => {} });
  assert.match(said2.at(-1), /^Leaving the fortress at \(-115, 74, 178\) for now, \d+ blocks off\. Searching on for another\.$/);
});

// ---------------------------------------------------------------------------
// Item 2(a), continued — narration does not re-announce a fortress already
// found this trial (note 725 fixed this for exploration.js's landmark
// notice; this is the gap it left in narration.js's own ambient line).
test('25588 (note 739): "A fortress! I\'m heading for it." is said once for a fortress\'s find, not again while it is still the one in use', () => {
  const narration = require('../src/narration');
  const goal = { fortressSearch: { fortressAt: { x: -115, y: 74, z: 178, firstAt: 1000 } } };
  const bot = { chat() {} };
  const step = { action: 'find_fortress', found: { x: -115, y: 74, z: 178 }, fortress: { x: -115, y: 74, z: 178, firstAt: 1000 }, legs: 4 };
  // Fresh: not yet announced this trial.
  assert.equal(narration.stepLine(goal, step, null, null, bot), "A fortress! I'm heading for it.");
  // Announced (as narrate() itself would record after speaking it): the
  // same fortress, still in view a moment later, is not said again.
  goal.narrated = { fortressFirstAt: 1000 };
  assert.equal(narration.stepLine(goal, step, null, null, bot), null, 'the same fortress, already announced, says nothing new here');
  // A genuinely different fortress (a different firstAt) is announced.
  const other = { action: 'find_fortress', found: { x: 40, y: 70, z: 40 }, fortress: { x: 40, y: 70, z: 40, firstAt: 2000 }, legs: 9 };
  assert.equal(narration.stepLine(goal, other, null, null, bot), "A fortress! I'm heading for it.");
  // Legacy: a step with no `fortress` field (the spawner-wait fallback,
  // note 732) still announces as before; nothing here withholds it just
  // because narration has seen some other fortress announced.
  const legacy = { action: 'find_fortress', found: { x: -143, y: 69, z: 141 }, legs: 6 };
  assert.equal(narration.stepLine(goal, legacy, null, null, bot), "A fortress! I'm heading for it.");
});

// The full narrate() path: two consecutive announcements of the one
// fortress, with an unrelated action in between (which resets stepKey's own
// dedup), are not both spoken.
test('25588 (note 739): narrate() itself speaks a fortress\'s find once, even across an interleaved unrelated step', () => {
  const narration = require('../src/narration');
  const said = [];
  const bot = { chat: m => said.push(m) };
  const goal = { fortressSearch: { fortressAt: { x: -115, y: 74, z: 178, firstAt: 5000 } } };
  goal.step = { action: 'find_fortress', found: { x: -115, y: 74, z: 178 }, fortress: { x: -115, y: 74, z: 178, firstAt: 5000 }, legs: 4 };
  narration.narrate(bot, goal, { now: 1 });
  assert.deepEqual(said, ["A fortress! I'm heading for it."]);
  // An unrelated step in between resets stepKey's dedup key.
  goal.step = { action: 'mine', count: 3, block: 'netherrack' };
  narration.narrate(bot, goal, { now: 20000 });
  // Back to the same fortress: stepKey alone would allow it again, but the
  // fortress's own firstAt has already been announced.
  goal.step = { action: 'find_fortress', found: { x: -115, y: 74, z: 178 }, fortress: { x: -115, y: 74, z: 178, firstAt: 5000 }, legs: 5 };
  narration.narrate(bot, goal, { now: 40000 });
  assert.equal(said.filter(s => s === "A fortress! I'm heading for it.").length, 1, `said: ${JSON.stringify(said)}`);
});

// ---------------------------------------------------------------------------
// Item 2(c) — 25588, 08:37:15Z: stay_in_fortress was chosen while its own
// text said three minutes of walking back and forth with no spawner seen,
// and unwalked_1 sat 13 blocks off with one block to dig. stay_in_fortress
// now says what the pacing gains (nothing new) against the nearest
// unwalked branch's own distance and cost, when both are on offer.
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
// A fortress corridor: a floor of nether bricks at y 64 from x 0 to `length`
// and z -1 to 1, open at both ends over the lava sea. `extra` names blocks
// of its own first (null for the rule's own).
function corridor({ length = 40, extra = () => undefined } = {}) {
  const floor = p => p.y === 64 && p.z >= -1 && p.z <= 1 && p.x >= 0 && p.x <= length;
  const rock = p => { const e = extra(p); return e !== undefined ? e : p.y <= 31 ? 'lava' : floor(p) ? 'nether_bricks' : null; };
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
function walker(bot, walks, refuse = () => null) {
  return async (b, t, g, o = {}) => {
    walks.push({ x: g.x, y: g.y, z: g.z, onFoot: !!o.onFoot });
    const why = refuse(g);
    if (why) throw new Error(why);
    bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5);
  };
}
test('25588 (note 739): stay_in_fortress says what the pacing gains against the nearest unwalked branch\'s own distance and cost', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  // A long corridor walked most of the way (far enough for cells twelve or
  // more steps off, so stay_in_fortress is on offer at all), with a gap
  // near its end that leaves floors past it unwalked and unjoined.
  const { bot } = corridor({ length: 60, extra: p => p.y === 64 && (p.x === 30 || p.x === 31) ? null : undefined });
  const goal = { fortressSearch: { axis: 1, legs: 15 } };
  const walks = [];
  const refused = g => g.x >= 32 ? 'No route from here to (33, 65, 0) (noPath): the way passes along a drop that would kill' : null;
  const client = jevStub(['stay_in_fortress', 'unwalked_1']);
  const actions = { client, dig: async () => {}, navigate: walker(bot, walks, refused), tunnel: async () => {} };
  for (let i = 0; i < 40 && !client.asked.length; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const { options } = client.asked[0];
  assert(options.stay_in_fortress, 'stay_in_fortress is on offer, walked area far enough off');
  assert(options.unwalked_1, 'an unwalked branch is on offer beside it');
  assert.match(options.stay_in_fortress, /no spawner has been seen/);
  assert.match(options.stay_in_fortress, /Against staying: unwalked_1 is \d+ blocks off with .*; staying re-walks the \d+ of the \d+ floors seen walked already, nothing past what has already been seen there\.$/);
});
