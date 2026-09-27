'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { deflect, meleeClose } = require('../src/projectile-guard');
const { Task } = require('../src/skills');

const fixture = entities => {
  const controls = {};
  return { entity: { position: new Vec3(0.5, 14, 0.5), height: 1.8 }, entities, time: { timeOfDay: 18000 }, world: { raycast: () => null },
    inventory: { slots: { 45: { name: 'shield' } } }, pathfinder: { setGoal() {} }, clearControlStates() {}, lookAt: async () => {},
    activateItem() { controls.shield = true; }, deactivateItem() { controls.shield = false; }, controls };
};
const mob = (id, name, x, z) => ({ id, name, type: 'hostile', position: new Vec3(x, 14, z), height: 1.9, isValid: true });
const arrow = { id: 9, name: 'arrow', position: new Vec3(0.5, 15.5, 4.5), velocity: new Vec3(0, 0, -1), isValid: true };

test('an arrow is blocked when nothing is at arm\'s length, and not with a zombie beside the bot', async () => {
  const shot = fixture({ 1: mob(1, 'skeleton', 0.5, 12.5), 9: arrow });
  assert.equal(meleeClose(shot), false);
  assert.equal(await deflect(shot, new Task('guard'), { holdMs: 50 }), true, 'a skeleton across the cave: face the arrow');
  const cornered = fixture({ 1: mob(1, 'skeleton', 0.5, 12.5), 2: mob(2, 'zombie', 2.0, 0.5), 9: arrow });
  assert.equal(meleeClose(cornered), true);
  assert.equal(await deflect(cornered, new Task('guard'), { holdMs: 50 }), false, 'the zombie hitting the bot comes before the skeleton shooting at it');
});

test('on a one-wide span over a drop the bot does not turn to an arrow: the turn is a turn on the span', async () => {
  // mid-215-e was turned about on its span over the lava sea and walked off the far end (note 273).
  const bot = fixture({ 1: mob(1, 'skeleton', 0.5, 12.5), 9: { ...arrow, _seenAt: undefined } });
  let looked = 0; bot.lookAt = async () => { looked++; };
  bot.blockAt = p => Math.floor(p.y) === 13 && Math.floor(p.z) === 0 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  assert.equal(await deflect(bot, new Task('guard'), { holdMs: 50 }), false);
  assert.equal(looked, 0);
  bot._spanning = { since: Date.now() };
  bot.blockAt = p => Math.floor(p.y) === 13 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  assert.equal(await deflect(bot, new Task('guard'), { holdMs: 50 }), false, 'nor while a span is being laid');
  bot._spanning = null;
  assert.equal(await deflect(bot, new Task('guard'), { holdMs: 50 }), true, 'on wide ground the shield comes up');
});

test('a creeper that would light while the shield is held comes before the arrow', async () => {
  // mid-226-b: the shield turned to a skeleton's arrows while a creeper four blocks off walked in.
  const near = fixture({ 1: mob(1, 'skeleton', 0.5, 12.5), 2: mob(2, 'creeper', 4.5, 0.5), 9: arrow });
  assert.equal(meleeClose(near), true);
  assert.equal(await deflect(near, new Task('guard'), { holdMs: 700 }), false, 'the creeper walks to its lighting distance within the hold');
  const far = fixture({ 1: mob(1, 'skeleton', 0.5, 12.5), 2: mob(2, 'creeper', 12.5, 0.5), 9: arrow });
  assert.equal(meleeClose(far), false, 'twelve blocks off it is seconds from lighting');
});

test('an arrow stuck in the ground is not a shot: the shield comes up for a still one only in its first second', async () => {
  // Trial 62: fifty-five seconds of shield raised at misses lying round its feet.
  const stuck = { id: 10, name: 'arrow', position: new Vec3(1.5, 14.1, 2.5), velocity: new Vec3(0, 0, 0), isValid: true };
  const bot = fixture({ 1: mob(1, 'skeleton', 0.5, 12.5), 10: stuck });
  assert.equal(await deflect(bot, new Task('guard'), { holdMs: 50 }), true, 'just seen, it may be one whose velocity has not arrived');
  stuck._seenAt = Date.now() - 5000;
  assert.equal(await deflect(bot, new Task('guard'), { holdMs: 50 }), false, 'still after five seconds: stuck in the ground');
});
