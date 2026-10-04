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

test('cut off with a furnace, a chest and a wool carried, the way back is one move: to the floor\'s near cell and the gap laid from there (note 1242)', () => {
  const { localMoves } = require('../src/unstuck');
  const v = { ...view(), carried: { furnace: 1, chest: 1, black_wool: 1, diamond_sword: 1 }, laid: () => null, block: () => null, health: 1, pickaxe: 'iron_pickaxe', pickaxeUses: 100 };
  const { moves } = localMoves(v, new Vec3(3, 53, 0), { goal: 'away', visits: {}, from: new Vec3(3, 53, 0), breathS: 15 });
  const back = moves.find(m => m.key === 'bridge_back');
  assert.ok(back, moves.map(m => m.key).join(', '));
  assert.deepStrictEqual([back.edge.x, back.edge.y, back.edge.z, back.cells], [0, 52, 0, 1]);
  assert.match(back.does, /^Bridge back in one go: walk 3 steps along this floor to its cell at \(0, 52, 0\), the nearest to it, and lay the 1 cell of gap from there to the larger floor \(44 cells, a longer piece of span\) at \(-2, 52, 0\), a block a step, crouched/);
  assert.match(back.does, /with the 3 carried that hold \(1 black wool, 1 furnace, 1 chest\)/);
  const none = localMoves({ ...v, carried: { diamond_sword: 1 } }, new Vec3(3, 53, 0), { goal: 'away', visits: {}, from: new Vec3(3, 53, 0), breathS: 15 }).moves;
  assert.ok(!none.some(m => m.key === 'bridge_back'), 'nothing carried that holds: not offered');
});
