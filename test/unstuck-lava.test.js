'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { Task } = require('../src/skills');
const { localMoves, describeMove, liveView, perform } = require('../src/unstuck');

// Where mid-242-af-fortress-1 (25583) went into the lava sea at 11:37:41
// (note 600), from the region file its death snapshot saved at 11:37:11:
// x -110 to -98, y 29 to 43, z 99 to 114, the sea's top at y 31. The
// restock's dig of the netherrack at (-104, 39, 105), at 11:37:30 to 36,
// is taken out: the world the unstuck question was asked in at 11:37:39.6
// (its options, read from here, are the recorded ones word for word).
const LEDGE = require('./fixtures/unstuck-lava-mid-242-af.json');
const DUG = { '-104,39,105': 'air' };
function ledgeBot({ at = new Vec3(-103.69, 38, 104.62), set = {}, health = 19.6 } = {}) {
  const [ox, oy, oz] = LEDGE.origin, cells = { ...DUG, ...set }, cache = new Map();
  const nameAt = q => {
    const k = `${q.x},${q.y},${q.z}`;
    if (cells[k]) return cells[k];
    if (q.y - oy >= LEDGE.layers.length && q.x >= ox && q.z >= oz) return 'air';
    const ch = LEDGE.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox];
    return ch === undefined ? null : LEDGE.palette[ch.charCodeAt(0) - 97];
  };
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q.x},${q.y},${q.z}`;
    if (!cache.has(k)) {
      const name = nameAt(q);
      let b = null;
      if (name) {
        const [base, level] = name.split(':');
        const def = registry.blocksByName[base];
        b = level !== undefined ? Block.fromProperties(def.id, { level: Number(level) }, 0) : Block.fromStateId(def.defaultState, 0);
        b.position = q;
      }
      cache.set(k, b);
    }
    return cache.get(k);
  };
  const controls = {}, pressed = [];
  // What it carried: eleven gravel, the netherrack just dug, iron helmet and chestplate.
  const carried = [{ name: 'gravel', count: 11 }, { name: 'netherrack', count: 1 }, { name: 'iron_pickaxe', count: 1 }];
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 16, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, effects: {}, attributes: {} }, entities: {},
    inventory: { items: () => carried.map(i => ({ ...i, type: registry.itemsByName[i.name].id })), slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } } },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; if (v) pressed.push(k); }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    blockAt, pressed,
  });
  bot.lookAt = async p => { const e = bot.entity.position.offset(0, 1.62, 0); bot.entity.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); bot.entity.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)); };
  bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
  return bot;
}
// The body moved by prismarine-physics, twenty ticks a second.
function physics(bot) {
  const { Physics, PlayerState } = require('prismarine-physics');
  const { fixPlayerDimensions } = require('../src/compatibility');
  const world = { getBlock: p => bot.blockAt(p) };
  const ph = Physics(registry, world); fixPlayerDimensions(ph);
  const run = { lavaTicks: 0, lowest: bot.entity.position.y };
  run.timer = setInterval(() => {
    const s = new PlayerState(bot, Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, !!bot.controlState[k]])));
    ph.simulatePlayer(s, world); s.apply(bot);
    run.lowest = Math.min(run.lowest, bot.entity.position.y);
    if (require('../src/terrain').bodyInLava(bot)) run.lavaTicks++;
  }, 50);
  return run;
}
// The unstuck question as it was asked: the feet read at (-104, 40, 104)
// while the body fell from y 41 to 38.
const ASKED_AT = new Vec3(-104, 40, 104);

test('the step south\'s cell past it drops into the lava sea, and the step says so with what a touch costs (mid-242-af-fortress-1, note 600)', () => {
  const bot = ledgeBot({ at: new Vec3(-103.69, 40.77, 104.65) });
  const view = liveView(bot);
  const { moves } = localMoves(view, ASKED_AT, { goal: 'away', from: ASKED_AT });
  assert.deepEqual(moves.map(m => m.key).sort(), ['place_south', 'place_west', 'step_south', 'step_west'], 'the options recorded at 11:37:39.6');
  const south = moves.find(m => m.key === 'step_south');
  const said = describeMove(south);
  assert.match(said, /^Walk one block south, dropping 1\. one block past it, a drop of 7 blocks into lava under it: a fall there is into the lava \(One touch of lava costs/);
  assert.doesNotMatch(said, /falling 7 blocks costs about 4 health/, 'not a fall onto ground');
  assert.equal(south.pastLava, true);
});

test('a move read from a cell the body is not in is not run: the step south read at y 40 does nothing with the body landed at y 38 (mid-242-af-fortress-1, note 600)', async () => {
  const bot = ledgeBot({ at: new Vec3(-103.69, 40.77, 104.65) });
  const { moves } = localMoves(liveView(bot), ASKED_AT, { goal: 'away', from: ASKED_AT });
  const south = moves.find(m => m.key === 'step_south');
  bot.entity.position = new Vec3(-103.69, 38, 104.62);
  await assert.rejects(perform(bot, new Task('unstuck'), south, { dig: async () => {} }), /The body is at \(-104, 38, 104\), not at \(-104, 40, 104\) where the move was read/);
  assert.deepEqual(bot.pressed, [], 'no key pressed');
});

test('the moves are read once the body has landed: from y 38 no step south is offered, the netherrack there being a wall (note 600)', async () => {
  const { landed } = require('../src/unstuck');
  const bot = ledgeBot({ at: new Vec3(-103.69, 40.77, 104.65) });
  bot.entity.onGround = false;
  setTimeout(() => { bot.entity.position = new Vec3(-103.69, 38, 104.62); bot.entity.onGround = true; }, 150);
  const t0 = Date.now();
  await landed(bot, new Task('unstuck'));
  assert(Date.now() - t0 >= 100, 'waited for the landing');
  const feet = bot.entity.position.floored();
  assert.deepEqual([feet.x, feet.y, feet.z], [-104, 38, 104]);
  const { moves } = localMoves(liveView(bot), feet, { goal: 'away', from: feet });
  assert(!moves.some(m => m.key === 'step_south'), moves.map(m => m.key).join(', '));
  assert(moves.some(m => m.key === 'climb_south'), 'a climb onto the netherrack south instead');
});

test('the step as it was run from where the body landed, prismarine-physics moving it: it slid east off the ledge into the lava; now it stops at the edge of its two cells (mid-242-af-fortress-1, note 600)', { timeout: 15000 }, async () => {
  const bot = ledgeBot();
  const { moves } = localMoves(liveView(ledgeBot({ at: new Vec3(-103.69, 40.77, 104.65) })), ASKED_AT, { goal: 'away', from: ASKED_AT });
  // The recorded step, run from the cell it landed in as the old code ran it
  // (no check of where it was read from): its feet taken where the body is.
  const south = { ...moves.find(m => m.key === 'step_south') };
  delete south.from;
  const run = physics(bot);
  let failure = null;
  try { await perform(bot, new Task('unstuck'), south, { dig: async () => {} }); }
  catch (err) { failure = err.message; }
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 50));
  clearInterval(run.timer);
  assert.match(String(failure), /Left the cells of the step south at \(-103, 38, 104\); stopped/);
  assert.equal(run.lavaTicks, 0, `never in the lava, lowest y ${run.lowest.toFixed(2)}`);
  assert(bot.entity.position.y >= 38 - 1e-6 && bot.entity.onGround, `still on the ledge: ${bot.entity.position}`);
});

test('no unstuck move ends with the body in lava: a step onto soul sand level with a lava source beside is not offered, and says why (note 600)', () => {
  // Soul sand's top at .875, the lava source's surface at .889 (note 580).
  const cells = new Map();
  const put = (x, y, z, n) => cells.set(`${x},${y},${z}`, n);
  for (let x = -2; x <= 3; x++) for (let z = -2; z <= 2; z++) for (let y = 60; y <= 66; y++) put(x, y, z, y <= 61 ? 'netherrack' : 'air');
  put(1, 62, 0, 'soul_sand'); put(2, 62, 0, 'lava'); put(1, 62, 1, 'lava');
  for (const [x, z] of [[-1, 0], [0, 1], [0, -1]]) for (const y of [62, 63]) put(x, y, z, 'netherrack');
  put(0, 62, 0, 'netherrack');
  const view = { name: p => cells.get(`${p.x},${p.y},${p.z}`) ?? null,
    block: p => { const n = cells.get(`${p.x},${p.y},${p.z}`); if (!n) return null; const b = Block.fromStateId(registry.blocksByName[n].defaultState, 0); b.position = p; return b; },
    carried: {}, pickaxe: 'iron_pickaxe' };
  const { moves, here } = localMoves(view, new Vec3(0, 63, 0), { goal: 'away', from: new Vec3(0, 63, 0) });
  assert(!moves.some(m => m.to && m.to.x === 1 && m.to.y === 63 && m.to.z === 0), moves.map(m => m.key).join(', '));
  assert(here.notOffered.some(s => /^step east: the body would stand in lava at \(1, 63, 0\)/.test(s)), JSON.stringify(here.notOffered));
});

test('no unstuck move drops the floor stood on into lava: on gravel resting on the lava sea no pillar is offered (the beach of note 592, note 600)', () => {
  const BEACH = require('./fixtures/lava-gravel-mid-243-af.json');
  const [ox, oy, oz] = BEACH.origin;
  const nameAt = q => {
    if (q.y - oy >= BEACH.layers.length && q.x >= ox && q.z >= oz) return 'air';
    const ch = BEACH.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox];
    return ch === undefined ? null : BEACH.palette[ch.charCodeAt(0) - 97];
  };
  const block = p => { const name = nameAt(p); if (!name) return null; const [base, level] = name.split(':'); const def = registry.blocksByName[base];
    const b = level !== undefined ? Block.fromProperties(def.id, { level: Number(level) }, 0) : Block.fromStateId(def.defaultState, 0); b.position = p; return b; };
  const view = { name: p => block(p)?.name ?? null, block, carried: { netherrack: 8 }, pickaxe: 'iron_pickaxe' };
  // Where mid-243-af-nether-1 stood on the gravel at (-232, 32, 56), resting on the sea.
  const feet = new Vec3(-232, 33, 56);
  const { moves, here } = localMoves(view, feet, { goal: 'away', from: feet });
  assert(!moves.some(m => m.key === 'pillar'), moves.map(m => m.key).join(', '));
  assert(here.notOffered.some(s => /^pillar: the gravel underfoot at \(-232, 32, 56\) rests on lava/.test(s)), JSON.stringify(here.notOffered));
});

test('no dig down is offered whose drop ends in lava, and the dig beside says a drop into lava for what it is (note 600)', () => {
  // Stone, the floor over a shaft of air four deep onto lava, and the same beside to the east.
  const cells = { '0,70,0': 'air', '0,71,0': 'air', '1,70,0': 'stone', '1,69,0': 'air', '0,64,0': 'lava', '1,64,0': 'lava' };
  for (let y = 65; y <= 68; y++) { cells[`0,${y},0`] = 'air'; cells[`1,${y},0`] = 'air'; }
  const view = { name: p => cells[`${p.x},${p.y},${p.z}`] ?? 'stone', carried: {}, pickaxe: 'iron_pickaxe' };
  const { moves, here } = localMoves(view, new Vec3(0, 70, 0));
  assert(!moves.some(m => m.key === 'dig_down'), moves.map(m => m.key).join(', '));
  assert(here.notOffered.some(s => /^dig down: the body would fall into lava under \(0, 69, 0\)/.test(s)), JSON.stringify(here.notOffered));
  const east = moves.find(m => m.key === 'dig_east_feet');
  assert.match(describeMove(east), /a drop of 5 blocks into lava under it: a fall there is into the lava/);
});

// mid-242-ah-nether-2-fortress-2 (25592): at the end of its dirt span at
// (-168, 47, 26), gravel the only block carried and no pickaxe, from the
// region its death snapshot saved at 11:53:29 (x -172 to -162, y 28 to 50,
// z 18 to 30; the sea's top at y 31).
const SPAN = require('./fixtures/unstuck-span-mid-242-ah.json');
function spanView(cells = {}) {
  const [ox, oy, oz] = SPAN.origin;
  const nameAt = q => cells[`${q.x},${q.y},${q.z}`] ?? (() => { const ch = SPAN.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox]; return ch === undefined ? (q.y - oy >= SPAN.layers.length ? 'air' : null) : SPAN.palette[ch.charCodeAt(0) - 97]; })();
  const block = p => { const name = nameAt(p); if (!name) return null; const [base, level] = name.split(':'); const def = registry.blocksByName[base];
    const b = level !== undefined ? Block.fromProperties(def.id, { level: Number(level) }, 0) : Block.fromStateId(def.defaultState, 0); b.position = p; return b; };
  return { name: p => block(p)?.name ?? null, block, carried: { gravel: 14 }, pickaxe: null };
}

test('gravel is not put where nothing holds it: the space east over fifteen blocks to the lava sea is no step (mid-242-ah-nether-2-fortress-2, note 600)', () => {
  const feet = new Vec3(-168, 47, 26);
  const { moves, here } = localMoves(spanView(), feet, { goal: 'away', from: new Vec3(-168, 47, 22) });
  assert(!moves.some(m => m.key === 'place_east'), moves.map(m => m.key).join(', '));
  assert(here.notOffered.some(s => /^place east: a block that falls \(gravel\) put there falls at once, nothing under it holding it \(a drop of 15 blocks into lava under it/.test(s)), JSON.stringify(here.notOffered));
});

test('no climb onto gravel resting on nothing over the lava sea: the gravel put east was read before it fell, and the climb took the body after it (mid-242-ah-nether-2-fortress-2, note 600)', () => {
  // As the recorded options at 11:54:11.7 had it: the gravel east at the
  // feet, open over it, fifteen blocks of air under it to the sea.
  const feet = new Vec3(-168, 47, 26);
  const { moves, here } = localMoves(spanView({ '-167,47,26': 'gravel', '-167,48,26': 'air', '-167,49,26': 'air' }), feet, { goal: 'away', from: new Vec3(-168, 47, 22) });
  assert(!moves.some(m => m.key === 'climb_east'), moves.map(m => m.key).join(', '));
  assert(here.notOffered.some(s => /^climb east: the gravel it would end on at \(-167, 47, 26\) rests on open air: a block laid or dug beside it drops it, and the body with it, into the lava/.test(s)), JSON.stringify(here.notOffered));
});
