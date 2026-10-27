'use strict';
// Note 2281: going back for the drops says what each kind about the death does to the body as it is worn now.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { corpseRunStep } = require('../src/corpse-run');

test('a bare bot is told what the drowned that killed it does to it now', async () => {
  const deathAt = new Date(Date.now() - 60000).toISOString();
  const bot = { game: { dimension: 'overworld' }, health: 20, entity: { position: new Vec3(0, 64, 0) }, chat: () => {}, registry: require('minecraft-data')('26.1'), time: { timeOfDay: 1000 }, inventory: { items: () => [], slots: {} } };
  const goal = { survival: { deaths: [{ at: deathAt, position: { x: 60, y: 64, z: 0 }, dimension: 'overworld', cause: 'was impaled by Drowned', about: [{ name: 'drowned', distance: 14 }] }],
    recovery: { at: deathAt, status: 'finished', recovered: {}, inventoryBeforeDeath: { iron_chestplate: 1, iron_sword: 1 } } } };
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = Object.values(questions)[0].criteria; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'leave_them', confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  await corpseRunStep(bot, task, goal, () => {}, { move: async () => {} });
  assert.match(asked.go_back, /As worn now, a hit from each kind that was about it: a drowned's about 8 \(3 end the bot from 20 health\)\./);
});

test('a death by impaling counts the trident even where a drowned in sight held something else (note 2284)', async () => {
  const deathAt = new Date(Date.now() - 60000).toISOString();
  const bot = { game: { dimension: 'overworld' }, health: 20, entity: { position: new Vec3(0, 64, 0) }, chat: () => {}, registry: require('minecraft-data')('26.1'), time: { timeOfDay: 1000 }, inventory: { items: () => [], slots: {} } };
  const goal = { survival: { deaths: [{ at: deathAt, position: { x: 60, y: 64, z: 0 }, dimension: 'overworld', cause: 'was impaled by Drowned', about: [{ name: 'drowned', distance: 10 }] }],
    recovery: { at: deathAt, status: 'finished', recovered: {}, inventoryBeforeDeath: { iron_chestplate: 1 }, mobsHolding: [{ name: 'drowned', distance: 10, holds: ['fishing_rod'] }] } } };
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = Object.values(questions)[0].criteria; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'leave_them', confidence: 0.9 }])) }; } };
  const task = Object.assign(new Task('run'), { opportunityClient: client });
  await corpseRunStep(bot, task, goal, () => {}, { move: async () => {} });
  assert.match(asked.go_back, /a drowned's about 8 \(3 end the bot from 20 health\)/);
});
