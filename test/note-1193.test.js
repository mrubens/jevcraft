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
