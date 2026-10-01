'use strict';
// Note 779: pickaxe accounting. Spares made for the crossing were dug with
// first and worn out (25581, 01:03:59Z, 2026-10-01: a stone spare of 131 made
// beside an iron pickaxe of 218, 1 use left at 01:10:04Z); pickaxes were
// thrown from full pockets by the library's unequip and picked up again
// seconds later (25598 02:37:49Z, 25583 04:34:40Z: "Fetching stems for a
// pickaxe: no pickaxe carried" with a diamond one on the floor beside it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const registry = require('minecraft-data')('26.1');
const roles = require('../src/pickaxe-roles');
const { equipBestTool, emptyHand, pickaxeTier } = require('../src/skills');

const max = n => registry.itemsByName[n].maxDurability;
const item = (name, uses, slot, count = 1) => ({ name, type: registry.itemsByName[name].id, slot, count, durabilityUsed: max(name) ? max(name) - uses : 0, stackSize: registry.itemsByName[name].stackSize });
function fixture(items, { goal = {}, slots = null } = {}) {
  const inv = { items: () => items, slots: slots || [], selectedItem: null };
  const bot = { registry, inventory: inv, heldItem: null, equipped: null, _goal: goal,
    equip: async it => { bot.equipped = it; bot.heldItem = it; } };
  return bot;
}
const pick = t => registry.itemsByName[`${t}_pickaxe`].id;
const stone = { harvestTools: Object.fromEntries(['wooden', 'stone', 'iron', 'diamond', 'netherite'].map(t => [pick(t), true])),
  canHarvest(type) { return !!this.harvestTools[type]; },
  digTime: type => type === null ? 7500 : { [pick('wooden')]: 1150, [pick('stone')]: 600, [pick('iron')]: 400, [pick('diamond')]: 300 }[type] ?? 7500 };
const diamondOre = { harvestTools: Object.fromEntries(['iron', 'diamond', 'netherite'].map(t => [pick(t), true])),
  canHarvest(type) { return !!this.harvestTools[type]; }, digTime: type => stone.digTime(type) };
const dirt = { digTime: type => type === registry.itemsByName.iron_shovel.id ? 150 : 750 };

test('25581: a stone spare made beside the iron pickaxe is kept whole; the iron one digs the stone', async () => {
  const iron = item('iron_pickaxe', 218, 36);
  const items = [iron];
  const goal = { step: { action: 'to_ruined_portal' } };
  const bot = fixture(items, { goal });
  // Made: the craft adds a fresh stone pickaxe beside a sound iron one.
  const spare = item('stone_pickaxe', 131, 37);
  items.push(spare);
  roles.noteMade(bot, goal, 'stone_pickaxe', 'nether_pickaxe');
  assert.equal(goal.pickaxeSpare.name, 'stone_pickaxe');
  assert.equal(goal.pickaxeSpare.why, 'nether_pickaxe');
  await equipBestTool(bot, stone);
  assert.equal(bot.equipped.name, 'iron_pickaxe', 'the spare is not the one dug with');
  // Pathfinder digs by the same rule.
  const { installToolPolicy } = require('../src/movement');
  bot.pathfinder = {}; installToolPolicy(bot);
  assert.equal(bot.pathfinder.bestHarvestTool(stone).name, 'iron_pickaxe');
  // As before, with no spare kept: the cheapest that harvests.
  const plain = fixture([item('iron_pickaxe', 218, 36), item('stone_pickaxe', 131, 37)]);
  await equipBestTool(plain, stone);
  assert.equal(plain.equipped.name, 'stone_pickaxe');
});

test('the spare digs a block only it harvests, and becomes the pickaxe in use once it is the only sound one', async () => {
  const main = item('stone_pickaxe', 90, 36), spare = item('iron_pickaxe', 250, 37);
  const items = [main, spare];
  const goal = { pickaxeSpare: { name: 'iron_pickaxe', uses: 250, made: 250, at: Date.now(), wornBy: {} } };
  const bot = fixture(items, { goal });
  await equipBestTool(bot, diamondOre);
  assert.equal(bot.equipped.name, 'iron_pickaxe', 'the stone one cannot harvest diamond ore');
  await equipBestTool(bot, stone);
  assert.equal(bot.equipped.name, 'stone_pickaxe');
  // The stone one worn under a spare's uses: the iron one is all there is.
  main.durabilityUsed = max('stone_pickaxe') - 10;
  assert.equal(roles.spareOf(bot, goal), null);
  assert.match(goal.pickaxeSpareLast.ended, /became the pickaxe in use/);
  await equipBestTool(bot, stone);
  assert.equal(bot.equipped.name, 'stone_pickaxe', 'the cheapest digs again, nothing kept back');
});

test('what wore the spare is kept, and the spare rung says it', () => {
  const now = Date.now();
  const iron = item('iron_pickaxe', 200, 36), spare = item('stone_pickaxe', 131, 37);
  const goal = { step: { action: 'tunnel' } };
  const bot = fixture([iron, spare], { goal });
  roles.noteMade(bot, goal, 'stone_pickaxe', 'nether_pickaxe', now - 12 * 60000);
  spare.durabilityUsed = 31; // 100 left
  assert.ok(roles.spareOf(bot, goal, now));
  goal.step.action = 'ascend_to_surface';
  spare.durabilityUsed = 128; // 3 left
  assert.equal(roles.spareOf(bot, goal, now), null);
  assert.deepEqual(goal.pickaxeSpareLast.wornBy, { tunnel: 31, ascend_to_surface: 97 });
  const says = roles.spareSays(bot, goal, now);
  assert.match(says, /The last spare, a stone pickaxe made 12 minutes ago beside iron pickaxe \(200 uses\), worn under 24 uses \(3 left\)/);
  assert.match(says, /128 of its 131 uses were dug \(ascend to surface 97, tunnel 31\), 128 of them with another sound pickaxe carried/);
  // The crossing kit's pickaxe rung says it.
  const kit = require('../src/crossing-kit');
  const rungSays = kit.kitRungSays(bot, goal, { kit: 'pickaxe', carried: 1, wants: 2, item: 'stone_pickaxe' });
  assert.match(rungSays, /The last spare, a stone pickaxe/);
});

test('a pickaxe made with no other sound one carried is not a spare', () => {
  const goal = {};
  const bot = fixture([item('stone_pickaxe', 131, 36), item('iron_pickaxe', 12, 37)], { goal });
  assert.equal(roles.noteMade(bot, goal, 'stone_pickaxe'), null);
  assert.equal(goal.pickaxeSpare, undefined);
});

test('the hand is emptied without throwing: full pockets select a slot that wears nothing (25598 02:37:49Z)', async () => {
  const slots = new Array(46).fill(null);
  const picked = item('iron_pickaxe', 245, 36);
  for (let i = 9; i < 45; i++) slots[i] = item('red_terracotta', 1, i);
  slots[36] = picked; slots[37] = item('iron_sword', 200, 37);
  const items = slots.filter(Boolean);
  const bot = fixture(items, { slots });
  bot.QUICK_BAR_START = 36; bot.quickBarSlot = 0; bot.heldItem = picked;
  bot.inventory.firstEmptyInventorySlot = () => null;
  const calls = [];
  bot.unequip = async () => calls.push('unequip');
  bot.tossStack = async () => calls.push('toss');
  bot.setQuickBarSlot = i => { calls.push(`select ${i}`); bot.quickBarSlot = i; bot.heldItem = slots[36 + i]; };
  // Dirt, which no pickaxe digs faster: the pickaxe put away by selecting
  // the terracotta's slot, nothing thrown.
  await equipBestTool(bot, dirt);
  assert.deepEqual(calls, ['select 2']);
  assert.equal(bot.heldItem.name, 'red_terracotta');
  // Every hotbar slot a tool: kept in hand.
  for (let i = 36; i < 45; i++) slots[i] = item('stone_sword', 100, i);
  bot.heldItem = slots[36]; calls.length = 0;
  assert.equal(await emptyHand(bot), 'kept');
  assert.deepEqual(calls, []);
  // An empty hotbar slot: selected; an empty pocket slot: put away there.
  slots[40] = null; bot.heldItem = slots[36];
  assert.equal(await emptyHand(bot), 'empty slot');
  slots[40] = item('stone_sword', 100, 40); slots[12] = null; bot.heldItem = slots[36];
  bot.inventory.firstEmptyInventorySlot = () => 12;
  calls.length = 0;
  assert.equal(await emptyHand(bot), 'put away');
  assert.deepEqual(calls, ['unequip']);
});

test('a pickaxe on the cursor or in the crafting grid is carried', () => {
  const slots = new Array(46).fill(null);
  const bot = fixture([], { slots });
  assert.equal(pickaxeTier(bot), 0);
  bot.inventory.selectedItem = item('iron_pickaxe', 244, -1);
  assert.equal(pickaxeTier(bot), 3);
  assert.equal(roles.soundPickaxes(bot).length, 1);
  bot.inventory.selectedItem = null;
  slots[2] = item('diamond_pickaxe', 876, 2);
  assert.equal(pickaxeTier(bot), 4);
  const kit = require('../src/crossing-kit');
  assert.equal(kit.soundPickaxes(bot).length, 1);
  assert.equal(require('../src/mob-hunt').pickaxeFirst(bot).carried, true, '25583: no "no pickaxe carried" with one in the grid');
});

test('the craft grid with no room is left where it is, not thrown by the put-away', async () => {
  const { settleCraftInventory } = require('../src/work');
  const slots = new Array(46).fill(null);
  slots[1] = item('stone_pickaxe', 131, 1);
  for (let i = 9; i < 45; i++) slots[i] = item('cobblestone', 64, i, 64);
  const items = slots.slice(9, 45);
  const bot = fixture(items, { slots });
  bot.inventory.emptySlotCount = () => 0;
  let putAway = 0;
  bot.putAway = async () => { putAway++; };
  const log = console.log; const lines = []; console.log = l => lines.push(l);
  try { await settleCraftInventory(bot, { check() {} }); } catch (_) { /* the room question has no Jev here */ } finally { console.log = log; }
  assert.equal(putAway, 0);
  assert.ok(lines.some(l => /left in the crafting grid/.test(l)));
});

test('the ledger reads pickaxes thrown and picked up, spares worn, and minutes with none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-779-'));
  const cache = path.join(dir, 'cache.jsonl');
  const t0 = Date.parse('2026-10-01T02:37:00Z');
  const full = Object.fromEntries(Array.from({ length: 34 }, (_, i) => [`x${i}`, 1]));
  const row = (s, k, picks, extra = {}) => ({ t: t0 + s * 1000, port: '25598', file: 'f', k, picks, slots: 36, kinds: 36, inv: { ...full, ...Object.fromEntries(Object.entries(picks).map(([n, c]) => [n, c])) }, dim: 'overworld', y: 61, act: 'tunnel', ...extra });
  const rows = [
    row(0, 'decision', { iron_pickaxe: 1 }, { tools: [['iron_pickaxe', 218]], loose: [] }),
    row(10, 'decision', { iron_pickaxe: 1, stone_pickaxe: 1 }, { tools: [['iron_pickaxe', 218], ['stone_pickaxe', 131]], loose: [] }),
    row(20, 'decision', { iron_pickaxe: 1, stone_pickaxe: 1 }, { tools: [['iron_pickaxe', 218], ['stone_pickaxe', 60]], loose: [] }),
    row(30, 'decision', { iron_pickaxe: 1, stone_pickaxe: 1 }, { tools: [['iron_pickaxe', 218], ['stone_pickaxe', 3]], loose: [] }),
    row(40, 'observation', { stone_pickaxe: 1 }),
    row(45, 'decision', { stone_pickaxe: 1 }, { tools: [['stone_pickaxe', 3]], loose: [7], dec: { id: 'win_strategy', path: ['rung_stone_pickaxe'] } }),
    row(60, 'decision', { iron_pickaxe: 1, stone_pickaxe: 1 }, { tools: [['iron_pickaxe', 218], ['stone_pickaxe', 3]], loose: [] }),
  ];
  fs.writeFileSync(cache, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'pickaxe-ledger.js'), '--cache', cache, '--since', '2026-10-01T00:00:00Z', '--json'], { encoding: 'utf8' }));
  assert.equal(out.spares.length, 1);
  assert.equal(out.wear.spareWhileMain, 128);
  const gone = out.disappearances.find(d => d.name === 'iron_pickaxe');
  assert.equal(gone.brief, true);
  assert.equal(gone.thrown, true);
  assert.equal(gone.cause, 'tossed from full pockets');
  assert.ok(out.reopened.some(r => r.rungs.includes('rung_stone_pickaxe')));
});
