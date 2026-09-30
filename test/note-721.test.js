'use strict';
// Note 721: a known fortress stays the target until Jev leaves it, told what
// reaching it needs (src/fortress-hold.js). The frames are the flight records
// of 25584 (mid-242-sa, 04:31 to 04:34Z on 2026-09-30) and 25592
// (mid-242-sc-fortress-1, 04:32 to 04:36Z), test/fixtures/leaving-721.json:
// each question's options as they were asked, the answer and the body.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { decide } = require('../src/decisions');
const tried = require('../src/tried');
const { isSetAside, setAside } = require('../src/progress');
const hold = require('../src/fortress-hold');
const { Task } = require('../src/skills');

const frames = require('./fixtures/leaving-721.json');
const frame = (port, at, id) => frames.find(f => f.port === port && f.at.slice(11, 19) === at && f.id === id);
const tree = (f, keys = Object.keys(f.options).filter(k => k !== 'none_good')) => Object.fromEntries(keys.map(k => [k, { description: f.options[k] }]));

// The bot as the frame has it: where it stood, its health and hunger and what it carried.
function frameBot(f) {
  const inv = Object.entries(f.inventory).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id ?? 1, durabilityUsed: 0 }));
  const said = [];
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health: f.health, food: f.food, foodSaturation: 2, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, said,
    entity: { position: new Vec3(f.position.x, f.position.y, f.position.z), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] }, time: { timeOfDay: 6000 }, chat(m) { said.push(m); }, world: { raycast: () => null },
  });
}
// Jev answering as recorded, or by the first of `picks` on offer; what it was asked is kept.
function jev(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => {
    const keys = Object.keys(questions.branch_0.criteria);
    asked.push({ keys, state, options: questions.branch_0.criteria });
    const choice = picks.find(p => keys.includes(p)) || keys[0];
    return { answers: { branch_0: { choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } } };
  } };
}

test('25584 04:33:41: the gathering under the fetch of stems with only `without` left is not taken unasked; the fetch fails and says why, the stems are not set aside as Jev\'s choice', async () => {
  const up = frame(25584, '04:33:41', 'upkeep');
  const bot = frameBot(up), goal = { kind: 'win' };
  const client = jev(['fetch_stems', 'leg_north']);
  const upkeep = await decide('upkeep', { client, bot, goal, tree: tree(up), state: { health: 20 } });
  assert.deepEqual(upkeep.path, ['fetch_stems']);
  assert.equal(goal.intention.choice, 'fetch_stems');
  // The gathering's way toward the warped forest 64 north, taken as the one way (without withheld under the fetch).
  const gather = () => ({ leg_north: { description: 'Search north for warped stems, 64 blocks to the warped forest noticed.' }, without: { description: 'Go on without the stems and a pickaxe: the fetch ends here and is not offered again for 10 minutes.' } });
  const first = await decide('nether_gather', { client, bot, goal, tree: gather(), state: {} });
  assert.deepEqual(first.path, ['leg_north']);
  // It ended at once (the flight record: no route), and rests from here.
  tried.hold(bot, goal, 'nether_gather', ['leg_north'], 'ended 0.2 seconds after it was chosen: No route from here to (-109, 50, 74)');
  const before = client.asked.length;
  // Recorded: "[one way] nether_gather: without, the only way offered", and
  // the stems set aside ten minutes as "Jev chose to go on without the stems".
  await assert.rejects(decide('nether_gather', { client, bot, goal, tree: gather(), state: {} }), /^Error: No way on for fetch stems from here: nether gather: the one option left from here, leg north, rests from here/);
  assert.equal(client.asked.length, before, 'nothing asked, nothing taken');
  assert.equal(goal.intention, undefined);
  assert.match(goal.intentionEnded.why, /^failed: nether gather: the one option left from here, leg north, rests/);
  assert.equal(isSetAside(goal, 'fetch_stems', 'nether'), false, 'not set aside as a choice Jev never made');
  // Asked again with the fetch ended, going without is Jev's, the resting leg beside it with its rest said.
  const again = await decide('nether_gather', { client: jev(['without']), bot, goal, tree: gather(), state: {} });
  assert.deepEqual(again.path, ['without']);
});

test('25584 04:33:44: with the walk and the staircase resting, keep_searching is not "the only way offered": the ways stay on offer with their rests said, and a lone leave is sent up, not taken', async () => {
  const f = frame(25584, '04:33:42', 'fortress_approach'), left = frame(25584, '04:32:52', 'fortress_approach');
  const bot = frameBot(f), goal = { kind: 'win' };
  const target = { x: -140, y: 49, z: 156 };
  const approach = () => ({ walk_route: { description: f.options.walk_route }, tunnel: { description: f.options.tunnel }, keep_searching: { description: left.options.keep_searching } });
  // Both ways came to nothing from here (the recorded [at once] and the walk's no route).
  tried.hold(bot, goal, 'fortress_approach', ['walk_route', 'tunnel'], 'ended 1.1 seconds after it was chosen: no nearer the fortress', { target });
  const client = jev(['keep_searching']);
  const d = await decide('fortress_approach', { client, bot, goal, tree: approach(), state: {}, target });
  assert.equal(client.asked.length, 1, 'asked, not taken');
  assert.deepEqual(client.asked[0].keys.filter(k => k !== 'none_good').sort(), ['keep_searching', 'tunnel', 'walk_route']);
  assert.match(client.asked[0].options.walk_route, /It rests \d+ minutes? more from here\./);
  assert.match(client.asked[0].options.tunnel, /It rests \d+ minutes? more from here\./);
  assert.deepEqual(d.path, ['keep_searching']);
  // A lone leave: the question above (fortress_leg) is asked with why, not the leave taken.
  const g2 = { kind: 'win' }, lone = jev(['keep_searching']);
  await assert.rejects(decide('fortress_approach', { client: lone, bot, goal: g2, tree: { keep_searching: { description: left.options.keep_searching } }, state: {}, target }), err => err.name === 'Stalled');
  assert.equal(lone.asked.length, 0);
  assert.match(tried.owed(g2, 'fortress_leg')[0], /keep searching, leaves it; leaving is not taken unasked/);
});

test('25584 04:31:17: leaving says what it leaves: the fortress 20 across and 23 up, the pickaxe one stem short, the fetch of stems set aside and why, the climb\'s blocks', () => {
  const f = frame(25584, '04:31:17', 'fortress_approach');
  const bot = frameBot(f), goal = { kind: 'win' };
  setAside(goal, 'fetch_stems', 'nether', 'Jev chose to go on without the stems', 10 * 60000);
  const here = bot.entity.position, target = new Vec3(Math.round(here.x) + 20, Math.round(here.y) + 22, Math.round(here.z));
  const says = hold.reachSays(bot, goal, { target, anchor: { x: -140, y: 43, z: 153 }, offered: tree(f), facts: { pillar: f.state.pillar, walkRoute: f.state.walkRoute } });
  assert.match(says, /^The fortress at \(-140, 43, 153\) is 2[01] blocks across and 23 up from here, and stays the search's target unless leaving it is chosen\./);
  assert.match(says, /Reaching it needs a pickaxe first \(none carried; short of 2 planks, 1 stem, for the sticks, the head, then a wooden pickaxe\): with one, rock is dug several times faster and the netherrack dug drops as blocks to lay/);
  assert.match(says, /blocks to climb with: 46 blocks wanted \(23 up, 23 across\), 0 carried; none by hand, the netherrack about with a pickaxe/);
  assert.match(says, /fetch stems \(none known\): set aside 10 minutes more, Jev chose to go on without the stems/);
  assert.match(says, /the ways in on offer: tunnel/);
  assert.match(says, /Searching on takes the same pockets to the next fortress \(no pickaxe, 0 blocks\)\.$/);
  assert(says.length < 800, `${says.length} characters`);
});

test('25592 04:36:33: heal_first is not offered at health 20 (it was taken at 0.95 and said "Healing before going into the fortress: health 20")', () => {
  const f = frame(25592, '04:36:33', 'fortress_visit');
  assert.equal(f.health, 20); assert.deepEqual(f.answer, ['heal_first']);
  const bot = frameBot(f);
  bot.inventory.slots = { 45: { name: 'shield' } };
  const tree = require('../src/fortress-visit').options(bot, null, { survival: { deaths: [] } }, () => {}, {}, { fortress: { distance: 10, height: -4, at: { x: -107, y: 73, z: 156 } }, leave: () => {}, reach: 'The fortress at (-107, 73, 156) is 10 blocks across from here, and stays the search\'s target unless leaving it is chosen.' });
  assert.equal(tree.heal_first, undefined);
  assert(tree.go_in);
  const { state } = require('../src/fortress-visit').facts(bot, { survival: { deaths: [] } }, { fortress: { distance: 10, height: -4 }, reach: () => 'The fortress at (-107, 73, 156) is 10 blocks across from here.' });
  assert.equal(state.leaving, 'The fortress at (-107, 73, 156) is 10 blocks across from here.', 'what leaving leaves is in the question');
});

test('25592 04:32:33: the approach 1 block from the fortress is asked with its ways; keep_searching is asked, never the one way', async () => {
  const f = frame(25592, '04:32:33', 'fortress_approach');
  assert.deepEqual(f.answer, ['keep_searching']);
  const bot = frameBot(f), goal = { kind: 'win' };
  const client = jev(['tunnel']);
  const d = await decide('fortress_approach', { client, bot, goal, tree: tree(f), state: {} });
  assert.equal(client.asked.length, 1);
  assert.deepEqual(d.path, ['tunnel']);
});

// A synthetic walk-through of the whole flow: a fortress corridor across a
// gap of lava from a ledge, a spawner inside, the bot with netherrack, a
// crafting table and nothing else. Sighting, the visit, the way in (the walk
// fails, and is said on the next asking), the fetch of stems chosen under it
// (runs and comes back), the way in again with a pickaxe, the floors, the
// spawner. Nothing leaves it along the way.
function world() {
  const dug = new Set(), laid = new Set();
  const floor = p => p.y === 64 && p.z >= -1 && p.z <= 1 && p.x >= 0 && p.x <= 40;
  const wall = p => (p.z === -2 || p.z === 2) && p.y >= 64 && p.y <= 67 && p.x >= 0 && p.x <= 40;
  const roof = p => p.y === 68 && p.z >= -2 && p.z <= 2 && p.x >= 0 && p.x <= 40;
  const ledge = p => p.y === 64 && p.x >= -12 && p.x <= -6 && p.z >= -2 && p.z <= 2;
  const solid = p => p.x === 30 && p.y === 65 && p.z === 0 ? 'spawner' : p.y <= 31 ? 'lava' : floor(p) || wall(p) || roof(p) ? 'nether_bricks' : ledge(p) ? 'netherrack' : null;
  const items = [{ name: 'netherrack', count: 64, type: registry.itemsByName.netherrack.id }, { name: 'crafting_table', count: 1, type: registry.itemsByName.crafting_table.id }, { name: 'iron_sword', count: 1, type: registry.itemsByName.iron_sword.id }];
  const at = p => {
    const key = `${p}`, name = laid.has(key) ? 'netherrack' : dug.has(key) ? null : solid(p);
    return { name: name || 'air', boundingBox: name && name !== 'lava' ? 'block' : 'empty', diggable: name !== 'bedrock', position: p, digTime: () => 400 };
  };
  let look = null;
  const controls = {}, said = [];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(-8.5, 65, 0.5) }, entities: {}, time: { timeOfDay: 6000 },
    inventory: { items: () => items.filter(i => i.count > 0), slots: [] }, chat(m) { said.push(m); }, said, blockAt: at, equip: async () => {}, lookAt: async p => { look = p; },
    placeBlock: async (ref, face) => { const p = ref.position.plus(face); laid.add(`${p}`); items[0].count--; },
    dig: async block => { dug.add(`${block.position}`); },
    setControlState: (name, on) => { controls[name] = on; if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, Math.floor(bot.entity.position.y), Math.floor(look.z) + 0.5); },
    getControlState: name => !!controls[name], clearControlStates() {} };
  bot.world = { raycast: (from, dir, range) => {
    const cell = from.floored(), step = ['x', 'y', 'z'].map(k => Math.sign(dir[k]));
    const next = ['x', 'y', 'z'].map((k, i) => step[i] ? ((step[i] > 0 ? cell[k] + 1 : cell[k]) - from[k]) / dir[k] : Infinity);
    const delta = ['x', 'y', 'z'].map((k, i) => step[i] ? Math.abs(1 / dir[k]) : Infinity);
    const c = [cell.x, cell.y, cell.z];
    let t = 0;
    for (let n = 0; n < 400; n++) {
      const p = new Vec3(c[0], c[1], c[2]);
      if (n > 0 && bot.blockAt(p)?.boundingBox === 'block') return { position: p, intersect: from.plus(dir.scaled(t)) };
      const i = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
      if (next[i] > range) return null;
      t = next[i]; c[i] += step[i]; next[i] += delta[i];
    }
    return null;
  } };
  bot.findBlocks = ({ matching, maxDistance = 128, count = 1 }) => {
    const ids = typeof matching === 'function' ? null : new Set(Array.isArray(matching) ? matching : [matching]), here = bot.entity.position, out = [];
    for (let x = -14; x <= 43; x++) for (let y = 58; y <= 69; y++) for (let z = -6; z <= 6; z++) {
      const p = new Vec3(x, y, z), b = bot.blockAt(p);
      const hit = ids ? ids.has(registry.blocksByName[b.name]?.id) : matching(b);
      if (hit && p.distanceTo(here) <= maxDistance) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(here) - b.distanceTo(here)).slice(0, count);
  };
  return { bot, items, laid };
}

test('the whole flow: sighted, visited, the walk failing said on the next asking, the stems fetched under it and back to it, the way in with a pickaxe, the floors and the spawner; nothing leaves it', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot, items } = world();
  const goal = { kind: 'win', fortressSearch: { axis: 1, legs: 3 }, survival: { deaths: [] } };
  const asked = [];
  // Jev: go in; walk the route first; with it failed, fetch the stems; with a pickaxe, straight across; on the floors, wait by the spawner.
  const client = { systemOne: async ({ state, questions }) => {
    const keys = Object.keys(questions.branch_0.criteria), q = keys.includes('go_in') ? 'fortress_visit' : ['keep_searching', 'walk_route', 'fetch_stems', 'cross_level', 'tunnel', 'pillar_up'].some(k => keys.includes(k)) && !keys.some(k => k.startsWith('leg_') || k.startsWith('walk_to_')) ? 'fortress_approach' : keys.includes('stay_in_fortress') || keys.some(k => k.startsWith('leg_')) ? 'fortress_leg' : 'other';
    asked.push({ q, keys, state, options: questions.branch_0.criteria });
    const order = { fortress_visit: ['go_in'], fortress_approach: ['walk_route', 'fetch_stems', 'cross_level'], fortress_leg: ['wait_at_spawner', 'go_to_spawner', 'stay_in_fortress'], other: [] }[q];
    const tries = asked.filter(a => a.q === q && a.keys.includes('walk_route')).length;
    // A spawner's key names where it is (note 749): go_to_spawner_x_y_z.
    const has = k => k === 'go_to_spawner' ? keys.find(x => x.startsWith('go_to_spawner_')) : keys.includes(k) ? k : null;
    let choice = order.map(k => (k === 'walk_route' && tries > 1) ? null : has(k)).find(Boolean) || keys.find(k => k !== 'none_good');
    return { answers: { branch_0: { choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } } };
  } };
  const walks = [];
  let refuseWalks = true;
  const actions = { client,
    navigate: async (b, t, g) => { walks.push(g); if (refuseWalks) throw new Error('No path to the goal!'); bot.entity.position = new Vec3((g.x ?? bot.entity.position.x) + 0.5, g.y ?? bot.entity.position.y, (g.z ?? bot.entity.position.z) + 0.5); },
    tunnel: async () => { throw new Error('no step toward it gains'); },
    // The stems and the pickaxe, each fetched or made as asked.
    acquireStep: async (b, t, item, want) => {
      const have = items.find(i => i.name === item);
      if (have) have.count = want; else items.push({ name: item, count: want, type: registry.itemsByName[item].id, durabilityUsed: 0 });
      return true;
    } };
  const pass = () => findFortressStep(bot, new Task('hunt'), goal, () => {}, actions).catch(err => { if (err.name !== 'Stalled') throw err; });
  // Sighted: the visit, then the way in; the walk is chosen and finds no path.
  await pass();
  assert.deepEqual(asked.map(a => a.q), ['fortress_visit', 'fortress_approach']);
  // Under the visit's go_in, leaving is not on offer at all: the way in is asked, and it says so.
  assert.match(asked[1].state.underWay, /^go in \(fortress visit, to \(0, 64, 0\)\).*not offered while it holds: keep searching$/);
  assert.deepEqual(goal.fortressSearch.approach.failed.map(f => f.choice), ['walk_route']);
  // The next asking says the walk's failure; the stems are fetched under the visit and it comes back.
  await pass();
  const second = asked.at(-1);
  assert.equal(second.q, 'fortress_approach');
  assert.match(second.options.walk_route || second.state.failed.join(' '), /No path to the goal!/);
  // Failed from where it still stands, with the same pockets: said as tried,
  // not offered again (note 750).
  assert.equal(second.options.walk_route, undefined);
  assert.match(second.state.triedFromHere.join(' '), /^walk route: tried from where the bot stands/);
  assert(second.keys.includes('fetch_stems'), second.keys.join(', '));
  assert(items.some(i => /_pickaxe$/.test(i.name) && i.count > 0), 'the stems fetched made the pickaxe');
  assert.equal(goal.intention?.choice, 'go_in', 'the visit still holds after the fetch: it was its way');
  // With the pickaxe, the way in again: straight across the lava.
  refuseWalks = false;
  for (let i = 0; i < 12 && bot.entity.position.x < 0; i++) await pass();
  assert(bot.entity.position.x >= 0, `on the fortress: ${bot.entity.position}`);
  // On the floors: walked to where they run on, and the spawner is where the blazes come from.
  for (let i = 0; i < 30 && !goal.fortressSearch.spawnerWait && goal.step?.action !== 'at_spawner'; i++) await pass();
  assert(goal.fortressSearch.spawnerWait || goal.step?.action === 'at_spawner', JSON.stringify(goal.step));
  assert.deepEqual(asked.map(a => a.q), ['fortress_visit', 'fortress_approach', 'fortress_approach', 'fortress_approach', 'fortress_leg']);
  assert.deepEqual([goal.fortressSearch.spawnerWait.x, goal.fortressSearch.spawnerWait.y, goal.fortressSearch.spawnerWait.z], [30, 65, 0]);
  // Nothing along the way left it.
  assert.equal((goal.fortressSearch.shunned || []).length, 0);
  assert(!bot.said.some(s => /^Leaving/.test(s)), bot.said.join(' | '));
});

test('25584 04:34:05: the leg question asked with the fortress in view says what leaving leaves, and a leg taken is the leaving, set aside once (not found again the next pass)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = world();
  const goal = { kind: 'win', fortressSearch: { axis: 1, legs: 3 }, survival: { deaths: [] } };
  tried.escalate(goal, { from: 'fortress_approach', to: 'fortress_leg', why: 'every way it had from here rests' });
  const asked = [];
  const client = { systemOne: async ({ state, questions }) => {
    const keys = Object.keys(questions.branch_0.criteria);
    asked.push({ keys, state });
    const choice = keys.includes('leg_west') ? 'leg_west' : keys.includes('go_in') ? 'go_in' : keys[0];
    return { answers: { branch_0: { choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } } };
  } };
  const actions = { client, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => { throw new Error('no step'); } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions).catch(err => { if (err.name !== 'Stalled') throw err; });
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg');
  assert.match(asked[0].state.fortressInView.leaving, /^The fortress at \(0, 64, 0\) is \d+ blocks across from here, and stays the search's target unless leaving it is chosen\..* Every leg, widen_search and seek_fortress_height leaves it\.$/);
  assert.equal(goal.fortressSearch.shunned.length, 1);
  assert.deepEqual(goal.fortressSearch.shunned[0].left, ['its ways in from here, then a leg away']);
  assert.match(bot.said.at(-1), /^Leaving the fortress at \(0, 64, 0\) for now, \d+ blocks off\. Searching on for another\.$/);
});

test('a stall with a fortress found and no approach under way yet is a failure on its approach, not a patch of it set aside (work.js looseEnds, note 721)', () => {
  const goal = { fortressSearch: { found: { x: 30, y: 64, z: 0 }, shunned: [] } };
  require('../src/work').looseEnds(goal);
  assert.equal(goal.fortressSearch.shunned.length, 0);
  assert.deepEqual(goal.fortressSearch.found, { x: 30, y: 64, z: 0 });
  assert.match(goal.fortressSearch.approach.failed[0].why, /the step stalled on the way in/);
});
