'use strict';
const { goals } = require('mineflayer-pathfinder');
const { dimension } = require('./game-progress');
const { dryStanding } = require('./mining-access');
const { surveyRoute } = require('./skills');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });

async function exitEnd(bot, task, goal, save, { navigate }, { timeoutMs = 20000 } = {}) {
  task.check();
  const credit = goal.gameProgress?.milestones.dragon_defeated;
  if (!credit || credit.source !== 'minecraft:end/kill_dragon') throw blocked('End return requires verified player dragon-kill credit');
  if (dimension(bot) !== 'end' || bot.game.gameMode !== 'survival' || bot.health <= 0) throw blocked('End return requires a living Survival player in the End');
  const portals = bot.findBlocks({ matching: bot.registry.blocksByName.end_portal.id, maxDistance: 96, count: 32 });
  if (!portals.length) throw blocked('No active exit portal is visible after dragon defeat');
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, scafoldingBlocks: movement.scafoldingBlocks, allow1by1towers: movement.allow1by1towers };
  Object.assign(movement, { canDig: false, scafoldingBlocks: [], allow1by1towers: false });
  const dead = () => { if (bot.health <= 0) throw blocked('Died during End return'); };
  let destination;
  try {
    // A saved coordinate or empty fountain is insufficient. The target must
    // still be a loaded, active portal on the route we actually execute.
    for (const p of portals) {
      task.check(); checkAir(bot); checkThreats(bot); dead();
      const candidate = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, candidate, 350);
      if (route.status === 'success') { destination = { goal: candidate, p }; break; }
    }
    if (!destination) throw blocked('No observed walking route into the active End exit portal');
    goal.step = { action: 'exit_end_portal', position: { ...destination.p } }; save();
    if (bot.blockAt(destination.p)?.name !== 'end_portal') throw blocked('The End exit portal changed before approach');
    await navigate(bot, task, destination.goal, { timeoutMs, stallMs: 4000,
      stopWhen: () => dimension(bot) !== 'end' || !!goal.gameProgress.milestones.exit_portal_used });
    bot.pathfinder.setGoal(null); bot.clearControlStates();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      task.check(); dead();
      const exited = goal.gameProgress.milestones.exit_portal_used;
      if (exited && dimension(bot) === 'overworld' && bot.isAlive !== false && dryStanding(bot, bot.entity.position)) {
        goal.endReturn = { at: Date.now(), position: { ...bot.entity.position }, health: bot.health, source: 'living_exit_portal_return' }; save(); return;
      }
      await sleep(50);
    }
    throw blocked('No exit-portal event followed by a living, loaded Overworld landing was confirmed');
  } finally { bot.pathfinder.setGoal(null); bot.clearControlStates(); Object.assign(movement, previous); }
}

module.exports = { exitEnd };
