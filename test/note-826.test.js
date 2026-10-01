// Note 826: 25589 (mid-226-ap, 2026-10-01 16:21:08Z) was priced "about 0
// damage" for shield_guard facing a zombie with a creeper off to the side;
// the blast took 13.4 through the guard.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');

function scene(mobs, { health = 20, items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], shield = true } = {}) {
  const entities = Object.fromEntries(mobs.map(m => [m.id, { type: 'hostile', height: m.name === 'creeper' ? 1.7 : 1.95, width: 0.6, isValid: true, metadata: [], ...m }]));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food: 19, oxygenLevel: 20,
    entities, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, eyeHeight: 1.62, velocity: new Vec3(0, 0, 0), metadata: [0] },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, ...(shield ? { 45: { name: 'shield' } } : {}) }, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
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


test('25589: shield_guard prices a creeper outside the cover as it faces the zombie at its blast, and says so; inside the cover it costs nothing', () => {
  // The zombie west, the creeper north-east: well outside the cover.
  let { bot, danger } = scene([
    { id: 1, name: 'zombie', position: new Vec3(-3.5, 64, 0.5) },
    { id: 2, name: 'creeper', position: new Vec3(3.5, 64, -2.5) },
  ]);
  let guard = optionsOf(bot, danger).shield_guard;
  assert(guard, 'the guard offered');
  assert.match(guard.description, /As the shield faces the zombie: the creeper [\d.]+ blocks off is \d+ degrees from the way the shield faces, outside its cover: it walks in and its blast lands whole/);
  assert(guard.expects.damage > 5, `priced ${guard.expects.damage}`);
  // The creeper just behind the zombie, the same way: the shield takes it.
  ({ bot, danger } = scene([
    { id: 1, name: 'zombie', position: new Vec3(-3.5, 64, 0.5) },
    { id: 2, name: 'creeper', position: new Vec3(-5.5, 64, 0.5) },
  ]));
  guard = optionsOf(bot, danger).shield_guard;
  assert(guard, 'the guard offered');
  assert.doesNotMatch(guard.description, /outside its cover: it walks in and its blast lands whole/);
});
