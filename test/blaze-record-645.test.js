'use strict';
// Note 645: how the fights that brought a rod went against the ones that ended in a death, read from the
// flight records (scripts/blaze-record.js --wins, --sequence, --answers), and what followed each kind of
// answer, said in the situation the bot is in (src/blaze-record.js), only where at least five fights are in
// the row. The glue on the stance's options is tested beside note 631's (blaze-record-631.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const record = require('../src/blaze-record');
const script = require('../scripts/blaze-record');

const T0 = Date.parse('2026-09-28T10:00:00Z');
const frame = (s, kind, snapshot, extra = {}) => ({ at: T0 + s * 1000, kind, snapshot: { dimension: 'the_nether', ...snapshot }, ...extra });
const bz = (...xs) => xs.map(([id, d, seen = true, y = 60]) => ({ name: 'blaze', id, d, seen, at: { x: d, y, z: 0 } }));
const stanceAt = (s, choice, health, mobs, state = {}) => frame(s, 'decision', { health, food: 20, position: { x: 0, y: 60, z: 0 }, mobs, equipment: { offhand: 'shield' },
  decision: { id: 'encounter_stance', path: [choice], state: { weapon: 'iron_sword', dropWithinThreeBlocks: null, ...state } } });

// A fight: cover, then a strike that kills the blaze at 3.5 blocks, and its rod.
const rodFight = () => [
  frame(0, 'observation', { health: 20, food: 20, inventory: { blaze_rod: 0, iron_sword: 1 }, equipment: { offhand: 'shield' } }),
  stanceAt(1, 'take_cover', 20, bz([1, 12], [2, 14], [3, 15]), { spawner: { blocksAway: 9, makes: 'blaze' } }),
  stanceAt(8, 'charge_nearest', 17.5, bz([1, 9], [2, 14], [3, 15]), { spawner: { blocksAway: 9, makes: 'blaze' } }),
  frame(12, 'survival', { health: 17.5, position: { x: 0, y: 60, z: 0 }, mobs: bz([1, 3.5], [2, 14], [3, 15]) }, { label: 'fight' }),
  frame(14, 'survival', { health: 17.5, position: { x: 0, y: 60, z: 0 }, mobs: bz([2, 14], [3, 15]) }, { label: 'fight' }),
  frame(16, 'observation', { health: 17.5, inventory: { blaze_rod: 1 } }),
  frame(20, 'survival', { health: 17.5, position: { x: 0, y: 60, z: 0 }, mobs: bz([2, 16], [3, 15]) }, { label: 'take cover' }),
];

test('a fight is described: its setting, the stances in order with health and blazes about, the kill and how soon the rod came', () => {
  const frames = rodFight();
  const [e] = script.fights(frames);
  const d = script.describe(frames, e);
  assert.equal(d.rod, true);
  assert.equal(d.died, false);
  assert.equal(d.spawnerNear, true);
  assert.equal(d.terrain, 'ground');
  assert.deepEqual(d.chain, ['take_cover', 'charge_nearest']);
  assert.deepEqual(d.seq.map(s => [s[0], s[1], s[2], s[3], s[4]]), [[0, 'take_cover', 20, 3, 1], [7, 'charge_nearest', 17.5, 3, 1]]);
  assert.equal(d.shield, true);
  assert.equal(d.weapon, 'iron_sword');
  assert.equal(d.n24start, 3, 'three distinct blazes within 24 in the first six seconds');
  assert.equal(d.kills, 1, 'the blaze that was 3.5 blocks off and is gone from the next frame');
  assert.equal(d.rodT, 15);
  assert.equal(d.rodKill.d, 3.5);
  assert.equal(d.rodKill.after, 2);
  assert.equal(d.first, 'take_cover');
});

test('a fight over a span, a drop at the feet, is a span; the blazes above the bot are counted by height', () => {
  const frames = [
    stanceAt(1, 'hold_on_span', 20, bz([1, 10, true, 66]), { dropWithinThreeBlocks: { blocksAway: 1, deadly: true } }),
    stanceAt(6, 'take_cover', 20, bz([1, 10, true, 66]), { dropWithinThreeBlocks: { blocksAway: 1, deadly: true } }),
  ];
  const [e] = script.fights(frames);
  const d = script.describe(frames, e);
  assert.equal(d.terrain, 'span');
  assert.equal(d.height, 6);
});

test('the answers\' rows: a fight counts once for a kind in a situation, a rod counts only if it came after the answer, a death after every answer of the fight', () => {
  const frames = rodFight();
  const [e] = script.fights(frames);
  const d = script.describe(frames, e);
  const rows = script.answerRows([d, { ...d, rod: false, rodT: null, died: true, seq: [[2, 'take_cover', 20, 3, 1, true, 'encounter_stance'], [5, 'take_cover', 12, 3, 1, true, 'encounter_stance']] }]);
  // Cover at 20 with 2-3 blazes at a spawner: both fights; the rod came at 16 s, after the answer at 1 s; one died.
  assert.deepEqual(rows['spawner|2-3|>16|cover'], [2, 1, 1]);
  assert.deepEqual(rows['spawner|2-3|*|cover'], [2, 1, 1]);
  // The second fight's later answer at 12 health is its own cell; the strike at 17.5 (2 blazes) is the first fight's alone, its rod after it.
  assert.deepEqual(rows['spawner|2-3|8-16|cover'], [1, 0, 1]);
  assert.deepEqual(rows['spawner|2-3|>16|strike'], [1, 1, 0]);
  // A rod that came before the answer is not one after it.
  const early = script.answerRows([{ ...d, rodT: 3 }]);
  assert.deepEqual(early['spawner|2-3|>16|strike'], [1, 0, 0]);
});

test('a kind of answer is said in a situation only where at least five fights are in its row, the finest row first, then any health', () => {
  assert.equal(record.MIN_FIGHTS, 5);
  const here = { spawner: true, blazes: 6, health: 20 };
  const row = record.rowOf(here, 'strike');
  assert.equal(row.any, false);
  assert.deepEqual([row.n, row.rods, row.died], record.ANSWERS['spawner|4+|>16'].strike);
  for (const cells of Object.values(record.ANSWERS)) for (const c of Object.values(cells)) assert(c[0] >= 5, 'no row under five fights');
  // Under 8 health at a spawner with four or more blazes there are too few strikes: the row at any health is said, and says so.
  // (spawner, two or three blazes, under 8 health: the cover, fight and heal rows have five or more, the strike row does not)
  const hurt = { spawner: true, blazes: 3, health: 5 };
  assert.equal(record.ANSWERS['spawner|2-3|<8'].strike, undefined);
  const wide = record.rowOf(hurt, 'strike');
  assert.equal(wide.any, true);
  assert.deepEqual([wide.n, wide.rods, wide.died], record.ANSWERS['spawner|2-3|*'].strike);
  // None anywhere: no sentence, and the paragraph names it as too few.
  const bot = { health: 5, food: 20, entity: { position: new Vec3(0, 60, 0) }, entities: {}, inventory: { slots: {} } };
  assert.equal(record.optionSays(bot, 'nothing_of_the_sort', { spawner: true }), '');
  const none = { spawner: false, blazes: 6, health: 20 };
  assert.equal(record.rowOf(none, 'fight'), null);
  assert.equal(record.optionSays({ ...bot, health: 20, entities: Object.fromEntries([1, 2, 3, 4].map(i => [i, { name: 'blaze', position: new Vec3(i, 60, 0), isValid: true }])) }, 'fight', { spawner: false }), '');
});

test('the paragraph says the rows in this situation, that they are not a trial, and how the rods came', () => {
  const blazes = Object.fromEntries([1, 2, 3, 4, 5].map(i => [i, { name: 'blaze', position: new Vec3(i * 2, 60, 0), isValid: true }]));
  const bot = { health: 20, food: 20, entity: { position: new Vec3(0, 60, 0) }, entities: blazes, inventory: { slots: {} } };
  const says = record.answersSay(bot, { spawner: true });
  const s = record.ANSWERS['spawner|4+|>16'];
  assert.match(says, /^In this situation \(a live blaze spawner within 16, four or more blazes within 16, health 20\)/);
  assert(says.includes(`a strike (close_in or charge_nearest: walking in on the blazes with the sword): ${s.strike[0]} fights, ${s.strike[1]} took a rod after it`));
  assert(says.includes(`cover (take_cover, back_to_wall, out_of_sight, corner_ambush, box_here, seal, shield_guard, dig_down, nook): ${s.cover[0]} fights`));
  assert.match(says, /not what an answer caused/);
  assert.match(says, /How the rods came in the fights of 2026-09-28 \(511 fights\), of the 61 that ended with a rod: 56 had a strike in them/);
  assert.match(says, /Fights with no strike took a rod in 5 of 360, and 60 of the 96 deaths with no rod were in them\./);
  assert.match(says, /this bot carries no shield/);
  const shielded = record.answersSay({ ...bot, inventory: { slots: { 45: { name: 'shield' } } } }, { spawner: true });
  assert.doesNotMatch(shielded, /this bot carries no shield/);
  // A kind with under five fights here is named as left out, not given a rate.
  assert.match(says, /Fewer than 5 fights, so not said: carrying on with the work\./);
});

test('--wins tables the rod fights against the deaths, --sequence the chains, each rate with its count', () => {
  const frames = rodFight();
  const [e] = script.fights(frames);
  const d = script.describe(frames, e);
  const died = { ...d, rod: false, rods: 0, rodT: null, died: true, chain: ['take_cover', 'retreat'], first: 'take_cover' };
  const w = script.winsTable([d, died, { ...died, died: false }]);
  assert.deepEqual(w.groups, { rod: 1, died: 1, neither: 1 });
  assert.equal(w.share['a kill'].rod, '100%');
  assert.equal(w.share['a kill'].died, '100%', 'the copies carry the same kills');
  const seq = script.sequenceTable([d, died], f => f.chain.join(' > '));
  assert.deepEqual(seq.map(r => [r.sequence, r.fights, r.rodFights, r.died]), [['take_cover > charge_nearest', 1, 1, 0], ['take_cover > retreat', 1, 0, 1]]);
  assert.deepEqual(script.wilson(0, 0), [0, 0]);
  assert.deepEqual(script.wilson(5, 10), [24, 76]);
});
