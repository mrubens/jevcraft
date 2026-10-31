'use strict';
// Note 2617: a biter the stance was chosen with at a distance, now at arm's length, lets a stance that does not wait
// for it go, and the stance is asked again with it at the body. mid-full-19-fortress-1 (25586, 2026-10-30 23:49Z) took a
// stance at 20 health with a wither skeleton 13 blocks off; the hold stood as it walked up, its first blows took 20 to
// 8.3 in half a second, and the stance was asked again at 8.3 and lost.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');

function scene() {
  const blaze = { id: 1, name: 'blaze', type: 'hostile', position: new Vec3(6.5, 64, 0.5), height: 1.8, width: 0.6, isValid: true };
  const wither = { id: 2, name: 'wither_skeleton', type: 'hostile', position: new Vec3(10.5, 64, 0.5), height: 2.4, width: 0.7, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 1: blaze, 2: wither }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), yaw: 0 },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], slots: { 45: { name: 'shield' }, 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } } },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'netherrack' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  return { bot, blaze, wither };
}
const danger = (bot, mobs) => mobs.map(m => ({ entity: m, distance: m.position.distanceTo(bot.entity.position), visible: true }));

test('a wither skeleton held against at 10 blocks, come to 2, lets take cover go and the stance is asked again', async () => {
  const { bot, blaze, wither } = scene();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  survival.scoutRetreat = async () => {};
  survival.stanceOptions = () => ({
    take_cover: { description: 'Put blocks in the line and stay behind them.', expects: { damage: 4, seconds: 15 }, run: async () => true },
    shield_guard: { description: 'Face the nearest with the shield raised.', expects: { damage: 9, seconds: 15 }, run: async () => true },
  });
  const asked = [];
  survival.decide = async (task, g, save, q) => { asked.push(Object.keys(q.tree)); return { path: ['take_cover'] }; };
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); };
  try {
    await survival.stanceStep(new Task('x'), {}, () => {}, danger(bot, [blaze, wither]), false);
    assert.equal(asked.length, 1);
    // The same scene a moment on: held.
    await survival.stanceStep(new Task('x'), {}, () => {}, danger(bot, [blaze, wither]), false);
    assert.equal(asked.length, 1, 'held while nothing it was chosen on has changed');
    // The wither skeleton at arm's length: let go, said, asked again.
    wither.position = new Vec3(2.3, 64, 0.5);
    await survival.stanceStep(new Task('x'), {}, () => {}, danger(bot, [blaze, wither]), false);
    assert.equal(asked.length, 2, 'asked again with the biter at the body');
    const why = said.find(l => /\[stance\] take cover let go/.test(l));
    assert.match(why || '', /a biter at arm's length: the wither skeleton 1\.8 blocks off, 10 when the stance was chosen/, said.filter(l => l.startsWith('[stance]')).join(' | '));
  } finally { console.log = log; }
});
