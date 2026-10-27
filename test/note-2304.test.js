'use strict';
// Ore in view with no stand beside it is tunnelled to, not set aside for the next ore behind rock (note 2304).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const access = require('../src/mining-access');
const tunneling = require('../src/tunneling');

test('iron seen through rock with no stand beside it: the step tunnels toward it and does not set it aside', async () => {
  const tunnelled = [];
  const realApproach = access.approachDryMining, realTunnel = tunneling.resourceTunnelStep;
  access.approachDryMining = async (bot, task, p) => { throw new Error(`No reachable dry standing position for mining at ${p}`); };
  tunneling.resourceTunnelStep = async (bot, task, goal, save, target, resource) => { tunnelled.push({ target, resource }); bot.entity.position = target.offset(0, 0, 3); };
  delete require.cache[require.resolve('../src/work')];
  try {
    const { mineAtSource } = require('../src/work');
    const ore = new Vec3(30, 20, 0);
    const bot = { entity: { position: new Vec3(0.5, 30, 0.5) }, health: 20, food: 20, oxygenLevel: 20, game: { dimension: 'overworld' },
      inventory: { items: () => [], slots: [] }, heldItem: null, blockAt: p => ({ name: p.equals(ore) ? 'iron_ore' : 'stone', position: p }),
      registry: { blocksByName: {}, itemsByName: {} }, entities: {} };
    const goal = {}, task = { check() {}, cancelled: false };
    await mineAtSource(bot, task, { action: 'mine', block: 'iron_ore', drops: 'raw_iron', count: 2, tool: 'stone_pickaxe' }, goal, () => {}, ore);
    assert.equal(tunnelled.length >= 1, true, 'a tunnel dug toward the ore');
    assert.ok(tunnelled[0].target.equals(ore) && tunnelled[0].resource === 'iron_ore');
    assert.deepEqual({ x: goal.tunnelOre.x, y: goal.tunnelOre.y, z: goal.tunnelOre.z }, { x: 30, y: 20, z: 0 });
    assert.ok(!(goal.setAside?.reach || []).length && !JSON.stringify(goal.setAside || {}).includes('30,20,0'), 'the ore is not set aside');
  } finally {
    access.approachDryMining = realApproach; tunneling.resourceTunnelStep = realTunnel;
    delete require.cache[require.resolve('../src/work')];
  }
});

// note 2305: a tunnel that cannot start sets the ore aside, and the same ore is not tunnelled again from the same place.
test('a tunnel to seen ore that cannot start from here, or got nowhere since the last try, sets the ore aside', async () => {
  const { isSetAside } = require('../src/progress');
  const realApproach = access.approachDryMining, realTunnel = tunneling.resourceTunnelStep;
  let tunnels = 0, mode = 'throw';
  access.approachDryMining = async (bot, task, p) => { throw new Error(`No reachable dry standing position for mining at ${p}`); };
  tunneling.resourceTunnelStep = async () => { tunnels++; if (mode === 'throw') throw Object.assign(new Error('No route from here to (1, 30, 0) (noPath)'), { name: 'NoRoute' }); };
  delete require.cache[require.resolve('../src/work')];
  try {
    const { mineAtSource } = require('../src/work');
    const ore = new Vec3(30, 20, 0);
    const bot = { entity: { position: new Vec3(0.5, 30, 0.5) }, health: 20, food: 20, oxygenLevel: 20, game: { dimension: 'overworld' },
      inventory: { items: () => [], slots: [] }, heldItem: null, blockAt: p => ({ name: p.equals(ore) ? 'iron_ore' : 'stone', position: p }),
      registry: { blocksByName: {}, itemsByName: {} }, entities: {} };
    const task = { check() {}, cancelled: false }, step = { action: 'mine', block: 'iron_ore', drops: 'raw_iron', count: 2, tool: 'stone_pickaxe' };
    let goal = {};
    await mineAtSource(bot, task, step, goal, () => {}, ore).catch(() => {});
    assert.equal(tunnels, 1, 'one tunnel tried');
    assert.ok(isSetAside(goal, 'reach', ore), 'the ore is set aside when the tunnel cannot start');
    // The tunnel returns without moving the bot: the next try from the same place sets the ore aside, no second tunnel.
    goal = {}; mode = 'still'; tunnels = 0;
    await mineAtSource(bot, task, step, goal, () => {}, ore);
    assert.equal(tunnels, 1);
    await mineAtSource(bot, task, step, goal, () => {}, ore).catch(() => {});
    assert.equal(tunnels, 1, 'not tunnelled again from the same place');
    assert.ok(isSetAside(goal, 'reach', ore));
  } finally {
    access.approachDryMining = realApproach; tunneling.resourceTunnelStep = realTunnel;
    delete require.cache[require.resolve('../src/work')];
  }
});
