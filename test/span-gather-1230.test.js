const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { miningCandidates } = require('../src/work');

// A span of netherrack one thick over the void, the bot at its tip, and
// ground (rock three deep) twelve blocks back along it.
function world() {
  const cells = new Map();
  const set = (x, y, z, name) => cells.set(`${x},${y},${z}`, name);
  for (let x = 0; x <= 12; x++) set(x, 52, 0, 'netherrack');
  for (let x = 13; x <= 16; x++) for (let y = 50; y <= 52; y++) for (let z = -1; z <= 1; z++) set(x, y, z, 'netherrack');
  const blockAt = p => { const name = cells.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`) || 'air'; return { name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block', diggable: name !== 'air', getProperties: () => ({}) }; };
  const bot = {
    entity: { position: new Vec3(0.5, 53, 0.5) }, entities: {}, game: { dimension: 'the_nether' }, oxygenLevel: 20,
    registry: { blocksByName: { netherrack: { id: 1 } } }, blockAt,
    findBlocks: o => [...cells.keys()].map(k => new Vec3(...k.split(',').map(Number))).filter(p => o.useExtraInfo(blockAt(p))).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)).slice(0, o.count),
    inventory: { items: () => [] }, pathfinder: { movements: { canDig: false } },
  };
  return bot;
}
const task = { check() {} };

test('rock for laying is not sought in the span stood on, but in the ground behind it (note 1230)', async () => {
  const bot = world();
  const found = await miningCandidates(bot, task, { block: 'netherrack', drops: 'netherrack', sources: ['netherrack'] }, {});
  assert.ok(found.length > 0, 'the ground is found');
  assert.ok(found.every(p => p.x >= 13), `no span cell among them: ${found.filter(p => p.x < 13).map(String).join(' ')}`);
});
