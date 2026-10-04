'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const eyeBank = require('../src/eye-bank');
const rodStash = require('../src/rod-stash');
const rodBank = require('../src/rod-bank');

function world({ eyes = 12, chest = true } = {}) {
  const items = [{ name: 'ender_eye', count: eyes }, ...(chest ? [{ name: 'chest', count: 1 }] : [])].filter(i => i.count > 0);
  const bot = { game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 18, entities: {}, time: { timeOfDay: 2000 },
    entity: { position: new Vec3(840.5, 64, 1340.5) }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => items, slots: {} },
    blockAt: p => ({ position: p.floored(), name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null }, findBlocks: () => [] };
  const goal = { kind: 'win', endPortal: { center: { x: 604, y: -37, z: 1540 }, neededEyes: 12 }, endKit: { choice: { pick: 'top_up_arrows', at: Date.now() } }, gameProgress: { milestones: { stronghold_located: { at: 1 } } } };
  return { bot, goal, items };
}
const client = answer => { const asked = []; return { asked, systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: answer, confidence: 0.9 }])) }; } }; };

test('before an errand for the End\'s kit the eyes carried are asked of: into a chest here, or on with them; asked once for a count (note 1193)', async () => {
  const { bot, goal } = world();
  const c = client('carry_on');
  assert.equal(await eyeBank.eyesNow(bot, new Task('t'), goal, () => {}, {}, c, { errand: 'for the End\'s kit (arrows)' }), 'carry');
  assert.match(c.asked[0], /Put the 12 eyes of ender in a chest put down here at \(\d+, 64, \d+\), then go on for the End's kit \(arrows\) with nothing of the goal's in the pack/);
  assert.match(c.asked[0], /the portal's ring is 309 blocks from here/);
  assert.match(c.asked[0], /both runs that had their eyes made lost them at Overworld deaths on errands like this one, twelve and eleven/);
  assert.equal(await eyeBank.eyesNow(bot, new Task('t'), goal, () => {}, {}, c), null, 'not asked again for the same count within ten minutes');
  assert.equal(c.asked.length, 1);
  // No eyes, or no chest and no wood for one: not asked.
  const none = world({ eyes: 0 });
  assert.equal(await eyeBank.eyesNow(none.bot, new Task('t'), none.goal, () => {}, {}, client('keep_here')), null);
  const bare = world({ chest: false });
  assert.equal(await eyeBank.eyesNow(bare.bot, new Task('t'), bare.goal, () => {}, {}, client('keep_here')), null);
});

test('put away, the eyes stay in the chest while the errand is in hand, are counted as held, and come out when going to the End is chosen (note 1193)', async () => {
  const { bot, goal, items } = world();
  const stashRods = rodStash.stashRods;
  rodStash.stashRods = async (b, t, g, save, acts, offer) => {
    (g.rodStashes ||= []).push({ position: { x: 841, y: 64, z: 1340 }, dimension: 'overworld', contents: { ender_eye: 12 }, placedAt: new Date().toISOString() });
    // A blaze powder left over stays in the pack: the run is past the early ladder.
    items.splice(0, items.length, { name: 'blaze_powder', count: 1 });
    return true;
  };
  try {
    assert.equal(await eyeBank.eyesNow(bot, new Task('t'), goal, () => {}, {}, client('keep_here'), { errand: 'for the End\'s kit (arrows)' }), 'kept');
  } finally { rodStash.stashRods = stashRods; }
  assert.ok(goal.eyeBank);
  assert.equal(require('../src/eye-need').need(bot, goal).pearlsLeft, 0, 'the eyes in the chest are held');
  assert.equal(rodBank.collectHere(bot, goal), null, 'not taken out while the top-up is in hand');
  goal.endKit.choice = { pick: 'enter_now', at: Date.now() };
  assert.equal(rodBank.collectHere(bot, goal).action, 'collect_rod_stash');
});

test('for the stronghold\'s search the portal\'s twelve may go in a chest and the spare alone be carried: asked before the walk, counted through the search, held until the portal is found (note 1197)', async () => {
  const { bot, goal, items } = world({ eyes: 13 });
  delete goal.endKit; delete goal.gameProgress.milestones.stronghold_located; delete goal.endPortal;
  goal.gameProgress.milestones.nether_entered = { at: 1 };
  goal.strongholdSearch = { bearings: [], throws: 0, moves: 0, visited: {} };
  const c = client('keep_here');
  const stashRods = rodStash.stashRods;
  let keptBack = null;
  rodStash.stashRods = async (b, t, g, save, acts, offer, opts) => {
    keptBack = opts.keepBack;
    (g.rodStashes ||= []).push({ position: { x: 841, y: 64, z: 1340 }, dimension: 'overworld', contents: { ender_eye: 12 }, placedAt: new Date().toISOString() });
    items.find(i => i.name === 'ender_eye').count = 1;
    return true;
  };
  try {
    assert.equal(await eyeBank.eyesNow(bot, new Task('t'), goal, () => {}, {}, c, { errand: 'on the search for the stronghold', keepBack: 1, search: true }), 'kept');
  } finally { rodStash.stashRods = stashRods; }
  assert.deepEqual(keptBack, { ender_eye: 1 });
  assert.match(c.asked[0], /Put 12 of the 13 eyes of ender in a chest put down here at .* and go on the search for the stronghold with 1 in the pack: the search throws only the Eyes above the portal's twelve/);
  assert.match(c.asked[0], /Go on on the search for the stronghold with the 13 eyes of ender in the pack\. Found, the portal is filled with no walk back\./);
  assert.equal(eyeBank.banked(goal), 12);
  assert.equal(eyeBank.held(goal, bot), true);
  assert.equal(rodBank.collectHere(bot, goal), null, 'the twelve stay put through the search');
  // The portal found: they come out.
  goal.gameProgress.milestones.stronghold_located = { at: Date.now() };
  assert.equal(eyeBank.held(goal, bot), false);
  assert.equal(rodBank.collectHere(bot, goal).action, 'collect_rod_stash');
});

test('a chest far off in the Overworld is walked back to a leg at a time, from the surface first, and a leg that fails turns the next to a side (note 1197)', async () => {
  const { bot, goal } = world({ eyes: 1 });
  goal.gameProgress.milestones.stronghold_located = { at: Date.now() };
  goal.eyeBank = { at: Date.now(), chestAt: { x: 0, y: 64, z: 1340 }, forSearch: true };
  goal.rodStashes = [{ position: { x: 0, y: 64, z: 1340 }, dimension: 'overworld', contents: { ender_eye: 12 }, placedAt: new Date().toISOString() }];
  const levels = require('../src/levels'), depthHere = levels.depthHere;
  const calls = [];
  try {
    levels.depthHere = () => 30;
    await rodStash.collect(bot, new Task('t'), goal, () => {}, { navigate: async () => calls.push('walk'), surfaceStep: async () => calls.push('surface') });
    assert.deepEqual(calls, ['surface']);
    assert.equal(goal.step.way, 'up to the surface first');
    levels.depthHere = () => 0;
    const legs = [];
    await rodStash.collect(bot, new Task('t'), goal, () => {}, { navigate: async (b, t, g) => { legs.push([g.x, g.z]); throw new Error('No route (noPath)'); }, surfaceStep: async () => calls.push('surface') });
    await rodStash.collect(bot, new Task('t'), goal, () => {}, { navigate: async (b, t, g) => { legs.push([g.x, g.z]); bot.entity.position = new Vec3(g.x + .5, 64, g.z + .5); }, surfaceStep: async () => {} });
    assert.ok(Math.abs(legs[0][0] - 776.5) <= 1 && Math.abs(legs[0][1] - 1340.5) <= 1, `sixty-four blocks straight at it: ${legs[0]}`);
    assert.ok(Math.abs(legs[1][0] - 799.4) <= 1 && Math.abs(legs[1][1] - 1291.5) <= 1, `the leg after one that failed, turned fifty degrees: ${legs[1]}`);
    assert.equal(goal.rodStashes[0].legsFailed, 0);
    assert.equal(goal.rodStashes[0].contents.ender_eye, 12, 'nothing is written off for a leg that failed');
  } finally { levels.depthHere = depthHere; }
});
