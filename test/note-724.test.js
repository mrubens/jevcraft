'use strict';
// Note 724: an answer that changed nothing is said, and its question is not
// asked again until something changes or a short, stated wait passes
// (src/decisions/unchanged.js), for every question about playing the game.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const unchanged = require('../src/decisions/unchanged');
const { decide } = require('../src/decisions');
const fixture = require('./fixtures/unchanged-25585-secure-shelter.json');

const TEST_HOLD = unchanged.HOLD_MS.slice();
const withHold = async (ms, fn) => { unchanged.setHold(ms); try { return await fn(); } finally { unchanged.setHold(TEST_HOLD); } };
const inventoryOf = counts => ({ items: () => Object.entries(counts).map(([name, count]) => ({ name, count })) });
const treeOf = keys => Object.fromEntries(keys.filter(k => k !== 'none_good').map(k => [k, { description: `The ${k.replaceAll('_', ' ')} way.` }]));
const recorded = a => ({ t: Date.parse(a.at), id: a.id, choice: a.choice, digest: unchanged.digest(fixture.states[a.state], treeOf(a.options)),
  mark: unchanged.markOf({ entity: { position: a.position }, health: a.health, inventory: inventoryOf(fixture.inventories[a.inventory]) }) });

test('the 25585 storm replayed: 44 asks of survival_priority in 16 seconds, sealed and changing nothing, come to a handful under the rule', () => {
  // 04:52:21 to 04:52:37Z: secure_shelter chosen 42 times running at five a second, the bot on one block with the
  // same things carried. Each ask whose last answer changed nothing with the same facts, inside its wait, is held.
  const asks = fixture.asks.map(recorded);
  assert.equal(asks.length, 44);
  assert.equal(asks.filter(a => a.choice === 'secure_shelter').length, 42);
  unchanged.setHold([10000, 30000, 60000]);
  let held; try { held = unchanged.replay(asks); } finally { unchanged.setHold(TEST_HOLD); }
  const sent = asks.length - held.length;
  assert.ok(held.length >= 35, `held ${held.length}`);
  assert.ok(sent <= 8, `sent ${sent}`);
  // Every ask the rule lets through has new facts, or its wait has passed.
  const heldSet = new Set(held);
  const through = asks.filter(a => !heldSet.has(a));
  for (let i = 1; i < through.length; i++) assert.ok(through[i].digest !== through[i - 1].digest || through[i].t - through[i - 1].t >= 10000, `ask ${i} let through with nothing new`);
});

test('asked live with the recorded facts: held for the stated wait, then asked with "chosen N seconds ago and changed nothing" said', async () => {
  const a = fixture.asks[1];
  const bot = { entity: { position: new Vec3(a.position.x, a.position.y, a.position.z) }, health: a.health, food: a.food, game: { dimension: 'overworld' }, inventory: inventoryOf(fixture.inventories[a.inventory]) };
  const goal = { kind: 'win', request: 'beat the game' };
  const seen = [];
  // Jev's answer as recorded, while it is on offer (the ledger rests it after two tries from here that came to nothing).
  const client = { systemOne: async ({ state, questions }) => { seen.push({ state, options: questions.branch_0, at: Date.now() }); const keys = Object.keys(questions.branch_0.criteria); return { answers: { branch_0: { choice: keys.includes('secure_shelter') ? 'secure_shelter' : keys[0], confidence: 0.9 } } }; } };
  await withHold([200, 400, 800], async () => {
    const start = Date.now();
    let loops = 0;
    // The survival step's own loop, asking again as soon as its answer returns (refugeStep, already sealed, does nothing).
    while (Date.now() - start < 1000) { loops++; await decide('survival_priority', { client, bot, goal, tree: treeOf(a.options), state: { ...fixture.states[a.state] } }); }
    assert.ok(loops <= 4, `the loop went round ${loops} times`);
    assert.ok(seen.length <= 4, `asked ${seen.length} times in a second`);
    assert.ok(seen[1].at - seen[0].at >= 180, 'the second asking waited the first hold');
  });
  assert.equal(seen[0].state.answerChangedNothing, undefined);
  assert.match(seen[1].state.answerChangedNothing, /^secure shelter was chosen \d+ seconds? ago and changed nothing \(the bot on the same block, carrying the same, no block dug or placed, health as it was\); this question was held \d+ seconds? for something to change, and nothing changed meanwhile\.$/);
  // Said on the option once: here the ledger's own words say it (tried.js), and the rule's are not added beside them.
  assert.match(JSON.stringify(seen[1].options), /The secure shelter way\. Tried once from here in the last \d+ seconds?, and it came to nothing/);
  assert.doesNotMatch(JSON.stringify(seen[1].options), /Chosen \d+ seconds? ago, and it changed nothing/);
  assert.match(JSON.stringify(seen[1].options), /answerChangedNothing: this question's last answer ended/, 'the fact is glossed in the instructions');
  if (seen[2]) assert.match(seen[2].state.answerChangedNothing, /the last 2 answers to this question in a row changed nothing/);
  console.log(`asked ${seen.length} times in a second: ${seen.map(x => x.at - seen[0].at).join(', ')} ms`);
});

test('a hold ends when the bot moves: the question comes back stale, to be built afresh, and is not held again', async () => {
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, game: { dimension: 'overworld' }, inventory: inventoryOf({ cobblestone: 10 }) };
  const goal = { kind: 'win' };
  let asks = 0;
  const client = { systemOne: async () => { asks++; return { answers: { branch_0: { choice: 'ore_0', confidence: 0.9 } } }; } };
  const tree = { ore_0: { description: 'Iron ore 6 blocks off.' }, branch: { description: 'A branch tunnel.' } };
  const ask = () => decide('night_mine_target', { client, bot, goal, tree, state: { ore: 'iron' } });
  await withHold([5000, 5000, 5000], async () => {
    await ask();
    setTimeout(() => { bot.entity.position = new Vec3(2.5, 64, 0.5); }, 100);
    const t0 = Date.now();
    const r = await ask();
    assert.ok(Date.now() - t0 < 2000, 'ended by the move, not the wait');
    assert.equal(r.stale, true);
    assert.match(r.heldUnchanged.changed, /^moved 2 blocks$/);
    assert.equal(asks, 1);
    const next = await ask();
    assert.deepEqual(next.path, ['ore_0']);
    assert.equal(asks, 2, 'asked at once: something changed');
  });
  // What is carried changing counts the same.
  const m = unchanged.markOf(bot);
  bot.inventory = inventoryOf({ cobblestone: 9 });
  assert.match(unchanged.changed(m, unchanged.markOf(bot)), /^what is carried changed \(-1 cobblestone\)$/);
  bot._stalls = { marked: 1 };
  assert.equal(unchanged.changed({ ...m, inv: { cobblestone: 9 } }, unchanged.markOf(bot)), 'a block was dug or placed');
});

test('a reflex stops a hold as it stops a question out', async () => {
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, game: { dimension: 'overworld' }, inventory: inventoryOf({}) };
  const goal = { kind: 'win' };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'ore_0', confidence: 0.9 } } }) };
  const tree = { ore_0: { description: 'Iron ore.' }, branch: { description: 'A branch tunnel.' } };
  let threat = false;
  const interrupt = () => { if (threat) throw new Error('Threat nearby: zombie at 3 blocks'); };
  await withHold([5000, 5000, 5000], async () => {
    await decide('night_mine_target', { client, bot, goal, tree, state: {}, interrupt });
    setTimeout(() => { threat = true; }, 100);
    const t0 = Date.now();
    await assert.rejects(decide('night_mine_target', { client, bot, goal, tree, state: {}, interrupt }), /Threat nearby/);
    assert.ok(Date.now() - t0 < 2000);
  });
  assert.equal(bot._turn, null, 'the turn given back');
});

test('the stance and the body\'s own questions are said, never held; new facts are asked at once, with the answer that changed nothing said', async () => {
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, game: { dimension: 'overworld' }, inventory: inventoryOf({}) };
  const goal = { kind: 'win' };
  const seen = [];
  const client = { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: 'pillar', confidence: 0.6 } } }; } };
  const stance = { pillar: { description: 'Two up.' }, fight: { description: 'Fight.' } };
  await withHold([5000, 5000, 5000], async () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await decide('encounter_stance', { client, bot, goal, tree: stance, state: { threats: [{ name: 'piglin', distance: 7.8 }] } });
    assert.ok(Date.now() - t0 < 2000, 'not held');
    assert.match(seen[2].answerChangedNothing, /^pillar was chosen \d+ seconds? ago and changed nothing .*; the last 2 answers to this question in a row changed nothing\.$/);
    // New facts: asked at once, the answer that changed nothing said.
    const t1 = Date.now();
    await decide('night_mine_target', { client: { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: 'ore_0', confidence: 0.9 } } }; } }, bot, goal, tree: { ore_0: { description: 'Ore.' }, branch: { description: 'Branch.' } }, state: { ore: 'iron' } });
    await decide('night_mine_target', { client: { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: 'branch', confidence: 0.9 } } }; } }, bot, goal, tree: { ore_0: { description: 'Ore.' }, branch: { description: 'Branch.' } }, state: { ore: 'gold' } });
    assert.ok(Date.now() - t1 < 2000, 'new facts: not held');
    assert.match(seen.at(-1).answerChangedNothing, /^ore 0 was chosen \d+ seconds? ago and changed nothing \(the bot on the same block, carrying the same, no block dug or placed, health as it was\)\.$/);
  });
});

test('the question\'s own facts leave out the record of the answers; the world\'s facts and the options offered count', () => {
  const tree = { leg_east: {}, leg_west: {} };
  const a = unchanged.digest({ lastLeg: 'east, ended no nearer', legsSoFar: 9, legsResting: ['leg north'], lastIntention: 'x', fortressInView: { passes: 3 }, threatsInView: [] }, tree);
  const b = unchanged.digest({ lastLeg: 'west, ended no nearer: out of blocks', legsSoFar: 10, legsResting: ['leg north', 'leg south'], lastIntention: 'y', fortressInView: { passes: 3 }, threatsInView: [] }, tree);
  assert.equal(a, b);
  assert.notEqual(a, unchanged.digest({ fortressInView: { passes: 3 }, threatsInView: ['magma cube 6 blocks off'] }, tree));
  assert.notEqual(a, unchanged.digest({ fortressInView: { passes: 3 }, threatsInView: [] }, { leg_east: {} }), 'an option left out is a change');
  assert.equal(unchanged.digest({ here: { notOffered: ['a'], floor: 'stone' } }, tree), unchanged.digest({ here: { notOffered: ['b'], floor: 'stone' } }, tree), 'at any depth');
});

test('an option whose goal is already so is not offered, and that is said; with every option so, each says it on itself', async () => {
  const done = unchanged.satisfiedGate({ secure_shelter: { description: 'Seal a room.', satisfied: 'the bot is sealed in its pocket now' }, continue_request: { description: 'Go on.' }, stash_valuables: { description: 'Stash.' } });
  assert.deepEqual(Object.keys(done.tree), ['continue_request', 'stash_valuables']);
  assert.deepEqual(done.facts, ['secure shelter: not offered, already so: the bot is sealed in its pocket now.']);
  const all = unchanged.satisfiedGate({ a: { description: 'A.', satisfied: 'done' }, b: { description: 'B.', satisfied: 'done too' } });
  assert.deepEqual(Object.keys(all.tree), ['a', 'b']);
  assert.equal(all.tree.a.description, 'A. Already so: done');
  // Through decide: left out of what is asked, said in the facts.
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, game: { dimension: 'overworld' }, inventory: inventoryOf({}) };
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, questions }; return { answers: { branch_0: { choice: 'continue_request', confidence: 0.9 } } }; } };
  await decide('survival_priority', { client, bot, goal: { kind: 'win' }, state: {}, tree: { secure_shelter: { description: 'Seal a room.', satisfied: 'the bot is sealed in its pocket now' }, continue_request: { description: 'Go on.' }, stash_valuables: { description: 'Stash.' } } });
  assert.doesNotMatch(JSON.stringify(asked.questions), /Seal a room/);
  assert.deepEqual(asked.state.alreadySo, ['secure shelter: not offered, already so: the bot is sealed in its pocket now.']);
});
