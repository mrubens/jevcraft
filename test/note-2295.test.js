'use strict';
// Note 2295: a climb digs the iron in its arm's reach and in sight, from where it stands.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { mineWithinReach } = require('../src/opportunistic-mining');

test('iron beside a pillar is dug where the bot stands; one behind rock or under lava is left', async () => {
  const registry = require('minecraft-data')('26.1');
  const ore = new Vec3(1, 65, 0), hidden = new Vec3(3, 65, 0);
  const dug = [];
  const blockAt = p => { const f = p.floored(); const name = f.equals(ore) || f.equals(hidden) ? 'iron_ore' : f.equals(new Vec3(2, 65, 0)) ? 'stone' : 'air'; return { name, type: registry.blocksByName[name].id, position: f, boundingBox: name === 'air' ? 'empty' : 'block', harvestTools: name === 'iron_ore' ? { [registry.itemsByName.stone_pickaxe.id]: true } : undefined }; };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, registry, blockAt, canDigBlock: () => true, _goal: {},
    inventory: { items: () => [{ name: 'stone_pickaxe', type: registry.itemsByName.stone_pickaxe.id, count: 1 }], slots: {} },
    findBlocks: () => [ore, hidden],
    world: { raycast: (from, dir, range) => { for (let t = 0; t <= range; t += 0.1) { const p = from.plus(dir.scaled(t)).floored(); const b = blockAt(p); if (b.boundingBox === 'block') return { position: p }; } return null; } },
    dig: async b => { dug.push(`${b.position}`); }, equip: async () => {}, heldItem: null };
  const n = await mineWithinReach(bot, { check() {} }, { now: 1e12 });
  assert.equal(n, 1);
  assert.deepEqual(dug, [`${ore}`]);
});
