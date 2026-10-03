'use strict';
// Note 1086: a step that is to move the body, said again and again from one
// spot for two seconds, is refused at any pace.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Survival } = require('../src/survival');

function make() {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20,
    entity: { position: new Vec3(44.7, -10, 228.5), onGround: true }, entities: {}, inventory: { items: () => [], slots: {} }, blockAt: () => null });
  return { bot, survival: new Survival(bot, {}, { state: { shelters: [] } }) };
}

test('off the edge said ten times a second from one spot: refused after two seconds, for eight; moving, or a hold, is not', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  const lines = [], log = console.log; console.log = l => lines.push(String(l));
  try {
    const { bot, survival } = make();
    const goal = {};
    let refused = null;
    for (let i = 0; i < 40 && !refused; i++) {
      t.mock.timers.setTime(5_000_000 + i * 100);
      try { survival.report(goal, () => {}, { action: 'off_the_edge', to: { x: 45, y: -9, z: 227 } }); } catch (err) { refused = { err, at: i * 100 }; }
    }
    assert.ok(refused, 'refused');
    assert.equal(refused.err.name, 'SetAside');
    assert.ok(refused.at >= 2000 && refused.at <= 2300, `after two seconds: ${refused.at}`);
    assert.ok(lines.some(l => /off_the_edge was said for two seconds from one spot without the bot moving: set aside eight seconds/.test(l)), lines.join('\n'));
    // Walking as it is said: never refused.
    const walking = make(), g2 = {};
    for (let i = 0; i < 40; i++) { t.mock.timers.setTime(6_000_000 + i * 100); walking.bot.entity.position = new Vec3(44.7 + i * 0.5, -10, 228.5); walking.survival.report(g2, () => {}, { action: 'off_the_edge', to: { x: 80, y: -9, z: 227 } }); }
    // A hold said from one spot is the hold: not this rule's.
    const holding = make(), g3 = {};
    for (let i = 0; i < 40; i++) { t.mock.timers.setTime(7_000_000 + i * 100); holding.survival.report(g3, () => {}, { action: 'shield_guard', stance: true }); }
  } finally { console.log = log; }
});
