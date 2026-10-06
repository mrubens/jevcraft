'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { dimension } = require('./game-progress');
const { countOf, surveyRoute } = require('./skills');
const { dryStanding } = require('./mining-access');
const { safeFromHostiles, hostileEntities } = require('./danger');
const { checkAir, maintainVitals } = require('./vitals');
const { aimAtEntity, shootBow, throwAt, THROWN, THROWABLE } = require('./projectiles');
// The dragon's head through the armour worn (Normal: 10 before armour), and
// what the arena's drill of a bare kit came to under it (note 1343).
// Iron bars about a crystal: one of the two caged pillars (note 1343).
function caged(bot, crystal) {
  try { const c = crystal.position.floored(); for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) if (bot.blockAt(c.offset(dx, dy, dz))?.name === 'iron_bars') return true; } catch (_) {}
  return false;
}
// The perched dragon's breath (note 1344): sitting and flaming (phase 5)
// it lays its breath on the ground before its head, Instant Damage of 6 a
// time that armour does not lessen. The arena's drill of 2026-10-06
// (04:25Z), full iron at 20 health, walked to four blocks from it to "gain
// a future attack opportunity" and died there.
function breathSays(bot, dragon, to) {
  try {
    if (!dragon || metadata(bot, dragon, 'phase') !== 5) return {};
    const head = dragon.position; const d = Math.hypot(to.x - head.x, to.z - head.z);
    return d <= 8 ? { intoTheBreath: `ends ${Math.round(d)} blocks from the perched dragon while it breathes: its breath lies on the ground before its head, Instant Damage of 6 a time that armour does not lessen; the drill's bot in full iron at 20 health walked in there and died` } : {};
  } catch (_) { return {}; }
}
function blocksCarried(bot) {
  return bot.inventory.items().filter(i => /^(cobblestone|cobbled_deepslate|end_stone|netherrack|dirt|stone|blackstone|deepslate|andesite|diorite|granite|tuff|obsidian)$/.test(i.name)).reduce((n, i) => n + i.count, 0);
}
function headHit(bot) {
  try { const ce = require('./combat-estimate'); const a = ce.armourOf([5, 6, 7, 8].map(i => bot.inventory?.slots?.[i]?.name).filter(Boolean)); return Math.round(ce.afterArmour(10, a) * 10) / 10; } catch (_) { return 10; }
}
function drillSays(bot) {
  return [5, 6, 7, 8].some(i => bot.inventory?.slots?.[i]) ? '' : 'the arena\'s drill of 2026-10-06, nothing worn and a stone sword, ran under the perched head at 14.9 health and died there';
}
const { decide } = require('./decisions');

// The dragon_fight question lives in decisions/combat.js (no fallback:
// Jev not reachable, the bot holds, note 707).
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
      cloudRadius(bot, e) : e.name === 'ender_dragon' ? ([2, 3].includes(metadata(bot, e, 'phase')) ? 10 : 16) : 6 }));
}
// The mobs a place in the End is judged by: the dragon is not one of them
// (note 1156). Its flight, its charge and its breath are the hazards'
// own (endHazards, end-safety.js dragonThreat), and perched it is what the
// sword came for: counted as a mob within twenty blocks, it made the
// ground under its own head unsafe. The rehearsal of 2026-10-04 (02:25 to
// 02:33Z) ran under the perched head nine times: five too late, four
// "head moved out of reach" with no swing, the last "head 4.1 blocks off
// ... safe false (ender_dragon 9), strike in reach, not offered".
const endMobs = bot => hostileEntities(bot, 64).filter(e => e.name !== 'ender_dragon');
function safeEndPoint(bot, p, hazards = endHazards(bot)) {
  // Navigation allows retreat from an already close mob. A place to stand,
  // draw or heal must satisfy the full buffer, not that retreat exception.
  const mobs = endMobs(bot);
  return safeFromHostiles(bot, p, mobs) && mobs.every(e => p.distanceTo(e.position) >= 20) &&
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
  if (!safeFromHostiles(bot, p, endMobs(bot))) out.push('hostile path');
  for (const e of endMobs(bot)) if (p.distanceTo(e.position) < 20) out.push(`${e.name} ${Math.round(p.distanceTo(e.position))}`);
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

// Walled in: a block on each side of the feet and of the head, and one
// over the head. -> { of } (the wall's blocks, by name) or null.
function enclosed(bot) {
  const feet = bot.entity.position.floored(), solid = p => bot.blockAt(p)?.boundingBox === 'block';
  const round = [[1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([dx, dz]) => [feet.offset(dx, 0, dz), feet.offset(dx, 1, dz)]);
  if (!solid(feet.offset(0, 2, 0)) || !round.every(solid)) return null;
  const names = [...new Set([feet.offset(0, 2, 0), ...round].map(p => bot.blockAt(p).name.replaceAll('_', ' ')))];
  return { of: names.slice(0, 3).join(', ') };
}

// Off a height onto the island's ground beside it: the edge nearest the
// arena's centre whose landing is solid, in view, at most DROP_MOST blocks
// down and not past what the health carries (a fall takes its blocks less
// three; a water bucket carried breaks it, fall-recovery.js). Walked off
// upright, the landing waited for. -> true when the bot came down.
const DROP_MOST = 14, DROP_KEEPS = 8;
// Few arrows: a stack or less. By the fountain: this far from its middle, clear of the landing dragon's head (six and a half blocks before its body, ten health a touch), within the twenty it stays seated for, and a few steps from the head once it sits.
const FEW_ARROWS = 64, PERCH_RANGE = 16;
function dropOffs(bot, center = null) {
  const here = bot.entity.position, feet = here.floored();
  const solid = c => bot.blockAt(c)?.boundingBox === 'block';
  const water = (bot.inventory?.items?.() || []).some(i => i.name === 'water_bucket');
  const out = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let d = 1; d <= 6; d++) {
      const c = feet.offset(dx * d, 0, dz * d);
      if (solid(c) || solid(c.offset(0, 1, 0))) break;
      if (solid(c.offset(0, -1, 0))) continue;
      // The edge: the first cell with no floor. Its landing, and a clear fall to it.
      let land = null;
      for (let dy = 2; dy <= DROP_MOST + 1; dy++) { const b = bot.blockAt(c.offset(0, -dy, 0)); if (!b) break; if (b.boundingBox === 'block') { land = c.offset(0, -dy + 1, 0); break; } if (/lava|fire/.test(b.name)) break; }
      const fall = land ? feet.y - land.y : null;
      if (land && fall >= 4 && (water || (bot.health ?? 20) - (fall - 3) >= DROP_KEEPS)) {
        const toCenter = center ? Math.hypot(land.x - center.x, land.z - center.z) : 0;
        out.push({ edge: c, land, fall, toCenter });
      }
      break;
    }
  }
  return out.sort((a, b) => a.toCenter - b.toCenter || a.fall - b.fall);
}
async function leaveHighGround(bot, task, goal, save, state) {
  const { fallDanger, recoverFall } = require('./fall-recovery');
  const way = dropOffs(bot, state?.arenaCenter || { x: 0, z: 0 })[0];
  if (!way) return false;
  const startY = bot.entity.position.y;
  goal.step = { action: 'leave_high_ground', edge: { x: way.edge.x, y: way.edge.y, z: way.edge.z }, land: { x: way.land.x, y: way.land.y, z: way.land.z }, fall: way.fall }; save();
  console.log(`[end] nothing to do from this height: off its edge at (${way.edge.x}, ${way.edge.y}, ${way.edge.z}) onto the ground ${way.fall} blocks down`);
  try {
    await require('./motion').move(bot, task, { label: 'leave_high_ground', keys: ['forward'], sneak: false, why: 'off a height onto the island\'s ground in view under its edge, nothing to do from up here',
      look: way.edge.offset(0.5, 1.6, 0.5), maxMs: 3000, tick: 50, until: () => !bot.entity.onGround && bot.entity.position.y < startY - 0.5 });
  } catch (err) { task.check(); }
  for (let i = 0; i < 100 && !bot.entity.onGround; i++) {
    task.check();
    if (fallDanger(bot)) { try { await recoverFall(bot, task, goal, save); } catch (err) { task.check(); } break; }
    await sleep(50);
  }
  return bot.entity.position.y <= startY - 3;
}

async function arenaRoutes(bot, task, goal, policy, focus, { throwing = false } = {}) {
  const current = bot.entity.position, visits = goal.endCombat.visits ||= {}, buckets = new Map();
  const target = focus?.position || focus;
  // A throw reaches about 28 blocks up, and less the farther out (note 1343): close in under the pillar.
  const desiredRange = focus?.name === 'end_crystal' ? (throwing ? Math.max(4, Math.min(16, 26 - (target.y - current.y))) : Math.max(24, Math.min(56, (target.y - current.y) * 1.1))) : focus?.range || 0;
  const floorOpts = { matching: ['end_stone', 'obsidian', 'bedrock'].map(n => bot.registry.blocksByName[n].id),
    maxDistance: 64, count: 256, useExtraInfo: block => {
      const p = block.position.offset(.5, 1, .5);
      return p.distanceTo(current) >= 5 && dryStanding(bot, p) && safeEndPoint(bot, p);
    } };
  const floors = bot.findBlocks(floorOpts);
  // Throwing, the ground near the crystal too (note 1344): the 256 floor
  // cells nearest the bot lie within some nine blocks of it, and the
  // arena's drill of 2026-10-06 (03:46Z) was offered three walks all 43 to
  // 46 blocks from the crystal it was to close in on.
  if (throwing && target && focus?.name === 'end_crystal') {
    const seen = new Set(floors.map(b => `${b.x},${b.y},${b.z}`));
    let near = 0;
    try { for (const b of bot.findBlocks({ ...floorOpts, point: new Vec3(target.x, Math.min(target.y, current.y + 8), target.z), maxDistance: 24, count: 256 })) if (!seen.has(`${b.x},${b.y},${b.z}`)) { floors.push(b); near++; } } catch (err) { goal.endCombat.nearFloorError = String(err.message || err).slice(0, 120); }
    goal.endCombat.nearFloors = near;
  }
  for (const floor of floors) {
    const p = floor.offset(0, 1, 0), point = p.offset(.5, 0, .5);
    if (!policy.allowed(p)) continue;
    const key = `${Math.floor(p.x / 8)},${Math.floor(p.z / 8)}`;
    // A high caged crystal needs a shallow approach angle. Walking directly
    // underneath it makes the obsidian column obscure more of its hitbox.
    const distance = target && Math.hypot(point.x - target.x, point.z - target.z);
    // The wait by the fountain is at its ring, however often it was stood on: the visits count against a cell only where new ground is what is wanted.
    const score = (focus?.name === 'fountain' ? 0 : (visits[key] || 0) * 30) + (target ? Math.abs(distance - desiredRange) : -point.distanceTo(current)) + Math.abs(point.y - current.y);
    if (!buckets.has(key) || score < buckets.get(key).score) buckets.set(key, { p, key, score });
  }
  const routes = [], look = goal.endCombat.routeLook = { floors: floors.length, allowed: buckets.size, tried: 0, failed: {}, best: [...buckets.values()].sort((a, b) => a.score - b.score).slice(0, 3).map(c => [c.key, Math.round(c.score)]) };
  for (const candidate of [...buckets.values()].sort((a, b) => a.score - b.score).slice(0, 10)) {
    task.check();
    const p = candidate.p, destination = new goals.GoalBlock(p.x, p.y, p.z);
    // A second: from the island's edge the ground climbs nine blocks to the
    // pillars, and every quarter-second survey timed out, so the rehearsal
    // bot stood at the edge with nothing to choose.
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 1000);
    look.tried++; if (route.status !== 'success') look.failed[route.status] = (look.failed[route.status] || 0) + 1; else if (!route.path.every(policy.allowed)) look.failed.notAllowed = (look.failed.notAllowed || 0) + 1;
    if (route.status === 'success' && route.path.every(policy.allowed)) routes.push({ ...candidate, destination,
      clearCrystalShot: focus?.name === 'end_crystal' && !repeatedCrystalMiss(goal.endCombat, focus, p.offset(.5, 0, .5)) &&
        !!aimAtEntity(bot, focus, new Vec3(0, 0, 0), p.offset(.5, 0, .5), throwing ? THROWN : undefined),
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
  // In the End the fight is the answer to what hurts the bot: it owns every
  // tick, the survival layer has none there, and the hurt watchdog's stop
  // (survival.js: "hit with no survival response") is lifted only by the
  // survival layer's own step, or ten seconds on (note 1133). The rehearsal
  // of 2026-10-03 (23:11 to 23:22Z) had 714 of its 841 steps end at the
  // first check, "Threat nearby: something unseen at 0 blocks", each hurt
  // by the dragon stopping the fight ten seconds; it spent its budget with
  // three crystals down and 371 arrows carried.
  if (dimension(bot) === 'end') { bot._threatAbort = false; bot._threatResponseAt = Date.now(); }
  check();
  if (goal.gameProgress?.milestones.dragon_defeated) return;
  const state = goal.endCombat ||= { steps: 0, shots: [], destroyedCrystals: [], visits: {}, noProgress: 0 };
  // The budget is the bot's own choices that came to nothing, eighty in a
  // row, and it is spent once: thrown, it starts over, since the fight is
  // still there when the game comes back to it (note 1136).
  if (++state.steps > 6000 || state.noProgress >= 80) { state.steps = 0; state.noProgress = 0; save(); throw blocked('End combat exhausted its bounded action budget without verified damage, a crystal explosion or new ground'); }
  observeArena(bot, state);
  const policy = arenaMovement(bot, state.arenaCenter), oldInterrupt = task.interruptCheck;
  const started = Date.now(), start = bot.entity.position.clone(), healthBefore = bot.health;
  const dragons = Object.values(bot.entities).filter(e => live(bot, e) && e.name === 'ender_dragon');
  if (dragons.length > 1) { policy.restore(); throw blocked('More than one observed dragon; target is ambiguous'); }
  const dragon = dragons[0], beforeDragon = dragon && metadata(bot, dragon, 'health');
  let progress = false, chose = false;
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
    else {
      // Out of the dragon's way by ground no mob stands near, and where
      // there is none, by any ground (note 1174): an enderman's blow is
      // seven, the dragon's head ten and again each second it is stood in.
      // The rehearsal of 2026-10-04 (04:44 to 04:48Z), turned endermen
      // seven to twenty blocks off, found "no surveyed walking escape"
      // twenty-six times and stood by the fountain as the dragon came down
      // on it, 20 health to none in four touches.
      try { await evadeDragon(bot, task, goal, save, { allowed: p => policy.allowedPoint(p) && safeFromHostiles(bot, p, endMobs(bot)) }); }
      catch (err) {
        if (err.name !== 'NoEscape') throw err;
        await evadeDragon(bot, task, goal, save, { allowed: p => policy.allowedPoint(p) });
      }
    }
  };
  // Standing in the water poured at its feet, a turned enderman is no
  // reason to hold: water hurts one and it teleports off rather than cross
  // it, as a player stands in a bucket's water and shoots on. The place is
  // then judged by everything else about (the dragon, its breath, a
  // crystal, any other mob). The rehearsal of 2026-10-03 (23:48 to 23:51Z)
  // stood in its water with three turned endermen seven to thirteen blocks
  // off, "observe, the only way offered", the dragon circling at 166.5 of
  // 200 and 187 arrows carried: no shot, no route and no strike while one
  // of them stayed within twenty (note 1136).
  const inWater = () => { const feet = bot.entity.position.floored(); return bot.blockAt(feet)?.name === 'water' && bot.blockAt(feet.offset(0, -1, 0))?.boundingBox === 'block' && bot.blockAt(feet.offset(0, 1, 0))?.name !== 'water'; };
  const safeHere = () => {
    const p = bot.entity.position;
    if (safeEndPoint(bot, p)) return true;
    if (!inWater()) return false;
    const others = endMobs(bot).filter(e => e.name !== 'enderman');
    return safeFromHostiles(bot, p, others) && others.every(e => p.distanceTo(e.position) >= 20) && endHazards(bot).every(({ entity, radius }) => hazardDistance(p, entity) > radius);
  };
  try {
    if (endEmergency(bot)) { await respond(); return; }
    task.interruptCheck = () => {
      oldInterrupt?.();
      if (dimension(bot) !== 'end' || bot.health <= 0) throw blocked('End combat interrupted by dimension change or death');
      checkEndEmergency(bot);
    };
    if (safeHere()) {
      if (await maintainVitals(bot, task, action => { goal.survivalAction = { ...action, at: new Date().toISOString() }; save(); }, { client, goal, save })) return;
    }
    // Hungry with nothing to eat, the fight goes on (note 1381): under
    // eighteen health does not come back, which every question says, and
    // standing still in the End brings no food. This stopped the fight at
    // every step under hunger 16: the arena's drill of 2026-10-06 19:27Z
    // (full iron, a bow, 16 arrows, 48 snowballs, no food, hunger 15) stood
    // on the island with "End combat has no carried food to restore hunger"
    // at each step, and the End's kit lets a bot go with no food at all.
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
    if (actions.dig && !inWater() && (angry.length >= 2 || (angry.length && bot.health < 10)) && !(state.pocketFailedAt > Date.now() - 20000)) {
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
    if (attacker && sword && !(inWater() && attacker.name === 'enderman' && !canStrike(bot, attacker))) {
      goal.step = { action: 'end_defend', target: attacker.name, distance: Math.round(attacker.position.distanceTo(bot.entity.position) * 10) / 10 }; save();
      await defendHere(2000); return;
    }
    const crystals = observeArena(bot, state);
    state.observedCrystals = crystals.map(e => ({ id: e.id, position: { ...e.position } }));
    state.dragon = dragon && { id: dragon.id, position: { ...dragon.position }, health: beforeDragon, phase: metadata(bot, dragon, 'phase') };
    const tree = {}, safe = safeHere(), wet = safe && !safeEndPoint(bot, bot.entity.position);
    const guardShot = () => { check(); if (!safeHere() || bot.health < 12) throw new Error('End firing position became unsafe'); };
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
        }, velocity: target === dragon ? velocity : new Vec3(0, 0, 0), ...(target === dragon ? { holdMs: 4000 } : {}),
          // From its water the endermen about are not what stops the shot; any other mob within six is.
          ...(inWater() ? { standing: () => true, threatCheck: b => { const near = hostileEntities(b, 6).find(e => live(b, e) && e.name !== 'enderman'); if (near) throw new Error(`A ${near.name} came within six blocks`); } } : {}) });
        result.targetPosition = { ...targetPosition };
        state.shots.push(result); state.shots = state.shots.slice(-256); save();
        const until = Date.now() + Math.min(5000, Math.ceil(result.ticks * 50) + 500);
        while (Date.now() < until) { check(); if (!safeHere()) break; await sleep(50); }
        if (target.name === 'end_crystal' && Date.now() >= until) result.outcome = live(bot, target) ? 'target_remains' : 'unconfirmed_target_lost';
        if (target.name === 'end_crystal' && explosion && !live(bot, target)) {
          result.outcome = 'confirmed_crystal_explosion';
          const evidence = { at: Date.now(), id: target.id, position: { ...targetPosition }, source: 'explosion_and_entity_removed' };
          state.destroyedCrystals.push(evidence); bot.emit('end_combat', { crystal: evidence }); progress = true;
          Object.assign(state.knownCrystals[crystalKey(target)], { status: 'destroyed', confirmedAt: evidence.at });
        }
      } finally { bot._client.removeListener('explosion', observeExplosion); }
    };
    // From the top of a pillar chosen for it (pillar_throw) the footing is a
    // block wide and not a safe place by the End's rule: the throw goes on
    // there, the fall said where it was chosen (note 1344).
    const throwCrystal = async (target, { fromPillar = false } = {}) => {
      check();
      let explosion = false;
      const targetPosition = target.position.clone();
      const observeExplosion = packet => { if (vector(packet.center).distanceTo(targetPosition) < 3) explosion = true; };
      bot._client.on('explosion', observeExplosion);
      try {
        const result = await throwAt(bot, task, target, { guard: () => { check(); if (!fromPillar && !safeHere()) throw new Error('End throwing position became unsafe'); } });
        result.targetPosition = { ...targetPosition };
        state.shots.push(result); state.shots = state.shots.slice(-256); save();
        const until = Date.now() + Math.min(5000, Math.ceil(result.ticks * 50) + 500);
        while (Date.now() < until && !explosion) { check(); await sleep(50); }
        console.log(`[end combat] throw at crystal ${target.id}: ${explosion ? 'it blew' : 'it stands'}`);
        result.outcome = explosion && !live(bot, target) ? 'confirmed_crystal_explosion' : live(bot, target) ? 'target_remains' : 'unconfirmed_target_lost';
        if (result.outcome === 'confirmed_crystal_explosion') {
          const evidence = { at: Date.now(), id: target.id, position: { ...targetPosition }, source: 'explosion_and_entity_removed', by: result.item };
          state.destroyedCrystals.push(evidence); bot.emit('end_combat', { crystal: evidence }); progress = true;
          if (state.knownCrystals?.[crystalKey(target)]) Object.assign(state.knownCrystals[crystalKey(target)], { status: 'destroyed', confirmedAt: evidence.at });
        }
      } finally { bot._client.removeListener('explosion', observeExplosion); }
    };
    const wetSays = () => { const turned = hostileEntities(bot, 64).filter(e => live(bot, e) && e.name === 'enderman' && e.position.distanceTo(bot.entity.position) < 20).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
      return `The bot stands in the water it poured at its feet, ${turned.length} turned enderm${turned.length === 1 ? 'an' : 'en'} within twenty blocks, the nearest ${Math.round(turned[0]?.position.distanceTo(bot.entity.position) ?? 0)} off: water hurts an enderman and it teleports off rather than cross it, and the shot is drawn standing in it.`; };
    // The sword at the perched head, swing after swing at its pace, while
    // the dragon sits, the head is in reach and the place is safe.
    const strikeSafeNow = () => !endMobs(bot).some(e => live(bot, e) && e.position.distanceTo(bot.entity.position) < 8) && endHazards(bot).every(({ entity, radius }) => hazardDistance(bot.entity.position, entity) > radius);
    const strikeWhilePerched = async ms => {
      const sword = bot.inventory.items().find(i => /_sword$/.test(i.name) && durable(bot.registry, i));
      if (!sword) throw new Error('No sword carried for the perched head');
      await bot.equip(sword, 'hand'); check();
      const until = Date.now() + ms; let swings = 0;
      try {
        while (Date.now() < until) {
          check(); checkEndEmergency(bot);
          const fresh = live(bot, dragon) && perchedHead(bot, dragon);
          if (!fresh || !(safeHere() || strikeSafeNow()) || !canStrike(bot, fresh)) break;
          if (typeof bot.lookAt === 'function') await bot.lookAt(fresh.position.offset(0, .5, 0), true);
          bot.attack(fresh); swings++;
          for (let n = 0; n < 7; n++) { check(); await sleep(100); }
        }
      } finally { state.headSwings = (state.headSwings || 0) + swings; save(); }
      if (!swings) throw new Error('Perched dragon head moved out of reach');
    };
    const bow = bot.inventory.items().some(i => i.name === 'bow' && durable(bot.registry, i));
    let noShot = !safe ? `not safe here (${unsafeBecause(bot, bot.entity.position).slice(0, 3).join(', ')})` : bot.health < 12 ? 'health under twelve' : !bow || !countOf(bot, 'arrow') ? 'no bow or arrows' : !dragon ? 'no dragon in view' : perched(bot, dragon) ? 'perched' : null;
    // A snowball or an egg breaks a crystal as an arrow does (note 1342):
    // thrown at 1.5 with more drop, it reaches about 28 blocks up. Offered
    // where no arrow is: 25593 (2026-10-06 01:49Z) chose the End with one
    // arrow and three eggs, and the arena's drill of that kit (01:53 to
    // 01:58Z) loosed its one arrow, took no crystal and only watched after.
    const throwable = THROWABLE.find(n => countOf(bot, n) > 0);
    // Snowballs or eggs carried are shots at the crystals too (note 1343).
    const throwing = !(bow && countOf(bot, 'arrow') > 0) && !!throwable;
    if (safe && throwing) {
      const left = THROWABLE.reduce((n, k) => n + countOf(bot, k), 0);
      for (const target of crystals) if (!repeatedCrystalMiss(state, target, bot.entity.position) && aimAtEntity(bot, target, new Vec3(0, 0, 0), bot.entity.position, THROWN)) tree[`throw_${target.id}`] = {
        description: { action: `Throw a ${throwable.replaceAll('_', ' ')} at an observed healing crystal along a clear line: any projectile breaks one, removing a source of the dragon's healing`, position: { ...target.position }, thrownLeft: left, crystalsInView: crystals.length }, run: () => throwCrystal(target),
      };
    }
    // Too high to throw at from the ground (a throw reaches about 28 blocks
    // up, less the farther out): up a pillar of the blocks carried until it
    // is within about 22, then thrown at from its top (note 1343). The
    // arena's drill of 2026-10-06 (02:29 to 02:45Z), full iron and 48
    // snowballs, took none of the seven crystals left on the taller pillars
    // from the ground. A knock off the top is the fall.
    if (safe && throwing && actions.dig && !Object.keys(tree).some(k => k.startsWith('throw_'))) {
      const here = bot.entity.position, carried = blocksCarried(bot);
      for (const target of crystals.filter(c => !caged(bot, c))) {
        const out = Math.hypot(target.position.x - here.x, target.position.z - here.z), up = target.position.y - here.y;
        // The least lift with a clear throw from its top (note 1344): the
        // drill of 2026-10-06 (04:06Z) went up 16 beside the pillar, 5 out,
        // and the line to the crystal 22 over it ran into the pillar's side.
        if (out > 16 || up <= 22) continue;
        let lift = 0;
        for (let l = Math.max(1, Math.ceil(up - 26)); l <= Math.min(carried, Math.ceil(up) + 1); l++) if (aimAtEntity(bot, target, new Vec3(0, 0, 0), here.offset(0, l, 0), THROWN)) { lift = l; break; }
        if (!lift) continue;
        tree[`pillar_throw_${target.id}`] = {
          description: { action: `Pillar up ${lift} blocks here on the blocks carried and throw at the healing crystal from the top, where a throw's line to it is clear: it is ${Math.round(up)} blocks up and ${Math.round(out)} out, out of a throw from the ground`,
            position: { ...target.position }, blocks: lift, blocksCarried: carried, fallFromTheTop: `a knock off the top is a fall of ${lift} blocks, about ${Math.max(0, lift - 3)} damage before armour${countOf(bot, 'water_bucket') ? ', a water bucket carried for the landing' : ''}`,
            thrownLeft: THROWABLE.reduce((n, k) => n + countOf(bot, k), 0), health: bot.health },
          run: async () => {
            const from = bot.entity.position.y;
            await require('./pillar-recovery').pillarUp(bot, task, Math.floor(bot.entity.position.y) + lift, { dig: actions.dig, maxBlocks: lift, threats: false });
            for (let n = 0; n < 3 && live(bot, target); n++) {
              check();
              const line = aimAtEntity(bot, target, new Vec3(0, 0, 0), bot.entity.position, THROWN);
              if (n === 0) console.log(`[end combat] pillar throw: up ${Math.round(bot.entity.position.y - from)} of ${lift}, the crystal ${Math.round(target.position.y - bot.entity.position.y)} up and ${Math.round(Math.hypot(target.position.x - bot.entity.position.x, target.position.z - bot.entity.position.z))} out, ${line ? 'a line' : 'no line'}`);
              if (!line) break;
              try { await throwCrystal(target, { fromPillar: true }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] pillar throw failed: ${String(err.message || err).slice(0, 160)}`); break; }
            }
          } };
      }
    }
    // A caged crystal (note 1350): up a pillar beside its pillar to its
    // height, the iron bars on the line to it dug out with the pickaxe, and a
    // throw through the gap. The arena's drill of 2026-10-06 (05:24 to
    // 05:49Z), full iron and 48 snowballs, took the four the arrows could
    // reach and then stood twenty minutes with the two caged crystals
    // healing the dragon, none good answered 347 times.
    const pick = bot.inventory.items().find(i => /_pickaxe$/.test(i.name) && !/wooden|golden/.test(i.name));
    if (safe && throwing && actions.dig && pick) {
      const here = bot.entity.position, carried = blocksCarried(bot);
      for (const target of crystals.filter(c => caged(bot, c))) {
        const out = Math.hypot(target.position.x - here.x, target.position.z - here.z), up = target.position.y - here.y;
        const lift = Math.max(0, Math.ceil(target.position.y + 0.5 - (here.y + 1.62)));
        if (out > 7 || up < -2 || lift > Math.min(carried, 40)) continue;
        tree[`open_cage_${target.id}`] = {
          description: { action: `Pillar up ${lift} blocks beside the caged crystal's pillar, dig out the iron bars between the bot and the crystal with the ${pick.name.replaceAll('_', ' ')}, and throw at it through the gap: iron bars stop a throw, so a caged crystal is reached only so`,
            position: { ...target.position }, blocks: lift, blocksCarried: carried, out: Math.round(out),
            fallFromTheTop: `a knock off the top is a fall of ${lift} blocks, about ${Math.max(0, lift - 3)} damage before armour${countOf(bot, 'water_bucket') ? ', a water bucket carried for the landing' : ''}`,
            crystalBlast: 'the crystal bursts when it breaks, close beside the bot at its height: the arena\'s drill of 2026-10-06 (05:46Z, full iron) took 11.8 from it there, and died on the pillar\'s top twenty-four seconds later, 6 a second, the dragon 70 to 90 blocks off; it took the caged crystal', thrownLeft: THROWABLE.reduce((n, k) => n + countOf(bot, k), 0), health: bot.health },
          run: async () => {
            if (lift) await require('./pillar-recovery').pillarUp(bot, task, Math.floor(bot.entity.position.y) + lift, { dig: actions.dig, maxBlocks: lift, threats: false });
            const eye = bot.entity.position.offset(0, 1.62, 0), mid = target.position.offset(0, 1, 0), dir = mid.minus(eye), len = dir.norm();
            const bars = [];
            for (let t = 0; t <= len; t += 0.2) { const c = eye.plus(dir.scaled(t / len)).floored(); if (bot.blockAt(c)?.name === 'iron_bars' && !bars.some(b => b.equals(c))) bars.push(c); }
            console.log(`[end combat] open cage: up ${lift}, ${bars.length} bar${bars.length === 1 ? '' : 's'} on the line`);
            for (const c of bars.slice(0, 4)) { check(); if (eye.distanceTo(c.offset(0.5, 0.5, 0.5)) > 4.8) break; await actions.dig(bot, task, c); }
            for (let n = 0; n < 3 && live(bot, target); n++) {
              check();
              if (!aimAtEntity(bot, target, new Vec3(0, 0, 0), bot.entity.position, THROWN)) { console.log('[end combat] open cage: no line yet'); break; }
              try { await throwCrystal(target, { fromPillar: true }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] open cage throw failed: ${String(err.message || err).slice(0, 160)}`); break; }
            }
          } };
      }
    }
    if (safe && bot.health >= 12 && bow && countOf(bot, 'arrow') > 0) {
      for (const target of crystals) if (!repeatedCrystalMiss(state, target, bot.entity.position) && aimAtEntity(bot, target)) tree[`crystal_${target.id}`] = {
        description: { action: 'Destroy an observed healing crystal with a clear bow trajectory, removing a source of dragon health regeneration', position: { ...target.position }, arrowsLeft: countOf(bot, 'arrow'), crystalsInView: crystals.length }, run: () => shoot(target),
      };
      if (dragon && !perched(bot, dragon)) {
        for (let n = 0; n < 6; n++) { check(); await sleep(50); }
        let motionNow; try { motionNow = velocity(); } catch (err) { noShot = err.message; /* no feasible predicted shot */ }
        const trajectory = motionNow && aimAtEntity(bot, dragon, motionNow);
        if (motionNow && !trajectory) noShot = `no clear arrow trajectory to it ${Math.round(dragon.position.distanceTo(bot.entity.position))} blocks off`;
        if (trajectory) tree.shoot_dragon = {
          description: { action: 'Shoot the currently arrow-vulnerable flying dragon along the checked clear trajectory',
            safeFiringPosition: true, flightSeconds: trajectory.ticks / 20, dragonHealth: beforeDragon, observedHealingCrystals: crystals.length, arrowsLeft: countOf(bot, 'arrow'),
            // The arrows against the crystals (note 1172): one loosed at the dragon is one fewer for a crystal, and a crystal standing heals back what the arrow took.
            ...(crystals.length ? { crystalsHealIt: `${crystals.length} healing crystal${crystals.length === 1 ? '' : 's'} in view still stand${crystals.length === 1 ? 's' : ''}: each heals the dragon while it flies near, only an arrow reaches one on its pillar, and ${countOf(bot, 'arrow')} arrow${countOf(bot, 'arrow') === 1 ? ' is' : 's are'} left` } : {}), ...(wet ? { fromItsWater: wetSays() } : {}) }, run: () => shoot(dragon),
        };
      }
    }
    const head = dragon && perchedHead(bot, dragon);
    // For the sword at the perched head the place is judged by what is at
    // hand (note 1159): no mob within eight blocks, no breath or crystal
    // over it. The twenty blocks kept from a turned enderman are for a bow
    // drawn standing still; the rehearsal of 2026-10-04 (02:48:30Z) stood
    // under the head, "strike in reach, not offered", for an enderman
    // twenty blocks off.
    const strikeSafe = () => !endMobs(bot).some(e => live(bot, e) && e.position.distanceTo(bot.entity.position) < 8) &&
      endHazards(bot).every(({ entity, radius }) => hazardDistance(bot.entity.position, entity) > radius);
    const atHand = safe || strikeSafe();
    if (atHand && head && canStrike(bot, head) && bot.inventory.items().some(i => /_sword$/.test(i.name) && durable(bot.registry, i))) {
      const edge = voidEdge(bot, bot.entity.position);
      tree.strike_head = { description: `Strike the reachable head of the perched dragon with the carried sword, and keep striking for as long as it sits and the place stays safe, up to ten seconds${edge ? `: the void is ${edge} block${edge === 1 ? '' : 's'} from where the bot stands, and the dragon's wing throws a player` : ''}`, run: () => strikeWhilePerched(10000) };
    }
    // The perched head out of reach: straight to the ground under it and the
    // sword there for as long as it sits (note 1155). Three routes surveyed
    // a second each and one swing a question were the perch gone: the
    // rehearsal of 2026-10-04 (02:12 to 02:15Z), waiting by the fountain,
    // was 8 to 20 blocks from the head at each of six perches and never
    // under it.
    const swordCarried = bot.inventory.items().some(i => /_sword$/.test(i.name) && durable(bot.registry, i));
    if (atHand && head && !canStrike(bot, head) && swordCarried && head.position.distanceTo(bot.entity.position) <= 40) {
      let ground = null;
      for (let y = Math.floor(head.position.y); y >= Math.floor(head.position.y) - 8 && !ground; y--) {
        const p = new Vec3(Math.floor(head.position.x) + .5, y, Math.floor(head.position.z) + .5);
        if (dryStanding(bot, p)) ground = p;
      }
      // Within the sword's reach from the ground, or from two blocks laid under the feet.
      if (ground && head.position.y - ground.y <= (actions.dig ? 6.4 : 4.5)) tree.under_head = {
        description: { action: 'Run to the ground under the perched dragon\'s head and strike it with the sword for as long as it sits: the sword reaches the dragon only here, its breath pools on the ground before its head, and it takes off within seconds',
          headBlocksOff: Math.round(head.position.distanceTo(bot.entity.position)), headBlocksOverItsGround: Math.round((head.position.y - ground.y) * 10) / 10, dragonHealth: beforeDragon, health: bot.health,
          voidEdgeBlocks: voidEdge(bot, ground), endermenNearRoute: endermenNearRoute(bot, bot.entity.position, ground), headHitThroughArmourWorn: headHit(bot),
          ...(drillSays(bot) ? { drill: drillSays(bot) } : {}) },
        run: async () => {
          const reached = () => { const h = live(bot, dragon) && perchedHead(bot, dragon); return !h || canStrike(bot, h); };
          try { await actions.navigate(bot, task, new goals.GoalNear(Math.floor(ground.x), ground.y, Math.floor(ground.z), 1), { timeoutMs: 9000, stallMs: 2500, sprint: true, stopWhen: () => reached() || hostileEntities(bot, 4).some(e => live(bot, e)) }); }
          catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency'].includes(err.name)) throw err; }
          let h = live(bot, dragon) && perchedHead(bot, dragon);
          if (!h) throw new Error('The dragon took off before the bot was under its head');
          // Under it and a block or two short of it: up on blocks laid under
          // the feet (note 1176). The head sits three to four blocks over
          // the ground by the fountain, and the sword reaches three from the
          // eyes. The rehearsals of 2026-10-04 (02:25 to 04:48Z) ended eight
          // runs under the head "out of the sword's reach".
          if (!canStrike(bot, h)) {
            const lift = Math.ceil(h.position.y - (bot.entity.position.y + 1.62) - 2.4);
            if (lift >= 1 && lift <= 2 && actions.dig) {
              try { await require('./pillar-recovery').pillarUp(bot, task, Math.floor(bot.entity.position.y) + lift, { dig: actions.dig, maxBlocks: lift, threats: false }); }
              catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency'].includes(err.name)) throw err; }
              h = live(bot, dragon) && perchedHead(bot, dragon);
              if (!h) throw new Error('The dragon took off before the bot was under its head');
            }
          }
          if (!canStrike(bot, h)) throw new Error('Under the perched head, and it is out of the sword\'s reach');
          await strikeWhilePerched(10000);
        } };
    }
    // A bed beside the perched head (bed-bomb.js): the heaviest blow, from a
    // trench that keeps the blast off the bot.
    const { bedPlans, bedBomb, bedsCarried } = require('./bed-bomb');
    if (safe && head && actions.dig && bedsCarried(bot) > 0 && bot.health >= 14) {
      // The line it can walk to, surveyed as a move is: the rehearsal of
      // 2026-10-03 (23:54:40 to 23:55:24Z) chose the bed 55 times in 44
      // seconds at a line with no route from where it stood ("No route from
      // here", each within a second), the dragon perched the while, and
      // spent the fight's budget on it (note 1136).
      let plan = null;
      for (const p of bedPlans(bot, head.position).filter(p => p.walk <= 12).slice(0, 4)) {
        check();
        const here = bot.entity.position.floored();
        if (here.x === p.stand.x && here.y === p.stand.y && here.z === p.stand.z) { plan = p; break; }
        const route = await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalBlock(p.stand.x, p.stand.y, p.stand.z), 400);
        if (route.status === 'success') { plan = p; break; }
      }
      if (plan) tree.bed_bomb = {
        description: { action: 'Lay a bed beside the perched dragon\'s head and blow it from a trench one block deep: the heaviest blow available, about five health to the bot', bedsCarried: bedsCarried(bot), walk: Number(plan.walk.toFixed(1)) },
        run: async () => {
          const exploded = await bedBomb(bot, task, plan, { navigate: actions.navigate, dig: actions.dig, stillPerched: () => live(bot, dragon) && perched(bot, dragon) });
          (state.beds ||= []).push({ at: new Date().toISOString(), exploded, dragonHealth: metadata(bot, dragon, 'health') ?? null, health: bot.health }); save();
        } };
    }
    const unresolved = Object.values(state.knownCrystals).filter(e => e.status === 'unresolved');
    const remembered = unresolved.sort((a, b) => vector(a.position).distanceTo(bot.entity.position) - vector(b.position).distanceTo(bot.entity.position))[0];
    // With every crystal down and few arrows left, the place to be while the
    // dragon flies is by the fountain it perches on: the sword reaches its
    // head only there, and at its perch arrows do nothing (note 1155). The
    // rehearsal of 2026-10-04 (02:00 to 02:09Z, 48 arrows) stood 34 to 46
    // blocks from the head at four of its five perches, at the bow's range
    // from the dragon in flight, and the strike was never in reach.
    const centre = state.arenaCenter ? vector(state.arenaCenter) : new Vec3(0, bot.entity.position.y, 0);
    const arrowsLeft = countOf(bot, 'arrow');
    const byFountain = Math.hypot(bot.entity.position.x - centre.x, bot.entity.position.z - centre.z);
    // And with no arrow left at all, crystals standing or not (note 1169):
    // a crystal is out of the sword's reach on its pillar, and a new place
    // to shoot one from is no use with nothing to shoot. The sword at the
    // perch is what is left, said with the crystals that still heal it.
    const noArrows = arrowsLeft === 0 && !throwing;
    const standing = crystals.length + (remembered ? unresolved.length : 0);
    const fountain = ((!crystals.length && !remembered) || noArrows) && dragon && !head && arrowsLeft <= FEW_ARROWS
      ? { name: 'fountain', position: new Vec3(centre.x, bot.entity.position.y, centre.z), range: PERCH_RANGE, arrows: arrowsLeft, crystals: standing } : null;
    // Throwing, a caged crystal is not the one gone for: its bars stop a throw (note 1343).
    const focus = (noArrows ? null : (throwing ? (crystals.find(c => !caged(bot, c)) || (pick && crystals.find(c => caged(bot, c)))) : crystals[0]) || (remembered && { name: 'unresolved_crystal_location', position: vector(remembered.position) })) ||
      head || fountain || dragon || (state.arenaCenter && vector(state.arenaCenter)) || (state.lastDragon && vector(state.lastDragon.position));
    // Reposition when arcs are blocked or the dragon is perched, and always
    // expose escape positions when healing or avoiding a breath cloud.
    // By the fountain already, the wait is there: no walk to another cell of its ring.
    const waitingThere = focus === fountain && fountain && Math.abs(byFountain - PERCH_RANGE) <= 3 && safe;
    if ((!Object.keys(tree).some(key => key.startsWith('crystal_') || key.startsWith('throw_')) || bot.health < 16) && !waitingThere && !(tree.under_head || tree.strike_head)) for (const route of await arenaRoutes(bot, task, goal, policy, focus, { throwing })) {
      tree[`move_${route.key}`] = { description: { action: focus?.name === 'unresolved_crystal_location'
        ? 'Approach a previously observed crystal location to check whether the crystal remains. Loss of entity tracking did not establish destruction.'
        : !safe ? 'Escape the unsafe current position along this surveyed route'
        : focus?.name === 'ender_dragon_head' ? 'Approach the perched head to get within sword reach'
        : focus?.name === 'fountain' ? `Go to stand about ${PERCH_RANGE} blocks from the fountain the dragon perches on, and wait there for the sword at its head when it lands: ${focus.arrows} arrow${focus.arrows === 1 ? ' is' : 's are'} left, the sword reaches the dragon only at its perch, and at its perch arrows do nothing to it${focus.crystals ? `; ${focus.crystals} healing crystal${focus.crystals === 1 ? ' still stands' : 's still stand'} on ${focus.crystals === 1 ? 'its pillar' : 'their pillars'}, out of the sword's reach, and ${focus.crystals === 1 ? 'heals' : 'heal'} the dragon while it flies near` : ''}`
        : focus?.name === 'end_crystal' ? (throwing ? 'Go closer under an observed healing crystal, within a throw of it' : 'Change firing position for an observed healing crystal')
        : 'Reposition along this surveyed route to gain a future attack opportunity',
        position: { ...route.p }, visits: state.visits[route.key] || 0, target: focus?.name,
        clearCrystalShot: focus?.name === 'end_crystal' ? route.clearCrystalShot : undefined,
        targetDistance: route.targetDistance, currentTargetDistance: focus?.position?.distanceTo(bot.entity.position),
        desiredHorizontalRange: route.desiredHorizontalRange,
        voidEdgeBlocks: voidEdge(bot, vector(route.p)), endermenNearRoute: endermenNearRoute(bot, bot.entity.position, vector(route.p)), ...breathSays(bot, dragon, vector(route.p)) }, run: async () => {
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
    // Walled in (blocks on every side of the body and over the head, a
    // pocket or a seal of its own from before): no arrow leaves it and no
    // walk, and the fight has only the wait. The way out is offered: the
    // block over the head and the wall toward the arena dug. The rehearsals
    // of 2026-10-03 (23:48Z to 00:10Z) stood in the three-by-three of
    // cobblestone walled at 23:35Z, "observe, the only way offered", every
    // route "noPath" and "no clear arrow trajectory" to a dragon 19 to 37
    // blocks off with no mob near, 187 arrows carried (note 1136).
    const box = actions.dig && enclosed(bot);
    if (box && !tree.shoot_dragon && !Object.keys(tree).some(k => /^(crystal_|move_|strike_head|bed_bomb)/.test(k))) {
      const toward = (focus === fountain ? dragon : focus)?.position || focus || (state.arenaCenter && vector(state.arenaCenter)) || bot.entity.position.offset(1, 0, 0);
      const feet = bot.entity.position.floored(), dx = toward.x - (feet.x + .5), dz = toward.z - (feet.z + .5);
      const side = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
      const cells = [feet.offset(0, 2, 0), feet.plus(side).offset(0, 1, 0), feet.plus(side)].filter(c => bot.blockAt(c)?.boundingBox === 'block');
      tree.open_walls = { description: { action: `The bot stands walled in, blocks on every side of it and over its head (${box.of}): no arrow leaves it and no walk. Open it: dig the block over the head and the wall toward the arena, ${cells.length} block${cells.length === 1 ? '' : 's'}, and the fight goes on from the opening`,
        health: bot.health, turnedEndermenWithinTwenty: hostileEntities(bot, 20).filter(e => live(bot, e) && e.name === 'enderman').length, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null },
        run: async () => {
          for (const c of cells) { check(); await actions.dig(bot, task, c, { requireDrops: false }); }
          state.opened = (state.opened || 0) + 1; progress = true; save();
        } };
    }
    // No walk off the footing and the void beside it (the entry platform,
    // where it stands apart from the island): a span of the blocks carried
    // toward the island is offered, laid crouched a stretch at a time
    // (bridging.js, note 1154). The rehearsal of 2026-10-04 (01:48:20 to
    // 01:49:18Z), its platform 29 blocks from the island, had "observe" and
    // a shot at the dragon as its ways, every route "noPath", and stood
    // there until the dragon's wing threw it off into the void.
    if (!Object.keys(tree).some(k => k.startsWith('move_')) && !box && !inWater()) {
      const { deepBeside } = require('./end-safety');
      const bridging = require('./bridging');
      const here = bot.entity.position, near = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => deepBeside(bot, here.offset(dx, 0, dz)));
      const blocks = (() => { try { return bot.inventory.items().filter(i => ['cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'netherrack', 'andesite', 'diorite', 'granite', 'blackstone', 'basalt'].includes(i.name)).reduce((n, i) => n + i.count, 0); } catch (_) { return 0; } })();
      const centre = state.arenaCenter ? vector(state.arenaCenter) : new Vec3(0, here.y, 0);
      const stone = bot.findBlocks({ matching: bot.registry.blocksByName.end_stone.id, maxDistance: 64, count: 64 }).map(p => ({ p, d: Math.hypot(p.x + .5 - here.x, p.z + .5 - here.z) })).sort((a, b) => a.d - b.d)[0];
      // Apart from the island: none of its ground within three blocks.
      if (near && blocks >= 4 && bot.entity.onGround !== false && (!stone || stone.d > 3)) {
        const to = stone ? stone.p : centre, STRETCH = 12;
        tree.bridge_to_island = { description: { action: `Lay a span of the blocks carried toward the island, one wide and laid crouched (a crouched player does not walk off an edge), up to ${STRETCH} blocks at a time: no walk leads off this footing, the void is beside it, and the dragon's wing throws a player from where it stands`,
          blocksCarried: blocks, islandGroundBlocksOff: stone ? Math.round(stone.d) : null, health: bot.health, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(here)) : null },
          run: async () => {
            const from = here.clone();
            goal.step = { action: 'end_bridge', toward: { x: to.x, y: Math.floor(here.y), z: to.z }, blocks }; save();
            const placed = await bridging.bridgeTo(bot, task, new Vec3(to.x, Math.floor(here.y), to.z), { maxBlocks: STRETCH, maxSteps: STRETCH });
            state.bridged = (state.bridged || 0) + placed; if (placed > 0 || bot.entity.position.distanceTo(from) >= 2) progress = true; save();
          } };
      }
    }
    // Off the island with the void beside it (the entry platform apart from
    // it, or the span laid from it: the floor not the island's own stone)
    // and no walk off: onto the island before anything else, by the drop to
    // its ground under the edge where there is one, else by the span. This
    // is the body's safety, not a choice (note 1160): the dragon's wing
    // throws whatever stands there, and under it is the void. The
    // rehearsals of 2026-10-04 (01:49Z, 02:54Z) chose a crystal's shot and a
    // look from the platform and from the end of their own span, the
    // island's ground six blocks under it, and were thrown off: "fell out
    // of the world", twice.
    {
      const { deepBeside } = require('./end-safety');
      const here = bot.entity.position, floorName = bot.blockAt(here.floored().offset(0, -1, 0))?.name;
      const offIsland = !!floorName && !['end_stone', 'bedrock', 'air'].includes(floorName) && !box && !inWater() && bot.entity.onGround !== false &&
        [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => deepBeside(bot, here.offset(dx, 0, dz)));
      if (offIsland) {
        // A walk off it, where the shots on offer left the routes unlooked for.
        const walkOff = Object.keys(tree).some(k => k.startsWith('move_')) || (await arenaRoutes(bot, task, goal, policy, focus)).length > 0;
        if (!walkOff) {
          if (await leaveHighGround(bot, task, goal, save, state)) { progress = true; return; }
          if (tree.bridge_to_island) { await tree.bridge_to_island.run(); return; }
        }
      }
    }
    // A pause can reveal a vulnerable phase, but it must not indefinitely
    // displace executable actions. Renew that allowance only after actual
    // movement, damage, crystal destruction or observed health recovery.
    // Watching stays a choice beside the others (note 1343): taken away
    // after five idle watches it left under_head the only way, and the
    // arena's drill of a bare kit (2026-10-06 02:03Z) ran under the perched
    // head at 14.9 health and died there. The watches without progress are
    // said with it.
    if (safe && dragon) tree.observe = {
      description: { action: 'Wait one second without attacking or moving',
        health: bot.health, canRegenerate: bot.health < 20 && bot.food >= 18,
        usefulAttackAvailableNow: !!tree.shoot_dragon || !!tree.strike_head || crystals.some(c => tree[`crystal_${c.id}`]),
        dragonPhase: metadata(bot, dragon, 'phase'), pausesWithoutProgress: state.idleObservations || 0 }, run: async () => {
      state.idleObservations = (state.idleObservations || 0) + 1;
      bot.clearControlStates(); for (let n = 0; n < 10; n++) { check(); if (!safeHere()) break; await sleep(100); }
    } };
    // Unsafe only because of mobs close by (endermen turned by a glance or a
    // crystal's blast): hold with the sword out for them to come, and the
    // next step looks again. The no-progress budget still bounds it. As Blocked
    // it ended the rehearsal with the dragon at 148 of 200.
    // The dragon close with no surveyed way out holds the same way: it flies
    // on in seconds. Down in the exit portal's basin with the dragon over it,
    // the fresh-End rehearsal (2026-09-24) called that Blocked a minute in,
    // five crystals down, which in the run would end the fight.
    // Down its own pillar, a block at a time from under the feet (note
    // 1344): on top of one laid for a throw, the footing is a block wide and
    // nothing else is offered, and the drill of 2026-10-06 (04:16Z) held on
    // top of a 35-block pillar.
    const ownPillar = bot._pillarUp && Math.floor(bot.entity.position.x) === bot._pillarUp.x && Math.floor(bot.entity.position.z) === bot._pillarUp.z;
    if (ownPillar && actions.dig) {
      const feet = bot.entity.position.floored();
      let depth = 0; while (depth < 64 && /^(cobblestone|cobbled_deepslate|netherrack|dirt|stone|blackstone|deepslate|andesite|diorite|granite|tuff)$/.test(bot.blockAt(feet.offset(0, -1 - depth, 0))?.name || '')) depth++;
      // The island's own end stone is no pillar of the bot's (note 1351): the
      // drill of 2026-10-06 (05:52Z on) was offered this on the ground 755
      // times, each changing nothing.
      if (depth < 2) delete bot._pillarUp;
      if (depth >= 2) tree.pillar_down = {
        description: { action: `Dig down the bot's own pillar a block at a time from under the feet, ${depth} blocks to its foot: no fall on the way`, blocks: depth, health: bot.health, dragonHealth: beforeDragon },
        run: async () => {
          for (let n = 0; n < depth; n++) {
            check();
            const under = bot.entity.position.floored().offset(0, -1, 0);
            if (!/^(cobblestone|cobbled_deepslate|netherrack|dirt|stone|blackstone|deepslate|andesite|diorite|granite|tuff)$/.test(bot.blockAt(under)?.name || '')) break;
            // Dropped into, as the pillar's own column is (note 1382): dug
            // as a block in the way, the step aside found no footing on a
            // pillar one wide and threw "No solid adjacent footing", and the
            // drill of 2026-10-06 19:29Z sat 22 up after its throw until the
            // dragon struck it off (6, then 5, then the fall).
            try { await actions.dig(bot, task, under, { dropInto: true, openPit: true, requireDrops: false }); }
            catch (err) { console.log(`[end combat] pillar down stopped ${n} of ${depth} down: ${String(err.message || err).slice(0, 160)}`); throw err; }
            for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50);
          }
          delete bot._pillarUp;
        } };
    }
    if (!Object.keys(tree).length && !safe) {
      state.heldForMobs = { at: Date.now(), unsafe: unsafeBecause(bot, bot.entity.position).slice(0, 6) }; save();
      goal.step = { action: 'end_hold', unsafe: state.heldForMobs.unsafe }; save();
      await defendHere(1000); return;
    }
    // Nothing to do from a height with the island's ground under its edge
    // (the entry platform, a pillar's ledge): the way down off it, before
    // the fight is called blocked (leaveHighGround, note 1131). The
    // rehearsals of 2026-10-03 (23:00 and 23:05Z) ended at their first
    // steps on the entry platform, ten blocks over the island: every route
    // lay more than the three blocks down a route may go, no shot was
    // clear, and "No observed safe End route" ended the fight with 192
    // arrows carried and every crystal standing.
    if (!Object.keys(tree).length && safe && await leaveHighGround(bot, task, goal, save, state)) return;
    if (!Object.keys(tree).length) {
      state.emptyChoice = { at: Date.now(), position: { ...bot.entity.position }, safe, unsafe: safe ? [] : unsafeBecause(bot, bot.entity.position).slice(0, 6),
        crystals: crystals.length, dragon: !!dragon, bow, arrows: countOf(bot, 'arrow'), focus: focus?.name, idle: state.idleObservations || 0 };
      save();
      // One look with nothing to choose is a bad moment, not the end of the
      // fight (note 1132): a second's wait and the next step looks again,
      // counted against the fight's own budget of steps without progress
      // (eighty, above). As a Blocked error it ended three rehearsals of
      // 2026-10-03 within their first half minute (23:00, 23:05 and 23:09Z):
      // on the entry platform, and at the foot of the island's slope a
      // moment after landing, the dragon away and the crystals out of a
      // clear shot.
      state.noProgress = (state.noProgress || 0) + 1; save();
      goal.step = { action: 'end_wait', looks: state.noProgress, crystals: crystals.length, dragon: !!dragon }; save();
      for (let n = 0; n < 10; n++) { check(); await sleep(100); }
      return;
    }
    const decision = await decide('dragon_fight', { client, bot, goal, tree, context: { safe }, interrupt: check, watchMs: 50,
      state: endDecisionState({ request: goal.request, health: bot.health, food: bot.food, arrows: countOf(bot, 'arrow'),
        position: { ...bot.entity.position }, safe, dragon: state.dragon,
        head: head && { position: { ...head.position }, reachable: canStrike(bot, head) }, crystals: state.observedCrystals, combat: state }),
      isFresh: () => dimension(bot) === 'end' && bot.health >= healthBefore && bot.entity.position.distanceTo(start) < 1 });
    if (decision.stale) return;
    chose = true;
    if (Object.keys(tree).length === 1 && tree.observe && !(state.onlyObserveSaid > Date.now() - 10000)) {
      state.onlyObserveSaid = Date.now();
      console.log(`[end combat] only observe: wet ${wet}, dragon phase ${dragon ? metadata(bot, dragon, 'phase') : 'none'} ${dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : '-'} off, head ${head ? `${Math.round(head.position.distanceTo(bot.entity.position))} off` : 'none'}, hostiles ${hostileEntities(bot, 64).map(e => `${e.name} ${Math.round(e.position.distanceTo(bot.entity.position))}`).join(', ') || 'none'}, routes ${JSON.stringify(state.routeLook || {})}, no shot: ${noShot}`);
    }
    goal.step = { action: 'end_combat', selected: decision.path, dragonHealth: beforeDragon, observedCrystals: crystals.length }; save();
    try { await decision.action.run(); }
    catch (err) {
      if (['Cancelled', 'Blocked', 'EndEmergency'].includes(err.name)) throw err;
      // Moving targets, a newly visible cloud or an obstructed route require
      // a fresh bounded choice. They do not invalidate the retained goal.
      state.lastInterrupted = { at: Date.now(), action: decision.path, reason: err.message }; save();
      console.log(`[end combat] ${[].concat(decision.path).join('/')} ended: ${String(err.message).slice(0, 160)}`);
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
    // A step that was the dragon's turn (an evasion, a hold for endermen, a
    // meal) is no choice of the bot's that came to nothing: only a choice
    // made counts against the budget. The rehearsal of 2026-10-03 (23:31 to
    // 23:35Z) spent its eighty in 75 seconds after its last hit, most of
    // them evasions and holds, the dragon at 166.5 of 200, every crystal
    // down and 187 arrows carried (note 1136).
    state.noProgress = progress ? 0 : (state.noProgress || 0) + (chose ? 1 : 0);
    state.lastActionAt = started; save();
    bot.removeListener('entityMoved', moved); task.interruptCheck = oldInterrupt;
    bot.pathfinder.setGoal(null); bot.clearControlStates(); policy.restore();
  }
}

module.exports = { enclosed, dropOffs, leaveHighGround, voidEdge, endermenNearRoute, metadata, perched, perchedHead, repeatedCrystalMiss, observeArena, endHazards, safeEndPoint, arenaMovement, arenaRoutes, fightEndStep };
