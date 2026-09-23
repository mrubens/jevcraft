'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { bunkerDigMs } = require('../src/bunker');

// Stone to the east of the bot from x = 1, a floor under everything, and
// the mobs to the west: how long the bunker takes depends on the pickaxe.
function wall(items) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y < 64 || f.x >= 1 ? 'stone' : 'air'].defaultState); b.position = f; return b; };
  return { registry, blockAt, entity: { position: new Vec3(0.5, 64, 0.5) }, findBlocks: () => [],
    inventory: { items: () => items.map(name => ({ name, type: registry.itemsByName[name].id, count: 1, durabilityUsed: 0 })) } };
}

test('a bunker is quick with an iron pickaxe and slow by hand: the stance offers it only when it is quick', () => {
  const from = new Vec3(-5, 64, 0);
  const iron = bunkerDigMs(wall(['iron_pickaxe']), from), hand = bunkerDigMs(wall([]), from);
  assert(iron <= 3000, `iron: ${iron}`);
  assert(hand > 3000, `by hand: ${hand}`);
  assert(bunkerDigMs(wall(['wooden_pickaxe']), from) > iron);
});
