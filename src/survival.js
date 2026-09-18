'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { threats, immediateThreat, checkThreats } = require('./danger');
const shelter = require('./shelter');
const { decideTree } = require('./decisions');
const { maintainVitals, chooseFood, checkAir } = require('./vitals');
const { foodSupply, forageChoices } = require('./foraging');
const { verifyHouse } = require('./objectives');
const { recoverItems } = require('./recovery');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pos = p => new Vec3(p.x, p.y, p.z);
const night = bot => bot.time?.timeOfDay >= 11500 && bot.time.timeOfDay < 23000;
const shelterNeeded = bot => bot.game.difficulty !== 'peaceful' && bot.game.dimension === 'overworld' &&
  bot.time?.timeOfDay >= 9500 && bot.time.timeOfDay < 23000;

// Minecraft actions are injected to avoid a dependency cycle with the work
// executor. The state lives on the retained goal and can also be shared by an
// idle companion session. No survival interruption replaces the player request.
class Survival {
  constructor(bot, actions, { state, client } = {}) {
    this.bot = bot; this.actions = actions; this.client = client;
    this.state = state || { shelters: [] };
    this.state.shelters ||= [];
    if (!bot._survivalHurtListener) {
      bot._survivalHurtListener = entity => { if (entity === bot.entity) bot._recentHurtAt = Date.now(); };
      bot.on('entityHurt', bot._survivalHurtListener);
    }
  }

  currentShelter() {
    const bot = this.bot;
    return this.state.shelters.filter(s => s.dimension === bot.game.dimension &&
      pos(s.origin).distanceTo(bot.entity.position) < 128 && bot.blockAt(pos(s.origin)))
      .sort((a, b) => pos(a.origin).distanceTo(bot.entity.position) + (a.verifiedAt ? 0 : 32) -
        pos(b.origin).distanceTo(bot.entity.position) - (b.verifiedAt ? 0 : 32))[0];
  }

  rememberHouse(blueprint) {
    if (!blueprint || !verifyHouse(this.bot, blueprint).ok) return false;
    if (this.state.shelters.some(s => s.kind === 'house' && s.dimension === this.bot.game.dimension && pos(s.origin).equals(pos(blueprint.origin)))) return false;
    this.state.shelters.push({ kind: 'house', origin: { ...blueprint.origin }, blueprint,
      dimension: this.bot.game.dimension, verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    return true;
  }

  report(goal, save, action) {
    goal.survivalAction = { ...action, at: new Date().toISOString() }; save();
  }

  async flee(task, goal, save) {
    const bot = this.bot;
    const danger = threats(bot).filter(t => t.visible);
    if (!danger.length) return;
    this.report(goal, save, { action: 'escape_threat', threats: danger.map(t => ({ name: t.entity.name, distance: t.distance })) });
    const movements = bot.pathfinder.movements;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    try {
      const ids = ['grass_block', 'dirt', 'stone', 'sand', 'gravel', 'cobblestone'].map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
      const distance = p => Math.min(...danger.map(t => t.entity.position.distanceTo(p)));
      const candidates = bot.findBlocks({ matching: ids, maxDistance: 20, count: 256,
        useExtraInfo: b => shelter.solid(b) && shelter.replaceable(bot.blockAt(b.position.offset(0, 1, 0))) && shelter.replaceable(bot.blockAt(b.position.offset(0, 2, 0))),
      }).map(p => p.offset(0, 1, 0)).filter(p => p.distanceTo(bot.entity.position) >= 6 &&
        distance(p) >= distance(bot.entity.position) + 4 && !(this.state.failedEscapes?.[`${p}`] > Date.now() - 60000))
        .sort((a, b) => distance(b) - distance(a));
      for (const p of candidates.slice(0, 16)) {
        const destination = new goals.GoalBlock(p.x, p.y, p.z);
        const route = bot.pathfinder.getPathTo(movements, destination, 150);
        if (route.status !== 'success') continue;
        // Do not run through another hostile to escape the closest one.
        if (route.path.some(point => danger.some(t => t.entity.position.distanceTo(pos(point)) < Math.min(4, t.distance - 1)))) continue;
        try { await this.actions.navigate(bot, task, destination, { timeoutMs: 7000, stallMs: 3000 }); return; }
        catch (err) {
          task.check(); if (err.name === 'NeedsAir') throw err;
          this.state.failedEscapes ||= {}; this.state.failedEscapes[`${p}`] = Date.now(); save();
          // Reobserve positions after a partial escape instead of running the
          // next stale route against the old mob positions.
          return;
        }
      }
      throw new Error('No observed safe escape route from the nearby hostile');
    } finally { Object.assign(movements, previous); bot.clearControlStates(); }
  }

  async refugeStep(task, goal, save) {
    const bot = this.bot;
    let refuge = this.currentShelter();
    if (!refuge) {
      const sites = shelter.shelterSites(bot, goal);
      const site = sites.find(p => bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalBlock(p.x, p.y, p.z), 150).status === 'success');
      if (!site) throw new Error('No reachable, supported 3 by 3 shelter site observed');
      refuge = { origin: { ...site }, dimension: bot.game.dimension, createdAt: new Date().toISOString() };
      this.state.shelters.push(refuge); save();
    }
    const missing = shelter.missingShell(bot, refuge);
    const stock = shelter.materialStock(bot);
    // Navigation can consume scaffold blocks or clear natural walls. Keep a
    // small travel reserve, then recheck the actual shell after entering.
    const required = missing.length + (shelter.inside(bot, refuge) ? 0 : 4);
    if (stock < required) {
      if (shelter.inside(bot, refuge)) {
        await this.leave(task, goal, save, refuge);
        if (shelter.inside(bot, refuge)) return;
      }
      this.report(goal, save, { action: 'gather_shelter_materials', need: required, carried: stock, origin: refuge.origin });
      task.interruptCheck = () => checkThreats(bot);
      try {
        const logs = bot.inventory.items().filter(i => i.name === 'oak_log').reduce((n, i) => n + i.count, 0);
        const planks = bot.inventory.items().filter(i => i.name === 'oak_planks').reduce((n, i) => n + i.count, 0);
        const dirt = bot.inventory.items().filter(i => i.name === 'dirt').reduce((n, i) => n + i.count, 0);
        await this.actions.acquireStep(bot, task, logs ? 'oak_planks' : 'dirt',
          logs ? planks + Math.min(logs * 4, required - stock) : dirt + required - stock, goal, save,
          { minimumMiningY: refuge.origin.y - 1 });
      } finally { task.interruptCheck = undefined; }
      return;
    }
    if (!shelter.inside(bot, refuge)) {
      // Reenter a previously sealed room through a verified two-block exit.
      if (shelter.sealed(bot, refuge)) {
        const exit = shelter.exits(bot, refuge).sort((a, b) => a.outside.distanceTo(bot.entity.position) - b.outside.distanceTo(bot.entity.position))[0];
        if (!exit) throw new Error('The saved shelter has no safe approach');
        await this.actions.navigate(bot, task, new goals.GoalBlock(exit.outside.x, exit.outside.y, exit.outside.z), { timeoutMs: 20000 });
        await this.actions.dig(bot, task, exit.door.offset(0, 1, 0));
        await this.actions.dig(bot, task, exit.door);
      }
      const o = pos(refuge.origin);
      await this.actions.navigate(bot, task, new goals.GoalBlock(o.x, o.y, o.z), { timeoutMs: 20000 });
    }
    if (shelter.materialStock(bot) < shelter.missingShell(bot, refuge).length) return;
    this.report(goal, save, { action: 'seal_shelter', origin: refuge.origin });
    const threat = immediateThreat(bot);
    const blocks = shelter.missingShell(bot, refuge).sort((a, b) => {
      // Finish a full-height wall on the threat-facing side first. Roof comes
      // last so every placement has a solid adjacent anchor.
      const rank = p => (p.y === refuge.origin.y + 2 ? 1000 : 0) +
        (threat ? Math.hypot(p.x - threat.entity.position.x, p.z - threat.entity.position.z) * 10 : 0) + p.y - refuge.origin.y;
      return rank(a) - rank(b);
    });
    for (const p of blocks) {
      task.check(); checkAir(bot);
      const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name))?.name;
      if (!material) throw new Error('Shelter material inventory changed before sealing');
      if (!['air', 'cave_air', 'void_air'].includes(bot.blockAt(p)?.name)) await this.actions.dig(bot, task, p);
      await this.actions.place(bot, task, p, material); save();
    }
    if (!shelter.inside(bot, refuge) || !shelter.sealed(bot, refuge)) throw new Error('Shelter verification failed');
    refuge.verifiedAt = new Date().toISOString();
    this.report(goal, save, { action: 'sheltered', origin: refuge.origin, health: bot.health });
  }

  async leave(task, goal, save, refuge) {
    const bot = this.bot;
    const danger = threats(bot);
    const exits = shelter.exits(bot, refuge).filter(exit => danger.every(t => t.entity.position.distanceTo(exit.outside) > 20));
    if (!exits.length) { await this.wait(task, goal, save, 'Nearby threats still block the shelter exits'); return; }
    const exit = exits[0];
    this.report(goal, save, { action: 'leave_shelter', origin: refuge.origin });
    await this.actions.dig(bot, task, exit.door.offset(0, 1, 0));
    await this.actions.dig(bot, task, exit.door);
    await this.actions.navigate(bot, task, new goals.GoalBlock(exit.outside.x, exit.outside.y, exit.outside.z), { timeoutMs: 10000 });
  }

  async wait(task, goal, save, reason = 'Waiting for daylight inside the verified shelter') {
    this.report(goal, save, { action: 'wait_in_shelter', reason });
    for (let i = 0; i < 50; i++) { task.check(); await sleep(100); }
  }

  async step(task, goal, save, onStep = () => {}) {
    const bot = this.bot;
    goal.survival = this.state;
    task.interruptCheck = undefined;
    if (bot.game.gameMode === 'creative') {
      await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate);
      return false;
    }
    if (this.rememberHouse(goal.blueprint)) save();
    await maintainVitals(bot, task, action => this.report(goal, save, action));
    const refuge = this.currentShelter();
    if (refuge && shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) {
      if (shelterNeeded(bot) || threats(bot).some(t => t.distance < 20)) await this.wait(task, goal, save);
      else await this.leave(task, goal, save, refuge);
      onStep(goal); return true;
    }
    const emergency = immediateThreat(bot);
    if (emergency) {
      // Sealing a nearby prepared site is faster than a long retreat. Otherwise
      // get clear first; ordinary digging must never continue under fire.
      if (refuge && pos(refuge.origin).distanceTo(bot.entity.position) < 3 && shelter.materialStock(bot) >= shelter.missingShell(bot, refuge).length) await this.refugeStep(task, goal, save);
      else await this.flee(task, goal, save);
      onStep(goal); return true;
    }
    const needsShelter = shelterNeeded(bot);
    if (!needsShelter && this.state.recovery?.status === 'pending') {
      this.report(goal, save, { action: 'recover_items', origin: this.state.recovery.position });
      if (await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate)) { onStep(goal); return true; }
    }
    const needsFood = foodSupply(bot) < 12 && (bot.food <= 18 || goal.stockFood ||
      (goal.kind === 'survive' && bot.game.difficulty !== 'peaceful'));
    if (!needsShelter && !needsFood) return false;
    const state = { playerRequest: goal.request, retainedGoal: goal.kind, timeOfDay: bot.time.timeOfDay,
      health: bot.health, food: bot.food, safeFoodCarried: !!chooseFood(bot),
      survivalFacts: { difficulty: bot.game.difficulty, hostileMobsSpawnAtNight: true,
        nightStartsAt: 11500, dawnAt: 23000, daylightTicksRemaining: Math.max(0, 11500 - bot.time.timeOfDay),
        shelterReady: !!refuge?.verifiedAt, shelterDistance: refuge ? Math.round(pos(refuge.origin).distanceTo(bot.entity.position)) : null },
      recentSurvivalAction: goal.survivalAction, carriedBuildingBlocks: shelter.materialStock(bot),
      foodReserve: { foodPoints: foodSupply(bot), desiredMinimum: 12, hungerMaximum: 20, starvationAt: 0 } };
    const tree = night(bot) && needsShelter ? {} : {
      continue_request: { description: goal.kind === 'survive' ? 'Wait nearby between player requests when survival preparations are already sufficient.' : 'Spend the next action on the player request while outside. Only suitable when hunger and daylight permit survival preparations afterwards.', run: async () => {} },
    };
    if (needsShelter) tree.secure_shelter = { description: 'Prepare and enter a sealed shelter before hostile mobs spawn at night. Reserve a nearby site, obtain missing blocks, then seal the room; keep the player request saved.', run: () => this.refugeStep(task, goal, save) };
    if (needsFood && !(night(bot) && needsShelter)) tree.obtain_food = { description: 'Obtain safe food to restore hunger and maintain a reserve for healing and the coming night. Keep the player request saved.',
      children: forageChoices(bot, task, goal, save, this.actions, this.state) };
    if (!this.client) {
      if (needsShelter) await tree.secure_shelter.run();
      else await Object.values(tree.obtain_food.children)[0].run();
      onStep(goal); return true;
    }
    const controller = new AbortController();
    const watcher = setInterval(() => { try { task.check(); checkAir(bot); checkThreats(bot); } catch (err) { controller.abort(err); } }, 100);
    let decision;
    try { decision = await decideTree(this.client, { state, tree, signal: controller.signal,
      isFresh: () => bot.health === state.health && bot.food === state.food && !immediateThreat(bot) }); }
    finally { clearInterval(watcher); }
    task.check(); checkAir(bot); checkThreats(bot);
    if (!decision.stale && decision.action.valid && !decision.action.valid()) decision.stale = true;
    goal.decisions ||= [];
    goal.decisions.push({ at: new Date().toISOString(), path: decision.path, state, options: JSON.parse(JSON.stringify(tree)),
      latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments, stale: decision.stale });
    goal.decisions = goal.decisions.slice(-40); save(); onStep(goal);
    if (decision.stale) return true;
    await decision.action.run();
    return decision.path[0] !== 'continue_request';
  }
}

module.exports = { Survival, night, shelterNeeded };
