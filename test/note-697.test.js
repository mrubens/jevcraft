'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');

// mid-242-jb (25591), 22:37:42 to 22:49Z on 2026-09-29 (note 697): pillared
// up beside its fortress's bridge with no pickaxe, it stood at (143, 60, 319)
// in the bridge's own side, sealed against a skeleton with the netherrack it
// carried; the shell's corner at (142, 61, 320) held lava, so the pocket was
// never whole. Every walk failed "No route", leave_nether chose wait_here
// fifteen times, and working free was offered the fortress's bricks "about
// 0.5 s" each, never its own netherrack. The ground is note 694's region read
// (test/fixtures/fortress-overhead-25591.json, before the pillar): the bot's
// cells were the bridge's bricks, dug on its way up.
const GROUND = require('./fixtures/fortress-overhead-25591.json');
const FEET = new Vec3(143, 60, 319);
const ITEMS = [['netherrack', 24], ['mutton', 9], ['beef', 11], ['iron_sword', 1], ['crafting_table', 2]];

// The pocket as the seal left it: its own netherrack in every cell of the
// shell a block goes into, the lava corner open.
function pocketBot({ own = true, items = ITEMS } = {}) {
  const bot = groundBot(GROUND, { at: new Vec3(143.5, 60, 319.5), items: items.map(i => [...i]), dimension: 'the_nether', indexed: true });
  bot.entities = {}; bot.players = {}; bot.username = 'Jev';
  bot.pathfinder.bestHarvestTool = () => null;
  const key = p => `${p.x},${p.y},${p.z}`;
  bot.changed.set(key(FEET), 'air'); bot.changed.set(key(FEET.offset(0, 1, 0)), 'air');
  const shelter = require('../src/shelter');
  const refuge = { origin: { x: FEET.x, y: FEET.y, z: FEET.z }, dimension: 'the_nether', emergency: true, createdAt: new Date().toISOString() };
  const { noteLaid } = require('../src/own-blocks');
  const at = Date.parse('2026-09-29T22:37:44Z');
  // Working free dug the brick east at the feet at 22:38:06 (about ten
  // seconds by hand); the second seal, at 22:38:43, put netherrack there.
  const laid = [];
  for (const p of [FEET.offset(1, 0, 0), ...shelter.missingShell(bot, refuge)]) {
    if (/lava|water/.test(bot.blockAt(p)?.name || '')) continue;
    bot.changed.set(key(p), 'netherrack'); laid.push(p);
    if (own) noteLaid(bot, { position: p, name: 'netherrack' }, { at, goal: null });
  }
  return { bot, refuge, laid };
}

test('the pocket shut to walkers with only its lava corner open is the pocket: pocket_next is claimed, said not whole (25591, note 697)', () => {
  const shelter = require('../src/shelter');
  const { bot, refuge, laid } = pocketBot();
  assert(laid.length >= 3, `laid ${laid.length}`);
  assert.equal(shelter.sealed(bot, refuge), false, 'the lava corner: never sealed by the shell\'s count');
  const open = shelter.closedIn(bot, refuge);
  assert.deepEqual(open, [{ x: 142, y: 61, z: 320, name: 'lava' }]);
  const survival = { state: { shelters: [refuge], sealing: { origin: refuge.origin, at: Date.now() - 60000 } }, currentShelter: () => refuge };
  const claim = require('../src/survival').claim(bot, { kind: 'win' }, survival);
  assert.equal(claim?.action, 'pocket_next', JSON.stringify(claim));
  assert.match(claim.facts.pocketNotWhole, /^shut to walkers, but 1 cell of its shell holds lava, which no block goes into \(142, 61, 320\)$/);
  // A cell a walker comes in by left open is no pocket.
  bot.changed.set('144,61,319', 'air');
  assert.equal(shelter.closedIn(bot, refuge), null);
});

test('a walk from inside digs through its own netherrack, and not through the same blocks where the world put them (25591, note 697)', () => {
  const { goals } = require('mineflayer-pathfinder');
  const goal = new goals.GoalNear(145, 61, 326, 1);
  const { bot } = pocketBot();
  const path = bot.pathfinder.getPathTo(bot.pathfinder.movements, goal, 4000);
  assert.equal(path.status, 'success', path.status);
  const dug = path.path.flatMap(m => m.toBreak || []).map(p => bot.blockAt(p)?.name);
  assert(dug.length && dug.every(n => n === 'netherrack'), `dug ${dug.join(', ')}`);
  // The same netherrack not its own: no route, as the trial had.
  const { bot: other } = pocketBot({ own: false });
  other.pathfinder.bestHarvestTool = () => null;
  assert.equal(other.pathfinder.getPathTo(other.pathfinder.movements, goal, 4000).status, 'noPath');
});

test('working free offers its own netherrack by hand at the game\'s two seconds, and the fortress\'s bricks at ten, dropping nothing (note 697)', () => {
  const u = require('../src/unstuck');
  const { bot } = pocketBot();
  const view = u.liveView(bot);
  const moves = u.localMoves ? u.localMoves(view, FEET, {}) : null;
  const list = Array.isArray(moves) ? moves : moves?.moves || [];
  const east = list.find(m => m.key === 'dig_east_head');
  assert(east, list.map(m => m.key).join(', '));
  assert.match(east.does, /^Dig the netherrack east, at head height, a block the bot laid itself at 22:37Z \(about 2 s by hand, and it drops nothing\)\.$/);
  const brick = list.find(m => /nether brick/.test(m.does));
  assert(brick, 'a fortress brick is offered');
  assert.match(brick.does, /\(about 10 s by hand, and it drops nothing\)/);
  // With a pickaxe, as before.
  assert.equal(u.digSeconds('netherrack', { ...view, pickaxe: 'stone_pickaxe' }, false), 0.6);
  assert.equal(u.digSeconds('stone', view, false, new Vec3(0, 0, 0)), null, 'not its own, and not netherrack: not by hand');
});

const answers = (pick, seen = []) => ({ systemOne: async ({ state, questions }) => {
  seen.push({ state, criteria: questions.branch_0.criteria });
  const keys = Object.keys(questions.branch_0.criteria).filter(k => k !== 'none_good');
  const choice = keys.includes(pick) ? pick : keys[0];
  return { answers: { branch_0: { choice, confidence: 0.8, probabilities: Object.fromEntries(keys.map(k => [k, k === choice ? 0.8 : 0.2 / keys.length])) } } };
} });

test('every plan question is told the bot is walled in by its own blocks; the pocket\'s and working free\'s are not (note 697)', async () => {
  const { decide } = require('../src/decisions');
  const { bot } = pocketBot();
  bot._stalls = { records: {}, marks: [] };
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'rods_waiting' }, survival: { sealing: { origin: { x: 143, y: 60, z: 319 }, at: Date.parse('2026-09-29T22:37:44Z') } } };
  const { walledInSays } = require('../src/walled-in');
  const w = walledInSays(bot, { survival: goal.survival });
  assert.equal(w.says, 'Walled in where it stands: 2 of the 9 blocks round it are its own (netherrack, laid from 22:37Z), sealed here at 22:37Z; the rest is nether bricks, nether brick fence, basalt. Its own come away: netherrack about 2 s a block, by hand, dropping nothing. A walk from here digs through its own blocks first; no mob within 16 blocks now.');
  const seen = [];
  await decide('leave_nether', { client: answers('wait_here', seen), bot, goal, tree: { go_back: { description: 'Go back to the Overworld while the rods wait.' }, wait_here: { description: 'Other work in the Nether until the rods step\'s rest ends.' } }, state: {} });
  assert.equal(seen[0].state.walledIn, w.says);
  const pocket = [];
  await decide('pocket_next', { client: answers('leave', pocket), bot, goal, tree: { stay: { description: 'Stay.' }, leave: { description: 'Open the pocket and go.' } }, state: {} });
  assert.equal(pocket[0].state.walledIn, undefined, 'the pocket says its own walls');
  // Out in the open, nothing said.
  const open = pocketBot().bot; open.entity.position = new Vec3(145.5, 61, 325.5);
  assert.equal(walledInSays(open, { survival: goal.survival }), null);
});

test('an answer chosen twice running from here with the same options, nothing come of it, is not offered a third time, however full the ledger (25591, note 697)', async () => {
  const { decide } = require('../src/decisions');
  const tried = require('../src/tried');
  const bot = { entity: { position: new Vec3(143.5, 60, 319.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 19, entities: {}, _stalls: { records: {}, marks: [] } };
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'rods_waiting' } };
  const tree = () => ({ go_back: { description: 'Go back to the Overworld while the rods wait.' }, wait_here: { description: 'Other work in the Nether until the rods step\'s rest ends.' } });
  const seen = [];
  const client = answers('wait_here', seen);
  // The stall's own records between the askings, as 25591's: 110 in 0.6 s.
  const flood = () => { for (let n = 0; n < 170; n++) tried.record(bot, goal, { q: 'rung_progress', method: 'keep_at_it', outcome: 'blocked', why: 'every way rests' }); };
  assert.deepEqual((await decide('leave_nether', { client, bot, goal, tree: tree(), state: {} })).path, ['wait_here']);
  flood();
  assert.deepEqual((await decide('leave_nether', { client, bot, goal, tree: tree(), state: {} })).path, ['wait_here']);
  flood();
  const third = await decide('leave_nether', { client, bot, goal, tree: tree(), state: {} });
  assert.equal(seen.length, 2, 'the third asking offers wait here no more: the one way left is taken');
  assert.deepEqual(third.path, ['go_back']);
  const held = goal.tried.entries.find(e => e.q === 'leave_nether' && e.method === 'wait_here' && e.held);
  assert.match(held.why, /^wait here was chosen 2 times running from here with these same options, the last \d+ seconds? ago, and nothing came of it \(no new ground, nothing gained, no block dug or placed\); not offered/);
  // Moved off, the same answer is Jev's again.
  const other = { ...bot, entity: { position: new Vec3(160.5, 61, 340.5) }, _chosenLast: {} };
  const later = [];
  await decide('leave_nether', { client: answers('wait_here', later), bot: other, goal: { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'rods_waiting' } }, tree: tree(), state: {} });
  assert.equal(later.length, 1);
});

test('the bot\'s own line coming back from the server is not a player speaking: a repeat within the window is dropped (25591, note 697)', () => {
  const { EventEmitter } = require('node:events');
  const { quietRepeats } = require('../src/speech');
  const said = [], bot = { username: 'Jev', chat: line => said.push(line), _client: Object.assign(new EventEmitter(), { uuid: '0b1c2d3e-0000-4000-8000-000000000001' }) };
  quietRepeats(bot, { windowMs: 60000, replyMs: 15000 });
  const line = 'I\'m getting nowhere with the rods waiting. Trying another way.';
  bot.chat(line);
  bot._client.emit('playerChat', { sender: '0b1c2d3e000040008000000000000001', plainMessage: line });
  bot.chat(line); bot.chat(line); bot.chat(line);
  assert.deepEqual(said, [line], 'four in 1.3 seconds were said four times');
  bot._client.emit('playerChat', { sender: 'ffffffff-0000-4000-8000-000000000002', plainMessage: 'what are you doing?' });
  bot.chat(line);
  assert.equal(said.length, 2, 'asked by a player, answered again');
});
