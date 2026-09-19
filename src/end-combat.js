'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { dimension } = require('./game-progress');
const { countOf, surveyRoute } = require('./skills');
const { dryStanding } = require('./mining-access');
const { safeFromHostiles, checkThreats } = require('./danger');
const { checkAir, maintainVitals, chooseFood } = require('./vitals');
const { aimAtEntity, shootBow } = require('./projectiles');
const { decideTree } = require('./decisions');
const { canStrike } = require('./combat');
const { durable, carriedEquipment } = require('./mob-policy');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });
const vector = p => new Vec3(p.x, p.y, p.z);
const live = (bot, e) => e && e.isValid !== false && bot.entities[e.id] === e;
function metadata(bot, entity, name) {
  const index = bot.registry.entitiesByName[entity.name]?.metadataKeys?.indexOf(name);
  return index >= 0 ? entity.metadata?.[index] : undefined;
}
const perched = (bot, dragon) => [5, 6, 7].includes(metadata(bot, dragon, 'phase'));

function endHazards(bot) {
  return Object.values(bot.entities).filter(e => live(bot, e) && ['end_crystal', 'area_effect_cloud', 'dragon_fireball'].includes(e.name))
    .map(e => ({ entity: e, radius: e.name === 'end_crystal' ? 12 : e.name === 'area_effect_cloud' ?
      Math.max(1, Number(metadata(bot, e, 'radius')) || 3) + 2 : 6 }));
}
function safeEndPoint(bot, p, hazards = endHazards(bot)) {
  return safeFromHostiles(bot, p) && hazards.every(({ entity, radius }) =>
    entity.name === 'area_effect_cloud' && Math.abs(p.y - entity.position.y) > 3 || p.distanceTo(entity.position) > radius);
}

// The server assigns the dragon's eight part ids immediately after its root.
// In a stationary sitting phase the head is 6.5 blocks forward and one below
// the root. Flying head positions additionally use server flight history, so
// never manufacture a melee target for a moving/flying dragon.
function perchedHead(bot, dragon) {
  if (![6, 7].includes(metadata(bot, dragon, 'phase'))) return null;
  return { id: dragon.id + 1, name: 'ender_dragon_head', width: 1, height: 1, isValid: true,
    position: dragon.position.offset(Math.sin(dragon.yaw) * 6.5, -1, Math.cos(dragon.yaw) * 6.5) };
}

function arenaMovement(bot) {
  const movement = bot.pathfinder.movements, start = bot.entity.position.clone();
  const previous = { canDig: movement.canDig, blocksCantBreak: movement.blocksCantBreak, allow1by1towers: movement.allow1by1towers,
    allowSprinting: movement.allowSprinting, scafoldingBlocks: movement.scafoldingBlocks, allowedPosition: movement.allowedPosition };
  const cantBreak = new Set(movement.blocksCantBreak);
  if (carriedEquipment(bot).some(i => /_pickaxe$/.test(i.name))) cantBreak.delete(bot.registry.blocksByName.end_stone.id);
  // Receding from an already close cloud/crystal is permitted; entering its
  // danger radius from outside is not. All routes use loaded block geometry.
  const allowed = p => {
    const point = vector(p).offset(.5, 0, .5);
    return point.y >= start.y - 3 && point.distanceTo(start) <= 64 && (!previous.allowedPosition || previous.allowedPosition(p)) &&
      endHazards(bot).every(({ entity, radius }) => entity.name === 'area_effect_cloud' && Math.abs(point.y - entity.position.y) > 3 ||
        point.distanceTo(entity.position) >= Math.min(radius, start.distanceTo(entity.position) - .1));
  };
  Object.assign(movement, { canDig: true, blocksCantBreak: cantBreak, allow1by1towers: false, allowSprinting: false,
    scafoldingBlocks: ['cobblestone', 'end_stone'].map(n => bot.registry.itemsByName[n].id), allowedPosition: allowed });
  return { allowed, restore: () => Object.assign(movement, previous) };
}

async function arenaRoutes(bot, task, goal, policy, focus) {
  const current = bot.entity.position, visits = goal.endCombat.visits ||= {}, buckets = new Map();
  const floors = bot.findBlocks({ matching: ['end_stone', 'obsidian', 'bedrock'].map(n => bot.registry.blocksByName[n].id),
    maxDistance: 64, count: 256, useExtraInfo: block => {
      const p = block.position.offset(.5, 1, .5);
      return p.distanceTo(current) >= 5 && dryStanding(bot, p) && safeEndPoint(bot, p);
    } });
  for (const floor of floors) {
    const p = floor.offset(0, 1, 0), point = p.offset(.5, 0, .5);
    if (!policy.allowed(p)) continue;
    const key = `${Math.floor(p.x / 8)},${Math.floor(p.z / 8)}`;
    const score = (visits[key] || 0) * 30 + (focus ? Math.hypot(point.x - focus.x, point.z - focus.z) : -point.distanceTo(current)) + Math.abs(point.y - current.y);
    if (!buckets.has(key) || score < buckets.get(key).score) buckets.set(key, { p, key, score });
  }
  const routes = [];
  for (const candidate of [...buckets.values()].sort((a, b) => a.score - b.score).slice(0, 10)) {
    task.check();
    const p = candidate.p, destination = new goals.GoalBlock(p.x, p.y, p.z);
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 250);
    if (route.status === 'success' && route.path.every(policy.allowed)) routes.push({ ...candidate, destination });
    if (routes.length === 3) break;
  }
  return routes;
}

async function fightEndStep(bot, task, goal, save, actions, client, { shot = shootBow } = {}) {
  const check = () => {
    task.check(); checkAir(bot);
    if (dimension(bot) !== 'end' || bot.game.gameMode !== 'survival' || bot.health <= 0 || bot.isAlive === false) throw blocked('End combat requires a living Survival player in the End');
  };
  check();
  if (goal.gameProgress?.milestones.dragon_defeated) return;
  const state = goal.endCombat ||= { steps: 0, shots: [], destroyedCrystals: [], visits: {}, noProgress: 0 };
  if (++state.steps > 1200 || state.noProgress >= 80) throw blocked('End combat exhausted its bounded action budget without verified damage, a crystal explosion or new ground');
  const policy = arenaMovement(bot), oldInterrupt = task.interruptCheck;
  const started = Date.now(), start = bot.entity.position.clone(), healthBefore = bot.health;
  const dragons = Object.values(bot.entities).filter(e => live(bot, e) && e.name === 'ender_dragon');
  if (dragons.length > 1) { policy.restore(); throw blocked('More than one observed dragon; target is ambiguous'); }
  const dragon = dragons[0], beforeDragon = dragon && metadata(bot, dragon, 'health');
  let progress = false;
  const motion = new Map();
  const moved = entity => {
    if (entity !== dragon) return;
    const now = Date.now(), previous = motion.get(entity);
    if (!previous || now - previous.at >= 40) motion.set(entity, { at: now, position: entity.position.clone(),
      velocity: previous && now - previous.at < 500 ? entity.position.minus(previous.position).scaled(50 / (now - previous.at)) : null });
  };
  const velocity = () => {
    const sample = motion.get(dragon);
    if (!sample?.velocity || Date.now() - sample.at > 500 || sample.velocity.norm() > 3) throw new Error('No recent observed dragon motion for an aimed shot');
    return sample.velocity;
  };
  bot.on('entityMoved', moved); if (dragon) moved(dragon);
  try {
    task.interruptCheck = () => { oldInterrupt?.(); if (dimension(bot) !== 'end' || bot.health <= 0) throw blocked('End combat interrupted by dimension change or death'); };
    if (safeEndPoint(bot, bot.entity.position)) {
      if (await maintainVitals(bot, task, action => { goal.survivalAction = { ...action, at: new Date().toISOString() }; save(); })) return;
    }
    if (bot.food < 16 && !chooseFood(bot)) throw blocked('End combat has no carried food to restore hunger');
    const crystals = Object.values(bot.entities).filter(e => live(bot, e) && e.name === 'end_crystal');
    state.observedCrystals = crystals.map(e => ({ id: e.id, position: { ...e.position } }));
    state.dragon = dragon && { id: dragon.id, position: { ...dragon.position }, health: beforeDragon, phase: metadata(bot, dragon, 'phase') };
    const tree = {}, safe = safeEndPoint(bot, bot.entity.position);
    const guardShot = () => { check(); if (!safeEndPoint(bot, bot.entity.position) || bot.health < 12) throw new Error('End firing position became unsafe'); };
    const shoot = async target => {
      guardShot();
      if (target === dragon && perched(bot, dragon)) throw new Error('The dragon perched before the shot');
      let explosion = false;
      const targetPosition = target.position.clone();
      const observeExplosion = packet => { if (vector(packet.center).distanceTo(targetPosition) < 3) explosion = true; };
      bot._client.on('explosion', observeExplosion);
      try {
        const result = await shot(bot, task, target, { guard: () => {
          guardShot(); if (target === dragon && perched(bot, dragon)) throw new Error('The dragon perched while drawing');
        }, velocity: target === dragon ? velocity : new Vec3(0, 0, 0) });
        state.shots.push(result); state.shots = state.shots.slice(-256); save();
        const until = Date.now() + Math.min(5000, Math.ceil(result.ticks * 50) + 500);
        while (Date.now() < until) { check(); if (!safeEndPoint(bot, bot.entity.position)) break; await sleep(50); }
        if (target.name === 'end_crystal' && explosion && !live(bot, target)) {
          const evidence = { at: Date.now(), id: target.id, position: { ...targetPosition }, source: 'explosion_and_entity_removed' };
          state.destroyedCrystals.push(evidence); bot.emit('end_combat', { crystal: evidence }); progress = true;
        }
      } finally { bot._client.removeListener('explosion', observeExplosion); }
    };
    const bow = bot.inventory.items().some(i => i.name === 'bow' && durable(bot.registry, i));
    if (safe && bot.health >= 12 && bow && countOf(bot, 'arrow') > 0) {
      for (const target of crystals) if (aimAtEntity(bot, target)) tree[`crystal_${target.id}`] = {
        description: { action: 'Destroy an observed healing crystal with a clear bow trajectory', position: { ...target.position } }, run: () => shoot(target),
      };
      if (dragon && !perched(bot, dragon)) {
        for (let n = 0; n < 6; n++) { check(); await sleep(50); }
        let motionNow; try { motionNow = velocity(); } catch (_) { /* no feasible predicted shot */ }
        if (motionNow && aimAtEntity(bot, dragon, motionNow)) tree.shoot_dragon = {
          description: { action: 'Shoot the flying dragon using its observed motion; healing crystals may undo the damage', health: beforeDragon, healingCrystals: crystals.length }, run: () => shoot(dragon),
        };
      }
    }
    const head = dragon && perchedHead(bot, dragon);
    if (safe && head && canStrike(bot, head) && bot.inventory.items().some(i => /_sword$/.test(i.name) && durable(bot.registry, i))) {
      tree.strike_head = { description: 'Strike the reachable head of the perched dragon with the carried sword', run: async () => {
        const sword = bot.inventory.items().find(i => /_sword$/.test(i.name) && durable(bot.registry, i));
        await bot.equip(sword, 'hand'); check();
        const fresh = perchedHead(bot, dragon);
        if (!fresh || !live(bot, dragon) || !safeEndPoint(bot, bot.entity.position) || !canStrike(bot, fresh)) throw new Error('Perched dragon head moved out of reach');
        bot.attack(fresh); for (let n = 0; n < 8; n++) { check(); await sleep(100); }
      } };
    }
    const focus = crystals[0]?.position || (head ? head.position : dragon?.position);
    // Reposition when arcs are blocked or the dragon is perched, and always
    // expose escape positions when healing or avoiding a breath cloud.
    if (!Object.keys(tree).some(key => key.startsWith('crystal_')) || bot.health < 16) for (const route of await arenaRoutes(bot, task, goal, policy, focus)) {
      tree[`move_${route.key}`] = { description: { action: 'Move along this surveyed arena route to escape hazards or gain a firing angle', position: { ...route.p }, visits: state.visits[route.key] || 0 }, run: async () => {
        state.visits[route.key] = (state.visits[route.key] || 0) + 1; save();
        const initiallySafe = safeEndPoint(bot, bot.entity.position);
        await actions.navigate(bot, task, route.destination, { timeoutMs: 18000, stallMs: 4000,
          stopWhen: () => initiallySafe && !safeEndPoint(bot, bot.entity.position) });
      } };
    }
    if (safe && dragon) tree.observe = { description: { action: 'Briefly observe the dragon to wait for a vulnerable flight or perch, or allow food regeneration', health: bot.health, dragonPhase: metadata(bot, dragon, 'phase') }, run: async () => {
      bot.clearControlStates(); for (let n = 0; n < 10; n++) { check(); if (!safeEndPoint(bot, bot.entity.position)) break; await sleep(100); }
    } };
    if (!Object.keys(tree).length) throw blocked('No observed safe End route, reachable dragon head or clear bow shot; supplies and position are saved');
    if (!client) throw blocked('End action selection needs the configured Jev decision client');
    const controller = new AbortController(), watcher = setInterval(() => { try { check(); } catch (err) { controller.abort(err); } }, 50);
    let decision;
    try { decision = await decideTree(client, { tree, state: { request: goal.request, task: 'Defeat the Ender Dragon. Destroy healing crystals first when feasible, avoid breath clouds, attack vulnerable phases, and preserve health.',
      health: bot.health, food: bot.food, arrows: countOf(bot, 'arrow'), dragon: state.dragon, crystals: state.observedCrystals,
      noProgress: state.noProgress, recentShots: state.shots.slice(-3), lastError: goal.lastError }, signal: controller.signal,
      isFresh: () => dimension(bot) === 'end' && bot.health >= healthBefore && bot.entity.position.distanceTo(start) < 1 }); }
    finally { clearInterval(watcher); }
    check();
    goal.decisions ||= []; goal.decisions.push({ at: new Date().toISOString(), path: decision.path, judgments: decision.judgments,
      usage: decision.usage, latencyMs: decision.latencyMs, stale: decision.stale, options: JSON.parse(JSON.stringify(tree)) });
    goal.decisions = goal.decisions.slice(-40);
    if (decision.stale) return;
    goal.step = { action: 'end_combat', selected: decision.path, dragonHealth: beforeDragon, observedCrystals: crystals.length }; save();
    try { await decision.action.run(); }
    catch (err) {
      if (['Cancelled', 'Blocked'].includes(err.name)) throw err;
      // Moving targets, a newly visible cloud or an obstructed route require
      // a fresh bounded choice. They do not invalidate the retained goal.
      state.lastInterrupted = { at: Date.now(), action: decision.path, reason: err.message }; save();
    }
  } finally {
    const after = dragon && metadata(bot, dragon, 'health');
    if (Number.isFinite(after) && after < beforeDragon) { state.lastDamage = { at: Date.now(), before: beforeDragon, after }; progress = true; bot.emit('end_combat', { damage: state.lastDamage }); }
    const cell = `${Math.floor(bot.entity.position.x / 4)},${Math.floor(bot.entity.position.z / 4)}`;
    state.ground ||= {};
    if (start.distanceTo(bot.entity.position) >= 3 && !state.ground[cell]) { state.ground[cell] = true; progress = true; }
    state.noProgress = progress ? 0 : (state.noProgress || 0) + 1;
    state.lastActionAt = started; save();
    bot.removeListener('entityMoved', moved); task.interruptCheck = oldInterrupt;
    bot.pathfinder.setGoal(null); bot.clearControlStates(); policy.restore();
  }
}

module.exports = { metadata, perched, perchedHead, endHazards, safeEndPoint, arenaMovement, arenaRoutes, fightEndStep };
