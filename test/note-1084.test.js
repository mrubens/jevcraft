'use strict';
// Note 1084: the walk's map is kept three seconds for the cell stood in, and
// let go when a block within its reach changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { reachWalk, REACH_MEMO_MS } = require('../src/blaze-stand');

function flat() {
  let reads = 0;
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, game: { dimension: 'the_nether' },
    blockAt: p => { reads++; return { position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }; } });
  return { bot, reads: () => reads };
}

test('made once and kept for the cell stood in; made again from another cell, after three seconds, or when a block near changes', t => {
  assert.equal(REACH_MEMO_MS, 3000);
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { bot, reads } = flat();
  const first = reachWalk(bot), n = reads();
  assert.ok(first.size > 1);
  t.mock.timers.setTime(1_002_000);
  assert.equal(reachWalk(bot), first, 'two seconds on: the same map');
  assert.equal(reads(), n, 'no block read again');
  // A block changed twelve blocks off: let go.
  bot.emit('blockUpdate', { position: new Vec3(12, 64, 0), name: 'air', boundingBox: 'empty' }, { position: new Vec3(12, 64, 0), name: 'netherrack', boundingBox: 'block' });
  const second = reachWalk(bot);
  assert.notEqual(second, first);
  // One far off, or a change that changes nothing a walk reads, keeps it.
  bot.emit('blockUpdate', { position: new Vec3(200, 64, 0), name: 'air', boundingBox: 'empty' }, { position: new Vec3(200, 64, 0), name: 'netherrack', boundingBox: 'block' });
  bot.emit('blockUpdate', { position: new Vec3(3, 64, 0), name: 'air', boundingBox: 'empty' }, { position: new Vec3(3, 64, 0), name: 'air', boundingBox: 'empty' });
  assert.equal(reachWalk(bot), second);
  // Fire lit beside it (note 1090): a name changed, nothing a walk reads.
  bot.emit('blockUpdate', { position: new Vec3(3, 64, 1), name: 'air', boundingBox: 'empty' }, { position: new Vec3(3, 64, 1), name: 'fire', boundingBox: 'empty' });
  assert.equal(reachWalk(bot), second);
  bot.emit('blockUpdate', { position: new Vec3(3, 64, 1), name: 'air', boundingBox: 'empty' }, { position: new Vec3(3, 64, 1), name: 'lava', boundingBox: 'empty' });
  const afterLava = reachWalk(bot);
  assert.notEqual(afterLava, second, 'lava come: let go');
  t.mock.timers.setTime(1_006_000);
  assert.notEqual(reachWalk(bot), afterLava, 'past three seconds');
  bot.entity.position = new Vec3(4.5, 64, 0.5);
  const moved = reachWalk(bot);
  bot.entity.position = new Vec3(5.5, 64, 0.5);
  assert.notEqual(reachWalk(bot), moved, 'another cell');
});
