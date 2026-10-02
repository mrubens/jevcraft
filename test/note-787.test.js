'use strict';
// Note 787: climbs for wood came back with a log or two. On the fresh
// trials cut without the Nether (2026-09-30 12Z to 2026-10-01 05Z), the
// climbs to open sky were the largest share of the played minutes after
// the portal rung (scripts/rung-time.js), and wood the largest thing they
// were for: 232 climbs, 443 minutes, a median 2 logs' worth carried at the
// most before going back down, 139 after another climb for wood in the
// same trial (scripts/wood-trips.js). The ladder's log step cut what its
// craft asked for. Now, with a log cut up top and the wood owed before the
// Nether short, the logs within reach are Jev's to take toward it, said
// with the wood owed, the pace, the climb and what ends the cutting.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const levels = require('../src/levels');
const work = require('../src/work');

const block = (name, position) => ({ name, position, boundingBox: name === 'air' ? 'empty' : 'block', type: registry.blocksByName[name]?.id, diggable: true });
function fixture({ items = { stone_pickaxe: 1, oak_log: 1 }, logs = [new Vec3(3, 64, 0), new Vec3(3, 65, 0), new Vec3(3, 66, 0), new Vec3(-5, 64, 2)], y = 64 } = {}) {
  const inv = Object.entries(items).map(([name, count]) => ({ name, count }));
  const world = new Map(logs.map(p => [p.toString(), 'oak_log']));
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 }, chat(m) { this.said.push(m); }, said: [],
    health: 20, food: 20, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(0.5, y, 0.5) }, inventory: { items: () => inv, slots: [] },
    blockAt: p => { const k = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return block(world.get(k.toString()) || (k.y < 64 || (y < 64 && k.y >= y + 2 && k.y < 80) ? 'stone' : 'air'), k); },
    findBlocks: ({ matching, maxDistance, count }) => [...world.entries()].map(([k]) => new Vec3(...k.slice(1, -1).split(',').map(Number)))
      .filter(p => matching.includes(registry.blocksByName[world.get(p.toString())].id) && p.distanceTo(bot.entity.position) <= maxDistance).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)).slice(0, count) });
  // Cutting a log: the block goes, the log is carried.
  const cut = async (b, t, step, g, s, p) => { world.delete(p.toString()); const it = inv.find(i => i.name === 'oak_log'); if (it) it.count++; else inv.push({ name: 'oak_log', count: 1 }); cuts.push(p); };
  const cuts = [];
  return { bot, inv, world, cut, cuts, goal: { version: 1, kind: 'win', request: 'beat the game' }, task: new Task('win') };
}
const client = (picks, asked) => ({ systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } });

test('the wood owed before the Nether: the open rungs\' planks and sticks, a table where none is carried, and the reserve, said with what is carried', () => {
  const { bot, goal } = fixture({ items: { stone_pickaxe: 1, oak_log: 1 } });
  const o = levels.woodOwed(bot, goal);
  // A stone sword and an iron pickaxe open (half a plank and a plank), a table (4): 5.5 planks, and 6 logs' worth kept.
  assert(o.parts.includes('a crafting table 4 planks'), o.parts.join('; '));
  assert.equal(o.logs, Math.ceil(o.planks / 4 + 6));
  assert.equal(o.carried, 1);
  assert.equal(o.short, o.logs - 1);
  assert.match(o.says, new RegExp(`^the wood owed before the Nether is ${o.logs} logs' worth \\(.*and the 6 logs' worth kept for spare pickaxes and a table\\), 1 carried, ${o.short} short$`));
  // Carried, nothing is short.
  const full = fixture({ items: { stone_pickaxe: 1, crafting_table: 1, oak_log: 20 } });
  assert.equal(levels.woodOwed(full.bot, full.goal).short, 0);
  assert.match(levels.woodClimbsSays(), /232 climbs to open sky were for wood, 443 minutes; each came back with a median 2 logs' worth at the most, and 139 came after another climb for wood in the same trial \(264 minutes\)/);
});

test('a log cut up top with the wood owed short: Jev is asked once a visit, the facts said; chosen, the logs within reach are cut until the wood owed is carried or none is left', async () => {
  const f = fixture();
  const asked = [];
  f.task.opportunityClient = client(['take_owed'], asked);
  f.goal.surfaceTrip = { need: '1 oak log', pick: 'climb', up: 40, at: new Date().toISOString() };
  await work.woodWhileUp(f.bot, f.task, f.goal, () => {}, { cut: f.cut });
  assert.equal(asked.length, 1);
  const { options, state } = asked[0];
  assert.deepEqual(Object.keys(options).filter(k => k !== 'none_good').sort(), ['go_on', 'take_owed']);
  assert.match(options.take_owed, /^Cut the logs within 16 blocks now toward the wood owed: 4 log blocks in view within 16, the nearest 3 blocks off; the wood owed before the Nether is \d+ logs' worth/);
  assert.match(options.take_owed, /About 10\.4 seconds a log within a trunk at the bot's own pace/);
  assert.match(options.take_owed, /The climb up here rose 40 blocks: 40 blocks up to open sky: about 3 minutes at the bot's own pace/);
  assert.match(options.take_owed, /It ends with the wood owed carried, when no log within 16 blocks can be had \(none left, or 3 tries running gain nothing\), when the bot is under cover again, or after ten minutes or 48 blocks from here/);
  assert.match(options.go_on, /^Go on with the step with 1 logs' worth carried: \d+ more of the wood owed is fetched when a craft wants it, from wherever the bot is then\. In the record/);
  assert.equal(state.logsInReach, 4);
  assert.equal(state.climbRose, 40);
  // All four logs cut (the owed is more than five), nearest first, and then none is left.
  assert.equal(f.cuts.length, 4);
  assert.equal(f.inv.find(i => i.name === 'oak_log').count, 5);
  assert.equal(f.goal.woodUp.pick, 'take_owed');
  assert.match(f.bot.said[0], /^I'll take the wood I still need while I'm up here: \d+ more logs' worth\.$/);
  // Back at the step in the same visit with a new tree in reach: the answer holds, not asked again.
  f.world.set(new Vec3(6, 64, 6).toString(), 'oak_log');
  await work.woodWhileUp(f.bot, f.task, f.goal, () => {}, { cut: f.cut });
  assert.equal(asked.length, 1);
  assert.equal(f.cuts.length, 5);
});

test('the cutting stops at the wood owed', async () => {
  const f = fixture({ items: { stone_pickaxe: 1, crafting_table: 1, oak_log: 5 } });
  const want = levels.woodOwed(f.bot, f.goal).logs;
  assert.equal(want - 5, 2, `owed ${want}`);
  f.task.opportunityClient = client(['take_owed'], []);
  await work.woodWhileUp(f.bot, f.task, f.goal, () => {}, { cut: f.cut });
  assert.equal(f.cuts.length, 2);
  assert.equal(f.inv.find(i => i.name === 'oak_log').count, want);
});

test('go on: held for the visit; asked again on a new visit; not asked under cover, with the wood owed carried, with no log in reach, or off the ladder', async () => {
  const f = fixture();
  const asked = [];
  f.task.opportunityClient = client(['go_on', 'go_on'], asked);
  await work.woodWhileUp(f.bot, f.task, f.goal, () => {}, { cut: f.cut });
  await work.woodWhileUp(f.bot, f.task, f.goal, () => {}, { cut: f.cut });
  assert.equal(asked.length, 1, 'held for the visit');
  assert.equal(f.cuts.length, 0);
  // Ten minutes on: a new visit, asked again.
  f.goal.woodUp.at -= 10 * 60 * 1000 + 1;
  await work.woodWhileUp(f.bot, f.task, f.goal, () => {}, { cut: f.cut });
  assert.equal(asked.length, 2);
  // Under cover (stone over the head from y 66 up): not asked.
  const deep = fixture({ y: 40, logs: [new Vec3(3, 40, 0)] });
  const a2 = [];
  deep.task.opportunityClient = client(['take_owed'], a2);
  await work.woodWhileUp(deep.bot, deep.task, deep.goal, () => {}, { cut: deep.cut });
  assert.equal(a2.length, 0);
  // The wood owed carried, or no log within sixteen blocks, or not the game's ladder: not asked.
  for (const g of [fixture({ items: { stone_pickaxe: 1, crafting_table: 1, oak_log: 20 } }), fixture({ logs: [new Vec3(30, 64, 0)] }), Object.assign(fixture(), {})]) {
    const a = [];
    g.task.opportunityClient = client(['take_owed'], a);
    if (g.world.size === 4 && g.inv.length === 2) g.goal.kind = 'build';
    await work.woodWhileUp(g.bot, g.task, g.goal, () => {}, { cut: g.cut });
    assert.equal(a.length, 0);
  }
});

test('the climb for a log says the wood owed and the record of climbs for wood', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/work.js'), 'utf8');
  assert.match(src, /if \(LOG_NEED\.test\(need\) && goal\.kind === 'win'\)/);
  assert.match(src, /Up there, \$\{o\.says\}: once a log is cut, the logs within \$\{WOOD_UP\.radius\} blocks are offered toward it/);
});
