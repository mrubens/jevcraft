'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('acacia asked for with only oak in view takes the oak; with acacia in view it stays acacia', async () => {
  const registry = require('minecraft-data')('26.1');
  const work = require('../src/work');
  const oak = new Vec3(5, 64, 0);
  const bot = { registry, game: { gameMode: 'survival', dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.oak_log.id) ? [oak] : [],
    blockAt: p => ({ name: p.equals(oak) ? 'oak_log' : 'air', position: p }) };
  const step = { action: 'mine', block: 'acacia_log', sources: ['acacia_log'], drops: 'acacia_log', count: 2 };
  const swapped = work.logInView(bot, step);
  assert.equal(swapped.block, 'oak_log'); assert.equal(swapped.insteadOf, 'acacia_log');
  // Acacia in view too: acacia it is.
  const both = { ...bot, findBlocks: () => [oak] };
  assert.equal(work.logInView(both, step).block, 'acacia_log');
});
