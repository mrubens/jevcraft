'use strict';
const test = require('node:test');
const assert = require('node:assert');

async function ask(time, food) {
  const { upkeepStep } = require('../src/work');
  const { establishedHome } = require('./fixtures/home-world');
  const w = await establishedHome();
  w.bot.time.timeOfDay = time; w.bot.food = food;
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  await upkeepStep(w.bot, { check() {} }, { ...w.goal, kind: 'win', step: { action: 'mine', block: 'iron_ore' } }, () => {}, client);
  return offered || {};
}

test('by day at hunger under eighteen with no food carried, food is offered with the deaths by hunger (note 1375)', async () => {
  const offered = await ask(3000, 15);
  assert.match(offered.food_reserve || '', /^Find food now, by day: 0 food points carried, hunger 15, dusk in about \d+ minutes;/);
  assert.match(offered.food_reserve, /until then every hit taken stays taken\. The record in the Overworld .*At hunger 15 with/);
});

test('fed to eighteen at midday, no food reserve is offered', async () => {
  assert.equal((await ask(3000, 19)).food_reserve, undefined);
});
