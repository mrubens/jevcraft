'use strict';
// Note 1067: what stands outside a sealed pocket, said: what meeting it
// costs as the bot is, and whether the dawn burns it where it stands.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { outsideSays } = require('../src/pocket-outside');

// A pocket two under the grass at y 69; the surface at y 70, open sky over
// it but where `roofed` says rock stands at y 75.
function bot({ items = [], worn = {}, dimension = 'overworld', roofed = () => false } = {}) {
  return { game: { dimension, minY: -64, height: 384 }, health: 20, entity: { position: new Vec3(-97.5, 69, 45.5) },
    inventory: { items: () => items.map(name => ({ name, count: 1 })), slots: Object.fromEntries(Object.entries(worn).map(([k, name]) => [k, { name }])) },
    blockAt: p => ({ name: p.y <= 70 || (p.y === 75 && roofed(p)) ? 'stone' : 'air', boundingBox: p.y <= 70 || (p.y === 75 && roofed(p)) ? 'block' : 'empty', position: p }) };
}
const zombie = (x = -98, z = 42) => ({ entity: { id: 4, name: 'zombie', position: new Vec3(x + 0.5, 71, z + 0.5) }, distance: 4.3, visible: false });

test('25595 in its pocket, bare hands and nothing worn, a zombie on the grass outside, a minute of the night left', () => {
  const says = outsideSays(bot(), [zombie()], { night: true, minutesToDawn: 1 });
  assert.match(says.stay, /Met outside as the bot is \(bare hands, nothing worn\): about [\d.]+ seconds of fighting and [\d.]+ damage to kill the zombie, from 20 health/);
  assert.match(says.stay, /The zombie 4 blocks off stands under open sky: the dawn, about a minute off, burns it there \(the game's rule for zombies and skeletons in daylight\), and a stay to the dawn outlasts it\./);
  assert.match(says.leave, /burns it there .*; going out now meets it before that\./);
});

test('no word of the dawn by day, for one under a roof, or for a spider; none of the fight with a sword and two pieces on; nothing off the Overworld', () => {
  assert.doesNotMatch(outsideSays(bot(), [zombie()], { night: false }).stay, /dawn/);
  assert.doesNotMatch(outsideSays(bot({ roofed: () => true }), [zombie()], { night: true, minutesToDawn: 3 }).stay, /dawn/);
  const spider = { entity: { id: 5, name: 'spider', position: new Vec3(-98.5, 71, 42.5) }, distance: 4, visible: false };
  assert.doesNotMatch(outsideSays(bot(), [spider], { night: true, minutesToDawn: 3 }).stay, /dawn/);
  const armed = outsideSays(bot({ items: ['iron_sword'], worn: { 5: 'iron_helmet', 6: 'iron_chestplate' } }), [zombie()], { night: true, minutesToDawn: 3 });
  assert.doesNotMatch(armed.stay, /Met outside/);
  assert.match(armed.stay, /about 3 real minutes off/);
  assert.deepEqual(outsideSays(bot({ dimension: 'the_nether' }), [zombie()], { night: true }), { stay: '', leave: '' });
  assert.deepEqual(outsideSays(bot(), [], { night: true }), { stay: '', leave: '' });
});
