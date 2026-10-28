'use strict';
// Note 2395. full-20 (25588, 2026-10-28 11:52 to 11:56Z) walked back to its drops among the blazes that had killed it,
// and every turn for four minutes went to a fight stance; the drops aged out with none taken up. Taking up the kit
// lying within reach is an encounter option, priced, armour and arms first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');

function scene({ open = true, kitAt = 4 } = {}) {
  const zombie = { id: 90, name: 'zombie', type: 'hostile', position: new Vec3(8.5, 64, 0.5), height: 1.95, width: 0.6, isValid: true, metadata: [] };
  const item = (id, name, x) => ({ id, name: 'item', type: 'other', position: new Vec3(x, 64, 1.5), isValid: true, getDroppedItem: () => ({ name, count: 1 }) });
  const entities = { 90: zombie, 91: item(91, 'iron_chestplate', 0.5 + kitAt), 92: item(92, 'diamond_pickaxe', 0.5 + kitAt - 1) };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, eyeHeight: 1.62, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: [0] },
    inventory: { items: () => [{ name: 'stone_sword', count: 1 }], slots: {}, emptySlotCount: () => 30 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  const goal = open ? { corpseRun: { status: 'open', dimension: 'overworld', position: { x: 4, y: 64, z: 1 }, items: { iron_chestplate: 1, diamond_pickaxe: 1 } } } : {};
  return { bot, goal, threats: [{ entity: zombie, distance: 8, visible: true }] };
}
const offer = ({ bot, goal, threats }) => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  return survival.stanceOptions(new Task('x'), goal, () => {}, threats, false);
};

test('the kit lying within eight blocks is offered as taken up, priced, the armour first (note 2395)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-28T11:52:00Z') });
  const o = offer(scene());
  assert(o.grab_kit, Object.keys(o).join(','));
  assert.match(o.grab_kit.description, /^(This way: [^.]*\. )?Take up the kit dropped at the death, lying within 5 blocks: iron chestplate, diamond pickaxe; the iron chestplate first, the armour worn as it is taken up,/);
  assert(o.grab_kit.expects.seconds > 0);
  assert.equal(typeof o.grab_kit.expects.damage, 'number');
  require('../src/decisions').question('encounter_stance');
});

test('not offered with no walk back open, or with the kit out of reach (note 2395)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-28T11:52:00Z') });
  assert.equal(offer(scene({ open: false })).grab_kit, undefined);
  assert.equal(offer(scene({ kitAt: 14 })).grab_kit, undefined);
});
