'use strict';
// Note 744: unstuck_move storms. Measured since 06:30Z 2026-09-30: 308 asks,
// 114 followed an answer that changed nothing, 0 held by unchanged.js
// (note 724) because its facts never match exactly (recentMoves and
// here.notOffered are stripped from the digest, but the rest of `here`
// and the tree's own per-move descriptions still differ ask to ask); peak
// 52 asks a minute, and on 25592, 25594 and 25595 (flight records read
// with scripts/unchanged-asks.js) the same feet came back to the same
// unstuck_move ask ten, twenty, even forty-five times in a minute. The one
// per-move memory unstuck.js already had for this question ("failed from
// this cell", since note 706) only looked back a minute (JUDGE_MS); at
// even a modest storm's pace that minute is gone long before the bot's
// own position is, and the same tried-and-failed move comes back on
// offer while the bot never left the cell it failed from. This file gives
// the three parts of the rule their own tests: (a) a move withdrawn once
// it leaves the block stood on unchanged, kept withdrawn with no clock on
// it, only the bot's own position; (c) escalating to a different question
// once the checked set is empty or none_good comes back twice in one
// spell; (d) the spell's own age and move count said on every ask.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const unstuck = require('../src/unstuck');
const { localMoves } = unstuck;

const view = (cells, extra = {}) => ({ name: p => cells[`${p.x},${p.y},${p.z}`] ?? (p.y >= 80 ? 'air' : 'stone'), carried: { cobblestone: 64 }, pickaxe: 'iron_pickaxe', ...extra });

test('(a) a move that left the block stood on unchanged is withdrawn until the bot stands somewhere else, with no clock on it', () => {
  // A block to dig east at the feet, from a stone pocket.
  const feet = new Vec3(40, 60, 46);
  const cells = { '40,60,46': 'air', '40,61,46': 'air', '41,60,46': 'stone' };
  const now = Date.now();
  // Tried once from here and it did not get there (the game refused it,
  // or it simply did not move the body): recorded the way workFree records
  // it, `reached: false`.
  const triedOnce = { move: 'dig_east_feet', from: `${feet}`, cell: '(41, 60, 46)', kind: 'dig', at: now - 3000, reached: false };
  const before = localMoves(view(cells), feet, { goal: 'sky' });
  assert(before.moves.some(m => m.key === 'dig_east_feet'), 'offered before anything is tried');
  const justAfter = localMoves(view(cells), feet, { goal: 'sky', last: triedOnce, recent: [triedOnce] });
  assert(!justAfter.moves.some(m => m.key === 'dig_east_feet'), justAfter.moves.map(m => m.key).join(', '));
  assert(justAfter.here.notOffered.some(s => /^dig east feet: tried 3 s ago, changed nothing, from this same cell; not offered again until the bot stands somewhere else$/.test(s)), justAfter.here.notOffered.join('\n'));
  // Five minutes on, still the same cell, still withdrawn: the old rule
  // only looked back a minute (JUDGE_MS), so a storm running longer than
  // that saw the same tried-and-failed move come back on offer while the
  // bot never left the cell. This is not a matter of the clock at all.
  const longAfter = localMoves(view(cells), feet, { goal: 'sky', last: { ...triedOnce, at: now - 5 * unstuck.JUDGE_MS }, recent: [{ ...triedOnce, at: now - 5 * unstuck.JUDGE_MS }] });
  assert(!longAfter.moves.some(m => m.key === 'dig_east_feet'), 'still withdrawn five minutes on, from the same cell');
  // From a different cell, it is untried and offered again.
  const elsewhere = localMoves(view(cells), feet, { goal: 'sky', last: { ...triedOnce, from: '(39, 60, 46)' }, recent: [{ ...triedOnce, from: '(39, 60, 46)' }] });
  assert(elsewhere.moves.some(m => m.key === 'dig_east_feet'), 'a try from a different cell does not withdraw it here');
  // Once the bot's own position changes and it comes back, its own later
  // move recorded from the new cell does not withdraw the one at this cell.
  const cameBack = localMoves(view(cells), feet, { goal: 'sky', recent: [triedOnce, { move: 'step_west', from: '(41, 60, 46)', cell: null, kind: 'move', at: now - 1000, reached: true }] });
  assert(!cameBack.moves.some(m => m.key === 'dig_east_feet'), 'the earlier failure from this same cell still holds');
});

test('(a) a move that got somewhere from this cell is not withdrawn, only ones that did not', () => {
  const feet = new Vec3(0, 60, 0);
  const cells = { '0,60,0': 'air', '0,61,0': 'air', '1,60,0': 'air', '1,61,0': 'air' };
  const reached = { move: 'step_east', from: `${feet}`, cell: null, kind: 'move', at: Date.now() - 2000, reached: true };
  const { moves } = localMoves(view(cells), feet, { goal: 'sky', last: reached, recent: [reached] });
  assert(moves.some(m => m.key === 'step_east'), 'a move that reached is offered like any other');
});

test('(c) an empty checked set escalates to a different question at once, not asked again as it is', async () => {
  const { workFree } = unstuck;
  const { Task } = require('../src/skills');
  // Sealed in solid stone on every side, nothing carried to place, no
  // pickaxe: nothing here is a dig against a diggable block, a step into a
  // standable cell, or a water move in water.
  const bot = { game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entity: { position: new Vec3(0.5, 60, 0.5), onGround: true }, entities: {},
    health: 20, food: 20, world: { raycast: () => null },
    blockAt: () => ({ name: 'obsidian', boundingBox: 'block' }),
    inventory: { items: () => [] }, chat() {} };
  const goal = {};
  let asked = 0;
  await assert.rejects(workFree(bot, new Task('free'), goal, () => {}, { client: { systemOne: async () => { asked++; return {}; } }, dig: async () => {}, aim: { goal: 'sky', aim: 'up to dry ground at the surface' } }),
    err => err.name === 'Stalled' && /no move here is checked against the world/.test(String(err.message || err.why || JSON.stringify(err))));
  assert.equal(asked, 0, 'the empty set is never sent to Jev at all');
  assert(goal.unstuck.escalated, 'kept, so the empty set is not walked into again unasked');
});

test('(c) none_good twice in one stuck spell escalates rather than asking the same set a third time', async (t) => {
  // npm test runs with JEV_NONE_GOOD=0 (note 722's comment: the test
  // runner's own env, so other tests don't need to opt out of none_good);
  // this test is about none_good itself, so it opts back in, the same way
  // note-722, none-good-691 and none-good-693 do.
  const env = process.env.JEV_NONE_GOOD;
  process.env.JEV_NONE_GOOD = '1';
  t.after(() => { if (env === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env; });
  const { workFree } = unstuck;
  const { Task } = require('../src/skills');
  // A cell two high in the rock, a block carried: moves are on offer, so
  // Jev is asked, but answers none_good both times.
  const air = new Set(['0,60,0', '0,61,0', '1,60,0', '1,61,0']);
  const bot = { game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entity: { position: new Vec3(0.5, 60, 0.5), onGround: true }, entities: {},
    health: 20, food: 20, world: { raycast: () => null },
    blockAt: p => { const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`; const open = air.has(k) || p.y >= 100; return { name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block', position: p }; },
    inventory: { items: () => [{ name: 'cobblestone', count: 12 }] }, chat() {} };
  const goal = {};
  let asked = 0;
  const client = { systemOne: async () => { asked++; return { answers: { branch_0: { choice: 'none_good', confidence: 0.2, probabilities: { none_good: 0.4 } } } }; } };
  await assert.rejects(workFree(bot, new Task('free'), goal, () => {}, { client, dig: async () => {}, aim: { goal: 'sky', aim: 'up to dry ground at the surface' } }),
    err => err.name === 'Stalled' && /none_good came back 2 times in this stuck spell/.test(String(err.message || err.why || JSON.stringify(err))));
  assert.equal(asked, 2, 'asked twice, not a third time');
  assert(goal.unstuck.escalated, 'kept, so the same set is not walked into again unasked');
});

test('(d) the spell says its own age and how many moves have been tried, on every ask', async () => {
  const { workFree } = unstuck;
  const { Task } = require('../src/skills');
  const air = new Set(['0,60,0', '0,61,0', '1,60,0', '1,61,0']);
  const bot = { game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entity: { position: new Vec3(0.5, 60, 0.5), onGround: true }, entities: {},
    health: 20, food: 20, world: { raycast: () => null },
    blockAt: p => { const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`; const open = air.has(k) || p.y >= 100; return { name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block', position: p }; },
    inventory: { items: () => [{ name: 'cobblestone', count: 12 }] }, chat() {} };
  const now = Date.now();
  const goal = { unstuck: { aim: 'up to dry ground at the surface', since: new Date(now - 45000).toISOString(), moves: [{ move: 'pillar', from: '(0, 60, 0)', at: now - 9000, reached: true }], visits: {} } };
  let seenState = null;
  const client = { systemOne: async ({ state }) => { seenState = state; return { answers: { branch_0: { choice: 'pillar', confidence: 0.6, probabilities: { pillar: 0.6 } } } }; } };
  // One pass is enough: perform() will throw on the mocked bot (no real
  // pillarUp), which is fine, the assertion is on what was asked.
  try { await workFree(bot, new Task('free'), goal, () => {}, { client, dig: async () => {}, aim: { goal: 'sky', aim: 'up to dry ground at the surface' }, maxMoves: 1 }); } catch (_) { /* perform() failing on the mock is not the point here */ }
  assert(seenState, 'Jev was asked');
  assert.match(seenState.spell, /^\d+ s into this stuck spell, 1 move tried so far$/);
});
