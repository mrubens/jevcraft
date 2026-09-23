'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { gazePlugin, lowerGaze, DOWN } = require('../src/gaze');

const creepy = registry.entitiesByName.enderman.metadataKeys.indexOf('creepy');
const scene = ({ enderman = new Vec3(20, 64, 0), angry = false, moving = true, pitch = 0 } = {}) => {
  const bot = Object.assign(new EventEmitter(), { registry, controlState: { forward: moving },
    entity: { position: new Vec3(0, 64, 0), pitch }, pathfinder: { isMoving: () => moving }, entities: {} });
  if (enderman) bot.entities[7] = { name: 'enderman', position: enderman, metadata: angry ? { [creepy]: true } : {} };
  return bot;
};

test('walking level with an enderman in view, the gaze goes to the ground ahead', () => {
  assert.equal(lowerGaze(scene()), true);
  const bot = scene(); gazePlugin(bot); bot.emit('spawn'); bot.emit('physicsTick');
  assert.equal(bot.entity.pitch, DOWN);
});

test('the gaze is left alone otherwise', () => {
  assert.equal(lowerGaze(scene({ enderman: null })), false, 'no enderman');
  assert.equal(lowerGaze(scene({ enderman: new Vec3(90, 64, 0) })), false, 'too far to see');
  assert.equal(lowerGaze(scene({ angry: true })), true, 'a screaming one may be angry at the dragon: a glance makes it the bot\'s');
  assert.equal(lowerGaze(scene({ moving: false })), false, 'standing: aiming, digging, eating');
  const dodge = scene(); dodge.pathfinder.isMoving = () => false;
  assert.equal(lowerGaze(dodge), true, 'a dodge pressing the keys itself walks eyes down too');
  assert.equal(lowerGaze(scene({ pitch: 0.6 })), false, 'a deliberate look up at a crystal');
});

test('a goal missing the methods the pathfinder calls every tick is made whole, a bare position becomes a block goal', () => {
  const { wholeGoal } = require('../src/skills');
  const log = console.log; const lines = []; console.log = l => lines.push(l);
  try {
    const bare = wholeGoal({ x: 3.4, y: 64, z: -2.2 });
    assert.equal(typeof bare.isValid, 'function'); assert.deepEqual([bare.x, bare.y, bare.z], [3, 64, -3]);
    const partial = wholeGoal({ isEnd: () => true, heuristic: () => 0 });
    assert.equal(partial.isValid(), true); assert.equal(partial.hasChanged(), false);
    assert.match(lines[0], /\[bug\] the pathfinder was given an incomplete goal/);
  } finally { console.log = log; }
});

test('the goal guard wraps the pathfinder it is injected after', () => {
  const { goalGuardPlugin } = require('../src/skills');
  let set = null;
  const bot = { pathfinder: { setGoal(goal) { set = goal; } } };
  goalGuardPlugin(bot);
  const log = console.log; console.log = () => {};
  try { bot.pathfinder.setGoal({ x: 1, y: 2, z: 3 }); } finally { console.log = log; }
  assert.equal(typeof set.isValid, 'function');
});

test('something that is not a destination at all is refused, not set', () => {
  const { wholeGoal } = require('../src/skills');
  const log = console.log; console.log = () => {};
  try { assert.throws(() => wholeGoal({ label: 'walk_to_drop', keys: ['forward'] }), /Not a pathfinder goal/); }
  finally { console.log = log; }
});
