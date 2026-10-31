'use strict';
// Note 2621: a blaze's death is logged with what lies under it, and two seconds on whether its rod lies there: the
// fortress trials of 2026-10-31 killed 20 blazes and gained no rod in four trial-hours, where the drill's cavern got a rod
// from every second kill; a blaze killed over the walkway's edge drops into the lava below, unseen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');

function scene({ rod = false, under = 'lava', depth = 3 } = {}) {
  const bf = require('../src/blaze-fight');
  const bot = new EventEmitter();
  const blaze = { id: 1, name: 'blaze', position: new Vec3(5.5, 64, 0.5), isValid: true };
  const item = { id: 9, name: 'item', position: new Vec3(5.5, 63, 0.5), isValid: true, getDroppedItem: () => ({ name: 'blaze_rod' }) };
  Object.assign(bot, { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'the_nether' }, entities: { 1: blaze, ...(rod ? { 9: item } : {}) }, _goal: { survivalAction: { action: 'charge_nearest', stance: true } },
    blockAt: p => ({ name: p.y === 64 - depth ? under : 'air' }) });
  bf.install(bot);
  return { bf, bot, blaze };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('a blaze killed over lava with no rod two seconds on: said so, with the ground under it', async () => {
  const said = []; const log = console.log; console.log = (...a) => { said.push(a.join(' ')); };
  try {
    const { bot, blaze } = scene({ rod: false, under: 'lava', depth: 3 });
    bot.emit('entityDead', blaze); delete bot.entities[1];
    await wait(2200);
    assert.ok(said.some(l => /^\[blaze\] one killed 5 blocks off under charge nearest/.test(l)), said.join(' | '));
    assert.ok(said.some(l => l === '[blaze] no rod lay within 4 of where it died two seconds on (5, 64, 0); it died over lava 3 below'), said.join(' | '));
    bot.emit('end');
  } finally { console.log = log; }
});

test('a rod lying where it died is said with its place and distance', async () => {
  const said = []; const log = console.log; console.log = (...a) => { said.push(a.join(' ')); };
  try {
    const { bot, blaze } = scene({ rod: true, under: 'nether_bricks', depth: 1 });
    bot.emit('entityDead', blaze); delete bot.entities[1];
    await wait(2200);
    assert.ok(said.some(l => l === '[blaze] its rod lies at (5, 63, 0), 5 blocks from the bot; it died over nether bricks 1 below'), said.join(' | '));
    bot.emit('end');
  } finally { console.log = log; }
});
