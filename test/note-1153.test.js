'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { deepBeside, dodgeRoutes, evadeOverTerrain, straightAway } = require('../src/end-safety');
const registry = require('prismarine-registry')('26.1');

// The End's entry platform: obsidian five blocks square at y 48, x 98 to 102, z -2 to 2, nothing under or about it.
function platform(at = new Vec3(98.5, 49, 0.5)) {
  const phase = registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase');
  const dragon = { id: 20, name: 'ender_dragon', position: new Vec3(60, 60, 0.5), metadata: { [phase]: 8 } };
  const on = p => p.y === 48 && p.x >= 98 && p.x <= 102 && p.z >= -2 && p.z <= 2;
  const bot = { registry, game: { dimension: 'the_end' }, health: 20, isAlive: true, entity: { position: at, onGround: true }, entities: { 20: dragon },
    blockAt: p => { const f = p.floored(); return on(f) ? { name: 'obsidian', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }; },
    pathfinder: { setGoal() {}, movements: { canDig: true, maxDropDown: 3, allowSprinting: false, allow1by1towers: true, scafoldingBlocks: [1] }, getPathTo: (m, dest) => ({ status: 'success', path: [{ x: dest.x, y: dest.y, z: dest.z, toBreak: [] }] }) },
    clearControlStates() {}, setControlState() {}, look: async () => {}, emit() {} };
  return { bot, dragon };
}

test('on the entry platform over the void, no dodge is taken to a cell at its edge: the fight stands rather than runs off it (note 1153)', async () => {
  const { bot, dragon } = platform();
  assert.equal(deepBeside(bot, new Vec3(102.5, 49, -1.5)), true, 'the corner cell the rehearsal ran to');
  assert.equal(deepBeside(bot, new Vec3(100.5, 49, 0.5)), false, 'the platform\'s middle');
  let walked = null;
  await assert.rejects(evadeOverTerrain(bot, new Task('dodge'), { endCombat: {} }, () => {}, dragon, { walk: async (b, t, dest) => { walked = dest; } }), { name: 'NoEscape' });
  assert.equal(walked, null, 'no walk to an edge cell');
  for (const r of dodgeRoutes(bot, dragon)) assert.equal(deepBeside(bot, r.destination), false, `a run ending at ${r.destination}`);
  assert.equal(straightAway(bot, bot.entity.position, 0), null);
});

test('on the island\'s open ground the dodges are as they were', () => {
  const { bot, dragon } = platform(new Vec3(0.5, 64, 0.5));
  bot.blockAt = p => ({ name: p.y < 64 ? 'end_stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' });
  assert.equal(deepBeside(bot, bot.entity.position), false);
  const routes = dodgeRoutes(bot, dragon);
  assert.equal(routes.length, 3);
  assert.ok(routes.every(r => r.distance === 8));
  assert.ok(straightAway(bot, bot.entity.position, 0));
});
