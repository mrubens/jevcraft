'use strict';
// 25583 (mid-243-ge, 2026-09-29 19:24:31-19:25:35Z): stuck 18 under the
// rock, 25 moves in a minute (pillar, dig down, pillar, dig up ...), each a
// cell up and back; note 671's rule judged a move against the one before
// only from the same cell, and a pillar stands the bot a cell up. And
// 25597 (mid-242-gf, 19:14-19:18Z): the fight chosen at a magma cube ended
// at once each time, the cube read as not coming between its hops (note 684).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const unstuck = require('../src/unstuck');

const view = (cells, extra = {}) => ({ name: p => cells[`${p.x},${p.y},${p.z}`] ?? (p.y >= 80 ? 'air' : 'stone'), carried: { cobblestone: 12 }, pickaxe: 'iron_pickaxe', ...extra });

test('the dig underfoot that takes the pillar just made away again is not offered, nor the pillar into the cell just dug', () => {
  // Pillared from (0, 64, 0) to (0, 65, 0): the block under the feet is the
  // one just put there, from the cell below.
  const cells = { '0,65,0': 'air', '0,66,0': 'air', '0,67,0': 'air', '0,64,0': 'cobblestone' };
  const feet = new Vec3(0, 65, 0);
  const last = { move: 'pillar', from: '(0, 64, 0)', cell: '(0, 64, 0)', kind: 'pillar', at: Date.now() - 1000 };
  const { moves, here } = unstuck.localMoves(view(cells), feet, { goal: 'sky', last });
  assert(!moves.some(m => m.key === 'dig_down'), moves.map(m => m.key).join(', '));
  assert(here.notOffered.some(s => /^dig down: it takes back the move before \(pillar\)/.test(s)));
  assert(moves.some(m => m.key === 'pillar'), 'up again is still offered');
  // Without it, the dig underfoot is a move like any.
  assert(unstuck.localMoves(view(cells), feet, { goal: 'sky' }).moves.some(m => m.key === 'dig_down'));
  // A minute gone, the move before is not the one it would take back.
  assert(unstuck.localMoves(view(cells), feet, { goal: 'sky', last: { ...last, at: Date.now() - 2 * unstuck.JUDGE_MS } }).moves.some(m => m.key === 'dig_down'));
  // Dug down into (0, 64, 0): the pillar would fill that cell again.
  const dug = { move: 'dig_down', from: '(0, 65, 0)', cell: '(0, 64, 0)', kind: 'dig', at: Date.now() - 1000 };
  const below = { '0,64,0': 'air', '0,65,0': 'air', '0,66,0': 'air' };
  const after = unstuck.localMoves(view(below), new Vec3(0, 64, 0), { goal: 'sky', last: dug });
  assert(!after.moves.some(m => m.key === 'pillar'), after.moves.map(m => m.key).join(', '));
  assert(after.here.notOffered.some(s => /^pillar: it takes back the move before \(dig down\)/.test(s)));
});

test('a minute of moves is judged by the aim: a cell up and back gains nothing, a new height does', () => {
  const now = Date.now(), aim = { goal: 'sky', aim: 'up to dry ground at the surface' };
  const ys = [-17, -18, -17, -18, -17, -16, -17, -18, -17];
  const moves = ys.map((y, i) => ({ move: i % 2 ? 'dig_down' : 'pillar', at: now - 65000 + i * 7000, measure: y }));
  const record = { startMeasure: -16, moves };
  const j = unstuck.judgeMinute(record, aim, now);
  assert.equal(j.spent, true);
  assert.match(j.says, /moves in the last 60 s: y -18 to y -17, the best y -16; the best before them y -16/);
  // A new best in the minute is a gain.
  const gained = unstuck.judgeMinute({ ...record, moves: [...moves, { move: 'pillar', at: now - 500, measure: -15 }] }, aim, now);
  assert.equal(gained.spent, false);
  // Less than a minute of moves is not judged yet.
  assert.equal(unstuck.judgeMinute({ startMeasure: -16, moves: moves.map(m => ({ ...m, at: m.at + 30000 })) }, aim, now).spent, false);
  // Out of the water: a cell not stood on before is the gain.
  const wet = { goal: 'dry', aim: 'out of the water onto dry ground' };
  assert.equal(unstuck.judgeMinute({ moves: moves.map(m => ({ ...m, measure: undefined })) }, wet, now).spent, true);
  assert.equal(unstuck.judgeMinute({ moves: moves.map((m, i) => ({ ...m, measure: undefined, fresh: i === 8 })) }, wet, now).spent, false);
});

test('working free after a minute that gained nothing asks the question above, not another move', async () => {
  const { workFree } = unstuck;
  const { Task } = require('../src/skills');
  // A cell two high in the rock, a block carried: moves are on offer.
  const air = new Set(['0,64,0', '0,65,0', '1,64,0', '1,65,0']);
  const bot = { game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, entities: {},
    health: 20, food: 20, world: { raycast: () => null },
    blockAt: p => { const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`; const open = air.has(k) || p.y >= 100; return { name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block', position: p }; },
    inventory: { items: () => [{ name: 'cobblestone', count: 12 }] }, chat() {} };
  const now = Date.now(), aim = { goal: 'sky', aim: 'up to dry ground at the surface' };
  const moves = [64, 65, 64, 65, 64, 65, 64, 65].map((y, i) => ({ move: i % 2 ? 'pillar' : 'dig_down', from: '(0, 64, 0)', at: now - 70000 + i * 9000, measure: y }));
  const goal = { unstuck: { aim: aim.aim, since: new Date(now - 70000).toISOString(), moves, visits: { '(0, 64, 0)': 8 }, startMeasure: 65 } };
  let asked = 0;
  await assert.rejects(workFree(bot, new Task('free'), goal, () => {}, { client: { systemOne: async () => { asked++; return {}; } }, dig: async () => {}, aim }),
    err => err.name === 'Stalled' && /working free \(up to dry ground at the surface\): \d+ moves in the last 60 s: y 64 to y 65, the best y 65; the best before them y 65; nothing gained toward the aim/.test(String(err.message || err.why || JSON.stringify(err))));
  assert.equal(asked, 0, 'no move asked for');
  assert(goal.unstuck.escalated, 'kept, so the stall does not begin it again unasked');
  assert.match(unstuck.spellRests(goal, new Vec3(0, 64, 0)), /ended on a minute of moves that gained nothing/);
  assert.equal(unstuck.spellRests(goal, new Vec3(20, 64, 0)), null, 'from elsewhere it is a new spell');
});

test('the fight at a magma cube the run found no way to is held for it, not ended: it hops at the bot it sees', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/survival'), 'utf8');
  assert.match(src, /const HOPPERS = new Set\(\['slime', 'magma_cube'\]\)/);
  assert.match(src, /const comesOn = \(WALKERS\.has\(nearest\.entity\.name\) \|\| HOPPERS\.has\(nearest\.entity\.name\)\) && !shooter\(nearest\.entity\) && \(coming\.includes\(nearest\) \|\| hopsAt\)/);
});

test('a step to firm ground is offered beside any drop a knock over hurts, its cost said, not only one of half the health', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/survival'), 'utf8');
  assert.match(src, /const groundBy = deepHere && \(deepHere\.into === 'lava' \|\| deepHere\.damage > 0\) && firmGround/);
});
