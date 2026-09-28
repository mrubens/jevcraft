'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { dimension } = require('./game-progress');
const { countOf, surveyRoute } = require('./skills');
const { dryStanding } = require('./mining-access');
const { safeFromHostiles, hostileEntities } = require('./danger');
const { checkAir, maintainVitals, chooseFood } = require('./vitals');
const { aimAtEntity, shootBow } = require('./projectiles');
const { decide } = require('./decisions');

// The dragon_fight question and its fixed-order fallback live in
// decisions/combat.js; endFallback is re-exported for its callers.
const { endFallback } = require('./decisions/combat');
const { canStrike, defendNearby, raiseShield, lowerShield } = require('./combat');
const { durable, carriedEquipment } = require('./mob-policy');
const { fallDanger, recoverFall } = require('./fall-recovery');
const { cloudRadius, hazardDistance, endEmergency, checkEndEmergency, evadeDragon } = require('./end-safety');
const { endDecisionState } = require('./decisions/end-state');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });
const vector = p => new Vec3(p.x, p.y, p.z);
const live = (bot, e) => e && e.isValid !== false && bot.entities[e.id] === e;
function metadata(bot, entity, name) {
  const index = bot.registry.entitiesByName[entity.name]?.metadataKeys?.indexOf(name);
  return index >= 0 ? entity.metadata?.[index] : undefined;
}
const perched = (bot, dragon) => [5, 6, 7].includes(metadata(bot, dragon, 'phase'));
const crystalKey = entity => `${entity.position.x},${entity.position.y},${entity.position.z}`;
function repeatedCrystalMiss(state, target, position) {
  return (state.shots || []).filter(s => s.outcome === 'target_remains' && s.targetPosition && s.origin &&
    vector(s.targetPosition).distanceTo(target.position) < .1 && vector(s.origin).offset(0, -1.52, 0).distanceTo(position) < 4).length >= 2;
}
function observeArena(bot, state, now = Date.now()) {
  const crystals = Object.values(bot.entities).filter(e => live(bot, e) && e.name === 'end_crystal');
  const known = state.knownCrystals ||= {}, seen = new Set(crystals.map(crystalKey));
  for (const e of crystals) known[crystalKey(e)] = { id: e.id, position: { ...e.position }, status: 'observed', lastSeenAt: now };
  for (const [key, entry] of Object.entries(known)) {
    if (seen.has(key) || ['destroyed', 'absent_on_revisit'].includes(entry.status)) continue;
    // Entity tracking range is not world destruction. Keep missing targets
    // until a close, loaded revisit has had time to receive entity packets.
    entry.status = 'unresolved';
    const p = vector(entry.position), close = Math.hypot(p.x - bot.entity.position.x, p.z - bot.entity.position.z) < 24;
    if (close && bot.blockAt(p)) {
      entry.absentSince ??= now;
      if (now - entry.absentSince >= 1500) { entry.status = 'absent_on_revisit'; entry.revisitedAt = now; }
    } else delete entry.absentSince;
  }
  const dragon = Object.values(bot.entities).find(e => live(bot, e) && e.name === 'ender_dragon');
  if (dragon) {
    state.lastDragon = { position: { ...dragon.position }, phase: metadata(bot, dragon, 'phase'), at: now };
    if (perched(bot, dragon)) state.arenaCenter = { ...dragon.position };
  }
  return crystals;
}

function endHazards(bot) {
  return Object.values(bot.entities).filter(e => live(bot, e) && (['end_crystal', 'area_effect_cloud', 'dragon_fireball'].includes(e.name) ||
    e.name === 'ender_dragon' && !perched(bot, e) && metadata(bot, e, 'phase') !== 9))
    .map(e => ({ entity: e, radius: e.name === 'end_crystal' ? 12 : e.name === 'area_effect_cloud' ?
      cloudRadius(bot, e) : e.name === 'ender_dragon' ? 16 : 6 }));
}
function safeEndPoint(bot, p, hazards = endHazards(bot)) {
  // Navigation allows retreat from an already close mob. A place to stand,
  // draw or heal must satisfy the full buffer, not that retreat exception.
  return safeFromHostiles(bot, p) && hostileEntities(bot, 64).every(e => p.distanceTo(e.position) >= 20) &&
    hazards.every(({ entity, radius }) => hazardDistance(p, entity) > radius);
}

// Water answers an enderman: one that touches it is hurt and teleports
// away, and a source poured at the feet spreads a ring of flowing water it
// has to cross to strike. The End kit carries a bucket for this. Poured
// only on solid ground into the bot's own open cell; taken back once no
// turned mob is near, so the bucket is there for the next one.
async function pourAtFeet(bot, check) {
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  // One bucket stays full for a knocked-back landing.
  if (!bucket || countOf(bot, 'water_bucket') < 2) return null;
  const feet = bot.entity.position.floored(), below = feet.offset(0, -1, 0);
  if (bot.blockAt(below)?.boundingBox !== 'block' || bot.blockAt(feet)?.name !== 'air') return null;
  await bot.equip(bucket, 'hand'); check();
  await bot.lookAt(below.offset(.5, 1, .5), true);
  bot.activateItem();
  for (let n = 0; n < 20; n++) { check(); if (bot.blockAt(feet)?.name === 'water') return feet; await sleep(50); }
  return null;
}
async function takeWaterBack(bot, check, at) {
  const p = vector(at), bucket = bot.inventory.items().find(i => i.name === 'bucket');
  if (!bucket || bot.blockAt(p)?.name !== 'water' || bot.entity.position.distanceTo(p.offset(.5, .5, .5)) > 4) return false;
  const before = countOf(bot, 'water_bucket');
  await bot.equip(bucket, 'hand'); check();
  await bot.lookAt(p.offset(.5, .9, .5), true);
  bot.activateItem();
  for (let n = 0; n < 20; n++) { check(); if (countOf(bot, 'water_bucket') > before) return true; await sleep(50); }
  return false;
}

// How near the island's edge a point is: the nearest column within `reach`
// with nothing under it for forty blocks, the void. And the endermen near
// the straight line to it. Said with each move (the decision audit,
// 2026-09-25): a knockback at the edge is the whole run.
function voidEdge(bot, p, reach = 8) {
  for (let r = 1; r <= reach; r++) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = Math.floor(p.x) + dx * r, z = Math.floor(p.z) + dz * r;
      let floor = false, loaded = true;
      for (let y = Math.floor(p.y); y >= Math.floor(p.y) - 40; y--) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (!b) { loaded = false; break; }
        if (b.boundingBox === 'block') { floor = true; break; }
      }
      if (loaded && !floor) return r;
    }
  }
  return null;
}
function endermenNearRoute(bot, from, to, width = 6) {
  const d = to.minus(from), len2 = d.dot(d) || 1;
  return Object.values(bot.entities || {}).filter(e => e.name === 'enderman' && live(bot, e) && e.position).filter(e => {
    const t = Math.max(0, Math.min(1, e.position.minus(from).dot(d) / len2));
    return e.position.distanceTo(from.plus(d.scaled(t))) <= width;
  }).length;
}

// Why a point is not safe, for the record when nothing can be done.
function unsafeBecause(bot, p, hazards = endHazards(bot)) {
  const out = [];
  if (!safeFromHostiles(bot, p)) out.push('hostile path');
  for (const e of hostileEntities(bot, 64)) if (p.distanceTo(e.position) < 20) out.push(`${e.name} ${Math.round(p.distanceTo(e.position))}`);
  for (const { entity, radius } of hazards) if (hazardDistance(p, entity) <= radius) out.push(`${entity.name} ${Math.round(hazardDistance(p, entity))}<=${radius}`);
  return out;
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

function arenaMovement(bot, center) {
  const movement = bot.pathfinder.movements, start = bot.entity.position.clone();
  const previous = { canDig: movement.canDig, blocksCantBreak: movement.blocksCantBreak, allow1by1towers: movement.allow1by1towers,
    allowSprinting: movement.allowSprinting, scafoldingBlocks: movement.scafoldingBlocks, allowedPosition: movement.allowedPosition };
  const cantBreak = new Set(movement.blocksCantBreak);
  if (carriedEquipment(bot).some(i => /_pickaxe$/.test(i.name))) cantBreak.delete(bot.registry.blocksByName.end_stone.id);
  // Receding from an already close cloud/crystal is permitted; entering its
  // danger radius from outside is not. Compare hazards with the live position:
  // a new cloud or knockback can put us closer than the original route start.
  // A stale distance would forbid even the first step back out of danger.
  const allowedPoint = point => {
    return point.y >= start.y - 3 && point.distanceTo(start) <= 64 &&
      (!center || Math.hypot(point.x - center.x, point.z - center.z) <= Math.max(96, Math.hypot(start.x - center.x, start.z - center.z))) &&
      (!previous.allowedPosition || previous.allowedPosition(point.floored())) &&
      endHazards(bot).every(({ entity, radius }) =>
        hazardDistance(point, entity) >= Math.min(radius, hazardDistance(bot.entity.position, entity) - .1));
  };
  const allowed = p => allowedPoint(vector(p).offset(.5, 0, .5));
  Object.assign(movement, { canDig: true, blocksCantBreak: cantBreak, allow1by1towers: false, allowSprinting: false,
    scafoldingBlocks: ['cobblestone', 'end_stone'].map(n => bot.registry.itemsByName[n].id), allowedPosition: allowed });
  return { allowed, allowedPoint, restore: () => Object.assign(movement, previous) };
}

async function arenaRoutes(bot, task, goal, policy, focus) {
  const current = bot.entity.position, visits = goal.endCombat.visits ||= {}, buckets = new Map();
  const target = focus?.position || focus;
  const desiredRange = focus?.name === 'end_crystal' ? Math.max(24, Math.min(56, (target.y - current.y) * 1.1)) : 0;
  const floors = bot.findBlocks({ matching: ['end_stone', 'obsidian', 'bedrock'].map(n => bot.registry.blocksByName[n].id),
    maxDistance: 64, count: 256, useExtraInfo: block => {
      const p = block.position.offset(.5, 1, .5);
      return p.distanceTo(current) >= 5 && dryStanding(bot, p) && safeEndPoint(bot, p);
    } });
  for (const floor of floors) {
    const p = floor.offset(0, 1, 0), point = p.offset(.5, 0, .5);
    if (!policy.allowed(p)) continue;
    const key = `${Math.floor(p.x / 8)},${Math.floor(p.z / 8)}`;
    // A high caged crystal needs a shallow approach angle. Walking directly
    // underneath it makes the obsidian column obscure more of its hitbox.
    const distance = target && Math.hypot(point.x - target.x, point.z - target.z);
    const score = (visits[key] || 0) * 30 + (target ? Math.abs(distance - desiredRange) : -point.distanceTo(current)) + Math.abs(point.y - current.y);
    if (!buckets.has(key) || score < buckets.get(key).score) buckets.set(key, { p, key, score });
  }
  const routes = [];
  for (const candidate of [...buckets.values()].sort((a, b) => a.score - b.score).slice(0, 10)) {
    task.check();
    const p = candidate.p, destination = new goals.GoalBlock(p.x, p.y, p.z);
    // A second: from the island's edge the ground climbs nine blocks to the
    // pillars, and every quarter-second survey timed out, so the rehearsal
    // bot stood at the edge with nothing to choose.
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 1000);
    if (route.status === 'success' && route.path.every(policy.allowed)) routes.push({ ...candidate, destination,
      clearCrystalShot: focus?.name === 'end_crystal' && !repeatedCrystalMiss(goal.endCombat, focus, p.offset(.5, 0, .5)) &&
        !!aimAtEntity(bot, focus, new Vec3(0, 0, 0), p.offset(.5, 0, .5)),
      targetDistance: target && p.offset(.5, 0, .5).distanceTo(target), desiredHorizontalRange: desiredRange });
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
  observeArena(bot, state);
  const policy = arenaMovement(bot, state.arenaCenter), oldInterrupt = task.interruptCheck;
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
  const respond = async () => {
    // Emergency handlers must not trip the guard that interrupted ordinary
    // planning. They still retain cancellation and the caller's guard.
    task.interruptCheck = oldInterrupt;
    if (fallDanger(bot)) await recoverFall(bot, task, goal, save);
    else await evadeDragon(bot, task, goal, save, { allowed: p => policy.allowedPoint(p) && safeFromHostiles(bot, p) });
  };
  try {
    if (endEmergency(bot)) { await respond(); return; }
    task.interruptCheck = () => {
      oldInterrupt?.();
      if (dimension(bot) !== 'end' || bot.health <= 0) throw blocked('End combat interrupted by dimension change or death');
      checkEndEmergency(bot);
    };
    if (safeEndPoint(bot, bot.entity.position)) {
      if (await maintainVitals(bot, task, action => { goal.survivalAction = { ...action, at: new Date().toISOString() }; save(); }, { client, goal, save })) return;
    }
    if (bot.food < 16 && !chooseFood(bot)) throw blocked('End combat has no carried food to restore hunger');
    // No survival layer in the End: the game loop hands the dimension to
    // this step, so a turned enderman is answered here, with the sword,
    // under the same checks as the rest of the fight. In the rehearsal the
    // survival layer answered instead and sealed the bot in where the
    // dragon's breath pooled; that is not how the run plays it.
    const sword = bot.inventory.items().find(i => /_sword$/.test(i.name) && durable(bot.registry, i));
    // The sword on its cooldown and the shield up between swings, the way
    // the survival layer fights (combat.js defendNearby): swinging alone,
    // the recorded rehearsal traded blow for blow with an enderman through
    // iron and lost, 20 health to none in six seconds with the dragon at 26.
    const shielded = bot.inventory.slots?.[45]?.name === 'shield';
    const defendHere = async ms => {
      const until = Date.now() + ms;
      if (sword && bot.heldItem?.name !== sword.name) { await bot.equip(sword, 'hand'); check(); }
      try {
        while (Date.now() < until) {
          check();
          const target = hostileEntities(bot, 6).filter(e => live(bot, e)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
          if (!target) break;
          if (sword && canStrike(bot, target)) { if (await defendNearby(bot, task, goal, save)) { progress = true; state.defended = (state.defended || 0) + 1; } else await sleep(50); }
          // Shield up and eyes on its legs while it comes: a look at an
          // enderman's head is what turns one.
          else { if (shielded) raiseShield(bot); await bot.lookAt(target.position.offset(0, (target.height || 1.8) * .25, 0), true); await sleep(50); }
        }
      } finally { lowerShield(bot); }
    };
    // The water poured for the last enderman comes back once none is near;
    // left behind, it is lost, and the bucket goes on empty.
    if (state.water && !hostileEntities(bot, 16).some(e => live(bot, e))) {
      if (!await takeWaterBack(bot, check, state.water.at) && bot.entity.position.distanceTo(vector(state.water.at)) > 4) delete state.water;
      else if (countOf(bot, 'water_bucket')) delete state.water;
      save();
    }
    // Two or more turned, or one with the health low: the pocket two high,
    // before any water goes down (poured first, it ran into the shaft and the
    // cap sealed the bot in to drown: the rehearsal, 2026-09-24).
    // they cannot follow into (end-pocket.js), not the sword.
    const { endPocket, angryEndermen } = require('./end-pocket');
    const angry = angryEndermen(bot, 12, hostileEntities).filter(e => live(bot, e));
    if (actions.dig && (angry.length >= 2 || (angry.length && bot.health < 10)) && !(state.pocketFailedAt > Date.now() - 20000)) {
      try {
        if (await endPocket(bot, task, { dig: actions.dig, check, hostileEntities, report: a => { goal.step = a; save(); } })) { state.pockets = (state.pockets || 0) + 1; save(); return; }
      } catch (err) { if (['Cancelled', 'NeedsAir'].includes(err.name)) throw err; state.pocketFailedAt = Date.now(); save(); }
    }
    const turned = hostileEntities(bot, 12).find(e => live(bot, e) && e.name === 'enderman');
    if (turned && !state.water) {
      const at = await pourAtFeet(bot, check);
      if (at) { state.water = { at: { ...at }, poured: Date.now() }; state.pours = (state.pours || 0) + 1; goal.step = { action: 'end_water', against: 'enderman', at: { ...at } }; save(); }
    }
    const attacker = hostileEntities(bot, 6).find(e => live(bot, e));
    if (attacker && sword) {
      goal.step = { action: 'end_defend', target: attacker.name, distance: Math.round(attacker.position.distanceTo(bot.entity.position) * 10) / 10 }; save();
      await defendHere(2000); return;
    }
    const crystals = observeArena(bot, state);
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
        result.targetPosition = { ...targetPosition };
        state.shots.push(result); state.shots = state.shots.slice(-256); save();
        const until = Date.now() + Math.min(5000, Math.ceil(result.ticks * 50) + 500);
        while (Date.now() < until) { check(); if (!safeEndPoint(bot, bot.entity.position)) break; await sleep(50); }
        if (target.name === 'end_crystal' && Date.now() >= until) result.outcome = live(bot, target) ? 'target_remains' : 'unconfirmed_target_lost';
        if (target.name === 'end_crystal' && explosion && !live(bot, target)) {
          result.outcome = 'confirmed_crystal_explosion';
          const evidence = { at: Date.now(), id: target.id, position: { ...targetPosition }, source: 'explosion_and_entity_removed' };
          state.destroyedCrystals.push(evidence); bot.emit('end_combat', { crystal: evidence }); progress = true;
          Object.assign(state.knownCrystals[crystalKey(target)], { status: 'destroyed', confirmedAt: evidence.at });
        }
      } finally { bot._client.removeListener('explosion', observeExplosion); }
    };
    const bow = bot.inventory.items().some(i => i.name === 'bow' && durable(bot.registry, i));
    if (safe && bot.health >= 12 && bow && countOf(bot, 'arrow') > 0) {
      for (const target of crystals) if (!repeatedCrystalMiss(state, target, bot.entity.position) && aimAtEntity(bot, target)) tree[`crystal_${target.id}`] = {
        description: { action: 'Destroy an observed healing crystal with a clear bow trajectory, removing a source of dragon health regeneration', position: { ...target.position } }, run: () => shoot(target),
      };
      if (dragon && !perched(bot, dragon)) {
        for (let n = 0; n < 6; n++) { check(); await sleep(50); }
        let motionNow; try { motionNow = velocity(); } catch (_) { /* no feasible predicted shot */ }
        const trajectory = motionNow && aimAtEntity(bot, dragon, motionNow);
        if (trajectory) tree.shoot_dragon = {
          description: { action: 'Shoot the currently arrow-vulnerable flying dragon along the checked clear trajectory',
            safeFiringPosition: true, flightSeconds: trajectory.ticks / 20, dragonHealth: beforeDragon, observedHealingCrystals: crystals.length }, run: () => shoot(dragon),
        };
      }
    }
    const head = dragon && perchedHead(bot, dragon);
    if (safe && head && canStrike(bot, head) && bot.inventory.items().some(i => /_sword$/.test(i.name) && durable(bot.registry, i))) {
      const edge = voidEdge(bot, bot.entity.position);
      tree.strike_head = { description: `Strike the reachable head of the perched dragon with the carried sword${edge ? `: the void is ${edge} block${edge === 1 ? '' : 's'} from where the bot stands, and the dragon's wing throws a player` : ''}`, run: async () => {
        const sword = bot.inventory.items().find(i => /_sword$/.test(i.name) && durable(bot.registry, i));
        await bot.equip(sword, 'hand'); check();
        const fresh = perchedHead(bot, dragon);
        if (!fresh || !live(bot, dragon) || !safeEndPoint(bot, bot.entity.position) || !canStrike(bot, fresh)) throw new Error('Perched dragon head moved out of reach');
        bot.attack(fresh); for (let n = 0; n < 8; n++) { check(); await sleep(100); }
      } };
    }
    // A bed beside the perched head (bed-bomb.js): the heaviest blow, from a
    // trench that keeps the blast off the bot.
    const { bedPlan, bedBomb, bedsCarried } = require('./bed-bomb');
    if (safe && head && actions.dig && bedsCarried(bot) > 0 && bot.health >= 14) {
      const plan = bedPlan(bot, head.position);
      if (plan && plan.walk <= 12) tree.bed_bomb = {
        description: { action: 'Lay a bed beside the perched dragon\'s head and blow it from a trench one block deep: the heaviest blow available, about five health to the bot', bedsCarried: bedsCarried(bot), walk: Number(plan.walk.toFixed(1)) },
        run: async () => {
          const exploded = await bedBomb(bot, task, plan, { navigate: actions.navigate, dig: actions.dig, stillPerched: () => live(bot, dragon) && perched(bot, dragon) });
          (state.beds ||= []).push({ at: new Date().toISOString(), exploded, dragonHealth: metadata(bot, dragon, 'health') ?? null, health: bot.health }); save();
        } };
    }
    const unresolved = Object.values(state.knownCrystals).filter(e => e.status === 'unresolved');
    const remembered = unresolved.sort((a, b) => vector(a.position).distanceTo(bot.entity.position) - vector(b.position).distanceTo(bot.entity.position))[0];
    const focus = crystals[0] || (remembered && { name: 'unresolved_crystal_location', position: vector(remembered.position) }) ||
      head || dragon || (state.arenaCenter && vector(state.arenaCenter)) || (state.lastDragon && vector(state.lastDragon.position));
    // Reposition when arcs are blocked or the dragon is perched, and always
    // expose escape positions when healing or avoiding a breath cloud.
    if (!Object.keys(tree).some(key => key.startsWith('crystal_')) || bot.health < 16) for (const route of await arenaRoutes(bot, task, goal, policy, focus)) {
      tree[`move_${route.key}`] = { description: { action: focus?.name === 'unresolved_crystal_location'
        ? 'Approach a previously observed crystal location to check whether the crystal remains. Loss of entity tracking did not establish destruction.'
        : !safe ? 'Escape the unsafe current position along this surveyed route'
        : focus?.name === 'ender_dragon_head' ? 'Approach the perched head to get within sword reach'
        : focus?.name === 'end_crystal' ? 'Change firing position for an observed healing crystal'
        : 'Reposition along this surveyed route to gain a future attack opportunity',
        position: { ...route.p }, visits: state.visits[route.key] || 0, target: focus?.name,
        clearCrystalShot: focus?.name === 'end_crystal' ? route.clearCrystalShot : undefined,
        targetDistance: route.targetDistance, currentTargetDistance: focus?.position?.distanceTo(bot.entity.position),
        desiredHorizontalRange: route.desiredHorizontalRange,
        voidEdgeBlocks: voidEdge(bot, vector(route.p)), endermenNearRoute: endermenNearRoute(bot, bot.entity.position, vector(route.p)) }, run: async () => {
        state.visits[route.key] = (state.visits[route.key] || 0) + 1; save();
        const initiallySafe = safeEndPoint(bot, bot.entity.position);
        // A walk stops for a mob at arm's length: the recorded rehearsal
        // walked twenty blocks under an enderman's blows, 16.2 health to 1.1
        // in eight seconds, and the sword never had a turn.
        await actions.navigate(bot, task, route.destination, { timeoutMs: 18000, stallMs: 4000,
          // And the approach to a perched head ends as the sword reaches
          // it, for strike_head to be offered, not at the spot walked to.
          stopWhen: () => (initiallySafe && !safeEndPoint(bot, bot.entity.position)) || hostileEntities(bot, 4).some(e => live(bot, e)) ||
            (focus?.name === 'ender_dragon_head' && (() => { const h = live(bot, dragon) && perchedHead(bot, dragon); return !!h && canStrike(bot, h); })()) });
      } };
    }
    // A pause can reveal a vulnerable phase, but it must not indefinitely
    // displace executable actions. Renew that allowance only after actual
    // movement, damage, crystal destruction or observed health recovery.
    if (safe && dragon && ((state.idleObservations || 0) < 5 || !Object.keys(tree).length)) tree.observe = {
      description: { action: 'Wait one second without attacking or moving',
        health: bot.health, canRegenerate: bot.health < 20 && bot.food >= 18,
        usefulAttackAvailableNow: !!tree.shoot_dragon || !!tree.strike_head || crystals.some(c => tree[`crystal_${c.id}`]),
        dragonPhase: metadata(bot, dragon, 'phase'), pausesWithoutProgress: state.idleObservations || 0 }, run: async () => {
      state.idleObservations = (state.idleObservations || 0) + 1;
      bot.clearControlStates(); for (let n = 0; n < 10; n++) { check(); if (!safeEndPoint(bot, bot.entity.position)) break; await sleep(100); }
    } };
    // Unsafe only because of mobs close by (endermen turned by a glance or a
    // crystal's blast): hold with the sword out for them to come, and the
    // next step looks again. The no-progress budget still bounds it. As Blocked
    // it ended the rehearsal with the dragon at 148 of 200.
    // The dragon close with no surveyed way out holds the same way: it flies
    // on in seconds. Down in the exit portal's basin with the dragon over it,
    // the fresh-End rehearsal (2026-09-24) called that Blocked a minute in,
    // five crystals down, which in the run would end the fight.
    if (!Object.keys(tree).length && !safe) {
      state.heldForMobs = { at: Date.now(), unsafe: unsafeBecause(bot, bot.entity.position).slice(0, 6) }; save();
      goal.step = { action: 'end_hold', unsafe: state.heldForMobs.unsafe }; save();
      await defendHere(1000); return;
    }
    if (!Object.keys(tree).length) {
      state.emptyChoice = { at: Date.now(), position: { ...bot.entity.position }, safe, unsafe: safe ? [] : unsafeBecause(bot, bot.entity.position).slice(0, 6),
        crystals: crystals.length, dragon: !!dragon, bow, arrows: countOf(bot, 'arrow'), focus: focus?.name, idle: state.idleObservations || 0 };
      save();
      throw blocked(`No observed safe End route, reachable dragon head or clear bow shot; supplies and position are saved (${JSON.stringify(state.emptyChoice)})`);
    }
    const decision = await decide('dragon_fight', { client, bot, goal, tree, context: { safe }, interrupt: check, watchMs: 50,
      state: endDecisionState({ request: goal.request, health: bot.health, food: bot.food, arrows: countOf(bot, 'arrow'),
        position: { ...bot.entity.position }, safe, dragon: state.dragon,
        head: head && { position: { ...head.position }, reachable: canStrike(bot, head) }, crystals: state.observedCrystals, combat: state }),
      isFresh: () => dimension(bot) === 'end' && bot.health >= healthBefore && bot.entity.position.distanceTo(start) < 1 });
    if (decision.stale) return;
    goal.step = { action: 'end_combat', selected: decision.path, dragonHealth: beforeDragon, observedCrystals: crystals.length }; save();
    try { await decision.action.run(); }
    catch (err) {
      if (['Cancelled', 'Blocked', 'EndEmergency'].includes(err.name)) throw err;
      // Moving targets, a newly visible cloud or an obstructed route require
      // a fresh bounded choice. They do not invalidate the retained goal.
      state.lastInterrupted = { at: Date.now(), action: decision.path, reason: err.message }; save();
    }
  } catch (err) {
    if (err.name !== 'EndEmergency') throw err;
    state.lastInterrupted = { at: Date.now(), reason: err.message }; save();
    await respond();
  } finally {
    const after = dragon && metadata(bot, dragon, 'health');
    if (Number.isFinite(after) && after < beforeDragon) { state.lastDamage = { at: Date.now(), before: beforeDragon, after }; progress = true; bot.emit('end_combat', { damage: state.lastDamage }); }
    const cell = `${Math.floor(bot.entity.position.x / 4)},${Math.floor(bot.entity.position.z / 4)}`;
    state.ground ||= {};
    if (start.distanceTo(bot.entity.position) >= 3 && !state.ground[cell]) { state.ground[cell] = true; progress = true; }
    if (progress || start.distanceTo(bot.entity.position) >= 3 || bot.health > healthBefore) state.idleObservations = 0;
    state.noProgress = progress ? 0 : (state.noProgress || 0) + 1;
    state.lastActionAt = started; save();
    bot.removeListener('entityMoved', moved); task.interruptCheck = oldInterrupt;
    bot.pathfinder.setGoal(null); bot.clearControlStates(); policy.restore();
  }
}

module.exports = { voidEdge, endermenNearRoute, endFallback, metadata, perched, perchedHead, repeatedCrystalMiss, observeArena, endHazards, safeEndPoint, arenaMovement, arenaRoutes, fightEndStep };
