'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, claim } = require('../src/survival');
const { claimSays } = require('../src/arbiter');

// mid-208-k-nether-4-fortress-1 (25589, note 590): up on its own two-block
// pillar at 7.9 health, hunger 17 and nothing to eat, a hoglin four blocks
// off that neither came nor went for eleven minutes and more; encounter_stance
// asked every fifteen seconds, pillar and now and then fight, told each time
// to "go two blocks straight up" and nothing of the hold.
function pillarBot({ health = 7.9, food = 17, mob = 'hoglin', at = new Vec3(4.5, 60, 0.5), held = null } = {}) {
  const solid = p => p.y < 60 || (p.x === 0 && p.z === 0 && p.y < 62);
  const hoglin = { id: 5, name: mob, type: 'hostile', position: at, height: mob === 'hoglin' ? 1.4 : 1.95, width: mob === 'hoglin' ? 1.4 : 0.6, isValid: true, ...(held ? { heldItem: { name: held } } : {}) };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, oxygenLevel: 20,
    entities: { 5: hoglin }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 62, 0.5), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 46 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = solid(f); return { position: f, name: s ? 'netherrack' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  const threat = () => ({ entity: hoglin, distance: hoglin.position.distanceTo(bot.entity.position), visible: true });
  return { bot, hoglin, threat };
}

// One asking a quarter minute: the stance question as the step asks it, the
// options built as they are, their runs stood in for.
async function stanceAt(survival, now, danger, answer) {
  const real = Date.now;
  let tree, state;
  const build = survival.stanceOptions.bind(survival);
  survival.stanceOptions = (...a) => { const o = build(...a); for (const v of Object.values(o)) v.run = async () => true; return o; };
  survival.decide = async (task, g, save, q) => { if (q.id === 'encounter_stance') { tree = q.tree; state = q.state; } return { path: [answer(q.tree)] }; };
  survival.scoutRetreat = async () => {};
  Date.now = () => now;
  try { await survival.stanceStep(new Task('x'), {}, () => {}, danger, false); } finally { Date.now = real; survival.stanceOptions = build; }
  return { tree, state };
}

test('up on its pillar over a hoglin that neither comes nor goes, the pillar says the hold: its minutes, nothing struck or lost, the hoglin never nearer and out of reach both ways, and the fight chosen up there come to nothing (25589, note 590)', async () => {
  const { bot, threat } = pillarBot();
  const t0 = 1_800_000_000_000;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [], pillar: { x: 0, y: 60, z: 0, at: t0 - 3000 },
    stance: { choice: 'pillar', kinds: 'hoglin', ids: [5], mobs: [{ name: 'hoglin', distance: 4.3, visible: true }], at: t0 - 3000, health: 7.9, expects: { damage: 0, seconds: 15 } } }, client: { systemOne: async () => ({}) } });
  let n = 0, last;
  // As recorded: pillar three times and the fight the fourth, while the
  // fight is offered. Held its fifteen seconds with nothing struck and
  // nothing changed since, it is not offered again (note 596): it is said
  // in the state instead.
  let fightLast;
  for (let s = 0; s <= 11 * 60; s += 15) {
    last = await stanceAt(survival, t0 + s * 1000, [threat()], t => (++n % 4 === 0 && t.fight ? 'fight' : 'pillar'));
    if (last.tree?.fight) fightLast = last.tree.fight.description;
  }
  const pillar = last.tree.pillar.description;
  assert.match(pillar, /^.*Hold on the pillar's top, two up, and fight from there/);
  assert.doesNotMatch(pillar, /Go two blocks straight up/);
  assert.match(pillar, /Up on this pillar 11 minutes so far, chosen against the hoglin 4 blocks off\. In that time: no health lost up here, nothing struck, nothing killed\./);
  assert.match(pillar, /The fight has been chosen up here once in this hold: nothing came within the sword's reach and nothing was struck\./);
  assert.match(pillar, /Of the mobs about: the hoglin 4 blocks off, about for 11 minutes of the hold, 4 blocks off all that time, never nearer, in sight; it does not reach the top, and the sword does not reach it from up here\./);
  assert.match(pillar, /The hoglin has not come nearer, reached the bot or come within the sword's reach in 11 minutes, and it has not gone: the hold has had nothing to strike, and waiting up here has not sent it away\. No daylight comes here: nothing about burns off or goes away with the hour, so a hold here ends only when the bot leaves the top\. Health 7\.9 does not come back at hunger 17: holding heals nothing\./);
  assert.equal(last.tree.fight, undefined, 'the fight that struck nothing, nothing changed since, is not offered as if it might');
  assert.match(last.state.notOfferedNow.find(f => f.choice === 'fight').why, /^ended here without acting, the last \d+ seconds ago: held 15 seconds: nothing was struck, not a step was taken and no block was placed or dug; nothing has changed here since/);
  assert.match(fightLast, /^The hoglin 4 blocks off .*Fight here/, 'offered until it was chosen and struck nothing');
  assert.equal(last.state.pillarSoFar.minutes, 11);
  assert.equal(last.state.pillarSoFar.swings, 0);
  assert.equal(last.state.pillarSoFar.fightChosenUpHere, 1);
  // The turn's own question says it too.
  const real = Date.now; Date.now = () => t0 + 11 * 60000;
  let c; try { c = claim(bot, { survival: survival.state }, survival); } finally { Date.now = real; }
  assert.equal(c.action, 'escape_threat');
  assert.match(claimSays(c), /Up on its pillar 11 minutes so far: no health lost up here, nothing struck; the hoglin 4 blocks off all that time, never nearer\. The work waits\./);
});

test('a hold that struck and was hit says so, a mob come nearer is said so, and the hold is not said to wait on nothing', async () => {
  const { bot, hoglin, threat } = pillarBot({ mob: 'zombie', health: 20, food: 20, at: new Vec3(8.5, 60, 0.5) });
  const t0 = 1_800_000_000_000;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [], pillar: { x: 0, y: 60, z: 0, at: t0 - 1000 } }, client: { systemOne: async () => ({}) } });
  let tree;
  for (let s = 0; s <= 120; s += 15) {
    hoglin.position = new Vec3(8.5 - 5 * s / 120, 60, 0.5);
    if (s === 60) { bot.health = 17; bot._struck = { id: 5, at: t0 + s * 1000 }; }
    if (s === 75) bot._struck = { id: 5, at: t0 + s * 1000 };
    tree = (await stanceAt(survival, t0 + s * 1000, [threat()], () => 'pillar')).tree || tree;
  }
  assert.match(tree.pillar.description, /Up on this pillar 2 minutes so far\. In that time: 3 health lost up here, 2 swings at what came within reach, nothing killed\./);
  assert.match(tree.pillar.description, /the zombie 4 blocks off, about for 2 minutes of the hold, come from 8 to 4 blocks off, in sight/);
  assert.doesNotMatch(tree.pillar.description, /has not come nearer|None of them has come nearer/);
});

test('off the top the hold is kept with what it came to, and the next pillar from about here says it; at the foot the pillar is said as before', async () => {
  const { bot, threat } = pillarBot();
  const t0 = 1_800_000_000_000;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [], pillar: { x: 0, y: 60, z: 0, at: t0 - 1000 } }, client: { systemOne: async () => ({}) } });
  for (let s = 0; s <= 240; s += 15) await stanceAt(survival, t0 + s * 1000, [threat()], () => 'pillar');
  // Down at the column's foot, beside it: the hold ends.
  bot.entity.position = new Vec3(-0.5, 60, 0.5);
  const foot = await stanceAt(survival, t0 + 255000, [threat()], () => 'fight');
  assert.match(foot.tree.pillar.description, /^.*Go two blocks straight up on placed blocks and fight from there/);
  assert.doesNotMatch(foot.tree.pillar.description, /Up on this pillar/);
  assert.equal(foot.state.pillarSoFar, undefined);
  assert.equal(survival.state.pillarHolds.length, 1);
  assert.equal(survival.state.pillarHolds[0].ended, 'off the top');
  // Up again on a new pillar two blocks off, a minute later.
  survival.state.pillar = { x: -1, y: 60, z: 0, at: t0 + 300000 };
  bot.entity.position = new Vec3(-0.5, 62, 0.5);
  const solid = bot.blockAt;
  bot.blockAt = p => { const f = p.floored(); return f.x === -1 && f.z === 0 && f.y < 62 && f.y >= 60 ? { position: f, name: 'netherrack', boundingBox: 'block' } : solid(p); };
  let again;
  for (let s = 300; s <= 390; s += 15) again = await stanceAt(survival, t0 + s * 1000, [threat()], () => 'pillar');
  assert.match(again.tree.pillar.description, /Held a pillar from about here once before in the last 5 minutes, 4 minutes in all: nothing struck, nothing killed, no health lost; the last ended: off the top\./);
});

test('on its own pillar the way down is offered off its middle and under a cap with no side open at head height, as high as it went up (note 590)', () => {
  const { bot, threat } = pillarBot();
  // A fungus's cap a block over the top on every side but over the bot.
  const base = bot.blockAt;
  bot.blockAt = p => { const f = p.floored(); return f.y === 63 && !(f.x === 0 && f.z === 0) ? { position: f, name: 'nether_wart_block', boundingBox: 'block' } : base(p); };
  bot.entity.position = new Vec3(0.3, 62, 0.5);
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [], pillar: { x: 0, y: 60, z: 0, at: Date.now() - 60000 } } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  assert(options.come_down, Object.keys(options).join(','));
  assert.match(options.come_down.description, /^.*Come down the pillar the way it went up: the block under the feet is dug out and the bot drops onto the next, about a second each, 2 blocks down to the ground it went up from/);
});
