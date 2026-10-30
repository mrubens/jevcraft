'use strict';
// Note 2602: the record of what each answer at a blaze fight led to on the runs now playing, read from the runs' logs
// and said to Jev on each option and in the question's state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const script = require('../scripts/trials/blaze-outcomes');
const live = require('../src/blaze-outcomes');

const T0 = Date.parse('2026-10-30T16:00:00Z');
const at = s => new Date(T0 + s * 1000).toISOString();
const ask = (s, id, key, health, extra = {}) => JSON.stringify({ status: 'running', step: { action: 'close_in' }, decision: { at: at(s), askedAt: at(s - 0.1), id, path: [key], options: { [key]: {} }, state: { dimension: 'the_nether', health, threats: [{ name: 'blaze', distance: 5 }], ...extra } } });
const hp = (s, health) => JSON.stringify({ status: 'running', step: { action: 'x' }, decision: { at: at(s), askedAt: at(s), id: 'upkeep', path: ['carry_on'], state: { dimension: 'the_nether', health } } });

test('the tally: picks, a kill within two minutes, a death within two minutes, the health lost in thirty seconds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-outcomes-'));
  const lines = [
    ask(0, 'encounter_stance', 'charge_nearest', 20), hp(10, 17), '[blaze] one killed 3 blocks off under charge nearest, 1 in this fight of 0 minutes',
    ask(200, 'encounter_stance', 'take_cover', 18), hp(220, 12), JSON.stringify({ death: { status: 'pending', at: at(260), dimension: 'the_nether', position: { x: 0, y: 64, z: 0 } } }),
    ask(500, 'encounter_stance', 'charge_nearest', 20), hp(520, 20),
    // Out of the Nether: not counted. No blaze within sixteen: not counted.
    ask(700, 'encounter_stance', 'fight', 20, { dimension: 'overworld' }),
    JSON.stringify({ status: 'running', step: {}, decision: { at: at(800), askedAt: at(799), id: 'encounter_stance', path: ['fight'], state: { dimension: 'the_nether', health: 20, threats: [{ name: 'blaze', distance: 30 }] } } }),
    // The same asking twice in the log (its frames) is one pick.
    ask(900, 'empty_spawner', 'box_here', 20), ask(900, 'empty_spawner', 'box_here', 20),
  ];
  fs.writeFileSync(path.join(dir, 'first-days-full-1.log'), lines.join('\n') + '\n');
  const out = await script.compute({ dir, hours: 24 * 365 * 10 });
  const es = out.questions.encounter_stance;
  assert.deepEqual(es.charge_nearest, { n: 2, kill: 1, died: 0, lost: 1.5 });
  assert.deepEqual(es.take_cover, { n: 1, kill: 0, died: 1, lost: 6 });
  assert.equal(es.fight, undefined);
  assert.equal(out.questions.empty_spawner.box_here.n, 1);
});

test('said on the option from five picks, and the table of the ways on offer for the state, killers first', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-outcomes-')), 'blaze-outcomes.json');
  fs.writeFileSync(file, JSON.stringify({ from: '2026-10-29T19:00:00Z', to: '2026-10-30T19:20:00Z', questions: { encounter_stance: {
    corner_ambush: { n: 23, kill: 12, died: 2, lost: 1.6 }, take_cover: { n: 130, kill: 6, died: 20, lost: 0.8 }, close_in: { n: 12, kill: 12, died: 0, lost: 1 }, pillar: { n: 3, kill: 0, died: 1, lost: 2 } } } }));
  assert.match(live.ownSays('encounter_stance', 'corner_ambush', file), /^ In the record of the full runs of the last day, read at 19:20Z, this way chosen here 23 times: a blaze killed within two minutes after 12 \(52%\), a death within two minutes after 2 \(9%\), about 1\.6 health lost in the next thirty seconds\.$/);
  assert.equal(live.ownSays('encounter_stance', 'pillar', file), '', 'under five picks, nothing');
  assert.equal(live.ownSays('hunt_target', 'corner_ambush', file), '', 'another question, nothing');
  const table = live.tableSays('encounter_stance', ['take_cover', 'corner_ambush', 'close_in', 'pillar', 'none_good', 'seal'], file);
  assert.match(table, /^Of the ways on offer here, what each led to in the record of the full runs of the last day, read at 19:20Z \(times chosen; followed within two minutes by a blaze killed; by a death\): close in 12: a kill after 100%, a death after 0%; corner ambush 23: a kill after 52%, a death after 9%; take cover 130: a kill after 5%, a death after 15%\. A way not listed was chosen under five times\.$/);
  assert.equal(live.tableSays('encounter_stance', ['pillar'], file), '');
  assert.equal(live.tableSays('encounter_stance', ['take_cover'], path.join(path.dirname(file), 'none.json')), '', 'no record file, nothing said');
});

// Note 2605: the record on the price. A way whose picks were followed by a death in died-of-n of them carries that share
// of the health now over its estimate, as the push record does (note 2026), and says so.
test('the death rate of the record is folded into the stance price at a blaze fight, and said; nothing under ten picks', async () => {
  const { EventEmitter } = require('node:events');
  const { Vec3 } = require('vec3');
  const { Task } = require('../src/skills');
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-outcomes-')), 'blaze-outcomes.json');
  fs.writeFileSync(file, JSON.stringify({ from: '2026-10-29T20:00:00Z', to: '2026-10-30T20:40:00Z', questions: { encounter_stance: {
    take_cover: { n: 20, kill: 1, died: 10, lost: 1.1 }, keep_working: { n: 8, kill: 0, died: 4, lost: 1 } } } }));
  const mk = () => {
    const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].map(name => ({ name }));
    return Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, foodSaturation: 0, entities: {}, time: { timeOfDay: 6000 },
      entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, registry,
      inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'netherrack', count: 64 }, { name: 'cooked_beef', count: 3 }], slots: { 5: iron[0], 6: iron[1], 7: iron[2], 8: iron[3], 45: { name: 'shield' } } },
      blockAt: p => ({ position: p.floored(), name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', diggable: true }), world: { raycast: () => null }, findBlocks: () => [] });
  };
  const blaze = { entity: { id: 7, name: 'blaze', position: new Vec3(6.5, 65, 0.5), height: 1.8 }, distance: 6, visible: true };
  const ask = () => new Survival(mk(), { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } }).stanceOptions(new Task('x'), {}, () => {}, [blaze], false);
  const was = process.env.JEV_BLAZE_OUTCOMES;
  process.env.JEV_BLAZE_OUTCOMES = path.join(path.dirname(file), 'none.json');
  const plain = ask();
  process.env.JEV_BLAZE_OUTCOMES = file;
  const live = require('../src/blaze-outcomes');
  live.load(file); // the file read fresh, not the cached none
  const priced = ask();
  if (was === undefined) delete process.env.JEV_BLAZE_OUTCOMES; else process.env.JEV_BLAZE_OUTCOMES = was;
  assert.ok(plain.take_cover && priced.take_cover, `take_cover offered: ${Object.keys(plain)}`);
  assert.equal(Math.round((priced.take_cover.expects.damage - plain.take_cover.expects.damage) * 10) / 10, 10, 'half of 20 health added');
  assert.match(priced.take_cover.description, /this way chosen here 20 times: a blaze killed within two minutes after 1 \(5%\), a death within two minutes after 10 \(50%\)/);
  assert.match(priced.take_cover.description, /That death rate's share of the health now, about 10, is in this way's damage figure above/);
  assert.match(priced.take_cover.description, /^This way: about [\d.]+ damage/);
  assert.equal(priced.keep_working.expects.damage, plain.keep_working.expects.damage, 'eight picks price nothing');
});
