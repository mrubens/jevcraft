'use strict';
// Note 2131: past the stronghold with the ring known and the Nether holding
// nothing more, the kit's rungs back on the ladder after a death are offered
// beside the End first, as the Nether first is offered before it.
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { strategyOptions } = require('../src/strategy');

function fixture() {
  // The kit whole but for the bow, as full-3 stood at 01:14Z with the bow the ladder's one open rung.
  const items = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'fishing_rod'].map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 }, { name: 'string', count: 3 });
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival' }, registry: require('minecraft-data')('26.1'),
    health: 20, food: 20, isAlive: true, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(1540.5, 66, 1122.5) }, inventory: { items: () => items, slots: {} }, blockAt: () => null });
  const frames = Array.from({ length: 12 }, (_, i) => ({ position: { x: 2050 + (i % 4), y: 42, z: 1509 + Math.floor(i / 4) }, eye: true }));
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {},
    gameProgress: { milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: 2 }, stronghold_located: { at: 3, center: { x: 2052, y: 42, z: 1511 } }, end_entered: { at: 4 } } },
    endPortal: { center: { x: 2052, y: 42, z: 1511 }, frames, neededEyes: 0, litAt: '2026-10-26T00:00:00.000Z' }, rungOptIn: { bow: Date.now() } };
  return { bot, goal };
}

test('the kit rungs after an End death come with the End first, priced', () => {
  const { bot, goal } = fixture();
  const stage = { phase: 'bow', action: 'acquire', item: 'bow', count: 1 };
  const options = strategyOptions(bot, goal, stage, {});
  assert.ok(options.rung_bow, 'the bow is the ladder\'s rung');
  assert.ok(!options.nether_first, 'the Nether holds nothing more');
  assert.ok(options.end_first, `end_first offered: ${Object.keys(options)}`);
  assert.match(options.end_first.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Leave bow for later and go to the End portal now, with the kit carried now: the ring at \(2052, 42, 1511\), 64[23] blocks off, about 17 minutes' walk at the 38\.5 blocks a minute the bot's walks have made, stalls and detours counted, lit\. The kit as it stands is short of bow \(0 of 1\), arrow \(16 of \d+\)/);
  assert.match(options.end_first.description, / On full-2, the run that killed the dragon \(2026-10-20 to 10-24\), about 23 of its 109 hours went to kitting again in the Overworld after deaths in the End\. Without the bow: /);
  assert.equal(options.end_first.chat, "I'll leave the bow for later and go to the End portal now.");
});

test('chosen, the rungs are set aside to go without, and the End first is not offered again for them', async () => {
  const { bot, goal } = fixture();
  const stage = { phase: 'bow', action: 'acquire', item: 'bow', count: 1 };
  await strategyOptions(bot, goal, stage, {}).end_first.run();
  const { attemptsFor } = require('../src/progress');
  assert.match(attemptsFor(goal).of('rung').bow.why, /Jev chose the End first/);
  const { GOING_WITHOUT } = require('../src/game-progress');
  assert.ok(GOING_WITHOUT.test('Jev chose the End first'));
});

test('before the stronghold the End first is not offered', () => {
  const { bot, goal } = fixture();
  delete goal.gameProgress.milestones.stronghold_located;
  const options = strategyOptions(bot, goal, { phase: 'bow', action: 'acquire', item: 'bow', count: 1 }, {}) || {};
  assert.ok(!options.end_first);
});
