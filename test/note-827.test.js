// Note 827: a creeper behind the block the bot cut its line with, six
// blocks off and out of sight, stays the threat while block_creeper holds:
// 25591, 25593 and 25597 went back to work round the block and were blasted
// from full health.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const danger = require('../src/danger');

function scene() {
  const creeper = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(6.5, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata: [] };
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: { 7: creeper },
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), onGround: true },
    registry: require('minecraft-data')('26.1'), inventory: { items: () => [], slots: [] },
    // One block, two high, at (3, 64, 0) between them: out of sight, a way round.
    blockAt: p => { const f = p.floored(); const solid = f.y < 64 || (f.x === 3 && f.z === 0 && f.y >= 64 && f.y <= 65); return { position: f, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty', shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: (from, dir) => { const at = new Vec3(3, 64, 0); return { position: at, intersect: from.plus(dir.scaled((3 - from.x) / (dir.x || 1e-9))) }; } } };
  return { bot, creeper };
}

test('25591: a creeper six blocks off behind the bot\'s own block stays the threat while block_creeper renews it; marked only by the alert, it does not', () => {
  let { bot, creeper } = scene();
  assert.equal(danger.creeperMarked(bot, { entity: creeper, distance: 6 }), false);
  danger.markCreeper(bot, { entity: creeper });
  assert.equal(danger.creeperMarked(bot, { entity: creeper, distance: 6 }), false, 'the alert\'s mark reaches five');
  assert.notEqual(danger.immediateThreat(bot)?.entity?.name, 'creeper');
  danger.markCreeper(bot, { entity: creeper }, Date.now(), { blocked: true });
  assert.equal(danger.creeperMarked(bot, { entity: creeper, distance: 6 }), true);
  assert.equal(danger.immediateThreat(bot)?.entity?.name, 'creeper', 'held the threat behind the block');
  assert.equal(danger.creeperMarked(bot, { entity: creeper, distance: 8.5 }), false, 'past the reach of one in sight');
  // Thirty seconds after the stance last renewed it, it lapses.
  ({ bot, creeper } = scene());
  danger.markCreeper(bot, { entity: creeper }, Date.now() - 31000, { blocked: true });
  assert.equal(danger.creeperMarked(bot, { entity: creeper, distance: 6 }), false);
});
