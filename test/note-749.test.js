'use strict';
// Note 749: questions asked round and round. Four pieces in the ask layer:
//   - a key names its thing (src/decisions/keys.js, define's `names`): 25594's
//     biome_2 was the jungle to the north and the forest to the east nine
//     seconds apart, and what had come of one was said on the other;
//   - a question asked round and round goes up (src/decisions/loops.js): the
//     spell of askings each within a minute of the one before, wherever the
//     bot walked between; none good at three of the last five, or six askings
//     over ninety seconds going nowhere, and the question above is asked;
//   - the hold of note 724 judged by what the answer could change (the
//     options, the kinds of mob that threaten), not every fact that drifts
//     (unchanged.js digest; test/note-724.test.js);
//   - a trip holds (src/intention.js tripOf): an option with a target it
//     walks to, or whose catalogue says where it goes, not a list of names.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { Vec3 } = require('vec3');
const decisions = require('../src/decisions');
const K = require('../src/decisions/keys');
const loops = require('../src/decisions/loops');
const intention = require('../src/intention');
const fixture = require('./fixtures/sheep-search-25594.json');
const underground = require('./fixtures/sheep-search-25594-underground.json');

const top = w => Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
// The biome an option's words name ("Walk to the birch forest 32 blocks south").
const biomeOf = words => /^Walk to the (.+?) \d+ blocks/.exec(words)?.[1] || null;
// The key the option has now: the biome by its name.
const rekey = (key, words) => /^biome_\d+$/.test(key) ? `biome_${K.name(biomeOf(words))}` : key;

test('every dynamic option says what its key names, and no key is a bare place in a list (lint, note 749)', () => {
  const bad = [];
  // A pattern whose varying part is only a number at its end (biome_\d+, walk_to_[1-3], go_to_spawner(_[23])?),
  // unless the number is an entity id, a villager's own trade, or the number keys.js gave the thing when first offered.
  const ORDINAL = /_(\\d\+|\[0-9\]\+|\[1-3\]|\[23\]|\\d)\)?\??\$?$/;
  for (const q of decisions.all()) {
    if (!q.tree) continue;
    for (const o of q.options || []) {
      if (o.dynamic && !o.names) bad.push(`${q.id} ${o.key || o.pattern}: no names`);
      if (o.pattern && ORDINAL.test(o.pattern) && !/entity id|trade|given when first offered/.test(o.names || '')) bad.push(`${q.id} ${o.pattern}: a bare ordinal (${o.names || 'names nothing'})`);
    }
  }
  assert.deepEqual(bad, []);
  // define() refuses a dynamic option that does not say it, or says a place in the list.
  assert.throws(() => decisions.define({ id: 'lint_749_a', area: 'resources', parent: null, kind: 'explore', primitive: 'choice', stakes: 'low', tree: true, question: 'q', trigger: 't', source: 's',
    options: [{ pattern: 'thing_\\d+', label: 'a thing', when: 'always', dynamic: true }] }), /to say what its key names/);
  assert.throws(() => decisions.define({ id: 'lint_749_b', area: 'resources', parent: null, kind: 'explore', primitive: 'choice', stakes: 'low', tree: true, question: 'q', trigger: 't', source: 's',
    options: [{ pattern: 'thing_\\d+', names: 'its place in the list', label: 'a thing', when: 'always', dynamic: true }] }), /to say what its key names/);
  // A thing without a name gets a number when first offered, kept for it: the same flock seen from elsewhere is the
  // same number, a new one the next, and two offered together never share one.
  const goal = {};
  assert.deepEqual(K.ids(goal, 'sheep_flock', [{ x: 100, y: 70, z: 5 }, { x: -40, y: 70, z: 0 }], { near: 24 }), [0, 1]);
  assert.deepEqual(K.ids(goal, 'sheep_flock', [{ x: -35, y: 70, z: 6 }, { x: 300, y: 70, z: 0 }, { x: 104, y: 70, z: 2 }], { near: 24 }), [1, 2, 0]);
  assert.deepEqual(K.ids(goal, 'spawner', [{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }], { base: 1 }), [1, 2], 'two offered together never share a number');
  assert.equal(K.name('Birch Forest'), 'birch_forest');
});

test('25594\'s sheep_search replayed: numbered keys named several biomes each; keyed by name, each names one and its history is its own', () => {
  const asks = fixture.asks;
  assert.equal(asks.length, 72);
  // As recorded: what each numbered key named across the thirteen minutes.
  const named = {};
  for (const a of asks) for (const [k, w] of Object.entries(a.options)) if (/^biome_\d+$/.test(k)) (named[k] ||= new Set()).add(biomeOf(w));
  assert.ok(named.biome_0.size >= 3 && named.biome_1.size >= 3 && named.biome_2.size >= 3, JSON.stringify(Object.fromEntries(Object.entries(named).map(([k, v]) => [k, [...v]]))));
  // biome_2 was the jungle to the north at 11:14:28 and the forest to the east nine seconds later (the critic's item 1).
  const at = t => asks.find(a => a.at.startsWith(t));
  assert.match(at('2026-09-30T11:14:28').options.biome_2, /jungle/);
  assert.match(at('2026-09-30T11:14:37').options.biome_2, /forest 32 blocks east/);
  // Keyed by name: a key's words name one biome at every asking.
  const now = {};
  for (const a of asks) for (const [k, w] of Object.entries(a.options)) if (/^biome_\d+$/.test(k)) (now[rekey(k, w)] ||= new Set()).add(biomeOf(w));
  for (const [k, v] of Object.entries(now)) assert.equal(v.size, 1, `${k}: ${[...v]}`);
  // And the answers chosen, counted by what they named: the forest was chosen under three different numbers.
  const byNumber = {}, byName = {};
  for (const a of asks) { if (!/^biome_/.test(a.choice)) continue; byNumber[a.choice] = (byNumber[a.choice] || 0) + 1; const n = rekey(a.choice, a.options[a.choice]); byName[n] = (byName[n] || 0) + 1; }
  const forestUnder = new Set(asks.filter(a => /^biome_/.test(a.choice) && biomeOf(a.options[a.choice]) === 'forest').map(a => a.choice));
  assert.ok(forestUnder.size >= 3, `the forest chosen as ${[...forestUnder]}`);
  assert.ok(byName.biome_forest >= 10, JSON.stringify(byName));
});

test('25594\'s sheep_search through the spell rule: it goes up to the rung\'s question within its first two minutes, not thirteen', () => {
  const asks = fixture.asks.map(a => ({ t: Date.parse(a.at), id: 'sheep_search', choice: rekey(a.choice, a.options[a.choice] || ''), pos: a.position, dimension: 'overworld', inventory: {}, noneGood: top(a.weights) === 'none_good' }));
  assert.equal(asks.filter(a => a.noneGood).length, 57, 'none good Jev\'s likeliest at 57 of the 72 askings recorded');
  const r = loops.replay(asks);
  assert.ok(r.ups.length >= 5, `sent up ${r.ups.length} times`);
  const first = r.ups[0];
  assert.ok(first.t - asks[0].t <= 2 * 60000, `the first went up ${Math.round((first.t - asks[0].t) / 1000)} s in`);
  // The first goes up for going nowhere (8 askings in two minutes, 28 blocks from where they began); later ones for none good.
  assert.match(first.why, /^\d+ askings over \d+ minutes have gone nowhere: \d+ blocks from where they began with nothing new carried$/);
  assert.ok(r.ups.some(u => /^none of its options was good at [345] of its last 5 askings$/.test(u.why)));
  assert.match(first.says, /^asked \d+ times in the last \d+ (seconds|minutes), each within 60 seconds of the one before \(answered .*\); the bot walked \d+ blocks meanwhile and is \d+ blocks from where these askings began; nothing new carried since the first of them; none of its options was good at \d+ of them$/);
  // The underground spell of 11:46 to 11:53Z: none good at 22 of 24, sent up by its sixth asking.
  const deep = underground.asks.map(a => ({ t: Date.parse(a.at), id: 'sheep_search', choice: rekey(a.choice, a.options[a.choice] || ''), pos: a.position, dimension: 'overworld', inventory: {}, noneGood: top(a.weights) === 'none_good' }));
  assert.equal(deep.filter(a => a.noneGood).length, 22);
  const d = loops.replay(deep);
  assert.ok(d.ups.length >= 3);
  assert.ok(d.ups[0].n <= 6, `at asking ${d.ups[0].n}`);
});

test('asked live with the recorded weights and walks: the spell is said from the third asking, and goes up to rung_progress with the answers resting', async () => {
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = path.join(os.tmpdir(), `missing-749-${process.pid}.jsonl`);
  const log = console.log; console.log = () => {};
  try {
    const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 18, game: { dimension: 'overworld' }, inventory: { items: () => [{ name: 'white_wool', count: 1 }] } };
    const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'bed' } };
    const seen = [];
    let escalated = null, n = 0;
    for (const a of fixture.asks.slice(0, 20)) {
      bot.entity.position = new Vec3(a.position.x, a.position.y, a.position.z);
      const tree = Object.fromEntries(Object.entries(a.options).map(([k, w]) => [rekey(k, w), { description: `${w}.` }]));
      const weights = Object.fromEntries(Object.entries(a.weights).map(([k, v]) => [k === 'none_good' ? k : rekey(k, a.options[k] || ''), v]));
      const client = { systemOne: async ({ state, questions }) => {
        seen.push(state);
        const keys = Object.keys(questions.branch_0.criteria), choice = top(weights);
        const probabilities = Object.fromEntries(keys.map(k => [k, weights[k] || 0]));
        return { answers: { branch_0: { choice: keys.includes(choice) ? choice : keys[0], confidence: 0.6, probabilities } } };
      } };
      n++;
      try { await decisions.decide('sheep_search', { client, bot, goal, tree, state: { biome: 'forest', searchingMinutes: 1 } }); }
      catch (err) { if (err.name !== 'Stalled') throw err; escalated = err.stall.escalated; break; }
    }
    assert.ok(escalated, `went up (after ${n} askings)`);
    assert.equal(escalated.from, 'sheep_search');
    assert.equal(escalated.to, 'rung_progress');
    assert.match(escalated.says, /none of its options was good at 3 of its last 5 askings/);
    assert.ok(n <= 12, `within twelve askings: ${n}`);
    assert.equal(seen[1].spellSoFar, undefined);
    assert.match(seen[2].spellSoFar, /^sheep search was asked 3 times in the last \d+ seconds?, each within 60 seconds of the one before/);
    // The answers of the spell rest from where it went up (the ledger), said at the next asking from there.
    const held = goal.tried.entries.filter(e => e.q === 'sheep_search' && e.held);
    assert.ok(held.length >= 2, JSON.stringify(held.map(e => e.method)));
    assert.ok((goal.tried.escalations || []).some(e => e.from === 'sheep_search' && e.to === 'rung_progress'));
  } finally {
    console.log = log;
    if (env.NONE === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env.NONE;
    if (env.LOG === undefined) delete process.env.JEV_MISSING_OPTIONS; else process.env.JEV_MISSING_OPTIONS = env.LOG;
  }
});

test('the stance, the body\'s way and the routing are said, never sent up', () => {
  const bot = { entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'the_nether' }, inventory: { items: () => [] } };
  const t0 = Date.now();
  for (let i = 0; i < 8; i++) loops.after(bot, 'encounter_stance', { choice: 'fight', noneGoodTop: true, now: t0 + i * 1000 });
  const r = loops.before(bot, 'encounter_stance', { now: t0 + 9000 });
  assert.equal(r.why, null);
  assert.match(r.says, /none of its options was good at 8 of them/);
  // A spell that went somewhere is not sent up for going nowhere.
  for (let i = 0; i < 8; i++) { bot.entity.position = new Vec3(i * 20, 64, 0); loops.after(bot, 'fortress_leg', { choice: 'leg_east', now: t0 + i * 20000 }); }
  assert.equal(loops.before(bot, 'fortress_leg', { now: t0 + 170000 }).why, null);
  // One that paced the same few blocks for two minutes is.
  for (let i = 0; i < 8; i++) { bot.entity.position = new Vec3(i % 2 ? 10 : 0, 64, 0); loops.after(bot, 'nether_gather', { choice: i % 2 ? 'leg_east' : 'leg_west', now: t0 + i * 20000 }); }
  assert.match(loops.before(bot, 'nether_gather', { now: t0 + 170000 }).why, /^9 askings over 3 minutes have gone nowhere: \d+ blocks? from where they began with nothing new carried$/);
});

test('below the surface, sheep_search offers the climb first with its cost; on it, the long walks one way', async () => {
  const home = require('../src/home-base');
  const exploration = require('../src/exploration');
  const surface = require('../src/surface');
  const realTrips = exploration.biomeTrips, realObs = surface.surfaceObserver, realClimb = surface.climbToSurface;
  exploration.biomeTrips = () => [{ x: 30, z: 0, biome: 'forest', distance: 32, direction: 'east', says: 'the forest 32 blocks east' }, { x: -30, z: 0, biome: 'birch_forest', distance: 32, direction: 'west', says: 'the birch forest 32 blocks west' }];
  const realDecide = decisions.decide;
  try {
    let asked = null;
    decisions.decide = async (id, opts) => { asked = opts; return { path: [Object.keys(opts.tree)[0]], stale: false }; };
    const bot = { entity: { position: new Vec3(0.5, 4, 0.5) }, game: { dimension: 'overworld', gameMode: 'survival' }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
      inventory: { items: () => [] }, blockAt: () => null, findBlocks: () => [], chat() {} };
    surface.surfaceObserver = () => () => false; surface.climbToSurface = () => 62;
    const goal = {};
    await home.searchForSheep(bot, { check() {}, opportunityClient: {} }, goal, () => {}, { explore: async () => {} });
    assert.ok(asked.tree.climb_first, Object.keys(asked.tree).join(', '));
    assert.match(asked.tree.climb_first.description, /^Climb to the surface first, about 62 blocks up, roughly \d+ minutes?/);
    assert.equal(asked.tree.explore_here, undefined);
    assert.ok(!Object.keys(asked.tree).some(k => /^far_/.test(k)), 'no long walk from underground');
    assert.ok(asked.tree.biome_forest && asked.tree.biome_birch_forest, 'the biomes by name');
    // On the surface: the long walks, one for each of four ways, with a target; chosen, one is held leg after leg.
    surface.surfaceObserver = () => () => true;
    asked = null;
    decisions.decide = async (id, opts) => { asked = opts; return { path: ['far_east'], stale: false }; };
    bot.entity.position = new Vec3(0.5, 64, 0.5);
    delete goal.woolSearch;
    await home.searchForSheep(bot, { check() {}, opportunityClient: {} }, goal, () => {}, { explore: async () => {} });
    assert.deepEqual(Object.keys(asked.tree).filter(k => /^far_/.test(k)), ['far_east', 'far_south', 'far_west', 'far_north']);
    assert.ok(asked.tree.far_east.target);
    assert.equal(goal.woolSearch.toward.far, 0);
    assert.equal(goal.woolSearch.toward.x, 129);
    // Arrived at the end of the first leg with no sheep: the next leg, not another asking.
    bot.entity.position = new Vec3(129, 64, 0.5);
    asked = null;
    await home.searchForSheep(bot, { check() {}, opportunityClient: {} }, goal, () => {}, { explore: async () => {}, navigate: async () => {} });
    assert.equal(asked, null, 'not asked between legs');
    assert.equal(goal.woolSearch.toward.legs, 2);
    assert.equal(goal.woolSearch.toward.x, 257);
  } finally { exploration.biomeTrips = realTrips; surface.surfaceObserver = realObs; surface.climbToSurface = realClimb; decisions.decide = realDecide; }
});

test('a trip holds by what the option is, not by its name: a walk to a place is held at its own question, leave_nether\'s restock_food is not turned round by go_back (the check-in\'s problem 3)', () => {
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 17 };
  // nether_gather's walk to a place: a target it walks to, so a trip, whatever its key.
  const goal = {};
  intention.after(bot, goal, 'nether_gather', ['walk_to_-176_44_-88'], { target: { x: -176, y: 44, z: -88 } });
  assert.equal(goal.intention.trip, 'its target');
  const g = intention.gate(bot, goal, 'nether_gather', { 'walk_to_-176_44_-88': { description: 'Walk.', target: { x: -176, y: 44, z: -88 } }, leg_west: { description: 'Search west.' }, without: { description: 'Without.' } });
  assert.deepEqual(Object.keys(g.tree), ['walk_to_-176_44_-88']);
  // 25590: leave_nether restock_food, then go_back nine seconds later. restock_food's catalogue says where its trip goes.
  const goal2 = {};
  intention.after(bot, goal2, 'leave_nether', ['restock_food'], {});
  assert.equal(goal2.intention.trip, intention.tripOf('leave_nether', 'restock_food'));
  const g2 = intention.gate(bot, goal2, 'leave_nether', { go_back: { description: 'Back through the portal.' }, restock_food: { description: 'Food here.' }, search_on: { description: 'On.' } });
  // search_on keeps on with what is under way (KEEP); go_back is withheld.
  assert.deepEqual(Object.keys(g2.tree), ['restock_food', 'search_on']);
  assert.deepEqual(g2.withheld, ['go_back']);
  // It ends on a named fact: health falling a blow's worth.
  bot.health = 15;
  assert.equal(intention.holding(bot, goal2), null);
  assert.match(goal2.intentionEnded.why, /^a real change: health 20 to 15/);
});

test('a rung set aside holds like a trip: win_strategy does not offer it back seconds later with nothing changed (25592 12:18:53Z, 25588 12:34:46Z)', async () => {
  const { setAside } = require('../src/progress');
  const bot = { entity: { position: new Vec3(10.5, 40, 10.5) }, health: 20, food: 20, game: { dimension: 'overworld' }, inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }] } };
  const goal = { kind: 'win', request: 'beat the game', survival: {} };
  // surface_trip's stay_below: "leave the iron pickaxe for now rather than climb all the way up for 1 oak log".
  setAside(goal, 'rung', 'iron_pickaxe', 'Jev chose to stay below rather than climb 60 blocks for 1 oak log', 30 * 60000);
  const offered = [];
  const client = { systemOne: async ({ state, questions }) => { offered.push({ state, keys: Object.keys(questions.branch_0.criteria) }); return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.8 } } }; } };
  const tree = () => ({ stage_iron_pickaxe: { description: 'Take the iron pickaxe back up now after all.', takeBack: 'iron_pickaxe' }, nether_first: { description: 'Go for the Nether now.' }, side_trip: { description: 'A side trip.' } });
  const d = await decisions.decide('win_strategy', { client, bot, goal, tree: tree(), state: {} });
  assert.deepEqual(offered[0].keys.filter(k => k !== 'none_good'), ['nether_first', 'side_trip']);
  assert.match(offered[0].state.asideHolds[0], /^stage iron pickaxe: not offered: the iron pickaxe was set aside \d+ seconds? ago \(Jev chose to stay below/);
  assert.notEqual(d.path[0], 'stage_iron_pickaxe');
  // Twenty blocks on, a named change: offered again.
  bot.entity.position = new Vec3(30.5, 40, 10.5);
  await decisions.decide('win_strategy', { client, bot, goal, tree: tree(), state: {} });
  assert.ok(offered[1].keys.includes('stage_iron_pickaxe'));
  assert.equal(offered[1].state.asideHolds, undefined);
});

test('answers thrown away as stale: a keep-on is kept, and from the second in a row a question whose facts are still changing is not sent (25585\'s upkeep, 12:44Z)', async () => {
  const log = console.log; console.log = () => {};
  try {
    const bot = { entity: { position: new Vec3(0.5, -53, 0.5) }, health: 20, food: 20, game: { dimension: 'overworld' }, inventory: { items: () => [] } };
    const goal = { kind: 'win', request: 'beat the game' };
    let asks = 0, answer = 'make_pickaxe';
    const client = { systemOne: async () => { asks++; return { answers: { branch_0: { choice: answer, confidence: 0.8 } } }; } };
    const tree = () => ({ make_pickaxe: { description: 'Make a pickaxe.' }, carry_on: { description: 'Carry on with the staircase.' } });
    let fresh = false;
    const ask = () => decisions.decide('upkeep', { client, bot, goal, tree: tree(), state: { step: 'staircase' }, isFresh: () => fresh });
    const a = await ask(); assert.equal(a.stale, true);
    const b = await ask(); assert.equal(b.stale, true);
    assert.equal(asks, 2);
    const t0 = Date.now();
    const c = await ask();
    assert.equal(c.stale, true); assert.match(c.notSent, /changing still/);
    assert.equal(asks, 2, 'not sent');
    assert.ok(Date.now() - t0 < 2000);
    // Holding still: sent; an answer that keeps on is kept though the facts moved under it.
    answer = 'carry_on';
    let calls = 0;
    // Still through the moment it is watched, then moving while it is out.
    const settling = () => ++calls > 4 ? false : true;
    const d = await decisions.decide('upkeep', { client, bot, goal, tree: tree(), state: { step: 'staircase' }, isFresh: settling });
    assert.equal(asks, 3);
    assert.equal(d.stale, false);
    assert.deepEqual(d.path, ['carry_on']);
    assert.equal(d.keptThroughChange, true);
  } finally { console.log = log; }
});
