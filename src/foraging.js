'use strict';
const { goals } = require('mineflayer-pathfinder');
const { safeFood, checkAir } = require('./vitals');
const { threats, checkThreats } = require('./danger');
const { surfaceMovement } = require('./surface');
const { knowledge } = require('./knowledge');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Raw chicken is an ingredient, never edible reserve. Its cooking dependency
// comes from the same server recipe catalog used for requested items.
const prey = { cow: 'beef', pig: 'porkchop', sheep: 'mutton', chicken: 'chicken' };
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
function foodSupply(bot) {
  return bot.inventory.items().filter(i => safeFood(bot, i))
    .reduce((sum, i) => sum + i.count * bot.registry.foodsByName[i.name].foodPoints, 0);
}

function candidates(bot, state) {
  const surface = surfaceMovement(bot);
  try {
    const danger = threats(bot);
    return Object.values(bot.entities).filter(e => prey[e.name] && e.isValid !== false &&
      surface.isSurface(e.position) &&
      e.position.distanceTo(bot.entity.position) < 32 && !(state.failedPrey?.[e.uuid || e.id] > Date.now() - 120000) &&
      danger.every(t => t.entity.position.distanceTo(e.position) > 20))
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
      .filter(e => bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalFollow(e, 2), 150).status === 'success').slice(0, 3);
  } finally { surface.restore(); }
}

async function hunt(bot, task, target, actions, goal, save) {
  const surface = surfaceMovement(bot);
  try {
    const item = prey[target.name];
    const before = count(bot, item), foodBefore = foodSupply(bot);
    const deadline = Date.now() + 45000;
    const weapon = bot.inventory.items().filter(i => /_(sword|axe)$/.test(i.name))
      .sort((a, b) => ['wooden', 'stone', 'iron', 'diamond', 'netherite'].findIndex(t => b.name.startsWith(t)) -
        ['wooden', 'stone', 'iron', 'diamond', 'netherite'].findIndex(t => a.name.startsWith(t)))[0];
    if (weapon) await bot.equip(weapon, 'hand');
    else if (bot.heldItem) await bot.unequip('hand');
    const valid = () => bot.entities[target.id] === target && target.isValid !== false;
    let attacks = 0;
    while (valid() && Date.now() < deadline) {
      task.check(); checkAir(bot); checkThreats(bot);
      if (!surface.isSurface(target.position)) throw new Error(`Food target ${target.name} moved away from safe surface terrain`);
      if (bot.entity.position.distanceTo(target.position) > 2.8) {
        try { await actions.navigate(bot, task, new goals.GoalFollow(target, 2), { timeoutMs: 5000, stallMs: 2500, stopWhen: () => !valid() }); }
        catch (err) { task.check(); checkAir(bot); checkThreats(bot); if (err.name === 'NeedsAir') throw err; }
        continue;
      }
      if (!valid()) break;
      const eye = bot.entity.position.offset(0, 1.62, 0);
      const aim = target.position.offset(0, Math.min((target.height || 1) / 2, 1), 0);
      const direction = aim.minus(eye);
      const hit = bot.world.raycast(eye, direction.unit(), direction.norm());
      if (hit && eye.distanceTo(hit.intersect || hit.position) < direction.norm() - 0.25) throw new Error(`Food target ${target.name} is behind solid cover`);
      await bot.lookAt(target.position.offset(0, Math.min(target.height / 2, 1), 0), true);
      bot.attack(target); attacks++;
      for (let i = 0; i < 8; i++) { task.check(); checkThreats(bot); await sleep(100); }
    }
    bot.pathfinder.setGoal(null); bot.clearControlStates();
    if (valid()) throw new Error(`Could not finish gathering food from ${target.name} within 45 seconds`);
    await sleep(500);
    const drops = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === prey[target.name] && e.position.distanceTo(target.position) < 8);
    for (const drop of drops) {
      if (count(bot, item) > before) break;
      const p = drop.position.floored();
      await actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 1), { timeoutMs: 10000, stopWhen: () => count(bot, item) > before });
      await sleep(500);
    }
    if (count(bot, item) <= before) throw new Error(`No food ingredient pickup confirmed after hunting ${target.name}`);
    goal.survivalAction = { action: 'food_collected', source: target.name, item, count: count(bot, item) - before,
      needsCooking: !safeFood(bot, { name: item }), attacks, foodPointsGained: foodSupply(bot) - foodBefore, at: new Date().toISOString() };
    save();
  } finally { surface.restore(); }
}

function forageChoices(bot, task, goal, save, actions, state) {
  const choices = {};
  for (const [output, inputs] of Object.entries(knowledge(bot.registry).smelting)) {
    if (!safeFood(bot, { name: output })) continue;
    const input = inputs.find(name => count(bot, name) > 0);
    if (!input) continue;
    const amount = Math.min(count(bot, input), 4, Math.max(1, Math.ceil((12 - foodSupply(bot)) / bot.registry.foodsByName[output].foodPoints)));
    const targetCount = count(bot, output) + amount;
    choices[`cook_${output}`] = { description: { action: 'Cook carried ingredients into safe food using the recipe dependencies; gather a furnace, tool and fuel if needed.',
      input, carried: count(bot, input), output, amount, safeToEatRaw: safeFood(bot, { name: input }) },
    valid: () => count(bot, input) >= amount,
    run: async () => {
      goal.survivalAction = { action: 'cook_food', input, output, amount, at: new Date().toISOString() }; save();
      task.interruptCheck = () => checkThreats(bot);
      try { await actions.acquireStep(bot, task, output, targetCount, goal, save); }
      finally { task.interruptCheck = undefined; }
    } };
  }
  for (const target of candidates(bot, state)) {
    const observed = target.position.clone();
    choices[`hunt_${target.id}`] = { description: { action: 'hunt a passive animal and verify ingredient pickup; chicken must be cooked before eating',
      animal: target.name, position: { ...target.position.floored() }, distance: Math.round(target.position.distanceTo(bot.entity.position)),
      availableWeapon: bot.inventory.items().find(i => /_(sword|axe)$/.test(i.name))?.name || 'bare hands', food: prey[target.name], needsCooking: !safeFood(bot, { name: prey[target.name] }) },
    valid: () => bot.entities[target.id] === target && target.isValid !== false && target.position.distanceTo(observed) < 2,
    run: async () => {
      goal.survivalAction = { action: 'gather_food', animal: target.name, position: { ...target.position }, at: new Date().toISOString() }; save();
      task.interruptCheck = () => checkThreats(bot);
      try { await hunt(bot, task, target, actions, goal, save); }
      catch (err) {
        if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) {
          state.failedPrey ||= {}; state.failedPrey[target.uuid || target.id] = Date.now(); save();
        }
        throw err;
      } finally { task.interruptCheck = undefined; }
    } };
  }
  if (!Object.keys(choices).length) choices.search_food = {
    description: 'Walk to another observed dry area to search for passive animals; avoid remembered failed targets.',
    run: async () => {
      goal.survivalAction = { action: 'search_food', at: new Date().toISOString() }; save();
      task.interruptCheck = () => checkThreats(bot);
      try { await actions.explore(bot, task, goal, save, 'food animals', { surfaceOnly: true }); }
      finally { task.interruptCheck = undefined; }
    },
  };
  return choices;
}

module.exports = { foodSupply, forageChoices, hunt };
