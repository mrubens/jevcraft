'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planFor, RECIPES } = require('../src/plan');
const { houseBlueprint, verifyHouse, interpret, GoalStore } = require('../src/objectives');
const { Vec3 } = require('vec3');
const fs = require('fs');
const os = require('os');
const path = require('path');

function simulate(item, count, stock = {}) {
  const inv = { ...stock };
  for (const step of planFor(item, count, stock)) {
    if (step.tier) {
      const tiers = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
      assert(tiers.some((name, i) => i + 1 >= step.tier && inv[`${name}_pickaxe`] > 0), `No tool for ${step.block}`);
    }
    for (const [name, amount] of Object.entries(step.consumes)) {
      assert((inv[name] || 0) >= amount, `Cannot ${step.action} ${step.item}: missing ${amount} ${name}, have ${inv[name]}`);
      if (!['crafting_table', 'furnace'].includes(name)) inv[name] -= amount;
    }
    for (const [name, amount] of Object.entries(step.produces)) inv[name] = (inv[name] || 0) + amount;
  }
  assert(inv[item] >= count);
  return inv;
}
test('plans concrete including tools, dyes, correct recipe batches, and hardening', () => {
  const inv = simulate('purple_concrete', 32);
  assert.equal(inv.purple_concrete, 32);
  assert.equal(inv.purple_concrete_powder, 0);
  assert.equal(inv.purple_dye, 0);
  assert(inv.wooden_pickaxe);
});
test('plans survival progression to obsidian without spending ingredients twice', () => simulate('obsidian', 10));
test('handles partial inventory and recipe rounding', () => {
  for (const n of [1, 7, 9, 31, 32, 65]) simulate('purple_concrete', n, { oak_planks: 3, gravel: 2, purple_dye: 1 });
});
test('craft recipes match installed Minecraft data', () => {
  const data = require('minecraft-data')('26.1');
  for (const name of ['purple_concrete_powder', 'purple_dye', 'red_dye', 'blue_dye', 'flint_and_steel']) {
    const expected = RECIPES[name];
    assert(data.recipes[data.itemsByName[name].id].some(recipe => {
      const flat = recipe.ingredients || recipe.inShape.flat().filter(id => id !== -1);
      const counts = flat.reduce((o, id) => { const n = data.items[id].name; o[n] = (o[n] || 0) + 1; return o; }, {});
      return recipe.result.count === expected.yields && JSON.stringify(Object.entries(counts).sort()) === JSON.stringify(Object.entries(expected.from).sort());
    }), name);
  }
});
test('house verification rejects incomplete walls, blocked doorway and unloaded terrain', () => {
  const blueprint = houseBlueprint(new Vec3(0, 64, 0));
  assert.equal(blueprint.blocks.length, 96);
  const blocks = new Map(blueprint.blocks.map(p => [`${p.x},${p.y},${p.z}`, p.material]));
  const bot = { blockAt: p => ({ name: blocks.get(`${p.x},${p.y},${p.z}`) || 'air' }) };
  assert(verifyHouse(bot, blueprint).ok);
  blocks.delete('2,65,2');
  assert(!verifyHouse(bot, blueprint).ok);
  blocks.set('2,65,2', 'oak_planks'); blocks.set('0,64,-2', 'dirt');
  assert(!verifyHouse(bot, blueprint).ok);
  assert(!verifyHouse({ blockAt: () => null }, blueprint).ok);
});
test('saved task survives a new store instance with its fixed blueprint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-goal-'));
  try {
    const file = path.join(dir, 'goal.json');
    const goal = { version: 1, kind: 'house', status: 'running', blueprint: houseBlueprint(new Vec3(2, 64, 3)) };
    new GoalStore(file).save(goal);
    assert.deepEqual(new GoalStore(file).read(), goal);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('rejects unoffered model output', async () => {
  await assert.rejects(interpret({ systemOne: async () => ({ answers: { objective: { choice: 'invented' }, addressed: { noul: 1 } } }) }, 'hi', 'p', 'bot'));
});
test('navigation cancellation stops movement and settles before another action', async () => {
  const { Task, navigate } = require('../src/skills');
  const task = new Task('test', 'test');
  let stopped = false;
  const bot = { pathfinder: { goto: () => new Promise(() => {}), setGoal: () => { stopped = true; } } };
  const pending = navigate(bot, task, {});
  task.cancel();
  await assert.rejects(pending, { name: 'Cancelled' });
  assert(stopped);
});
test('house keeps an exact two-block doorway and traversable interior', () => {
  const blueprint = houseBlueprint(new Vec3(10, 70, -20), 'dirt');
  const occupied = new Set(blueprint.blocks.map(p => `${p.x},${p.y},${p.z}`));
  assert.equal(occupied.size, 96);
  assert(!occupied.has('10,70,-22'));
  assert(!occupied.has('10,71,-22'));
  assert(occupied.has('10,72,-22'));
  assert(occupied.has('10,69,-22'));
  for (const p of blueprint.empty) assert(!occupied.has(`${p.x},${p.y},${p.z}`));
});
test('existing higher-tier tools avoid redundant lower-tier crafting', () => {
  const plan = planFor('purple_concrete', 32, { iron_pickaxe: 1 });
  assert(!plan.some(s => /pickaxe$/.test(s.item || '')));
  simulate('purple_concrete', 32, { iron_pickaxe: 1 });
});
