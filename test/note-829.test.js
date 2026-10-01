// Note 829: shield_the_blast priced at 0 whatever the fuse; 25591 and 25581
// chose it with the creeper lit at 2.7 and 0.6 blocks and died.
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



test('25591: a creeper lit with less fuse left than the shield takes to block prices its blast whole, said; one not lit is priced as before', () => {
  let { bot, danger } = scene([{ id: 2, name: 'creeper', position: new Vec3(2.5, 64, 0.5) }]);
  const i = bot.registry.entitiesByName.creeper.metadataKeys.indexOf('swell_dir');
  let o = optionsOf(bot, danger).shield_the_blast;
  assert(o, 'offered');
  assert.equal(o.expects.damage, 0, 'not lit: blocked in time');
  assert.doesNotMatch(o.description, /cannot be blocking in time/);
  ({ bot, danger } = scene([{ id: 2, name: 'creeper', position: new Vec3(2.5, 64, 0.5) }]));
  bot.entities[2].metadata[i] = 1;
  bot._fuseLit = new Map([[2, Date.now() - 1200]]);
  const { watchFuses } = require('../src/survival');
  if (typeof watchFuses === 'function') watchFuses(bot).set(2, Date.now() - 1200);
  o = optionsOf(bot, danger).shield_the_blast;
  assert(o.expects.damage > 5, `priced ${o.expects.damage}`);
  assert.match(o.description, /The shield cannot be blocking in time: the creeper is lit, about [\d.]+ seconds of fuse left, against about 0\.8 seconds for the shield to be up and blocking from this answer; its blast lands whole/);
});
