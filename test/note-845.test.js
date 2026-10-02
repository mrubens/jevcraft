'use strict';
// Note 845: keep_working chosen at a ledge over lava with a ghast in sight
// steps to firm ground three from any drop first (25597, 2026-10-01 21:26Z).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');

function scene(mobs, { health = 20, items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], shield = true } = {}) {
  const entities = Object.fromEntries(mobs.map(m => [m.id, { type: 'hostile', height: m.name === 'creeper' ? 1.7 : 1.95, width: 0.6, isValid: true, metadata: [], ...m }]));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food: 19, oxygenLevel: 20,
    entities, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, eyeHeight: 1.62, velocity: new Vec3(0, 0, 0), metadata: [0] },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, ...(shield ? { 45: { name: 'shield' } } : {}) }, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: p => { const f = p.floored(); const lava = f.x >= 3 && f.y < 20; const s = (f.y < 64 && f.x < 3) || (f.x >= 3 && f.y < 19); return { position: f, name: lava ? 'lava' : s ? 'stone' : 'air', boundingBox: s && !lava ? 'block' : 'empty', diggable: s, shapes: s && !lava ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {}, activateItem() {}, deactivateItem() {} });
  const danger = Object.values(entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: e.visible !== false }))
    .sort((a, b) => a.distance - b.distance);
  return { bot, danger };
}
const optionsOf = (bot, danger) => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  return survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
};


test('25597: keep_working with a ghast in sight and a fall into lava two blocks off walks to firm ground first', async () => {
  const { bot, danger } = scene([{ id: 9, name: 'ghast', position: new Vec3(-20.5, 70, 0.5), height: 4, width: 4 }]);
  bot.entity.position = new Vec3(1.5, 64, 0.5);
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const went = [];
  const survival = new Survival(bot, { navigate: async (b, t, g) => { went.push(g); } }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  assert(options.keep_working, Object.keys(options).join(','));
  await options.keep_working.run();
  assert.equal(went.length, 1, 'walked off the edge');
  assert(went[0].x <= -1, `to x ${went[0].x}, three or more from the drop at x 3`);
});
