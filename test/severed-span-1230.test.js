const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { islandOf, groundRun, floorFacts } = require('../src/unstuck');

// 25590's span: forty cells of it west, a cell shot out, five cells east
// with the bot on them; nothing under any of it.
function view() {
  const cells = new Set();
  for (let x = -45; x <= -2; x++) cells.add(`${x},52,0`);
  for (let x = 0; x <= 4; x++) cells.add(`${x},52,0`);
  return { name: p => p.y < 40 || p.y > 70 ? null : cells.has(`${p.x},${p.y},${p.z}`) ? 'netherrack' : 'air' };
}

test('the longer piece of a cut span is a floor to bridge back to, said with its size (note 1230)', () => {
  const v = view(), island = islandOf(v, new Vec3(0, 52, 0));
  assert.strictEqual(island.size, 5);
  const run = groundRun(v, new Vec3(-1, 52, 0), island);
  assert.ok(run, 'the floor a cell of gap west is found');
  assert.strictEqual(run.cells, 1);
  assert.strictEqual(run.floor, 44);
  assert.match(floorFacts(v, new Vec3(0, 53, 0), island), /nearest larger floor \(44 cells, itself joined to no ground\) is 1 cell of gap/);
});

test('from the longer piece the five cells cut off are not a floor to go to', () => {
  const v = view(), island = islandOf(v, new Vec3(-2, 52, 0));
  assert.strictEqual(groundRun(v, new Vec3(-1, 52, 0), island), null);
});
