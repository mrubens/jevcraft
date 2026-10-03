'use strict';
const test = require('node:test');
const { Vec3 } = require('vec3');
const assert = require('node:assert/strict');
const { villageState, villageCandidates, chooseVillagePart, nextDreamRequest, shouldLaunchDream, resolveDream, VILLAGE_LEVELS, COOLDOWN_MS } = require('../src/dream');
const { preparationStage } = require('../src/game-progress');

const structure = (name, request, extra = {}) => ({ id: name, name, request, status: 'complete', standing: 100, origin: { x: 0, y: 64, z: 0 }, entrance: { x: 1, y: 64, z: -1 }, distance: 5, builtAt: '2026-09-21T05:00:00Z', ...extra });

test('the village is read off what stands, and candidates respect limits and the designer', () => {
  const structures = [structure('Cottage', 'build a small cottage'), structure('Cottage 2', 'build a small cottage', { builtAt: '2026-09-21T06:00:00Z' }),
    structure('Ruin', 'build a small cottage', { standing: 20 }), structure('Tower', 'build a tall watchtower')];
  const state = villageState(structures);
  assert.deepEqual([state.total, state.counts.cottage, state.counts.tower], [3, 2, 1]);
  const offered = villageCandidates(structures, { available: ['cottage', 'mansion', 'tower', 'well'] });
  assert.deepEqual(Object.keys(offered).sort(), ['cottage', 'mansion', 'well'], 'the tower is standing; only parts the shelf holds are offered');
});

test('Jev picks the next part and scores the village; an unoffered part is refused', async () => {
  const structures = [structure('Cottage', 'build a small cottage')];
  let asked;
  const shelf = [{ id: 'tiny', part: 'cottage', source: { name: 'Tiny Cottage', size: [5, 6, 5] }, summary: { name: 'Tiny Cottage', size: '5x5, 6 tall', blocks: 110, materials: '90 oak planks' } },
    { id: 'birch', part: 'cottage', source: { name: 'Birch Cottage', size: [11, 10, 9] }, summary: { name: 'Birch Cottage', size: '11x9, 10 tall', blocks: 396, materials: '200 birch planks' } },
    { id: 'tower', part: 'tower', source: { name: 'Tower' }, summary: { name: 'Tower', size: '9x9, 14 tall', blocks: 600, materials: 'sandstone' } }];
  const client = { systemOne: async ({ questions, state }) => {
    if (questions.design) return { answers: { design: { choice: 'birch', confidence: 0.8 } } };
    asked = { questions, state };
    return { answers: { part: { choice: 'cottage', confidence: 0.8, probabilities: { cottage: 0.8, mansion: 0.1, done: 0.1 } }, progress: { type: 'score', score: 0.3, confidence: 0.9 } }, usage: { input_tokens: 400 } };
  } };
  const chosen = await chooseVillagePart(client, { structures, available: ['cottage', 'tower'] });
  assert.equal(asked.questions.progress.type, 'score'); assert.deepEqual(asked.questions.progress.criteria, VILLAGE_LEVELS);
  assert.equal(asked.state.standing.length, 1);
  assert.equal(chosen.part, 'cottage'); assert.equal(chosen.score, 0.3); assert.equal(chosen.done, false);
  const next = await nextDreamRequest(client, { dream: 'build_a_village', setBy: 'Player' }, { structures, shelf });
  assert.equal(next.kind, 'build'); assert.equal(next.request, 'build Birch Cottage (cottage)'); assert.equal(next.from, 'Player');
  assert.equal(next.design.libraryId, 'birch'); assert.equal(next.design.backend, 'schematic-library');
  assert.deepEqual(next.buildAnchor, { x: 1, y: 64, z: -1 }, 'placed beside the newest standing structure');
  assert.equal(next.buildContinuation.placement, 'beside_target');
  await assert.rejects(chooseVillagePart({ systemOne: async () => ({ answers: { part: { choice: 'castle' }, progress: { score: 1 } } }) }, { structures, available: ['cottage'] }), /not offered/);
  // With the designer (Creative) the part is drawn, not taken off the shelf.
  const drawn = await nextDreamRequest({ systemOne: async ({ questions }) => {
    assert(!questions.design, 'no shelf design is chosen when the designer draws');
    return client.systemOne({ questions, state: {} });
  } }, { dream: 'build_a_village', setBy: 'Player' }, { structures, shelf, designer: true });
  assert.equal(drawn.kind, 'build'); assert.equal(drawn.design, undefined); assert.equal(drawn.villagePart, 'cottage');
  assert.match(drawn.request, /cottage/, 'the request still names the part, so the village counts it once built');
  assert.equal(drawn.buildContinuation.placement, 'beside_target');
  const done = await nextDreamRequest({ systemOne: async () => ({ answers: { part: { choice: 'done' }, progress: { score: 3 } } }) }, { dream: 'build_a_village' }, { structures, shelf });
  assert.equal(done.done, true); assert.equal(done.villageScore, 3);
});

// Every rung optional before the Nether chosen (note 776): the ladder's
// order among them, as these tests read it.
const chosen = (extra = {}) => ({ ...extra, rungOptIn: Object.fromEntries(['bed', 'iron_armour', 'bow', 'arrows', 'diamond_sword', 'shield', 'bucket', 'nether_pickaxe', 'nether_blocks', 'nether_food', 'nether_chest'].map(f => [f, Date.now()])) });

test('beating the game is handed over as the win objective, and the ladder starts with tools you can see', async () => {
  const next = await nextDreamRequest({ systemOne: async () => assert.fail('no question needed') }, { dream: 'beat_the_game', setBy: 'Player' });
  assert.equal(next.kind, 'win'); assert.equal(next.dream, 'beat_the_game');
  const bot = (items, slots = {}) => ({ inventory: { items: () => items.map(name => name === 'arrow' ? { name, count: 16 } : { name }), slots } });
  const armed = ['bow', 'arrow', 'diamond_sword'];
  assert.equal(preparationStage(bot(['white_bed', 'diamond_pickaxe', 'iron_sword', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', ...armed], { 45: { name: 'shield' } })), null, 'a shield on the arm counts');
  assert.equal(preparationStage(bot(['white_bed', 'diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'golden_boots', ...armed], { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } })), null, 'worn armour counts');
  assert.equal(preparationStage(bot(['white_bed', 'diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'])).item, 'golden_boots', 'gold on the feet before the Nether keeps piglins neutral');
  assert.equal(preparationStage(bot(['white_bed', 'diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', ...armed], { 8: { name: 'golden_boots' } })), null, 'golden boots worn count as the boots');
  const registry = require('minecraft-data')('26.1');
  const worn = { registry, inventory: { items: () => [{ name: 'white_bed' }, { name: 'iron_pickaxe', durabilityUsed: 240 }, { name: 'stone_pickaxe', durabilityUsed: 0 }, { name: 'iron_sword' }, { name: 'shield' }, { name: 'water_bucket' }], slots: {} } };
  assert.equal(preparationStage(worn).item, 'iron_pickaxe', 'a pickaxe with ten uses left is a rung to redo before it breaks');
  assert.equal(preparationStage(worn).count, 2, 'the worn one is still carried, so the rung asks for one more');
  worn.inventory.items = () => [{ name: 'white_bed' }, { name: 'iron_pickaxe', durabilityUsed: 100 }, { name: 'iron_sword' }, { name: 'shield' }, { name: 'water_bucket' }];
  assert.equal(preparationStage(worn, chosen()).item, 'iron_helmet', 'a sound pickaxe counts');
  assert.equal(preparationStage(worn).item, 'iron_helmet', 'the armour is the ladder\'s before the Nether, by what its blaze fights take (note 1020)');
  assert.equal(preparationStage(bot([])).item, 'stone_pickaxe');
  assert.equal(preparationStage(bot(['stone_pickaxe'])).item, 'stone_sword');
  assert.equal(preparationStage(bot(['stone_pickaxe', 'stone_sword']), chosen()).phase, 'bed', 'chosen, a bed before the mine: nights slept, not walled in');
  assert.equal(preparationStage(bot(['stone_pickaxe', 'stone_sword'])).phase, 'bed', 'the bed before the mine unchosen too, by the nights it saves (note 841)');
  assert.equal(preparationStage({ inventory: { items: () => [{ name: 'stone_pickaxe' }, { name: 'stone_sword' }, { name: 'white_wool', count: 3 }], slots: {} } }, chosen()).item, 'white_bed', 'three wool of a colour is a bed to craft');
  assert.equal(preparationStage(bot(['stone_pickaxe', 'stone_sword', 'white_bed'])).item, 'iron_pickaxe');
  assert.equal(preparationStage(bot(['stone_pickaxe', 'stone_sword']), { survival: { home: { bed: { claimedAt: 'now' } } } }).item, 'iron_pickaxe', 'the claimed bed at the base meets the rung');
  assert.equal(preparationStage(bot(['white_bed', 'diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket']), chosen()).item, 'iron_helmet', 'armour is four rungs of its own');
  assert.equal(preparationStage(bot(['white_bed', 'diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings']), chosen()).item, 'golden_boots', 'the feet are the golden boots\' (note 1020)');
  assert.equal(preparationStage(bot(['white_bed', 'diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'diamond_boots', 'golden_boots', ...armed])), null);
});

test('a bow and a quiver of sixteen are the last rungs before the Nether, after the golden boots', () => {
  const registry = require('minecraft-data')('26.1');
  const kit = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots'];
  const bot = (items, timeOfDay = 14000) => ({ registry, time: { timeOfDay }, entities: {}, entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => items.map(item => typeof item === 'string' ? { name: item, count: 1, durabilityUsed: 0 } : item), slots: {} } });
  assert.deepEqual(preparationStage(bot(kit), chosen()), { phase: 'bow', action: 'acquire', item: 'bow', count: 1 });
  assert.equal(preparationStage(bot(kit)), null, 'the bow is optional before the Nether unless chosen (note 776)');
  assert.equal(preparationStage(bot(kit, 6000), chosen()), null, 'by day, with the sword in hand and no spider about, the bow waits for dusk');
  assert.equal(preparationStage(bot(kit.filter(n => n !== 'diamond_sword'), 6000), chosen()).item, 'diamond_sword', 'daylight is for the deep');
  assert.equal(preparationStage(bot([...kit, { name: 'string', count: 3 }], 6000), chosen()).item, 'bow', 'string in hand is a bow to craft, whatever the hour');
  const spidered = bot(kit, 6000); spidered.entities = { 1: { name: 'spider', position: new Vec3(10, 64, 0) } };
  assert.equal(preparationStage(spidered, chosen()).item, 'bow', 'a spider in view is a hunt, whatever the hour');
  assert.equal(preparationStage(bot(kit.filter(n => n !== 'golden_boots')), chosen()).item, 'golden_boots', 'gold before the bow');
  assert.deepEqual(preparationStage(bot([...kit, 'bow']), chosen()), { phase: 'arrows', action: 'acquire', item: 'arrow', count: 16 });
  assert.equal(preparationStage(bot([...kit, 'bow', { name: 'arrow', count: 9 }, { name: 'arrow', count: 6 }]), chosen()).item, 'arrow', 'fifteen across two stacks is short');
  assert.equal(preparationStage(bot([...kit, 'bow', { name: 'arrow', count: 16 }]), chosen()), null);
  const worn = preparationStage(bot([...kit, { name: 'bow', count: 1, durabilityUsed: registry.itemsByName.bow.maxDurability - 10 }, { name: 'arrow', count: 32 }]), chosen());
  assert.equal(worn.item, 'bow'); assert.equal(worn.count, 2, 'a bow about to break is redone while it still shoots');
});

test('the idle loop launches the dream only when nothing of the player\'s is pending and outside the cool-down', () => {
  const standing = { dream: 'build_a_village' };
  assert.equal(shouldLaunchDream(standing, null), true);
  assert.equal(shouldLaunchDream(standing, { status: 'running', request: 'get me a pumpkin' }), false, 'a player request is saved and unfinished');
  assert.equal(shouldLaunchDream(standing, { status: 'cancelled', request: 'get me a pumpkin' }), false, 'a stopped player request waits for resume');
  assert.equal(shouldLaunchDream(standing, { status: 'complete', request: 'get me a pumpkin' }), true);
  assert.equal(shouldLaunchDream(standing, { status: 'complete', dream: 'build_a_village' }), true, 'the last part finished, the next may start');
  const now = Date.now();
  assert.equal(shouldLaunchDream({ ...standing, lastAttemptAt: now - 1000 }, { status: 'blocked', dream: 'build_a_village' }, { now }), false, 'a parked part waits out the cool-down');
  assert.equal(shouldLaunchDream({ ...standing, lastAttemptAt: now - COOLDOWN_MS - 1 }, { status: 'blocked', dream: 'build_a_village' }, { now }), true);
  assert.equal(shouldLaunchDream(standing, null, { ready: false }), false, 'not at night, hurt or hungry');
  assert.equal(shouldLaunchDream({ ...standing, satisfiedAt: 'x' }, null), false);
});

test('chat sets, asks about and clears the dream, and an unclear line asks back', async () => {
  const ask = async operation => resolveDream({ systemOne: async () => ({ answers: { operation: { choice: operation, confidence: 0.9 } } }) }, { request: 'Jev your goal is to build a village', from: 'Player' });
  const set = await ask('set_build_a_village');
  assert.equal(set.kind, 'dream'); assert.equal(set.dream.key, 'build_a_village');
  assert.equal((await ask('clear')).dream.operation, 'clear');
  assert.equal((await ask('pause')).dream.operation, 'pause'); assert.equal((await ask('resume')).dream.operation, 'resume');
  assert.equal(shouldLaunchDream({ dream: 'build_a_village', paused: true }, null), false, 'a dream set aside is not chased');
  assert.equal((await ask('none')).kind, 'clarify');
  await assert.rejects(ask('invent'), /Invalid dream/);
});

test('a question about the dream reaches the dream handler even when phrased as discussion', async () => {
  const { interpret } = require('../src/objectives');
  const registry = require('minecraft-data')('26.1');
  const client = { systemOne: async ({ questions }) => questions.objective
    ? { answers: { addressed: { noul: 1 }, interaction: { choice: 'discussion' }, objective: { choice: 'dream', confidence: 0.9 } } }
    : { answers: { operation: { choice: 'query', confidence: 0.9 } } } };
  const spec = await interpret(client, "Jev what's your dream?", 'Player', 'Jev', { registry });
  assert.equal(spec.kind, 'dream'); assert.equal(spec.dream.operation, 'query');
});

test('armour is one rung planned as a set, and the set shrinks to the pieces still missing', () => {
  const registry = require('minecraft-data')('26.1');
  const bot = (names, slots = {}) => ({ registry, inventory: { items: () => names.map(name => ({ name, durabilityUsed: 0 })), slots } });
  const bare = preparationStage(bot(['white_bed', 'iron_pickaxe', 'iron_sword', 'shield', 'water_bucket']), chosen());
  assert.equal(bare.action, 'acquire_set'); assert.equal(bare.phase, 'iron_armour');
  // The feet are left to the golden boots, still to be made (note 1020).
  assert.deepEqual(bare.items, ['iron_helmet', 'iron_chestplate', 'iron_leggings']);
  const partly = preparationStage(bot(['white_bed', 'iron_pickaxe', 'iron_sword', 'shield', 'water_bucket'], { 5: { name: 'iron_helmet' } }), chosen());
  assert.deepEqual(partly.items, ['iron_chestplate', 'iron_leggings']); assert.equal(partly.phase, 'iron_chestplate');
  const shod = preparationStage(bot(['white_bed', 'iron_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'golden_boots'], { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } }));
  assert.deepEqual([shod.phase, shod.items], ['iron_leggings', ['iron_leggings']], 'unchosen too: the leggings before the Nether');
});

test('a dream launch that failed waits two minutes, whatever the last goal was', () => {
  const { FAILED_LAUNCH_MS } = require('../src/dream');
  const { setAside, isSetAside } = require('../src/progress');
  const now = Date.now(), standing = { dream: 'build_a_village' }, survival = { state: {} };
  setAside(survival, 'dream_launch', standing.dream, 'Jev unreachable', FAILED_LAUNCH_MS);
  const resting = () => isSetAside(survival, 'dream_launch', standing.dream);
  assert.equal(shouldLaunchDream(standing, { status: 'complete', request: 'get me a pumpkin' }, { now, resting: resting() }), false);
  assert.equal(shouldLaunchDream(standing, null, { now, resting: resting() }), false, 'a fresh state is no excuse to retry at once');
  assert.equal(isSetAside(survival, 'dream_launch', standing.dream, now + FAILED_LAUNCH_MS + 1000), false, 'the rest is two minutes');
  assert.equal(shouldLaunchDream(standing, null, { now, resting: false }), true);
});

test('no answer to the village question is a failure, not a finished village', async () => {
  const client = { systemOne: async () => ({ answers: { progress: { score: 1 } }, usage: null }) };
  await assert.rejects(chooseVillagePart(client, { structures: [], available: ['cottage'] }), /no village part/);
});

test('an unsure answer never takes the dream away or swaps it; pausing is not held back', async () => {
  const ask = (operation, confidence) => resolveDream({ systemOne: async () => ({ answers: { operation: { choice: operation, confidence } } }) }, { request: 'Jev maybe drop the village thing', from: 'Player' });
  assert.equal((await ask('clear', 0.6)).kind, 'clarify');
  assert.equal((await ask('clear', 0.9)).dream.operation, 'clear');
  assert.equal((await ask('set_beat_the_game', 0.55)).kind, 'clarify');
  assert.equal((await ask('pause', 0.51)).dream.operation, 'pause');
});

// Custom dreams: any single request, pursued once.
const { customText, customVerdict, noteCustomAttempt, dreamReport, dreamTitle, CUSTOM_ATTEMPTS } = require('../src/dream');
const { GoalStore } = require('../src/objectives');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
// The dream question answers set_custom; the intake batch routes the text as `kind`.
const routed = (kind, extra = {}, fit = 'doable') => ({ systemOne: async ({ questions }) => {
  if (questions.fit) return { answers: { fit: { choice: fit, confidence: 0.9 } } };
  if (questions.operation) return { answers: { operation: { choice: 'set_custom', confidence: 0.9 } } };
  return { answers: { addressed: { noul: 1 }, interaction: { choice: 'request', confidence: 0.9 }, objective: { choice: kind, confidence: 0.9 }, ...extra } };
} });
const registry = require('minecraft-data')('26.1');

test('set_custom carries the text after "dream is to" once the pipeline can route it', async () => {
  const set = await resolveDream(routed('build'), { request: 'Jev your dream is to build a castle by the lake.', from: 'Player' }, { username: 'Jev', context: { registry } });
  assert.equal(set.kind, 'dream'); assert.equal(set.dream.key, 'custom'); assert.equal(set.dream.operation, 'set_custom');
  assert.equal(set.dream.text, 'build a castle by the lake'); assert.equal(set.dream.probe.kind, 'build');
  assert.equal(customText('Jev, your dream is to get me a stack of diamonds! (yes, now)'), 'get me a stack of diamonds');
  assert.equal(customText('what is your dream'), null);
});

test('a text that does not route to a doable request is refused with a way forward', async () => {
  for (const kind of ['other', 'operator_command', 'dream']) {
    const refused = await resolveDream(routed(kind), { request: 'Jev your dream is to make the base nicer', from: 'Player' }, { username: 'Jev', context: { registry } });
    assert.equal(refused.kind, 'clarify', kind); assert.equal(refused.clarification.reason, 'dream_not_a_request');
    assert.match(refused.message, /as a request/); assert.match(refused.message, /castle by the lake/);
  }
  for (const fit of ['vague', 'several']) {
    const refused = await resolveDream(routed('build', {}, fit), { request: 'Jev your dream is to make the base nicer', from: 'Player' }, { username: 'Jev', context: { registry } });
    assert.equal(refused.kind, 'clarify', fit); assert.equal(refused.clarification.fit, fit); assert.match(refused.message, /as a request/);
  }
  const noText = await resolveDream(routed('build'), { request: 'Jev set a custom dream', from: 'Player' }, { username: 'Jev', context: { registry } });
  assert.equal(noText.clarification.reason, 'dream_no_text');
  const long = await resolveDream(routed('build'), { request: `Jev your dream is to build ${'a very tall tower '.repeat(20)}`, from: 'Player' }, { username: 'Jev', context: { registry } });
  assert.equal(long.clarification.reason, 'dream_not_a_request');
});

test('a custom dream needs the same bar as a built-in one to be set', async () => {
  const unsure = confidence => resolveDream({ systemOne: async ({ questions }) => questions.operation
    ? { answers: { operation: { choice: 'set_custom', confidence } } } : assert.fail('the text is not checked while unsure') },
  { request: 'Jev maybe your dream is to build a castle by the lake', from: 'Player' }, { username: 'Jev', context: { registry } });
  const asked = await unsure(0.6);
  assert.equal(asked.kind, 'clarify'); assert.equal(asked.clarification.reason, 'dream_unsure'); assert.match(asked.message, /build a castle by the lake/);
});

test('the custom dream is stored beside the old ones and survives a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dream-')), 'w-dream.json');
  const store = new GoalStore(file);
  store.save({ version: 1, dream: 'custom', text: 'find a cherry biome', setBy: 'Player', setAt: '2026-09-28T00:00:00Z', failures: 1 });
  assert.deepEqual({ ...new GoalStore(file).read(), updatedAt: undefined }, { version: 1, dream: 'custom', text: 'find a cherry biome', setBy: 'Player', setAt: '2026-09-28T00:00:00Z', failures: 1, updatedAt: undefined });
  fs.writeFileSync(file, JSON.stringify({ version: 1, dream: 'beat_the_game', setBy: 'Player', setAt: '2026-09-01T00:00:00Z' }));
  assert.equal(new GoalStore(file).read().dream, 'beat_the_game', 'a file from before custom dreams still loads');
  assert.equal(dreamTitle({ dream: 'beat_the_game' }), 'beat the game'); assert.equal(dreamTitle({ dream: 'custom', text: 'find a cherry biome' }), 'find a cherry biome');
});

const custom = { dream: 'custom', text: 'get me a stack of diamonds', setBy: 'Player', setAt: '2026-09-28T00:00:00Z' };
test('nextDreamRequest hands the custom text over as a request from the dream', async () => {
  let asked;
  const next = await nextDreamRequest({}, custom, { interpretRequest: async text => { asked = text; return { kind: 'obtain', request: `Jev ${text}`, item: 'diamond', count: 64, deliver: true, from: 'Player' }; } });
  assert.equal(asked, 'get me a stack of diamonds');
  assert.equal(next.dream, 'custom'); assert.equal(next.source, 'dream'); assert.equal(next.kind, 'obtain'); assert.equal(next.count, 64);
  assert.equal(next.request, 'get me a stack of diamonds'); assert.equal(next.dreamSetAt, custom.setAt); assert.equal(next.from, 'Player');
  await assert.rejects(nextDreamRequest({}, custom, { interpretRequest: async () => ({ kind: 'other' }) }), /did not come out/);
  await assert.rejects(nextDreamRequest({}, { ...custom, text: undefined }, { interpretRequest: async () => ({}) }), /no text/);
});

test('a custom dream is launched like the others, then ends when its request completes', () => {
  const now = Date.now();
  assert.equal(shouldLaunchDream(custom, null, { now }), true);
  assert.equal(shouldLaunchDream(custom, { status: 'running', request: 'get me a pumpkin' }, { now }), false, 'a player request comes first');
  assert.equal(shouldLaunchDream({ ...custom, paused: true }, null, { now }), false, 'stop pauses it');
  assert.equal(shouldLaunchDream({ ...custom, lastAttemptAt: now - 1000 }, { status: 'blocked', dream: 'custom' }, { now }), false, 'the cool-down applies');
  const mine = status => ({ dream: 'custom', dreamSetAt: custom.setAt, status });
  assert.equal(customVerdict(custom, mine('running')), null);
  assert.equal(customVerdict(custom, mine('complete')), 'done');
  assert.equal(customVerdict({ ...custom, satisfiedAt: 'x' }, mine('complete')), null, 'ended once');
  assert.equal(customVerdict(custom, { dream: 'custom', dreamSetAt: 'an earlier dream', status: 'complete' }), null, 'another dream\'s finished request is not this one\'s');
  assert.equal(customVerdict(custom, { dream: 'build_a_village', status: 'complete' }), null);
  assert.equal(customVerdict({ dream: 'build_a_village' }, mine('complete')), null, 'the standing dreams never end this way');
});

test('a custom dream whose request keeps failing is set aside after a few tries, each block counted once', () => {
  const standing = { ...custom }, blocked = createdAt => ({ dream: 'custom', dreamSetAt: custom.setAt, status: 'blocked', createdAt });
  noteCustomAttempt(standing, blocked('a')); noteCustomAttempt(standing, blocked('a'));
  assert.equal(standing.failures, 1, 'the same blocked goal is one failure however often it is looked at');
  assert.equal(customVerdict(standing, blocked('a')), null);
  noteCustomAttempt(standing, blocked('b')); noteCustomAttempt(standing, blocked('c'));
  assert.equal(standing.failures, CUSTOM_ATTEMPTS);
  assert.equal(customVerdict(standing, blocked('c')), 'give_up');
  assert.equal(customVerdict({ ...standing, paused: true }, blocked('c')), null, 'once set aside it stays aside until resumed');
  noteCustomAttempt(standing, { dream: 'custom', dreamSetAt: 'other', status: 'blocked', createdAt: 'z' });
  assert.equal(standing.failures, CUSTOM_ATTEMPTS, 'an older dream\'s failure is not counted');
});

test('the dream is reported in the player\'s words and how it is going', () => {
  const mine = status => ({ dream: 'custom', dreamSetAt: custom.setAt, status });
  assert.match(dreamReport(null), /don't have a dream.*castle by the lake/);
  assert.match(dreamReport(custom, null), /My dream is to get me a stack of diamonds\..*start when nothing else/);
  assert.match(dreamReport(custom, mine('running')), /working on it now/);
  assert.match(dreamReport({ ...custom, failures: 2 }, mine('blocked')), /2 tries so far/);
  assert.match(dreamReport({ ...custom, satisfiedAt: 'x' }), /was to get me a stack of diamonds, and it is done/);
  assert.match(dreamReport({ ...custom, paused: true, failures: 3 }), /set it aside after 3 tries/);
  assert.match(dreamReport({ dream: 'build_a_village' }), /My dream is to build a village\. I chase it/, 'built-in wording is unchanged');
  assert.match(dreamReport({ dream: 'beat_the_game', paused: true }), /keeping it aside/);
});

test('pause, resume and clear work on a custom dream as on the others', async () => {
  const ask = operation => resolveDream({ systemOne: async () => ({ answers: { operation: { choice: operation, confidence: 0.9 } } }) }, { request: 'Jev pause your dream', from: 'Player' });
  for (const operation of ['pause', 'resume', 'clear', 'query']) assert.equal((await ask(operation)).dream.operation, operation);
  assert.equal((await ask('none')).kind, 'clarify');
  assert.match((await ask('none')).message, /castle by the lake/, 'the unclear reply mentions custom dreams');
});

test('"your dream is to ..." read as a personal statement still reaches the dream handler', async () => {
  const { interpret } = require('../src/objectives');
  const client = { systemOne: async ({ questions, state }) => {
    const dreamy = /dream/.test(state?.request || '');
    if (questions.fit) return { answers: { fit: { choice: 'doable', confidence: 0.9 } } };
    if (questions.operation) return { answers: { operation: { choice: 'set_custom', confidence: 0.9 } } };
    return { answers: { addressed: { noul: 1 }, interaction: { choice: dreamy ? 'discussion' : 'request', confidence: 0.8 }, memory_statement: { noul: dreamy ? 0.9 : 0 },
      objective: { choice: dreamy ? 'dream' : 'build', confidence: 0.86 } } };
  } };
  const spec = await interpret(client, 'Jev your dream is to build a castle by the lake', 'Player', 'Jev', { registry });
  assert.equal(spec.kind, 'dream', 'the memory statement question does not take a dream statement');
  assert.equal(spec.dream.text, 'build a castle by the lake');
});
