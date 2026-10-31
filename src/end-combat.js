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
// What the blows at crystals took from the bot (note 1414): this fight's
// own, then the arena's measure. -> string
const PUNCH_RECORD = { under: 'the arena\'s drill of 2026-10-13 (05:08Z, full iron, shield raised) took 0.4', top: 'the arena\'s drills of 2026-10-13 (03:47 to 04:02Z, full iron, 20 health) took 14.5, 14.6 and 14.6 a crystal with no shield up, and 0 with the shield raised for the blow (04:12Z; the shield is raised where one is carried)' };
function punchRecordSays(state, under = true) {
  const own = (state?.punches || []).filter(p => p.exploded && p.under === under);
  const mine = own.length ? `this fight's ${own.length} such blow${own.length === 1 ? '' : 's'} took ${own.map(p => p.took).join(', ')} health` : '';
  return `The crystal bursts when struck, a blast of power six (a creeper's is three) centred on the top face of its bedrock: struck at its own height from beside it, standing, the arena's drill of 2026-10-06 (05:46Z, full iron) took 11.8; ${under ? 'from two blocks under the bedrock, beside the pillar' : 'crouched on the top two blocks from the bedrock'}, ${under ? PUNCH_RECORD.under : PUNCH_RECORD.top}${mine ? `; ${mine}` : ''}.`;
}
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
const blocksCarriedName = bot => { const SCAFF = ['end_stone', 'cobblestone', 'netherrack', 'dirt', 'stone', 'cobbled_deepslate', 'andesite', 'granite', 'diorite', 'oak_planks', 'spruce_planks', 'birch_planks']; return (bot.inventory?.items() || []).map(i => i.name).find(n => SCAFF.includes(n)) || null; };
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
const { cloudRadius, hazardDistance, endEmergency, checkEndEmergency, evadeDragon, dragonThreat, breathThreat } = require('./end-safety');
// A breath cloud over the body's column within its reach and a block and a
// half beside, from half a block under the feet to four and a half over
// (note 2033): the climb out of a hole at a pillar's foot rises into it.
// Higher for a longer climb (note 2040): the dig to the sky goes up through
// all the rock over the head.
function cloudOverClimb(bot, up = 4.5) {
  const p = bot.entity?.position;
  if (!p) return null;
  return Object.values(bot.entities || {}).filter(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position && e.position.y - p.y >= -0.5 && e.position.y - p.y <= up && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 1.5).sort((a, b) => a.position.y - b.position.y)[0] || null;
}
const { endDecisionState, dragonNow } = require('./decisions/end-state');
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
    if (perched(bot, dragon)) { state.arenaCenter = { ...dragon.position }; bot._arenaCenter = { ...dragon.position }; }
  }
  return crystals;
}

function endHazards(bot) {
  const hazards = Object.values(bot.entities).filter(e => live(bot, e) && (['end_crystal', 'area_effect_cloud', 'dragon_fireball'].includes(e.name) ||
    e.name === 'ender_dragon' && !perched(bot, e) && metadata(bot, e, 'phase') !== 9))
    .map(e => ({ entity: e, radius: e.name === 'end_crystal' ? 12 : e.name === 'area_effect_cloud' ?
      cloudRadius(bot, e) : e.name === 'ender_dragon' ? ([2, 3].includes(metadata(bot, e, 'phase')) ? 10 : 16) : 6 }));
  // The dragon's body at its perch (note 1544): sitting on the fountain, or
  // coming down to it, its body and wings strike what stands within about
  // eight of the fountain's middle, 4.9 a blow. A walk ends no nearer than
  // that, unless it is the run under the head. 25588 (dragon-95, 2026-10-14
  // 00:12Z, four crystals broken, 14.3 health) walked toward the fountain in
  // four moves as the dragon came down, ended 7.6 from its middle, and took
  // three blows in 1.3 seconds, 14.3 to 7.9 to 1.5 to none.
  if (!bot._underHeadRun) for (const e of Object.values(bot.entities)) {
    if (e.name !== 'ender_dragon' || !live(bot, e)) continue;
    const phase = metadata(bot, e, 'phase');
    const spot = perched(bot, e) ? e.position : [2, 3].includes(phase) && bot._arenaCenter ? vector(bot._arenaCenter) : null;
    // Only from outside: the body already within the eight (under the head for the sword, note 1156) is not 'unsafe' for it; no walk goes in.
    if (spot && Math.hypot(spot.x - bot.entity.position.x, spot.z - bot.entity.position.z) > 8) hazards.push({ entity: { name: 'ender_dragon_body', position: spot, isValid: true }, radius: 8 });
  }
  return hazards;
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
// The sides of the feet's cell that drop two or more: water poured at the feet runs off them.
function runOffSides(bot, feet) {
  const solid = c => bot.blockAt(c)?.boundingBox === 'block';
  return [['east', 1, 0], ['west', -1, 0], ['south', 0, 1], ['north', 0, -1]].filter(([, dx, dz]) => !solid(feet.offset(dx, -1, dz)) && !solid(feet.offset(dx, -2, dz))).map(([n]) => n);
}
async function pourAtFeet(bot, check, { urgent = false } = {}) {
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  // One bucket stays full for a knocked-back landing, unless the enderman is
  // at arm's length (note 1457): 25588 (dragon-37, 2026-10-13 11:23Z, full
  // iron, a diamond sword, crystals 12 and 81 broken) had one bucket left
  // and an enderman at 3 blocks, poured nothing, and was dead in three
  // seconds, 15 to none, about 4 a blow through the iron. The water is
  // taken back once the enderman is gone.
  if (!bucket || (countOf(bot, 'water_bucket') < 2 && !urgent)) return null;
  const feet = bot.entity.position.floored(), below = feet.offset(0, -1, 0);
  if (bot.blockAt(below)?.boundingBox !== 'block' || bot.blockAt(feet)?.name !== 'air') return null;
  // Not on a top the water runs off (note 1657): water poured on a column's
  // top or a ledge's edge falls down its open sides and the flow carries the
  // body down with it, and an enderman cannot stand beside such a top to strike.
  // 25588 (dragon-192, 2026-10-14 18:12Z, 7 crystals standing) poured against
  // an enderman on its own column's top at (32, 64, -20), four blocks high, was
  // carried down to (30, 60, -20) into the breath's cloud, and died there in
  // three seconds; the pours of dragon-177, 179 and 189 were made on columns too.
  const runOff = runOffSides(bot, feet);
  if (runOff.length >= 2) { console.log(`[end combat] no water at the feet at ${vector(feet)}: it would run off the ${runOff.join(' and ')} sides, two or more down, and carry the body with it`); return null; }
  // Not in a hole (note 1682): water poured in a hole fills it, and a filled hole has no climb out (the block is still water) and no dig; the hole itself is the shelter. 25588 (dragon-217, 2026-10-15 00:42Z, no crystal broken) poured against an enderman from its roofed hole at (-3, 59, 6), six from the fountain, could not lay a block to climb out ('Server refused to place end_stone: the block is still water'), stood in the water, and the breath took 20 to none in three seconds.
  const solidSide = ([dx, dz]) => bot.blockAt(feet.offset(dx, 0, dz))?.boundingBox === 'block' && bot.blockAt(feet.offset(dx, 1, dz))?.boundingBox === 'block';
  const closedSides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(solidSide).length;
  if (closedSides >= 3) { console.log(`[end combat] no water at the feet at ${vector(feet)}: the body is in a hole (${closedSides} of 4 sides closed), and water poured there fills it and leaves no climb out`); return null; }
  await bot.equip(bucket, 'hand'); check();
  await bot.lookAt(below.offset(.5, 1, .5), true); await sleep(100);
  bot.activateItem();
  for (let n = 0; n < 20; n++) { check(); if (bot.blockAt(feet)?.name === 'water') return feet; await sleep(50); }
  return null;
}
// Water poured on the ground at the enderman's own feet (note 1671), where the bot's feet are a top it would run off (note 1657): the enderman in water takes damage and teleports off, and the water lies where it stands. 25588 (dragon-205, 2026-10-14 21:55Z, no crystal broken, 9 health) stood on its two-block stub at (11, 62, 11), 'no water at the feet: it would run off', fought the enderman with the sword, two blows, and took three of its, 9 to 4.9 to 0.9 to none in two seconds.
async function pourAtEndermanFeet(bot, check, enderman) {
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (!bucket || !enderman) return null;
  const feet = enderman.position.floored(), below = feet.offset(0, -1, 0);
  if (bot.blockAt(below)?.boundingBox !== 'block' || !/^(air|short_grass|grass)$/.test(bot.blockAt(feet)?.name || '')) return null;
  const eye = bot.entity.position.offset(0, 1.62, 0);
  if (eye.distanceTo(below.offset(.5, 1, .5)) > 4.5) return null;
  await bot.equip(bucket, 'hand'); check();
  await bot.lookAt(below.offset(.5, 1, .5), true); await sleep(100);
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
// The nearest cell of the island's edge, with the way to it (note 2236): the first cell in eight directions with no floor
// within forty below, as voidEdge counts it. -> { at: {x, z}, distance, side, dx, dz } or null
function voidEdgeCell(bot, p, reach = 48) {
  const name = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north', '1,1': 'south-east', '1,-1': 'north-east', '-1,1': 'south-west', '-1,-1': 'north-west' };
  for (let r = 1; r <= reach; r++) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = Math.floor(p.x) + dx * r, z = Math.floor(p.z) + dz * r;
      let floor = false, loaded = true;
      for (let y = Math.floor(p.y); y >= Math.floor(p.y) - 40; y--) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (!b) { loaded = false; break; }
        if (b.boundingBox === 'block') { floor = true; break; }
      }
      if (loaded && !floor) return { at: { x: x - dx, z: z - dz }, distance: Math.max(0, r - 1), side: name[`${dx},${dz}`], dx, dz };
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

// How near the straight line of a move passes the dragon, across the
// ground (note 1407): a perched dragon's body and wings hurt and throw what
// comes close. The dragon stage of 2026-10-07 (25588, 21:04:01Z), waiting
// sixteen blocks from the perch, took an escape to the far side of the
// fountain, offered with the endermen near its line and not the dragon,
// passed ten blocks from the perched dragon, was hit twice and thrown, and
// died.
function dragonNearRoute(dragon, from, to) {
  if (!dragon?.position) return undefined;
  const flat = v => new Vec3(v.x, 0, v.z), a = flat(from), d = flat(to).minus(a), len2 = d.dot(d) || 1, p = flat(dragon.position);
  const t = Math.max(0, Math.min(1, p.minus(a).dot(d) / len2));
  return Math.round(p.distanceTo(a.plus(d.scaled(t))));
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
// The head in every sitting phase (note 1604): the dragon sits scanning
// (phase 5) for most of a perch, then rears (6) and breathes (7) and scans
// again, twenty to fifty seconds in all with a player within twenty (the
// perches of 2026-10-14 at 19 to 23 blocks: 52, 33, 27, 20 and 47 s). With
// the head read only in 6 and 7, every run under it that arrived in a
// scanning second ended 'the dragon took off before the bot was under its
// head' while the dragon sat on: eight runs of eight that day, none struck.
function perchedHead(bot, dragon) {
  if (![5, 6, 7].includes(metadata(bot, dragon, 'phase'))) return null;
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
  // Not the island's rim (note 1450): a cell of the island's own stone with
  // the void beside it is no step of any walk; a span's cell (cobblestone,
  // the bot's own) is. 25588 (dragon-30, 2026-10-13 09:53Z, full iron) took
  // a walk to ground four blocks off along the eastern slope, the path went
  // down the rim at (48, 34, -13) and over, and it fell out of the world;
  // dragon-19 (07:56Z) went over the same rim at a run.
  const { deepBeside } = require('./end-safety');
  // And three cells back from it (note 1467): the island's eastern
  // underside slopes from 36 to 29 and over, every cell of it with a floor
  // beside, and four trials went off it at (46 to 52, 27 to 32, -24 to -16):
  // dragon-19, 30, 41 and 46 (2026-10-13), the last at full health on a walk
  // to ground five blocks off. A cell with the void within three is no step
  // of a walk; the bot's own cell is, to leave it.
  const own = bot.entity.position.floored();
  // The rim read once a cell (note 1578): the path search asks allowedPoint
  // of every cell it expands, and voidEdge reads up to 960 blocks a cell
  // (three rings, eight ways, forty down). The CPU profile of the arena
  // drill of 2026-10-14 05:13Z had 21 of 33 busy seconds in the search's
  // getNeighbors, 10 of them in this rim test: the event loop held two to
  // four seconds at a time, and the live runs' stalls (dragon-124's 2.2 s in
  // the breath, 126's 2.5 s at the blow) were these searches. The cells'
  // verdicts are kept a second and a half; the hazards are read once in 150 ms.
  const rimCache = new Map(); let rimCacheAt = 0, hazards = null, hazardsAt = 0;
  const rim = point => {
    const f = point.floored(), now = Date.now();
    if (now - rimCacheAt > 1500) { rimCache.clear(); rimCacheAt = now; }
    const key = `${f.x},${f.y},${f.z}`;
    if (rimCache.has(key)) return rimCache.get(key);
    const under = bot.blockAt(f.offset(0, -1, 0));
    const v = under?.name === 'end_stone' && (deepBeside(bot, point) || (!f.equals(own) && voidEdge(bot, point, 3) !== null));
    rimCache.set(key, v); return v;
  };
  const hazardsNow = () => { const now = Date.now(); if (!hazards || now - hazardsAt > 150) { hazards = endHazards(bot); hazardsAt = now; } return hazards; };
  const allowedPoint = point => {
    return point.y >= start.y - 3 && point.distanceTo(start) <= 64 && !rim(point) &&
      (!center || Math.hypot(point.x - center.x, point.z - center.z) <= Math.max(96, Math.hypot(start.x - center.x, start.z - center.z))) &&
      (!previous.allowedPosition || previous.allowedPosition(point.floored())) &&
      hazardsNow().every(({ entity, radius }) =>
        hazardDistance(point, entity) >= Math.min(radius, hazardDistance(bot.entity.position, entity) - .1));
  };
  const allowed = p => allowedPoint(vector(p).offset(.5, 0, .5));
  // Towers of one allowed with ten blocks or more carried (note 1505): the island's eastern shelf at 41 to 46 meets the top at 56 to 62 in faces of three to six blocks, and every walk from the entry platform to a pillar's foot across them ended 'navigation timed out without reaching new ground' (25588, dragon-67 to dragon-75, 2026-10-13, five to eight failed foot walks a run, two to four minutes each run on the shelf). The rim's cells are still no step of any walk.
  Object.assign(movement, { canDig: true, blocksCantBreak: cantBreak, allow1by1towers: blocksCarried(bot) >= 10, allowSprinting: false,
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
// The wait eleven blocks from the fountain, not sixteen (note 1596): the
// game's sitting dragon looks for a player within twenty blocks of ITSELF
// and leaves after five seconds without one; a wait 'about 16' from the
// fountain's middle ended at 19 to 20 (dragon-136, 2026-10-14 07:05Z, at
// 19.8), the dragon lost the player and took off four and a half seconds
// after perching, and of the seven runs under the head in runs 100 to 139
// of that day six ended 'the dragon took off before the bot was under its
// head', none struck. Within twenty it sits on: a second and a quarter
// scanning, two seconds rearing, up to ten seconds of breath, then the
// take-off; the run from eleven blocks is two seconds.
const FEW_ARROWS = 64, PERCH_RANGE = 11;
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
// The steps a span to `to` takes: a cell a step along one axis at a time (bridging.js stepToward), and the stretch laid beyond what stands.
const spanSteps = (here, to, stretch) => stretch + Math.ceil(Math.abs(to.x - here.x) + Math.abs(to.z - here.z));

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
      return p.distanceTo(current) >= 5 && dryStanding(bot, p) && safeEndPoint(bot, p) && !require('./end-safety').deepBeside(bot, p) && voidEdge(bot, p, 3) === null;
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

// Air in the End (note 1774): the fight owns every tick there and the arbiter never hands the turn to the survival layer, so a body under water has no rescue but this. 25588's dragon-139 (2026-10-17 16:4xZ, 226 blocks carried) dug its tunnel's floor into a pool's run-off at (-7, 54, 34), went under, and drowned over 21 s of '0 air and no rescue under way'. Under 15 air with the head or the feet in water: an empty bucket scoops a source at the head or the feet (the air comes with it), the jump key is held toward the surface, and a roof over the shaft is dug with the bot's own dig (the work loop's dig checks the air and would throw).
async function airInTheEnd(bot, task, goal, save) {
  const air = () => bot.oxygenLevel ?? 20;
  const wet = p => /water/.test(bot.blockAt(p)?.name || '');
  const headCell = () => bot.entity.position.offset(0, 1.62, 0).floored(), feetCell = () => bot.entity.position.floored();
  if (!(air() < 15 && wet(headCell()))) return false;
  const t0 = Date.now(), a0 = air(), p0 = feetCell(), alive = () => bot.health > 0 && bot.isAlive !== false && /end$/.test(String(bot.game?.dimension || ''));
  goal.step = { action: 'air_in_the_end', air: a0, at: { x: p0.x, y: p0.y, z: p0.z } }; save();
  bot._airAbort = false; bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  bot._airRescueAt = Date.now();
  const mark = setInterval(() => { bot._airRescueAt = Date.now(); }, 500);
  const how = [];
  // An empty bucket on a source at the head or the feet: the cell empties and the air comes with it.
  try {
    const { sourceWater } = require('./water');
    const bucket = bot.inventory.items().find(i => i.name === 'bucket');
    if (bucket) for (const c of [headCell(), feetCell()]) { const b = bot.blockAt(c); if (b && wet(c) && sourceWater(b)) { await bot.equip(bucket, 'hand'); await bot.lookAt(c.offset(.5, .5, .5), true); await sleep(120); bot.activateItem(); await sleep(250); how.push(`the water at ${c} scooped`); break; } }
  } catch (err) { how.push(`no scoop: ${String(err.message || err).slice(0, 60)}`); }
  // A roof over the shaft: the body sinks to the floor first (a dig afloat under water is twenty-five times slower, on the floor five), the pickaxe in hand, and the block over the head is dug; the arena (2026-10-17 16:46Z) dug it afloat and bare-handed in 20 s, 20 to 1.3 health.
  const roofOver = () => { for (let dy = 1; dy <= 2; dy++) { const c = headCell().offset(0, dy, 0), b = bot.blockAt(c); if (b?.boundingBox === 'block') return /bedrock|obsidian|end_portal/.test(b.name) ? null : c; if (!wet(c)) return null; } return null; };
  let roof = wet(headCell()) ? roofOver() : null;
  if (roof) {
    try { const pick = bot.inventory.items().find(i => /_pickaxe$/.test(i.name) && !/wooden|golden/.test(i.name)) || bot.inventory.items().find(i => /_pickaxe$/.test(i.name)); if (pick) await bot.equip(pick, 'hand'); } catch (_) {}
    bot.setControlState?.('sneak', true);
    for (let i = 0; i < 16 && alive() && !bot.entity.onGround; i++) await sleep(50);
    bot.setControlState?.('sneak', false);
    for (let tries = 0; tries < 3 && alive() && roof && wet(headCell()); tries++) {
      const b = bot.blockAt(roof); if (!b || b.boundingBox !== 'block') break;
      try { const td = Date.now(); await bot.dig(b); how.push(`${b.name} over the head dug in ${Math.round((Date.now() - td) / 100) / 10} s${bot.entity.onGround ? '' : ' afloat'}`); } catch (err) { how.push(`no dig: ${String(err.message || err).slice(0, 50)}`); }
      roof = roofOver();
    }
  }
  bot.setControlState?.('jump', true);
  // The roof met on the way up dug too (note 2206): the roof was looked for only where the body began, and dragon-317
  // (25590, 2026-10-26 12:00Z) swam up a water column from 56 to 74 under its own roofs, 'the head still under', 0 air,
  // and drowned. Now, when the rise stops with the head still under, the block over the head is dug and the swim goes on.
  let lastY = bot.entity.position.y, stillSince = Date.now();
  while (Date.now() - t0 < 12000 && alive() && wet(headCell())) {
    await sleep(50);
    if (bot.entity.position.y > lastY + 0.05) { lastY = bot.entity.position.y; stillSince = Date.now(); continue; }
    if (Date.now() - stillSince < 400) continue;
    const over = roofOver();
    if (!over) { stillSince = Date.now(); continue; }
    bot.setControlState?.('jump', false);
    const b = bot.blockAt(over);
    try { const td = Date.now(); await bot.dig(b); how.push(`${b.name} over the head at ${over} dug afloat in ${Math.round((Date.now() - td) / 100) / 10} s`); } catch (err) { how.push(`no dig at ${over}: ${String(err.message || err).slice(0, 50)}`); break; }
    bot.setControlState?.('jump', true); stillSince = Date.now(); lastY = bot.entity.position.y;
  }
  bot.setControlState?.('jump', false);
  clearInterval(mark);
  console.log(`[end combat] air in the End at ${p0}: ${a0} air, ${how.join(', ') || 'swam up'}; now ${air()} air at ${feetCell()}, the head ${wet(headCell()) ? 'still under' : 'out'}, ${Math.round((Date.now() - t0) / 100) / 10} s`);
  return true;
}
async function fightEndStep(bot, task, goal, save, actions, client, { shot = shootBow } = {}) {
  // No blow at what cannot be struck (note 1456): the server's answer to one
  // is the door ('multiplayer.disconnect.invalid_entity_attacked'), and 25588
  // was kicked twice today mid-fight (dragon-20 08:05Z, dragon-36 11:15Z),
  // the second time at the foot of its column with crystal 11 just broken.
  // Items, orbs, arrows, the breath and the fireball are never struck; a
  // crystal only by the fight's own blow (bot._crystalBlow set round it).
  if (!bot._attackGuard && typeof bot.attack === 'function') {
    const raw = bot.attack.bind(bot); bot._attackGuard = true;
    // Nor the bot itself (note 1466): the blow named by note 1463 was 'blow at player (id 50, 0 off)', the bot's own body, and the door followed at once (dragon-44, 2026-10-13 12:37Z).
    const NEVER = new Set(['item', 'experience_orb', 'arrow', 'spectral_arrow', 'trident', 'area_effect_cloud', 'dragon_fireball', 'fireball', 'small_fireball', 'shulker_bullet', 'end_crystal', 'player']);
    bot.attack = (entity, ...rest) => {
      if (!entity || entity === bot.entity || entity.id === bot.entity?.id || (NEVER.has(entity.name) && !(entity.name === 'end_crystal' && bot._crystalBlow))) { console.log(`[end combat] no blow at ${entity?.name || 'nothing'} (id ${entity?.id}): it cannot be struck`); return; }
      // Every blow named (note 1463): the server's door ('invalid_entity_attacked') was shown 25588 five times today with no blow the guard refused, the last two on the way down a column (dragon-43, 12:2xZ).
      console.log(`[end combat] blow at ${entity.name} (id ${entity.id}, ${Math.round(entity.position?.distanceTo?.(bot.entity.position) * 10) / 10} off)`);
      return raw(entity, ...rest);
    };
  }
  if (await airInTheEnd(bot, task, goal, save)) return;
  let stepCut = null;
  const check = () => {
    task.check(); checkAir(bot);
    // A run cut by the breath's watch (note 1619) ends at its next check, or it runs on beside the response (dragon-158, 2026-10-14 10:46Z: the quarry cut at 20 health dug its ten cells on while the response ran) (note 1620).
    if (stepCut && !require('./respawn-fresh').standing(goal)) throw Object.assign(new Error(stepCut), { name: 'EndEmergency' });
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
  let progress = false, chose = false, breathWatch = null;
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
  // A fall off the column caught in the air, every tick of the step (note
  // 1483): the dragon's wing pushes the body off its column with no blow
  // (note 1480), the push lifts it, so a crouch holds nothing, and the fall
  // from a column is 15 to 20 blocks onto the island. The dig under way
  // notices nothing until it ends. With a water bucket carried the water goes
  // under the body before it lands (fall-recovery.js), as it does on the
  // island's edges. 25588 (dragon-59, 15:06Z), (dragon-61, 15:37Z, to 1
  // health), (dragon-62, 15:54Z) and (dragon-63, 16:04Z), all of 2026-10-13,
  // full iron, two water buckets carried, fell 10 to 19 blocks off their
  // columns, dragon-59, 62 and 63 to their deaths, no water poured.
  const falling = () => {
    try {
      if (bot._fallRecovery || bot.entity?.onGround !== false || !fallDanger(bot)) return;
      if ((bot.entity.velocity?.y || 0) > 0.6) require('./landing-walk-record').thrown(bot);
      // The fall said even with no bucket to clutch with (note 1803): 25588's dragon-175 (2026-10-18 00:30Z) had poured its last bucket into the drop's pool, took a fireball's cloud on its stub at (-31, 78, 22), 17.5 to 11, and died at 62 sixteen blocks below with not one line between: no fall seen, no step named, nothing to fix from. Once a fall.
      // A boat carried clutches the fall where no bucket does (fall-recovery.js boatClutch, note 2178).
      if (!bot.inventory.items().some(i => i.name === 'water_bucket') && !bot.inventory.items().some(i => require('./boats').boatItem(i.name))) {
        if (!(bot._dryFallSaid > Date.now() - 3000)) { bot._dryFallSaid = Date.now(); const u = bot._pillarUp, p = bot.entity.position; const keys = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].filter(k => bot.controlState?.[k]); console.log(`[end combat] falling from ${p.floored()} at ${bot.health.toFixed(1)} health with no water bucket to clutch with${u ? ` (${Math.round(Math.hypot(u.x + .5 - p.x, u.z + .5 - p.z) * 100) / 100} off the column (${u.x}, ${u.z})'s middle)` : ' (no column)'}; step ${goal.step?.action || 'none'}; keys ${keys.join('+') || 'none'}; velocity ${bot.entity.velocity ? bot.entity.velocity.y.toFixed(2) : '?'}`); }
        return;
      }
      { const u = bot._pillarUp, p = bot.entity.position; const off = u ? Math.round(Math.hypot(u.x + .5 - p.x, u.z + .5 - p.z) * 100) / 100 : null; const keys = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].filter(k => bot.controlState?.[k]);
        // The fall's start said with the body's offset from its column's middle, the step under way and the keys held (note 1678): three falls off a column during the dig down in the breath on 2026-10-14 (dragon-209 at 87, 211 at 81, 212 at 73), each from a cell beside the column, and how the body left its cell is unproven.
        console.log(`[end combat] falling from ${p.floored()} at ${bot.health.toFixed(1)} health: the water bucket under the body${u ? ` (${off} off the column (${u.x}, ${u.z})'s middle` : ' (no column'}; step ${goal.step?.action || 'none'}; keys ${keys.join('+') || 'none'}; ${bot.entity.velocity ? `velocity ${[bot.entity.velocity.x, bot.entity.velocity.y, bot.entity.velocity.z].map(v => Math.round(v * 100) / 100).join(', ')}` : ''})`); }
      // The bucket filled again from the pool at once (note 1485): left, the water runs down the island's slopes with the body in it. 25588 (dragon-65, 2026-10-13 16:19Z) landed in its water at (35, 58, -22) on the eastern slope, was carried five blocks east in three seconds, over the slope's edge, and from the shelf below over the rim into the void.
      recoverFall(bot, task, goal, save, { refill: true }).then(r => console.log(`[end combat] the fall ended ${r ? 'in the water' : 'dry'} at ${bot.entity.position.floored()}, health ${bot.health.toFixed(1)}`), err => console.log(`[end combat] the water under the fall: ${String(err.message || err).slice(0, 120)}`));
    } catch (_) { /* nothing to catch */ }
  };
  bot.on('physicsTick', falling);
  // The dragon's phase changes said (note 1730), for the fireball's warning: the strafe at the player (phase 1) is the one that throws the fireball, and it begins seconds before the throw (Fable, 2026-10-15: it fires with a clear line from its eyes to the bot's for a quarter second and its body turned within ten degrees). 25588's deaths 256 to 276 (2026-10-15 09:37 to 12:34Z) were most of them a fireball's cloud on the body; this says how long before each one the strafe began. Kept to the bot's state for the step's own reading.
  // The sitting dragon's scan said on the hole and perch options (note 2238): landed, it looks for a player it can see within ten blocks up or down of itself, and seeing none for five seconds it takes off; a body in a hole, under a roof or behind a wall is unseen. 25589's stronghold-1-dragon-331 (2026-10-26 16:34 to 16:58Z, crystals gone, 98 arrows, holes and roofs) had the dragon land 29 times and take off after scanning 30 times, never flaming, 32 dragon health in 24 minutes; the two kills of the day (323 and 333, the body on the open ground at the fountain) had it sit through to the flame 16 and 10 times.
  const sitsSays = () => { const t = state.sits || { landed: 0, scannedAway: 0, attacked: 0 }; return `Landed, the dragon scans for a body it can see within twenty blocks of itself and ten up or down; seeing one it turns to it and breathes about a second and a quarter after landing, and keeps sitting through four breaths, the head within the sword's reach; seeing none for five seconds it takes off again and charges the nearest body within 150. A body in a hole, under a roof or behind a wall is unseen. This fight: ${t.landed} landing${t.landed === 1 ? '' : 's'}, ${t.scannedAway} left after the scan without an attack, ${t.attacked} went on to the attack and the flame.${t.landed >= 2 && t.attacked === 0 ? ' Every landing so far has ended with the body unseen.' : ''}`; };
  const phaseWatch = () => { try { const lf = state.lastFireball; if (lf && !lf.counted && Date.now() - lf.at < 4000 && bot.health < lf.health - 3) { lf.counted = true; state.fireballs.hurt++; { const st = state.lastStub, f = bot.entity.position.floored(); if (st && Date.now() - st.at < 90000 && Math.abs(f.x - st.x) <= 1 && Math.abs(f.z - st.z) <= 1 && f.y >= st.y - 1) { state.stubs ||= { built: 0, hit: 0 }; state.stubs.hit++; console.log(`[end combat] the fireball's cloud on the body on its stub at (${st.x}, ${st.y}, ${st.z})${st.roofed ? ', roofed' : ''}: ${state.stubs.hit} of ${state.stubs.built} stubs this fight`); } } console.log(`[dragon] the fireball's cloud on the body: ${lf.health.toFixed(1)} to ${bot.health.toFixed(1)}; ${state.fireballs.hurt} of ${state.fireballs.thrown} thrown this fight`); } const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e)); if (!d) return; const ph = metadata(bot, d, 'phase'); if (ph == null || ph === state.dragonPhase?.phase) return; const p = bot.entity.position; const was = state.dragonPhase; state.dragonPhase = { phase: ph, at: Date.now() }; { const t = state.sits ||= { landed: 0, scannedAway: 0, attacked: 0 }; /* landings counted on their seen end (note 2244): 328 showed 31 entries and 5 seen ends */ if (was?.phase === 6 && ph === 4) { t.scannedAway++; console.log(`[dragon] sat and took off after scanning without an attack at ${Math.round(d.position.distanceTo(p))} blocks; the bot at ${p.floored()}${holeHere() ? ', in a hole' : ''}${[1, 2, 3].some(dy => bot.blockAt(p.floored().offset(0, dy, 0))?.boundingBox === 'block') ? ', under a roof' : ''}: ${t.scannedAway} of ${t.landed} landings this fight`); } if (was?.phase === 6 && ph === 7) t.attacked++; t.landed = t.scannedAway + t.attacked; } if (ph === 1) { (state.strafeTimes ||= []).push(Date.now()); state.strafeTimes = state.strafeTimes.slice(-8); } if (ph === 1 || was?.phase === 1 || [3, 4, 5].includes(ph)) console.log(`[dragon] phase ${was?.phase ?? '?'} to ${ph} at ${Math.round(d.position.distanceTo(p))} blocks${was ? ` after ${((Date.now() - was.at) / 1000).toFixed(1)} s` : ''}; the bot at ${p.floored()}, ${bot.health.toFixed(1)} health`); } catch (_) { /* no dragon */ } };
  const fireballWatch = e => { try { if (e?.name !== 'dragon_fireball') return; state.lastFireballAt = Date.now(); const p = bot.entity.position, ph = state.dragonPhase; const fs = (state.fireballs ||= { thrown: 0, hurt: 0 }); fs.thrown++; state.lastFireball = { at: Date.now(), health: bot.health, counted: false }; console.log(`[dragon] fireball thrown at ${Math.round(e.position.distanceTo(p))} blocks from the bot at ${p.floored()}${ph ? `, phase ${ph.phase} for ${((Date.now() - ph.at) / 1000).toFixed(1)} s` : ''}`); } catch (_) { /* nothing */ } };
  bot.on('entitySpawn', fireballWatch);
  bot.on('physicsTick', phaseWatch);
  // The bot's own pillar under it, air on three sides at least: no walk off it.
  // By the block under the feet, not the column's recorded cell (note 1416):
  // the jumps of the climb drift, and 25588 (05:41Z) stood a cell off the
  // cell last recorded, 22 up, and was not on its pillar by the record.
  const SCAFFOLD_UNDER = /^(cobblestone|cobbled_deepslate|netherrack|dirt|stone|blackstone|deepslate|andesite|diorite|granite|tuff|end_stone)$/;
  // The record read from the ground where it is lost (note 1437): a
  // reconnect empties it, and 25588 (dragon-20, 2026-10-13 08:05Z), kicked
  // by the server and back on its own column at (-31, 92, -28) three
  // crystals in, was 'own pillar false, column undefined', held standing
  // through the dragon's pass, was knocked off and died of the fall. A
  // scaffold block under the feet, three or more of the four cells about
  // them open, and the ground four or more blocks under is the bot's column.
  const readPillar = () => {
    const f = bot.entity.position.floored(), under = bot.blockAt(f.offset(0, -1, 0));
    // High only (note 1441): the crystals' pillars top out at 76 to 103 and
    // the entry platform and its spans lie at 49; 25588 (dragon-23,
    // 2026-10-13 08:40Z) read its span's end at (90, 49, 7), the island's
    // slope four under it, as its column, and the crystal's walk was skipped.
    if (f.y < 66) return null;
    if (under?.boundingBox !== 'block' || !SCAFFOLD_UNDER.test(under.name) || under.name === 'end_stone' && f.y < 70) return null;
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (sides.filter(([dx, dz]) => bot.blockAt(f.offset(dx, -1, dz))?.boundingBox !== 'block').length < 2) return null;
    const drop = ([dx, dz]) => { for (let dy = 1; dy <= 6; dy++) if (bot.blockAt(f.offset(dx, -dy, dz))?.boundingBox === 'block') return dy - 1; return 6; };
    if (Math.max(...sides.map(drop)) < 4) return null;
    // Not a span over the void (note 1439): a column stands on something
    // within eight blocks under its block, a bridge's cell has nothing.
    // 25588 (dragon-22, 2026-10-13 08:21Z) read its own column at (94, 3),
    // the entry platform's bridge, one block over the void.
    let footing = false; for (let dy = 2; dy <= 9 && !footing; dy++) footing = bot.blockAt(f.offset(0, -dy, 0))?.boundingBox === 'block';
    if (!footing) return null;
    return { x: f.x, z: f.z, until: Date.now() + 600000, read: true };
  };
  const onOwnPillar = () => {
    if (!bot._pillarUp || bot._pillarUp.until < Date.now()) { const r = readPillar(); if (r) { bot._pillarUp = r; console.log(`[end combat] the bot's own column read from the ground under it at (${r.x}, ${r.z}), no record of it kept`); } }
    const u = bot._pillarUp, p = bot.entity.position;
    if (!u || u.until < Date.now()) return false;
    const f = p.floored();
    // The block stood on, not the cell the middle of the body is over (note
    // 1444): a body 0.6 wide at the column's edge stands on the column with
    // its middle over air. 25588 (dragon-25, 2026-10-13 09:04Z) at (30.8,
    // 77, -26.5) on its column at (31, -27) was 'not on a pillar', a stall
    // detour walked it off, and it fell 17 at 3.9 health.
    const onColumnCell = Math.hypot(u.x + .5 - p.x, u.z + .5 - p.z) <= 0.95 && bot.blockAt(new Vec3(u.x, f.y - 1, u.z))?.boundingBox === 'block';
    if (onColumnCell) f.x = u.x, f.z = u.z;
    const under = bot.blockAt(f.offset(0, -1, 0));
    // End stone under the feet below 70 is the island's, not a column's, only
    // off the column's own cell (note 1533): the climb's column is laid of
    // quarried end stone from the island's ground at 61, and 25588 (dragon-91,
    // 2026-10-13 22:54Z, four crystals broken) seven blocks up it at (-30,
    // 68, -23) was 'not on a pillar', looked for a walking escape from the
    // dragon's pass three times ('No surveyed walking escape'), took the
    // fireball's cloud there with no roof and no hold, and was knocked off.
    // On the recorded cell the drop beside the feet (below) tells the
    // column from the island's ground.
    if (under?.boundingBox !== 'block' || !SCAFFOLD_UNDER.test(under.name) || under.name === 'end_stone' && f.y < 70 && !onColumnCell) return false;
    if (Math.hypot(u.x + .5 - p.x, u.z + .5 - p.z) > 2.5) return false;
    if (u.x !== f.x || u.z !== f.z) bot._pillarUp = { ...u, x: f.x, z: f.z };
    // On the recorded cell with two of the column's own blocks or more under the
    // feet, the column is the bot's by its record (note 1610), with no drop
    // beside it asked: a column pocketed at two or three heights on the way up
    // and down has a lower pocket's walls under every side between them, and
    // the drop read from one to three under the feet ends on them. 25588
    // (dragon-150, 2026-10-14 09:08Z, two crystals broken) on its column at
    // (-10, 77, -38) with pockets at 72, 77, 79 and 82 was 'own pillar false',
    // offered the dig to the sky and observe only, climbed 'out of the hole'
    // with its last block, and the dragon's body threw it off at 78, dead.
    if (onColumnCell && columnDepth() >= 2) return true;
    // Two of the four cells round the feet open at least (a pillar laid up
    // against a round obsidian pillar's side has one or two of them solid),
    // and a drop of three or more off one of them (note 1458): at the
    // column's foot, in the pit the quarry left round it, the sides are
    // open and the ground a block down, and the bot is on the island, where
    // the breath is run from, not held in or dug under. 25588 (dragon-38,
    // 2026-10-13 11:30Z, full iron, crystal 11 broken) came down its column
    // to the foot at 60, was 'on its pillar' there, held for the fireball,
    // dug nothing in the cloud and died in it, 20 to none in three seconds.
    // One open side at least, not two (note 1482): the roof's post beside the
    // column (note 1454) and the obsidian make two or three solid sides at the
    // top, and 25588 (dragon-62, 2026-10-13 15:54Z, full iron, crystals 16 and
    // 83 broken) on its own column at (-10, 88, -38) was 'own pillar false',
    // 'only observe', never crouched there, and was pushed off it at 81 in
    // the breath, 19 blocks to its death.
    // Read at three depths (note 1577): the pocket's walls and posts close the cells beside the feet.
    return openDropBeside(f);
  };
  // A drop of three or more off one of the four cells beside the column, read
  // from one, two or three under the feet (the pocket's posts stand one under).
  const openDropBeside = f => {
    for (let from = 1; from <= 3; from++) {
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(f.offset(dx, -from, dz))?.boundingBox !== 'block');
      const drop = ([dx, dz]) => { for (let dy = from; dy <= from + 5; dy++) if (bot.blockAt(f.offset(dx, -dy, dz))?.boundingBox === 'block') return dy - from; return 6; };
      if (sides.length && Math.max(...sides.map(drop)) >= 3) return true;
    }
    return false;
  };
  // The column's blocks under the feet, up to six.
  const columnDepth = () => { const f = bot.entity.position.floored(); let n = 0; while (n < 6 && SCAFFOLD_UNDER.test(bot.blockAt(f.offset(0, -1 - n, 0))?.name || '') && !(bot.blockAt(f.offset(0, -1 - n, 0))?.name === 'end_stone' && f.y - 1 - n < 66 && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => bot.blockAt(f.offset(dx, -2 - n, dz))?.boundingBox === 'block'))) n++; return n; };
  // Ground about the feet (note 1865): a column whose top stands level with the island about it is ground, and the breath's cloud there is run out of, not held over. 25588's dragon-220 (2026-10-18 16:03Z), its pickaxe gone, stood at (10, 56, 34) on blocks laid up out of a pit to the island's level, a fireball's cloud came, 'the breath on the column ... incoming_dragon_fireball', the hold was kept and the health went 20 to 12 to none in a few seconds, the open ground a step away on three sides. Solid two cells out at one or two under the feet on three sides is ground; the step two up out of a cloud under the feet (note 1590) is kept wherever the body stands, the holds alone stand aside.
  const groundAbout = () => { const f = bot.entity.position.floored(); return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => [1, 2].some(dy => { const b = bot.blockAt(f.offset(2 * dx, -dy, 2 * dz)); return b?.boundingBox === 'block' && !/obsidian|bedrock/.test(b.name); })).length >= 3; };
  // The hole by the fountain (note 1592): two deep, the body in it out of the
  // dragon's wings and under the breath's cloud; out of it is two blocks laid.
  // Not on the bot's own column (note 1610): the pocket's walls round the feet are the hole's shape, and out of it is up onto the wings' reach with the blocks the way down keeps.
  // A roofed hole is a hole too (note 1623): the block over its mouth is the bot's own, laid while the dragon flies.
  // The recorded hole is the hole whatever its sides read (note 1632): read by its walls alone, a hole with a side open (an older hole beside it, a wall half dug) was no hole, the hole option was offered inside it and dug two more each time, and 25588 (dragon-163, 2026-10-14 12:50Z, all ten crystals broken) went 59, 57, 55, 53, 51, 49 in a shaft eleven blocks from the fountain, roofing each floor.
  const inRecordedHole = () => { const h = state.hole; if (!h || Date.now() - h.at > 120000) return false; const f = bot.entity.position.floored(); return f.x === h.x && f.z === h.z && f.y <= h.y + 0.5; };
  // A pickaxe carried (note 1763): end stone by hand is fifteen seconds a block and cobblestone ten, and the digs of the fight (the hole, the tunnel, the stair, the dig down out of the breath) are not offered or taken without one; 25588's dragon-113 and 118 (2026-10-17) died standing over bare-handed digs.
  const pickCarried = () => bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
  // A column's cell walled in on four sides at the feet and the head is a hole too (note 1791): the body coming down its column into the ground stops in a one-wide pit on the column's own cell, and 'on column cell' made it no hole, so the dragon near kept cutting every step ('wait_in_hole cut by the emergency dragon_charge_or_contact') with the hole's answer never taken; 25588's dragon-161 (2026-10-17 21:0xZ, one crystal, 186 blocks) looped so at (33, 62, -22) at full health.
  const holeHere = () => { const f = bot.entity.position.floored(); const solidAt = c => bot.blockAt(c)?.boundingBox === 'block'; const walled = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => solidAt(f.offset(dx, 0, dz)) && solidAt(f.offset(dx, 1, dz))) && solidAt(f.offset(0, -1, 0)) && !solidAt(f.offset(0, 3, 0)); const inTheIsland = [[2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dz]) => solidAt(f.offset(dx, 0, dz))) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => solidAt(f.offset(dx, -1, dz))); if (onColumnCell()) return walled && inTheIsland; if (inRecordedHole()) return true; return walled; }; // On the column the cell is a hole only in the island: solid two cells out on every side at the feet and under the side cells; a pocket's ring is one block thick with air beyond and under it (note 1610's test).
  // The crystals' healing said on every blow at the head (note 1629): in the game's code the dragon with a crystal standing near takes a point of health back every ten ticks, two a second, from the nearest crystal, so a blow at the head while any crystal stands is undone in seconds. 25588 (dragon-161, 2026-10-14 11:40 to 11:44Z) struck the head eight times from its hole with ten crystals standing, the dragon 200 to 158 and back to 200 within half a minute, and broke no crystal in nine minutes.
  // Today's record of the head sought with crystals standing (note 1654): 25588 on 2026-10-14 ran under the head with crystals up in dragon-151, 153, 154, 161, 164, 176 and 188; 161 landed eight blows, every one healed back within half a minute; 151, 153, 176 and 188 were thrown by the take-off or struck at the fountain, dead; none of the seven gained a point of lasting damage. Said on the head's options while any crystal stands.
  const headWithCrystalsRecord = 'the day\'s record of the head sought with crystals standing (2026-10-14, seven runs: dragon-151, 153, 154, 161, 164, 176, 188): eight blows landed in all, every one healed back within half a minute; four of the seven bots died at the fountain, thrown by the take-off or struck; no lasting damage came of any';
  const healingSays = n => n > 0 ? `${n} crystal${n === 1 ? '' : 's'} stand${n === 1 ? 's' : ''}: the nearest heals the dragon two a second (a point every ten ticks), so what the sword takes at the head is back in seconds; a diamond sword's blow at the head is about 7, healed in under four seconds. The crystals first is the fight a player plays` : 'no crystal stands: what the sword takes at the head stays off';
  // The hole answers the dragon's body (note 1628): two deep, the body is below the wings and the throw (the arena's drills of 2026-10-14), so the dragon within eighteen is no emergency there. 25588 (dragon-161, 2026-10-14 11:45Z) struck the perched head from its hole at (5, 60, -6), the take-off read 'dragon_charge_or_contact', the stand was cut and the next step climbed out into the open at the take-off.
  // And the fireball coming (note 1637): the hole's answer to it is the roof, and the stand cut for it left the hole open; 25588 (dragon-166, 2026-10-14 13:39Z, eight crystals broken, 41 minutes) had stay_in_hole cut by 'incoming_dragon_fireball' at 12.3 health, the ball burst in the open hole, and the cloud took it 12.3 to 0.3 to none, the three blocks up laid none.
  // Water standing within three of a cell at its level or one up (note 1653): a hole dug beside it fills from it, the roof seals the shaft, and the body drowns. 25588 (dragon-186, 2026-10-14 17:23Z, one crystal broken) poured against an enderman at (13, 62, 0), dug its hole two blocks off at (13, 60, -3), roofed it, and drowned in it, oxygen 0 for five seconds; dragon-177 (15:19Z) the same in its column. The water goes back into the bucket before the dig, enderman or no enderman; left, no hole is dug there, and a hole that fills is left at once.
  const waterNear = (cell, r = 3) => bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: r + 2, count: 16 }).some(p => Math.abs(p.x - cell.x) <= r && Math.abs(p.z - cell.z) <= r && p.y >= cell.y - 1 && p.y <= cell.y + 2);
  const dryTheHoleCell = async cell => { if (!waterNear(cell)) return true; await takeBackWaterNear({ force: true }); if (!waterNear(cell)) return true; console.log(`[end combat] no hole at ${cell}: water stands within three of it that the bucket did not take back`); return false; };
  // And while the hole is being dug (note 1647): the dig is a second, it is the answer to the dragon's coming, and the charge read at eighteen cut it; 25588 (dragon-181, 2026-10-14 16:20Z) had wait_in_hole cut so twice in a minute with the body on the rim and the hole half dug.
  // In the tunnel under the island's stone (note 1740): the dragon's charge and fireball are answered by the stone over the head, as in the hole; 25588 (dragon-292, 2026-10-15 16:35Z) had tunnel_quarry cut by 'incoming_dragon_fireball' at (-28, 59, 16) and climbed out into the open, the cloud on it, 20 to none.
  const inTunnel = () => { if (!(state.tunnelAt > Date.now() - 60000)) return false; const g = bot.entity.position.floored(); return bot.blockAt(g.offset(0, 2, 0))?.boundingBox === 'block' && bot.blockAt(g.offset(0, -1, 0))?.boundingBox === 'block'; };
  // Under the island's stone (note 1754): stone two to eight over the head is shelter from the charge and the fireball as the hole is, and the dragon does not fly through the island; 25588's dragon-20 of the new save (2026-10-16 04:08Z) had its staircase up cut by 'dragon_charge_or_contact' at (6, 22, -8) under the island, again and again.
  const underStone = () => { const g = bot.entity.position.floored(); return [2, 3, 4, 5, 6, 7, 8].some(dy => bot.blockAt(g.offset(0, dy, 0))?.boundingBox === 'block') && bot.blockAt(g.offset(0, -1, 0))?.boundingBox === 'block'; };
  const holeAnswers = () => ((holeHere() || inRecordedHole() || inTunnel() || underStone()) && ['dragon_charge_or_contact', 'incoming_dragon_fireball'].includes(endEmergency(bot))) || (state.diggingHole > Date.now() - 4000 && endEmergency(bot) === 'dragon_charge_or_contact');
  // The roof over the hole's mouth (note 1623): a fireball comes to the body and its cloud fills the hole it bursts in; 25588 (dragon-159, 2026-10-14 11:07Z) lost 16 in a hole 40 blocks from the fountain with the dragon flying, and had its stand in the hole by the fountain cut by a cloud at the feet (11:09Z, 13.6 to 11.6). With a block two over the feet the ball bursts on it and the cloud lies above; the sword wants it off, so it is laid while the dragon flies and taken off when it sits.
  const roofCell = () => bot.entity.position.floored().offset(0, 2, 0);
  const roofed = () => bot.blockAt(roofCell())?.boundingBox === 'block';
  const roofHole = async on => {
    let c = roofCell();
    if (on) {
      if (roofed()) return true;
      const name = blocksCarriedName(bot); const item = name && bot.inventory.items().find(i => i.name === name);
      if (!item || typeof bot.placeBlock !== 'function') return false;
      // Over a hole two deep the roof's cell is a block over the ground with only air beside it to set the block against (the arena's test of 2026-10-14 12:20Z: all four references air, nothing laid in dragon-161 to 163). The hole is dug a block deeper first, and the roof goes in the top dug cell against the ground beside it (note 1631); the way out is then three blocks.
      const solidBeside = p => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => bot.blockAt(p.offset(dx, 0, dz))?.boundingBox === 'block');
      if (!solidBeside(c) && actions.dig) {
        const f = bot.entity.position.floored(), under = f.offset(0, -1, 0);
        if (bot.blockAt(under)?.boundingBox === 'block' && bot.blockAt(under.offset(0, -1, 0))?.boundingBox === 'block') {
          try { await actions.dig(bot, task, under, { requireDrops: false, dropInto: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
          for (let i = 0; i < 20 && Math.floor(bot.entity.position.y) > f.y - 1; i++) await sleep(50);
          if (state.hole && state.hole.x === f.x && state.hole.z === f.z) { state.hole.y = Math.floor(bot.entity.position.y); save(); }
          c = roofCell();
        }
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ref = bot.blockAt(c.offset(dx, 0, dz)); if (ref?.boundingBox !== 'block') continue;
        try { await bot.equip(item, 'hand'); if (typeof bot.lookAt === 'function') await bot.lookAt(c.offset(.5, .5, .5), true); await bot.placeBlock(ref, new Vec3(-dx, 0, -dz)); } catch (_) { continue; }
        if (roofed()) break;
      }
      if (roofed()) { console.log(`[end combat] the hole roofed at ${c}`); await thickenRoof(c); }
      return roofed();
    }
    if (!roofed()) return true;
    try { await actions.dig(bot, task, c, { requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    return !roofed();
  };
  const outOfTheHole = async () => {
    if (!holeHere()) return true;
    // Not up into a cloud at the rim (note 1836): the body two deep is under the cloud's slab, and the climb out puts its feet in it. 25588's dragon-196 (2026-10-18 07:47Z, one crystal, full health) in its hole at (39, 59, 9) with 'clouds 0 off, 2 up' went 'up out of the hole' and died on the rim at 61 in the cloud, 14 to 9 to none. The hole is kept while a cloud lies over it, about thirty seconds.
    { const p = bot.entity.position, over = Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position.y - p.y >= 1 && e.position.y - p.y <= 4.5 && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 0.5); if (over) { if (!(state.rimCloudSaid > Date.now() - 10000)) { state.rimCloudSaid = Date.now(); console.log(`[end combat] the hole kept at ${p.floored()}: a cloud lies ${Math.round((over.position.y - p.y) * 10) / 10} over the feet at the rim, ${Math.round(cloudRadius(bot, over) * 10) / 10} wide; up out of it would be into it`); } return false; } }
    if (roofed() && actions.dig) await roofHole(false);
    const from = Math.floor(bot.entity.position.y);
    const depth = [1, 2, 3].filter(dy => bot.blockAt(bot.entity.position.floored().offset(1, dy - 1, 0))?.boundingBox === 'block' || bot.blockAt(bot.entity.position.floored().offset(-1, dy - 1, 0))?.boundingBox === 'block').length;
    try { await require('./pillar-recovery').pillarUp(bot, task, from + Math.max(2, depth), { dig: actions.dig, maxBlocks: Math.max(2, depth), threats: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    console.log(`[end combat] up out of the hole: ${Math.floor(bot.entity.position.y) - from} blocks up at ${bot.entity.position.floored()}`);
    return !holeHere();
  };
  // On the recorded column's own cell, the record alive, a block under the feet.  // On the recorded column's own cell, the record alive, a block under the feet.
  const onColumnCell = () => { const u = bot._pillarUp; if (!u || u.until < Date.now()) return false; const f = bot.entity.position.floored(); return f.x === u.x && f.z === u.z && bot.blockAt(f.offset(0, -1, 0))?.boundingBox === 'block'; };
  // The breath's cloud under the feet (note 1576): a cloud lies half a block
  // deep where the fireball burst and lasts about thirty seconds, and a body
  // two blocks up is out of it. The dig down ends in it: 25588 (dragon-119,
  // 2026-10-14 03:53Z) went two up out of the cloud at (48, 50, -27), 20 to
  // 14, was asked 'observe or pillar_down' with no word of the cloud, took
  // pillar_down at 0.55, dug back down into it and died in three seconds, 15
  // to 9 to 4 to none; dragon-116 and 123 the same by the hold's own way down.
  const cloudUnderfoot = (blocks = 3) => {
    const p = bot.entity.position;
    return Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && p.y - e.position.y >= 0.5 && p.y - e.position.y <= blocks + 0.5 && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 0.3) || null;
  };
  // A cloud within three below the feet and within its reach plus two aside (note 1648): wider than cloudUnderfoot, which asks the cloud's own radius; the stub built out of the breath stands at a cloud's edge, and the body dug down to its foot is in the breath's margin again.
  const cloudNearBelow = (blocks = 3) => { const p = bot.entity.position; return Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && p.y - e.position.y >= 0.5 && p.y - e.position.y <= blocks + 0.5 && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 2) || null; };
  // How far up clears the breath (note 1717): two from the ground's cloud, but a fireball's cloud bursts where the body is, at the feet or over them, and two up from a body dug a block under it ends in it. 25588 (dragon-259, 2026-10-15 09:48Z) had a fireball's cloud land at its feet on a short column at (35.6, 59, -21.5), dug down to 58, went '2 blocks up at (34, 59, -22)', the cloud's own height, and died there, 8.7 to 3 to none. Up to the block over the cloud's height, two at least, four at most.
  // One up where one clears it (note 1724): the cloud hurts only where its half-block slab meets the body, the feet within half a block over its y (the arena, 2026-10-15 10:15Z: a cloud a block under the feet, none in three seconds; at the feet, nine), and the ground's cloud lies at the feet's own height; one block is half the second in the cloud and half the blocks.
  const upClear = from => { const p = bot.entity.position; const ys = Object.values(bot.entities).filter(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position.y >= from - 0.6 && e.position.y <= from + 3 && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 0.5).map(e => Math.floor(e.position.y + 0.5 - from) + 1); return ys.length ? Math.min(4, Math.max(2, ...ys)) : 2; }; // Two at least (note 1781): one up where the cloud lay at the feet (note 1724) was hit again within the next lines 64 times of 146 on 25588 (44%), two up 53 of 143 (37%), three up 1 of 6; dragon-128, 129, 132, 150 and 151 (2026-10-17) died after 'up out of the breath first: 1 blocks up'.
  // The cloud on the body by its slab (notes 1724, 1732, 1733): half a block high from its y, and the body's 1.8 meeting it, within its radius.
  const cloudOnBody = () => { const p = bot.entity.position; return Object.values(bot.entities).some(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position.y > p.y - 1.8 && e.position.y <= p.y + 0.5 && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 0.3); };
  const cloudUnderfootSays = c => c ? `the breath's cloud lies ${Math.round((bot.entity.position.y - c.position.y) * 10) / 10} blocks below the feet, ${Math.round(cloudRadius(bot, c) * 10) / 10} wide: a dig down ends in it, and a cloud lasts about thirty seconds and takes six a second` : null;
  // On an obsidian pillar's top (not the bot's own column): the top is a
  // small flat place high over the island, with the bot's column at its edge.
  const onObsidianTop = () => { const f = bot.entity.position.floored(); return bot.blockAt(f.offset(0, -1, 0))?.name === 'obsidian' && !!bot._pillarUp && Math.hypot(bot._pillarUp.x + .5 - bot.entity.position.x, bot._pillarUp.z + .5 - bot.entity.position.z) <= 12; };
  // Back onto the bot's own column at a crouch: the pathfinder first, then a
  // straight walk; said in the log either way.
  const backToColumn = async () => {
    const u = bot._pillarUp; if (!u) return false;
    // The stand's walls (note 1664) between the body and the column dug first.
    if (Array.isArray(state.standWalls) && state.standWalls.length && actions.dig) {
      const f = bot.entity.position.floored(), toward = { x: Math.sign(u.x - f.x), z: Math.sign(u.z - f.z) };
      for (const w of state.standWalls) {
        if (Math.abs(w.y - f.y) > 1 || !((w.x - f.x === toward.x && w.z === f.z) || (w.z - f.z === toward.z && w.x === f.x))) continue;
        const b = bot.blockAt(new Vec3(w.x, w.y, w.z)); if (b?.boundingBox !== 'block' || /obsidian|bedrock/.test(b.name)) continue;
        try { await actions.dig(bot, task, b.position, { requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
      }
      state.standWalls = []; save();
    }
    const col = new Vec3(u.x + .5, bot.entity.position.y, u.z + .5), toCol = () => Math.hypot(col.x - bot.entity.position.x, col.z - bot.entity.position.z);
    if (toCol() < 0.2 && Math.floor(bot.entity.position.x) === u.x && Math.floor(bot.entity.position.z) === u.z) return true;
    // No pathfinder walk on an obsidian top (note 1476): crouched steps only,
    // which cannot leave an edge. 25588 (dragon-57, 2026-10-13 14:45Z, full
    // iron, crystal 94 broken on the tallest top at 103) was walked past its
    // column and off the far edge by the walk back, 42 blocks to its death.
    const underName = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))?.name || '';
    if (!/^(obsidian|bedrock|iron_bars)$/.test(underName)) {
      try { await actions.navigate(bot, task, new goals.GoalBlock(u.x, Math.floor(bot.entity.position.y), u.z), { timeoutMs: 10000, stallMs: 3000 }); }
      catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
    }
    // Centred on the column's cell (the dig is from under the feet): a stand
    // at its edge, 0.45 off, had obsidian under the feet and dug nothing
    // (the drill of 2026-10-13, 04:20Z).
    if (toCol() >= 0.2) {
      try {
        if (typeof bot.lookAt === 'function') await bot.lookAt(col.offset(0, 1.6, 0), true);
        await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'back_to_column', keys: ['forward'], sneak: true,
          why: 'back onto the bot\'s own pillar, the way down', look: col.offset(0, 1.6, 0), maxMs: 6000, tick: 50, until: () => toCol() < 0.2 });
        // The column's top a block over the obsidian (the climb overshoots by
        // one): stepped up to with a jump. The drill of 2026-10-13 (04:28Z)
        // stopped 0.7 off, against its side.
        if (toCol() >= 0.2) await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'back_to_column_up', keys: ['forward', 'jump'], sneak: false,
          why: 'up onto the column\'s top', look: col.offset(0, 1.6, 0), maxMs: 4000, tick: 50, until: () => toCol() < 0.2 });
      } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
    }
    const back = toCol() < 0.35 && Math.floor(bot.entity.position.x) === u.x && Math.floor(bot.entity.position.z) === u.z;
    console.log(`[end combat] back to the column at (${u.x}, ${u.z}): ${back ? 'there' : `not reached, ${Math.round(toCol() * 10) / 10} off`}`);
    return back;
  };
  // Down the bot's own column a block at a time from under the feet.
  // Centred on the column's cell to a tenth of a block: the body is 0.6
  // wide, and at 0.2 off toward the obsidian it still stands on its lip
  // when the block under it is dug (the drills of 2026-10-13, 04:52 and
  // 05:02Z, one dug and no drop). Short bursts of the forward key at a
  // crouch, the look set to the column's middle each time.
  // Onto a cell's middle at a crouch, the look set each pulse (note 1603): the hole's own nudges without the pause between them left the body 0.83 off, out of its cell (dragon-141 and 144, 2026-10-14).
  const centreOn = async (cx, cz, tolerance = 0.1, { maxMs = 5000 } = {}) => {
    const col = () => new Vec3(cx + .5, bot.entity.position.y, cz + .5), off = () => Math.hypot(col().x - bot.entity.position.x, col().z - bot.entity.position.z);
    const t0 = Date.now();
    for (let i = 0; i < 24 && off() > tolerance && Date.now() - t0 < maxMs; i++) {
      check();
      if (typeof bot.lookAt === 'function') await bot.lookAt(col().offset(0, 1.6, 0), true);
      bot.setControlState?.('sneak', true); bot.setControlState?.('forward', true);
      await sleep(off() > 0.4 ? 120 : 60);
      bot.setControlState?.('forward', false);
      await sleep(80);
    }
    bot.setControlState?.('sneak', false);
    return off() <= Math.max(0.15, tolerance);
  };
  const centreOnColumn = async (tolerance = 0.1, opts = {}) => { const u = bot._pillarUp; if (!u) return false; return centreOn(u.x, u.z, tolerance, opts); };
  const digDownColumn = async ({ limit = 64 } = {}) => {
    let passes = 0, aborts = 0, offCells = 0;
    const digFromY = Math.floor(bot.entity.position.y), digFromHealth = bot.health;
    // The column's blocks: what the climb lays, end stone among them (note
    // 1438): 25588 (dragon-21, 2026-10-13 08:17Z), its cobblestone gone and
    // its column laid in end stone, had the way down dig nothing at (-31, 85,
    // 26), 'end_stone under the feet', the record dropped, and stood 'only
    // observe' through 58 failed escapes, 20 to 11. On the island's own
    // ground (under 70, the cells about the feet solid) end stone is the
    // island, not the column.
    // The column's end stone told from the island's by the record's base where there is one (note 1620, as 1610 for the depth): the pocket's walls close every side, columnEnded read true, and the dig broke off at once. 25588 (dragon-157, 2026-10-14 10:40Z, five crystals broken) in its pocket at (-30, 84, 24) with the dragon beating on it logged 'down the column: 0 dug' and took six blows of the body there over 75 seconds, 20 to none.
    const base = bot._pillarUp && bot._pillarUp.until > Date.now() && bot._pillarUp.base != null ? bot._pillarUp.base : null;
    const scaffold = { test: (name, y) => SCAFFOLD_UNDER.test(name || '') && !(name === 'end_stone' && (base != null && Number.isFinite(y) ? y < base : columnEnded())) };
    // Ended where the ground is, not at a height (note 1471): the island's
    // ground runs from 36 to 60, and 25588 (dragon-53, 2026-10-13 14:03Z,
    // crystal 12 broken) had its end-stone column at 69 read as the island
    // 'under 70', the record dropped, and stood 'only observe' eleven blocks
    // up. The column has ended when no open side drops three or more.
    // By the drop alone (note 1474): the roof's post beside the column and the obsidian made two solid sides, and 25588 (dragon-55, 2026-10-13 14:28Z, crystals 9 and 67 broken) had its end-stone column at 69 read as ended, 'column undefined'.
    // The column's sides read at three depths (note 1577): the pocket's posts (note 1575) close every cell beside the feet one down, and 25588 (dragon-127, 2026-10-14 05:13Z) in its pocket with the breath at its feet had 'down the column: 0 dug', the column read as ended, and died in the cloud.
    const columnEnded = () => !openDropBeside(bot.entity.position.floored());
    let n = 0;
    // In the cloud, a body within 0.45 of the middle stands wholly on the block and is dug down at once (note 1481).
    // No dig down under water at the feet (note 1643): the water follows the body into the shaft, the roof laid against the fireball seals it, and 25588 (dragon-177, 2026-10-14 15:19Z, no crystal broken) drowned in its own column at (31, 45, -23), oxygen 0 for six seconds at the bottom, 'swim_up' with nowhere to rise to. The water goes back into the bucket first, enderman or no enderman; left, the dig is not made.
    if (inWater()) { await takeBackWaterNear({ force: true }); if (inWater()) { console.log(`[end combat] no dig down at ${bot.entity.position.floored()}: water at the feet that the bucket did not take back`); return; } }
    // Centred to 0.2 in the cloud too (note 1651): at 0.45 off the middle a body 0.6 wide hangs a quarter block over the column's edge, and when the block under it is dug it drops down the outside of the column, not into the cell. 25588 (dragon-184, 2026-10-14 17:02Z, three crystals broken) took the breath at 88, dug down, and fell from (-11, 88, -44) beside its column at (-11, -43), 11.7 to 6.6 on a ledge at 80 and to none at 61; dragon-168, 169 and 172 fell from their columns the same way after the breath.
    // In the cloud the centring gets eight tenths of a second, and a body not centred by then goes two up out of the cloud instead of digging off its middle (note 1652): the nudging ran up to five seconds in the breath, and 25588 (dragon-185, 2026-10-14 17:05Z, no crystal broken) went 20 to 2.4 on crystal 11's top at 82 between 'the breath at the feet during the hold: down the column' and the fall, the body nudged from x 34 to 36 across the cell; dragon-168, 169, 172 and 184 lost their columns the same way.
    const inCloudNow = breathThreat(bot)?.name === 'area_effect_cloud';
    const centred = await centreOnColumn(inCloudNow ? 0.2 : 0.1, { maxMs: inCloudNow ? 800 : 5000 });
    if (!centred && inCloudNow && blocksCarried(bot) >= 2) {
      const from = Math.floor(bot.entity.position.y);
      const want = upClear(from);
    try { await require('./pillar-recovery').pillarUp(bot, task, from + want, { dig: actions.dig, maxBlocks: want, threats: false, wet: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
      console.log(`[end combat] not centred in the cloud: ${Math.floor(bot.entity.position.y) - from} blocks up out of it instead at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health`);
      return;
    }
    if (!centred) console.log(`[end combat] not centred on the column before the dig: ${Math.round(Math.hypot(bot._pillarUp.x + .5 - bot.entity.position.x, bot._pillarUp.z + .5 - bot.entity.position.z) * 100) / 100} off`);
    // The feet on the column first (note 1718): the centring's step on a top beside a cage's bars lifts the body, and the dig read 'air under the feet' a block over the top and dug nothing. 25588 (dragon-254 and 260, 2026-10-15 09:23Z and 09:51Z) were 'down the column from (35, 83, -23), air under the feet ... 0 dug' on the column by crystal 92's cage at 82, and the dragon's body came to them there, both dead.
    for (let i = 0; i < 16 && bot.entity.onGround === false; i++) await sleep(50);
    console.log(`[end combat] down the column from ${bot.entity.position.floored()}, ${bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))?.name || 'nothing'} under the feet, column ${JSON.stringify(bot._pillarUp)}`);
    for (; n < limit; n++) {
      check();
      // The dragon coming is held through before the block is dug (note
      // 1448): with the breath on the column the emergency is the cloud's,
      // the pass is never said, and a blow mid-dig throws the body off a
      // column one wide. 25588 (dragon-29, 2026-10-13 09:44Z, two crystals
      // broken in five minutes) was hit digging down out of the breath at 94,
      // 15 to 10, and fell 33 to its death. The shield stops the blow and
      // its knock; the dig goes on after.
      // Not with the breath on the body (note 1453): a hold in the cloud is 6
      // a second, and 25588 (dragon-33, 2026-10-13 10:41Z, full iron, three
      // crystals broken) held crouched in it for the dragon's pass, 17 to 11
      // to 5 to none. In the cloud the dig is the way; the pass is taken.
      if (passes < 20 && dragonThreat(bot) && !breathThreat(bot)) { passes++; if (await chargeDrop()) return; const held = await holdOnColumn(); if (held === 'cloud' && state.descent?.pick === 'water_drop' && await waterDrop()) return; n--; continue; }
      // The column's own cell, and the body centred on it again each block
      // (note 1452): a body a cell off the column after a drop or a knock
      // read air under its middle, and 25588 (dragon-33, 2026-10-13 10:31Z)
      // had its way down stop '1 dug' at (-10, 81, -37) beside its column at
      // (-10, -38).
      const u = bot._pillarUp, p0 = bot.entity.position, f0 = p0.floored();
      const onCell = u && Math.hypot(u.x + .5 - p0.x, u.z + .5 - p0.z) <= 0.95 && bot.blockAt(new Vec3(u.x, f0.y - 1, u.z))?.boundingBox === 'block';
      if (onCell && (f0.x !== u.x || f0.z !== u.z)) { await centreOnColumn(); }
      const underFoot = onCell ? new Vec3(u.x, Math.floor(bot.entity.position.y) - 1, u.z) : bot.entity.position.floored().offset(0, -1, 0);
      if (!scaffold.test(bot.blockAt(underFoot)?.name || '', underFoot.y)) break;
      // A roof kept over the head on the way down (note 1455), laid again
      // when the one above is three or more over: the breath that kills on
      // the column comes with no fireball seen in flight, and the way down is
      // where the body stands longest. 25588 (dragon-35, 2026-10-13 10:59Z,
      // full iron, crystal 12 broken) had its roof at 76 and the cloud at its
      // feet at 74, 20 to 14 to 9.7 to 4.7, and was knocked off digging.
      // Every third block (note 1459): the roofs and their posts took 26 blocks of 33 on one climb and descent (dragon-39).
      // Not with the breath at the feet (note 1481): the cloud is 6 a second,
      // and the body is out of it two blocks down; the second block has to be
      // dug inside two seconds, and a roof laid first costs the second.
      // 25588 (dragon-61, 2026-10-13 15:40Z, four crystals broken) took the
      // cloud on crystal 91's column top at 85, began the way down at once,
      // and was a block down two seconds later, 20 to 14 to 8 to 2 to none.
      const inCloud = breathThreat(bot)?.name === 'area_effect_cloud';
      // Not down into the cloud (note 1576): out of it, the dig waits over it.
      // The guard kept with a cloud on the body too (note 1801): a fireball's cloud bursting on the stub's side lies a block under the feet, hurting the body and dug into at the first block, and 'in the cloud' switched the guard off. 25588's dragon-172 (2026-10-18 00:13Z, one crystal) on its stub at (-4, 64, 25) with four blocks, the first cloud at the foot three below, took pillar_down (the code's least bad after Jev's none_good) and dug 64 to 61 in eleven silent seconds, 20 to 14 to 9 to none. The cloud a block under the feet counts as at them: up out of it, not down into it.
      const cloudBelow = cloudUnderfoot(2);
      // A cloud at the feet's own height: one block up, not the dig (note 1729). The cloud's slab is half a block, and one block laid is half a second where two dug down are two and more with a stone pickaxe; 25588 (dragon-274, 2026-10-15 12:18Z) had a fireball's cloud land at its feet at (41.5, 63, -17.4) as it began 'two dug down into it' with 14 blocks carried, 'not centred ... 0.8 off', and stood there four seconds, 20 to none.
      if (inCloud && blocksCarried(bot) >= 1) {
        const p0 = bot.entity.position, atFeet = Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && Math.abs(e.position.y - p0.y) <= 0.6 && Math.hypot(p0.x - e.position.x, p0.z - e.position.z) <= cloudRadius(bot, e) + 0.3) || cloudUnderfoot(1);
        if (atFeet) {
          const from = Math.floor(p0.y), want = upClear(from);
          try { await require('./pillar-recovery').pillarUp(bot, task, from + want, { dig: actions.dig, maxBlocks: want, threats: false, wet: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
          const rose = Math.floor(bot.entity.position.y) - from;
          console.log(`[end combat] the cloud at the feet during the dig down at ${p0.floored()}: ${rose} up out of it instead, ${bot.health.toFixed(1)} health, ${blocksCarried(bot)} blocks left`);
          if (rose >= 1) break;
        }
      }
      if (cloudBelow) { console.log(`[end combat] the dig down stops at ${bot.entity.position.floored()}: ${cloudUnderfootSays(cloudBelow)}`); break; }
      if (n % 3 === 0 && !inCloud) { const fh = bot.entity.position.floored(); if (![2, 3, 4].some(dy => bot.blockAt(fh.offset(0, dy, 0))?.boundingBox === 'block')) { try { await roofOverhead(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } } }
      const yBefore = Math.floor(bot.entity.position.y);
      // A gap under the block dug is filled first (note 1434): the climb
      // beside a crystal's obsidian lays its blocks where the feet were, and
      // where the body rested on the obsidian's rim the column has none.
      // 25588 (dragon-18, 2026-10-13 07:40Z) stood at (31, 80, -23) on a
      // cobblestone at 79 with air from 78 to 73, and the dig under its feet
      // was refused ('No solid adjacent footing', the drop below unseen)
      // eleven times while the breath took it from 20 to 8 and the fall the
      // rest. The block goes in against the obsidian's side or the column's
      // own; with none to lay, a drop of three or less is taken as it is.
      const below2 = underFoot.offset(0, -1, 0);
      if (bot.blockAt(below2)?.boundingBox !== 'block') {
        const ref = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]].map(([dx, dy, dz]) => ({ b: bot.blockAt(below2.offset(dx, dy, dz)), face: new Vec3(-dx, -dy, -dz) })).find(r => r.b?.boundingBox === 'block');
        const name = blocksCarriedName(bot), item = name && bot.inventory.items().find(i => i.name === name);
        if (ref && item) {
          try {
            await bot.equip(item, 'hand'); check();
            await bot.lookAt(ref.b.position.offset(.5 + ref.face.x * .5, .5 + ref.face.y * .5, .5 + ref.face.z * .5), true);
            await bot.placeBlock(ref.b, ref.face);
          } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
          await sleep(100);
        }
        if (bot.blockAt(below2)?.boundingBox !== 'block') {
          let drop = 0; for (let dy = 1; dy <= 8 && bot.blockAt(underFoot.offset(0, -dy, 0))?.boundingBox !== 'block'; dy++) drop = dy;
          console.log(`[end combat] a gap under the column's block at ${underFoot}: ${drop >= 8 ? 'eight or more' : drop} of air under it, no block laid in it (${ref ? '' : 'nothing solid beside it, '}${item ? '' : 'none of the kinds the climb lays carried'})`);
          if (drop > 3) break;
          // A short drop, as a player takes it: the block dug from where it is stood on.
          try { await bot.dig(bot.blockAt(underFoot), true); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the way down the pillar stopped ${n} down: ${String(err.message || err).slice(0, 120)}`); break; }
          for (let i = 0; i < 30 && Math.floor(bot.entity.position.y) >= yBefore; i++) { check(); await sleep(100); }
          for (let i = 0; i < 40 && !bot.entity.onGround; i++) await sleep(50);
          continue;
        }
      }
      // The dragon's pass is held through and the dig goes on (note 1440):
      // ended at the pass, the way down was a block a question, and 25588
      // (dragon-22, 2026-10-13 08:30Z), 'pillar down stopped 1 of 33 down:
      // dragon_charge_or_contact' at 3 health, was asked again at 8 and
      // climbed, and the breath at the top took the rest.
      bot.setControlState?.('sneak', true);
      // Centred again before each block (note 1684): the body drifts between the centring and the dig, and a dig 0.42 off the middle dropped 25588 (dragon-219, 2026-10-15 00:56Z) a cell off its stub at (8, 64, -5) into the cloud two below, 20 to none; dragon-209, 211 and 212 fell from their columns on the dig down the same evening. Over 0.3 off, the body is centred to 0.2 in six tenths of a second, or the dig down ends and says so.
      { const u = bot._pillarUp; if (u) { const off = () => Math.hypot(u.x + .5 - bot.entity.position.x, u.z + .5 - bot.entity.position.z); if (off() > 0.15) { const o0 = Math.round(off() * 100) / 100; await centreOn(u.x, u.z, 0.1, { maxMs: 900 }); if (off() > 0.3) { console.log(`[end combat] the dig down at ${bot.entity.position.floored()} stops: ${Math.round(off() * 100) / 100} off the column's middle after the centring (${o0} before)`); bot.setControlState?.('sneak', false); break; } console.log(`[end combat] the dig down at ${bot.entity.position.floored()} centred from ${o0} to ${Math.round(off() * 100) / 100} off the column's middle before the block`); } } }
      try { await actions.dig(bot, task, underFoot, { dropInto: true, openPit: true, requireDrops: false }); }
      catch (err) {
        bot.setControlState?.('sneak', false);
        if (err.name === 'EndEmergency' && ['dragon_charge_or_contact'].includes(endEmergency(bot)) && passes < 20) { passes++; await holdOnColumn(); n--; continue; }
        // A dig something else stopped is dug again at once (note 1445): 25588
        // (dragon-26, 2026-10-13 09:17Z), in the breath on its column at 8
        // health, had its way down end 'Digging aborted' one block down, and
        // the next two ticks of the breath took the rest.
        if (/Digging aborted/.test(String(err.message || '')) && aborts < 3 && bot.entity.onGround !== false) { aborts++; console.log(`[end combat] the dig under the feet was stopped by something else (pathing ${bot.pathfinder?.isMoving?.() ?? '?'}, goal ${bot.pathfinder?.goal ? 'set' : 'none'}, digging ${bot.targetDigBlock?.name || 'nothing'}): dug again`); n--; continue; }
        if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the way down the pillar stopped ${n} down: ${String(err.message || err).slice(0, 120)}`); break;
      }
      // The drop comes late (the server's block update, then the fall): up to
      // three seconds for it. The drill of 2026-10-13 (05:12Z) was called
      // 'not dropped into' after one second and stood a block lower after.
      // The drop waited for on the column's cell only (note 2232): dragon-330 (25589, 2026-10-26 16:21Z) dug the block under its feet at (31, 81, -23) with a fireball's cloud at the feet under the cage's iron bars (no one up), and in the second of the dig the body drifted 1.7 blocks west off its cell onto the pillar's top with no key held, so the wait for a drop that could not come ran its three seconds in the cloud, 17 to 11 to 5 to none, and nothing was said. Off the cell the wait ends, how the body stood is said, and it is walked back to the cell for the block again (the hole, where the block went, takes it down).
      let offCell = false;
      for (let i = 0; i < 30 && Math.floor(bot.entity.position.y) >= yBefore; i++) { check(); await sleep(100); const uu = bot._pillarUp; if (uu && (Math.floor(bot.entity.position.x) !== uu.x || Math.floor(bot.entity.position.z) !== uu.z)) { offCell = true; break; } }
      if (offCell) {
        bot.setControlState?.('sneak', false);
        const uu = bot._pillarUp, p = bot.entity.position, keys = bot.controlState ? Object.keys(bot.controlState).filter(k => bot.controlState[k]) : [];
        console.log(`[end combat] the dig down at (${uu.x}, ${uu.z}) left its cell during the block: the body at ${p.floored()}, ${Math.round(Math.hypot(uu.x + .5 - p.x, uu.z + .5 - p.z) * 100) / 100} off the middle, keys ${keys.join('+') || 'none'}, controller ${bot._controller?.name || 'none'}, pathing ${bot.pathfinder?.isMoving?.() ?? '?'}, the block under the cell ${bot.blockAt(underFoot)?.name || '?'}, ${bot.health.toFixed(1)} health`);
        let back = false; if (offCells++ < 3) { try { back = await backToColumn(); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; } }
        if (back) { n--; continue; }
        break;
      }
      for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50);
      // On the island already (the column's last block on the ground): done.
      if (Math.floor(bot.entity.position.y) >= yBefore && bot.blockAt(underFoot.offset(0, -1, 0))?.boundingBox === 'block' && !scaffold.test(bot.blockAt(underFoot.offset(0, -1, 0))?.name || '', underFoot.y - 1)) { n++; break; }
      // Centred to a tenth and the fall waited for again (note 1875): the body is six tenths wide, and at 0.3 off the cell's middle it still stands on the neighbour's edge over the dug cell. 25588's dragon-225 (2026-10-18 17:41Z) at (15.18, 97.00, 42.57) over its column (15, 42), 'under: air, W-1: obsidian', 'the dug cell was not dropped into', stood on the pillar's top three minutes more and died there at four crystals.
      if (Math.floor(bot.entity.position.y) >= yBefore && bot._pillarUp) {
        const u = bot._pillarUp, o0 = Math.round(Math.hypot(u.x + .5 - bot.entity.position.x, u.z + .5 - bot.entity.position.z) * 100) / 100;
        try { await centreOn(u.x, u.z, 0.1, { maxMs: 900 }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
        for (let i = 0; i < 15 && Math.floor(bot.entity.position.y) >= yBefore; i++) { check(); await sleep(100); }
        for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50);
        if (Math.floor(bot.entity.position.y) < yBefore) console.log(`[end combat] the dug cell was dropped into after centring: ${o0} off the column's middle before, now at ${bot.entity.position.floored()}`);
      }
      if (Math.floor(bot.entity.position.y) >= yBefore) {
        {
          const q = bot.entity.position, f = q.floored();
          const cells = [[0, -1, 0, 'under'], [1, -1, 0, 'E-1'], [-1, -1, 0, 'W-1'], [0, -1, 1, 'S-1'], [0, -1, -1, 'N-1'], [1, 0, 0, 'E'], [-1, 0, 0, 'W'], [0, 0, 1, 'S'], [0, 0, -1, 'N']].map(([dx, dy, dz, k]) => `${k}:${bot.blockAt(f.offset(dx, dy, dz))?.name || '?'}`).join(' ');
          console.log(`[end combat] the way down the pillar stopped ${n} down: the dug cell was not dropped into; at (${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.z.toFixed(2)}) onGround ${bot.entity.onGround} velocity ${JSON.stringify(bot.entity.velocity)} ${cells}`); break;
        }
      }
    }
    bot.setControlState?.('sneak', false);
    // The record kept on the obsidian (note 1473): the way back to the column from the top can fail, and the record dropped there left 25588 (dragon-55, 2026-10-13 14:22Z, crystal 9 broken) 'only observe' on the top, 'column undefined'.
    { const un = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))?.name || ''; if (!scaffold.test(un, Math.floor(bot.entity.position.y) - 1) && !/^(obsidian|bedrock|iron_bars)$/.test(un)) delete bot._pillarUp; }
    console.log(`[end combat] down the column: ${n} dug, now at ${bot.entity.position.floored()}`);
    // Two under the ground at the column's foot, roofed (note 1780): the body at ground level at the end of its descent, in the column's one-wide shaft, is where the next fireball finds it, and its cloud lies in the shaft with the body. 25588's dragon-149 (2026-10-17 18:2xZ) came down 21 to (-11, 58, 37), a fireball thrown as it arrived, the hole roofed a second later, 8.5 to 2.5, dead; dragon-150 (18:4xZ) the same at the next descent's foot. With the pickaxe and end stone two deep under the feet, no void within four and no water, the body goes two down and roofs the cell over its head before anything else; from that hole the tunnel is offered.
    let holed = false;
    if (n >= 1 && actions.dig && pickCarried() && !bot._pillarUp && !inWater()) {
      const f = bot.entity.position.floored(), u1 = bot.blockAt(f.offset(0, -1, 0)), u2 = bot.blockAt(f.offset(0, -2, 0)), u3 = bot.blockAt(f.offset(0, -3, 0));
      const wetAbout = [f, f.offset(0, -1, 0), f.offset(0, -2, 0)].some(c => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([dx, dy, dz]) => /water/.test(bot.blockAt(c.offset(dx, dy, dz))?.name || '')));
      if (u1?.name === 'end_stone' && u2?.name === 'end_stone' && u3?.boundingBox === 'block' && voidEdge(bot, bot.entity.position, 4) === null && blocksCarried(bot) >= 1 && !wetAbout) {
        const t0 = Date.now(); let dug = 0;
        for (let d = 0; d < 2; d++) { const y0 = Math.floor(bot.entity.position.y), under = new Vec3(f.x, y0 - 1, f.z); if (bot.blockAt(under)?.name !== 'end_stone') break; try { await actions.dig(bot, task, under, { requireDrops: false, dropInto: true, openPit: true }); dug++; } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; break; } for (let i = 0; i < 30 && Math.floor(bot.entity.position.y) >= y0; i++) await sleep(50); for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50); }
        let roofed = false; if (dug >= 2) { try { roofed = await roofHole(true); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } }
        holed = dug >= 2 && roofed;
        if (holed) { const g = bot.entity.position.floored(); state.hole = { x: g.x, y: g.y, z: g.z, at: Date.now() }; save(); }
        console.log(`[end combat] the column's foot made a hole: ${dug} dug under the ground, ${roofed ? 'roofed' : 'not roofed'}, ${Math.round((Date.now() - t0) / 100) / 10} s, now at ${bot.entity.position.floored()}, ${blocksCarried(bot)} blocks, ${bot.health.toFixed(1)} health`);
      }
    }
    // The descent's record for the way-down question (note 1484).
    { const from = digFromY, to = Math.floor(bot.entity.position.y); (state.descents ||= []).push({ at: Date.now(), kind: 'dig', from, to, dug: n, down: from - to >= Math.min(limit, 3), fell: from - to > n + 2, lost: Math.round((digFromHealth - bot.health) * 10) / 10 }); state.descents = state.descents.slice(-20); }
    // The column's blocks lie at its foot: picked up for the next climb. The
    // drill of 2026-10-13 (04:26 to 04:56Z) built four columns and had 16 of
    // its 128 blocks left, none picked up.
    if (n >= 3 && !holed) {
      const material = blocksCarriedName(bot) || 'cobblestone';
      try { await require('./drop-collection').collectNearbyDrops(bot, task, material, { radius: 6, timeoutMs: 5000, waitForSpawnMs: 500, move: actions.navigate }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
    }
    return n;
  };
  // A block over the head on the column, against a solid beside the cell
  // over it (the crystal's obsidian) or, failing that, nothing: true when
  // the cell over the head is solid after.
  // The pocket against the dragon's wings (note 1575): the death ledger of
  // 2026-10-14 (44 dragon runs) puts the body carried off its column by the
  // dragon first, 10 of 43 deaths (dragon-104, 107, 112, 114, 120, 121 among
  // them): in the game's code the wings' boxes, grown four blocks each way,
  // push every living thing in them 4 / d² sideways and 0.2 up a tick and
  // hurt it 5, and a shield does nothing to the push. On the arena (the pass
  // drill, scripts/pass-drill.js) the body in open air was carried 38 to 52
  // blocks in four passes of four; walls a block high held two of four (the
  // lift took it over); two-high walls under the hold's roof held three of
  // five, the two lost to the dragon's own body passing through the cell.
  // Two blocks on each open side of the body, the side away from the dragon
  // first (the push is away from its body), each side a post from the block
  // under the feet where nothing stands beside. Said in the log.
  const pocketOnColumn = async ({ allSides = false } = {}) => {
    // Built round the column's cell, the body centred on it first (note 1655): built round the body's own cell, with the body a step off the column at the top the cell under it was air, no block had a face to be set against, and 48 of 72 pockets of 2026-10-14's runs 160 to 190 laid nothing ('0 blocks laid, 1 of 4 sides closed, 1 ms'); dragon-169, 178, 184, 187 and 190 were then beaten off their column tops, five of the afternoon's eight carries.
    const u = bot._pillarUp && bot._pillarUp.until > Date.now() ? bot._pillarUp : null;
    if (u && Math.hypot(u.x + .5 - bot.entity.position.x, u.z + .5 - bot.entity.position.z) <= 1.5 && bot.blockAt(new Vec3(u.x, Math.floor(bot.entity.position.y) - 1, u.z))?.boundingBox === 'block') await centreOnColumn(0.2, { maxMs: 600 });
    const f = u && Math.hypot(u.x + .5 - bot.entity.position.x, u.z + .5 - bot.entity.position.z) <= 0.95 ? new Vec3(u.x, Math.floor(bot.entity.position.y), u.z) : bot.entity.position.floored();
    const under = bot.blockAt(f.offset(0, -1, 0)); if (under?.boundingBox !== 'block') { console.log(`[end combat] no pocket at ${f}: ${under?.name || 'nothing'} under the cell`); return { laid: 0, closed: 0 }; }
    const name = blocksCarriedName(bot); let item = name && bot.inventory.items().find(i => i.name === name);
    if (!item) return { laid: 0, closed: 0 };
    const d = dragonThreat(bot) || Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
    const away = d ? { x: bot.entity.position.x - d.position.x, z: bot.entity.position.z - d.position.z } : null;
    // The pool's side left open (note 1601): the drop is the pocket's one fast
    // way out, and a wall there is two blocks to dig in the breath. 25588
    // (dragon-142, 2026-10-14 08:17Z, two crystals broken) had its pool south
    // of crystal 12's column, the pocket walled all four sides, took the
    // breath on the top after the blow, 'the breath in the pocket: two down
    // out of it before the drop's wall is dug', and died in three seconds at
    // 82 with a bucket in hand and the pool below. The push is away from the
    // dragon's body; a body pushed out the pool's side comes down in the pool.
    // The pool's side left open only when it is not the push's way (note 1630): the wings shove the body away from the dragon, and a body shoved out the open side is carried. 25588 (dragon-162, 2026-10-14 11:52Z, two crystals broken) stood in its pocket at (-32, 83, 28), three sides closed and the pool's open, and was pushed out of it and carried 80 blocks to y 105, dead on the fall. The side within 60 degrees of the push's way is closed, pool or not.
    let poolSide = !allSides && state.pool && Date.now() - state.pool.at < 15 * 60000 ? [state.pool.dx, state.pool.dz] : null;
    if (poolSide && away) { const len = Math.hypot(away.x, away.z) || 1; if ((poolSide[0] * away.x + poolSide[1] * away.z) / len > 0.5) poolSide = null; }
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !poolSide || dx !== poolSide[0] || dz !== poolSide[1]).sort((a, b) => away ? (b[0] * away.x + b[1] * away.z) - (a[0] * away.x + a[1] * away.z) : 0);
    let laid = 0;
    for (const [dx, dz] of sides) {
      // From the lowest open cell up: the post beside the under block, then the two beside the body.
      for (let dy = -1; dy <= 1; dy++) {
        const c = f.offset(dx, dy, dz);
        if (bot.blockAt(c)?.boundingBox === 'block') continue;
        if (dy === -1 && bot.blockAt(c.offset(0, 1, 0))?.boundingBox === 'block') continue;
        const below = bot.blockAt(c.offset(0, -1, 0)), beside = bot.blockAt(c.offset(-dx, 0, -dz));
        let ref = null, face = null;
        if (below?.boundingBox === 'block') { ref = below; face = new Vec3(0, 1, 0); }
        else if (beside?.boundingBox === 'block') { ref = beside; face = new Vec3(dx, 0, dz); }
        else break;
        item = bot.inventory.items().find(i => i.name === name); if (!item) break;
        try { check(); await bot.equip(item, 'hand'); await bot.lookAt(ref.position.offset(.5 + face.x * .5, .5 + face.y * .5, .5 + face.z * .5), true); await bot.placeBlock(ref, face); await sleep(40); }
        catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; break; }
        if (bot.blockAt(c)?.boundingBox === 'block') laid++; else break;
      }
    }
    const closed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(f.offset(dx, 0, dz))?.boundingBox === 'block' && bot.blockAt(f.offset(dx, 1, dz))?.boundingBox === 'block').length;
    return { laid, closed, poolSideOpen: !!poolSide };
  };
  // The roof made two thick (note 1878): a cloud reaches three blocks (note 1877), and the fireball bursting on a roof a block thick leaves its cloud three over the feet, on the body. 25588's dragon-226 (2026-10-18 17:58Z) took 20 to 14 to 2 in its roofed hole at (39, 55, -34); the drills of 2026-10-17 found a two-thick roof keeps the cloud out. The second block goes on the first's top face from below, one block more a roof.
  const thickenRoof = async cell => {
    try {
      const first = bot.blockAt(cell), above = cell.offset(0, 1, 0);
      if (first?.boundingBox !== 'block' || bot.blockAt(above)?.boundingBox === 'block' || /bedrock|obsidian/.test(first.name)) return bot.blockAt(above)?.boundingBox === 'block';
      const name = blocksCarriedName(bot), item = name && bot.inventory.items().find(i => i.name === name);
      if (!item || blocksCarried(bot) < 2) return false;
      await bot.equip(item, 'hand'); check();
      await bot.lookAt(first.position.offset(.5, 1, .5), true); await bot.placeBlock(first, new Vec3(0, 1, 0)); await sleep(60);
      const thick = bot.blockAt(above)?.boundingBox === 'block';
      if (!(state.thickRoofSaid > Date.now() - 10000)) { state.thickRoofSaid = Date.now(); console.log(`[end combat] the roof at ${cell} made two thick: ${thick ? 'the second block laid above it' : 'the second block not laid'}`); }
      return thick;
    } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; return false; }
  };
  const roofOverhead = async () => {
    const f = bot.entity.position.floored(), cell = f.offset(0, 2, 0);
    if (bot.blockAt(cell)?.boundingBox === 'block') return true;
    let ref = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].map(([dx, dy, dz]) => ({ b: bot.blockAt(cell.offset(dx, dy, dz)), face: new Vec3(-dx, -dy, -dz) })).find(r => r.b?.boundingBox === 'block');
    const name = blocksCarriedName(bot), item = name && bot.inventory.items().find(i => i.name === name);
    if (!item) return false;
    // Nothing beside the cell over the head (the column at a corner of the
    // obsidian, or alone): a post is laid up the column's own side (note
    // 1454), from the block under the feet to the cell beside the roof's,
    // four blocks, and the roof against it. Half the roofs asked for today
    // were 'not laid' for want of a block beside: 25588 (dragon-34,
    // 2026-10-13 10:53Z, full iron, three crystals in five minutes) took 14
    // of the breath on its climb to crystal 109 and died on the way down.
    if (!ref) {
      const under = bot.blockAt(f.offset(0, -1, 0));
      if (under?.boundingBox !== 'block') return false;
      // Not on the pool's side (note 1556): the post stood where the drop goes, and 25588 (dragon-105, 2026-10-14 01:23Z, two crystals broken) read 'east: end_stone/end_stone beside' over its pool east of the column at (-10, -38), dropped south with no pool, 26 blocks, dead.
      const poolSide = state.pool && Date.now() - state.pool.at < 15 * 60000 ? [state.pool.dx, state.pool.dz] : null;
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !poolSide || dx !== poolSide[0] || dz !== poolSide[1]).find(([dx, dz]) => [-1, 0, 1, 2].every(dy => bot.blockAt(f.offset(dx, dy, dz))?.boundingBox !== 'block'));
      // The post on the pocket's own wall (note 1811): in a pocket closed at the feet and the head no side is open from the ground up, the post found no place, and the roof was 'not laid, 0 ms', the pocket open at the top. 25588's dragon-179 (2026-10-18 01:37Z, one crystal, 95 end stone) sat in its end stone pocket at (35, 77, 22), '4 of 4 sides closed', was hit through the open top, 20 to 13.9, and flung 34 blocks to (69, 57, 45), dead. One block on a wall's top, then the roof against it.
      if (!side) {
        const wall = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => bot.blockAt(f.offset(dx, 1, dz))?.boundingBox === 'block' && bot.blockAt(f.offset(dx, 2, dz))?.boundingBox !== 'block' && bot.blockAt(f.offset(dx, 3, dz))?.boundingBox !== 'block');
        if (!wall) return false;
        try {
          const top = bot.blockAt(f.offset(wall[0], 1, wall[1]));
          await bot.equip(item, 'hand'); check();
          await bot.lookAt(top.position.offset(.5, 1, .5), true); await bot.placeBlock(top, new Vec3(0, 1, 0)); await sleep(60);
          const post = bot.blockAt(f.offset(wall[0], 2, wall[1]));
          if (post?.boundingBox === 'block') { check(); await bot.lookAt(post.position.offset(.5 - wall[0] * .5, .5, .5 - wall[1] * .5), true); await bot.placeBlock(post, new Vec3(-wall[0], 0, -wall[1])); await sleep(60); }
        } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; if (!(state.roofWallSaid > Date.now() - 10000)) { state.roofWallSaid = Date.now(); console.log(`[end combat] the roof's post on the wall at ${f.offset(wall[0], 2, wall[1])} failed: ${String(err.message || err).slice(0, 100)}`); } }
        const laid = bot.blockAt(cell)?.boundingBox === 'block';
        if (!laid && !(state.roofWallSaid > Date.now() - 10000)) { state.roofWallSaid = Date.now(); console.log(`[end combat] the roof over the head at ${cell} not laid from the wall's post at ${f.offset(wall[0], 2, wall[1])}: post ${bot.blockAt(f.offset(wall[0], 2, wall[1]))?.name || 'nothing'}, ${item.name} in hand`); }
        return laid;
      }
      try {
        await bot.equip(item, 'hand'); check();
        // The first against the under block's side, the rest each on the one below.
        await bot.lookAt(under.position.offset(.5 + side[0] * .5, .5, .5 + side[1] * .5), true); await bot.placeBlock(under, new Vec3(side[0], 0, side[1])); await sleep(60);
        for (let dy = 0; dy <= 2; dy++) {
          const below = bot.blockAt(f.offset(side[0], dy - 1, side[1])); if (below?.boundingBox !== 'block') break;
          check(); await bot.lookAt(below.position.offset(.5, 1, .5), true); await bot.placeBlock(below, new Vec3(0, 1, 0)); await sleep(60);
        }
      } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
      const post = bot.blockAt(cell.offset(side[0], 0, side[1]));
      if (post?.boundingBox !== 'block') { console.log(`[end combat] no post for a roof over the head at ${cell}: ${post?.name || 'nothing'} where its top should be`); return false; }
      ref = { b: post, face: new Vec3(-side[0], 0, -side[1]) };
    }
    try {
      await bot.equip(item, 'hand'); check();
      await bot.lookAt(ref.b.position.offset(.5 + ref.face.x * .5, .5 + ref.face.y * .5, .5 + ref.face.z * .5), true);
      await bot.placeBlock(ref.b, ref.face);
    } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    const roofed = bot.blockAt(cell)?.boundingBox === 'block';
    console.log(`[end combat] a roof against the fireball over the head at ${cell}: ${roofed ? 'laid' : 'not laid'}`);
    if (roofed) await thickenRoof(cell);
    return roofed;
  };
  // The way down the column by the water bucket (note 1484): off the column's
  // edge onto the island by its foot, the water under the body in the last
  // blocks of the fall (fall-recovery.js), the bucket filled again from the
  // pool. The dig down is a block a second and a half, 15 to 20 of them,
  // and every blow of the breath on a column one wide knocks the body 0.4
  // away from the dragon and lifts it: 25588 fell off its column in the
  // breath five times on 2026-10-13 (dragon-59, 61, 62, 63, 64), three to
  // its death, two blows enough each time. The side stepped off: the one
  // with ground soonest under it and nothing solid beside the feet.
  // The pool poured at the column's foot before the climb (note 1509), where
  // the drop lands: the pour in the air is a tick's work at a block and a
  // half a tick, and a tick late it is nothing. 25588 (dragon-77, 2026-10-13
  // 19:41Z) landed 'in the water' at 2 health, the water a tick behind the
  // body; dragon-71, 73, 74, 75 and 76 landed dry or died, one drop in four.
  // A source on level ground spreads seven blocks round, and any water under
  // the feet, flowing or still, ends the fall. Poured on a cell beside the
  // column's base away from the obsidian, with the ground about it level
  // (nothing two lower within four) and no void within eight; taken back
  // after the landing (note 1495). The side it lies on is the drop's.
  // The cell the drop's pool would be poured on beside a column base, or null (note 1539: read for the climb's option as well as the pour).
  const poolCellFor = (base, lift = 20) => {
    const column = base;
    const ground = (x, z) => { for (let y = base.y + 1; y >= base.y - 3; y--) if (bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block') return y; return null; };
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = column.x + dx, z = column.z + dz, g = ground(x, z); if (g === null || Math.abs(g + 1 - base.y) > 1) continue;
      // Out along the side by the fall's length (note 1530): the body steps off at a walk and keeps its way in the air, about a block out for every eight of fall, and 25588 (dragon-88, 2026-10-13 22:24Z, five crystals broken) fell 33 from (-29, 94, -25) and landed five blocks past its pool poured two out, dead. The furthest level cell out to that distance, one at the least.
      const want = Math.max(1, Math.min(5, Math.round(lift / 8)));
      let cell = new Vec3(x, g + 1, z);
      // A block standing one up in the row is dug down first (note 1536): the
      // water does not pass it, and the body comes down beyond it. 25588
      // (dragon-92, 2026-10-13 23:23Z, six crystals broken) had its pool at
      // (-27, 61, -25), two out east of its column at (-29, -25), the row's
      // third cell (-26, 61, -25) end stone a block up; the water ran round it,
      // not over it, and the body fell 33 onto that one dry block, 20 to none.
      const raised = [];
      for (let k = 1; k <= want + 1; k++) {
        const cx = x + dx * k, cz = z + dz * k, gk = ground(cx, cz);
        if (gk === g + 1 && bot.blockAt(new Vec3(cx, gk, cz))?.name === 'end_stone' && actions.dig && raised.length < 3) { raised.push(new Vec3(cx, gk, cz)); if (k <= want) cell = new Vec3(cx, g + 1, cz); continue; }
        if (gk === null || gk !== g || bot.blockAt(new Vec3(cx, g + 1, cz))?.name !== 'air') break;
        if (k <= want) cell = new Vec3(cx, g + 1, cz);
      }
      if (bot.blockAt(cell)?.name !== 'air' && !raised.some(r => r.equals(cell))) continue;
      // The void three away, not eight, and level ground two about, not four,
      // where the trench holds the water (note 1555): nothing runs off. The
      // eight was the open pour's, whose spread ran seven cells to the rim and
      // over; and at the island's eastern rim pillars (9, 11, 12, 14 of this
      // world) it left every climb with no pool, the clutch alone for the way
      // down, and 25588 died on that drop six times on 2026-10-13/14
      // (dragon-84, 90, 93, 104 among them).
      const clear = actions.dig ? 3 : 8, about = actions.dig ? 2 : 4;
      if (voidEdge(bot, cell.offset(.5, 0, .5), clear) !== null) continue;
      let level = true, obsidian = 0;
      for (let ox = -about; ox <= about && level; ox++) for (let oz = -about; oz <= about && level; oz++) { const gg = ground(x + ox, z + oz); if (gg === null || gg < g - 1) level = false; }
      if (!level) continue;
      for (let k = 1; k <= 3; k++) for (let dy = -1; dy <= 3; dy++) if (bot.blockAt(new Vec3(x + dx * k, g + dy, z + dz * k))?.name === 'obsidian') obsidian++;
      const score = obsidian * 10 + raised.length * 2 + bot.entity.position.distanceTo(cell.offset(.5, 0, .5));
      if (!best || score < best.score) best = { cell, dx, dz, score, obsidian, raised };
    }
    return best;
  };
  const poolForTheDrop = async (column, lift = 20) => {
    let water = bot.inventory.items().find(i => i.name === 'water_bucket');
    if (!water) return null;
    // The last full bucket kept for the landing (note 1819): three pools poured at three columns left none, and 25588's dragon-188 (2026-10-18 03:48Z, three crystals in sixteen minutes at full health) was flung off its column top at 93 by the dragon's body at 12 health, 'falling ... with no water bucket to clutch with', dead. A pool is poured with two or more carried.
    // The last bucket goes into the pool for a tall climb (note 1849): kept in the pack it saved nothing when 25588's dragon-209 (2026-10-18 12:30Z, two crystals) dug down forty blocks from 97 under the dragon's body, 20 to 11 to 7.6 to none at 92; a pool at the foot makes the way down two seconds instead of sixty, and catches a straight knock-off as well. Under twenty the bucket stays kept, as note 1819 had it.
    if (countOf(bot, 'water_bucket') < 2 && lift < 20) { if (!(state.lastBucketKeptSaid > Date.now() - 20000)) { state.lastBucketKeptSaid = Date.now(); console.log(`[end combat] no pool for the drop at the foot of (${column.x}, ${column.z}): the one full bucket carried is kept for the landing after a knock off the column (the climb ${lift} short of twenty)`); } return null; }
    if (countOf(bot, 'water_bucket') < 2) console.log(`[end combat] the one full bucket carried goes into the pool at the foot of (${column.x}, ${column.z}): the climb is ${lift}, the way down by the dig a minute under the dragon's body, by the drop two seconds`);
    // The pool judged from the island's surface, not the body's own level (note 1846): the climb begins in the foot hole a tunnel arrives in, two under the surface, and every side cell read 'not level' from there; 25588 refused pools at (35, 22), (-9, -40), (36, 24), (33, -22), (-11, 37) and (-30, 24) through the night of 2026-10-18, main-island pillars with level ground around, and every descent there was 25 to 40 blocks dug under the dragon's body. The surface is the highest solid beside the base within three of the body, obsidian and bedrock aside.
    // The lowest open cell over solid ground beside the base, within four over the body (note 1848): note 1846's highest solid took a leftover ring block for the surface, 'the surface read at 51, the body at 47' with the body on the open ground (25588's dragon-209, 2026-10-18 12:22Z). On open ground this is the body's own level; in a hole or a tunnel, its rim.
    // From the column's base when the climb resumes part-way up (note 1873): the body's own level is then the column's, and the sixteen up (note 1862) take the walls of the earlier climb for the surface; 25588's dragon-225 (2026-10-18 17:33Z) at (12, 62, 44) on its column over a base at 57 read 'the surface at 68, the body at 62' and the pool was refused. The base is the feet's level when the column's first block went down, the ground the body stood on; the read runs four either way of it.
    // The sides read two cells out from the column, not one (note 1866): one out is the walled climb's own ring, solid on every side up to wherever the climb was cut, and 25588's dragon-221 (2026-10-18 16:20Z) in its shaft at (-9, 64, -40) read 'the surface at 76, the body at 64' against ground at 68, the pool refused. Two out is past the ring: the island's ground, or the air over the void.
    // The sides read sixteen up, not four (note 1862): a tunnel's foot hole lies well under the island where the ground rises toward a pillar, and 25588's dragon-220 (2026-10-18 15:36Z) stood at 45 under ground at 57 around (35, 21); the read capped at 50 found no level cell, and the pool was refused with the island's level ground a few blocks over. The lowest of four sides still puts a leftover ring block aside.
    // The lowest of the sides' tops (note 1860, after 1846 and 1848): one leftover block beside the base raised the read to 61 against an island at 57 around (35, 22), 25588's dragon-218 (2026-10-18 15:10Z), and the pool was refused once more. Each side's top is its highest solid within four either way of the body, obsidian and bedrock aside; the surface is the lowest of them.
    const surfaceY = (() => { const y0 = Math.floor(bot.entity.position.y); const u = bot._pillarUp; const fromBase = onOwnPillar() && u && u.base != null && u.until > Date.now(); const yTop = fromBase ? u.base + 4 : y0 + 16, yBottom = (fromBase ? u.base : y0) - 4; for (const d of [2, 1]) { const ys = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => { for (let y = yTop; y >= yBottom; y--) { const b = bot.blockAt(new Vec3(column.x + d * dx, y, column.z + d * dz)); if (b?.boundingBox === 'block' && !/obsidian|bedrock/.test(b.name)) return y + 1; } return null; }).filter(y => y != null); if (ys.length) return Math.min(...ys); } return y0; })();
    const best = poolCellFor(new Vec3(column.x, surfaceY, column.z), lift);
    if (!best) { (state.noPoolAt ||= {})[`${column.x},${column.z}`] = Date.now(); console.log(`[end combat] no pool for the drop at the foot of (${column.x}, ${column.z}): no level cell beside the column's base clear of the void (the surface read at ${surfaceY}, the body at ${Math.floor(bot.entity.position.y)})`); return null; }
    for (const r of best.raised || []) {
      try {
        if (bot.entity.position.offset(0, 1.62, 0).distanceTo(r.offset(.5, .5, .5)) > 4.3) await actions.navigate(bot, task, new goals.GoalNear(r.x, r.y, r.z, 2), { timeoutMs: 6000, stallMs: 3000 });
        await actions.dig(bot, task, r, { requireDrops: false });
        console.log(`[end combat] the pool's row levelled: the block a step up at ${r} dug`);
      } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the pool's row not levelled at ${r}: ${String(err.message || err).slice(0, 80)}`); }
    }
    // The row dug one deep into a trench before the pour, the water poured in
    // its middle (note 1540): on open ground the water runs only toward the
    // nearest drop within four blocks, and 25588 (dragon-94, 2026-10-13
    // 23:44Z, two crystals broken) had its pool at (-6, 61, -42), four out
    // east of its column at (-10, -42), flow east alone; the two cells between
    // the column and the pour stayed dry and the body fell 27 onto (-8, 61,
    // -42), 20 to none. In a trench the water is the lowest thing about and
    // fills it end to end.
    if (actions.dig) {
      const g = best.cell.y - 1, len = Math.min(5, Math.max(2, Math.round(lift / 8) + 1)), trench = [];
      for (let k = 1; k <= len; k++) {
        const floor = new Vec3(column.x + best.dx * k, g, column.z + best.dz * k);
        if (bot.blockAt(floor)?.name !== 'end_stone' || bot.blockAt(floor.offset(0, -1, 0))?.boundingBox !== 'block' || bot.blockAt(floor.offset(0, 1, 0))?.boundingBox === 'block') break;
        trench.push(floor);
      }
      let dug = 0;
      for (const t of trench) {
        try {
          if (bot.entity.position.offset(0, 1.62, 0).distanceTo(t.offset(.5, .5, .5)) > 4.3) await actions.navigate(bot, task, new goals.GoalNear(t.x, t.y + 1, t.z, 2), { timeoutMs: 6000, stallMs: 3000 });
          await actions.dig(bot, task, t, { requireDrops: false }); dug++;
        } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the pool's trench stopped at ${t}: ${String(err.message || err).slice(0, 80)}`); break; }
      }
      // Three wide (note 1553), not one: a body 0.6 wide comes down anywhere in
      // its cell, and over a trench one wide its box straddles the rim and it
      // stands on the rim's stone with the water below its feet. 25588
      // (dragon-101, 2026-10-14 00:59Z, and dragon-102, 01:06Z) each came down
      // on the third cell of a trench whose four cells were all water, at
      // x -10.82 over the cell -11 to -10, and died at the rim's height, the
      // clutch holding its click for the water it saw below.
      let sides = 0;
      for (const t of trench.slice(0, dug)) for (const [sx, sz] of [[best.dz, best.dx], [-best.dz, -best.dx]]) {
        const c = t.offset(sx, 0, sz);
        if (bot.blockAt(c)?.name !== 'end_stone' || bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block' || bot.blockAt(c.offset(0, 1, 0))?.boundingBox === 'block') continue;
        try {
          if (bot.entity.position.offset(0, 1.62, 0).distanceTo(c.offset(.5, .5, .5)) > 4.3) await actions.navigate(bot, task, new goals.GoalNear(c.x, c.y + 1, c.z, 2), { timeoutMs: 6000, stallMs: 3000 });
          await actions.dig(bot, task, c, { requireDrops: false }); sides++;
        } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the pool's trench side not dug at ${c}: ${String(err.message || err).slice(0, 80)}`); }
      }
      if (sides) console.log(`[end combat] the pool's trench widened: ${sides} side cells dug`);
      // Every cell of the row read back (note 1594): a dig that came to nothing
      // left (30, 58, -28) solid in a row of four, 'the pool's trench dug: 4
      // cells', and 25588 (dragon-138, 2026-10-14 07:27Z, four crystals
      // broken) came down from 82 on exactly that cell, 20 to none. A cell
      // still solid is dug once more; one still solid after that ends the row there.
      for (let i = 0; i < dug; i++) {
        const t = trench[i];
        if (bot.blockAt(t)?.boundingBox !== 'block') continue;
        try { check(); await actions.dig(bot, task, t, { requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
        if (bot.blockAt(t)?.boundingBox === 'block') { console.log(`[end combat] the pool's trench cell ${t} stayed solid after two digs: the row ends before it`); dug = i; break; }
        console.log(`[end combat] the pool's trench cell ${t} was still solid and is dug now`);
      }
      // The fall's way over the row cleared (note 1599): a block standing one to
      // three over the trench's floor along the row is 'in the fall's way'
      // (note 1543) and the pool's side is set aside for it. 25588 (dragon-141,
      // 2026-10-14 08:05Z, three crystals broken) poured its pool north of
      // crystal 117's column, had 'end_stone in the fall's way at (-36, 61,
      // 19), 1 over the floor', took the west side with no pool and no bucket
      // left, and dug 24 blocks down the column.
      let cleared = 0;
      for (const t of trench.slice(0, dug)) for (let dy = 1; dy <= 3; dy++) {
        const c = t.offset(0, dy, 0), b = bot.blockAt(c);
        if (b?.boundingBox !== 'block' || /obsidian|bedrock/.test(b.name)) continue;
        try { check(); if (bot.entity.position.offset(0, 1.62, 0).distanceTo(c.offset(.5, .5, .5)) > 4.3) await actions.navigate(bot, task, new goals.GoalNear(c.x, c.y, c.z, 2), { timeoutMs: 6000, stallMs: 3000 }); await actions.dig(bot, task, c, { requireDrops: false }); cleared++; }
        catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
      }
      if (cleared) console.log(`[end combat] the fall's way over the pool's row cleared: ${cleared} block${cleared === 1 ? '' : 's'} dug`);
      // A floor under every cell of the row (note 1602): the quarry's pits run under the rows, a pour into a cell with no floor goes a block lower and the row stays dry. 25588 (dragon-143, 2026-10-14 08:24Z, four crystals broken) had its water go in '1 below the row at 60', the pour again went astray, and climbed with no bucket and no pool, dead at 94.
      let floored = 0;
      for (const t of trench.slice(0, dug)) {
        const under = t.offset(0, -1, 0); if (bot.blockAt(under)?.boundingBox === 'block') continue;
        const name = blocksCarriedName(bot), item = name && bot.inventory.items().find(i => i.name === name); if (!item) break;
        const ref = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(([dx, dy, dz]) => ({ b: bot.blockAt(under.offset(dx, dy, dz)), face: new Vec3(-dx, -dy, -dz) })).find(r => r.b?.boundingBox === 'block');
        if (!ref) continue;
        try { check(); await bot.equip(item, 'hand'); await bot.lookAt(ref.b.position.offset(.5 + ref.face.x * .5, .5 + ref.face.y * .5, .5 + ref.face.z * .5), true); await bot.placeBlock(ref.b, ref.face); await sleep(60); if (bot.blockAt(under)?.boundingBox === 'block') floored++; }
        catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
      }
      if (floored) console.log(`[end combat] the pool's row floored: ${floored} block${floored === 1 ? '' : 's'} laid under it`);
      // The source where the body comes down (note 1642): a fall carries the body about a cell out for every twelve of fall plus one (note 1605), and the source poured in the trench's middle left the landing cell with the row's thin flow, where 25588 came down 'dry' (dragon-175, 2026-10-14 15:00Z: the source at the second cell, the landing at the third from 20 up, 20 to 20 by luck; dragon-171 and 174, 7 dry landings of 8 and of 9). The source goes in the carry's cell, the flow either side of it.
      if (dug >= 2) { const carry = Math.max(1, Math.round(1 + lift / 12)); best.cell = trench[Math.min(dug - 1, carry - 1)].clone(); best.reach = dug; console.log(`[end combat] the pool's trench dug: ${dug} cells from ${trench[0]} out from the column at (${column.x}, ${column.z}); the water goes in at ${best.cell}${dug < len ? ` (${len} wanted: the row ends there)` : ''}`); }
    }
    // Up to the row's level before the pour (note 1864): poured from a pit three under the row the water goes in at the feet, and 25588's dragon-220 (2026-10-18 15:50Z) at (9, 52, 36) poured twice for the row at 55, 'the water went in at the feet', 'the second pour went in at (8, 53, 36) too, below the row', then 'stopped before the first block: water at the feet' six times and the climb of 45 was given up with no block laid. The body pillars up to the row's height on the blocks carried first.
    if (Math.floor(bot.entity.position.y) < best.cell.y && !inWater() && bot.entity.onGround && blocksCarried(bot) >= 3) {
      const from = Math.floor(bot.entity.position.y);
      try { await require('./pillar-recovery').pillarUp(bot, task, best.cell.y, { dig: actions.dig, maxBlocks: best.cell.y - from, threats: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
      console.log(`[end combat] up to the pool's row before the pour: ${Math.floor(bot.entity.position.y) - from} blocks up at ${bot.entity.position.floored()} for the row at ${best.cell.y}`);
    }
    const eye = bot.entity.position.offset(0, 1.62, 0), target = best.cell.offset(.5, -.01, .5);
    if (eye.distanceTo(target) > 4.3) {
      try { await actions.navigate(bot, task, new goals.GoalNear(best.cell.x, best.cell.y, best.cell.z, 2), { timeoutMs: 8000, stallMs: 3000 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
    }
    // The look given three ticks to reach the server before the click (note 1593): clicked on the heels of lookAt the server still has the old look, and the water goes in at the feet. 'The water went in at ... not at' (note 1574) said so nine times in runs 120 to 138 of 2026-10-14; at 07:21Z (dragon-138) it went in at the column's own foot cell and the climb buried it, 'no pool' at the top. A source in the bot's own cell is taken back and poured once more.
    const pourOnce = async () => {
      await bot.equip(water, 'hand'); check();
      await bot.lookAt(target, true); await sleep(150);
      bot.activateItem();
      for (let n = 0; n < 20; n++) { check(); if (bot.blockAt(best.cell)?.name === 'water') break; await sleep(50); }
    };
    try {
      await pourOnce();
      const feetCell = bot.entity.position.floored();
      if (bot.blockAt(best.cell)?.name !== 'water' && bot.blockAt(feetCell)?.name === 'water' && !feetCell.equals(best.cell)) {
        // Not poured again from a pit (note 1794): the second pour went in at the feet too, and 25588's dragon-162 (2026-10-17 22:09Z, four crystals, 267 blocks) drowned in its roofed foot hole at (7, 59, -36) with the head cell refilling, 'air in the End ... the head still under, 18.9 s'.
        const sidesNow = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(feetCell.offset(dx, 0, dz))?.boundingBox === 'block').length;
        console.log(`[end combat] the water went in at the feet ${feetCell}, not at ${best.cell}: taken back${sidesNow >= 2 ? ` and not poured again (the body in a pit, ${sidesNow} of 4 sides closed)` : ' and poured again'}`);
        try { await require('./water').fillWaterBucket(bot, task, feetCell, { timeoutMs: 1500 }); } catch (_) { /* left */ }
        if (/water/.test(bot.blockAt(feetCell)?.name || '')) { try { await require('./water').fillWaterBucket(bot, task, feetCell, { timeoutMs: 1500 }); } catch (_) { /* left */ } }
        water = bot.inventory.items().find(i => i.name === 'water_bucket');
        if (water && sidesNow < 2 && !/water/.test(bot.blockAt(feetCell)?.name || '')) await pourOnce();
      }
    } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
    // The pool is where the source went in, not where the flow reached (note
    // 1574): the click put the water at the feet, it ran down into the trench,
    // 'poured' was read off the flow at the trench's cell, and the step's
    // start took the source back from the feet as water left over. 25588
    // (dragon-121, 2026-10-14 04:17Z, crystal 109) poured at (34, 57, -22),
    // took back (33, 59, -22) a moment later, and climbed with 'no pool'.
    const { sourceWater: isSource } = require('./water');
    const rowY = best.cell.y;
    let poured = bot.blockAt(best.cell)?.name === 'water' && isSource(bot.blockAt(best.cell));
    if (!poured) {
      // At the trench's level or above only (note 1600): water runs down, not up, and a source in a pit below the row leaves the row dry. 25588 (dragon-141, 2026-10-14 08:10Z, five crystals broken) had its water go in at (31, 58, -29) under its row at 59, 'the pool is there', and came down from 82 on the dry row at (31, 59, -30), 19.4 to none.
      const sources = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 6, count: 8, useExtraInfo: isSource }).map(p => p.floored()).filter(p => Math.abs(p.x - best.cell.x) <= 3 && Math.abs(p.z - best.cell.z) <= 3 && Math.abs(p.y - best.cell.y) <= 3 && !(state.poolsLeft || []).some(w => w.x === p.x && w.y === p.y && w.z === p.z)).sort((p, q) => p.distanceTo(best.cell) - q.distanceTo(best.cell));
      const src = sources[0];
      if (src && src.y >= best.cell.y) { console.log(`[end combat] the water went in at ${src}, not at ${best.cell}: the pool is there`); best.cell = src; poured = true; }
      else if (src) {
        console.log(`[end combat] the water went in at ${src}, ${best.cell.y - src.y} below the row at ${best.cell.y}: no pool in the row from there; taken back and poured again`);
        try { await require('./water').fillWaterBucket(bot, task, src, { timeoutMs: 1500 }); } catch (_) { /* left */ }
        // The hole the water fell into is filled before the second pour (note 1879): the water went in a block under the row because the row's floor was open there, and the second pour went in the same hole; 25588's dragon-227 (2026-10-18 18:05 to 18:14Z) lost all three of its pools this way, at (36, 61, 22), (32, 61, 21) and (11, 58, 34), 'the second pour went in at ... too, below the row: taken back, the bucket kept', and came down 39 blocks from crystal 18 under the fireballs, dead at two crystals. Of the pools refused in runs 190 to 213, twenty were this.
        if (src.y < best.cell.y && Math.abs(src.x - best.cell.x) <= 1 && Math.abs(src.z - best.cell.z) <= 1 && bot.blockAt(src)?.boundingBox !== 'block') {
          const fname = blocksCarriedName(bot), fitem = fname && bot.inventory.items().find(i => i.name === fname);
          const fref = fitem ? [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(([dx, dy, dz]) => ({ b: bot.blockAt(src.offset(dx, dy, dz)), face: new Vec3(-dx, -dy, -dz) })).find(r => r.b?.boundingBox === 'block') : null;
          if (fref) {
            try { check(); await bot.equip(fitem, 'hand'); await bot.lookAt(fref.b.position.offset(.5 + fref.face.x * .5, .5 + fref.face.y * .5, .5 + fref.face.z * .5), true); await bot.placeBlock(fref.b, fref.face); await sleep(60); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
            console.log(`[end combat] the hole under the row filled at ${src}: ${bot.blockAt(src)?.boundingBox === 'block' ? 'a block laid' : 'no block laid'} before the second pour at ${best.cell}`);
          }
        }
        water = bot.inventory.items().find(i => i.name === 'water_bucket');
        if (water) {
          try { await pourOnce(); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
          poured = bot.blockAt(best.cell)?.name === 'water' && isSource(bot.blockAt(best.cell));
          if (!poured) {
            // The second pour astray too: its source found and taken back, the bucket kept (note 1602).
            const again = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 6, count: 8, useExtraInfo: isSource }).map(p => p.floored()).filter(p => Math.abs(p.x - best.cell.x) <= 3 && Math.abs(p.z - best.cell.z) <= 3 && Math.abs(p.y - best.cell.y) <= 3 && !(state.poolsLeft || []).some(w => w.x === p.x && w.y === p.y && w.z === p.z)).sort((p, q) => p.distanceTo(best.cell) - q.distanceTo(best.cell))[0];
            if (again && again.y >= best.cell.y) { console.log(`[end combat] the second pour went in at ${again}: the pool is there`); best.cell = again; poured = true; }
            else if (again) { console.log(`[end combat] the second pour went in at ${again} too, below the row: taken back, the bucket kept`); try { await require('./water').fillWaterBucket(bot, task, again, { timeoutMs: 1500 }); } catch (_) { /* left */ } }
          }
        }
      }
    }
    // The row holds water where the body comes down (note 1600): the cells of the trench read back after the pour.
    if (poured && best.reach) {
      // The row read after the water has run (note 1611): a source spreads a cell every five ticks, and the row read the moment the source showed held 'water in 1 of 3 cells (.~.)' with the neighbours still dry; 25588 (dragon-146, 149, 150 and 151, 2026-10-14) refused and took back a pool each time, climbed with no pool, and came down dry (dragon-151, 09:13Z, 19 to 17) or dug the column down under the fireballs. Read every 100 ms until the count holds for 300 ms, two seconds at the most.
      const dx = best.dx, dz = best.dz, base = new Vec3(column.x, rowY, column.z); let wet = [];
      const readRow = () => { const w = []; for (let k = 1; k <= best.reach; k++) w.push(bot.blockAt(base.offset(dx * k, 0, dz * k))?.name === 'water'); return w; };
      { let last = -1, held = 0; for (let n = 0; n < 20; n++) { check(); wet = readRow(); const c = wet.filter(Boolean).length; if (c >= best.reach) break; if (c === last) { if (++held >= 3) break; } else { last = c; held = 0; } await sleep(100); } }
      if (wet.filter(Boolean).length < Math.max(2, best.reach - 1)) {
        // And the water taken back (note 1606): a pool refused and left is a bucket gone. 25588 (dragon-146, 2026-10-14 08:47Z) had 'the pool's row holds water in 1 of 2 cells: no pool recorded', climbed crystal 11's column with no bucket and no pool, and died at 82.
        console.log(`[end combat] the pool's row holds water in ${wet.filter(Boolean).length} of ${best.reach} cells (${wet.map(w => w ? '~' : '.').join('')}): no pool recorded, the water taken back`);
        try { await require('./water').fillWaterBucket(bot, task, best.cell, { timeoutMs: 1500 }); } catch (_) { /* left */ }
        poured = false;
      }
    }
    console.log(`[end combat] the pool for the drop ${poured ? 'poured' : 'not poured'} at ${best.cell} beside the column at (${column.x}, ${column.z})${best.obsidian ? `, ${best.obsidian} obsidian that way` : ''}; ${countOf(bot, 'water_bucket')} full bucket${countOf(bot, 'water_bucket') === 1 ? '' : 's'} left`);
    // The pool that runs into the climb's own foot is taken back (note 1895): poured beside the column at the feet's level, its water flows into the cell the climb starts from, and the climb is refused there, 'stopped before the first block: water at the feet'. 25588's dragon-258 (2026-10-19 04:1xZ) poured at (35, 52, -22) beside its column at (35, -23), the body raised to the row (note 1864), and was refused the climb 32 times in five minutes. The climb goes on with no pool, the way down dug.
    if (poured) {
      await sleep(400);
      const foot = new Vec3(column.x, Math.floor(bot.entity.position.y), column.z);
      if (/water/.test(bot.blockAt(foot)?.name || '') && !foot.equals(best.cell)) {
        try { await require('./water').fillWaterBucket(bot, task, best.cell, { timeoutMs: 1500 }); } catch (_) { /* left */ }
        for (let i = 0; i < 20 && /water/.test(bot.blockAt(foot)?.name || ''); i++) await sleep(100);
        console.log(`[end combat] the pool at ${best.cell} ran into the climb's foot at ${foot}: taken back (${/water/.test(bot.blockAt(foot)?.name || '') ? 'the foot still wet' : 'the foot dry'}), no pool for this climb`);
        poured = false; (state.noPoolAt ||= {})[`${column.x},${column.z}`] = Date.now();
      }
    }
    if (poured) { state.pool = { x: best.cell.x, y: best.cell.y, z: best.cell.z, dx: best.dx, dz: best.dz, at: Date.now(), column: { x: column.x, y: Math.floor(bot.entity.position.y), z: column.z }, ...(best.reach ? { reach: best.reach } : {}) }; (state.poolsLeft ||= []).push({ x: best.cell.x, y: best.cell.y, z: best.cell.z, at: Date.now() }); save(); return state.pool; }
    return null;
  };
  // Whether a pool can be poured at a pillar's foot, read from the foot cell on the bot's side of it (note 1539).
  // The pour's own refusal remembered (note 1810): poolAtTheFoot judges the cell on the bot's side of the pillar, poolForTheDrop the cell the climb stands on, and the fact promised a pool the pour then refused. 25588's dragon-176 (2026-10-18 00:36Z) climbed to crystal 65 on 'a pool of water can be poured', found 'no pool for the drop at the foot of (-9, -40)', and had no way down but the dig, with no pickaxe; dragon-179 at (35, 22) the same twice over.
  const noPoolNear = (c, radius) => Object.entries(state.noPoolAt || {}).map(([k, at]) => ({ xz: k.split(',').map(Number), at })).find(({ xz, at }) => Date.now() - at < 30 * 60000 && Math.hypot(xz[0] + .5 - (c.x + .5), xz[1] + .5 - (c.z + .5)) <= radius + 3);
  const poolAtTheFoot = (c, radius, lift) => {
    try {
      const here = bot.entity.position, dx = here.x - (c.x + .5), dz = here.z - (c.z + .5), n = Math.hypot(dx, dz) || 1;
      const fx = Math.floor(c.x + .5 + dx / n * (radius + 1.5)), fz = Math.floor(c.z + .5 + dz / n * (radius + 1.5));
      let gy = null; for (let y = 72; y >= 36 && gy === null; y--) if (bot.blockAt(new Vec3(fx, y, fz))?.boundingBox === 'block') gy = y;
      if (gy === null) return false;
      return !!poolCellFor(new Vec3(fx, gy + 1, fz), lift);
    } catch (_) { return false; }
  };
  // The water left standing from the fight's pours and clutches, for the facts.
  const waterLeftSays = () => {
    const here = bot.entity.position, left = (state.poolsLeft || []).filter(w => bot.blockAt(new Vec3(w.x, w.y, w.z))?.name === 'water').map(w => ({ w, d: Math.round(here.distanceTo(new Vec3(w.x + .5, w.y, w.z + .5))) })).sort((a, b) => a.d - b.d);
    return left.length ? `the water left at (${left[0].w.x}, ${left[0].w.y}, ${left[0].w.z}), ${left[0].d} blocks off, goes back into the bucket when the bot stands within reach of it (take_back_water); ` : 'no water of this fight\'s is left standing anywhere; ';
  };
  const waterDropSide = () => {
    const u = bot._pillarUp; if (!u) return null;
    // From the column's own cell (note 1489): after the blow the body stands
    // on the obsidian's rim beside its column, and from that cell the only
    // open side is the column's top, no fall. 25588 (dragon-66, 2026-10-13
    // 16:38Z) at (-11, 79, 39) beside its column at (-10, 39): 'no side with
    // ground under it', and it dug instead.
    const f = new Vec3(u.x, Math.floor(bot.entity.position.y), u.z);
    let best = null; const verdicts = []; let clearFirst = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const name = dx === 1 ? 'east' : dx === -1 ? 'west' : dz === 1 ? 'south' : 'north';
      // The pool's side by where the pool lies from this column (note 1856): the pour's own dx/dz belonged to the foot cell it was poured beside, and the climb went up from a cell two off; 25588's dragon-216 (2026-10-18 13:57Z) poured at (37, 47, 22) beside (35, 22), climbed (33, 21), and at the top every side read 'end stone beside' and 'none', the pool a block aside of the east side unseen. Within one aside and one to six out.
      const poolRec = state.pool && Date.now() - state.pool.at < 15 * 60000 ? state.pool : null;
      const px = poolRec ? poolRec.x - f.x : 0, pz = poolRec ? poolRec.z - f.z : 0;
      const poolOnThisSide = !!poolRec && ((dx !== 0 && Math.sign(px) === dx && Math.abs(px) >= 1 && Math.abs(px) <= 6 && Math.abs(pz) <= 1) || (dz !== 0 && Math.sign(pz) === dz && Math.abs(pz) >= 1 && Math.abs(pz) <= 6 && Math.abs(px) <= 1));
      if (bot.blockAt(f.offset(dx, 0, dz))?.boundingBox === 'block' || bot.blockAt(f.offset(dx, 1, dz))?.boundingBox === 'block') {
        // The pool's side walled by the bot's own blocks (a roof's post, note 1556): those are dug before the drop, not another side taken.
        // And the post one under them (note 1577): the pocket's wall stands on a post beside the under block, and left standing it is 'a floor 0 down' where the drop goes. 25588 (dragon-127, 2026-10-14 05:13Z) dug its two wall blocks and had no fall.
        const own = [-1, 0, 1].map(dy => f.offset(dx, dy, dz)).filter(c => { const b = bot.blockAt(c); return b?.boundingBox === 'block' && SCAFFOLD_UNDER.test(b.name) && b.name !== 'obsidian' && !(c.y <= f.y - 1 && bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block'); });
        const poolHere = state.pool && Date.now() - state.pool.at < 15 * 60000 && poolOnThisSide;
        if (poolHere && own.length && [0, 1].every(dy => { const b = bot.blockAt(f.offset(dx, dy, dz)); return b?.boundingBox !== 'block' || own.some(c => c.equals(f.offset(dx, dy, dz))); })) clearFirst = { cells: own, name };
        verdicts.push(`${name}: ${bot.blockAt(f.offset(dx, 0, dz))?.name}/${bot.blockAt(f.offset(dx, 1, dz))?.name} beside${poolHere ? ' (the pool\'s side)' : ''}`); continue;
      }
      let fall = null;
      for (let dy = 1; dy <= 48; dy++) { const bl = bot.blockAt(f.offset(dx, -dy, dz)); if (bl?.boundingBox === 'block') { fall = dy - 1; break; } if (bl?.name === 'lava') break; }
      if (fall === null || fall < 3) { verdicts.push(`${name}: ${fall === null ? 'no floor within 48' : `a floor ${fall} down`}`); continue; }
      // The fall to the lowest floor within the carry (note 1702): the body comes down about a cell out for every twelve of fall, plus one, and lands on whatever floor is there, not the first cell's. 25588 (dragon-241, 2026-10-15 06:34Z, five crystals broken) read 'west: 21 down' from (-13, 87, -36), no pool, 20 health, and landed at y 61, 26 down, 20 to none. The deepest floor over the cells one to the carry out is the fall the health is weighed against; a cell with no floor is the island's edge, which note 1569 sets aside.
      { const carry = Math.max(1, Math.round(1 + fall / 12)); let deepest = fall;
        for (let k = 2; k <= carry + 1; k++) { let fk = null; for (let dy = 1; dy <= 48; dy++) { const bl = bot.blockAt(f.offset(dx * k, -dy, dz * k)); if (!bl) break; if (bl.boundingBox === 'block') { fk = dy - 1; break; } } if (fk === null) break; deepest = Math.max(deepest, fk); }
        if (deepest > fall) fall = deepest; }
      // Away from the obsidian (note 1501): the water goes where the server's
      // line of sight from the body reaches the floor, and a fall down the
      // pillar's side has the obsidian in that line. Both dry landings of
      // dragon-71 and the fatal one of dragon-73 (25588, 2026-10-13 18:05Z and
      // 18:51Z) were off the column at (33, -22) toward (30, 60, -22), the
      // pillar's foot beside the way down; the drops away from a pillar landed
      // in water every time.
      let obsidian = 0; for (let k = 1; k <= 3; k++) for (let dy = -3; dy <= 2; dy++) if (bot.blockAt(f.offset(dx * k, dy, dz * k))?.name === 'obsidian') obsidian++;
      // The pool's own side (note 1517), the water still standing: a pool within three of either side's landing made both sides 'the pool's', the shorter fall was taken on the far side, and 25588 (dragon-81, 2026-10-13 20:39Z) landed four blocks east of its pool at (-14, 61, -44) from 27 up and died. The quarry's pits round a foot swallow a pool's spread, so the water must lie on the side stepped off.
      const recorded = state.pool && Date.now() - state.pool.at < 15 * 60000 && bot.blockAt(new Vec3(state.pool.x, state.pool.y, state.pool.z))?.name === 'water' ? state.pool : null;
      // The pool's row is the body's row (note 1545): along the side one to six out, and a cell at most to either hand. The trench is one wide, and 25588 (dragon-96, 2026-10-14 00:20Z, two crystals broken) dropped east from its column at (-9, -40) 'into the pool' recorded at (-8, 60, -42), the trench of an earlier column two cells south, fell 26 onto dry stone at (-6, 61, -40), 20 to none.
      const along = recorded ? (recorded.x - u.x) * dx + (recorded.z - u.z) * dz : 0, aside = recorded ? Math.abs((recorded.x - u.x) * dz) + Math.abs((recorded.z - u.z) * dx) : 0;
      // And at the landing's height (note 1597): the eastern pillars stand where the shelf at 38 meets the island's top at 59, a pool poured at the shelf is twenty blocks under a drop that lands on the top, and 25588 (dragon-140, 2026-10-14 07:58Z) stepped west off crystal 15's column at 82 'into the pool' recorded at (31, 37, -22), came down on the rim at 59, dead.
      const landingY = f.y - fall, poolBelow = recorded ? landingY - recorded.y : 0;
      let pool = !!recorded && poolOnThisSide && along >= 1 && along <= 6 && aside <= 1 && Math.abs(poolBelow) <= 2;
      if (recorded && poolOnThisSide && along >= 1 && along <= 6 && aside <= 1 && Math.abs(poolBelow) > 2) verdicts.push(`${name}: the pool recorded at (${recorded.x}, ${recorded.y}, ${recorded.z}) lies ${Math.abs(poolBelow)} blocks ${poolBelow > 0 ? 'below' : 'above'} this side's landing at ${landingY}, no pool under it`);
      // The trench's reach (note 1552): the body comes down about a cell out for every eight of fall, and a trench shorter than that is no pool under it. 25588 (dragon-101, 2026-10-14 00:59Z, two crystals broken) had a trench of two cells west of its column at (-13, -36), fell 27 toward it and came down on the third cell, 18.3 to none.
      let shortTrench = false;
      if (pool && recorded.reach && Math.round(fall / 8) > recorded.reach) { pool = false; shortTrench = true; }
      // With a pool recorded, its side alone is the pool's (note 1531): the pool's spread reaches the cells of the next side too, and 25588 (dragon-89, 2026-10-13 22:32Z, two crystals broken) had 'west: the pool; south: the pool' with the pool poured south, took west, the first of equals, and fell 26 onto stone, dead.
      if (!pool && !recorded) for (let k = 1; k <= 3 && !pool; k++) for (let dy = -1; dy <= 1 && !pool; dy++) if (bot.blockAt(f.offset(dx * k, -fall + dy, dz * k))?.name === 'water') pool = true;
      // The cells along the body's way out (note 1543), a block out for every
      // eight of fall: a block standing in them higher than the floor beside
      // the column is the landing, not the pool. 25588 (dragon-95, 2026-10-14
      // 00:05Z, three crystals broken) stepped off crystal 96's column at
      // (-32, 85, 21) east toward its pool and came down on the stump of its
      // own earlier column at (-30, 69, 21), two cells out, 20 to 7.
      let inTheWay = null, overEdge = null;
      for (let k = 2; k <= Math.max(2, Math.round(fall / 8) + 1) && !inTheWay; k++) {
        for (let dy = 0; dy < fall - 1; dy++) { const bl = bot.blockAt(f.offset(dx * k, -dy, dz * k)); if (bl?.boundingBox === 'block') { inTheWay = { cell: f.offset(dx * k, -dy, dz * k), over: fall - 1 - dy }; break; } }
        // The floor falling away beyond the landing (note 1569): a cell along the
        // way with no floor within six under the landing's level is the island's
        // edge, and the body carried that far goes over it. 25588 (dragon-117,
        // 2026-10-14 03:45Z, crystal 9 broken) dropped east off its column at
        // (36, 78, -25), '21 down' onto (37, -25), the rim's last cell, and fell
        // 43 to the shelf at 35, dead.
        if (!inTheWay && !overEdge) { let floor = null; for (let dy = fall - 1; dy <= fall + 6; dy++) { if (bot.blockAt(f.offset(dx * k, -dy, dz * k))?.boundingBox === 'block') { floor = dy; break; } } if (floor === null) overEdge = { cell: f.offset(dx * k, -fall, dz * k), k }; }
      }
      // The edge within the fall's carry is no side at all (note 1605): the body comes down about a cell out for every twelve of fall plus one, and a floor that falls away inside that is the fall it goes on into. 25588 (dragon-145, 2026-10-14 08:42Z, three crystals broken) took 'north: 7 down, the floor falls away 2 out (the edge)' as the only side with ground, came down past the ledge and fell 23 more, 20 to none; 1569 had penalised the side, not set it aside.
      const carry = Math.round(1 + fall / 12);
      if (overEdge && overEdge.k <= carry + 1) { verdicts.push(`${name}: ${fall} down, the floor falls away ${overEdge.k} out (the edge) within the fall's carry of about ${carry}: no side`); continue; }
      const score = fall + obsidian * 20 - (pool ? 100 : 0) + (inTheWay ? 200 : 0) + (overEdge ? 300 : 0);
      verdicts.push(`${name}: ${fall} down${pool ? ', the pool' : ''}${shortTrench ? `, the pool's trench of ${recorded.reach} short of the landing about ${Math.round(fall / 8)} out` : ''}${obsidian ? `, ${obsidian} obsidian` : ''}${overEdge ? `, the floor falls away ${overEdge.k} out (the edge)` : ''}${inTheWay ? `, ${bot.blockAt(inTheWay.cell)?.name} in the fall's way at ${inTheWay.cell}, ${inTheWay.over} over the floor` : ''}`);
      if (!best || score < best.score) best = { dx, dz, fall, obsidian, pool: pool && !inTheWay && !overEdge, inTheWay, overEdge, score, edge: f.offset(dx, 0, dz), name };
    }
    // Said (note 1522): 25588 (dragon-83, 2026-10-13 21:17Z, six crystals broken) poured its pool south of the column at (-30, -22), dropped from 79 and landed three blocks east of it, dead, and no line said which side was stepped off or why.
    if (clearFirst) { console.log(`[end combat] the drop's sides from ${f}: ${verdicts.join('; ')}; the ${clearFirst.name} side, the pool's, walled by the bot's own blocks: dug first`); return { clearFirst: clearFirst.cells }; }
    console.log(`[end combat] the drop's sides from ${f}: ${verdicts.join('; ')}${best ? `; ${best.name} taken` : '; none'}${state.pool ? ` (the pool recorded at (${state.pool.x}, ${state.pool.y}, ${state.pool.z}), ${state.pool.dx === 1 ? 'east' : state.pool.dx === -1 ? 'west' : state.pool.dz === 1 ? 'south' : 'north'} of the column)` : ''}`);
    return best;
  };
  // Up out of the water onto the nearest rim (notes 1559, 1561, 1570): sideways
  // to the side whose rim stands a block up with air over it, forward and the
  // jump. Called after the drop's landing, and at the step's start whenever the
  // body is in water or its breath is going: 25588 (dragon-118, 2026-10-14
  // 03:49Z) quarried on with its head under water at (48, 55, 12), oxygen 17
  // to 0, and the survival's 'swim_to_land' spun 21 times a second without a
  // step; drowned at full health in twelve seconds.
  const outOfTheWater = async () => {
    const feet = bot.entity.position.floored();
    const ways = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => { for (let d = 1; d <= 2; d++) { const c = feet.offset(dx * d, 0, dz * d); if (bot.blockAt(c)?.boundingBox === 'block' && bot.blockAt(c.offset(0, 1, 0))?.boundingBox !== 'block' && bot.blockAt(c.offset(0, 2, 0))?.boundingBox !== 'block') return { dx, dz, d }; if (bot.blockAt(c)?.name !== 'water') break; } return null; }).filter(Boolean).sort((a, b) => a.d - b.d);
    const way = ways[0];
    // No rim found beside: toward the island's middle (note 1586), never a fixed east. 25588 (dragon-131, 2026-10-14 06:04Z) in water flowing down the eastern slope at (41, 55, -22) moved east, 'no rim found beside', and went down the cliff with the flow.
    const middle = state.arenaCenter ? vector(state.arenaCenter) : new Vec3(0, bot.entity.position.y, 0);
    const toMiddle = new Vec3(middle.x - bot.entity.position.x, 0, middle.z - bot.entity.position.z); const len = Math.hypot(toMiddle.x, toMiddle.z) || 1;
    // Uphill first where no rim stands beside (note 1607): flowing water runs downhill and the body with it, and the ground's rise within two cells says which way is up. 25588 (dragon-147, 2026-10-14 08:51Z) in water on the shelf's slope moved toward the middle, 'still in the water', and the flow took it over the rim.
    const groundAt = (dx, dz) => { for (let dy = 2; dy >= -3; dy--) if (bot.blockAt(feet.offset(dx, dy, dz))?.boundingBox === 'block') return feet.y + dy; return feet.y - 4; };
    const uphill = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ dx, dz, rise: Math.max(groundAt(dx, dz), groundAt(dx * 2, dz * 2)) - (feet.y - 1) })).filter(o => o.rise >= 1).sort((a, b) => b.rise - a.rise)[0];
    // A roof over the head dug first (note 2275): the jump out of the water needs the cell two over the feet open.
    // dragon-370 (25589, 2026-10-27 03:4xZ) stood in its flooded tunnel at (-21, 58, 30), the rim a block east with room
    // over it, end stone at (-21, 60, 30) over its head, said 'out of the trench: still in the water' 187 times and died in
    // the breath there.
    { const over = feet.offset(0, 2, 0), ob = bot.blockAt(over);
      if (ob?.boundingBox === 'block' && !/bedrock|obsidian|end_portal|crying_obsidian/.test(ob.name) && actions.dig) {
        try { await actions.dig(bot, task, over, { requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
        console.log(`[end combat] out of the trench: the ${ob.name} over the head at ${over} ${bot.blockAt(over)?.boundingBox === 'block' ? 'not dug' : 'dug'} for the jump out`);
      } }
    const toward = way ? feet.offset(way.dx * (way.d + 1) + .5, 1.5, way.dz * (way.d + 1) + .5) : uphill ? feet.offset(uphill.dx * 2 + .5, 1.5, uphill.dz * 2 + .5) : bot.entity.position.offset(toMiddle.x / len * 2, 1, toMiddle.z / len * 2);
    try {
      await require('./motion').move(bot, task, { label: 'out_of_the_trench', keys: ['forward', 'jump'], sneak: false, why: 'up out of the water onto the rim before anything else (notes 1559, 1570)', look: toward, maxMs: 2500, tick: 25, until: () => !inWater() && bot.entity.onGround });
    } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    // Still in the water after the move: the water taken back into the bucket (note 1783), so the body stands dry on the trench's floor and the jump out reaches. 25588's dragon-153 (2026-10-17 18:5xZ) said 'out of the trench: still in the water at (28, 58, -20) (north, the rim 1 off)' nine times in a minute, every move timing out, a full bucket and an empty one carried.
    if (inWater() && countOf(bot, 'bucket') > 0) {
      state.trenchStuck = (state.trenchStuck || 0) + 1;
      // The source walked to when none is in the bucket's reach (note 1787, as note 1786 for the empty tree): 25588's dragon-155 (2026-10-17 19:3xZ) stood in its drop's pool at (31, 59, -23) against the pillar, an empty bucket carried, the pour at (31, 60, -19) four off, and said 'still in the water' 71 times, no scoop.
      { const { sourceWater } = require('./water'); const eye = bot.entity.position.offset(0, 1.62, 0); const srcs = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 7, count: 16, useExtraInfo: sourceWater }).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)); const src = srcs[0];
        if (!(state.trenchSaid > Date.now() - 15000)) { state.trenchSaid = Date.now(); console.log(`[end combat] out of the trench: in the water at ${bot.entity.position.floored()} with ${countOf(bot, 'bucket')} empty and ${countOf(bot, 'water_bucket')} full bucket(s); sources within seven: ${srcs.length}${src ? `, the nearest at ${src}, ${Math.round(eye.distanceTo(src.offset(.5, .5, .5)) * 10) / 10} from the eye` : ''}`); }
        if (src && eye.distanceTo(src.offset(.5, .5, .5)) > 4.0) { try { await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'to_the_water_source', keys: ['forward', 'jump'], sneak: false, why: 'to the pool\'s source, to take it back', look: src.offset(.5, .5, .5), maxMs: 2500, tick: 25, until: () => bot.entity.position.offset(0, 1.62, 0).distanceTo(src.offset(.5, .5, .5)) <= 3.5 }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } } }
      try { const took = await takeBackWaterNear({ force: true }); if (took) { console.log(`[end combat] out of the trench: the water at ${took} taken back, the body dry at ${bot.entity.position.floored()}`); try { await require('./motion').move(bot, task, { label: 'out_of_the_trench', keys: ['forward', 'jump'], sneak: false, why: 'up out of the trench after the water came back', look: toward, maxMs: 2000, tick: 25, until: () => bot.entity.onGround && !inWater() && Math.floor(bot.entity.position.y) > feet.y }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } } } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
    }
    // Up out of the pit as well as the water (note 1627): the pool's trench is a pit a block deep and some cells wide, and 'on the rim' was said of a body standing dry on its floor. 25588 (dragon-160, 2026-10-14 11:34Z, four crystals broken) came down its column to the pit at (-38, 56, -30), had the water back in the bucket, 'out of the trench: on the rim at (-38, 57, -29) (no rim found beside)' three times at the pit's floor, and the breath's cloud took it there 8 to 2 to none, the two blocks up laid none in the pit; dragon-155 (10:12Z) the same in its pit's water. The rim is the nearest cell within three whose block stands at the feet's level with two of air over it, walked to.
    const solidAt = c => bot.blockAt(c)?.boundingBox === 'block';
    const inPit = () => { const f = bot.entity.position.floored(); return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solidAt(f.offset(dx, 0, dz))).length >= 2; };
    if (!inWater() && inPit() && actions.navigate) {
      const f = bot.entity.position.floored(); let rim = null;
      for (let r = 1; r <= 3 && !rim; r++) for (let dx = -r; dx <= r && !rim; dx++) for (let dz = -r; dz <= r && !rim; dz++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const c = f.offset(dx, 0, dz); if (solidAt(c) && !solidAt(c.offset(0, 1, 0)) && !solidAt(c.offset(0, 2, 0)) && voidEdge(bot, c.offset(.5, 1, .5), 3) === null) rim = c; }
      if (rim) {
        try { await actions.navigate(bot, task, new goals.GoalBlock(rim.x, rim.y + 1, rim.z), { timeoutMs: 4000, stallMs: 2000 }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
        console.log(`[end combat] up out of the pit: ${inPit() ? 'still in it' : 'on the rim'} at ${bot.entity.position.floored()} (the rim at ${rim.offset(0, 1, 0)})`);
      }
    }
    console.log(`[end combat] out of the trench: ${inWater() ? 'still in the water' : inPit() ? 'dry on the pit\'s floor' : 'on the rim'} at ${bot.entity.position.floored()}${way ? ` (${way.dx === 1 ? 'east' : way.dx === -1 ? 'west' : way.dz === 1 ? 'south' : 'north'}, the rim ${way.d} off)` : ' (no rim found beside)'}`);
    return !inWater() && !inPit();
  };
  const waterDrop = async ({ inCloud = false } = {}) => {
    let side = waterDropSide();
    if (side?.clearFirst && actions.dig) {
      for (const c of side.clearFirst) { try { await actions.dig(bot, task, c, { requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the pool's side not cleared at ${c}: ${String(err.message || err).slice(0, 80)}`); } }
      side = waterDropSide();
    }
    if (side?.clearFirst) side = null;
    const water = bot.inventory.items().find(i => i.name === 'water_bucket');
    // Into the pool with no bucket in hand (note 1514): the pool at the foot is the landing, the bucket in the air only the second chance. 25588 (dragon-78, 2026-10-13 20:16Z) poured its last bucket into the pool at crystal 94's foot, struck the crystal, and was refused the drop at 85, 'no water bucket carried', the pool under it.
    if (!side || (!water && !side.pool)) { console.log(`[end combat] no water drop from ${bot.entity.position.floored()}: ${!side ? 'no side with ground under it' : 'no water bucket carried and no pool under the way down'}`); return false; }
    const startY = bot.entity.position.y, health = bot.health;
    // Not a fall that kills if the water is late (note 1504): a fall takes its blocks less three, and the pour has missed one drop in six. 25588 (dragon-74, 2026-10-13 19:15Z, five crystals broken) stepped off crystal 87's column at 97, 40 blocks, and died on the ground at 58 with no water poured.
    // No height is refused (note 1521, the user's call of 2026-10-13 21:10Z): the pool at the foot takes any fall, the bucket in the air is the second chance, and the dig first stood the body in the breath (dragon-79 and 80 died digging). Said with the fall's cost if both miss.
    // Into the pool from any height (the user's call); with no pool and no breath at the feet, a fall that kills dry is dug down first to where it does not (note 1524): the bucket in the air is a coin flip at a block and a half a tick, and 25588 (dragon-84, 2026-10-13 21:24Z, four crystals broken) took a drop of 43 into its pool unhurt, then one of 23 off crystal 11's column, where no pool can be poured at the rim, and died at 18.4 health.
    // In the cloud too (note 1639): the drop was forced in the breath whatever the fall and the health, betting the bucket under the body, and the bucket in a fall of 2026-10-14's runs 150 to 172 came to 24 wet landings, 10 dry and 8 deaths; 25588 (dragon-168, 169 and 172, 13:47 to 14:18Z) each took the breath on a column's top with no pool, dropped 19 to 24 blocks at 14 health with the bucket and died on the ground. The cloud lies half a block deep at the top; three dug is out of it (note 1576), and the dig is what follows a refusal.
    // No step down into a cloud (note 1642, as the dig stops over one, note 1576): the two laid out of the breath (note 1636) were stepped off three and four blocks back into the cloud below, 'dry, 20 to 14', six times in dragon-171 and 174 (2026-10-14).
    { const below = cloudUnderfoot(side.fall + 1); if (below && !side.pool) { console.log(`[end combat] no water drop from ${bot.entity.position.floored()}: ${cloudUnderfootSays(below)}`); return false; } }
    // No drop onto a landing in the breath (note 1668): the pool's pit and the ground about it collect the perched dragon's clouds, and a body dropped into one takes six a second on landing, pool or no pool. 25588 (dragon-203, 2026-10-14 21:24Z, one crystal broken) at the fountain's edge went up two out of the breath, dropped three into its pool at (13, 59, 9) with the cloud on it, 'cut by the breath's cloud at the feet', landed dry at 9.7, up two again, dropped again into the cloud, and died in the air of the last drop at 4.7, 20 to none in seventeen seconds in four clouds.
    { const landY = Math.floor(startY) - side.fall, land = new Vec3(side.edge.x + .5, landY, side.edge.z + .5);
      const onIt = Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && Math.abs(e.position.y - landY) <= 2.5 && Math.hypot(e.position.x - land.x, e.position.z - land.z) <= cloudRadius(bot, e) + 1.5);
      if (onIt) { console.log(`[end combat] no water drop from ${bot.entity.position.floored()}: the breath's cloud lies on the landing at (${side.edge.x}, ${landY}, ${side.edge.z}), ${Math.round(cloudRadius(bot, onIt) * 2 * 10) / 10} wide, ${Math.round(Math.hypot(onIt.position.x - land.x, onIt.position.z - land.z) * 10) / 10} off it; a cloud lasts about thirty seconds`); return false; } }
    if (side.fall - 3 >= health - 1 && !side.pool) { const dig = side.fall - 3 - Math.floor(health - 1) + 1; console.log(`[end combat] no water drop from ${bot.entity.position.floored()}: a fall of ${side.fall} blocks takes about ${side.fall - 3} health and the body has ${health.toFixed(1)}, no pool under the way down; ${dig} dug first`); waterDrop.tooHighBy = dig; return false; }
    if (side.fall - 3 >= health - 1) console.log(`[end combat] the water drop of ${side.fall} blocks at ${health.toFixed(1)} health${side.pool ? ', into the pool at the foot' : ', the breath at the feet'}: a dry landing would take about ${side.fall - 3}`);
    waterDrop.tooHighBy = 0;
    goal.step = { action: 'water_drop', from: { ...bot.entity.position }, fall: side.fall, health }; save();
    // Onto the column's cell first, at a crouch, where the body stands beside it on the rim.
    if (!await centreOnColumn(0.3)) console.log(`[end combat] the water drop begins ${Math.round(Math.hypot(bot._pillarUp.x + .5 - bot.entity.position.x, bot._pillarUp.z + .5 - bot.entity.position.z) * 100) / 100} off the column's middle`);
    console.log(`[end combat] the water drop from ${bot.entity.position.floored()}, ${side.fall} blocks onto the island at (${side.edge.x}, ${side.edge.z})${side.pool ? ', into the pool' : ', no pool under it'}${side.obsidian ? `, ${side.obsidian} obsidian beside the way` : ''}, health ${health.toFixed(1)}`);
    if (water) { try { await bot.equip(water, 'hand'); } catch (_) { /* equipped in the fall */ } }
    // Upright for the step (note 1492): the crouch kept on the column (note
    // 1480) backs a crouched body off every edge, and the step off went 0.6
    // of a block and stopped at the edge, 'still up', four times in
    // dragon-67 and dragon-68 (25588, 2026-10-13 16:45 to 17:05Z).
    // The health read again at the step-off (note 1538): the drop was judged at
    // 20.0 and taken at 17.3, the dragon's blow landing between, and 25588
    // (dragon-93, 2026-10-13 23:36Z) fell 21 with no pool, 18 of fall damage
    // against 17.3, dead on the rim.
    if (side.fall - 3 >= bot.health - 1 && !side.pool && !inCloud) { const dig = side.fall - 3 - Math.floor(bot.health - 1) + 1; console.log(`[end combat] the water drop held at the step-off: the health is ${bot.health.toFixed(1)} now, a fall of ${side.fall} takes about ${side.fall - 3}, no pool under the way down; ${dig} dug first`); waterDrop.tooHighBy = dig; return false; }
    // The dragon's body about to pass (note 1589): a body in the air is in its wings' push, and 25588 (dragon-133, 2026-10-14 06:22Z) stepped off crystal 9's column at (35, 82, -23) as the dragon came, took its blow at 81 and was carried five east and four north of its pool, dead at (40, 56, -19). Out of the cloud, the step waits up to two and a half seconds for the body to pass; in the cloud it goes.
    if (!inCloud && breathThreat(bot)?.name !== 'area_effect_cloud' && dragonThreat(bot)) {
      const t0 = Date.now(); let waited = 0;
      while (Date.now() - t0 < 2500 && dragonThreat(bot)) { check(); await sleep(100); waited = Date.now() - t0; }
      // Still coming after the wait, the step is not taken (note 1670): a body in the air for a second and a half is in the wings' push, and a blow there puts it off the pool. 25588 (dragon-204, 2026-10-14 21:35Z, three crystals broken) at (-32, 83, 21), 'the dragon charges the column, 13 off, the pool below: off into it', waited 2517 ms, 'still coming: the step goes', was struck at 81 in the air, landed dry four blocks from the pool at (-27, 62, 23), 20 to none. The hold in the pocket (notes 1655, 1659) answers the body on the column; the drop is for after it has passed.
      if (dragonThreat(bot)) { console.log(`[end combat] the step off waited ${waited} ms and the dragon's body still comes: not taken; the hold on the column instead`); bot.setControlState?.('sneak', false); return false; }
      console.log(`[end combat] the step off waited ${waited} ms for the dragon's body to pass`);
    }
    bot._dropping = true;
    // The step's emergency check set aside for the step off (note 1550): the
    // drop is the answer to the fireball and the breath, and the move's own
    // check threw 'EndEmergency' at its first tick with a fireball in flight,
    // swallowed here, 'the water drop ended still up'. 25588 (dragon-99,
    // 2026-10-14 00:48Z, two crystals broken) stood on its column at 80 with
    // the pool beside it, pressed nothing for two seconds, and took the
    // fireball's cloud there, 20 to none in three seconds.
    const dropInterrupt = task.interruptCheck; task.interruptCheck = undefined;
    try {
      bot.setControlState?.('sneak', false);
      await require('./motion').move(bot, task, { label: 'water_drop', keys: ['forward'], sneak: false, why: 'off the column onto the island by its foot, the water bucket in hand for the landing (note 1484)',
        // The fall is the move's purpose (note 1490): refused as a 'deadly fall ahead', 25588 (dragon-67, 2026-10-13 16:45Z) stood on its column top at 103 'still up' twice and dug instead.
        // Aimed far along the drop's axis, not at the next cell's middle (note 1585): from a body 0.3 off the column's middle the next cell's middle is 17 degrees off the axis, and over a fall of 41 blocks (the walk-off lands 2.7 to 3.0 out, the arena's drop drill, 2026-10-14) that is two blocks sideways. 25588 (dragon-130, 06:00Z, six crystals broken) stepped south off crystal 64's column at (7, 97, 39) and landed at (5, 58, 44), a cell west of its three-wide trench, dead.
        look: new Vec3(bot._pillarUp.x + .5 + side.dx * 12, bot.entity.position.y + 1.0, bot._pillarUp.z + .5 + side.dz * 12), maxMs: 2000, tick: 25, intoFall: true, until: () => !bot.entity.onGround && bot.entity.position.y < startY - 0.5 });
    } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the water drop's step off ended: ${err.name || ''} ${String(err.message || err).slice(0, 100)}`); }
    finally { bot._dropping = false; task.interruptCheck = dropInterrupt; }
    // The drift held to the pool's cell (note 1903): scripts/drop-drill.js (arena, 2026-10-19 10:3xZ) stepped off columns of 20, 30 and 40 over water, twice each, and the body came down 2.74 to 2.89 out from the column's middle every time, whatever the height; the back key held 4 ticks in the air brought it to 2.0 to 2.3, 8 ticks to 1.1 to 1.5. 25588's dragon-277 (2026-10-19 10:2xZ) stepped off at 97 over a pool one cell out and came down three out, dry, dead. The back key is held for the ticks that land the body on the pool's own cell.
    if (side.pool && state.pool && bot._pillarUp && !bot.entity.onGround) {
      const u = bot._pillarUp, k = Math.abs(side.dx ? state.pool.x - u.x : state.pool.z - u.z), ticks = Math.max(0, Math.min(12, Math.round((2.8 - k) / 0.17)));
      if (ticks > 0) { bot._dropping = true; try { bot.setControlState?.('back', true); await sleep(ticks * 50); } finally { bot.setControlState?.('back', false); bot._dropping = false; } }
      console.log(`[end combat] the drop's drift held for the pool ${k} out: the back key ${ticks} ticks (the step lands 2.8 out with none)`);
    }
    // What stood in the step's way, said when the step did not leave the column (note 1887): 25588's dragon-240 (2026-10-19 00:3xZ, three crystals) drew 'the water drop from (-10, 88, -43), 28 blocks ... into the pool' and then 'the water drop ended still up', two seconds of the forward key and no fall, and nothing said why; the dig down that followed under the fireballs ended it at 0.3. The cells ahead at the feet and the head, the body's place and the keys held go into the line.
    if (bot.entity.onGround && bot.entity.position.y >= startY - 0.5) {
      const p = bot.entity.position, f = p.floored(), ahead = [1, 2].map(k => [0, 1].map(dy => `${k}${dy ? 'h' : 'f'}:${bot.blockAt(f.offset(side.dx * k, dy, side.dz * k))?.name || '?'}`).join(' ')).join(' ');
      console.log(`[end combat] the water drop's step did not leave the column: at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}), the column at (${bot._pillarUp?.x}, ${bot._pillarUp?.z}), toward ${side.dx > 0 ? 'east' : side.dx < 0 ? 'west' : side.dz > 0 ? 'south' : 'north'}: ${ahead}; keys ${JSON.stringify(bot.controlState || {})}; refused ${bot._moveRefused && Date.now() - bot._moveRefused.at < 3000 ? bot._moveRefused.name : 'no'}`);
    }
    let wet = false;
    try { wet = await recoverFall(bot, task, goal, save, { refill: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the water drop's landing: ${String(err.message || err).slice(0, 120)}`); }
    for (let i = 0; i < 60 && !bot.entity.onGround; i++) await sleep(50);
    const down = bot.entity.position.y <= startY - 3;
    (state.descents ||= []).push({ at: Date.now(), kind: 'drop', from: startY, to: bot.entity.position.y, wet, lost: Math.round((health - bot.health) * 10) / 10, down });
    console.log(`[end combat] the water drop ended ${down ? 'down' : 'still up'} at ${bot.entity.position.floored()}, ${wet ? 'in the water' : 'dry'}, health ${health.toFixed(1)} to ${bot.health.toFixed(1)}`);
    if (down) delete bot._pillarUp;
    save();
    // The pool taken back where the body lands (note 1535), before anything
    // walks it off: the step's start took back only what stood within reach
    // then, and 25588 (dragon-92, 2026-10-13 23:16Z, five crystals broken)
    // landed its 26-block drop in the pool at (-15, 62, -36), was 42 blocks
    // off at its next question ten seconds later, and poured its next pool
    // with '0 full buckets left'.
    // Out of the trench first (note 1559): a body in the pool's water wades at
    // half a walk and climbs its wall at a swim, and 25588 (dragon-109,
    // 2026-10-14 02:16Z, crystal 114 broken) landed in its trench at (-17, 59,
    // -37), took a fireball's cloud there, 'evade breath straight' twice, moved
    // 1.4 blocks in four seconds, 20 to none. The rim is a block up and a block
    // or two off: forward and the jump, toward the column's foot.
    if (down && inWater()) await outOfTheWater();
    if (down && countOf(bot, 'bucket') > 0 && !breathThreat(bot) && !dragonThreat(bot)) { try { await takeBackWaterNear({ sparePool: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } }
    return down;
  };
  // The way down the column as Jev chose it for this fight (column_descent): the drop where chosen and possible, the dig otherwise.
  // Up two instead of down on a short column (note 1590): the cloud lies at
  // the feet, the dig down ends in it for three blocks and the column has
  // fewer, and two laid are under a second. 25588 (dragon-134, 2026-10-14
  // 06:35Z, two crystals broken) stood one up its column at (-13, 63, 42)
  // with no pool under the way and no bucket, dug its one block down into
  // the cloud, 20 to 14 to 8.6 to 2.8 to none in three seconds, 24 blocks carried.
  // Not under a roof, and a climb that gains nothing is no answer (note 1613, as 1608 on the ground): the way down went on to its other steps only when this returned false, and 25588 (dragon-152, 2026-10-14 09:20Z) at (-13, 79, 37) under its own roof beside crystal 78's top logged 'up out of the breath on the short column: 0 blocks up' twenty times in the cloud, 14.4 to 3.4, before the drop. A try that gained nothing is not made again for three seconds.
  const upOutOfBreathOnShortColumn = async () => {
    if (breathThreat(bot)?.name !== 'area_effect_cloud' || blocksCarried(bot) < 2 || columnDepth() >= 4) return false;
    if (state.shortColumnUpFailedAt > Date.now() - 3000) return false;
    goal.step = { action: 'up_out_of_breath_on_column', health: bot.health }; save();
    const f0 = bot.entity.position.floored();
    // The bot's own roof over the head dug first (a block or two, half a second each), the jump stopped under it otherwise.
    for (const dy of [2, 3]) { const r = bot.blockAt(f0.offset(0, dy, 0)); if (r?.boundingBox === 'block' && actions.dig && !/bedrock|obsidian|end_portal/.test(r.name)) { try { await actions.dig(bot, task, r.position); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } } }
    // The lee wall here too (note 1711): 1706 laid it before the column's climb and the ground's, not this one or the thin ground's. 25588 (dragon-253, 2026-10-15 09:18Z, five crystals broken, the day's best) climbed from a stub at (-35, 65, -11) in the breath with 16 blocks and no wall, 'the jump carried the body from (-35, -11) to (-34, -11)', then to (-36) and (-38), no block laid in six jumps, 20 to 4.5.
    await leeForClimb();
    const from = Math.floor(bot.entity.position.y);
    const want = upClear(from);
    try { await require('./pillar-recovery').pillarUp(bot, task, from + want, { dig: actions.dig, maxBlocks: want, threats: false, wet: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    const rose = Math.floor(bot.entity.position.y) - from;
    console.log(`[end combat] up out of the breath on the short column: ${rose} blocks up at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health`);
    if (rose < 1) state.shortColumnUpFailedAt = Date.now();
    return true;
  };
  const wayDown = async (opts) => {
    if (await upOutOfBreathOnShortColumn()) return;
    const dropChosen = state.descent?.pick === 'water_drop' && Date.now() - state.descent.at < 30 * 60000;
    // From the column's own cell whatever onOwnPillar says of it (note 1573):
    // at the top against a thick pillar, the roof's post and the obsidian
    // can close every side it counts, and 25588 (dragon-121, 2026-10-14
    // 04:15Z, crystal 108 broken) at (16, 103, -36) with its pool at (19, 59,
    // -36) was dug down 44 blocks without a look at the drop.
    if (dropChosen && (onOwnPillar() || onColumnCell())) {
      // In the cloud with the drop's side walled by the pocket (note 1577): two down first, out of the cloud in a second, the walls dug after. Three wall blocks dug in the cloud are nine health.
      if (breathThreat(bot)?.name === 'area_effect_cloud' && waterDropSide()?.clearFirst) { console.log(`[end combat] the breath in the pocket at ${bot.entity.position.floored()}: two down out of it before the drop's wall is dug`); await digDownColumn({ limit: 2 }); }
      if (!onOwnPillar()) { const f = bot.entity.position.floored(); console.log(`[end combat] on the column's cell at ${f} but not 'on own pillar': under ${bot.blockAt(f.offset(0, -1, 0))?.name}, ${[[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(f.offset(dx, -1, dz))?.boundingBox !== 'block').length} open sides at the feet`); }
      if (await waterDrop({ inCloud: breathThreat(bot)?.name === 'area_effect_cloud' })) return;
      // Too high for the drop: dug down to where a dry fall is borne, then the
      // drop (note 1507). 25588 (dragon-76, 2026-10-13 19:33Z) at 82 was
      // refused the drop of 23 and dug the whole column, the drop coming only
      // when the breath found it at 73.
      if (waterDrop.tooHighBy > 0) {
        await digDownColumn({ limit: Math.min(waterDrop.tooHighBy, opts?.limit ?? 64) });
        if (onOwnPillar() && await waterDrop()) return;
      }
      // The drop asked again every three blocks down (note 1898): at the column's top the stand and the pocket built for the blow lie beside the body on every side, 'a floor 0 down', and the drop was refused there once and the column dug to the ground under the dragon. Of the 23 drops refused in 25588's dragon-251 to 262 (2026-10-19), 15 were 'no side with ground under it', and dragon-262 (four crystals) at (-37, 94, -22), 'east: a floor 0 down; west: a floor 0 down; ...', was struck down at 83 in the dig. A few blocks under the stand the column's sides open.
      { const u = bot._pillarUp; let left = opts?.limit ?? 64;
        for (let k = 0; k < 12 && left > 0 && onOwnPillar() && u && u.base != null && Math.floor(bot.entity.position.y) - u.base > 6; k++) {
          const y0 = Math.floor(bot.entity.position.y);
          await digDownColumn({ limit: Math.min(3, left) });
          const went = y0 - Math.floor(bot.entity.position.y); left -= Math.max(went, 1);
          if (went <= 0) break;
          if (onOwnPillar() && await waterDrop()) { console.log(`[end combat] the drop taken after ${(opts?.limit ?? 64) - left} blocks dug down from the top`); return; }
        }
      }
    }
    await digDownColumn(opts);
  };
  // Jev's choice of the way down, once a fight (note 1484): asked at the
  // foot before the climb, where there is time for it; held half an hour.
  const descentChoice = async (lift) => {
    if (!client || (state.descent && Date.now() - state.descent.at < 30 * 60000)) return;
    const water = countOf(bot, 'water_bucket');
    const dug = (state.descents || []).filter(d => d.kind === 'dig'), dropped = (state.descents || []).filter(d => d.kind === 'drop');
    const record = (list, what) => list.length ? ` This fight's ${list.length} ${what}${list.length === 1 ? '' : 's'}: ${list.filter(d => d.down).length} down, ${list.filter(d => d.fell).length} fell, ${Math.round(list.reduce((n, d) => n + (d.lost || 0), 0) * 10) / 10} health lost in all.` : '';
    const tree = {
      dig_down: { description: `Come down the column after each crystal by digging the block under the feet, one at a time, about a second and a half a block, ${lift} blocks here, crouched with the shield up through the dragon's passes. The breath's cloud lands on the column where the body stands, 6 health a second whatever is worn, and every blow of it knocks the body 0.4 away from the dragon and lifts it: on a column one wide two blows put the body off it. On 2026-10-13 25588 fell off its column in the breath five times this way (dragon-59, 61, 62, 63, 64), 10 to 19 blocks, three times to its death; the dig itself brought 14 blocks down safely in most descents.${record(dug, 'dig')}` },
      water_drop: { description: `Come down the column after each crystal by stepping off its edge onto the island by its foot, ${lift} blocks down: a bucket of water is poured at the column's foot before the climb and the body lands in that pool unhurt, the second bucket poured under the body in the last blocks of the fall if the pool is missed; the buckets are filled again from the water after. ${water} water bucket${water === 1 ? '' : 's'} carried. A second and a half in the air instead of twenty seconds on the column. Where the water is not poured in time (one drop in six so far has landed dry) the fall of ${lift} blocks takes about ${Math.max(0, lift - 3)} health; a drop is taken from any height, the pool and the bucket its two chances. The column's blocks are left standing; the next climb's blocks are dug from the island (quarry_blocks). Chosen, it is also the way out of the breath's cloud at the feet on the column: off at once, not three blocks dug in it.${record(dropped, 'drop')}` },
    };
    try {
      const decision = await decide('column_descent', { client, bot, task, goal, save, tree, interrupt: check, state: { lift, waterBuckets: water, health: bot.health, descents: (state.descents || []).slice(-6) } });
      if (decision.stale) return;
      state.descent = { pick: decision.path.at(-1), at: Date.now() }; save();
      console.log(`[end combat] the way down this fight: ${state.descent.pick}`);
    } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the way down was not chosen: ${String(err.message || err).slice(0, 100)}`); }
  };
  // The pass held through on the column, crouched with the shield up, a
  // second and a half (note 1414).
  // Beside the column's top (note 1659): a body a cell off its column at the top, on the crystal's tower or the block it stepped to, is within reach of the column cell and the pocket is built round that cell, the body centred on it first (note 1655); onOwnPillar wants the body within 0.95 of the cell's middle. 25588 (dragon-194, 2026-10-14 18:59Z, four crystals broken) stood at (-33.5, 85, 21.4) on the tower's top beside its column at (-34, 20), 1.4 off its middle, as the dragon came: no roof and no pocket were tried, the hold crouched with the shield, two blows of the body took 20 to 14.6 and carried it 14 blocks and 23 down, dead at (-48, 62, 5). The column cell must have two blocks under the feet's level and the body the same height.
  const nearOwnColumnTop = () => {
    const u = bot._pillarUp; if (!u || u.until < Date.now()) return false;
    const p = bot.entity.position, f = p.floored();
    if (f.y < 70 || Math.hypot(u.x + .5 - p.x, u.z + .5 - p.z) > 1.5) return false;
    return [1, 2].every(dy => bot.blockAt(new Vec3(u.x, f.y - dy, u.z))?.boundingBox === 'block') && bot.blockAt(new Vec3(u.x, f.y, u.z))?.boundingBox !== 'block';
  };
  // The dragon's pass waited out (note 1660): while it is within 40 blocks flat and within 30 of the body's height and not receding, the body holds crouched where it is, the roof over its head; returns how long and why it ended.
  const waitForThePass = async (maxMs = 25000) => {
    const phaseKey = bot.registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase');
    const theDragon = () => Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
    const t0 = Date.now(); let waited = false, why = 'no dragon in sight', roofed = false;
    for (;;) {
      check();
      const d = theDragon(); if (!d) break;
      const phase = d.metadata?.[phaseKey];
      if ([5, 6, 7, 9, 10].includes(phase)) { why = `the dragon perched (phase ${phase})`; break; }
      const p = bot.entity.position, flat0 = Math.hypot(d.position.x - p.x, d.position.z - p.z), height = d.position.y - p.y;
      if (flat0 > 40 || Math.abs(height) > 30) { why = `the dragon ${Math.round(flat0)} blocks off, ${Math.round(height)} ${height >= 0 ? 'above' : 'below'}`; break; }
      if (Date.now() - t0 > maxMs) { why = `${Math.round(maxMs / 1000)} s passed with the dragon still about, ${Math.round(flat0)} blocks off`; break; }
      await sleep(250);
      const d2 = theDragon(); if (!d2) break;
      const q = bot.entity.position, flat1 = Math.hypot(d2.position.x - q.x, d2.position.z - q.z);
      const closing = (flat0 - flat1) / 0.25;
      // The climb goes on only with the dragon beyond 40, or beyond 28 and going away (note 1664): dragon-198 (2026-10-14 19:50Z) climbed its last six with the dragon beyond 40, and it came the 40 in the three seconds of the climb and struck at the top, 20 to 13.6 to 10.9; the dragon flies 13 to 20 blocks a second.
      if (flat1 > 40 || (flat1 > 28 && closing < -2)) { why = waited ? `the dragon ${Math.round(flat1)} blocks off, ${closing < 0 ? `going away at ${Math.round(-closing)}` : `closing at ${Math.round(closing)}`} a second` : 'no pass coming'; break; }
      if (!waited) { waited = true; bot.setControlState?.('sneak', true); goal.step = { action: 'wait_for_the_pass', health: bot.health, dragonBlocksOff: Math.round(flat1) }; save(); }
      if (!roofed) { roofed = true; try { await roofOverhead(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } }
    }
    bot.setControlState?.('sneak', false);
    return { waited, ms: Date.now() - t0, why };
  };
  // On the ground, not on the bot's own column, its cell or an obsidian top (note 1662): there a far fireball is no emergency.
  const onTheGround = () => !onOwnPillar() && !onColumnCell() && !onObsidianTop();
  const holdOnColumn = async () => {
    // The roof first, on the bot's own column (note 1445): the dragon that
    // comes at the column breathes at it, and the fireball not seen in
    // flight bursts at the feet. 25588 (dragon-26, 2026-10-13 09:16Z) took
    // the first cloud at its feet, 20 to 14, before any fireball was seen,
    // and the roof laid against the second came too late.
    const atTheTop = nearOwnColumnTop();
    if (atTheTop && !onOwnPillar()) { try { await centreOnColumn(0.2, { maxMs: 600 }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } }
    if ((onOwnPillar() && !onObsidianTop()) || atTheTop) { try { await roofOverhead(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } }
    // And the pocket's walls (note 1575), from 70 up (the island's top is 64 and under; every carry that killed began at 71 to 95).
    // Only against the dragon's body coming, never against a fireball (note 1584): the cloud reaches through the walls, and a body sealed in with it has seconds of digging to get out. 25588 (dragon-127, 2026-10-14 05:13Z) died in its first pocket so; dragon-130 (05:49Z) left one at 0.3 health.
    // The pocket at any height (note 1824): the body was hit on its column below 70 as well; 25588's dragon-190 (2026-10-18 04:58Z) took the dragon's body at 63 and 69 on a walled climb, 20 to 15 to 13 to 10, was flung to 78 and died of the fall, the pocket never built for the gate at 70.
    if (((onOwnPillar() && !onObsidianTop()) || atTheTop) && dragonThreat(bot) && !breathThreat(bot)) {
      try { const t0 = Date.now(), r = await pocketOnColumn(); console.log(`[end combat] a pocket against the wings on the column at ${bot.entity.position.floored()}: ${r.laid} blocks laid, ${r.closed} of 4 sides closed${r.poolSideOpen ? ' (the pool\'s side left open for the drop)' : ''}, ${Date.now() - t0} ms, ${blocksCarried(bot)} blocks left`); }
      catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    }
    goal.step = { action: 'hold_on_pillar', hazard: endEmergency(bot), health: bot.health }; save();
    const shield = bot.inventory.slots?.[45]?.name === 'shield' || bot.inventory.items().some(i => i.name === 'shield');
    try {
      if (shield && bot.inventory.slots?.[45]?.name !== 'shield') { const it = bot.inventory.items().find(i => i.name === 'shield'); if (it) await bot.equip(it, 'off-hand'); }
      bot.setControlState?.('sneak', true);
      if (shield) bot.activateItem?.(true);
      // Faced the whole hold (note 1441): the shield stops only what comes
      // from in front, and the dragon crosses the column in a second. 25588
      // (dragon-23, 2026-10-13 08:41Z, leather) took 20 to 0.3 in one pass.
      // Let go the moment the breath is at the feet (note 1478): the roof is one
      // block over the head, and a ball from a dragon flying low passes under
      // its edge and bursts on the body, its cloud on the top. 25588
      // (dragon-60, 2026-10-13 15:14Z, full iron) roofed its column at 65,
      // held crouched at 63 through two such holds, the cloud at its feet
      // the whole time, and took 20 to 14.6 to 9.6 to 3.9 to none in three
      // seconds, the dig down never begun. The hold tells its caller 'cloud'.
      const was = bot.health;
      for (let n = 0; n < 15; n++) {
        task.check();
        // The cloud on the body, by its slab (note 1732), not breathThreat's margin: one block up out of a cloud (note 1724) leaves the body a block over it, inside the margin, and the hold called it 'cloud' and dug back down into it. 25588 (dragon-283, 2026-10-15 14:24Z) went '1 blocks up at (31, 65, 4)', then 'down the column from (31, 65, 4)' at once, 20 to 14 to 9 to none in a minute.
        const p = bot.entity.position, onBody = Object.values(bot.entities).some(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position.y > p.y - 1.8 && e.position.y <= p.y + 0.5 && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 0.3);
        if (onBody || bot.health < was - 0.5) return 'cloud';
        const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
        if (d && typeof bot.lookAt === 'function') { try { await bot.lookAt(d.position.offset(0, 2, 0), true); } catch (_) { /* looked already */ } }
        await sleep(100);
      }
      return 'held';
    } finally { try { bot.deactivateItem?.(); } catch (_) { /* nothing held */ } bot.setControlState?.('sneak', false); }
  };
  // A hold ended by the breath at the feet: three down the column, out of it.
  // The dragon charging the column (phase 8) with the pool below (note 1562):
  // off into it at once, not a hold. The hold, crouched with the shield, stands
  // the breath's knock; the charge is the dragon's body, and it carries what it
  // strikes. 25588 (dragon-112, 2026-10-14 02:39Z, two crystals broken) held
  // on its column at 71, 'hold on pillar', took the body twice (20 to 17.3 to
  // 15.5) and was carried 30 blocks to y 87 and dropped on the western rim.
  const chargeDrop = async () => {
    const d = dragonThreat(bot);
    if (!d || metadata(bot, d, 'phase') !== 8 || state.descent?.pick !== 'water_drop' || !state.pool || Date.now() - state.pool.at > 15 * 60000 || !(onOwnPillar() || onObsidianTop())) return false;
    console.log(`[end combat] the dragon charges the column at ${bot.entity.position.floored()}, ${Math.round(d.position.distanceTo(bot.entity.position))} off, the pool below: off into it`);
    goal.step = { action: 'charge_drop', health: bot.health }; save();
    return waterDrop();
  };
  // Up two out of the breath on the column (note 1666): two blocks laid are half a second, two dug in the column's end stone are two and a half with a stone pickaxe, and the cloud takes six a second. 25588 (dragon-201, 2026-10-14 20:37Z, one crystal broken) stood at (31, 72, -27) on its end-stone column with 10.8 health and three blocks carried as the cloud came to its feet, 'the breath at the feet during the hold: down the column', and the dig took 10.8 to 5.8 to none; dragon-198 (19:51Z) the same at 72 with 10.2. The bot's own roof over the head is dug first (half a second, its own cobblestone). Returns the blocks risen.
  // The lee wall before a climb out of the breath on a narrow top (note 1706, the wiring of note 1705's leeWall): each hit knocks the body away from the dragon, off a top one block wide; the arena's drill took the climb from 0 of 8 on the column to 8 of 8 with five blocks laid on the side away from the dragon, about two seconds with the climb. Only where fewer than two cells beside the feet have ground under the feet's level, seven or more blocks carried, and the dragon seen.
  const leeForClimb = async () => {
    const f = bot.entity.position.floored(), solid = c => bot.blockAt(c)?.boundingBox === 'block';
    // Twelve carried, not seven, and the cloud's centre the source (note 1707): the breath's damage comes from the cloud, whose centre is where the push comes from, not the dragon's; 25588 (dragon-249, 2026-10-15 08:16Z) laid two walls away from the dragon with eight blocks, three left each time, and was pushed off sideways both times (1.51 and 0.72 off its column), then dug down with none and died.
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(f.offset(dx, -1, dz))).length >= 2 || blocksCarried(bot) < 12) return 0;
    const cloud = Object.values(bot.entities).filter(e => e.name === 'area_effect_cloud' && e.isValid !== false).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
    // Away from the dragon after all (note 1708): the arena's drill with a real harming cloud found an ownerless cloud's push random in direction (east with the cloud 1.5 west and 1.5 east, west with it 0.8 east, whatever the dragon's place); the breath's clouds are the dragon's own, and the /damage drill with the dragon as the source pushed away from it every time.
    const from = d?.position || cloud?.position;
    if (!from) return 0;
    // Not at twelve health or under (note 1715): the wall takes about a second, the cloud's tick a second apart takes six, and the climb another second; at twelve the wall leaves no tick to spare. 25588 (dragon-257, 2026-10-15 09:42Z) had a fireball's cloud land on its roofed stub at (7, 63, 10) with the body on it, 20 to 9 by then, laid five in the wall, took six more and died at 3 before the climb; dragon-256 (09:37Z) the same on its stub at (20, 64, -4) at 14.9.
    if (bot.health <= 12) { console.log(`[end combat] no lee wall at ${f}: ${bot.health.toFixed(1)} health, a second for the wall is a tick of the cloud's six, and the climb goes first`); return 0; }
    let laid = 0; try { laid = await require('./pillar-recovery').leeWall(bot, task, from); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    console.log(`[end combat] the lee wall before the climb out of the breath at ${f}: ${laid} laid on the side away from the ${from === d?.position ? 'dragon' : `cloud's centre at ${cloud.position.floored()}`}, ${blocksCarried(bot)} blocks left`);
    return laid;
  };
  const upOutOfBreathOnColumn = async () => {
    if (blocksCarried(bot) < 2 || !actions.dig) return 0;
    const f0 = bot.entity.position.floored();
    for (const dy of [2, 3]) { const r = bot.blockAt(f0.offset(0, dy, 0)); if (r?.boundingBox === 'block') { if (/bedrock|obsidian|end_portal/.test(r.name)) return 0; try { await actions.dig(bot, task, r.position, { requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; return 0; } } }
    goal.step = { action: 'up_out_of_breath_on_column', health: bot.health }; save();
    await leeForClimb();
    // The feet on the ground first (note 1669, as note 1640 on the ground): knocked or dropping, the climb refused 'air under the feet'. 25588 (dragon-204, 2026-10-14 21:33Z) at (-4, 67, 12), 12.9 health, 10 blocks carried: '0 blocks up' twice in the cloud, then the hold and a fall to 8.3.
    bot.clearControlStates?.(); bot.pathfinder?.setGoal?.(null);
    for (let i = 0; i < 12 && !bot.entity.onGround; i++) { check(); await sleep(50); }
    if (!bot.entity.onGround) { console.log(`[end combat] up out of the breath on the column not tried at ${bot.entity.position.floored()}: the body in the air`); return 0; }
    // Centred on the column before the jump (note 1676, as note 1651 before the dig): a body off the middle of a one-wide column jumps off it. 25588 (dragon-211, 2026-10-14 23:22Z, six crystals broken) at (12, 81, 33) beside its column at (12, 34), 14 health, jumped for the two blocks, '-3 blocks up', and fell 23 to its death; dragon-209 (22:42Z) fell the same way from 87.
    // A second, looser centring before the climb is refused (note 1766): the refusal after half a second sent the body down the column through the cloud instead, and 25588's dragon-37, 76, 104 and 127 (2026-10-16/17) died within seconds of it, four of the nine runs that saw it; a jump from under 0.6 off a one-wide top stays on it (note 1695 measured 0.9 to 1.3 going off).
    if (bot._pillarUp && !(await centreOnColumn(0.2, { maxMs: 500 })) && !(await centreOnColumn(0.4, { maxMs: 800 }))) {
      const u = bot._pillarUp, off = Math.round(Math.hypot(u.x + .5 - bot.entity.position.x, u.z + .5 - bot.entity.position.z) * 100) / 100;
      // Up from where the body stands when the column is out of reach (note 1789): the breath's knockback puts the body one to two blocks off its stub, the centring fails, and the refusal sent it down the column into the cloud; six of 25588's nine deaths from dragon-150 to 158 (2026-10-17 18:3x to 20:1xZ) followed a failed climb out of a cloud on a stub ('not centred', '0 blocks up', 'not tried'). With solid ground under the feet and no water the climb goes up from the cell the body is in; its own stub is left standing.
      const underNow = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
      if (off > 0.6 && !(underNow?.boundingBox === 'block' && !inWater() && bot.entity.onGround)) { console.log(`[end combat] up out of the breath on the column not tried at ${bot.entity.position.floored()}: not centred on the column in 1.3 s, ${off} off, and ${underNow?.name || 'nothing'} under the feet`); return 0; }
      if (off > 0.6) { console.log(`[end combat] the climb out of the breath taken from the cell the body stands on at ${bot.entity.position.floored()}, ${off} off its column, ${underNow.name} under the feet`); delete bot._pillarUp; }
      console.log(`[end combat] the climb out of the breath on the column taken ${off} off its middle after 1.3 s of centring`);
    }
    const from = Math.floor(bot.entity.position.y);
    const want = upClear(from);
    try { await require('./pillar-recovery').pillarUp(bot, task, from + want, { dig: actions.dig, maxBlocks: want, threats: false, wet: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    const rose = Math.floor(bot.entity.position.y) - from;
    console.log(`[end combat] up out of the breath on the column: ${rose} blocks up at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health, ${blocksCarried(bot)} blocks left`);
    // The roof after this climb too (note 1716, as note 1672 after the ground's): the dragon's fireball is aimed at the body, and its cloud spawns where it bursts; on the roof it lies two over the feet, on the body it lies at the feet. 25588 (dragon-258, 2026-10-15 09:46Z) climbed two out of the breath at the foot of its column at (33, 62, -22) with seven blocks and no roof, the dragon 15 over and 7 aside, and the next fireball's cloud lay at (33.6, 62, -21.6), the feet's own height: 16 to 10 to 4 to none. Dragon-256 and 257 had their roofs and their clouds lay at the feet all the same (a fireball from the side); the roof answers only the one from above.
    if (rose >= want) await roofTheStub();
    return rose;
  };
  const holdOrDown = async () => {
    if (await chargeDrop()) return;
    if (await holdOnColumn() !== 'cloud') return;
    // The cloud below the feet, the body out of it (note 1576): the way down would end in it; the hold stays.
    if (breathThreat(bot)?.name !== 'area_effect_cloud') { const c = cloudUnderfoot(3); if (c) { console.log(`[end combat] the hold stays up at ${bot.entity.position.floored()}: ${cloudUnderfootSays(c)}`); return; } }
    if (await upOutOfBreathOnColumn() >= 1) return;
    console.log(`[end combat] the breath at the feet during the hold at ${bot.entity.position.floored()}, health ${bot.health.toFixed(1)}: down the column`);
    goal.step = { action: 'down_out_of_breath', health: bot.health }; save();
    await wayDown({ limit: 3 });
  };
  // The stub roofed after the climb out of the cloud (note 1672): the dragon in flight aims its fireballs at the body, the next one lands on the stub's top where the body stands, and the climb is asked again, two blocks a time; 25588's runs 193, 197 and 203 of 2026-10-14 climbed out 27, 44 and 14 times, and dragon-206 (22:07Z) went up one and dug one by turns on its stub at (-20, 64, 34) as the clouds came, 20 to none. Standing two blocks over a cloud's base is safe (209 readings of 'the cloud lies 2 blocks below' today with no hit after, one with); the next ball is the danger. With six blocks carried and the dragon not perched, the roof is laid over the head (its post up the stub's side where nothing stands beside), and the next ball bursts on it.
  // Under the perched dragon within 20 of the fountain (note 1690), the stub is where the next breath lands: 25588 (dragon-223, 2026-10-15 02:06Z, three crystals broken) went two up out of one cloud onto a stub at (9, 65, -7), 11 from the fountain, and the next breath came to the stub's top, 11.7 to 5.7 to none; dragon-203 (21:24Z) and 215 (00:16Z) died the same way at the fountain's edge. The hole 7 to 11 blocks from the fountain is untouched by the breath (note 1616's drill): the body digs down through its own stub and two into the island under it, and roofs the hole. Out of the cloud after the two up, back through its height for under a second on the way down.
  const holeThroughTheStub = async () => {
    if (!actions.dig) return false;
    const f = bot.entity.position.floored(), solid = c => bot.blockAt(c)?.boundingBox === 'block';
    if (![1, 2, 3, 4, 5, 6].every(dy => solid(f.offset(0, -dy, 0))) || voidEdge(bot, bot.entity.position, 4) !== null) return false;
    goal.step = { action: 'hole_through_the_stub', health: bot.health }; save();
    const t0 = Date.now(); let dug = 0;
    for (let n = 0; n < 4 && Date.now() - t0 < 4000; n++) {
      const g = bot.entity.position.floored();
      const closed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(g.offset(dx, 0, dz)) && solid(g.offset(dx, 1, dz))).length;
      if (closed >= 4) break;
      if (!solid(g.offset(0, -1, 0)) || !solid(g.offset(0, -2, 0))) break;
      const off = bot._pillarUp ? Math.hypot(bot._pillarUp.x + .5 - bot.entity.position.x, bot._pillarUp.z + .5 - bot.entity.position.z) : 0;
      if (off > 0.3) { await centreOn(bot._pillarUp.x, bot._pillarUp.z, 0.2, { maxMs: 500 }); }
      try { await actions.dig(bot, task, g.offset(0, -1, 0), { dropInto: true, openPit: true, requireDrops: false }); dug++; } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; break; }
      for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50);
    }
    let roofed = false;
    try { roofed = await roofHole(true); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    const g = bot.entity.position.floored(), closed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(g.offset(dx, 0, dz)) && solid(g.offset(dx, 1, dz))).length;
    console.log(`[end combat] down through the stub into a hole at ${g} under the perched dragon: ${dug} dug, ${closed} of 4 sides closed, roof ${roofed ? 'laid' : 'not laid'}, ${Date.now() - t0} ms, ${bot.health.toFixed(1)} health`);
    return closed >= 4;
  };
  const takeTheStubBack = async () => {
    const u = bot._pillarUp; if (!u || u.until < Date.now() || u.base == null || !onOwnPillar()) return false;
    const depth = columnDepth(); if (depth < 1 || depth > 3 || !actions.dig || !pickCarried() || inWater()) return false;
    const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e)); if (!d) return false;
    const off = Math.round(d.position.distanceTo(bot.entity.position));
    if (off < 22 || breathThreat(bot) || cloudUnderfoot(3) || hostileEntities(bot, 8).some(e => live(bot, e) && e.name !== 'ender_dragon')) return false;
    const before = blocksCarried(bot), f = bot.entity.position.floored(), y0 = f.y;
    goal.step = { action: 'take_the_stub_back', height: depth, blocksCarried: before, dragonBlocksOff: off }; save();
    const cells = [f.offset(0, 2, 0), ...[[1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([dx, dz]) => [2, 1, 0].map(dy => f.offset(dx, dy, dz)))].filter(c => c.y > u.base && SCAFFOLD_UNDER.test(bot.blockAt(c)?.name || ''));
    let roof = 0;
    for (const c of cells) {
      check(); if (endEmergency(bot, { ground: onTheGround() })) break;
      try { await actions.dig(bot, task, c, { requireDrops: false }); roof++; } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; break; }
    }
    if (!endEmergency(bot, { ground: onTheGround() })) { try { await digDownColumn({ limit: depth }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } }
    for (let i = 0; i < 10 && blocksCarried(bot) < before + roof + (y0 - Math.floor(bot.entity.position.y)); i++) { check(); await sleep(100); }
    state.stubsTakenBack = (state.stubsTakenBack || 0) + 1;
    console.log(`[end combat] the stub at (${f.x}, ${f.z}) taken back: ${roof} roof blocks and ${y0 - Math.floor(bot.entity.position.y)} of the column dug, ${before} to ${blocksCarried(bot)} blocks carried, the dragon ${off} off; ${state.stubsTakenBack} this fight`);
    return true;
  };
  // Said on a stub (note 1818): the stubs built and the fireball clouds taken on them this fight and across the stage's record.
  const stubRecordSays = () => { const st = state.lastStub, f = bot.entity.position.floored(); if (!st || Math.abs(f.x - st.x) > 1 || Math.abs(f.z - st.z) > 1 || f.y < st.y - 1 || Math.floor(bot.entity.position.y) - 62 > 6) return null; const n = state.stubs || { built: 0, hit: 0 }; return `on a stub ${st.roofed ? 'roofed over' : 'with no roof'}, two or more up out of the breath: a fireball bursting on the stub's side lays its cloud at the feet, roof or none (this fight ${n.hit} of ${n.built} stubs took the next fireball's cloud on the body; 25588's dragon-172, 177, 181, 184 and 187 of 2026-10-18 died so); a hole two deep with its roof takes the burst on the roof, the cloud two over the head, and the dig down from here (pillar_down) ends in the cloud below only while it lasts, about thirty seconds from its fall`; };
  bot._roofOverhead = roofOverhead; // note 1847: end safety roofs the hole it sends the body back into
  // The wall toward the fireball (note 1881): the fireball flies nearly level from a dragon twenty blocks off and bursts on the first thing it meets; a roof two thick over the head (note 1878) is not in its way, and it burst on the body on its roofed stub in 25588's dragon-205, 216, 223, 225 and 228 (2026-10-18), 'the fireball's cloud on the body on its stub', six a second from a cloud at the body's own height. Two blocks on the side toward the ball, or toward the dragon when no ball is in flight, take the burst instead, the cloud a block off and a block over.
  const wallTowardTheBall = async ({ maxMs = 1200 } = {}) => {
    if (blocksCarried(bot) < 3) return 0;
    const feet = bot.entity.position.floored();
    const ball = Object.values(bot.entities).filter(e => e.name === 'dragon_fireball' && e.isValid !== false).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    const d = ball || Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
    if (!d) return 0;
    const mirror = new Vec3(2 * (feet.x + .5) - d.position.x, feet.y, 2 * (feet.z + .5) - d.position.z);
    let laid = 0;
    try { laid = await require('./pillar-recovery').leeWall(bot, task, mirror, { maxMs }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
    if (!(state.ballWallSaid > Date.now() - 5000)) { state.ballWallSaid = Date.now(); console.log(`[end combat] the wall toward the ${ball ? 'fireball' : 'dragon'} at ${feet}: ${laid} laid on its side, ${blocksCarried(bot)} blocks left`); }
    return laid;
  };
  const roofTheStub = async () => {
    const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
    // The hole through the stub fell short three times in four (note 1694: dragon-229 and 230, 2026-10-15, '2 dug, 0 of 4 sides closed' twice and '4 dug, 1 of 4 sides closed, 9186 ms' once, against one '4 dug, 4 of 4, roof laid, 5970 ms'); when it fails the stub is roofed as before, and the dig is given four seconds.
    // The hole through the stub withdrawn (note 1696): it closed four sides once in six tries on 2026-10-15 (dragon-229, 230, 233), the dig of the stub and the island under it running 1.8 to 9.2 seconds under the perched dragon with nothing over the head, and dragon-233 (04:41Z, seven crystals broken, three standing) died inside it, '3 dug, 0 of 4 sides closed, 6385 ms, 0.0 health'. The stub is roofed in a fifth of a second; the perched dragon gets the roof too.
    // Roofed whether or not the dragon is tracked this tick (note 1813): 'not laid, 0 ms' came from a dragon out of the entity list, and the fireball comes all the same; 25588's dragon-182 (2026-10-18 02:19Z) at (49, 57, 7) and dragon-179 at (35, 77, 22) before its death had their stubs refused so.
    if (blocksCarried(bot) < 6) return false;
    const t0 = Date.now();
    let roofed = false;
    try { roofed = await roofOverhead(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    console.log(`[end combat] the stub at ${bot.entity.position.floored()} roofed against the next fireball: ${roofed ? 'laid' : 'not laid'}, ${Date.now() - t0} ms, ${blocksCarried(bot)} blocks left`);
    if (roofed) await wallTowardTheBall();
    // The stub's record (note 1818): a fireball bursting on the stub's side lays its cloud at the feet, roof or none, and 25588's dragon-172, 177, 181, 184 and 187 (2026-10-18) died so; a hole two deep roofed takes the burst on its roof, the cloud two over the head. Counted here and said on the stub.
    { const f = bot.entity.position.floored(); state.stubs ||= { built: 0, hit: 0 }; state.stubs.built++; state.lastStub = { x: f.x, y: f.y, z: f.z, at: Date.now(), roofed: !!roofed }; save(); }
    // Walled on all four sides too, out of the dragon's sight (note 1721): the dragon fires only with a clear line from its eyes to the bot's for a quarter second, and a fireball bursting within four blocks of the feet moves its cloud onto the body (the arena, 2026-10-15 10:2xZ: a burst two blocks off put the cloud at the feet, 20 to 8; three and a half off and more, none). The roof alone leaves the sides open; 25588's dragon-256, 257, 258, 259 and 263 (2026-10-15 09:37 to 10:10Z) took a fireball's cloud at the feet on their stubs, roofed or not, five of eight deaths. With the roof laid and twelve blocks carried, the four sides at the feet and the head close the line of sight.
    // Twelve left after the walls, not twelve before them (note 1726): the walls are nine, and a stub's climb and roof out of the next cloud is three; 25588 (dragon-270, 2026-10-15 11:3xZ) walled at 12 and had 4, then 0 at the next cloud, and died in it; dragon-266 the same at 13.
    // Withdrawn as a reflex (note 1734): the walls were laid at every roofed stub whatever was coming, nine blocks each, and the bot left each within seconds; 25588's runs 252 to 264 (before note 1721, 2026-10-15 08:3x to 10:2xZ) broke 21 crystals in 13 runs, 265 to 287 (after) 19 in 23, with four deaths in five at none or one block carried. The same shelter is Jev's to choose when the dragon strafes (seal_against_strafe, note 1731), where it held through every throw.
    if (false && roofed && blocksCarried(bot) >= 21 && !perched(bot, d)) {
      try { const t1 = Date.now(), r = await pocketOnColumn({ allSides: true }); console.log(`[end combat] the stub at ${bot.entity.position.floored()} walled out of the dragon's sight: ${r.laid} laid, ${r.closed} of 4 sides closed, ${Date.now() - t1} ms, ${blocksCarried(bot)} blocks left`); }
      catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    }
    return roofed;
  };
  // The hole dug before the pass (note 1674): the body's call comes within 12 blocks, under a second before the blow, and the hole of note 1667 gets one block a call; the dragon in flight is seen coming from 32 blocks, two and a half seconds off at 13 a second, time for two blocks with the iron pickaxe. 25588 (dragon-208, 2026-10-14 22:29Z, one crystal broken) took three passes of the body in a minute on open ground, 14.6 to 9.2, 6.5 to 3.8, and 11.8 to 6.4 a second after it left its roofed hole to quarry, and was carried 90 blocks into the void; dragon-200, 202 and 204 died of the body on open ground the same evening. On diggable ground clear of the void and water, with the dragon flying within 32 and closing at four a second or more, a block is dug under the feet toward a hole two deep; in a hole two deep the body holds while the dragon is within 24. Nothing is dug on the bot's own column, its cell or an obsidian top, nor in a hole already.
  // The dragon coming at the quarry (note 1703): the quarry's loop of cells, a second each, ran on with the dragon closing, and the body was thrown from it before the step ended and the hole before the pass (note 1674) could be dug. 25588 (dragon-240, 2026-10-15 06:22Z, three crystals broken) was thrown 5.7 up from its quarry at (-1, 67, -8) and died of the fall; dragon-242 (06:43Z) the same at (-6, 67, 6), 5.1 up. Before each cell, with the dragon flying within 32 and closing at four a second or more, the quarry ends.
  const dragonComingAtQuarry = () => {
    const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
    if (!d || perched(bot, d)) { state.quarryTrack = null; return false; }
    const p = bot.entity.position, flat = Math.hypot(d.position.x - p.x, d.position.z - p.z), now = Date.now();
    const last = state.quarryTrack; state.quarryTrack = { t: now, flat };
    const closing = last && now - last.t > 0 && now - last.t < 3000 ? (last.flat - flat) / ((now - last.t) / 1000) : 0;
    // A pass about to land, not the circle (note 1704): within 32 and closing at four stopped dragon-244's quarries eight times in ten minutes (2026-10-15 07:12 to 07:22Z), no crystal broken, blocks 14 to 8; within 24 and closing at six is two to four seconds out.
    return flat < 24 && closing >= 6 && Math.abs(d.position.y - p.y) < 30;
  };
  const holeBeforeThePass = async () => {
    if (!actions.dig || !onTheGround() || inWater()) return false;
    // Under the open sky only (note 1751, as end safety's hole for the body): with stone over the head the body is underground already.
    { const g = bot.entity.position.floored(); if ([2, 3, 4, 5, 6, 7, 8].some(dy => bot.blockAt(g.offset(0, dy, 0))?.boundingBox === 'block')) return false; }
    const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
    if (!d || perched(bot, d)) { state.dragonTrack = null; return false; }
    const p = bot.entity.position, flat = Math.hypot(d.position.x - p.x, d.position.z - p.z), now = Date.now();
    const last = state.dragonTrack; state.dragonTrack = { t: now, flat };
    const closing = last && now - last.t > 0 && now - last.t < 3000 ? (last.flat - flat) / ((now - last.t) / 1000) : 0;
    const f = p.floored(), solid = c => bot.blockAt(c)?.boundingBox === 'block';
    const sidesClosed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(f.offset(dx, 0, dz)) && solid(f.offset(dx, 1, dz))).length;
    if (sidesClosed >= 4) {
      if (flat > 24 || Math.abs(d.position.y - p.y) > 30) return false;
      if (!(state.holdInHoleSaid > now - 5000)) { state.holdInHoleSaid = now; console.log(`[end combat] held in the hole at ${f}: the dragon ${Math.round(flat)} blocks off${closing > 0 ? `, closing at ${Math.round(closing)} a second` : ''}`); }
      goal.step = { action: 'hold_in_hole_for_the_pass', dragonBlocksOff: Math.round(flat) }; save();
      bot.setControlState?.('sneak', true); await sleep(300); bot.setControlState?.('sneak', false);
      return true;
    }
    if (!(flat < 32 && closing >= 4 && Math.abs(d.position.y - p.y) < 30)) return false;
    const thick = [1, 2, 3, 4, 5, 6].every(dy => solid(f.offset(0, -dy, 0)));
    const { voidSides, deepBeside } = require('./end-safety');
    const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => /water/.test(bot.blockAt(f.offset(dx, 0, dz))?.name || '') || /water/.test(bot.blockAt(f.offset(dx, -1, dz))?.name || ''));
    // Ground, not a stub's top (note 1697): with no column record the stub reads as ground, and a hole dug in a top one block wide drops the body off it. 25588 (dragon-234, 2026-10-15 05:0xZ) dug 'the hole before the pass' at (14, 67, -7), the top of a stub with air round it, 'column undefined', and fell from (13, 68, -6), 14.8 health. Two or more of the four cells beside the feet must have ground at the feet's level less one.
    const groundBeside = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(f.offset(dx, -1, dz))).length;
    if (groundBeside < 2) return false;
    if (!thick || wet || voidSides(bot, p) > 0 || deepBeside(bot, p) || !bot.entity.onGround) return false;
    // No hole by hand (note 1816, as notes 1763 and 1779 for the body's hole): end stone bare-handed is fifteen seconds a block, the body in the open the while; 25588's dragon-186 (2026-10-18 03:12Z, one crystal, 233 blocks, no pickaxe) began 'the hole dug under the feet before the pass (0 of 4 sides closed)' at (-39, 62, -13), the fireball's cloud landed on it there, 20 to 14 to 8 to none.
    if (!pickCarried()) { if (!(state.noPickHoleSaid > Date.now() - 20000)) { state.noPickHoleSaid = Date.now(); console.log(`[end combat] the dragon coming and no pickaxe carried: no hole dug by hand at ${f} before the pass`); } return false; }
    goal.step = { action: 'hole_before_the_pass', dragonBlocksOff: Math.round(flat), closing: Math.round(closing), sidesClosed }; save();
    console.log(`[end combat] the dragon coming at ${Math.round(closing)} a second, ${Math.round(flat)} blocks off: the hole dug under the feet at ${f} before the pass (${sidesClosed} of 4 sides closed now)`);
    bot.clearControlStates?.(); bot.pathfinder?.setGoal?.(null);
    // Both blocks in the one call (note 1681): a block a call left a pit one deep when the next call came late, and a pit one deep is no hole. 25588 (dragon-216, 2026-10-15 00:31Z, two crystals broken) dug one at (-1, 60, 24) with the dragon 23 off and closing, the step went on, and three blows of the body took 8.6 to 3.2 before the second was dug; dragon-215 and 214 the same. The second block goes while the dragon is still within 40 and the cell is not yet closed on four sides.
    // Its own dragon lookup (note 1802): theDragon of the hold's scope was out of reach here, and the second block's call threw 'theDragon is not defined' (25588's dragon-175, 2026-10-18 00:2xZ, the dragon 11 blocks off closing at 12 a second), the step ending with the pit one deep.
    const theDragon = () => Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e));
    for (let n = 0; n < 2; n++) {
      const g = bot.entity.position.floored();
      const closed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(g.offset(dx, 0, dz)) && solid(g.offset(dx, 1, dz))).length;
      if (closed >= 4) break;
      if (n > 0) { const d2 = theDragon(); if (!d2) break; const q = bot.entity.position; if (Math.hypot(d2.position.x - q.x, d2.position.z - q.z) > 40) break; if (!solid(g.offset(0, -2, 0)) || !solid(g.offset(0, -3, 0))) break; }
      try { await actions.dig(bot, task, g.offset(0, -1, 0), { dropInto: true, openPit: true, requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; break; }
      for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50);
    }
    { const g = bot.entity.position.floored(); const closed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(g.offset(dx, 0, dz)) && solid(g.offset(dx, 1, dz))).length; console.log(`[end combat] the hole before the pass at ${g}: ${closed} of 4 sides closed`); }
    return true;
  };
  const respond = async () => {
    // Emergency handlers must not trip the guard that interrupted ordinary
    // planning. They still retain cancellation and the caller's guard.
    task.interruptCheck = oldInterrupt; stepCut = null;
    // The cut step's walk let go first (note 1691): a run cut by an emergency leaves its pathfinder goal and keys behind, and the body walks on while the response digs. 25588 (dragon-225, 2026-10-15 02:26Z, three crystals broken) had dig_to_sky cut on its two-block stub at (-11, 64, -37), the response dug down into the stub, and the body walked north-east at eight tenths a second off the stub into the cloud, (-10.5, -36.5) to (-9.2, -34.2) in three seconds, 20 to none; dragon-193 (18:39Z) saw 'the dig under the feet was stopped by something else (pathing true, goal set)'. The falls off columns on the dig down (209, 211, 212, 219) may be the same walk.
    bot.pathfinder?.setGoal?.(null); bot.pathfinder?.stop?.(); bot.clearControlStates?.();
    if (fallDanger(bot)) await recoverFall(bot, task, goal, save);
    // On its own pillar, nothing but air round the feet (note 1414): there
    // is no walking escape from the dragon's pass, and looking for one threw
    // 'No surveyed walking escape' twice a second for as long as the dragon
    // circled near (the arena's drill of 2026-10-13, 03:28Z, thirteen up a
    // pillar beside a crystal's). The pass is held through instead, crouched
    // with the shield up, a second and a half; the step then goes on, to the
    // climb or the way down.
    // The stub out of the breath is held, not dug (note 1648): the two laid out of the cloud (note 1636) made a column of two, the fireball's or the cloud's emergency on it was answered with the dig down three, and the body went back into the cloud at the foot, up two, down two, until dead; 25588 (dragon-182, 2026-10-14 16:26Z, no crystal broken) at (62, 48 to 50, -27), and dragon-171 and 174 before it. With the column short and a cloud within three below, the body holds on the stub, crouched, until the cloud is gone.
    else if (onOwnPillar() && ['dragon_breath_cloud', 'incoming_dragon_fireball'].includes(endEmergency(bot)) && columnDepth() <= 3 && cloudNearBelow(3) && !cloudOnBody()) {
      goal.step = { action: 'hold_on_stub_over_cloud', health: bot.health }; save();
      console.log(`[end combat] held on the stub at ${bot.entity.position.floored()}: ${cloudUnderfootSays(cloudNearBelow(3))}`);
      if (endEmergency(bot) === 'incoming_dragon_fireball') await roofOverhead();
      await holdOnColumn();
    }
    // A fireball at a short column (note 1663): the way down by the drop puts the body in the pool's trench, an open hole beside the column, and a fireball's cloud lands in open holes (the drill of note 1616); the column's own blocks are cobblestone, half a second each to a pickaxe, and two dug put the body under the cloud as in a hole. 25588 (dragon-197, 2026-10-14 19:45Z, no crystal in 28 minutes, no block carried) had a fireball called at (31, 61, -23), two up its column, 'a roof against the fireball over the head: not laid', dropped three into its pool at (31, 58, -20), 'out of the trench: still in the water (no rim found beside)', and the cloud took 20 to 14 to 8 to 2 to none in the water, 'hurt without a survival response'. With no cloud under the column the dig goes first on a column of four or under.
    // Only with the ball still far (note 1853): the two blocks dug take three seconds and the ball flies one or two, and the half-dug hole is its cup; roofed first (note 1842) or not, 25588's dragon-202, 207 and 212 (2026-10-18 10:08 to 13:11Z) died in it, six of the fifteen uses of this branch. Within fourteen blocks the roof goes on and the body holds under it (the branch below).
    // Retired (note 1855): with the ball still beyond fourteen (note 1853) the two blocks were dug and 25588's dragon-215 (2026-10-18 13:50Z) died in the half-dug hole all the same, the fourth in a row after 202, 207 and 212, seven of sixteen uses fatal. The roof and the hold below take every fireball at a short column now.
    else if (false && onOwnPillar() && endEmergency(bot) === 'incoming_dragon_fireball' && columnDepth() >= 2 && columnDepth() <= 4 && !cloudNearBelow(3) && actions.dig && !Object.values(bot.entities).some(e => e.name === 'dragon_fireball' && e.isValid !== false && e.position.distanceTo(bot.entity.position) < 14) && bot.blockAt(bot.entity.position.floored().offset(0, 2, 0))?.boundingBox !== 'block') {
      goal.step = { action: 'down_the_short_column_from_fireball', health: bot.health, depth: columnDepth() }; save();
      // The roof before the dig (note 1842): the two blocks dug take about three seconds and the fireball flies one or two, so it burst on the half-dug rim at the body's level; 3 of the 12 such digs on 25588 ended in death, dragon-202 (2026-10-18 10:08Z) the last, 20 to 14 to 8 to none at (31, 63, 26). A roof is a block and half a second; the burst meets it two over the head, and the dig goes on under it.
      let roofedFirst = false; try { roofedFirst = await roofOverhead(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
      console.log(`[end combat] the fireball at the short column (${columnDepth()} high) at ${bot.entity.position.floored()}: ${roofedFirst ? 'roofed, then ' : 'no roof laid; '}two dug down into it, not the drop into the pool's trench`);
      await digDownColumn({ limit: 2 });
    }
    // Off a short column and away from a fireball (note 1899): three blocks or fewer up, the step off costs nothing and the run out of the ball's line answers it (note 1892); the hold under a roof did not, the ball bursting on the column's side at the body's height. 25588's dragon-267 (2026-10-19 06:4xZ) on its column two up at (-38, 59, -28): 'a roof ... laid', 'the wall toward the fireball ... 1 laid', 'the fireball's cloud on the body: 20.0 to 14.0'.
    else if (onOwnPillar() && endEmergency(bot) === 'incoming_dragon_fireball' && columnDepth() <= 3 && !cloudOnBody() && bot.entity.onGround) {
      goal.step = { action: 'off_the_short_column_from_fireball', health: bot.health, depth: columnDepth() }; save();
      const p0 = bot.entity.position.floored(), h0 = bot.health;
      try { await evadeDragon(bot, task, goal, save, { allowed: p => policy.allowedPoint(p) && safeFromHostiles(bot, p, endMobs(bot)), timeoutMs: 1600, dig: actions.dig }); }
      catch (err) { if (err.name !== 'NoEscape') throw err; console.log(`[end combat] no run from the fireball off the short column at ${p0}: ${String(err.message || err).slice(0, 90)}; the hold instead`); await holdOrDown(); }
      console.log(`[end combat] off the short column (${p0.y - (bot._pillarUp?.base ?? p0.y)} up) from the fireball at ${p0}: now at ${bot.entity.position.floored()}, ${h0.toFixed(1)} to ${bot.health.toFixed(1)} health`);
    }
    else if (onOwnPillar() && (!groundAbout() || cloudOnBody()) && ['dragon_breath_cloud', 'incoming_dragon_fireball'].includes(endEmergency(bot))) {
      // The seconds between the cut and the answer said (note 1854): 25588's dragon-214 (2026-10-18 13:44Z) had its descent cut by a cloud on the body at (35, 59, 22) and died 20 to 14 to 8 to none with no line between; where the two seconds went is the question.
      if (state.lastCutAt) console.log(`[end combat] the breath on the column at ${bot.entity.position.floored()}: ${Date.now() - state.lastCutAt} ms since the step was cut (${Number(state.lastCutHealth).toFixed(1)} to ${bot.health.toFixed(1)} health), ${endEmergency(bot)}`);
      // The breath on the column, or a fireball coming (its cloud lands where
      // the bot stands): a shield does not stop it (Instant Damage, magic),
      // the drill of 2026-10-13 (05:35Z) died holding in it, 4 a time to none,
      // and 25588 (dragon-9, 06:05Z) held with the shield up for a fireball,
      // 20 to 8 in six seconds, and died of the next at 06:06Z. The cloud lies
      // on the top; three blocks down the column is under it.
      // A fireball coming: a roof over the head first (note 1442), laid
      // against the obsidian beside the column; the ball bursts on the roof
      // and its cloud lies on top of that, three blocks over the feet, where
      // the body is not. Of the 84 blows the dragon landed on 25588 today
      // (dragon-6 to dragon-23, 2026-10-13), 70 were its breath, 6 a second
      // whatever is worn; the dig down out of it was three blocks and some
      // three seconds, 18 health. With no roof to lay, the dig as before.
      if (endEmergency(bot) === 'incoming_dragon_fireball' && await roofOverhead()) {
        goal.step = { action: 'roof_against_fireball', health: bot.health }; save();
        await wallTowardTheBall();
        await holdOrDown();
      } else {
        // Held where the cloud is only near, not on the body (note 1733): one up out of it (note 1724) is a block over it, within breathThreat's margin, and this way dug back down into it. 25588 (dragon-285, 2026-10-15 14:45Z) went '1 blocks up at (-1, 63, 23)', then 'down the column ... 1 dug' at once, 20 to 10 to none.
        // The climb out in the same tick when the hold ends in the cloud (note 1857): the hold returned at the first hit and the step returned with it, and the next tick's climb came two seconds and ten health later; 25588's dragon-216 (2026-10-18 14:28Z, three crystals) held over a cloud on its roofed stub at (17, 64, 36), took the next fireball's cloud there, 20 to 14 to 10 to none, the handler having answered in 2 ms.
        if (!cloudOnBody() && endEmergency(bot) === 'dragon_breath_cloud') { goal.step = { action: 'hold_over_cloud', health: bot.health }; save(); const held = await holdOnColumn(); if (held === 'cloud' && blocksCarried(bot) >= 2 && !onObsidianTop()) { const h0 = bot.health; let rose = 0; try { rose = await upOutOfBreathOnColumn(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } console.log(`[end combat] the hold over the cloud ended in it at ${bot.entity.position.floored()}: up ${rose} out of it at once, ${h0.toFixed(1)} to ${bot.health.toFixed(1)} health`); } return; }
        if (breathThreat(bot)?.name === 'area_effect_cloud' && await upOutOfBreathOnColumn() >= 1) return;
        goal.step = { action: 'down_out_of_breath', health: bot.health }; save();
        await wayDown({ limit: 3 });
      }
    }
    // On the obsidian top (no walk off it either): the breath or a fireball
    // sends the bot back to its column and three down; a pass is held through.
    else if (onObsidianTop() && ['dragon_breath_cloud', 'incoming_dragon_fireball'].includes(endEmergency(bot))) {
      goal.step = { action: 'off_the_top_out_of_breath', health: bot.health }; save();
      if (await backToColumn()) await wayDown({ limit: 3 });
    }
    else if (onOwnPillar() && !groundAbout()) await holdOrDown();
    else if (onObsidianTop()) {
      // Back into the column's pocket before the hold when the body's call comes on the stand (note 1788): the stand is the pillar's cap, one thick with the void beside, no run and no hole, and the crouch stops nothing. 25588's dragon-155 (2026-10-17 19:5xZ, two crystals from climbs walled on every level) struck crystal 1875 and was charged on the stand at (-9, 88, -36) before it stepped back, fell 26 to (-8, 62, -36), and the clutch found no floor within five until the ground.
      if (endEmergency(bot) === 'dragon_charge_or_contact' && nearOwnColumnTop() && !onColumnCell()) { const t0 = Date.now(); let back = false; try { back = await backToColumn(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } console.log(`[end combat] the body's call on the stand at ${bot.entity.position.floored()}: back to the column ${back ? 'there' : 'not reached'}, ${Date.now() - t0} ms`); }
      if (await holdOnColumn() === 'cloud' && await backToColumn()) await wayDown({ limit: 3 });
    }
    else {
      // Out of the dragon's way by ground no mob stands near, and where
      // there is none, by any ground (note 1174): an enderman's blow is
      // seven, the dragon's head ten and again each second it is stood in.
      // The rehearsal of 2026-10-04 (04:44 to 04:48Z), turned endermen
      // seven to twenty blocks off, found "no surveyed walking escape"
      // twenty-six times and stood by the fountain as the dragon came down
      // on it, 20 health to none in four touches.
      // In the breath on the ground (note 1560): one short run, and where it
      // goes nowhere, down or up at once, not a second survey. The breath's
      // cloud is read a tick late, and each survey with its run is a second
      // and a half in a cloud that takes six a second: 25588 (dragon-110,
      // 2026-10-14 02:27Z, two crystals broken) stood among its quarry's pits,
      // 'evade breath straight' four times, moved nowhere, 20 to none;
      // dragon-111 (02:28Z) on the ledge under the entry platform the same,
      // 20 to none in three seconds, the way up never reached.
      // Back onto the column's cell first when the body's call comes beside the column's top (note 1799, as note 1788 for the stand): knocked one cell off onto a ring block, the body stands on 'ground 1 thick' with no run and no hole, and the crouch stops nothing. 25588's dragon-170 (2026-10-17 23:47Z, two crystals in eight minutes) died so at (-9, 79, -38) beside its column at (-10, -38), 16 to 5 to none.
      if (endEmergency(bot) === 'dragon_charge_or_contact' && nearOwnColumnTop() && !onColumnCell() && bot.entity.onGround) { const t0 = Date.now(); let back = false; try { back = await backToColumn(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } console.log(`[end combat] the body's call beside the column's top at ${bot.entity.position.floored()}: back to the column ${back ? 'there' : 'not reached'}, ${Date.now() - t0} ms`); if (back && onOwnPillar()) { await holdOrDown(); return; } }
      const inBreath = () => breathThreat(bot)?.name === 'area_effect_cloud' || (breathThreat(bot) && bot._lastDragonHurtAt && Date.now() - bot._lastDragonHurtAt < 1500);
      // Hurt by the dragon within three seconds and not in the breath by the geometry, said (note 1765): the clouds seen, their distance, height and radius, so a cloud that hurts outside its measured layer is caught.
      if (!inBreath() && bot._lastDragonHurtAt > Date.now() - 3000 && !(state.notInBreathSaid > Date.now() - 2000)) { state.notInBreathSaid = Date.now(); const clouds = Object.values(bot.entities).filter(e => e.name === 'area_effect_cloud' && e.isValid !== false).map(e => `${Math.round(Math.hypot(e.position.x - bot.entity.position.x, e.position.z - bot.entity.position.z) * 10) / 10} off, ${Math.round((e.position.y - bot.entity.position.y) * 10) / 10} up, radius ${Math.round(cloudRadius(bot, e) * 10) / 10}`); console.log(`[end combat] hurt by the dragon ${Math.round((Date.now() - bot._lastDragonHurtAt) / 100) / 10} s ago at ${bot.entity.position.floored()} and not in the breath by the geometry: ${endEmergency(bot, { ground: onTheGround() }) || 'no emergency'}; clouds ${clouds.length ? clouds.join('; ') : 'none seen'}`); }
      // Up two first in the cloud (note 1636): the walking escapes are tried for 0.7 and 1.6 seconds before the two blocks up (note 1583), and the cloud takes six a second. 25588 (dragon-165, 2026-10-14 12:57Z, no crystal broken) stood in its pool's pit at (-13, 59, 35) as a fireball's cloud filled it, 20 to 15 to 9.6 to 3.8 to none in three seconds, 'hurt without a survival response', 34 blocks carried; dragon-160 (11:34Z) the same in its pit. Two blocks laid are half a second and the body is out of a cloud half a block deep.
      {
        const f0 = bot.entity.position.floored();
        // Under the bot's own roof (note 1641): a block two over the feet stops the jump and is dug first; a block three over leaves room for one up, and one up is out of a cloud half a block deep. 25588 (dragon-175, 2026-10-14 15:03Z, five crystals broken) stood on a two-block stub at (-11, 64, 6) with its fireball roof at 67, the cloud came to its feet, no climb was tried under the roof, and it went 20 to 2 in three seconds.
        const roofAt2 = bot.blockAt(f0.offset(0, 2, 0))?.boundingBox === 'block', roofAt3 = bot.blockAt(f0.offset(0, 3, 0))?.boundingBox === 'block';
        // No stub at a cliff's edge (note 1843): the jump that lays the stub's first block carried the body over the edge, and 25588's dragon-204 (2026-10-18 10:50Z) fell 22 from (45, 54, -17) to the lower shelf and the void from there. Two or more sides dropping away: the run, not the stub.
        const stubEdge = runOffSides(bot, bot.entity.position.floored()).length >= 2;
        // No stub under a fireball in flight (note 1844): the ball is aimed at the body, and a stub laid in the second before it lands puts the body on the block it bursts on, the cloud at the feet. 25588's dragon-205 (2026-10-18 11:09Z, one crystal, 338 blocks, full health) ran 1.9 blocks from a fireball 7.5 off, went 'up out of the breath first: 1 blocks up' at (-29, 58, 21), and took that fireball's cloud on the stub, 20 to 14 to 8 to none, the first stub of its fight.
        const ballClose = Object.values(bot.entities).some(e => e.name === 'dragon_fireball' && e.isValid !== false && e.position.distanceTo(bot.entity.position) < 14);
        if (inBreath() && ballClose && !stubEdge && !(state.stubBallSaid > Date.now() - 5000)) { state.stubBallSaid = Date.now(); console.log(`[end combat] no stub out of the breath at ${bot.entity.position.floored()}: a fireball is in flight within fourteen and would burst on it`); }
        if (inBreath() && stubEdge && !(state.stubEdgeSaid > Date.now() - 10000)) { state.stubEdgeSaid = Date.now(); console.log(`[end combat] no stub out of the breath at ${bot.entity.position.floored()}: ${runOffSides(bot, bot.entity.position.floored()).length} sides drop away two or more, and the jump that lays it carries the body over the edge`); }
        // No stub up through a cloud over the feet (note 1867, as note 1836 for the hole): the stub rises into it. 25588's dragon-222 (2026-10-18 16:34Z) stood in its foot pit at (31, 63, -23) under a cloud on the ground at 65, 'up out of the breath first: 3 blocks up at (31, 66, -23), 2.0 health', 20 to 8 to 2 on the way up through the cloud, and died on the drop that followed. The body stays under it.
        const cloudOver = Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position.y > f0.y + 0.5 && e.position.y <= f0.y + 3.5 && Math.hypot(bot.entity.position.x - e.position.x, bot.entity.position.z - e.position.z) <= cloudRadius(bot, e) + 0.5) || null;
        if (inBreath() && cloudOver && !(state.cloudOverSaid > Date.now() - 5000)) { state.cloudOverSaid = Date.now(); console.log(`[end combat] no stub out of the breath at ${f0}: the cloud lies ${Math.round((cloudOver.position.y - f0.y) * 10) / 10} over the feet, ${Math.round(cloudRadius(bot, cloudOver) * 10) / 10} wide, and the stub would rise into it`); }
        // In a tunnel the run goes along it (note 1872): the straight run away from the cloud meets the tunnel's wall, and 25588's dragon-225 (2026-10-18 17:26Z) in its tunnel at (16, 57, 31) 'moved 0.7 blocks' in 1.8 s and '1.3 blocks' in 2.0 s, jumping at the wall, 20 to 14 to 2.2. The open way along the tunnel, three cells or more, away from the cloud where both ways are open, is taken at a sprint.
        if (inBreath() && inTunnel()) {
          const f = bot.entity.position.floored(), open = c => bot.blockAt(c)?.boundingBox !== 'block', solid = c => bot.blockAt(c)?.boundingBox === 'block';
          const clouds = Object.values(bot.entities).filter(e => e.name === 'area_effect_cloud' && e.isValid !== false).sort((a, b) => Math.hypot(a.position.x - bot.entity.position.x, a.position.z - bot.entity.position.z) - Math.hypot(b.position.x - bot.entity.position.x, b.position.z - bot.entity.position.z));
          const cloud = clouds[0] || null;
          const ways = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => { let k = 0; while (k < 8 && open(f.offset(dx * (k + 1), 0, dz * (k + 1))) && open(f.offset(dx * (k + 1), 1, dz * (k + 1))) && solid(f.offset(dx * (k + 1), -1, dz * (k + 1)))) k++; const away = cloud ? dx * (bot.entity.position.x - cloud.position.x) + dz * (bot.entity.position.z - cloud.position.z) : 0; return { dx, dz, k, away }; }).filter(w => w.k >= 3).sort((a, b) => (b.away > 0) - (a.away > 0) || b.k - a.k);
          const way = ways[0];
          if (way) {
            const h0 = bot.health, p0 = bot.entity.position.clone();
            goal.step = { action: 'run_along_the_tunnel', health: bot.health, way: [way.dx, way.dz], cells: way.k }; save();
            bot.clearControlStates(); bot.pathfinder?.setGoal?.(null);
            const look = f.offset(way.dx * 8 + .5, 1.6, way.dz * 8 + .5);
            try { await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'run_along_the_tunnel', keys: ['forward', 'sprint'], sneak: false, why: 'along the tunnel, out of the breath', look, maxMs: 1500, tick: 50, until: () => !inBreath() || Math.hypot(bot.entity.position.x - p0.x, bot.entity.position.z - p0.z) >= way.k - 0.5 }); }
            catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
            console.log(`[end combat] the run along the tunnel from ${f}: ${way.k} cells open ${way.dx > 0 ? 'east' : way.dx < 0 ? 'west' : way.dz > 0 ? 'south' : 'north'}${way.away > 0 ? ', away from the cloud' : cloud ? ', toward the cloud, the one way open' : ''}; now at ${bot.entity.position.floored()}, ${h0.toFixed(1)} to ${bot.health.toFixed(1)} health${inBreath() ? ', still in it' : ''}`);
            if (!inBreath()) return;
          } else if (!(state.tunnelRunSaid > Date.now() - 5000)) { state.tunnelRunSaid = Date.now(); console.log(`[end combat] no run along the tunnel from ${f}: no way three cells open`); }
        }
        // The run before the stub (note 1868): of 25588's fourteen deaths with logs since dragon-190 (2026-10-18), five ended in 'up out of the breath first' or its ground kin, the top of the ledger; the stub itself cost nothing in nine of thirteen, but it leaves the body standing on two blocks with open sides, and the next fireball burst on it there (dragon-205, 216, 223), a fresh cloud at the body's own height that the walls do not keep out. The run cost nothing in sixteen of eighteen and leaves the body moving. So the run first where the ground gives one, the stub where it does not.
        // Not from a pit (note 1890): a body with walls at the head's height on two sides or more runs at a wall, and the cloud's box is half a block high, one block up being clear of it (note 1889's drill). 25588's dragon-247 (2026-10-19 02:2xZ, two crystals) in a pit at (5, 56, 41): 'the straight run stalled ... taken again with a jump, 0.5 from the start', 15.8 to 4.0 in 1.6 s, dead. From a pit the stub goes up at once.
        const pitWalls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(bot.entity.position.floored().offset(dx, 1, dz))?.boundingBox === 'block').length;
        if (inBreath() && pitWalls >= 2 && !(state.pitStubSaid > Date.now() - 5000)) { state.pitStubSaid = Date.now(); console.log(`[end combat] no run out of the cloud from the pit at ${bot.entity.position.floored()} (${pitWalls} walls at the head's height): the stub at once`); }
        if (inBreath() && actions.navigate && pitWalls < 2) {
          const h0 = bot.health, p0 = bot.entity.position.floored();
          goal.step = { action: 'run_out_of_breath_first', health: bot.health }; save();
          try {
            await evadeDragon(bot, task, goal, save, { allowed: p => policy.allowedPoint(p) && safeFromHostiles(bot, p, endMobs(bot)), timeoutMs: 700, dig: actions.dig });
            console.log(`[end combat] the run out of the cloud first from ${p0}: now at ${bot.entity.position.floored()}, ${h0.toFixed(1)} to ${bot.health.toFixed(1)} health${inBreath() ? ', still in it' : ''}`);
            if (!inBreath()) return;
          } catch (err) {
            if (err.name !== 'NoEscape') throw err;
            console.log(`[end combat] no run out of the cloud from ${p0}: ${String(err.message || err).slice(0, 90)}; the stub instead`);
          }
        }
        // After the run, not before it (note 2250): a cloud half a block over the feet is on the body already, and two blocks dug with a stone pickaxe were 3.7 s in it; 25589's stronghold-1-dragon-341 (2026-10-26 18:01Z) had run 4.1 blocks out of one cloud to (-18, 61, 35), took the dig under the next, 'under the cloud: 2 of 2 dug down in 3688 ms ... 17.0 to 6.0 health, still in it', and died on the next dig. The dig under the cloud is for a body the run could not take out.
        // Down under a cloud lying over the feet (note 2233): a body in a hole one deep is 1.8 tall, and a fireball's cloud on the ground beside the hole lies on the body's upper half; the stub would rise into it (note 1867), the run from the hole goes nowhere, and the two down of note 1692 is for a body with no blocks. 25592's stronghold-1-dragon-333 (2026-10-26 16:32Z) dug a hole one deep at (35, 60, 4) against the dragon's charge, took the fireball's cloud 0.8 over its feet, 5.3 wide ('no stub ... the stub would rise into it'), ran 0.7 blocks in 1.1 s, 20 to 14 to 9 to none. Dug down until the body's top is under the cloud's base, two at most, on ground four thick off the void.
        if (inBreath() && cloudOver && !(actions.dig && pickCarried() && !inWater()) && !(state.underCloudSkipSaid > Date.now() - 5000)) { state.underCloudSkipSaid = Date.now(); console.log(`[end combat] no dig under the cloud over the feet at ${bot.entity.position.floored()}: ${!actions.dig ? 'no dig here' : !pickCarried() ? 'no pickaxe carried' : 'the body in water'}`); }
        if (inBreath() && cloudOver && actions.dig && pickCarried() && !inWater()) {
          const f1 = bot.entity.position.floored();
          // Two thick is enough (note 2237): each block is dug only with a solid one under it, and the void within four is refused apart. 25592's stronghold-1-dragon-335 (2026-10-26 16:56Z) stood at (30, 61, -22) by its column's foot with one cloud at the feet and another a block over them, 'no dig under the cloud ... the ground under the feet is not four thick', and the one block up went into the upper cloud, 14 to 9 to none.
          const thick1 = [1, 2].every(dy => bot.blockAt(f1.offset(0, -dy, 0))?.boundingBox === 'block');
          const need = Math.min(2, Math.max(1, Math.ceil(bot.entity.position.y + 1.9 - cloudOver.position.y)));
          // Not down into another cloud (note 2276): the cell dug down to has to be clear of every cloud's box (half a block
          // high, from its base). stronghold-1-dragon-372 (25589, 2026-10-27 04:18Z) had one cloud at its feet and another a
          // block over them: up one out of the first, down one under the second into the first, four times, 14.1 to 2.3, dead.
          const downTo = bot.entity.position.y - need;
          const cloudBelow = Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && e !== cloudOver && e.position.y >= downTo - 0.5 && e.position.y <= downTo + 1.8 && Math.hypot(bot.entity.position.x - e.position.x, bot.entity.position.z - e.position.z) <= cloudRadius(bot, e) + 0.5) || null;
          if (cloudBelow && !(state.cloudBelowSaid > Date.now() - 5000)) { state.cloudBelowSaid = Date.now(); console.log(`[end combat] no dig under the cloud over the feet at ${f1}: another cloud lies at ${cloudBelow.position.floored()}, where the body would come down to`); }
          if (thick1 && !cloudBelow && voidEdge(bot, bot.entity.position, 4) === null) {
            goal.step = { action: 'down_under_the_cloud', health: bot.health, need }; save();
            const h0 = bot.health, t0 = Date.now();
            console.log(`[end combat] under the cloud over the feet at ${f1}: the cloud's base ${Math.round((cloudOver.position.y - bot.entity.position.y) * 10) / 10} over the feet, ${need} dug down to put the body under it, ${bot.health.toFixed(1)} health`);
            let dug = 0;
            for (let k = 0; k < need; k++) { const under = bot.entity.position.floored().offset(0, -1, 0); if (bot.blockAt(under)?.boundingBox !== 'block' || bot.blockAt(under.offset(0, -1, 0))?.boundingBox !== 'block') break; try { await actions.dig(bot, task, under, { dropInto: true, openPit: true, requireDrops: false }); dug++; } catch (e3) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(e3.name)) throw e3; break; } for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50); }
            console.log(`[end combat] under the cloud: ${dug} of ${need} dug down in ${Date.now() - t0} ms, now at ${bot.entity.position.floored()}, ${h0.toFixed(1)} to ${bot.health.toFixed(1)} health${inBreath() ? ', still in it' : ''}`);
            // Back to the top after a block dug (note 2241): the branches below read the body's old cell. 25592's dragon-337 (2026-10-26 17:11Z) dug one under a cloud two over its feet, a fresh fireball's cloud landed at its new feet during the dig, and the run and stub branches that followed judged from the old cell ('no run out of the cloud from a pit', the stub refused), 15 to 9 to none; read fresh, the cloud a block over the feet is one more block dug.
            if (dug) return;
          } else if (!cloudBelow && !(state.underCloudSaid > Date.now() - 5000)) { state.underCloudSaid = Date.now(); console.log(`[end combat] no dig under the cloud over the feet at ${f1}: ${thick1 ? 'the void within four' : 'the ground under the feet is not two thick'}`); }
        }
        if (inBreath() && blocksCarried(bot) >= 1 && !onObsidianTop() && !stubEdge && !ballClose && !cloudOver) {
          goal.step = { action: 'up_out_of_breath_first', health: bot.health }; save();
          // The feet on the ground first (note 1640): the body arrives in the cloud at a run or off a step, and the climb refused 'air under the feet' while it was in the air (dragon-171 and 174, 2026-10-14, each dead in the cloud a second later). The keys let go and up to half a second waited for the ground.
          bot.clearControlStates(); bot.pathfinder?.setGoal?.(null);
          for (let i = 0; i < 10 && !bot.entity.onGround; i++) { check(); await sleep(50); }
          // Each part of the stub out of the breath timed and said (note 1901): 25588's dragon-273 (2026-10-19 09:2xZ, four crystals) on its roofed stub in a walled shaft at (-40, 65, -5) took the fireball's cloud on the body, 20 to 14 to 11 to none, and nothing was said between the burst and the death: the roof's dig, the climb, or a wait.
          const tStub = Date.now(); console.log(`[end combat] the stub out of the breath begins at ${f0}: ${roofAt2 ? 'a roof two over the feet to dig first' : roofAt3 ? 'a roof three over the feet' : 'the sky open'}, ${blocksCarried(bot)} blocks, ${bot.health.toFixed(1)} health`);
          if (roofAt2 && actions.dig) { const r = bot.blockAt(f0.offset(0, 2, 0)); if (!/bedrock|obsidian|end_portal/.test(r.name)) { try { await actions.dig(bot, task, r.position, { requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } console.log(`[end combat] the stub's roof at ${r.position} dug in ${Date.now() - tStub} ms: ${bot.blockAt(r.position)?.name || '?'} there now, ${bot.health.toFixed(1)} health`); } }
          const up = roofAt3 && !roofAt2 ? 1 : upClear(Math.floor(bot.entity.position.y));
          await leeForClimb();
          // Not centred on a column the body has left (note 1762): standing on solid ground in another cell, the climb goes up from there. 25588's dragon-116 (2026-10-17 13:1xZ) came down its column at (51, 5), went up a stair to (52, 54, 6) on end stone, and in the breath was walked back toward (51, 5), 0.6 to 0.58 off, its pillar 'stopped after 1: air under the feet at (53, 55, 7)', dead in the cloud; dragon-60 and 112 the same, 1.02 to 0.81 off.
          // Centred on the bot's own column first when one is near (note 1695, as note 1676 on the column's own path): this way is taken on a stub or a column whose record says the body is a cell off, and a jump from 0.9 to 1.3 off a one-wide top goes off its edge. 25588 (dragon-233, 2026-10-15 04:2xZ, two crystals broken) fell three times climbing out of the breath, 'falling from (-12, 72, 35) ... 0.92 off the column (-13, 36)'s middle; step up_out_of_breath_first; keys jump+sneak', then 1.29 and 1.0 off, 15 to 6.1.
          { const u = bot._pillarUp; if (u && u.until > Date.now()) { const p0 = bot.entity.position, off = Math.hypot(u.x + .5 - p0.x, u.z + .5 - p0.z); const own = p0.floored(), elsewhere = (own.x !== u.x || own.z !== u.z) && bot.blockAt(own.offset(0, -1, 0))?.boundingBox === 'block'; if (elsewhere && off > 0.3) console.log(`[end combat] not centred on the column at (${u.x}, ${u.z}) before the climb out of the breath: the body stands on ${bot.blockAt(own.offset(0, -1, 0))?.name} at ${own}, ${Math.round(off * 100) / 100} off`); if (!elsewhere && off > 0.3 && off <= 1.6 && bot.blockAt(new Vec3(u.x, Math.floor(p0.y) - 1, u.z))?.boundingBox === 'block') { await centreOn(u.x, u.z, 0.2, { maxMs: 500 }); const off2 = Math.hypot(u.x + .5 - bot.entity.position.x, u.z + .5 - bot.entity.position.z); console.log(`[end combat] centred on the column before the climb out of the breath: ${Math.round(off * 100) / 100} to ${Math.round(off2 * 100) / 100} off`); } } }
          const from = Math.floor(bot.entity.position.y);
          try { await require('./pillar-recovery').pillarUp(bot, task, from + up, { dig: actions.dig, maxBlocks: up, threats: false, wet: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
          const rose = Math.floor(bot.entity.position.y) - from;
          console.log(`[end combat] up out of the breath first: ${rose} blocks up at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health`);
          // As high as upClear asks (note 1724: one where the cloud lies at the feet; note 1679's one-up death of dragon-214 was read before the arena measured the slab, and two where no cloud is seen). Two up or the other ways (note 1679): one block up leaves the body a block over the cloud's base, inside it; 25588 (dragon-214, 2026-10-15 00:00Z) went '1 blocks up' at (40, 62, -5) and stood, 20 to 14.7 to 9.1 to 3.3 to none.
          if (rose >= up) { await roofTheStub(); return; }
        }
      }
      // No blocks for the climb: the dig first, before the run's survey (note 1692). The run out of a cloud is surveyed for 0.7 s and found nothing on the fountain's pitted ground, and the dig two down came last and silent; 25588 (dragon-229, 2026-10-15 03:29Z, two crystals broken) stood at (11, 61, 2.6) with no block carried, 1.5 to 3 from the cloud's middle, five seconds at three a second, 'hurt without a survival response', 14 to none; the dig began at the last second. Two blocks down with the iron pickaxe are a second and a half and the body is under the cloud.
      if (inBreath() && blocksCarried(bot) < 2 && actions.dig && pickCarried()) {
        const f1 = bot.entity.position.floored();
        const thick1 = [1, 2, 3, 4, 5, 6].every(dy => bot.blockAt(f1.offset(0, -dy, 0))?.boundingBox === 'block');
        if (thick1 && voidEdge(bot, bot.entity.position, 4) === null && !inWater()) {
          goal.step = { action: 'down_out_of_breath_first', health: bot.health }; save();
          console.log(`[end combat] in the cloud with ${blocksCarried(bot)} blocks at ${f1}: two dug down first, ${bot.health.toFixed(1)} health`);
          let dug = 0;
          for (let n = 0; n < 2; n++) { const under = bot.entity.position.floored().offset(0, -1, 0); if (bot.blockAt(under)?.boundingBox !== 'block' || bot.blockAt(under.offset(0, -1, 0))?.boundingBox !== 'block') break; try { await actions.dig(bot, task, under, { dropInto: true, openPit: true, requireDrops: false }); dug++; } catch (e3) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(e3.name)) throw e3; break; } for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50); }
          console.log(`[end combat] down out of the breath: ${dug} dug, now at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health`);
          if (dug >= 2) return;
        }
      }
      try { await evadeDragon(bot, task, goal, save, { allowed: p => policy.allowedPoint(p) && safeFromHostiles(bot, p, endMobs(bot)), timeoutMs: inBreath() ? 700 : 1600, dig: actions.dig }); }
      catch (err) {
        if (err.name !== 'NoEscape') throw err;
        if (inBreath()) console.log(`[end combat] no run out of the cloud from ${bot.entity.position.floored()}: ${String(err.message || err).slice(0, 90)}`);
        try { if (inBreath()) throw Object.assign(new Error('No surveyed walking escape from the dragon on loaded terrain'), { name: 'NoEscape' }); await evadeDragon(bot, task, goal, save, { allowed: p => policy.allowedPoint(p) }); }
        catch (err2) {
          if (err2.name !== 'NoEscape' || !actions.dig) throw err2;
          // No walk out of the cloud on the ground (note 1475): two blocks dug
          // under the feet put the body under it, as the column's way does.
          // 25588 (dragon-56, 2026-10-13 14:39Z) stood in the cloud on the
          // island's rough eastern ground three seconds, 20 to none, with
          // 'No surveyed walking escape' each tick.
          // Only on thick ground well in from the rim (note 1477): six solid under
          // the feet and no void within four. 25588 (dragon-58, 2026-10-13
          // 14:54Z) dug two under its feet in a cloud on the eastern slope at
          // (53, 43, -23), the island two blocks thick there, and fell through
          // into the void.
          const feet0 = bot.entity.position.floored();
          const thick = [1, 2, 3, 4, 5, 6].every(dy => bot.blockAt(feet0.offset(0, -dy, 0))?.boundingBox === 'block');
          // Up two on the blocks carried (note 1557) where the ground is too thin
          // to dig and no run is to be had: the cloud lies half a block deep on
          // the ground, and a body two blocks up is out of it. 25588 (dragon-106,
          // 2026-10-14 01:26Z) stood on the ledge under the entry platform at
          // (88, 45, 2), the void beside every cell, 'No surveyed walking
          // escape' three times, 28 blocks carried, and died in the cloud,
          // 20 to none in three seconds.
          // Up two first wherever two blocks are carried (note 1583), the dig
          // only without them: two blocks laid are under a second, two dug
          // are three with a stone pickaxe, and the cloud is six a second.
          // 25588 (dragon-129, 2026-10-14 05:41Z, three crystals broken)
          // stood in the cloud at (-32, 59, -31) on thick ground by crystal
          // 90's foot with 17 blocks carried, no run found, 13 to 7.5 to 1.7
          // to none in two seconds, nothing pressed; dragon-124 and 110 the
          // same on the island's ground.
          // Not under a roof, not on a pillar's top, and not twice (note 1608): with a block two over the head the jump is stopped and the two blocks never go down, and 25588 (dragon-148, 2026-10-14 08:57Z) stood on crystal 9's top under its stand's roof, 'up out of the breath on thin ground: 0 blocks up' seven times in the cloud, 20 to 17, and the dragon's body carried it 42 blocks off, dead. A climb that gains nothing falls through to the dig and the other ways.
          // A block three over the head stops only the second block (note 2204): the jump rises a block and a fifth under
          // it, enough for one block under the feet, and the cloud is half a block high, so one up is out of it. dragon-309
          // (25592, 2026-10-26 11:53Z) dug down its column to the island at (31, 59, -23), its last roof three over its head,
          // took a fireball's cloud on the body there (20 to 14), was refused the climb for the roof, dug down instead (end
          // stone, about a second and a half a block, the cloud six a second) and died in it; seven of today's thirteen
          // End deaths were 'killed by Ender Dragon using magic', the cloud on a body whose way out was refused.
          const over = dy => bot.blockAt(bot.entity.position.floored().offset(0, dy, 0))?.boundingBox === 'block';
          const roofed = over(2), lowRoof = over(3);
          if (inBreath() && blocksCarried(bot) >= 2 && !roofed && !onObsidianTop()) {
            goal.step = { action: 'up_out_of_breath_on_ground', health: bot.health }; save();
            await leeForClimb();
            const from = Math.floor(bot.entity.position.y);
            const want = lowRoof ? 1 : upClear(from);
    try { await require('./pillar-recovery').pillarUp(bot, task, from + want, { dig: actions.dig, maxBlocks: want, threats: false, wet: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
            const rose = Math.floor(bot.entity.position.y) - from;
            console.log(`[end combat] up out of the breath on ${thick ? 'the ground' : 'thin ground'}: ${rose} blocks up at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health`);
            if (rose >= want) { await roofTheStub(); return; }
          }
          if (inBreath() && thick && voidEdge(bot, bot.entity.position, 4) === null) {
            goal.step = { action: 'down_out_of_breath_on_ground', health: bot.health }; save();
            for (let n = 0; n < 2; n++) { const under = bot.entity.position.floored().offset(0, -1, 0); if (bot.blockAt(under)?.boundingBox !== 'block' || bot.blockAt(under.offset(0, -1, 0))?.boundingBox !== 'block') break; try { await actions.dig(bot, task, under, { dropInto: true, openPit: true, requireDrops: false }); } catch (e3) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(e3.name)) throw e3; break; } for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50); }
            return;
          }
          throw err2;
        }
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
  // Crouched whenever the bot stands on its column or an obsidian top and no
  // move of its own is under way (note 1480): a crouched body on the ground is
  // not moved off its block's edge by anything, its own keys or a push (the
  // physics backs the whole of the step off the edge), and the dragon's wing
  // passing through the column pushes without a blow: the dragon shoves
  // whatever its parts touch, and strikes only a body not hurt by a mob
  // within two ticks, which the breath at the feet is. 25588 (dragon-59,
  // 2026-10-13 15:06Z) and (dragon-61, 15:37Z), both digging down out of the
  // breath with no key held, drifted 0.8 to 1.1 off the column's middle in
  // half a second with no blow recorded and fell 18 and 10 blocks, dragon-59
  // to its death. The climb's jumps (a move of their own) are left upright.
  // Water standing within reach of the eye goes back into an empty bucket (notes 1495, 1535); the cell taken, or null.
  // The water left standing walked back to and taken into the empty bucket (note 1644): the climb with no full bucket has no pool and comes down by the dig, and 25588 (dragon-178, 2026-10-14 15:40Z) poured its last bucket at an enderman's feet, walked off, and was offered the walk back fourteen times without taking it, two empty buckets toward the next climb. Called by the climb before its walk when no bucket is full.
  // The drop's own pool is not 'water left' while its column stands (note 1658): the pool is poured from the last full bucket, and a reflex that fetches water back when no bucket is full took the pool itself. 25588 (dragon-194, 2026-10-14 18:47Z, three crystals broken) poured its pool at (-30, 60, -19) beside its column, '0 full buckets left', was blown off the climb by a fireball, and the next step took 'the water left at (-30, 60, -19) back into the bucket before the climb (0 full carried)': the pick-up got nothing, the record was dropped as taken, and the fight went on with two empty buckets and 'no pool under the way down' beside the water. A pick-up that fills nothing leaves the record and is not tried again for thirty seconds.
  const poolInUse = w => !!(state.pool && state.pool.x === w.x && state.pool.z === w.z && Date.now() - state.pool.at < 15 * 60000 && bot._pillarUp && bot._pillarUp.until > Date.now());
  const reclaimWaterLeft = async ({ within = 60 } = {}) => {
    if (countOf(bot, 'water_bucket') > 0 || countOf(bot, 'bucket') === 0 || !Array.isArray(state.poolsLeft) || !state.poolsLeft.length) return false;
    state.poolsLeft = state.poolsLeft.filter(w => Date.now() - w.at < 20 * 60000 && bot.blockAt(new Vec3(w.x, w.y, w.z))?.name === 'water');
    const here = bot.entity.position, w = state.poolsLeft.filter(w => !poolInUse(w) && !(w.triedAt > Date.now() - 30000)).map(w => ({ w, d: here.distanceTo(new Vec3(w.x + .5, w.y, w.z + .5)) })).filter(x => x.d <= within).sort((a, b) => a.d - b.d)[0];
    if (!w) return false;
    const p = new Vec3(w.w.x, w.w.y, w.w.z);
    goal.step = { action: 'take_back_water', to: { x: p.x, y: p.y, z: p.z }, blocks: Math.round(w.d) }; save();
    try { await actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 25000, stallMs: 5000 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
    const eye = bot.entity.position.offset(0, 1.62, 0);
    if (eye.distanceTo(p.offset(.5, .5, .5)) > 4.3) { console.log(`[end combat] the water left at ${p} was not reached before the climb: ${Math.round(bot.entity.position.distanceTo(p.offset(.5, 0, .5)))} blocks off`); return false; }
    const before = countOf(bot, 'water_bucket');
    try { await require('./water').fillWaterBucket(bot, task, p, { timeoutMs: 1500 }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    const full = countOf(bot, 'water_bucket');
    if (full <= before) { w.w.triedAt = Date.now(); save(); console.log(`[end combat] the water left at ${p} was not taken back: the bucket stayed empty (${bot.blockAt(p)?.name || 'nothing'} there now); not tried again for thirty seconds`); return false; }
    console.log(`[end combat] the water left at ${p} taken back into the bucket before the climb (${full} full carried)`);
    state.poolsLeft = state.poolsLeft.filter(x => x !== w.w); if (state.pool && state.pool.x === p.x && state.pool.z === p.z) delete state.pool; save();
    return full > 0;
  };
  // The fresh pool spared by default (note 1858): 'out of the trench' took the pool's own water back into the bucket the moment it was poured, and the climb went up with no pool below; 25588's dragon-217 (2026-10-18 14:33Z) poured at (35, 49, 22), 'the water left at (35, 49, 22) taken back into the bucket (2 full carried)', and at the top 'no water drop'. Only the reclaim after the way down asks for the pool itself.
  const takeBackWaterNear = async ({ sparePool = true, force = false } = {}) => {
    if (countOf(bot, 'bucket') < 1) return null;
    // Not with an enderman within twelve (note 1638): the water at the feet is the stand against it (note 1136), and the take-back undid the pour the moment after it, pour and take-back six times over while the enderman struck; 25588 (dragon-170, 2026-10-14 13:57Z, one crystal broken) 20 to 1.7 in seventeen seconds, dead. Forced before a dig down (note 1643).
    if (!force && hostileEntities(bot, 12).some(e => live(bot, e) && e.name === 'enderman')) return null;
    const { sourceWater, fillWaterBucket } = require('./water');
    const eye = bot.entity.position.offset(0, 1.62, 0);
    // Not the pool poured for the coming drop (note 1574), nor water within two of it.
    const pool = sparePool && state.pool && Date.now() - state.pool.at < 15 * 60000 ? state.pool : null;
    const near = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 5, count: 8, useExtraInfo: sourceWater })
      .filter(p => eye.distanceTo(p.offset(.5, .5, .5)) <= 4.3 && !(pool && Math.abs(p.x - pool.x) <= 2 && Math.abs(p.z - pool.z) <= 2)).sort((p, q) => eye.distanceTo(p) - eye.distanceTo(q))[0];
    if (!near) return null;
    await fillWaterBucket(bot, task, near, { timeoutMs: 1500 });
    console.log(`[end combat] water left at ${near} taken back into the bucket (${countOf(bot, 'water_bucket')} full carried)`);
    if (state.pool && near.x === state.pool.x && near.z === state.pool.z) { delete state.pool; save(); }
    return near;
  };
  // The dragon's hurts on the body, timed (note 1560): the breath's cloud is read a tick late and its hurt is not.
  if (!bot._dragonHurtHook && bot._client?.on) {
    bot._dragonHurtHook = true;
    bot._client.on('damage_event', packet => { try { if (packet?.entityId === bot.entity?.id) { const cause = bot.entities?.[(packet.sourceCauseId || 0) - 1]; if (cause?.name === 'ender_dragon') bot._lastDragonHurtAt = Date.now(); } } catch (_) { /* nothing */ } });
  }
  const crouchKeeper = setInterval(() => {
    // Only high on the column, and never during a walk (note 1850): the keeper held the crouch on the column's base cell after every descent, re-pressing it fifty milliseconds after note 1845 let it go, and the walks from the foot stalled; 25588's dragon-207 to 210 (2026-10-18) had the sneak 'held at the walk's start' fifteen times in an hour and 'timed out without reaching new ground' after each. Two or more over the base, with no goal set on the pathfinder.
    try { const u = bot._pillarUp, high = !u || u.base == null || Math.floor(bot.entity.position.y) >= u.base + 2; if (!bot._controller && !bot._dropping && bot.entity?.onGround && (onOwnPillar() || onObsidianTop()) && high && !bot.pathfinder?.goal && !bot.controlState?.sneak) bot.setControlState?.('sneak', true); } catch (_) { /* nothing to hold */ }
  }, 50);
  try {
    // Water left standing within reach goes back into an empty bucket at the
    // step's start, with no dragon or breath upon the bot (note 1495): the
    // buckets go down for landings, for endermen and for the breath, and
    // what any of them leaves is the next landing's bucket. 25588 (dragon-68,
    // 2026-10-13, four crystals broken) lost one bucket at 17:01Z in an
    // evasion and the other at 17:13Z, each the water left where it was
    // poured, and died at 17:21Z, 'no water bucket carried', on its column.
    // The body in water, or its breath going, at the step's start (note 1570): out first.
    if ((inWater() || (bot.oxygenLevel ?? 20) < 18) && !onOwnPillar()) { try { await outOfTheWater(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } }
    if (countOf(bot, 'bucket') > 0 && !breathThreat(bot) && !dragonThreat(bot)) {
      try {
        const { fillWaterBucket } = require('./water');
        const eye = bot.entity.position.offset(0, 1.62, 0);
        const near = await takeBackWaterNear({ sparePool: true });
        // The pool poured for a drop, walked back to within ten (note 1519):
        // left where it was poured it is a bucket gone, and 25588 (dragon-82,
        // 2026-10-13 20:49Z) poured its third pool with '0 full buckets left',
        // the second standing at (-28, 61, -25) where the climb was given up.
        // Every pool and clutch left behind, remembered and walked back to (note
        // 1564), not the drop's pool alone: 25588 (dragon-113, 2026-10-14 02:51Z)
        // caught its 45-block drop with the bucket at (8, 61, -33), landed at
        // 17 health with the dragon coming, and that water was never a pool to
        // return to; its next pour at (-8, 59, 39) was left when the climb went
        // up another column; both buckets empty by the fifth crystal.
        if (!near && Array.isArray(state.poolsLeft) && state.poolsLeft.length && bot.health >= 10 && !onOwnPillar()) {
          state.poolsLeft = state.poolsLeft.filter(w => Date.now() - w.at < 15 * 60000 && bot.blockAt(new Vec3(w.x, w.y, w.z))?.name === 'water');
          const here = bot.entity.position, w = state.poolsLeft.map(w => ({ w, d: here.distanceTo(new Vec3(w.x + .5, w.y, w.z + .5)) })).filter(x => x.d <= 16).sort((a, b) => a.d - b.d)[0];
          if (w) {
            const p = new Vec3(w.w.x, w.w.y, w.w.z);
            try { await actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 8000, stallMs: 3000 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the walk back to the water left at ${p} from ${bot.entity.position.floored()}: ${String(err.message || err).slice(0, 80)}`); }
            const eye2 = bot.entity.position.offset(0, 1.62, 0);
            if (eye2.distanceTo(p.offset(.5, .5, .5)) <= 4.3) { const before2 = countOf(bot, 'water_bucket'); await fillWaterBucket(bot, task, p, { timeoutMs: 1500 }); const full2 = countOf(bot, 'water_bucket'); if (full2 > before2) { console.log(`[end combat] the water left at ${p} taken back into the bucket (${full2} full carried)`); state.poolsLeft = state.poolsLeft.filter(x => x !== w.w); if (state.pool && state.pool.x === p.x && state.pool.z === p.z) delete state.pool; } else { w.w.triedAt = Date.now(); console.log(`[end combat] the water left at ${p} was not taken back: the bucket stayed empty (${bot.blockAt(p)?.name || 'nothing'} there now)`); } save(); }
          }
        }
        if (!near && state.pool && Date.now() - state.pool.at < 15 * 60000) {
          const p = new Vec3(state.pool.x, state.pool.y, state.pool.z), d = bot.entity.position.distanceTo(p.offset(.5, 0, .5));
          if (bot.blockAt(p)?.name !== 'water') delete state.pool;
          // Not under ten health (note 1554): the walk is out in the open with the dragon about, and one breath is six. 25588 (dragon-103, 2026-10-14 01:14Z, two crystals broken) walked back to its pool at (-11, 59, 36) at 5.3 health and took the breath there, dead.
          else if (d <= 16 && !onOwnPillar() && bot.health >= 10) {
            try { await actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 8000, stallMs: 3000 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] the walk back to the pool at ${p} from ${bot.entity.position.floored()}: ${String(err.message || err).slice(0, 80)}`); }
            if (eye.distanceTo(p.offset(.5, .5, .5)) <= 4.3 || bot.entity.position.offset(0, 1.62, 0).distanceTo(p.offset(.5, .5, .5)) <= 4.3) { await fillWaterBucket(bot, task, p, { timeoutMs: 1500 }); console.log(`[end combat] the pool at ${p} taken back into the bucket (${countOf(bot, 'water_bucket')} full carried)`); delete state.pool; save(); }
          }
        }
      } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    }
    // What the columns have cost this fight (note 1440): every blow taken on
    // the bot's own column or an obsidian top, told on the climb's option.
    { const h = bot.health, was = state.lastHealthSeen; state.lastHealthSeen = h;
      if (Number.isFinite(was) && h < was - 0.05) { state.lastHurt = { at: Date.now(), amount: Math.round((was - h) * 10) / 10 }; }
      if (Number.isFinite(was) && h < was - 0.05 && (onOwnPillar() || onObsidianTop())) { const c = state.columnDamage ||= { hits: 0, total: 0, max: 0 }; const d = Math.round((was - h) * 10) / 10; c.hits++; c.total = Math.round((c.total + d) * 10) / 10; c.max = Math.max(c.max, d); save(); } }
    // Hurt by the dragon within three seconds and no emergency seen, said at the pass start (note 1776; note 1765 said it only inside the response, which a silent pass never reached).
    if (bot._lastDragonHurtAt > Date.now() - 3000 && !endEmergency(bot, { ground: onTheGround() }) && !(state.notInBreathSaid > Date.now() - 2000)) { state.notInBreathSaid = Date.now(); const clouds = Object.values(bot.entities).filter(e => e.name === 'area_effect_cloud' && e.isValid !== false).map(e => `${Math.round(Math.hypot(e.position.x - bot.entity.position.x, e.position.z - bot.entity.position.z) * 10) / 10} off, ${Math.round((e.position.y - bot.entity.position.y) * 10) / 10} up, radius ${Math.round(cloudRadius(bot, e) * 10) / 10}`); console.log(`[end combat] hurt by the dragon ${Math.round((Date.now() - bot._lastDragonHurtAt) / 100) / 10} s ago at ${bot.entity.position.floored()} and no emergency by the geometry${(() => { const dr = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && e.isValid !== false); const lh = state.lastHurt && Date.now() - state.lastHurt.at < 3500 ? state.lastHurt.amount : null; return `; the hit ${lh == null ? 'unmeasured' : lh}, the dragon ${dr ? `${Math.round(dr.position.distanceTo(bot.entity.position) * 10) / 10} off, phase ${metadata(bot, dr, 'phase')}` : 'unseen'}; the feet at y ${bot.entity.position.y.toFixed(2)}`; })()}; in water ${inWater()}; clouds ${clouds.length ? clouds.join('; ') : 'none seen'}`); }
    if (endEmergency(bot, { ground: onTheGround() }) && !holeAnswers()) { await respond(); return; }
    if (await holeBeforeThePass()) return;
    // The stub taken back (note 1767): every fireball's cloud on open ground costs two blocks up and a roof of about four, and the stub was left standing when the body walked off to its next step. 25588's dragon-129 (2026-10-17 15:0xZ, two crystals broken) went 56 blocks to 2 in ten such stubs over four minutes and died in the next cloud with none to climb on; dragon-128 the same from 54, and 13 of the stage's 57 deaths carried two blocks or fewer. On a stub of one to three with the dragon over thirty off and no breath near, the roof's blocks within reach and the column are dug back before the next step.
    if (await takeTheStubBack()) return;
    // The water poured against an enderman taken back once it is gone (note 1646): the pick-up reached five blocks and the walk back was left to the question, and 25588 (dragon-178 and 179, 2026-10-14 15:40 to 15:58Z) each walked off from their last bucket's water and were offered the walk back for minutes without taking it. With no full bucket, an empty one, no enderman within twelve and the water within sixteen, the body goes back for it first.
    if (countOf(bot, 'water_bucket') === 0 && countOf(bot, 'bucket') > 0 && (state.poolsLeft || []).length && !onOwnPillar() && !onObsidianTop() && !hostileEntities(bot, 12).some(e => live(bot, e) && e.name === 'enderman') && !(dragon && dragonThreat(bot))) {
      if (await reclaimWaterLeft({ within: 16 })) return;
    }
    task.interruptCheck = () => {
      oldInterrupt?.();
      if (dimension(bot) !== 'end' || bot.health <= 0) throw blocked('End combat interrupted by dimension change or death');
      if (holeAnswers()) return;
      checkEndEmergency(bot, { ground: onTheGround() });
    };
    // No meal with a fireball in the air or a cloud near or the dragon's body coming (note 1700): the survival layer's eat is a second and a half and takes no End emergency, and 25588 (dragon-237, 2026-10-15 05:35Z, five crystals broken) landed wet in its pool, stepped to the rim, and began to eat at 05:35:05.5 with a fireball shot a tenth before; the cloud took 20 to 14 to 8 to 2 to none in four seconds while it ate, 'hurt without a survival response'. dragon-229 (03:29Z) stood the same five seconds.
    const mealSafe = () => !breathThreat(bot) && !dragonThreat(bot) && !Object.values(bot.entities).some(e => e.name === 'area_effect_cloud' && e.isValid !== false && hazardDistance(bot.entity.position, e) <= cloudRadius(bot, e) + 4);
    if (safeHere() && mealSafe()) {
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
    // A sword with life enough first, else any sword that still swings (note 2636): a worn one is still a sword, not a fist.
    const sword = bot.inventory.items().find(i => /_sword$/.test(i.name) && durable(bot.registry, i)) || bot.inventory.items().find(i => /_sword$/.test(i.name) && (bot.registry.itemsByName[i.name]?.maxDurability || 0) - (i.durabilityUsed || 0) >= 1);
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
    // Taken back once no turned enderman is within eight (note 1468): the
    // End keeps a hostile within sixteen at all hours, and 25588 (dragon-47,
    // 2026-10-13 13:04Z, crystals 11 and 94 broken) fell 27 from a pillar's
    // top with both buckets empty, the water of a pour and of a landing left
    // where it lay.
    if (state.water && !require('./end-pocket').angryEndermen(bot, 8, hostileEntities).some(e => live(bot, e))) {
      // Walked back to within twelve (note 1542), as the drop's pool is (note
      // 1519): forgotten at four blocks, the water was a bucket gone, and
      // 25588 (dragon-95, 2026-10-13 23:56Z) poured for an enderman at about
      // (15, 61, -24) in a walk, moved on, and poured its next pool with '0
      // full buckets left', no word of the pour in the log.
      const at = vector(state.water.at), far = bot.entity.position.distanceTo(at);
      if (bot.blockAt(at)?.name !== 'water') { delete state.water; }
      else {
        if (far > 4 && far <= 12 && countOf(bot, 'bucket') > 0 && bot.health >= 10) { try { await actions.navigate(bot, task, new goals.GoalNear(at.x, at.y, at.z, 2), { timeoutMs: 8000, stallMs: 3000 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; } }
        const taken = await takeWaterBack(bot, check, state.water.at);
        if (taken) console.log(`[end combat] the enderman's water at ${at} taken back into the bucket (${countOf(bot, 'water_bucket')} full carried)`);
        if (taken || countOf(bot, 'bucket') === 0 || bot.entity.position.distanceTo(at) > 12) delete state.water;
      }
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
    // Poured again where the last water is gone or far (note 1462): the
    // End's endermen keep a hostile within sixteen blocks at all hours, the
    // water was never taken back, and one pour a fight was all there was.
    // 25588 (dragon-42, 2026-10-13 12:11Z, full iron, two buckets carried)
    // stood 'end_hold' among three endermen at 6, 10 and 12 blocks, poured
    // nothing, and took 4 a second to none.
    const lastWater = state.water && vector(state.water.at);
    const waterStands = lastWater && bot.blockAt(lastWater)?.name === 'water' && lastWater.distanceTo(bot.entity.position) <= 6;
    // The last full bucket kept here too (note 1827, as note 1819 for the pool): 25588's dragon-192 (2026-10-18 05:25Z, three crystals, 372 blocks, full health) poured its second bucket against an enderman three blocks off, was flung off its column top at 86 by the dragon's body, 'falling ... with no water bucket to clutch with', and went into the void. The last bucket goes against an enderman only at 8 health or under.
    // Not kept from an enderman at arm's length (note 1851): 25588's dragon-210 (2026-10-18 12:46Z, one crystal) fought one with the sword at 1.4 to 1.8 blocks, 'the one full bucket carried is kept for the landing (health 13.5)', and went 13.5 to 2 to none under its blows; the water ends that fight at once, and a knock off a column is a lesser risk than a blow a second now.
    // The boat carried does not free the last bucket (note 2203, undoing note 2194; Fable, 2026-10-26 12:15Z): the boat
    // clutch clicks within the water's reach, 4.8 from the eye, and at a block and a third a tick that leaves two ticks
    // to the ground, in which the boat must spawn, be seen and be boarded; the water is one tick. dragon-314 (25589,
    // 11:05Z) had its one bucket in the pool and a boat carried, was hit off its stub top at 79, the boat clicked a block
    // above the ground, and it died of the fall. The boat stays the free last resort with no bucket; the End keeps two.
    const lastBucketKept = countOf(bot, 'water_bucket') < 2 && bot.health > 8 && !(turned && turned.position.distanceTo(bot.entity.position) <= 4);
    if (turned && !waterStands && lastBucketKept && !(state.lastBucketEndermanSaid > Date.now() - 20000)) { state.lastBucketEndermanSaid = Date.now(); console.log(`[end combat] no water against the enderman ${Math.round(turned.position.distanceTo(bot.entity.position))} blocks off: the one full bucket carried is kept for the landing after a knock off a column (health ${bot.health.toFixed(1)})`); }
    // No reflex pour where the water would run off (note 1843, as the option's own check): the flow carries the body with it, and 25588's dragon-204 (2026-10-18 10:50Z) poured against an enderman on the island's lower shelf at (45, 29, -19) and went off its edge into the void at 11 health.
    const pourRunsOff = runOffSides(bot, bot.entity.position.floored()).length >= 1;
    if (turned && !waterStands && !lastBucketKept && pourRunsOff && !(state.pourRunOffSaid > Date.now() - 20000)) { state.pourRunOffSaid = Date.now(); console.log(`[end combat] no water against the enderman at ${bot.entity.position.floored()}: it would run off the ${runOffSides(bot, bot.entity.position.floored()).join(' and ')} side${runOffSides(bot, bot.entity.position.floored()).length === 1 ? '' : 's'} and carry the body with it`); }
    if (turned && !waterStands && !lastBucketKept && !pourRunsOff) {
      let at = await pourAtFeet(bot, check, { urgent: turned.position.distanceTo(bot.entity.position) <= 4 });
      if (at) { state.water = { at: { ...at }, poured: Date.now() }; state.pours = (state.pours || 0) + 1; goal.step = { action: 'end_water', against: 'enderman', at: { ...at } }; save(); console.log(`[end combat] water poured at ${vector(at)} against the enderman ${Math.round(turned.position.distanceTo(bot.entity.position))} blocks off (${countOf(bot, 'water_bucket')} full left)`); }
      else if (runOffSides(bot, bot.entity.position.floored()).length >= 2 && turned.position.distanceTo(bot.entity.position) <= 4.5 && (countOf(bot, 'water_bucket') >= 2 || bot.health < 12)) {
        at = await pourAtEndermanFeet(bot, check, turned);
        if (at) { state.water = { at: { ...at }, poured: Date.now() }; state.pours = (state.pours || 0) + 1; (state.poolsLeft ||= []).push({ x: at.x, y: at.y, z: at.z, at: Date.now() }); goal.step = { action: 'end_water', against: 'enderman', at: { ...at }, atItsFeet: true }; save(); console.log(`[end combat] water poured at ${vector(at)} at the enderman's own feet, ${Math.round(turned.position.distanceTo(bot.entity.position))} blocks off, the bot's top a run-off (${countOf(bot, 'water_bucket')} full left)`); }
      }
    }
    // Within eight (note 1462): one at six struck the bot held 'unsafe' with none within six.
    // Six again (note 1467): at eight the defence began and its loop, wanting six, ended at once, 21 passes a second (dragon-46).
    const attacker = hostileEntities(bot, 6).find(e => live(bot, e) && e.name !== 'ender_dragon');
    if (attacker && sword && !(inWater() && attacker.name === 'enderman' && !canStrike(bot, attacker))) {
      goal.step = { action: 'end_defend', target: attacker.name, distance: Math.round(attacker.position.distanceTo(bot.entity.position) * 10) / 10 }; save();
      await defendHere(2000); return;
    }
    const crystals = observeArena(bot, state);
    state.observedCrystals = crystals.map(e => ({ id: e.id, position: { ...e.position } }));
    state.dragon = dragon && { id: dragon.id, position: { ...dragon.position }, health: beforeDragon, phase: metadata(bot, dragon, 'phase') };
    // Back onto the column's cell before the ways are weighed (note 1563): a
    // body on its own column with its middle over the edge stands 'on air',
    // and no way down is offered from a cell with nothing under it. 25588
    // (dragon-113, 2026-10-14 02:48Z, two crystals broken) stood so at (8,
    // 103, -35) beside its column at (8, -36), 'only observe' four times over,
    // 38 blocks carried and the dragon coming; dragon-92 (23:08Z) the same at
    // (36, 67, -28).
    if (onOwnPillar() && bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))?.boundingBox !== 'block') {
      try { if (await centreOnColumn(0.3)) console.log(`[end combat] back onto the column's cell at ${bot.entity.position.floored()} from over its edge`); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
    }
    const tree = {}, safe = safeHere(), wet = safe && !safeEndPoint(bot, bot.entity.position);
    const guardShot = () => { check(); if (!safeHere()) throw new Error('End firing position became unsafe'); };
    // A turned enderman within sixteen is Jev's question (note 1551), not the
    // reflex's alone: the reflex fights within six for two seconds and the
    // step goes back to the quarry, the walk or the meal, and the enderman
    // comes again. 25588 (dragon-97, 2026-10-14 00:36Z, four crystals broken)
    // took six blows of 4.5 in ten seconds, three sword blows landed, both
    // buckets in pools, Jev asked about the quarry and a watch; dragon-100
    // (00:52Z) took six in thirteen seconds, Jev choosing a meal twice.
    {
      const foe = hostileEntities(bot, 16).filter(e => live(bot, e) && e.name === 'enderman').sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
      if (foe && sword) {
        const off = Math.round(foe.position.distanceTo(bot.entity.position) * 10) / 10, buckets = countOf(bot, 'water_bucket');
        const facts = { endermanBlocksOff: off, endermanHealth: 40, swordBlow: 7, blowsToKill: 6, itsBlowThroughIron: 4.5, health: bot.health, waterBucketsCarried: buckets,
          record: 'an enderman killed 25588 four times on 2026-10-13/14 (dragon-31 in 5 s through leather, dragon-37 in 3 s, dragon-85 five blows in 4 s while the quarry dug on, dragon-97 six blows in 10 s, dragon-100 six blows in 13 s while it ate); fought with the sword from the first blow it dies in six blows, about five seconds; standing in water it takes damage and teleports off and does not come into it' };
        const runOff = runOffSides(bot, bot.entity.position.floored());
        { const f0 = bot.entity.position.floored(); const closed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(f0.offset(dx, 0, dz))?.boundingBox === 'block' && bot.blockAt(f0.offset(dx, 1, dz))?.boundingBox === 'block').length; if (closed >= 3) { facts.waterNotOffered = `water poured in this hole fills it and leaves no climb out (dragon-217 died so); the hole is the shelter`; runOff.push('hole'); runOff.push('hole'); } }
        if (runOff.length >= 2 && !facts.waterNotOffered) facts.waterNotOffered = `water poured at the feet here would run off the ${runOff.join(' and ')} sides, two or more down, and carry the body with it (dragon-192 was carried off its column's top into the breath so); an enderman cannot stand beside such a top to strike`;
        tree.fight_enderman = { description: { action: `Turn on the enderman ${off} blocks off and fight it with the ${sword.name.replaceAll('_', ' ')}: it has 40 health, a blow takes 7, six blows kill it, about five seconds; its blow takes 4.5 through iron and it teleports behind the body between blows. The shield up when it is not struck.`, ...facts },
          run: async () => { goal.step = { action: 'fight_enderman', distance: off }; save(); const until = Date.now() + 8000; while (Date.now() < until) { check(); const e = hostileEntities(bot, 16).find(x => live(bot, x) && x.name === 'enderman'); if (!e) break; if (e.position.distanceTo(bot.entity.position) > 3.5) { try { await actions.navigate(bot, task, new goals.GoalNear(e.position.x, e.position.y, e.position.z, 2), { timeoutMs: 2500, stallMs: 1200 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; } } await defendHere(1500); } progress = true; } };
        // Not within eight of the void (note 1586): poured water runs down the slope to the rim and carries the body with it. 25588 (dragon-131, 2026-10-14 06:04Z) poured against an enderman at (35, 57, -20) on the eastern rim, was carried down the cliff in the flow from 55 to 30 and off the island, dead in the void at -221.
        // And never on the island's low shelf (note 1607): the shelf at 28 to 46 slopes to the void beyond eight blocks, and poured water runs down it. 25588 (dragon-147, 2026-10-14 08:51Z) poured against an enderman at (43, 30, -17), 'no void within eight', was carried east in the flow to (46, 28, -21) and off the island, dead at -224.
        const voidNear = voidEdge(bot, bot.entity.position, 8), onTheShelf = bot.entity.position.y < 50;
        if ((buckets >= 2 || (buckets > 0 && (bot.health <= 8 || off <= 4))) && !inWater() && voidNear === null && !onTheShelf && runOff.length < 2) tree.water_at_feet = { description: { lastBucket: buckets === 1 ? 'this is the last full bucket, otherwise kept for the landing after a knock off a column; offered at 8 health or under or with the enderman within four (notes 1827 and 1851: dragon-192 poured its last against one and went into the void from its column top; dragon-210 kept it and died under one\'s blows at 13.5 health)' : `${buckets} full buckets carried; the last is kept for the landing`, action: `Pour a bucket of water at the feet and stand in it: an enderman in water takes damage and teleports away, and will not step into it; the sword still reaches one that comes to its edge. ${buckets} water bucket${buckets === 1 ? '' : 's'} carried, this one taken back when none is near within eight. Poured water runs downhill and carries a body standing in it; no void lies within eight blocks here.`, ...facts },
          run: async () => { goal.step = { action: 'water_at_feet', against: 'enderman' }; save(); const at = await pourAtFeet(bot, check, { urgent: off <= 4 }); if (at) { state.water = { at: { ...at }, poured: Date.now() }; state.pours = (state.pours || 0) + 1; save(); console.log(`[end combat] water poured at ${vector(at)} at Jev's word against the enderman ${off} blocks off (${countOf(bot, 'water_bucket')} full left)`); } await defendHere(4000); progress = true; } };
        if (actions.dig && !inWater()) tree.hide_from_enderman = { description: { action: 'Dig a pocket two high into the ground here and wait in it: an enderman cannot follow into a space two high, and leaves off; about four seconds to dig, and the fight stands still while it waits.', ...facts },
          run: async () => { const { endPocket } = require('./end-pocket'); goal.step = { action: 'hide_from_enderman' }; save(); try { if (await endPocket(bot, task, { dig: actions.dig, check, hostileEntities, report: a => { goal.step = a; save(); } })) { state.pockets = (state.pockets || 0) + 1; progress = true; } } catch (err) { if (['Cancelled', 'NeedsAir'].includes(err.name)) throw err; state.pocketFailedAt = Date.now(); save(); } } };
      }
    }
    const shoot = async target => {
      delete bot._shootEnded;
      try { return await shootOnce(target); } catch (err) { bot._shootEnded = err.name === 'EndEmergency' ? `cut by an emergency` : String(err.message || err).replace(/\d+/g, 'N').slice(0, 60); throw err; }
    };
    const shootOnce = async target => {
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
        if (target === dragon) result.dragonBefore = metadata(bot, dragon, 'health');
        state.shots.push(result); state.shots = state.shots.slice(-256); save();
        const until = Date.now() + Math.min(5000, Math.ceil(result.ticks * 50) + 500);
        while (Date.now() < until) { check(); if (!safeHere()) break; await sleep(50); }
        if (target === dragon) { result.dragonAfter = live(bot, dragon) ? metadata(bot, dragon, 'health') : null; save(); }
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
      const pr = require('./perch-record'); pr.begin(bot, 'ground');
      try {
        while (Date.now() < until) {
          check(); checkEndEmergency(bot);
          const fresh = live(bot, dragon) && perchedHead(bot, dragon);
          if (!fresh || !(safeHere() || strikeSafeNow()) || !canStrike(bot, fresh)) break;
          if (typeof bot.lookAt === 'function') await bot.lookAt(fresh.position.offset(0, .5, 0), true);
          const before = dragon.health ?? metadata(bot, dragon, 'health');
          bot.attack(fresh); swings++;
          for (let n = 0; n < 7; n++) { check(); await sleep(100); }
          const after = live(bot, dragon) ? (dragon.health ?? metadata(bot, dragon, 'health')) : null;
          pr.swing(bot, { landed: Number.isFinite(before) && Number.isFinite(after) && before - after >= 1 });
        }
      } finally { state.headSwings = (state.headSwings || 0) + swings; save(); }
      if (!swings) throw new Error('Perched dragon head moved out of reach');
    };
    const bow = bot.inventory.items().some(i => i.name === 'bow' && durable(bot.registry, i));
    let noShot = !safe ? `not safe here (${unsafeBecause(bot, bot.entity.position).slice(0, 3).join(', ')})` : !bow || !countOf(bot, 'arrow') ? 'no bow or arrows' : !dragon ? 'no dragon in view' : perched(bot, dragon) ? 'perched' : null;
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
            position: { ...target.position }, blocks: lift, blocksCarried: carried, fallFromTheTop: `a knock off the top is a fall of ${lift} blocks, about ${Math.max(0, lift - 3)} damage before armour${countOf(bot, 'water_bucket') ? ', a water bucket carried for the landing' : ''}; the bucket under the body in a fall (2026-10-14, runs 150 to 172): 24 landings in the water, 10 dry, 8 deaths`,
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
    if (safe && bow && countOf(bot, 'arrow') > 0) {
      // The shot's facts beside the climb's (note 1907): with 64 arrows in the kit (the user's call, 2026-10-19) the shot from the ground is the way a player takes most crystals, no climb, no column and no way down; the option had said only 'a clear bow trajectory'. It says how far and how high the crystal is, the arrow's flight, the seconds standing still to draw, the arrows left, and this stage's record of shots at crystals.
      // The record by what stands (note 1909): the burst is seen at the server's whim, and 25588's dragon-307 read '7 arrows at crystals this fight: 1 burst seen' with five crystals shot down. A crystal shot at and gone since fell to the arrow.
      const shotRecord = (() => { const standingIds = new Set(crystals.map(c => c.id)); const all = (state.shots || []).filter(s => s.target === 'end_crystal' && s.at > (state.fightStartedAt || 0)); const ids = [...new Set(all.map(s => s.targetId))]; const gone = ids.filter(id => !standingIds.has(id)).length; return all.length ? `${all.length} arrow${all.length === 1 ? '' : 's'} at ${ids.length} crystal${ids.length === 1 ? '' : 's'} this fight: ${gone} of them gone since, ${ids.length - gone} still standing` : 'no arrow at a crystal yet this fight'; })();
      // No shot at a caged crystal (note 1908): iron bars stand round it and the arrow stops on them, and 25588's dragon-306 (2026-10-19 18:1xZ), seven crystals shot down in ten minutes, spent its last minutes shooting at crystal 42 in its cage from the open ground, 'target_remains', until the fireballs found it, 20 to none at three crystals left. The caged crystal's climb says the arrow cannot reach it.
      for (const target of crystals) { if (caged(bot, target)) continue; if (repeatedCrystalMiss(state, target, bot.entity.position)) continue; const aim = aimAtEntity(bot, target); if (!aim) continue;
        const off = Math.round(Math.hypot(target.position.x - bot.entity.position.x, target.position.z - bot.entity.position.z)), up = Math.round(target.position.y - bot.entity.position.y);
        tree[`crystal_${target.id}`] = {
          description: { action: `Shoot crystal ${target.id} with the bow from where the bot stands: it is ${off} blocks off and ${up} up on its pillar, the arrow's path to it is clear and flies about ${Math.round(aim.ticks / 20 * 10) / 10} s; the draw is about 1.2 s standing still, and any hit bursts the crystal (the blast ${off} blocks off reaches nothing here). No climb, no column, no way down: the body stays on the ground`,
            position: { ...target.position }, blocksOff: off, blocksUp: up, flightSeconds: Math.round(aim.ticks / 20 * 10) / 10, arrowsLeft: countOf(bot, 'arrow'), crystalsInView: crystals.length, shotRecord, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null, health: bot.health },
          run: () => shoot(target),
        }; }
      if (dragon && !perched(bot, dragon)) {
        for (let n = 0; n < 6; n++) { check(); await sleep(50); }
        let motionNow; try { motionNow = velocity(); } catch (err) { noShot = err.message; /* no feasible predicted shot */ }
        const trajectory = motionNow && aimAtEntity(bot, dragon, motionNow);
        if (motionNow && !trajectory) noShot = `no clear arrow trajectory to it ${Math.round(dragon.position.distanceTo(bot.entity.position))} blocks off`;
        if (trajectory) tree.shoot_dragon = {
          description: { action: 'Shoot the currently arrow-vulnerable flying dragon along the checked clear trajectory',
            safeFiringPosition: true, flightSeconds: trajectory.ticks / 20, dragonHealth: beforeDragon, observedHealingCrystals: crystals.length, arrowsLeft: countOf(bot, 'arrow'),
            // What the choice came to this fight (note 2200): dragon-313 (25592, 2026-10-26) chose it 90 times in 31 minutes, 19 picks ended before an arrow left the bow (the firing position unsafe, no clear trajectory, a fireball's cut), the dragon lost 10 health to the arrows in all, and the question said nothing of it each time.
            thisFight: dragonShotsSays(state, beforeDragon),
            // The shot's reach in the record (note 2277): the dragon's health lost in the eight seconds after each pick, by the
            // arrow's flight time, over every End trial's log kept on 2026-10-27. dragon-377 (25589, 47 minutes, no crystal left)
            // shot from 50 to 74 blocks, 41 arrows for 16 health; stronghold-1-dragon-373 shot from 9 and 10 and took it to 18.
            byFlight: shotFlightSays(trajectory.ticks / 20),
            // The arrows against the crystals (note 1172): one loosed at the dragon is one fewer for a crystal, and a crystal standing heals back what the arrow took.
            ...(crystals.length ? { crystalsHealIt: `${crystals.length} healing crystal${crystals.length === 1 ? '' : 's'} in view still stand${crystals.length === 1 ? 's' : ''}: each heals the dragon while it flies near, only an arrow reaches one on its pillar, and ${countOf(bot, 'arrow')} arrow${countOf(bot, 'arrow') === 1 ? ' is' : 's are'} left` } : {}), ...(wet ? { fromItsWater: wetSays() } : {}) }, run: async () => { const t = state.dragonShots ||= { chosen: 0, loosed: 0, ended: {} }; t.chosen++; const n = state.shots.length; try { await shoot(dragon); } finally { if (state.shots.length > n && state.shots.at(-1).target === 'ender_dragon') t.loosed++; else { const why = bot._shootEnded || 'ended before the shot'; t.ended[why] = (t.ended[why] || 0) + 1; } delete bot._shootEnded; save(); } },
        };
      }
    }
    const head = dragon && perchedHead(bot, dragon);
    // How long the dragon has sat (note 1405): it takes off after five
    // seconds to most of a minute, and the run under it is said with that.
    if (dragon && perched(bot, dragon)) state.perchedSince ||= Date.now(); else delete state.perchedSince;
    // How long the dragon has been coming down (note 2199): the landing approach (phase 2) and the landing (3) before it sits.
    if (dragon && live(bot, dragon) && [2, 3].includes(metadata(bot, dragon, 'phase'))) { if (!state.landingSince) { state.landingSince = Date.now(); state.landings = (state.landings || 0) + 1; } } else delete state.landingSince;
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
      tree.strike_head = { description: `${sitsSays()} Strike the reachable head of the perched dragon with the carried sword, and keep striking for as long as it sits and the place stays safe, up to ten seconds${edge ? `: the void is ${edge} block${edge === 1 ? '' : 's'} from where the bot stands, and the dragon's wing throws a player` : ''}. The perched dragon breathes its cloud at the one before its head, six a second, and its body strikes those beside it: 25588 (dragon-261, 2026-10-15 09:56Z) came up out of its hole to strike the head 3 off with all ten crystals standing, was struck and breathed on at once, 20 to none in two seconds, the dragon's health unmoved. ${healingSays(crystals.length)}. ${require('./perch-record').says(bot)}.`, run: () => strikeWhilePerched(10000) };
    }
    // The perched head out of reach: straight to the ground under it and the
    // sword there for as long as it sits (note 1155). Three routes surveyed
    // a second each and one swing a question were the perch gone: the
    // rehearsal of 2026-10-04 (02:12 to 02:15Z), waiting by the fountain,
    // was 8 to 20 blocks from the head at each of six perches and never
    // under it.
    const swordCarried = bot.inventory.items().some(i => /_sword$/.test(i.name) && durable(bot.registry, i));
    // Not while a crystal stands (note 1656): the head's blows are healed back in seconds (note 1629) and the run to it is the take-off's throw; with the record on the option (note 1654) 25588 still took it, and dragon-176, 188, 189 and 191 (2026-10-14, 15:13 to 18:06Z) died so within three hours, four of the hour's five deaths at the end, none with a point of lasting damage. The head is sought when the crystals are down; the state says so.
    if (atHand && head && !canStrike(bot, head) && swordCarried && head.position.distanceTo(bot.entity.position) <= 40 && !crystals.length) {
      // The head's line (note 1617): the dragon's wings are boxes four wide, grown four each way and two up and down, at its sides; in the game's code they push every body in them 4 / d² and lift it 0.2 a tick, perched or not. They reach six fore and aft of the body and ten aside, so the ground under the head is out of them only at 6.1 forward or more, and a run that comes in from the side passes through them. 25588 (dragon-154, 2026-10-14 09:58Z, all ten crystals broken) ran in from the side at 13 blocks, was lifted at 6 from the body to y 72, 20 to 13.6, 'out of the sword's reach', and the next run ended it; dragon-151 and 153 the same. The stand is 7.2 forward on the line; the run comes to a point 11 forward first, in front of the head.
      const axis = { x: Math.sin(dragon.yaw || 0), z: Math.cos(dragon.yaw || 0) };
      const stand0 = dragon.position.offset(axis.x * 7.2, 0, axis.z * 7.2);
      let ground = null;
      for (let y = Math.floor(head.position.y); y >= Math.floor(head.position.y) - 8 && !ground; y--) {
        const p = new Vec3(Math.floor(stand0.x) + .5, y, Math.floor(stand0.z) + .5);
        if (dryStanding(bot, p)) ground = p;
      }
      const alongAside = () => { const rel = { x: bot.entity.position.x - dragon.position.x, z: bot.entity.position.z - dragon.position.z }; return { along: rel.x * axis.x + rel.z * axis.z, aside: Math.abs(rel.x * axis.z - rel.z * axis.x) }; };
      const inFront = () => { const { along, aside } = alongAside(); return along >= 6.5 && aside <= 2.5; };
      const front = dragon.position.offset(axis.x * 11, 0, axis.z * 11);
      // Within the sword's reach from the ground, or from two blocks laid under the feet.
      if (ground && head.position.y - ground.y <= (actions.dig ? 6.4 : 4.5)) tree.under_head = {
        description: { dragonSitting: sitsSays(), action: 'Run to the ground under the perched dragon\'s head and strike it with the sword for as long as it sits: the sword reaches the dragon only here, its breath pools on the ground before its head, and it takes off within seconds',
          headBlocksOff: Math.round(head.position.distanceTo(bot.entity.position)), headBlocksOverItsGround: Math.round((head.position.y - ground.y) * 10) / 10, dragonHealth: beforeDragon, health: bot.health,
          perchRecord: require('./perch-record').says(bot),
          voidEdgeBlocks: voidEdge(bot, ground), endermenNearRoute: endermenNearRoute(bot, bot.entity.position, ground), headHitThroughArmourWorn: headHit(bot), healing: healingSays(crystals.length), ...(crystals.length ? { withCrystalsStanding: headWithCrystalsRecord } : {}),
          perchedSeconds: Math.round((Date.now() - state.perchedSince) / 1000), runSeconds: Math.round((inFront() ? ground.distanceTo(bot.entity.position) : front.distanceTo(bot.entity.position) + front.distanceTo(ground)) / 5.6 * 10) / 10,
          wayIn: `${inFront() ? 'the bot stands in front of the head already' : `the run goes to a point 11 blocks in front of the dragon first (${Math.round(front.distanceTo(bot.entity.position))} blocks off) and comes in along its head's line`}: the wings' push boxes reach six fore and aft of the body and ten aside, lift what they hold 0.2 a tick and shove it 4 over the squared distance, and a run through them from the side was lifted to y 72 and thrown (dragon-154, 151, 153, 2026-10-14)`,
          // The perch's own rule (note 1537), from the game's code: sitting, the dragon looks for a player within twenty blocks of it (and within ten up or down); seeing one it stays, turns to it, and after a second and a quarter roars and breathes at it, four breaths and then off; seeing none for five seconds it takes off. Every run of 2026-10-13 began beyond twenty blocks, and the dragon, alone at its perch, left before the run arrived.
          perchRule: `the dragon stays at its perch only while a player stands within 20 blocks of it (and within 10 up or down): alone there five seconds, it takes off. It has sat ${Math.round((Date.now() - state.perchedSince) / 1000)} s; the bot is ${Math.round(Math.hypot(dragon.position.x - bot.entity.position.x, dragon.position.z - bot.entity.position.z))} blocks from it, ${Math.max(0, Math.round((Math.hypot(dragon.position.x - bot.entity.position.x, dragon.position.z - bot.entity.position.z) - 20) / 5.6 * 10) / 10)} s of running from the 20-block ring. Within the ring it turns to the bot and breathes at it every few seconds, the cloud on the ground before its head; after four breaths, or 50 damage taken while sitting, it takes off.`,
          takeoff: `it sits from about five seconds to most of a minute; as it takes off its body knocks what stands beside it high into the air, and ${countOf(bot, 'water_bucket') ? 'a water bucket is carried to land in' : 'no water bucket is carried to land in'}: the dragon stage of 2026-10-07 (25588) ran under it 18 seconds into a perch with none, arrived as it took off, was hit for 10 and thrown 56 blocks up, and died of the fall`,
          // This fight's record of the run (note 1510): 25588 (dragon-77, 2026-10-13 19:44 to 19:51Z) ran four times from 20 to 40 blocks, reached the head none, 'the dragon took off before the bot was under its head', and lost 6 to 7 health to a run twice.
          // The day's record (note 1526): the runs across the trials of 2026-10-13 (dragon-6 to dragon-86), none of them a strike, and the take-off's throw the end of three fights.
          todaysRecord: 'Of the runs under the perched head in the trials of 2026-10-13 (nine ended by the dragon taking off first, none reaching the head; each began 20 to 40 blocks out, beyond the 20 blocks at which the dragon sees a player and stays), none struck it; three fights ended within fifteen seconds of a run: dragon-70 (18:00Z, three blows of the dragon at the perch, 20 to 9, then the breath), dragon-77 (20:01Z, three blows in a second and a half, 20 to 9.4, the record run of nine crystals), dragon-86 (21:42Z, two blows and the take-off threw the body 44 blocks to its death).',
          thisFight: state.underHead?.tries ? `this fight's ${state.underHead.tries} run${state.underHead.tries === 1 ? '' : 's'} under the head: ${state.underHead.reached} reached it before it took off, ${state.underHead.struck} struck it, ${Math.round(state.underHead.lost * 10) / 10} health lost on the runs` : 'not run this fight yet',
          ...(drillSays(bot) ? { drill: drillSays(bot) } : {}) },
        run: async () => {
          const tally = state.underHead ||= { tries: 0, reached: 0, struck: 0, lost: 0 }; tally.tries++; const healthAtStart = bot.health;
          bot._underHeadRun = true; setTimeout(() => { bot._underHeadRun = false; }, 60000);
          const reached = () => { const h = live(bot, dragon) && perchedHead(bot, dragon); return !h || canStrike(bot, h); };
          // The run stopped for a mob within four, not for the dragon itself (note 1612): the dragon counts among the hostiles, and the run to the ground under its head passes within four of its body on the way, so the run ended there, beside the body and eight from the head, 'out of the sword's reach', and the take-off's throw followed (25588, dragon-151, 2026-10-14 09:14Z, the body at (-4, 63, 1), the dragon at (-1, 65, 0), the head at (3, 64, 5); dead at 14.6 health 50 blocks off).
          // To the front of the head first (note 1617), unless the body is there already.
          if (!inFront()) {
            try { await actions.navigate(bot, task, new goals.GoalNear(Math.floor(front.x), ground.y, Math.floor(front.z), 1.5), { timeoutMs: 9000, stallMs: 2500, sprint: true, stopWhen: () => !(live(bot, dragon) && perchedHead(bot, dragon)) || inFront() || hostileEntities(bot, 4).some(e => live(bot, e) && e.name !== 'ender_dragon') }); }
            catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency'].includes(err.name)) throw err; }
            const { along, aside } = alongAside();
            console.log(`[end combat] to the front of the perched head: ${Math.round(along * 10) / 10} forward, ${Math.round(aside * 10) / 10} aside of the dragon's line at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health`);
            if (!(live(bot, dragon) && perchedHead(bot, dragon))) throw new Error('The dragon took off before the bot was in front of its head');
          }
          try { await actions.navigate(bot, task, new goals.GoalNear(Math.floor(ground.x), ground.y, Math.floor(ground.z), 1), { timeoutMs: 9000, stallMs: 2500, sprint: true, stopWhen: () => reached() || hostileEntities(bot, 4).some(e => live(bot, e) && e.name !== 'ender_dragon') }); }
          catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency'].includes(err.name)) throw err; }
          let h = live(bot, dragon) && perchedHead(bot, dragon);
          tally.lost += Math.max(0, healthAtStart - bot.health); save();
          if (!h) throw new Error('The dragon took off before the bot was under its head');
          tally.reached++; save();
          // The last blocks closed on foot (note 1558): the walk ended within its
          // goal's radius but not under the head, and 25588 (dragon-108,
          // 2026-10-14 02:05Z, eight crystals broken, the fight's one run that
          // reached the dragon) stood 3.6 blocks from the head's box, 'out of
          // the sword's reach', and was flung by the take-off. Said with the
          // geometry either way.
          const gapTo = head => { const e = bot.entity.position.offset(0, 1.62, 0); return Math.round((Math.hypot(Math.max(0, Math.abs(head.position.x - e.x) - .5), Math.max(0, Math.abs(head.position.z - e.z) - .5))) * 10) / 10; };
          if (!canStrike(bot, h) && gapTo(h) > 1.2) {
            try {
              // With the jump when the head's ground is a step up from the feet (note 1615): the fountain's rim stands a block over its floor, and 25588 (dragon-153, 2026-10-14 09:25Z) on the floor at (1, 62, 1) walked three seconds into the step with the head at (5, 64, 4), '4 aside, out of reach', and was thrown into the void by the take-off; dragon-151 the same at eight aside.
              await require('./motion').move(bot, task, { label: 'under_head_close', keys: ground.y > Math.floor(bot.entity.position.y) + 0.5 ? ['forward', 'sprint', 'jump'] : ['forward', 'sprint'], sneak: false, why: 'the last blocks to the ground under the perched head (note 1558)', look: h.position.offset(0, -2, 0), maxMs: 3000, tick: 25,
                until: () => { const hh = live(bot, dragon) && perchedHead(bot, dragon); return !hh || canStrike(bot, hh) || gapTo(hh) <= 1.0; } });
            } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
            h = live(bot, dragon) && perchedHead(bot, dragon);
            if (!h) throw new Error('The dragon took off before the bot was under its head');
          }
          console.log(`[end combat] under the head: the head modelled at ${h.position.floored()} (dragon at ${dragon.position.floored()}, yaw ${Math.round((dragon.yaw || 0) * 100) / 100}), the body at ${bot.entity.position.floored()}, ${gapTo(h)} aside and ${Math.round((h.position.y - (bot.entity.position.y + 1.62)) * 10) / 10} over the eyes, ${canStrike(bot, h) ? 'in reach' : 'out of reach'}`);
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
          try { await strikeWhilePerched(10000); } finally { bot._underHeadRun = false; }
          { const after = metadata(bot, dragon, 'health'); if (Number.isFinite(after) && after < beforeDragon) tally.struck++; save(); }
        } };
    }
    // A crystal broken by hand (note 1414): up a pillar of the blocks carried
    // beside the crystal's obsidian pillar, and the crystal struck from there
    // with whatever is in hand; any blow breaks one. Its blast is centred on
    // the top face of the bedrock it stands on, so every ray of the blast
    // that goes downward enters the bedrock: a bot wholly under that face is
    // out of the blast's line. Beside a thin pillar (radius two) the crystal
    // is in reach from two blocks under the top, and the bot stands there;
    // beside a thick one it is not, and the bot goes onto the top, two blocks
    // from the bedrock, crouched, its body above the face in the blast's
    // line (struck from beside it standing, the arena's drill of 2026-10-06
    // took 11.8 in full iron). Measured in the arena: PUNCH_RECORD. With no
    // bow, arrows or snowballs this is the one way to the crystals: 25595
    // (2026-10-13 23:08 to 23:28Z), three arrows against eight crystals, was
    // offered 462 moves and four shots in twenty minutes, answered 'none
    // good' two times in three, and died with the dragon unhurt. A caged
    // crystal is the pickaxe's (open_cage).
    // From its own pillar too, where the ground's mobs below make the place
    // 'unsafe' (the climb goes on, not down and up again), with no hazard on it.
    // The crystal's own twelve blocks (a hazard to a shot at it) are no bar
    // to the climb to strike it (note 1416): 25588 (dragon-6, 2026-10-13
    // 05:40Z), 22 up its column beside the crystal, was held 'unsafe: end
    // crystal 10<=12' at every tick, offered nothing, and died of the fall.
    // And from the obsidian top itself, where the blow is struck (note 1426):
    // 25588 (dragon-11, 2026-10-13 06:27Z), a cell short of its stand on the
    // top, was offered nothing there ('unsafe: end crystal 4<=12'), took the
    // dragon's wing twice and fell.
    const punchPlace = safe || ((onOwnPillar() || onObsidianTop()) && endHazards(bot).filter(({ entity }) => entity.name !== 'end_crystal').every(({ entity, radius }) => hazardDistance(bot.entity.position, entity) > radius));
    // The tunnel offered with the dragon the only thing making the ground unsafe (note 1808): with the dragon within twenty every crystal option fell away and the ask held escape moves alone, each ending within three blocks of where it began. 25588's dragon-178 (2026-10-18 01:06 to 01:2xZ) stood so at (35, 61, 22) at full health under the dragon hovering eight blocks over it for sixteen minutes, 300 answers of none_good, the tunnel under the island (out of its sight) never on the list. The climbs stay for the safe ground; the tunnel goes under it.
    // Endermen not hunting the bot count like the dragon here (note 1815): one standing within twenty, calm, made the ground 'unsafe' and took every climb and tunnel off the list; 25588's dragon-185 (2026-10-18 02:41Z) sat in its hole at crystal 9's foot, the tunnel just dug and a pickaxe carried, and was offered moves, the enderman and dig_up_to_the_surface alone. A hunting mob ('hostile path') or a cloud still closes the list. The climbs stay unless the dragon itself is near.
    const unsafeReasons = safe ? [] : unsafeBecause(bot, bot.entity.position);
    // A hunting enderman too (note 1859, after 1815 for a calm one): 'hostile path' from an enderman turned on the bot took every climb and tunnel off the list, and 25588's dragon-217 (2026-10-18 14:50Z) sat at the tunnel's end under crystal 84's foot with fight, hide and dig-up alone, Jev at none_good 0.84. The walled climb is closed at the head's height on every level and the tunnel is under the ground; the fight stays offered beside them. Any other hostile (a shulker's shell, an endermite) still closes the list.
    const onlyEndermenAbout = hostileEntities(bot, 24).every(e => !live(bot, e) || e.name === 'enderman' || e.name === 'ender_dragon');
    const dragonOnly = !safe && unsafeReasons.length > 0 && unsafeReasons.every(r => /^(ender_dragon |enderman |hostile path)/.test(r)) && (onlyEndermenAbout || unsafeReasons.every(r => /^(ender_dragon|enderman) /.test(r)));
    const dragonNear = unsafeReasons.some(r => /^ender_dragon /.test(r));
    if ((punchPlace || dragonOnly) && actions.dig && !Object.keys(tree).some(k => /^(throw_|pillar_throw_)/.test(k))) {
      const here = bot.entity.position, carried = blocksCarried(bot);
      // A caged crystal too, where a pickaxe is carried: its iron bars between
      // the stand and the crystal are dug out on the top before the blow.
      const pickForBars = bot.inventory.items().find(i => /_pickaxe$/.test(i.name) && !/wooden|golden/.test(i.name));
      // The three cheapest pillars, not the two nearest (note 1582): the climb's
      // cost is its lift and the walk, and the nearest pillar is often the
      // tallest. Of the 410 none_good tops on dragon_fight between 03 and 05Z
      // on 2026-10-14, 93 were on a tree of moves, observe and the quarry for
      // the nearest crystal alone, its climb gated by the blocks wanted, while
      // a pillar twenty blocks shorter stood forty blocks off, never offered.
      const climbCost = c => Math.max(0, c.position.y - 2 - Math.floor(here.y)) + Math.hypot(c.position.x - here.x, c.position.z - here.z) / 4;
      const byDistance = crystals.filter(c => (!caged(bot, c) || pickForBars) && bot.blockAt(c.position.floored().offset(0, -1, 0))?.name === 'bedrock')
        .sort((a, b) => climbCost(a) - climbCost(b)).slice(0, 3);
      for (const target of byDistance) {
        const c = target.position.floored(), topY = c.y - 1;
        // The pillar's radius, read along its side a few blocks under the top.
        let radius = 0; while (radius < 8 && bot.blockAt(new Vec3(c.x + radius + 1, c.y - 3, c.z))?.name === 'obsidian') radius++;
        const isCaged = caged(bot, target), under = radius <= 2 && !isCaged, feetY = under ? topY - 1 : topY;
        const out = Math.round(Math.hypot(c.x + .5 - here.x, c.z + .5 - here.z)), lift = feetY - Math.floor(here.y);
        // Three over the lift (note 1468): the roofs on the way are of the same blocks, and 25588 (dragon-48, 2026-10-13 13:12Z) climbed 22 for a lift of 23 and stopped a block short with none left.
        // The three over the lift only before the climb (note 1470): on the column already, the climb finishes with what is carried. 25588 (dragon-52, 2026-10-13 13:53Z) at crystal 98's top, lift 28 and 30 blocks, was offered no blow, held 30 seconds 'unsafe: end_crystal 4<=12', and the breath took it 20 to none.
        // The roofs counted in (note 1541): one block every third block of the climb against the obsidian, and 25588 (dragon-95, 2026-10-13 23:53Z) began crystal 94's climb of 31 with 27 blocks and stood at 72 with 18 and 22 to go, no blow offered, and dug down.
        const roofs = Math.ceil(Math.max(0, lift) / 3);
        const margin = (onOwnPillar() || onObsidianTop()) ? 0 : 3 + roofs + 8; // The pocket before the blow under the bedrock (note 1675) wants eight too (note 1677): dragon-212 (2026-10-14 23:45Z) climbed 16 for crystal 89 with 15 and struck with none to spare, no pocket. // The stand's walls (note 1664) counted in (note 1666): eight blocks on the top for the stand case; dragon-201 climbed 23 with 26 and had three at the top, no walls, and the body struck it twice there.
        // A lift of none is a stand reached (note 1472): 25588 (dragon-54, 2026-10-13 14:13Z) stood at crystal 66's stand, 'no blow at crystal 66: 3 off, lift 0', held 'unsafe' twenty seconds and died in the breath; dragon-52 the same at 98.
        // The quarry offered for the walled climb's blocks too (note 1760; every crystal's, note 1761): the caged crystal's climb is walled with five blocks a level and eight more, and with fewer the climb is bare. 25588's dragon-41, 42, 53 and 55 (2026-10-16 20:43 to 23:27Z) climbed caged crystals bare with 100 of 193, 44 of 123, 41 of 68 and 73 of 133 carried, no quarry offered (it was offered only under the bare climb's count), were thrown off by the dragon's body and died of the fall.
        // The tunnel to the crystal's foot (note 1769): one wide and two high under the island's surface from the hole the body is in, each cell's two stone picked up as it steps in, roofed where the ground above is open, ending in a hole at the pillar's foot. Of 25588's 59 deaths on this stage (2026-10-16/17) the step at death was on the open ground between crystals 15 times (the quarry, a walk, a wait, a meal: the dragon's body and the breath find the body there) and a bare climb 19 times; the tunnel keeps the body out of the dragon's sight to the foot, and its stone (two a cell) is the walls' (five a level). In 23 runs after the walls (dragon-111 to 133) ten broke no crystal.
        // From the open ground too (note 1777): a shaft three down first, roofed, then the tunnel; before, the tunnel was offered only from a hole, and between the descent and the next hole Jev walked the surface to the next crystal (pillar_punch), where the fireballs come every ten to twenty seconds and each costs two blocks up and a roof. 25588's dragon-143 (2026-10-17 17:1xZ, two crystals broken, three tunnels) met 29 clouds on the surface in one run, 65 blocks to none, dead at the fountain.
        // Four solid under the feet, not six (note 1792): the island over an earlier tunnel is thinner than six, and the floor under the tunnel's own level is checked below; 25588's dragon-161 (2026-10-17 21:3xZ, one crystal, 186 blocks) stood beside its hole at (34, 61, -21) over its first tunnel with nothing offered but walks with no path and 'observe', forty minutes into the run.
        // The open has the sky over it (note 1876): an old tunnel, past inTunnel()'s minute, read as the open ground, and the shaft three down went in from inside it; 25588's dragon-226 (2026-10-18 17:53Z) at (36, 47, 22) in a tunnel of its own dug 'the hole roofed at (37, 46, 19)', '(37, 44, 19)' and tunnelled on at 44, three under, the sinking of note 1863 by another way. Solid within twelve over the head is no open ground.
        const skyOverhead = ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].some(dy => bot.blockAt(here.floored().offset(0, dy, 0))?.boundingBox === 'block');
        const fromTheOpen = !holeHere() && !inTunnel() && skyOverhead && onTheGround() && !inWater() && [1, 2, 3, 4].every(dy => bot.blockAt(here.floored().offset(0, -dy, 0))?.boundingBox === 'block') && voidEdge(bot, here, 4) === null;
        // A pit on the body's own column (note 1790): a column climbed from a deep tunnel's end reaches down through the island, and the body coming down it stops at the ground's level in a one-wide pit that counts as 'on own pillar', so no hole, no tunnel and no quarry was offered, only walks with no path; 25588's dragon-159 (2026-10-17 20:1xZ, one crystal, 161 blocks) chose 185 such walks from (35, 62, 22). Walled in by ground on three sides or more at the feet, the cell is a hole for the tunnel.
        const pitOnColumn = onOwnPillar() && !onObsidianTop() && !inWater() && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(here.floored().offset(dx, 0, dz))?.boundingBox === 'block').length >= 3 && [1, 2, 3].every(dy => bot.blockAt(here.floored().offset(0, -dy, 0))?.boundingBox === 'block');
        if ((holeHere() || inTunnel() || fromTheOpen || pitOnColumn) && actions.dig && pickCarried() && out > radius + 3 && out <= 72 && Math.floor(here.y) >= 42 && (!onOwnPillar() || pitOnColumn) && !onObsidianTop()) { // y 42, not 50 (note 1782): every run begins on the island's eastern slope at y 45 to 49, where 13 of 25588's 65 deaths fell, and no tunnel was offered there; dragon-152 (2026-10-17 18:53Z) was offered the walk, the moves and the stair at (54, 48, 7), walked, and died in the clouds at (56, 43, 3) five minutes in.
          // A block under the hole's floor (note 1737), so the roof over the head is two thick: the breath's cloud on the ground above is half a block high and hurts what its box meets through the blocks, and the arena's drill (2026-10-17 15:33Z) had its tunnel at the hole's own floor cut by 'dragon_breath_cloud' from the ground a block and a half over its head.
          // Down a block only under a roof a block thick (note 1863): from a tunnel's end the roof is two thick already, and the block down each time sank the fight. 25588's dragon-220 (2026-10-18 15:36 to 15:47Z) dug fourteen tunnels, the last twelve back and forth between the feet of crystals 33 and 65 at 48, 47, 46, ... under ground at 57, every climb offered eleven taller than the island's, the pool refused under the ground, 'dig_to_sky: 11 blocks of rock over its head'.
          const roofThick = [2, 3].every(dy => bot.blockAt(here.floored().offset(0, dy, 0))?.boundingBox === 'block');
          const f0 = here.floored().offset(0, fromTheOpen ? -3 : roofThick ? 0 : -1, 0), es = q => bot.blockAt(q)?.name === 'end_stone', sd = q => bot.blockAt(q)?.boundingBox === 'block', hard = q => /bedrock|obsidian|end_portal/.test(bot.blockAt(q)?.name || '');
          // No water beside the floor or the path (note 1773): a pool left in the pit ran into the floor cell as it was dug, and 25588's dragon-139 (2026-10-17 16:4xZ, 226 blocks carried) went under at (-8, 54, 33), 'Low air: interrupt work and surface', the tunnel ended at no cell.
          const wetNear = q => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [0, 2, 0], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]].some(([dx, dy, dz]) => /water/.test(bot.blockAt(q.offset(dx, dy, dz))?.name || ''));
          const path = []; let q = f0.clone(), roofsWanted = 0, ok = true;
          // To the cell against the pillar (note 1771), within radius + 1.6 of its middle, not radius + 2.5: the climb's walk wants the foot within radius + 2.2, and 25588's dragon-139 (2026-10-17 16:2xZ) ended its tunnel 4.7 from crystal 65's middle and looped nineteen times at 'still off it', the pool poured and taken back each time.
          for (let k = 0; k < 72 && Math.hypot(c.x + .5 - (q.x + .5), c.z + .5 - (q.z + .5)) > radius + 1.6; k++) {
            const ddx = c.x - q.x, ddz = c.z - q.z, step = Math.abs(ddx) >= Math.abs(ddz) ? [Math.sign(ddx), 0] : [0, Math.sign(ddz)];
            q = q.offset(step[0], 0, step[1]);
            if (!sd(q.offset(0, -1, 0)) || hard(q) || hard(q.offset(0, 1, 0)) || voidEdge(bot, q.offset(.5, 0, .5), 4) !== null) { ok = false; break; }
            if (wetNear(q)) break;
            if (!sd(q.offset(0, 2, 0))) roofsWanted++;
            path.push(q);
          }
          if (ok && path.length >= 1 && sd(f0.offset(0, -1, 0)) && !hard(f0) && !wetNear(f0) && !wetNear(here.floored())) {
            const stone = path.filter(q => es(q) || es(q.offset(0, 1, 0))).reduce((n, q) => n + (es(q) ? 1 : 0) + (es(q.offset(0, 1, 0)) ? 1 : 0), 0);
            // The tunnels so far (note 1826): a tunnel gains end stone and cover and strikes nothing, and 25588's dragon-192 (2026-10-18 05:18 to 05:24Z, two crystals, 385 blocks, full health) dug twelve, the last six back and forth between the feet of crystals 74 and 94, never climbing. Said on every tunnel offer.
            const tunnelsSoFar = (() => { const all = state.tunnelsTo || [], since = all.filter(t => t.at > (state.lastCrystalStruckAt || 0)), feet = since.slice(-6).map(t => t.crystal); const pair = feet.length >= 4 && new Set(feet).size <= 2 ? [...new Set(feet)] : null; return `${all.length} tunnel${all.length === 1 ? '' : 's'} dug this fight, ${since.length} since the last crystal struck${pair ? `, the last ${feet.length} back and forth between the feet of crystals ${pair.join(' and ')}` : ''}; a tunnel gains end stone and keeps the body out of the dragon's sight, and strikes nothing: the crystal falls to the climb from its foot`; })();
            // The whole fight's dig budget (note 1838): 25588's dragon-200 (2026-10-18 08:49Z, two crystals, eight tunnels) took a 47-dig tunnel with 28 digs left in its pickaxe over the climb three blocks off; the pickaxe, the crafts the ingots and sticks allow, and the descents the crystals left will want are one sum, and no option said it.
            const digBudget = (() => { const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)); const left = picks.reduce((n, i) => n + Math.max(0, (bot.registry.itemsByName[i.name]?.maxDurability || 250) - (i.durabilityUsed || 0)), 0); const ingots = countOf(bot, 'iron_ingot'), sticks = countOf(bot, 'stick'), table = countOf(bot, 'crafting_table') > 0; const crafts = table ? Math.min(Math.floor(ingots / 3), Math.floor(sticks / 2)) : 0; const total = left + crafts * 250; const descents = crystals.length * 30; return `${left} digs left in the pickaxe${picks.length ? '' : ' (none carried)'}, ${crafts} more pickaxe${crafts === 1 ? '' : 's'} craftable (${ingots} ingots, ${sticks} sticks, ${table ? 'a' : 'no'} table; the End grows no wood): about ${total} digs in all for the fight; the ${crystals.length} crystals left want about ${descents} for their descents by the dig (30 each) and this tunnel ${path.length * 2}; ${total < descents + path.length * 2 ? 'the tunnel spends what the descents need' : 'the sum holds'}`; })();
            tree[`tunnel_to_${target.id}`] = {
              description: { tunnelsSoFar, digBudget, action: `${fromTheOpen ? 'Dig a shaft three down from here (about three seconds, roofed over), then a' : 'Dig a'} tunnel one wide and two high ${fromTheOpen ? '' : 'from this hole '}to the foot of crystal ${target.id}'s pillar, ${path.length} cells under the island's ground (${stone} of end stone to pick up as the body steps in, ${roofsWanted} cell${roofsWanted === 1 ? '' : 's'} with open ground over them roofed with a block carried), ending in a hole at the foot; about a second a block with the pickaxe, the body out of the dragon's sight the while. From the foot the climb is ${lift} up, walled with ${lift * 5 + 8} blocks carried (${carried} now).`,
                cells: path.length, endStoneToGain: stone, roofsToLay: roofsWanted, blocksCarried: carried, liftAtTheFoot: lift, wallsWant: lift * 5 + 8, crystalBlocksOff: out,
                // The pickaxe's uses against the tunnel's digs (note 1793): an iron pickaxe lasts 250 blocks, a cell is two digs, and 25588's dragon-162 (2026-10-17 21:5xZ) wore two out in one run, the second five minutes after it was made, with the tunnel ended 'the pickaxe gone' and only walks with no path left.
                pickaxe: (() => { const p = bot.inventory.items().find(i => /_pickaxe$/.test(i.name) && !/wooden|golden/.test(i.name)) || bot.inventory.items().find(i => /_pickaxe$/.test(i.name)); const left = p ? Math.max(0, (bot.registry.itemsByName[p.name]?.maxDurability || 0) - (p.durabilityUsed || 0)) : 0; const ingots = bot.inventory.items().filter(i => i.name === 'iron_ingot').reduce((n, i) => n + i.count, 0); return `${p ? `${p.name.replace('_', ' ')} with ${left} digs left` : 'no pickaxe'}; this tunnel is about ${path.length * 2 + (fromTheOpen ? 3 : 1)} digs${p && left < path.length * 2 + 3 ? ', more than the pickaxe has: it ends when the pickaxe breaks' : ''}; ${ingots} iron ingots carried, three make another pickaxe at the crafting table${bot.inventory.items().some(i => i.name === 'crafting_table') ? ' carried' : ' (none carried)'}`; })(), health: bot.health, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(here)) : null,
                climbRecord: require('./climb-record').says(bot),
                record: 'a tunnel strikes no crystal by itself: every crystal struck on this stage fell to a climb from a pillar\'s foot; underground the body is out of the dragon\'s sight, and no death on this stage has been recorded in a tunnel' },
              run: async () => {
                const t0 = Date.now(), before = blocksCarried(bot); let cells = 0, roofs = 0, why = 'reached';
                goal.step = { action: 'tunnel_to_crystal', crystal: target.id, cells: path.length }; save();
                // A breath cloud on the way, not walked or dug into (note 2324): a cloud's box is its radius about it and
                // half a block up and down, and a cell the body stands in that meets it takes six a second, in a tunnel
                // with no run out. The stage of 2026-10-28 (25592, dragon-463, 02:00:24Z) took tunnel_to_43 with a cloud
                // 2.9 off and 3 down, dug into it, and died in the pit, 9.5 to none, no run from four walls.
                const cloudIn = cell => Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position &&
                  Math.hypot(cell.x + .5 - e.position.x, cell.z + .5 - e.position.z) <= cloudRadius(bot, e) + 0.4 && e.position.y >= cell.y - 0.6 && e.position.y <= cell.y + 1.9);
                { const fd = bot.entity.position.floored(), shaft = []; for (let y = fd.y - 1; y >= f0.y; y--) shaft.push(new Vec3(fd.x, y, fd.z));
                  const c0 = shaft.map(cloudIn).find(Boolean);
                  if (c0) { console.log(`[end combat] the tunnel to crystal ${target.id} not begun from ${fd}: the breath's cloud lies in its way down, ${Math.round((fd.y - c0.position.y) * 10) / 10} below the feet, ${Math.round(cloudRadius(bot, c0) * 10) / 10} wide`); return false; } }
                for (let d = 0, edged = 0; d < 6 && Math.floor(bot.entity.position.y) > f0.y; d++) { const y0 = Math.floor(bot.entity.position.y), under = new Vec3(Math.floor(bot.entity.position.x), y0 - 1, Math.floor(bot.entity.position.z));
                  // The body on a block's edge (note 1784): 'air under the feet' with the body on the ground means it stands over the lip of the cell beside, and the shaft gave up; 25588's dragon-153 (2026-10-17 19:0xZ) twice at (31, 56, -23), the arena the same. The body steps onto the solid cell beside first.
                  if (!sd(under)) { if (edged++ >= 2) break; const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => under.offset(dx, 0, dz)).find(c => sd(c) && !sd(c.offset(0, 1, 0)) && !sd(c.offset(0, 2, 0))); if (!nb) break; try { await centreOn(nb.x, nb.z, 0.25, { maxMs: 1200 }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } continue; } if (hard(under)) throw new Error(`${bot.blockAt(under)?.name} under the feet at ${under}: no shaft down`); await actions.dig(bot, task, under, { requireDrops: false, dropInto: true, openPit: true }); for (let i = 0; i < 30 && Math.floor(bot.entity.position.y) >= y0; i++) await sleep(50); for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50);
                  // The shaft roofed after the first block down (note 1778): a fireball thrown at the body in an open shaft bursts in it and its cloud lies on the shaft's floor with the body, no climb and no run; 25588's dragon-147 and 148 (2026-10-17 17:5xZ) died that way two blocks down, 'tunnel_to cut by the breath's cloud at the feet', 77 and 103 blocks carried. The rest is dug under the roof.
                  if (fromTheOpen && d === 0 && blocksCarried(bot) >= 1) { try { await roofHole(true); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } } }
                if (Math.floor(bot.entity.position.y) > f0.y) { const fe = bot.entity.position.floored(); throw new Error(`The body did not go down to the tunnel's floor at ${f0}: the feet at ${fe} (${bot.entity.position.y.toFixed(2)}), ${bot.blockAt(fe.offset(0, -1, 0))?.name || 'nothing'} under them and ${bot.blockAt(fe)?.name || 'nothing'} at them, on ground ${bot.entity.onGround}, from the open ${fromTheOpen}`); }
                if (fromTheOpen) { try { await roofHole(true); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } }
                state.tunnelAt = Date.now();
                try {
                for (const q of path) {
                  check();
                  if (Date.now() - t0 > 150000) { why = 'out of time'; break; }
                  if (hostileEntities(bot, 4).some(e => live(bot, e) && e.name !== 'ender_dragon')) { why = 'a mob within four'; break; }
                  if (inWater()) { why = 'water'; break; }
                  if (!pickCarried()) { why = 'the pickaxe gone'; break; } // note 1779: dragon-149's tunnel to crystal 63 went on bare-handed for 156 s, 6 of 25 cells
                  if (!sd(q.offset(0, -1, 0)) || voidEdge(bot, q.offset(.5, 0, .5), 4) !== null) { why = 'no floor ahead'; break; }
                  if (wetNear(q)) { why = 'water beside the way'; break; }
                  if (cloudIn(q)) { why = 'the breath\'s cloud in the next cell'; break; }
                  for (const cell of [q.offset(0, 1, 0), q]) if (sd(cell)) { if (hard(cell)) { why = `${bot.blockAt(cell)?.name} in the way`; break; } await actions.dig(bot, task, cell, { requireDrops: false }); }
                  if (why !== 'reached') break;
                  if (!sd(q.offset(0, 2, 0))) { const block = bot.inventory.items().find(i => i.name === 'end_stone') || bot.inventory.items().find(i => require('./pillar-recovery').SCAFFOLD.includes(i.name)); if (block) { try { await actions.place(bot, task, q.offset(0, 2, 0), block.name); roofs++; } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } } }
                  await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'into_the_tunnel', keys: ['forward'], sneak: false, why: 'into the tunnel cell just dug', look: q.offset(.5, 1.6, .5), maxMs: 1500, tick: 25, until: () => Math.floor(bot.entity.position.x) === q.x && Math.floor(bot.entity.position.z) === q.z });
                  cells++; state.tunnelAt = Date.now();
                }
                } catch (err) { if (why === 'reached') why = `cut: ${err.name === 'EndEmergency' ? String(err.message || '').slice(0, 40) : err.name}`; throw err; } finally {
                const got = blocksCarried(bot) - before, g = bot.entity.position.floored();
                state.hole = { x: g.x, y: g.y, z: g.z, at: Date.now() }; (state.tunnelsTo ||= []).push({ crystal: target.id, cells, got, why, at: Date.now() }); save();
                console.log(`[end combat] the tunnel to crystal ${target.id}'s foot from ${f0}: ${cells} of ${path.length} cells dug (${why}), ${roofs} roofed, ${got} end stone gained, ${blocksCarried(bot)} carried, ${Math.round((Date.now() - t0) / 100) / 10} s, ${bot.health.toFixed(1)} health; the body at ${g}, ${Math.round(Math.hypot(c.x + .5 - g.x, c.z + .5 - g.z))} from the pillar's middle`);
                if (cells >= 4) progress = true;
                }
                if (why !== 'reached' && cells < 4) throw new Error(`The tunnel to crystal ${target.id} ended after ${cells} cells: ${why}`);
              } };
          }
        }
        const noBlow = out > 64 || lift < 0 || lift + margin > Math.min(carried, 64 + margin);
        const wallsShort = !noBlow && lift >= 1 && carried < lift * 5 + 8 && !onOwnPillar() && !onObsidianTop();
        if (noBlow || wallsShort) {
          if (noBlow && !(state.punchSkipSaid > Date.now() - 20000)) { state.punchSkipSaid = Date.now(); console.log(`[end combat] no blow at crystal ${target.id}: ${out} off, lift ${lift}, ${carried} blocks carried, radius ${radius}`); }
          // Too few blocks for the climb, a pickaxe carried and the island's
          // stone underfoot (note 1435): the blocks are dug here, Jev's to
          // choose. 25588 (dragon-19, 2026-10-13 07:53Z, full iron, an iron
          // pickaxe, 28 cobblestone) was offered a walk and a look at every
          // tick, 'no blow at crystal 13: lift 33, 28 blocks carried', the
          // island's end stone under its feet the whole while.
          const floorHere = bot.blockAt(here.floored().offset(0, -1, 0))?.name;
          // The quarry's gate is the climb's budget (note 1565): the climb wants lift + roofs + 3, and 25588 (dragon-114, 2026-10-14 03:25Z, five crystals broken) stood with 52 blocks, crystal 73's climb wanting 58, the quarry only offered under 47, 'only observe'.
          if (out <= 64 && lift >= 1 && lift <= 64 && (lift + roofs + 3 > carried || wallsShort) && pickForBars && floorHere === 'end_stone' && !onOwnPillar() && !Object.keys(tree).some(k => k.startsWith('quarry_blocks_'))) {
            // Ten over the lift (note 1464): the roofs on the way up and down are
            // of the same blocks, and 25588 (dragon-43, 2026-10-13 12:23Z, three
            // crystals broken) climbed 38 for a lift of 37 and stopped a block
            // short with none left, 'no block of the kinds the climb lays carried'.
            const want = wallsShort ? Math.min(64, lift * 5 + 8 - carried) : Math.min(24, lift + roofs + 7 + 8 - carried);
            const { deepBeside } = require('./end-safety');
            const feet = here.floored();
            const cells = [];
            // Two cells out and never below the feet (note 1461): dug at the
            // feet, each round left the bot a block lower in its own pit and
            // the climb a block taller, and the stone rolled down the slope.
            // 25588 (dragon-41, 2026-10-13 12:01Z, full iron) quarried at
            // crystal 11's foot from lift 33 to lift 48 with 40 blocks carried,
            // worked its way down the eastern slope to y 29 and went over the
            // rim. The stone dug is level with the feet or a block up.
            // Level with the feet or a block up, as the note above says, and
            // under the open sky (note 1487): the code dug the floor round the
            // feet (a block down) and the walls beside them, and each round left
            // the bot a block lower in a pit of its own, the next round digging
            // from the pit's floor. 25588 (dragon-66, 2026-10-13 16:30Z) quarried
            // 65 cells in three rounds at (41 to 51, 42 to 46, 3 to 6), dug
            // itself four blocks under the island's top and a tunnel west along
            // z 6 at 42 under solid rock, and could walk to no pillar's foot:
            // 'not reached' from 52 and 35 blocks, the pathfinder digging nothing.
            // Under the sky: no block within twelve over the cell, so no tunnel.
            const skyOver = p => { for (let dy = 1; dy <= 12; dy++) if (bot.blockAt(p.offset(0, dy, 0))?.boundingBox === 'block') return false; return true; };
            // The floor a block down as well, but only from level ground (note
            // 1494): standing in a pit (a block beside the feet at their level)
            // the walls are dug, never the floor, so no pit goes two deep. On the
            // island's flat middle nothing rises beside the feet, and 25588
            // (dragon-68, 2026-10-13 17:20Z, three crystals broken, 10 blocks
            // carried, 26 wanted) stood 'only observe' with no quarry offered.
            // Any block at the feet's level within four, not only beside them
            // (note 1503): the rounds dig a ring to four out, and standing in
            // the middle of a pit seven wide nothing is beside the feet, so the
            // floor went down again. 25588 (dragon-74, 2026-10-13 19:09Z) stood
            // at (9, 55, 10), six under the island's top, 'only observe',
            // crystal 77's climb grown from 17 blocks to 24.
            const byWater = p => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([ax, ay, az]) => /water/.test(bot.blockAt(p.offset(ax, ay, az))?.name || ''));
            let inPit = false;
            for (let dx = -4; dx <= 4 && !inPit; dx++) for (let dz = -4; dz <= 4 && !inPit; dz++) if ((dx || dz) && bot.blockAt(feet.offset(dx, 0, dz))?.boundingBox === 'block') inPit = true;
            // Out to seven (note 1547), not four: in the pits the earlier quarries left, the ring two to four out is air at the feet's level, and 25588 (dragon-97, 2026-10-14 00:32Z, four crystals broken, 32 blocks, 21 wanted) stood at (7, 60, 17) 'only observe', 'quarry cells 2'.
            if (skyOver(feet.offset(0, -1, 0))) for (let r = 2; r <= 7 && cells.length < want; r++) for (let dx = -r; dx <= r && cells.length < want; dx++) for (let dz = -r; dz <= r && cells.length < want; dz++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              for (const dy of inPit ? [1, 0] : [1, 0, -1]) {
                const p = feet.offset(dx, dy, dz);
                if (bot.blockAt(p)?.name !== 'end_stone' || bot.blockAt(p.offset(0, -1, 0))?.boundingBox !== 'block' || !skyOver(p) || deepBeside(bot, p.offset(.5, 1, .5))) continue;
                // Not beside water, nor within two of the pool poured for a drop
                // (note 1534): the water runs into the cell dug and the pool is
                // not taken back. 25588 (dragon-92, 2026-10-13 23:14Z, four
                // crystals broken) landed its 39-block drop in the pool at (11,
                // 58, 34), quarried eleven cells round (10, 56, 35) beside it,
                // never took the pool back, and poured its next with '0 full
                // buckets left'.
                if (byWater(p) || (state.pool && Math.max(Math.abs(p.x - state.pool.x), Math.abs(p.z - state.pool.z)) <= 2)) continue;
                cells.push(p); break;
              }
            }
            state.quarryLook = { crystal: target.id, cells: cells.length, want, inPit, sky: skyOver(feet.offset(0, -1, 0)), at: Date.now() }; state.quarryCells = cells.map(c => ({ x: c.x, y: c.y, z: c.z }));
            if (cells.length >= Math.min(want, 4)) tree[`quarry_blocks_${target.id}`] = {
              description: { action: `Dig ${cells.length} end stone from the island's ground within seven blocks of where the bot stands, with the ${pickForBars.name.replace('_', ' ')}, for the climb beside crystal ${target.id}'s pillar: ${lift} blocks up to its stand, ${carried} carried.${wallsShort ? ` The climb is walled on four sides with ${lift * 5 + 8} blocks carried, and bare with fewer (${require('./climb-record').says(bot)}); on 2026-10-16/17 eight of 25588's runs (dragon-41 to 61) died off bare climbs and their tops, thrown off the column by the dragon's body or stepped off it in the breath.` : ''} The floor cells dug have rock under them and no void beside; the dragon's passes and breath go on while it digs (about a second a block). The crystal is ${out} blocks off.`,
                // The record of this fight's quarries said (note 1743): Jev took the open quarry at 0.29 against the stock taken underground under 0.07 (dragon-295, 2026-10-15 17:10Z) with no word of how either had paid.
                quarriesThisFight: `open ground: ${state.openQuarry ? `${state.openQuarry.tries} begun, ${state.openQuarry.gained} stone gained in ${Math.round(state.openQuarry.seconds)} s, the rest cut by the dragon, the breath or a mob` : 'none yet'}; underground: ${state.tunnelQuarry ? `${state.tunnelQuarry.tries} tunnels, ${state.tunnelQuarry.gained} stone in ${Math.round(state.tunnelQuarry.seconds)} s` : 'none yet'}`,
                blocksWanted: lift, blocksCarried: carried, cellsToDig: cells.length, health: bot.health, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(here)) : null },
              run: async () => {
                const before = blocksCarried(bot); (state.openQuarry ||= { tries: 0, gained: 0, seconds: 0 }).tries++; const tq0 = Date.now();
                goal.step = { action: 'quarry_blocks', crystal: target.id, cells: cells.length }; save();
                let dug = 0, skipped = 0, hostile = null;
                // The quarry stops for a hostile within five (note 1525): the step's emergencies are the dragon's and the breath's, not an enderman's, and 25588 (dragon-85, 2026-10-13 21:34Z, three crystals broken, a diamond sword and a shield carried) went on digging through five blows of an enderman in four seconds, 20 to none.
                const hostileNear = () => (hostile = hostileEntities(bot, 5).find(e => live(bot, e) && e.name !== 'ender_dragon') || null);
                for (const p of cells) {
                  check();
                  if (dragonComingAtQuarry()) { console.log(`[end combat] the quarry stopped: the dragon coming, ${dug} cells dug`); break; }
                  if (hostileNear()) { console.log(`[end combat] the quarry stopped for a ${hostile.name} ${Math.round(hostile.position.distanceTo(bot.entity.position))} blocks off`); break; }
                  if (inWater() || (bot.oxygenLevel ?? 20) < 18) { console.log(`[end combat] the quarry stopped: the body in the water at ${bot.entity.position.floored()}, breath ${bot.oxygenLevel}`); break; }
                  if (bot.blockAt(p)?.name !== 'end_stone') { skipped++; continue; }
                  try { await actions.dig(bot, task, p, { requireDrops: false }); dug++; } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; console.log(`[end combat] quarry stopped at ${p}: ${String(err.message || err).slice(0, 120)}`); break; }
                }
                // The stone picked up from where it lies, twelve blocks about and
                // ten seconds (note 1449): dug on the island's slopes it rolls, and
                // 25588 (dragon-30, 2026-10-13 09:52Z) quarried twice for nothing
                // gained, 35 end stone lying eight to ten blocks off at (36 to 38,
                // 42, -7 to -11), two blocks up the slope from where it stood.
                // Every stone, not the first (note 1502): collectNearbyDrops returns at
                // the first item gained, and 25588 (dragon-74, 2026-10-13 18:57Z) dug 18
                // cells and 'quarried 1', six stones lying two and three blocks off,
                // then dug 24 more for 2. Picked up until none is gained or twenty seconds.
                // Within sixteen, not eight (note 1725): the stone rolls down the island's slopes past eight, and 25588 (dragon-270, 2026-10-15 11:35Z) dug 14 cells and 'quarried 0 ... items lying within 16: (14, 59, 4) 12 off, (19, 60, 8) 15 off, (5, 61, -9) 10 off' and five more at ten, then stood in the breath with no block and died.
                { const t0 = Date.now(); let rounds = 0;
                  while (Date.now() - t0 < 20000 && rounds < 30 && !hostileNear()) {
                    check(); rounds++;
                    let got = false;
                    try { got = await require('./drop-collection').collectNearbyDrops(bot, task, 'end_stone', { radius: 16, timeoutMs: 5000, waitForSpawnMs: rounds === 1 ? 300 : 0, move: actions.navigate }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; break; }
                    if (!got) break;
                  } }
                const after = blocksCarried(bot);
                // What the quarry came to, said (note 1479): 25588 (dragon-61, 2026-10-13 15:27Z) 'quarried 0' on the eastern slope at (70, 45, -12) with no word of the cells dug or where the stone lay.
                const lying = Object.values(bot.entities).filter(e => e.name === 'item' && e.isValid !== false && e.position && e.position.distanceTo(bot.entity.position) <= 16).map(e => `${e.position.floored()} ${Math.round(e.position.distanceTo(bot.entity.position))} off`);
                console.log(`[end combat] quarried ${after - before} end stone for the climb (${after} blocks carried, ${lift} wanted for crystal ${target.id}; ${dug} of ${cells.length} cells dug, ${skipped} no longer end stone; items lying within 16: ${lying.length ? lying.slice(0, 6).join(', ') : 'none'})`);
                state.openQuarry.gained += Math.max(0, after - before); state.openQuarry.seconds += (Date.now() - tq0) / 1000;
                if (after > before) progress = true;
                save();
              } };
          }
          if (noBlow) continue;
        }
        // Up its own pillar beside another crystal's, the way to this one's foot
        // is down first (pillar_down): the arena's drill of 2026-10-13 (03:45Z)
        // tried the walk from the top four times, 24 to 28 blocks off.
        if ((onOwnPillar() || onObsidianTop() || here.y > 72) && out > radius + 2.2) continue;
        // A foot the walk did not reach rests two minutes (note 1424): from the
        // entry platform, 25588 (dragon-11, 2026-10-13 06:33Z) was offered the
        // crystal 63 blocks off across the void and chose it, the walk going
        // nowhere, while the bridge to the island was the way.
        if ((state.punchUnreached || {})[target.id] > Date.now() - 120000) continue;
        tree[`pillar_punch_${target.id}`] = {
          description: { action: under
            ? `Walk to the foot of the healing crystal's obsidian pillar (radius ${radius}), pillar up ${lift} blocks beside it on the blocks carried to two under the bedrock the crystal stands on, and strike the crystal from there by hand: any blow breaks one, and the bedrock is between the bot and its blast`
            : `Walk to the foot of the healing crystal's obsidian pillar (radius ${radius}, too thick to reach the crystal from its side), pillar up ${lift} blocks beside it on the blocks carried to its top, step onto the top two blocks from the crystal's bedrock, crouch, and strike the crystal by hand: any blow breaks one; crouched, the bot's body above the bedrock's top face is in the blast's line`,
            // The walled climb said (note 1753): what it costs and what it buys.
            walledClimb: lift >= 1 ? `${isCaged ? 'this crystal is caged, iron bars round it that no arrow passes, so the climb is the one way to it: ' : ''}a bare level of the climb is one block and a walled level five (a ring at the head's height, end stone first, so the dragon has no line of sight to throw at the body and its body has no purchase on it): with ${carried} carried the top ${Math.max(0, Math.min(lift, Math.floor((carried - 20 - lift) / 4)))} of the ${lift} levels are walled and the rest climbed bare; every level walled wants ${lift * 5 + 8}` : undefined,
            position: { ...target.position }, blocksOff: out, blocks: lift, blocksForTheClimb: lift + roofs, blocksCarried: carried, pillarRadius: radius, stance: under ? 'under the bedrock top, beside the pillar' : 'on the top, crouched',
            dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(here)) : null,
            // The climb against the dragon's turns (note 1736, the fight plan's second step): a climb is open to the dragon's sight from first block to last, and the dragon turns to strafe and throws one fireball a strafe; while it perches (phases 5 to 7) it does not strafe. 25588 (dragon-278 and 282, 2026-10-15): strafes 4 to 45 s apart, a throw 0.9 to 14 s into each, one in eight on the body; dragon-276 took its cloud at 79 on crystal 91's climb and fell.
            climbAgainstTheDragon: (() => { const st = (state.strafeTimes || []).filter(t => Date.now() - t < 300000); const gaps = st.slice(1).map((t, i) => (t - st[i]) / 1000); const mean = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null; const ph = dragon ? metadata(bot, dragon, 'phase') : null; return `the climb of ${lift} is about ${Math.round(lift * 0.6 + 2)} s in the open; the dragon ${ph == null ? 'not seen' : perched(bot, dragon) ? 'perched now (no strafe while it sits)' : ph === 1 ? 'strafing at the bot now' : `flying (phase ${ph})`}${mean ? `, its strafes about ${mean} s apart in the last five minutes, one fireball each` : ''}`; })(),
            // Whether the drop's pool can be poured at this pillar's foot (note 1539): at the island's eastern rim (pillars 9, 11 and 20 of this world) no level cell beside the foot is clear of the void, the way down is the bucket in the air alone, and 25588 died on it three times on 2026-10-13 (dragon-84, 90, 93) and landed twice (dragon-92, 94).
            // With no water carried the pool is not poured (note 1572): 25588 (dragon-120, 2026-10-14 04:05Z) climbed crystal 88's pillar told 'a pool of water can be poured', both buckets empty, the water left at (-36, 61, 19), 26 blocks off, and dug down 18 after the blow.
            wayDown: countOf(bot, 'water_bucket') === 1 && lift < 20 ? `the one full bucket carried is kept for the landing after a knock off the column (note 1819: 25588's dragon-188, 2026-10-18, poured its last into a pool and fell from 93 with none), so no pool is poured at this pillar's foot for a climb under twenty (this one ${lift})${(state.poolsLeft || []).length && countOf(bot, 'bucket') ? `; water left at a pool before: ${waterLeftSays()}` : ''}; the way down from the top is the column dug a block at a time` : noPoolNear(c, radius) ? `no pool was to be had at this pillar's foot (${noPoolNear(c, radius).xz.join(', ')}) ${Math.round((Date.now() - noPoolNear(c, radius).at) / 60000)} minutes ago: no level cell beside the column's base clear of the void; the way down from the top is the column dug a block at a time (a pickaxe wanted), the dragon's body and breath finding the bot on it the while` : poolAtTheFoot(c, radius, lift) ? (countOf(bot, 'water_bucket') ? 'a pool of water can be poured on level ground beside this pillar\'s foot before the climb, and the drop after the blow lands in it' : `no water is carried to pour the pool at this pillar\'s foot: ${waterLeftSays()}${(state.poolsLeft || []).length && countOf(bot, 'bucket') ? 'the climb walks back for the water left first and pours the pool with it; ' : ''}otherwise the way down from its top is the column dug a block at a time`) : 'no pool can be poured at this pillar\'s foot: the void lies within eight blocks of every level cell beside it. The way down from here is the column dug down to a height the health can take and the bucket clicked under the body in the last blocks of the fall, a click the server refuses about one time in three; of the five such drops of 2026-10-13 at this rim, three ended in death (dragon-84, 90, 93) and two landed',
            // Said when no pickaxe is carried (note 1805): the dig down the column after the blow wants one, and 25588's dragon-176 (2026-10-18 00:36Z) took the climb to crystal 65 (0.55) over craft_pickaxe (0.01) with its pickaxe worn out, struck the crystal at 88, and had no way down: six minutes on the column from 80 to 86, every dig 'Digging aborted' or fifteen seconds a block by hand, carried to 105 once, 20 to none.
            ...(pickCarried() ? {} : { pickaxe: `no pickaxe is carried: the way down from the top by the dig (a block a second and a half with one) is not to be had, end stone and the laid blocks by hand are about fifteen seconds a block, and the body stays on the column until the drop or the dragon takes it off; 25588's dragon-176 (2026-10-18) struck crystal 65 so and spent six minutes on its column from 80 to 86, carried to 105 once, 20 to none. The pickaxe is crafted first where ${bot.inventory.items().filter(i => i.name === 'iron_ingot').reduce((k, i) => k + i.count, 0) >= 3 ? 'the ingots carried allow it (craft_pickaxe)' : 'ingots are to be had: none carried'}` }),
            // The walk in the open said (note 1837): 25588's dragon-196, 197 and 198 (2026-10-18 07:47 to 08:05Z) each died on the open island between a column's foot and the next crystal's, in a fireball's cloud or under the dragon's body, within a minute of a clean descent; the tunnel to the same foot runs under the island out of sight.
            digBudget: (() => { const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)); const left = picks.reduce((n, i) => n + Math.max(0, (bot.registry.itemsByName[i.name]?.maxDurability || 250) - (i.durabilityUsed || 0)), 0); const ingots = countOf(bot, 'iron_ingot'), sticks = countOf(bot, 'stick'), table = countOf(bot, 'crafting_table') > 0; const crafts = table ? Math.min(Math.floor(ingots / 3), Math.floor(sticks / 2)) : 0; return `${left} digs left in the pickaxe${picks.length ? '' : ' (none carried)'}, ${crafts} more craftable: about ${left + crafts * 250} for the fight; this climb's way down by the dig wants about ${Math.max(0, topY - Math.floor(here.y))}, the ${crystals.length} crystals left about ${crystals.length * 30} together`; })(),
            theWalk: (() => { const d = Math.hypot(c.x + .5 - here.x, c.z + .5 - here.z); const under = [1, 2, 3].every(dy => bot.blockAt(here.floored().offset(0, -dy, 0))?.boundingBox === 'block'); return `${Math.round(d)} blocks over the open island to this pillar's foot first, about ${Math.round(d / 4.3)} s at a run, where the dragon's fireballs and body can find the bot${holeHere() || inTunnel() ? '; from this hole the tunnel to the same foot runs under the island out of its sight, about twice the time' : under ? '; a tunnel to the same foot from a shaft dug here runs under the island out of its sight, about twice the time' : ''}`; })(),
            onTheColumn: `the climb and the way down are a minute or two each on a column one block wide, where the dragon's fireballs and body can find the bot and there is no step aside: a charge is met by the drop into the pool when one is poured, a fireball's cloud (six a second while the body stands in it) by a block up out of it`, ...(isCaged ? { caged: `iron bars round it, dug out between the stand and the crystal with the ${pickForBars.name.replaceAll('_', ' ')} first` } : {}), dragonPhase: metadata(bot, dragon, 'phase'), health: bot.health,
            fallFromTheTop: `a knock off the top is a fall of ${lift} blocks, about ${Math.max(0, lift - 3)} damage before armour${countOf(bot, 'water_bucket') ? ', a water bucket carried for the landing' : ', no water bucket carried'}`,
            crystalBlast: punchRecordSays(state, under),
            // The health against the breath, in numbers (note 1511): 25588 (dragon-77, 2026-10-13 20:01Z, nine crystals broken, the record) chose this climb at 9.2 health and again at 4.8, and the breath on the column took the rest.
            healthForTheClimb: bot.health < 12 ? `${bot.health.toFixed(1)} health of 20: the breath on the column is 6 a second whatever is worn, so ${Math.ceil(bot.health / 6)} second${Math.ceil(bot.health / 6) === 1 ? '' : 's'} of it kill${Math.ceil(bot.health / 6) === 1 ? 's' : ''}; standing still with hunger 18 or more, health comes back about a point a second with food in the body, a point every four seconds without, so 20 is ${Math.ceil(20 - bot.health)} to ${Math.ceil((20 - bot.health) * 4)} seconds away` : undefined,
            // The shield's state (note 1491): the blast from the top is taken on the
            // shield, and a shield wears out (336 uses, a blocked blow costing its
            // damage). 25588 (dragon-67, 2026-10-13 16:52Z, four crystals broken)
            // had its shield break on a dragon's blow at 16:52, struck crystal 107
            // from the top without it at 16:56 and took 15.4, 20 to 5.6, and died.
            shield: (() => { const sh = bot.inventory.slots?.[45]?.name === 'shield' ? bot.inventory.slots[45] : bot.inventory.items().find(i => i.name === 'shield'); if (!sh) return `no shield carried: the blast from the top is taken bare, 15.4 health on 25588 (dragon-67, 2026-10-13 16:56Z, full iron)${under ? '; from two under the bedrock the blast is mostly stopped by the bedrock itself' : ''}`; const left = Math.max(0, 336 - (sh.durabilityUsed || 0)); return `a shield carried with ${left} of 336 uses left (a blocked blow costs its damage in uses); it breaks when they are spent, and the next blast from the top is taken bare, about 15 health`; })(),
            climbRecord: require('./climb-record').says(bot),
            thisFightOnColumns: state.columnDamage?.hits ? `on this fight's columns the bot has taken ${state.columnDamage.total} health in ${state.columnDamage.hits} blow${state.columnDamage.hits === 1 ? '' : 's'} (the largest ${state.columnDamage.max}); it has ${Math.round(bot.health * 10) / 10} now, and a blow on the column cannot be stepped from` : 'no blow has been taken on a column this fight yet' },
          run: async () => {
            // The foot at whatever height the island has there (note 1447): the
            // island's ground runs from 36 to 60, and a goal at the bot's own
            // height was a point in the air or in the rock by the far pillars.
            // 25588 (dragon-28, 2026-10-13 09:35Z, crystal 10 broken, full
            // health) was 'not reached: 44 blocks from its middle' after forty
            // seconds and bounced between cells six blocks apart.
            // The water left standing fetched first when no bucket is full (note 1644).
            if (countOf(bot, 'water_bucket') === 0 && countOf(bot, 'bucket') > 0) await reclaimWaterLeft();
            // The foot at the island's ground (note 1823): the goal by x and z alone was met at any height, and 25588's dragon-189 (2026-10-18 04:55Z, four crystals, relaunched beside its own column) walked up that column's walled levels to (-31, 80, 26), 'No path to the goal', and was taken off the top by the dragon's body, 13 to 16 to none. The ground's top beside the pillar on the bot's side, a block either way.
            // The ground read on the island, not under the pillar (note 1828): with obsidian topping the cell at radius+1.5 the scan of note 1823 went on down to the end stone under the pillar's base, a band several blocks below the island that no walk could reach; 25588's dragon-194 (2026-10-18 05:40 to 05:45Z) had four walks to a foot 'timed out without reaching new ground' and no climb. The top solid is read; obsidian or bedrock there sends the read a cell further out, and with none the goal is by x and z alone, as before.
            // Up out of the pit before the walk (note 1829): the pathfinder lays no block, and from a pit's floor every walk ended 'No route from here (noPath)'; 25588's dragon-194 (2026-10-18 05:40 to 06:30Z, 463 blocks, full health) stood dry on its pit's floor at (-10, 59, 5) with 202 walks timed out and 223 feet 'not reached', no crystal in fifty minutes. A hole climbs out by outOfTheHole; a pit with three walls two high beside the feet by two or three blocks laid.
            {
              const f0 = bot.entity.position.floored(), solid = q => bot.blockAt(q)?.boundingBox === 'block';
              const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(f0.offset(dx, 0, dz)) && solid(f0.offset(dx, 1, dz))).length;
              if (holeHere()) { try { await outOfTheHole(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } }
              // Not from a walled shaft (note 1830): the rings of a walled climb close four sides of the column's base too, and the climb of note 1829 went two up inside the shaft, then two more, the walk failing from each; 25588's dragon-194 (2026-10-18 06:46 to 06:50Z) at (30, 64, 24) then (30, 66, 24) over its column's base at 61. A shaft's walls go on two and three over the feet; a pit's do not.
              const shaft = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => solid(f0.offset(dx, 2, dz)) && solid(f0.offset(dx, 3, dz))).length >= 3 || (bot._pillarUp && bot._pillarUp.x === f0.x && bot._pillarUp.z === f0.z);
              if (!holeHere() && walls >= 3 && shaft && !(state.shaftSaid > Date.now() - 20000)) { state.shaftSaid = Date.now(); console.log(`[end combat] in a walled shaft at ${f0} (${walls} walls, going on above): no climb up it before the walk to crystal ${target.id}'s foot`); }
              else if (walls >= 3 && !shaft && bot.entity.onGround && !inWater() && blocksCarried(bot) >= 3) {
                const from = Math.floor(bot.entity.position.y), depth = [2, 3].find(d => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !solid(f0.offset(dx, d, dz)) && solid(f0.offset(dx, d - 1, dz)))) || 2;
                try { await require('./pillar-recovery').pillarUp(bot, task, from + depth, { dig: actions.dig, maxBlocks: depth, threats: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
                console.log(`[end combat] up out of the pit before the walk to crystal ${target.id}'s foot: ${Math.floor(bot.entity.position.y) - from} blocks up at ${bot.entity.position.floored()} (${walls} walls beside the feet)`);
              }
            }
            const footGround = (() => { try { const here = bot.entity.position, dx = here.x - (c.x + .5), dz = here.z - (c.z + .5), n = Math.hypot(dx, dz) || 1; for (const out of [radius + 1.5, radius + 2.5, radius + 3.5]) { const fx = Math.floor(c.x + .5 + dx / n * out), fz = Math.floor(c.z + .5 + dz / n * out); for (let y = 72; y >= 36; y--) { const b = bot.blockAt(new Vec3(fx, y, fz)); if (b?.boundingBox !== 'block') continue; if (/obsidian|bedrock/.test(b.name)) break; return y + 1; } } return null; } catch (_) { return null; } })();
            const footXZ = new goals.GoalNearXZ(c.x + .5, c.z + .5, radius + 1);
            const foot = footGround == null ? footXZ : new goals.GoalCompositeAll([footXZ, new goals.GoalCompositeAny([footGround - 2, footGround - 1, footGround, footGround + 1, footGround + 2].map(y => new goals.GoalY(y)))]);
            const walkFrom = bot.entity.position.floored(), walkAt = Date.now();
            // No walk down to the foot from high beside the pillar (note 1897): on its own column or a stub by the pillar the climb goes on from where the body stands, and the walk to the ground stepped it off the column's edge. 25588's dragon-260 (2026-10-19 05:2xZ, two crystals) at (-17, 81, -38) by crystal 65's pillar walked toward its foot at the island's level, 'pillar_punch_65 cut ... at (-19, 79, -38)', the body off its column, struck and fallen.
            const highBeside = footGround != null && Math.floor(bot.entity.position.y) > footGround + 3 && Math.hypot(c.x + .5 - bot.entity.position.x, c.z + .5 - bot.entity.position.z) <= radius + 2.2;
            if (highBeside) console.log(`[end combat] the climb to crystal ${target.id} goes on from ${walkFrom}, ${Math.floor(bot.entity.position.y) - footGround} over its foot's ground and beside the pillar: no walk down to the foot`);
            if (!highBeside) try { await actions.navigate(bot, task, foot, { timeoutMs: 40000, stallMs: 6000, sprint: true, stopWhen: () => hostileEntities(bot, 4).some(e => live(bot, e)) }); }
            catch (err) {
              if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err;
              // Said (note 1486): the walk to a foot failed from 18, 19 and 52 blocks (25588, dragon-61, 64 and 66, 2026-10-13) with no word of why.
              console.log(`[end combat] the walk to crystal ${target.id}'s foot from ${walkFrom} ended after ${Math.round((Date.now() - walkAt) / 1000)} s at ${bot.entity.position.floored()} (the foot's ground read at ${footGround == null ? 'none: by x and z alone' : footGround}): ${String(err.message || err).slice(0, 160)}`);
            }
            // Up against the obsidian (note 1541): the column is raised where the
            // body stands, and a body a cell or two short of the pillar's side
            // raises a column whose top is a gap from the stand, and whose roofs
            // want posts (four blocks each) for want of a block beside. 25588
            // (dragon-95, 2026-10-13 23:51Z, crystal 12 broken) raised its column
            // at (-9, -37) for crystal 91 at (-13, -40), 'the stand on the
            // pillar's top was not reached: 4.4 from the bedrock' twice, and dug
            // 24 down for nothing; its next climb spent 20 blocks on 9 of lift.
            const obsidianBeside = () => { const f0 = bot.entity.position.floored(); return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => [0, 1].some(dy => bot.blockAt(f0.offset(dx, dy, dz))?.name === 'obsidian')); };
            if (!obsidianBeside() && Math.hypot(c.x + .5 - bot.entity.position.x, c.z + .5 - bot.entity.position.z) <= radius + 4) {
              try {
                await require('./motion').move(bot, task, { label: 'up_to_the_pillar', keys: ['forward'], sneak: false, why: 'the last step up against the pillar\'s obsidian, where the column goes up (note 1541)', look: new Vec3(c.x + .5, bot.entity.position.y + 1.2, c.z + .5), maxMs: 2500, tick: 25, until: () => obsidianBeside() });
              } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
              console.log(`[end combat] the last step to crystal ${target.id}'s pillar: ${obsidianBeside() ? 'the obsidian beside the feet' : 'still off it'} at ${bot.entity.position.floored()}, ${Math.round(Math.hypot(c.x + .5 - bot.entity.position.x, c.z + .5 - bot.entity.position.z) * 10) / 10} from its middle`);
            }
            const p = bot.entity.position, flat = Math.hypot(c.x + .5 - p.x, c.z + .5 - p.z);
            if (flat > radius + 2.2) { (state.punchUnreached ||= {})[target.id] = Date.now(); save(); throw new Error(`The pillar's foot was not reached: ${Math.round(flat)} blocks from its middle, its radius ${radius}`); }
            const from = Math.floor(p.y);
            await descentChoice(feetY - from);
            // Out of the hole before the pool and the climb (note 1772): at a tunnel's end the foot cell is a pit, the drop's pool poured beside the column went into it, and the climb refused water at the feet; 25588's dragon-139 (2026-10-17 16:2xZ) poured, took back and poured again twenty-four times at (-10, 57, -36) under crystal 65, the climb never begun.
            { const fh = bot.entity.position.floored(), sdh = q => bot.blockAt(q)?.boundingBox === 'block'; const closed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => sdh(fh.offset(dx, 0, dz))).length; if (holeHere() || inTunnel() || closed >= 2) { try { await outOfTheHole(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } } }
            // The climb resumes at the pool's own column (note 1874): the foot cell is wherever the walk ends within reach of the pillar, and a climb cut and begun again stood up a second column three cells from the first, whose pool then lay off every side of the drop. 25588's dragon-225 (2026-10-18 17:36 to 17:40Z) poured at (12, 56, 46) beside its column at (12, 44), climbed again from (15, 42), struck crystal 28 from 97 and found 'no water drop: no side with ground under it', the way down 31 blocks dug.
            { const pr = state.pool && Date.now() - state.pool.at < 15 * 60000 && state.pool.column ? state.pool.column : null; const f0 = bot.entity.position.floored();
              if (pr && (pr.x !== f0.x || pr.z !== f0.z) && Math.hypot(c.x + .5 - (pr.x + .5), c.z + .5 - (pr.z + .5)) <= radius + 2.2 && Math.hypot(pr.x - f0.x, pr.z - f0.z) <= 6 && actions.navigate && bot.blockAt(new Vec3(pr.x, pr.y - 1, pr.z))?.boundingBox === 'block' && bot.blockAt(new Vec3(pr.x, pr.y, pr.z))?.boundingBox !== 'block' && bot.blockAt(new Vec3(pr.x, pr.y + 1, pr.z))?.boundingBox !== 'block') {
                try { await actions.navigate(bot, task, new goals.GoalBlock(pr.x, pr.y, pr.z), { timeoutMs: 6000, stallMs: 3000 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
                const f1 = bot.entity.position.floored(); console.log(`[end combat] the climb to crystal ${target.id} from the pool's own column at (${pr.x}, ${pr.z}): ${f1.x === pr.x && f1.z === pr.z ? 'there' : `not reached, at ${f1}`} (the pool at (${state.pool.x}, ${state.pool.y}, ${state.pool.z}))`); } }
            const footCell = bot.entity.position.floored();
            require('./climb-record').begin(bot, { walled: Math.floor((blocksCarried(bot) - 20 - lift) / 4) >= Math.ceil(lift / 2), lift, crystal: target.id });
            if (state.descent?.pick === 'water_drop') { try { await poolForTheDrop(footCell, feetY - from); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; } }
            // Back onto the foot cell before the climb (note 1548): the trench and
            // the pour walk the body up to five cells out along the row, and the
            // column rises where the body stands. 25588 (dragon-97, 2026-10-14
            // 00:36Z, four crystals broken) had the obsidian beside its feet at
            // (-32, 61, -21), dug its trench out to (-32, -16), and raised its
            // column at (-29, -27): 'the stand on the pillar's top was not
            // reached: 5.7 from the bedrock'.
            if (Math.hypot(footCell.x + .5 - bot.entity.position.x, footCell.z + .5 - bot.entity.position.z) > 0.8) {
              try { await actions.navigate(bot, task, new goals.GoalBlock(footCell.x, footCell.y, footCell.z), { timeoutMs: 8000, stallMs: 3000 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
              console.log(`[end combat] back to the foot cell ${footCell} for the climb: ${Math.round(Math.hypot(footCell.x + .5 - bot.entity.position.x, footCell.z + .5 - bot.entity.position.z) * 10) / 10} off${obsidianBeside() ? ', the obsidian beside the feet' : ''}`);
              // Not back on the foot cell, no climb from wherever the body is (note 2252): 25589's dragon-346 (2026-10-26 18:39 to 18:42Z) poured the pool at the foot of (33, -22), fell from (39, 56, -23) into its water and was carried down the island's side to (40, 40, -24), 'back to the foot cell (33, 59, -22) for the climb: 6.8 off', then began the walled climb to crystal 42 there, 'water at 40, 41, -23' six times, 'the pillar stopped 45 blocks short, -22 up', and walked off the island's low edge at (47, 28, -25) into the void at 20 health. Off the foot cell by more than a block, or more than a block below or above it, the climb ends, said, and the question is asked again from where the body stands.
              { const q = bot.entity.position, off = Math.hypot(footCell.x + .5 - q.x, footCell.z + .5 - q.z), dy = Math.floor(q.y) - footCell.y;
                if (off > 1.5 || Math.abs(dy) > 1) { console.log(`[end combat] the climb to crystal ${target.id} not begun: the body at ${q.floored()}, ${Math.round(off * 10) / 10} off the foot cell ${footCell} and ${dy} up from it`); throw new Error(`Not back on the climb's foot cell at ${footCell}: ${Math.round(off * 10) / 10} off and ${dy} up, at ${q.floored()}`); } }
            }
            // A climb stops at one block the server refused (pillarUp); taken up
            // again, three times at most, before it is given up.
            // The last six blocks and the blow wait below the top for the dragon's pass to clear (note 1660): the charge is called within 12 blocks (note 1649), under a second before the body strikes, and nothing laid in a second stands against it. Of the 30 runs 167 to 196 ten died within seconds of 'cut by the emergency dragon_charge_or_contact', five of them at the top of a climb: 25588 (dragon-196, 2026-10-14 19:16Z) was cut at (33, 82, -23) at 20 health and struck in the same second, 20 to 13.6, and carried 50 blocks over the void; dragon-194 (18:59Z) the same at (-34, 85, 21), dragon-190 at (33, 82, -28), dragon-187 at (30, 81, -24). The body waits crouched six under the top, with the roof, while the dragon is within 40 and not going away, up to 25 seconds; a perched dragon is no pass.
            const climbTo = async y => { for (let tries = 0; tries < 3 && Math.floor(bot.entity.position.y) < y; tries++) {
              check();
              // A caged crystal's bars reach out over the climb's cells at the top
              // (note 1419): dug through where a pickaxe is carried. 25588
              // (dragon-8, 2026-10-13 06:05Z) stopped 2 short, 'iron bars over
              // the head, which the climb does not dig', three times.
              const pr = require('./pillar-recovery');
              const canDig = b => !!b && ((pr.DIGGABLE_ABOVE.test(b.name) && b.diggable) || (isCaged && !!pickForBars && b.name === 'iron_bars'));
              // The caged crystal's climb walled on four sides (note 1753, the user's choice of 2026-10-16: the protected climb for the caged crystals, projectiles for the rest): a ring at the head's height on every level but the top's, end stone first (the dragon's body smashes cobblestone, not end stone). On a bare column 25588 lost most of its bots of 2026-10-15 to the fireball's cloud or the body on the way up.
              // Walled at every crystal (note 1761, the user's choice of 2026-10-17: the dragon stage carries no snowball, and every death since dragon-41 was a fall off a bare climb or its top).
              // The walls on the top levels the blocks allow (note 1770): a bare level is one block and a walled five, so with B carried and L to climb the top W = (B - 8 - L) / 4 levels are walled and the rest climbed bare. 25588's dragon-138 (2026-10-17 16:1xZ, five crystals broken, the stage's best) carried 119 for a climb of 24 that wanted 128 for every level, went up bare, and was thrown from 78 by the dragon's body at 8.2 health, dead of the fall.
              // Twenty kept back, not eight (note 1798): the stand's roof and the pocket at the top take up to ten after the walls, and the climb out of a cloud at the foot two more; 25588's dragon-169 (2026-10-17 23:38Z, four crystals in sixteen minutes at full health) walled 32 of 34 levels to crystal 95, came down to its foot with two blocks, and died in the cloud there, 'up out of the breath first: 0 blocks up'.
              const liftLeft = Math.max(1, feetY - Math.floor(bot.entity.position.y)), wallLevels = Math.max(0, Math.min(liftLeft, Math.floor((blocksCarried(bot) - 20 - liftLeft) / 4)));
              // The column's base kept open (note 1831): with every level walled the rings closed the foot cell's four sides too, and a body back at the base with its pickaxe gone had no way out: 25588's dragon-194 (2026-10-18 06:45 to 06:53Z, 428 blocks, full health) stood in its own shaft at (30, 61, 24), every walk 'timed out', none_good and observe for eight minutes. The rings begin two over the climb's start: the lowest level stays open, and the dragon's body does not come to a column's base.
              const startY = Math.floor(bot.entity.position.y);
              const enclose = wallLevels > 0, encloseFrom = Math.max(startY + 2, feetY - 1 - wallLevels);
              if (enclose && !state.encloseSaid) { state.encloseSaid = true; console.log(`[end combat] the climb to ${isCaged ? 'caged ' : ''}crystal ${target.id} walled on four sides on the top ${wallLevels} of ${liftLeft} levels: ${blocksCarried(bot)} blocks carried`); }
              bot._ringLaid = 0;
              // The pool's side kept open up the climb (note 1861): the drop needs the fall line beside the column clear down to the pool.
              const poolSide = (() => { const pl = state.pool; if (!pl || Date.now() - pl.at > 15 * 60000) return null; const px = pl.x - footCell.x, pz = pl.z - footCell.z; if (Math.abs(px) >= 1 && Math.abs(px) <= 6 && Math.abs(pz) <= 1) return [Math.sign(px), 0]; if (Math.abs(pz) >= 1 && Math.abs(pz) <= 6 && Math.abs(px) <= 1) return [0, Math.sign(pz)]; return null; })();
              if (poolSide && enclose && !state.poolSideSaid) { state.poolSideSaid = true; console.log(`[end combat] the climb's rings leave the ${poolSide[0] === 1 ? 'east' : poolSide[0] === -1 ? 'west' : poolSide[1] === 1 ? 'south' : 'north'} side open for the drop into the pool at (${state.pool.x}, ${state.pool.y}, ${state.pool.z})`); }
              await pr.pillarUp(bot, task, y, { dig: actions.dig, maxBlocks: Math.max(1, y - Math.floor(bot.entity.position.y)), threats: false, canDig, enclose, encloseUntil: feetY - 1, encloseFrom, skipSide: poolSide, blocks: enclose ? ['end_stone', ...pr.SCAFFOLD] : pr.SCAFFOLD });
              if (enclose) console.log(`[end combat] the walled climb to crystal ${target.id}: ${bot._ringLaid} ring blocks laid (the top ${wallLevels} of ${liftLeft} levels walled), now at ${bot.entity.position.floored()}, ${blocksCarried(bot)} blocks left, ${bot.health.toFixed(1)} health`);
            } };
            const belowTop = feetY - 6;
            if (belowTop > Math.floor(bot.entity.position.y) + 2) await climbTo(belowTop);
            // The wait before every climb above 70 (note 1683), not only when the climb began under the six-below mark: a climb cut by an emergency resumes from where it stands, and 25588 (dragon-218, 2026-10-15 00:50Z) resumed crystal 86's climb at 84, was struck twice by the body at 84 and twice at 87, and was carried 130 blocks into the void; dragon-204, 207 and 210 were struck at their tops the same evening after cut climbs.
            if (Math.floor(bot.entity.position.y) >= 70) {
              const wait = await waitForThePass(25000);
              if (wait.waited) console.log(`[end combat] the climb to crystal ${target.id} waited ${(wait.ms / 1000).toFixed(1)} s at ${bot.entity.position.floored()} for the dragon's pass: ${wait.why}`);
            }
            await climbTo(feetY);
            // And once more at the top (note 1664): the stand, the walls and the blow are four seconds more in the open.
            { const wait = await waitForThePass(25000); if (wait.waited) console.log(`[end combat] the blow at crystal ${target.id} waited ${(wait.ms / 1000).toFixed(1)} s at the top at ${bot.entity.position.floored()} for the dragon's pass: ${wait.why}`); }
            if (Math.floor(bot.entity.position.y) < feetY) throw new Error(`The pillar stopped ${feetY - Math.floor(bot.entity.position.y)} blocks short, ${Math.floor(bot.entity.position.y) - from} up`);
            if (!live(bot, target)) throw new Error('The crystal was gone before the blow');
            let aim = target.position.offset(0, .4, 0);
            // The pocket at the top before the blow, under the bedrock (note 1675): the stand's walls of note 1664 are for the top-stand case only, and the pillars of radius two, struck from under the bedrock beside them, are most of the field; no run of 200 to 210 laid a wall. 25588 (dragon-210, 2026-10-14 22:45Z) struck crystal 9 from (35, 82, -23) with 17 blocks carried, a fireball was called four seconds on, the body struck it and carried it 24 west and 20 down, dead; dragon-207 (22:10Z) and 201 (20:37Z) were struck at the top the same way after their blows. With eight blocks carried and the dragon not perched the pocket is built round the column cell first (notes 1655, 1659), and after the blow the body holds in it for the pass to clear before the way down.
            if (under && blocksCarried(bot) >= 8 && !(dragon && perched(bot, dragon))) {
              try { const t0 = Date.now(), r = await pocketOnColumn(); console.log(`[end combat] the pocket at the top before the blow at ${bot.entity.position.floored()}: ${r.laid} blocks laid, ${r.closed} of 4 sides closed, ${Date.now() - t0} ms, ${blocksCarried(bot)} blocks left`); }
              catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
            }
            if (!under) {
              // Onto the top and to two blocks from the bedrock at a crouch (no walk
              // off an edge): the pathfinder's goal on a pillar's top was not reached
              // (the arena's drill of 2026-10-13, 03:40Z).
              const q = bot.entity.position, dx = q.x - (c.x + .5), dz = q.z - (c.z + .5);
              const dir = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
              const stand = c.offset(dir.x * 2, -1, dir.z * 2), centre = stand.offset(.5, 0, .5), flatTo = () => Math.hypot(centre.x - bot.entity.position.x, centre.z - bot.entity.position.z);
              if (typeof bot.lookAt === 'function') await bot.lookAt(centre.offset(0, 1.6, 0), true);
              await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'pillar_top_stand', keys: ['forward'], sneak: true,
                why: 'onto the pillar\'s top, to two blocks from the crystal\'s bedrock', look: centre.offset(0, 1.6, 0), maxMs: 8000, tick: 50, until: () => flatTo() < 0.35 || Math.floor(bot.entity.position.y) < topY - 1 });
              // A cell short of the stand is still a stand, the crystal in reach
              // (note 1425): 25588 (dragon-11, 2026-10-13 06:36Z) stopped one cell
              // from it, three from the bedrock, and the blow was called off.
              const toBedrock = Math.hypot(c.x + .5 - bot.entity.position.x, c.z + .5 - bot.entity.position.z);
              if ((flatTo() > 0.7 && toBedrock > 3.4) || Math.floor(bot.entity.position.y) < topY - 1) throw new Error(`The stand on the pillar's top was not reached: at ${bot.entity.position.floored()}, wanted ${stand}, ${Math.round(toBedrock * 10) / 10} from the bedrock`);
              // The cage's bars between the stand and the crystal, dug out (the cell
              // next to the bedrock, from the top up three).
              if (isCaged) {
                const gap = c.offset(dir.x, -1, dir.z);
                for (let dy = 0; dy <= 2; dy++) { const cell = gap.offset(0, dy, 0); check(); if (/iron_bars/.test(bot.blockAt(cell)?.name || '')) await actions.dig(bot, task, cell, { requireDrops: false }); }
                if ([0, 1, 2].some(dy => /iron_bars/.test(bot.blockAt(gap.offset(0, dy, 0))?.name || ''))) throw new Error('The cage\'s bars between the stand and the crystal did not come out');
              }
              bot.setControlState?.('sneak', true);
              // A roof over the stand on the top (note 1451), on a post of three
              // laid on the side away from the crystal: the blow brings the
              // dragon, its fireball bursts on the roof and the cloud lies three
              // over the feet. 25588 (dragon-32, 2026-10-13 10:25Z, full iron,
              // crystals 109 and 110 broken) was in the breath on the top the
              // moment of the blow, 20 to 4.6, and the way back to its column
              // found no route; the next tick took the rest.
              try {
                const f0 = bot.entity.position.floored(), post = f0.offset(dir.x, 0, dir.z);
                const name = blocksCarriedName(bot), item = name && bot.inventory.items().find(i => i.name === name);
                // The roof tried with or without the post (note 1807): with the post's base air the whole roof was skipped without a word, and 25588's dragon-177 (2026-10-18 01:03Z, three crystals) struck crystal 89 from a top with no roof, took the next fireball's cloud on the body there, 20 to 14 to 8 to none in three seconds; crystal 70 before it had its roof. roofOverhead finds its own reference.
                const postStands = item && bot.blockAt(post.offset(0, -1, 0))?.boundingBox === 'block';
                if (item) {
                  if (postStands) for (let dy = 0; dy <= 2; dy++) {
                    const cell = post.offset(0, dy, 0); if (bot.blockAt(cell)?.boundingBox === 'block') continue;
                    const ref = bot.blockAt(cell.offset(0, -1, 0)); if (ref?.boundingBox !== 'block') break;
                    check(); await bot.equip(item, 'hand'); await bot.lookAt(ref.position.offset(.5, 1, .5), true); await bot.placeBlock(ref, new Vec3(0, 1, 0)); await sleep(60);
                  }
                  const roofed = await roofOverhead();
                  console.log(`[end combat] a roof over the stand on the top at ${f0.offset(0, 2, 0)}: ${roofed ? 'laid' : 'not laid'}${postStands ? '' : ` (no post beside: ${bot.blockAt(post.offset(0, -1, 0))?.name || 'nothing'} under its cell)`}`);
                  // Walls round the stand before the blow (note 1664): the dragon's body at the top comes under a second after its call and shoves the body off the tower; two blocks on each side but the crystal's, laid on the tower's top, hold it in its cell. 25588 (dragon-198, 2026-10-14 19:50Z) was struck at its stand at (35, 82, -24) twice in a second and knocked two cells, 20 to 10.9; dragon-194 (18:59Z) was carried off its stand to its death. The walls are recorded and the one toward the column is dug for the way back.
                  if (blocksCarried(bot) >= 8) {
                    let walls = 0; state.standWalls = [];
                    for (const [sx, sz] of [[-dir.x, -dir.z], [dir.z, dir.x], [-dir.z, -dir.x]]) {
                      for (let dy = 0; dy <= 1; dy++) {
                        const cell = f0.offset(sx, dy, sz); if (bot.blockAt(cell)?.boundingBox === 'block') continue;
                        const ref = bot.blockAt(cell.offset(0, -1, 0)); if (ref?.boundingBox !== 'block') break;
                        const it = bot.inventory.items().find(i => i.name === name); if (!it) break;
                        check(); await bot.equip(it, 'hand'); await bot.lookAt(ref.position.offset(.5, 1, .5), true); await bot.placeBlock(ref, new Vec3(0, 1, 0)); await sleep(60);
                        if (bot.blockAt(cell)?.boundingBox === 'block') { walls++; state.standWalls.push({ x: cell.x, y: cell.y, z: cell.z }); }
                      }
                    }
                    save();
                    console.log(`[end combat] walls round the stand at ${f0}: ${walls} blocks laid on three sides, ${blocksCarried(bot)} left`);
                  }
                }
              } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
              aim = target.position.offset(0, 1.2, 0);
            }
            const before = bot.health;
            const sword = bot.inventory.items().find(i => /_sword$|_axe$/.test(i.name));
            if (sword) await bot.equip(sword, 'hand');
            // The shield up for the blow where one is carried: a raised shield
            // takes a blast from in front (a creeper's, TNT's), and the crystal's
            // comes from where the bot looks.
            let shielded = false;
            const worn = bot.inventory.slots?.[45]?.name === 'shield', shield = worn ? bot.inventory.slots[45] : bot.inventory.items().find(i => i.name === 'shield');
            if (shield) { try { if (!worn) await bot.equip(shield, 'off-hand'); bot.activateItem?.(true); shielded = true; await sleep(350); } catch (_) { shielded = false; } }
            check();
            if (typeof bot.lookAt === 'function') await bot.lookAt(aim, true);
            // The facing given a moment to land (note 1465): the shield stops a
            // blast from in front, and four blows today took 15.4 'no blast
            // seen', the unshielded figure, all at the pillar at (-10, -37)
            // (dragon-32, 37, 43, 44), the turn to the crystal and the blow in
            // the same tick.
            await sleep(250); check();
            let explosion = false;
            const observe = packet => { if (vector(packet.center).distanceTo(target.position) < 3) explosion = true; };
            bot._client.on('explosion', observe);
            try {
              // One blow (note 1463): a second at a crystal the server has removed is a blow at nothing it knows.
              for (let n = 0; n < 1 && !explosion && live(bot, target); n++) {
                bot._crystalBlow = true; try { bot.attack(target); } finally { bot._crystalBlow = false; }
                for (let k = 0; k < 40 && !explosion && live(bot, target); k++) { check(); await sleep(50); }
              }
            } finally { bot._client.removeListener('explosion', observe); bot.setControlState?.('sneak', false); if (shielded) { try { bot.deactivateItem?.(); } catch (_) { /* lowered already */ } } }
            await sleep(300);
            const took = Math.max(0, Math.round((before - bot.health) * 10) / 10);
            (state.punches ||= []).push({ at: Date.now(), id: target.id, took, exploded: explosion, gone: !live(bot, target), under, shielded });
            if (explosion) require('./climb-record').end(bot, 'struck');
            state.lastCrystalStruckAt = Date.now(); save(); // note 1826: the tunnels since are counted against it
            console.log(`[end combat] crystal ${target.id} struck ${under ? 'from under the bedrock top' : 'from the top, crouched'}${shielded ? ', shield up' : ''}: ${explosion ? 'it blew' : 'no blast seen'}${live(bot, target) ? ', it stands' : ', it is gone'}; the blast took ${took}`);
            // Gone after the blow is destroyed, the blast's packet seen or not
            // (note 1429): 25588 (dragon-13, 2026-10-13 06:55Z) broke crystal 2,
            // 'no blast seen, it is gone', and the fight kept it as standing.
            if (under) { const wait = await waitForThePass(15000); if (wait.waited) console.log(`[end combat] after the blow at crystal ${target.id} the body held in its pocket ${(wait.ms / 1000).toFixed(1)} s for the dragon's pass: ${wait.why}`); }
            if (!live(bot, target)) {
              const evidence = { at: Date.now(), id: target.id, position: { ...target.position }, source: explosion ? 'explosion_and_entity_removed' : 'entity_removed_after_blow', by: 'hand' };
              state.destroyedCrystals.push(evidence); bot.emit('end_combat', { crystal: evidence }); progress = true;
              if (state.knownCrystals?.[crystalKey(target)]) Object.assign(state.knownCrystals[crystalKey(target)], { status: 'destroyed', confirmedAt: evidence.at });
            }
            // Back onto the bot's own column at a crouch (the way down is dug from
            // it, pillar_down): left on the obsidian top the bot had no way down
            // and reached for the next crystal's foot from 28 blocks up (the
            // arena's drill of 2026-10-13, 03:50Z).
            if (!under && bot._pillarUp && !await backToColumn()) console.log('[end combat] left on the pillar\'s top after the blow: the way down is pillar_top_down');
            // And three down the column at once (note 1444): the blow brings
            // the dragon, and the top is where its breath lands. 25588
            // (dragon-25, 2026-10-13 09:04Z) stood on the top after the blow
            // for the next question, the breath found it there, 20 to 3.9 on
            // the way down, and it fell. The crystal is gone; nothing is up
            // here.
            // All the way down (note 1459): the crystal is gone, and every stand
            // for a question on the column is a pass or a breath taken. 25588
            // (dragon-39, 2026-10-13 11:41Z, full iron, crystal 9 broken) came
            // down three at a time, 79, 75, 72, a question between each, and died
            // on the column at 72 with 7 blocks left.
            if (!live(bot, target) && (onOwnPillar() || onColumnCell())) { goal.step = { action: 'down_after_the_blow', crystal: target.id, health: bot.health }; save(); await wayDown({ limit: 64 }); }
            // And straight down the column (as pillar_down digs): left on the top at
            // 5.4 health, the drill of 2026-10-13 (04:02Z) took the dragon's breath
            // twice there, 6 and 6, and went over the edge at 1.5.
            // By the way down chosen, the drop first where it was (note 1573), not the dig alone.
            if (onColumnCell() && Math.floor(bot.entity.position.y) > 66) await wayDown({ limit: 64 });
            save();
          } };
      }
    }
    if (!punchPlace && dragonNear) for (const k of Object.keys(tree)) if (/^(pillar_punch_|quarry_blocks_)/.test(k)) delete tree[k]; // notes 1808, 1815: the dragon near: the tunnel stays, the climbs do not; calm endermen alone take nothing off
    // The tunnel and the climb as one choice (note 1906): on even facts (note 1905) Jev weighed the tunnel and the climb as rivals and took the tunnel, the safer of the two, nearly every time, and the tunnels ran back and forth between pillars' feet; 25588's dragon-293 (2026-10-19 14:0xZ) dug 19 tunnels to 4 climbs for two crystals. The way a player goes about it is both: under the island to the foot, then up. Offered beside the two, with both their facts; its run is the tunnel's and then, at the foot, the climb's.
    for (const k of Object.keys(tree)) {
      const m = /^tunnel_to_(\d+)$/.exec(k); if (!m) continue;
      const climb = tree[`pillar_punch_${m[1]}`], tunnel = tree[k];
      if (!climb || typeof climb.run !== 'function' || typeof tunnel.run !== 'function') continue;
      tree[`tunnel_and_climb_${m[1]}`] = {
        description: { action: `Dig the tunnel under the island to the foot of crystal ${m[1]}'s pillar, out of the dragon's sight, and from the hole at its foot climb at once to the crystal and strike it: the tunnel's way there and the climb's way up as one step`, tunnel: tunnel.description, climb: climb.description },
        run: async () => {
          const r = await tunnel.run();
          const c = Object.values(bot.entities).find(e => e.name === 'end_crystal' && e.id === Number(m[1]) && e.isValid !== false);
          if (!c) { console.log(`[end combat] tunnel_and_climb_${m[1]}: the tunnel done, the crystal gone`); return r; }
          if (bot.health < 8) { console.log(`[end combat] tunnel_and_climb_${m[1]}: the tunnel done at ${bot.health.toFixed(1)} health; the climb left to the next question`); return r; }
          // Not up into the breath (note 2033), as the way out of a hole is not
          // (note 1836): a cloud over the hole at the pillar's foot, within its
          // reach, and the climb's first block puts the body in its slab.
          // full-3 (2026-10-22 17:39Z), in full iron, its tunnel done at
          // (-9, 60, -36), began the climb with a cloud 7.7 wide 1.6 off and 3
          // over the feet, was cut by it at once, found no stub, no run and
          // no way up out of it, and died in the pit, 20 to nothing.
          { const p = bot.entity.position, over = cloudOverClimb(bot);
            if (over) { console.log(`[end combat] tunnel_and_climb_${m[1]}: the tunnel done at ${p.floored()}; the breath's cloud ${Math.round((over.position.y - p.y) * 10) / 10} over the feet, ${Math.round(cloudRadius(bot, over) * 10) / 10} wide, ${Math.round(Math.hypot(p.x - over.position.x, p.z - over.position.z) * 10) / 10} off: the climb left to the next question, in the hole under it`); return r; } }
          console.log(`[end combat] tunnel_and_climb_${m[1]}: the tunnel done at ${bot.entity.position.floored()}, the climb begun`);
          return climb.run();
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
        description: { action: 'Lay a bed beside the perched dragon\'s head and blow it from a trench one block deep: the heaviest blow available, about five health to the bot', bedsCarried: bedsCarried(bot), walk: Number(plan.walk.toFixed(1)), dragonDamage: require('./bed-bomb').dragonBedSays(metadata(bot, dragon, 'health') ?? null) },
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
    // The walk's crystal is the nearest the arrow can reach (note 1909): the routes went toward crystals[0], whichever the server listed first, and 25588's dragon-307 (2026-10-19 18:3xZ), six crystals shot down in minutes with the kit's arrows, then walked and climbed at caged crystal 46 forty times while crystals 76 and 91 stood beyond seventy blocks, never offered, no route toward them; dead at four left. The caged crystal is the climb's, not the walk's, while an uncaged one stands.
    const shootable = !noArrows && !throwing ? [...crystals].filter(c => !caged(bot, c)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] : null;
    const focus = (noArrows ? null : (throwing ? (crystals.find(c => !caged(bot, c)) || (pick && crystals.find(c => caged(bot, c)))) : (shootable || crystals[0])) || (remembered && { name: 'unresolved_crystal_location', position: vector(remembered.position) })) ||
      head || fountain || dragon || (state.arenaCenter && vector(state.arenaCenter)) || (state.lastDragon && vector(state.lastDragon.position));
    // Reposition when arcs are blocked or the dragon is perched, and always
    // expose escape positions when healing or avoiding a breath cloud.
    // By the fountain already, the wait is there: no walk to another cell of its ring.
    const waitingThere = focus === fountain && fountain && Math.abs(byFountain - PERCH_RANGE) <= 3 && safe;
    // No walk from the bot's own column or an obsidian top (note 1520): the ways off are the column, the drop and pillar_top_down, and a walk there is a fall. 25588 (dragon-82, 2026-10-13 20:55Z, four crystals broken) on crystal 96's top at 85 with no bucket and no pool chose move_-5,3 and move_-4,3 three times running and died 23 blocks below.
    // The walks stay on offer while the dragon perches (note 1528): with the run under the head the only other way than a watch, 25588 chose it 0.38 to 0.49 against none good 0.35 to 0.58 (dragon-87, 2026-10-13 21:54 to 22:00Z), lost 16 health to one run, and the day's runs struck the head not once; the perch is the quietest minute for a walk to the next pillar's foot.
    if (!onOwnPillar() && !onObsidianTop() && (!Object.keys(tree).some(key => key.startsWith('crystal_') || key.startsWith('throw_')) || bot.health < 16) && !waitingThere && !tree.strike_head) for (const route of await arenaRoutes(bot, task, goal, policy, focus, { throwing })) {
      tree[`move_${route.key}`] = { description: { action: focus?.name === 'unresolved_crystal_location'
        ? 'Approach a previously observed crystal location to check whether the crystal remains. Loss of entity tracking did not establish destruction.'
        : !safe ? 'Escape the unsafe current position along this surveyed route'
        : focus?.name === 'ender_dragon_head' ? 'Approach the perched head to get within sword reach'
        : focus?.name === 'fountain' ? `Go to stand about ${PERCH_RANGE} blocks from the fountain the dragon perches on, and wait there for the sword at its head when it lands (it stays perched only while a player is within 20 blocks of it, and alone there leaves after five seconds: a wait that ended at 19 to 20 lost it, and six of seven runs under its head today began too far and ended 'took off'; within the 20 it sits a second scanning, two rearing, up to ten breathing toward the player, then takes off): ${focus.arrows} arrow${focus.arrows === 1 ? ' is' : 's are'} left, the sword reaches the dragon only at its perch, and at its perch arrows do nothing to it${focus.crystals ? `; ${focus.crystals} healing crystal${focus.crystals === 1 ? ' still stands' : 's still stand'} on ${focus.crystals === 1 ? 'its pillar' : 'their pillars'}, out of the sword's reach, and ${focus.crystals === 1 ? 'heals' : 'heal'} the dragon while it flies near` : ''}`
        : focus?.name === 'end_crystal' ? (throwing ? 'Go closer under an observed healing crystal, within a throw of it' : `Walk the surveyed route to (${Math.round(route.p.x)}, ${Math.round(route.p.z)}), about ${Math.round(Math.hypot(route.p.x - bot.entity.position.x, route.p.z - bot.entity.position.z))} blocks, toward crystal ${focus.id} (${Math.round(focus.position.y - bot.entity.position.y)} up on its pillar${caged(bot, focus) ? ', caged: no arrow reaches it, the walk is toward its foot for the climb' : ''}), from ${Math.round(focus.position.distanceTo(bot.entity.position))} blocks off to about ${Math.round(route.targetDistance || 0)}; a clear bow shot from there: ${route.clearCrystalShot ? 'yes' : 'not from that spot; nearer or elsewhere may give one'}`)
        : 'Reposition along this surveyed route to gain a future attack opportunity',
        position: { ...route.p }, visits: state.visits[route.key] || 0, target: focus?.name,
        // What the moves from here have come to (note 1645): 25588 (dragon-179, 2026-10-14 15:50 to 15:58Z) on the eastern shelf at y 38 to 40 took a four-block move toward the fountain's stand sixty-three times, each ending where it began against the cliff, climb_to_the_top offered beside them at 0.1; the moves said nothing of it.
        movesLately: (() => { const log = (state.moveLog || []).filter(m => Date.now() - m.at < 90000); const last = log.at(-1); if (last && !last.to) last.to = { x: bot.entity.position.x, z: bot.entity.position.z }; const done = log.filter(m => m.to); if (!done.length) return undefined; const circled = done.filter(m => Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z) < 3).length; return `${done.length} move${done.length === 1 ? '' : 's'} taken in the last ninety seconds, ${circled} of them ending within three blocks of where they began${circled >= 3 ? ': the walks from here go nowhere' : ''}${focus?.name === 'fountain' && bot.entity.position.y < 55 ? `; the fountain's stand is on the island's top, ${Math.round(62 - bot.entity.position.y)} blocks up from this shelf, and no walk reaches it from here: the climb to the top does` : ''}`; })(),
        clearCrystalShot: focus?.name === 'end_crystal' ? route.clearCrystalShot : undefined,
        targetDistance: route.targetDistance, currentTargetDistance: focus?.position?.distanceTo(bot.entity.position),
        desiredHorizontalRange: route.desiredHorizontalRange,
        voidEdgeBlocks: voidEdge(bot, vector(route.p)), endermenNearRoute: endermenNearRoute(bot, bot.entity.position, vector(route.p)),
        ...(dragon ? { dragonBlocksFromRoute: dragonNearRoute(dragon, bot.entity.position, vector(route.p)), dragonPerched: perched(bot, dragon) } : {}),
        // Said (note 1544) when the walk ends by the fountain while the dragon sits there or comes down to it.
        ...(dragon && (perched(bot, dragon) || [2, 3].includes(metadata(bot, dragon, 'phase'))) ? { perchBody: `ends ${Math.round(Math.hypot(route.p.x + .5 - centre.x, route.p.z + .5 - centre.z))} blocks from the fountain's middle, where the dragon ${perched(bot, dragon) ? 'sits' : 'is coming down to sit'}: its body and wings strike what stands within about 8 of it, 4.9 a blow; 25588 (dragon-95, 2026-10-14 00:12Z) walked to 7.6 from it at 14.3 health and took three blows in 1.3 seconds, dead` } : {}),
        ...breathSays(bot, dragon, vector(route.p)) }, run: async () => {
        state.visits[route.key] = (state.visits[route.key] || 0) + 1; save();
        state.moveLog = [...(state.moveLog || []).filter(m => Date.now() - m.at < 90000), { at: Date.now(), from: { x: bot.entity.position.x, z: bot.entity.position.z } }];
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
    // On the island's low eastern shelf with blocks carried (note 1506): the
    // way up onto the top, a column laid against the cliff's face and a step
    // off it onto the top. The shelf at 40 to 46 meets the top at 56 to 62 in
    // faces of three to six, and the walks to the pillars' feet from it end
    // 'no route' or 'timed out' (25588, dragon-67 to dragon-76, 2026-10-13,
    // five to eight a run, two to four minutes each run down there). The
    // cliff's base: the nearest cell within 24 whose ground is level with
    // the feet and whose neighbour toward the island's middle is three to
    // nine blocks higher, under the sky.
    {
      const feet = bot.entity.position.floored(), carried = blocksCarried(bot);
      const top = (x, z) => { for (let y = feet.y + 18; y >= feet.y - 12; y--) if (bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block') return y + 1; return null; };
      // Offered beside the climbs to the crystals too (note 1515): from the shelf a crystal's column is twenty blocks taller than from the top and the drop off it a dig of twenty first, and 25588 (dragon-79, 2026-10-13 20:23Z) climbed crystal 13's pillar from 36, a column of 47, with no climb onto the top offered.
      if (feet.y <= 54 && carried >= 8 && !onOwnPillar() && !onObsidianTop()) {
        delete tree.dig_to_sky; // the shelf's overhang is not rock over the head to dig through (note 1512)
        let best = null;
        for (let dx = -24; dx <= 24; dx += 1) for (let dz = -24; dz <= 24; dz += 1) {
          const x = feet.x + dx, z = feet.z + dz; const d = Math.hypot(dx, dz); if (d > 24 || (best && d >= best.d)) continue;
          const here = top(x, z); if (here === null || Math.abs(here - feet.y) > 2) continue;
          for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const up = top(x + ox, z + oz); if (up === null) continue;
            // Faces up to sixteen (note 1512): east of the middle the shelf at 45 meets the top at 56, a face of eleven, and 25588 (dragon-78, 2026-10-13 20:06Z) at (35, 45, -22) had no climb offered and its walks to three pillars' feet fail.
            const rise = up - here; if (rise < 3 || rise > 16) continue;
            if (Math.hypot(x + ox, z + oz) >= Math.hypot(x, z)) continue; // toward the island's middle
            if (bot.blockAt(new Vec3(x + ox, up, z + oz))?.boundingBox === 'block' || bot.blockAt(new Vec3(x + ox, up + 1, z + oz))?.boundingBox === 'block') continue;
            const base = new Vec3(x, here, z); const { deepBeside } = require('./end-safety');
            if (deepBeside(bot, base.offset(.5, 0, .5)) || voidEdge(bot, base.offset(.5, 0, .5), 3) !== null) continue;
            best = { d, base, rise, step: new Vec3(x + ox, up, z + oz) }; break;
          }
        }
        if (best) tree.climb_to_the_top = { description: { action: `The bot stands on the island's low shelf at ${feet.y}, below its top: walk ${Math.round(best.d)} blocks to the cliff's base at (${best.base.x}, ${best.base.z}), lay a column of ${best.rise} blocks against its face from the ${carried} carried, and step off it onto the top at ${best.step.y}, where the pillars' feet are walked to. The walks to the pillars' feet from the shelf have ended 'no route' or 'timed out' this fight and others.`,
            blocksCarried: carried, climb: best.rise, blocksToTheBase: Math.round(best.d), health: bot.health },
          run: async () => {
            goal.step = { action: 'climb_to_the_top', base: { ...best.base }, rise: best.rise }; save();
            try { await actions.navigate(bot, task, new goals.GoalBlock(best.base.x, best.base.y, best.base.z), { timeoutMs: 30000, stallMs: 6000 }); }
            catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
            const at = bot.entity.position.floored();
            if (Math.abs(at.x - best.base.x) + Math.abs(at.z - best.base.z) > 1) throw new Error(`The cliff's base was not reached: at ${at}, ${Math.round(bot.entity.position.distanceTo(best.base.offset(.5, 0, .5)))} blocks off`);
            const pr = require('./pillar-recovery');
            await pr.pillarUp(bot, task, best.step.y, { dig: actions.dig, maxBlocks: best.rise + 2, threats: false });
            if (Math.floor(bot.entity.position.y) < best.step.y) throw new Error(`The column against the cliff stopped ${best.step.y - Math.floor(bot.entity.position.y)} short`);
            await require('./motion').move(bot, task, { label: 'onto_the_top', keys: ['forward'], sneak: true, look: best.step.offset(.5, 1.6, .5), maxMs: 2500, tick: 25,
              until: () => Math.floor(bot.entity.position.x) === best.step.x && Math.floor(bot.entity.position.z) === best.step.z });
            delete bot._pillarUp;
            if (Math.floor(bot.entity.position.x) === best.step.x && Math.floor(bot.entity.position.z) === best.step.z) { progress = true; console.log(`[end combat] up onto the island's top at ${bot.entity.position.floored()}`); }
            else throw new Error(`The step onto the top was not taken: at ${bot.entity.position.floored()}`);
            // In off the cliff's lip in the same run (note 1571): the top's edge
            // is where the first pass after the climb lands, a fireball's cloud
            // on arrival with the void a step back and the escape pillar's
            // foot on the lip. 25588 died there four times on 2026-10-14
            // (dragon-98, 116, 118 drowned off it, 119 at (48, 49, -26),
            // 14.5 to 0 by breath under its own pillar). Six blocks toward the
            // island's middle, the ground within three of the top's level.
            {
              const centre = state.arenaCenter ? vector(state.arenaCenter) : new Vec3(0, best.step.y, 0);
              const dx = centre.x - (best.step.x + .5), dz = centre.z - (best.step.z + .5), len = Math.hypot(dx, dz) || 1;
              let inward = null;
              for (const d of [6, 5, 4, 3]) {
                const x = Math.floor(best.step.x + .5 + dx / len * d), z = Math.floor(best.step.z + .5 + dz / len * d);
                const y = top(x, z); if (y === null || Math.abs(y - best.step.y) > 3) continue;
                if (bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block' || bot.blockAt(new Vec3(x, y + 1, z))?.boundingBox === 'block') continue;
                inward = new Vec3(x, y, z); break;
              }
              if (inward) {
                try { await actions.navigate(bot, task, new goals.GoalBlock(inward.x, inward.y, inward.z), { timeoutMs: 12000, stallMs: 4000 }); }
                catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
                console.log(`[end combat] in off the cliff's lip: ${Math.round(bot.entity.position.distanceTo(best.step.offset(.5, 0, .5)))} blocks in at ${bot.entity.position.floored()} (${inward} wanted)`);
              } else console.log(`[end combat] in off the cliff's lip: no level ground found within six toward the island's middle`);
            }
          } };
      }
    }
    // The wait in a hole by the fountain (note 1592): the dragon's wings push
    // every body in their boxes 4 / d² and hurt it 5, and as it takes off from
    // its perch its body throws what stands beside it high. 25588 (dragon-136,
    // 2026-10-14 07:05Z, seven crystals broken) ran under the head from 19
    // blocks, the dragon took off as it came within 8, and the body went to
    // y 90 and fell 28, dead; dragon-121 and 130 ended the same way at six
    // crystals. A body two deep in the island's ground is below the wings'
    // boxes and below the breath's cloud (half a block deep where it bursts);
    // the perch goes on while a player stands within 20, hole or no hole;
    // out of the hole is two blocks laid, about a second. Offered on the
    // island's ground within 24 of the fountain while the dragon flies.
    // Anywhere on the island's thick ground, not only within 24 of the fountain (note 1728): the hole with its roof is out of the dragon's sight, which its fireballs need (Fable and the arena, 2026-10-15: a burst within four blocks of the feet puts the cloud on the body), and it is one block laid against two dug, where a stub walled out of sight is twelve. 25588's runs 254 to 272 (2026-10-15 09:20 to 12:05Z) spent four blocks in five on stubs, roofs, walls and pockets, and four of the last five deaths came with none or one carried.
    // Only under the open sky (note 1746): a hole dug from the tunnel's floor is a shaft down, and the stock taken underground from there went a level deeper each time; 25588 (dragon-6 of the new save, 2026-10-15 18:21 to 19:18Z, four crystals broken) went down that way to y 18 under the island with no block left, 'up out of the hole: 0 blocks up at (-3, 18, 13)'.
    // The seat against the push (note 2207; Fable, 2026-10-26 12:15Z; the arena's drill of 12:16Z, scripts/pass-drill.js
    // PASS_MODE=boat): a rider's own motion is zeroed each tick and its place is the boat's, so the dragon's wings move a
    // seated body nowhere. Four passes seated on a column top: carried 0 blocks each, 6.8 health lost in three and one
    // dead to the blows; four standing: carried 36 to 51, fell 4 of 4, dead 3. Five of today's fifteen End deaths were the
    // push (314, 315, 301, 304, 308). Offered with a boat carried, on the ground or a top, the dragon within 40 and flying.
    {
      const boats = require('./boats');
      const boatItem = bot.inventory.items().find(i => boats.boatItem(i.name));
      const flat = dragon && live(bot, dragon) ? Math.hypot(dragon.position.x - bot.entity.position.x, dragon.position.z - bot.entity.position.z) : Infinity;
      const under = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
      // The boat's cell found in the offer, not the run (note 2220; Fable, 2026-10-26 14:30Z): 'The boat was not set down'
      // as an outcome taught Jev nothing 365 times; with no cell two out with a floor the seat is not offered. The pass
      // said too: the dragon's closing speed and seconds off, as waitForThePass reads them, since the seat is for a pass
      // and the option never said one was coming (Jev took it 11 of 365 offers, mostly with the dragon 18 to 22 off).
      const seatCell = (() => {
        const f = bot.entity.position.floored(), yaw = bot.entity.yaw ?? 0;
        const facing = [Math.round(-Math.sin(yaw)) || 0, Math.round(-Math.cos(yaw)) || 0];
        const sides = [facing, [1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => dx || dz);
        const open = c => { const b = bot.blockAt(c); return !!b && b.boundingBox !== 'block' && !/water|lava/.test(b.name || ''); };
        // The far cell's floor level with the feet, a step up or a step down (note 2227): level only, trials 324 and 325
        // (25590/25592, 15:00 to 15:25Z) carried the boat twenty minutes on the island's rough ground and the seat was
        // offered 0 times (22 to 84 offers a trial before 2220). The boat sits on that floor; the body boards from two cells.
        for (const [dx, dz] of sides) for (const dy of [0, -1, 1]) { const near = f.offset(dx, 0, dz), far = f.offset(dx * 2, dy, dz * 2); if (open(near) && open(near.offset(0, 1, 0)) && bot.blockAt(far.offset(0, -1, 0))?.boundingBox === 'block' && open(far) && open(far.offset(0, 1, 0))) return { cell: far, side: `${dx === 1 ? 'east' : dx === -1 ? 'west' : dz === 1 ? 'south' : 'north'}${dy ? (dy > 0 ? ', a step up' : ', a step down') : ''}`, floor: bot.blockAt(far.offset(0, -1, 0)).name }; }
        return null;
      })();
      const closing = (() => { if (!dragon || !live(bot, dragon)) return null; const m = state.dragonTrack?.velocity || null; const p = bot.entity.position, v = dragon.velocity; const speed = v ? Math.hypot(v.x, v.z) * 20 : null; const toward = v ? -((dragon.position.x - p.x) * v.x + (dragon.position.z - p.z) * v.z) / (flat || 1) * 20 : null; return Number.isFinite(toward) ? { speed: Math.round(speed), toward: Math.round(toward), seconds: toward > 0.5 ? Math.round(flat / toward * 10) / 10 : null } : null; })();
      if (boatItem && dragon && live(bot, dragon) && !perched(bot, dragon) && flat <= 40 && bot.entity.onGround && !bot.vehicle && !inWater() && under?.boundingBox === 'block' && !holeHere() && seatCell) {
        const edge = voidEdge(bot, bot.entity.position);
        const cloudHere = Object.values(bot.entities || {}).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position && Math.abs(e.position.y - bot.entity.position.y) <= 1.5 && Math.hypot(e.position.x - bot.entity.position.x, e.position.z - bot.entity.position.z) <= cloudRadius(bot, e) + 2);
        tree.sit_in_boat = {
          description: { action: `Set the carried ${boatItem.name.replace(/_/g, ' ')} down at the feet and sit in it through the dragon's pass: seated, the body is not thrown (a rider's own motion is zeroed every tick and its place is the boat's, so the wings' push moves it nowhere); it still takes the wings' 5 and the head's 10 through armour, and the breath's cloud where it lies; about a second to set down and sit, up and the boat picked up after the pass, about two seconds`,
            dragonBlocksOff: Math.round(flat), dragonPhase: metadata(bot, dragon, 'phase'), health: bot.health, ...(edge ? { voidEdgeBlocks: edge } : {}),
            boatCell: `2 cells ${seatCell.side}, floor ${seatCell.floor.replace(/_/g, ' ')}`,
            ...(closing ? { dragonClosing: closing.toward > 0.5 ? `closing at about ${closing.toward} blocks a second, about ${closing.seconds} s off at that pace (flying ${closing.speed} a second)` : closing.toward < -0.5 ? `going away at about ${-closing.toward} blocks a second` : `neither closing nor going away (flying ${closing.speed} a second)` } : {}),
            ...(cloudHere ? { breathCloudHere: `the breath's cloud lies ${Math.round(Math.hypot(cloudHere.position.x - bot.entity.position.x, cloudHere.position.z - bot.entity.position.z) * 10) / 10} from the body at the feet's level, ${Math.round(cloudRadius(bot, cloudHere) * 20) / 10} wide: a seat here sits in it at about six health a second` } : {}),
            standingHere: onOwnPillar() || onObsidianTop() ? `on ${onObsidianTop() ? 'a pillar\'s top' : 'the bot\'s own column'}: the pass there is the wings' sweep, and a body carried off it falls to the island` : 'on the open ground: the pass here is the wings\' sweep over it',
            record: 'the arena\'s drill (2026-10-26 12:16Z, the dragon flown beside a column top at 85): four passes seated, the body carried 0 blocks each time, 6.8 health lost in three and the fourth dead of five blows in four seconds; four passes standing crouched with the shield, carried 36 to 51 blocks and fallen 4 of 4, 3 dead. Today\'s End trials: five of fifteen deaths were the push (dragon-314, 315, 301, 304 and 308).' },
          run: async () => {
            goal.step = { action: 'sit_in_boat', health: bot.health, dragonBlocksOff: Math.round(flat) }; save();
            const t0 = Date.now(), ids = new Set(Object.keys(bot.entities));
            bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
            await bot.equip(boatItem, 'hand'); check();
            // The boat set down on a neighbouring cell's floor, never the bot's own (note 2213): the boat spawns where the
            // look's ray meets a block, and one spawned in the player's own box is refused; dragon-322 (25589, 2026-10-26
            // 13:23Z) took the seat with the cell ahead floorless, aimed at its own feet, and 'The boat was not set down',
            // then was thrown from the fountain and died of the fall. The cell the body faces first, then the other three,
            // each wanting a solid floor and two clear blocks; the top of that floor is where the look goes.
            const cell = seatCell.cell;
            await bot.lookAt(cell.offset(.5, -0.05, .5), true); await sleep(120); check();
            bot.activateItem();
            let boat = null;
            for (let i = 0; i < 20 && !boat; i++) { await sleep(50); boat = Object.values(bot.entities).find(e => !ids.has(String(e.id)) && boats.boatItem(e.name || '') && e.position && e.position.distanceTo(bot.entity.position) < 4); }
            if (!boat) throw new Error('The boat was not set down');
            (bot._ownedBoats ||= new Set()).add(boat.uuid);
            try { bot.mount(boat); } catch (err) { throw new Error(`No seat in the boat: ${String(err.message || err).slice(0, 60)}`); }
            for (let i = 0; i < 30 && bot.vehicle !== boat; i++) await sleep(50);
            if (bot.vehicle !== boat) { try { await boats.recoverBoat(bot, task, boat, boatItem.name, Math.floor(bot.entity.position.y)); } catch (_) { /* left */ } throw new Error('The seat was not taken in a second and a half'); }
            console.log(`[end combat] seated in the ${boatItem.name.replace(/_/g, ' ')} at ${bot.entity.position.floored()} for the dragon's pass, ${Math.round(flat)} blocks off, in ${Date.now() - t0} ms`);
            // Seated while the dragon is about, as the column's hold is (waitForThePass): within 40 flat and within 30 up or down and not going away; at most 25 s.
            const h0 = bot.health, t1 = Date.now(); let why = 'no dragon in sight';
            // The seat left at once with the breath on it or coming (note 2235): the emergency's throw out of this loop left the body seated, and 25592's dragon-334 (2026-10-26 16:47Z) sat in a fireball's cloud through two evasions that waited for a landing, 20 to none. The cloud or a fireball ends the seat before the check that throws.
            for (;;) {
              if (breathThreat(bot)) { why = `the breath on the seat (${breathThreat(bot).name.replace(/_/g, ' ')})`; break; }
              try { check(); } catch (err) { try { await boats.leaveBoat(bot); } catch (_) { /* the evasion dismounts too */ } throw err; }
              const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e)); if (!d) break;
              const ph = metadata(bot, d, 'phase'); if ([5, 6, 7, 9, 10].includes(ph)) { why = `the dragon perched (phase ${ph})`; break; }
              // Seated while the dragon is within forty flat and not going away (note 2226): the hold's height test (thirty up
              // is no pass) had the body up after 0 s in dragon-328 and 319 (14:50 to 15:10Z) with the dragon 35 and 2 blocks
              // off above it, and a dragon above dives; the seat costs nothing while the pass is in doubt.
              const q = bot.entity.position, f0 = Math.hypot(d.position.x - q.x, d.position.z - q.z);
              if (f0 > 40) { why = `the dragon ${Math.round(f0)} blocks off`; break; }
              if (Date.now() - t1 > 25000) { why = `25 s passed with the dragon still about, ${Math.round(f0)} blocks off`; break; }
              await sleep(250);
              const d2 = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e)); if (!d2) break;
              const f1 = Math.hypot(d2.position.x - q.x, d2.position.z - q.z), closing = (f0 - f1) / 0.25;
              if (f1 > 28 && closing < -2 && Date.now() - t1 > 3000) { why = `the dragon ${Math.round(f1)} blocks off, going away at ${Math.round(-closing)} a second`; break; }
            }
            const seatedFor = Date.now() - t1;
            try { await boats.leaveBoat(bot); } catch (_) { /* left on the next pass */ }
            for (let i = 0; i < 20 && bot.vehicle; i++) await sleep(50);
            let got = false; try { got = await boats.recoverBoat(bot, task, boat, boatItem.name, Math.floor(bot.entity.position.y)); } catch (err) { console.log(`[end combat] the boat not picked up after the pass: ${String(err.message || err).slice(0, 80)}`); }
            console.log(`[end combat] up out of the boat at ${bot.entity.position.floored()} after ${Math.round(seatedFor / 100) / 10} s seated (${why}), ${h0.toFixed(1)} to ${bot.health.toFixed(1)} health, the boat ${got ? 'picked up' : 'left'}`);
            state.seats = (state.seats || 0) + 1; save();
          } };
      }
      // A fresh start from the End (note 2236, as the Nether's respawn_fresh of note 2173): no pickaxe and nothing to eat, so
      // health lost stays lost and no hole can be dug; the void at the island's edge is the way, and everything carried
      // is lost in it. Offered with its cost; Jev's choice, never run unasked.
      {
        const RF = require('./respawn-fresh');
        const edgeCell = (!bot.inventory.items().some(i => /_pickaxe$/.test(i.name))) ? voidEdgeCell(bot, bot.entity.position, 48) : null;
        const rf = RF.offeredEnd(bot, goal, { edge: edgeCell });
        if (rf) {
          tree.respawn_fresh = { description: RF.saysEnd(bot, goal, rf, { dragonHealth: dragon?.health ?? null }), run: async () => {
            const died = await RF.runEnd(bot, task, goal, save, { edge: rf.edge, navigate: actions.navigate, move: require('./motion').move });
            console.log(`[end combat] respawn_fresh from the End at ${bot.entity.position.floored()}: ${died ? 'the body fell into the void, as Jev chose' : 'the body did not fall in ninety seconds'}`);
          } };
        }
      }
    }
    const openSky = (() => { const g = bot.entity.position.floored(); for (let dy = 2; dy <= 8; dy++) if (bot.blockAt(g.offset(0, dy, 0))?.boundingBox === 'block') return false; return true; })();
    if (actions.dig && fountain && openSky && !onOwnPillar() && !onObsidianTop() && !holeHere() && !(dragon && perched(bot, dragon)) && byFountain >= 6) {
      // With no block carried too (note 1742): the hole's two dug end stone are its roof's, and the stock taken underground (note 1741) is for the bot with none; dragon-294 (2026-10-15 17:06Z) was never offered it at none carried and died so in the breath at (8, 64, 2).
      const feet = bot.entity.position.floored();
      const thick = [1, 2, 3, 4, 5, 6].every(dy => bot.blockAt(feet.offset(0, -dy, 0))?.boundingBox === 'block');
      const wallsHold = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => bot.blockAt(feet.offset(dx, -1, dz))?.boundingBox === 'block' && bot.blockAt(feet.offset(dx, -2, dz))?.boundingBox === 'block');
      if (thick && wallsHold && voidEdge(bot, bot.entity.position, 4) === null) tree.wait_in_hole = {
        description: { dragonSitting: sitsSays(), action: `Dig two blocks down under the feet here, ${Math.round(byFountain)} blocks from the fountain, and wait in the hole for the dragon to perch: two deep in the ground the body is below the wings' push (4 over the squared distance a tick, 5 of hurt, the throw off the island) and below the breath's cloud; the dragon keeps its perch while a player stands within 20 of it, in a hole or not; the way out is two blocks laid, about a second, and the run to the fountain from here ${Math.round(byFountain / 5.6 * 10) / 10} s more. The wait is a second a question, as observe is.`,
          sight: 'roofed, the hole is out of the dragon\'s sight, and it throws its fireballs only at a body it sees; the hole is one block laid for its roof against two end stone dug, a stub walled out of sight twelve laid',
          blocksFromFountain: Math.round(byFountain), health: bot.health, blocksCarried: blocksCarried(bot), dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null,
          record: 'the take-off\'s throw ended dragon-121, 130 and 136 on 2026-10-14 at six or seven crystals, each standing in the open by the fountain or on its way to it; the landing and the throw did for dragon-149 and 151 at one crystal',
          drill: 'the arena\'s drill of 2026-10-14 (09:30 to 09:36Z, the dragon set landing on the fountain and then taking off, the bot eleven blocks from it): in a hole two deep the body was moved 0 and lost 0 of health in three of three; standing in the open it was thrown 9 and 6 blocks and lost 15 and 10 in two of three (0 in the third); crouched in the open it lost 5 in three of three and moved under 2' },
        run: async () => {
          // The cell taken where the body stands when the run begins (note 1598), not where it stood when the option was built a question earlier: 25588 (dragon-141, 2026-10-14 08:01Z) was 0.81 off the cell it tried to centre on, a cell away, 'the body still on the rim'. The ground read again for it.
          const feet = bot.entity.position.floored();
          const thickHere = [1, 2, 3, 4, 5, 6].every(dy => bot.blockAt(feet.offset(0, -dy, 0))?.boundingBox === 'block') && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => bot.blockAt(feet.offset(dx, -1, dz))?.boundingBox === 'block' && bot.blockAt(feet.offset(dx, -2, dz))?.boundingBox === 'block') && voidEdge(bot, bot.entity.position, 4) === null;
          if (!thickHere) throw new Error(`The ground at ${feet} is not the hole's: thin, open beside, or the void within four`);
          goal.step = { action: 'wait_in_hole', at: { ...feet } }; save();
          // Centred on the cell first (note 1595): a body 0.6 wide at a cell's edge stands on the rim when the cell under it is dug, and 25588 (dragon-139, 2026-10-14 07:35Z) dug its hole at (10, 60, 16) and stayed at 60, 'a side open'.
          const centre = feet.offset(.5, 0, .5), off = () => Math.hypot(centre.x - bot.entity.position.x, centre.z - bot.entity.position.z);
          if (!await dryTheHoleCell(feet)) throw new Error('Water stands beside the hole\'s cell');
          await centreOn(feet.x, feet.z, 0.12);
          // Dug from on the block, dropping into the cell (note 1616): the dig helper steps the body off any block under its own feet unless told to drop in, and the hole's first block was dug from the cell beside it, the body left on the rim 0.8 off the middle every time (25588, dragon-139, 141, 144, 153 and 154, 2026-10-14; the arena's centring test of 09:38Z brought the body to 0.1 in 0.6 s, so the nudge was never the fault).
          for (const dy of [1, 2]) { check(); state.diggingHole = Date.now(); await actions.dig(bot, task, feet.offset(0, -dy, 0), { requireDrops: false, dropInto: true }); }
          for (let i = 0; i < 30 && Math.floor(bot.entity.position.y) > feet.y - 2; i++) await sleep(50);
          const inIt = Math.floor(bot.entity.position.y) <= feet.y - 2;
          if (inIt) { state.hole = { x: feet.x, y: feet.y - 2, z: feet.z, at: Date.now() }; save(); if (!(dragon && perched(bot, dragon))) await roofHole(true); }
          console.log(`[end combat] ${inIt ? 'in the hole' : 'not down into the hole'} at ${bot.entity.position.floored()} (${Math.round(off() * 100) / 100} off the cell's middle), ${Math.round(byFountain)} from the fountain: ${holeHere() ? 'walled on four sides' : inIt ? 'a side open' : 'the body still on the rim'}`);
          if (!inIt) throw new Error('The body did not go down into the hole');
          progress = true;
        } };
    }
    // The tunnel quarry (note 1735, the fight plan's first step): from the hole two deep, a tunnel one wide and two high dug sideways through the island's end stone, the stone picked up as the body steps into each cell. Underground the body is out of the dragon's sight (its fireballs need it), under the breath's slab on the ground above, and end stone is proof against the dragon's body (Fable, 2026-10-15). On the open ground 25588's quarries were cut by the dragon or the breath in most of today's runs (dragon-240 to 288), and four deaths in five came with none or one block carried.
    const makeTunnel = () => {
      // A block under the hole's floor (note 1737): the hole is two deep, so a tunnel at its floor has the open ground for a ceiling, and none was ever offered (dragon-290, 2026-10-15 16:00 to 16:04Z, five holes, 0 tunnel_quarry). The tunnel runs a block lower, under a ceiling of the island's own stone.
      // In the tunnel already the next one runs at its own floor, not a block lower (note 1746).
      // A block lower only from a hole dug from the open ground within two minutes (note 1750): from any other hole (the tunnel's, its record lapsed) each tunnel went a block deeper; 25588's dragon-20 of the new save (2026-10-15 23:05Z to 00:01Z) went down so to y 30 with no block left.
      const fh = bot.entity.position.floored(), freshHole = state.hole && Date.now() - state.hole.at < 120000 && state.hole.x === fh.x && state.hole.z === fh.z && state.hole.y === fh.y && !inTunnel();
      const f0 = (freshHole ? fh.offset(0, -1, 0) : fh), es = c => bot.blockAt(c)?.name === 'end_stone', sd = c => bot.blockAt(c)?.boundingBox === 'block';
      const runs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => { let n = 0; for (let k = 1; k <= 20; k++) { const c = f0.offset(dx * k, 0, dz * k); if (!es(c) || !es(c.offset(0, 1, 0)) || !sd(c.offset(0, -1, 0)) || !sd(c.offset(0, 2, 0)) || voidEdge(bot, c.offset(.5, 0, .5), 4) !== null) break; n = k; } return { dx, dz, n }; }).sort((a, b) => b.n - a.n);
      // Toward the nearest standing crystal where that way holds three cells or more (note 1744): the walk to the pillar's foot is then underground, and the climb is the only time in the open. 25588 (dragon-296, 2026-10-15 17:23Z) had dug three tunnels, 81 stone at full health, climbed out for the walk to crystal 94's pillar, and the dragon's body threw it 50 blocks to its death 13 s later.
      const near = crystals.slice().sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
      const toward = near ? runs.filter(r => r.n >= 3).sort((a, b) => ((b.dx * (near.position.x - f0.x) + b.dz * (near.position.z - f0.z)) - (a.dx * (near.position.x - f0.x) + a.dz * (near.position.z - f0.z))))[0] : null;
      const best = toward && (toward.dx * (near.position.x - f0.x) + toward.dz * (near.position.z - f0.z)) > 0 ? toward : runs[0];
      if (best.n < 3 || f0.y < 50) return null;
      return {
        description: { action: `Dig a tunnel one wide and two high sideways from this hole, ${best.n} cells of end stone ${best.dx === 1 ? 'east' : best.dx === -1 ? 'west' : best.dz === 1 ? 'south' : 'north'}, two stone a cell picked up as the body steps in, about a second a block with the ${(bot.inventory.items().find(i => /_pickaxe$/.test(i.name)) || {}).name || 'pickaxe'}; the body stays underground the while, out of the dragon's sight and under the breath's slab on the ground, and end stone stands against the dragon's body`, blocksCarried: blocksCarried(bot), cells: best.n, health: bot.health },
        run: async () => {
          const t0 = Date.now(), before = blocksCarried(bot); let cells = 0;
          if (bot.blockAt(f0)?.boundingBox === 'block') { await actions.dig(bot, task, f0, { requireDrops: false, dropInto: true }); for (let i = 0; i < 20 && Math.floor(bot.entity.position.y) > f0.y; i++) await sleep(50); }
          if (Math.floor(bot.entity.position.y) > f0.y) throw new Error(`The body did not go down to the tunnel's floor at ${f0}`);
          // The hole's mouth roofed first (note 1740): the shaft over the tunnel's first cell is open to the sky, and a fireball sees down it.
          state.tunnelAt = Date.now(); try { if (!roofed()) await roofHole(true); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
          for (let k = 1; k <= best.n && Date.now() - t0 < 45000 && blocksCarried(bot) < 64; k++) {
            check();
            const c = f0.offset(best.dx * k, 0, best.dz * k);
            for (const cell of [c.offset(0, 1, 0), c]) if (bot.blockAt(cell)?.boundingBox === 'block') await actions.dig(bot, task, cell, { requireDrops: false });
            await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'into_the_tunnel', keys: ['forward'], sneak: false, why: 'into the tunnel cell just dug', look: c.offset(.5, 1.6, .5), maxMs: 1500, tick: 25, until: () => Math.floor(bot.entity.position.x) === c.x && Math.floor(bot.entity.position.z) === c.z });
            cells++; state.tunnelAt = Date.now();
          }
          // Every stone along the tunnel picked up, round after round (note 1738, as the quarry's note 1502): dragon-291 (2026-10-15 16:19Z) dug twelve cells east from (22, 59, -1) and gained none, the stone left where the body did not step.
          { const t1 = Date.now(); let rounds = 0; while (Date.now() - t1 < 15000 && rounds < 20) { rounds++; let got = false; try { got = await require('./drop-collection').collectNearbyDrops(bot, task, 'end_stone', { radius: best.n + 3, timeoutMs: 3000, waitForSpawnMs: rounds === 1 ? 300 : 0, move: actions.navigate }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; } if (!got) break; } }
          const lying = Object.values(bot.entities).filter(e => e.name === 'item' && e.isValid !== false && e.position.distanceTo(bot.entity.position) <= best.n + 3).length;
          const got = blocksCarried(bot) - before; (state.tunnelQuarry ||= { tries: 0, gained: 0, seconds: 0 }); state.tunnelQuarry.tries++; state.tunnelQuarry.gained += Math.max(0, got); state.tunnelQuarry.seconds += (Date.now() - t0) / 1000;
          console.log(`[end combat] the tunnel quarry from ${f0}: ${cells} cells dug ${best.dx === 1 ? 'east' : best.dx === -1 ? 'west' : best.dz === 1 ? 'south' : 'north'}, ${got} end stone gained, ${blocksCarried(bot)} carried, ${Math.round((Date.now() - t0) / 100) / 10} s, ${bot.health.toFixed(1)} health; the body at ${bot.entity.position.floored()}, ${lying} items lying along it`);
          state.hole = { x: bot.entity.position.floored().x, y: bot.entity.position.floored().y, z: bot.entity.position.floored().z, at: Date.now() }; save();
          if (got > 0) progress = true;
        } };
    };
    // The climb's record closed when the body is on the ground again (note 1764).
    if (bot._climbNow && !onOwnPillar() && !onObsidianTop() && !bot._dropping && !bot._fallRecovery && bot.entity.onGround) require('./climb-record').end(bot, 'down');
    if (actions.dig && pickCarried() && holeHere() && blocksCarried(bot) < 64) { const t = makeTunnel(); if (t) tree.tunnel_quarry = t; }
    // The stock taken underground in one choice (note 1741): the hole and then the tunnel were two choices, and Jev took the hole and left it; 25588 (dragon-293, 2026-10-15 16:36 to 16:56Z, two crystals broken) never took the tunnel, the block budget said on every option, and died with none carried in the breath at (-9, 64, -4).
    if (actions.dig && pickCarried() && !holeHere() && tree.wait_in_hole && blocksCarried(bot) < 32) tree.stock_up_underground = {
      description: { quarriesThisFight: `open ground: ${state.openQuarry ? `${state.openQuarry.tries} begun, ${state.openQuarry.gained} stone gained in ${Math.round(state.openQuarry.seconds)} s` : 'none yet'}; underground: ${state.tunnelQuarry ? `${state.tunnelQuarry.tries} tunnels, ${state.tunnelQuarry.gained} stone in ${Math.round(state.tunnelQuarry.seconds)} s` : 'none yet'}; 25588's tunnels of 2026-10-15: 25 stone in 35 s at full health (dragon-291)`, action: `Dig the hole two deep here, roof it, and from a block under its floor dig a tunnel sideways through the island's end stone, picking the stone up, to 64 blocks carried or 45 s: the whole while underground, out of the dragon's sight and under the breath's slab, the stone proof against its body`, blocksCarried: blocksCarried(bot), health: bot.health },
      run: async () => { await tree.wait_in_hole.run(); const t = makeTunnel(); if (!t) throw new Error('No tunnel of end stone in a line from this hole'); await t.run(); } };
    // The way up out from under the island (note 1747): a staircase dug up through the stone, a step a block, the stone picked up on the way. 25588 (dragon-6 of the new save, 2026-10-15 19:18 to 19:52Z, four crystals broken) stood at (-3, 18, 13) under the island with no block carried and was offered only observe for half an hour.
    // Why the stair was not offered, said once a minute under 58 (note 1757): 25588's dragon-20 of the new save (2026-10-16 05:4x to 07:4xZ) sat in a roofed hole at (36, 49, -4) two hours with no block, offered stay_in_hole and observe only, no stair.
    if (bot.entity.position.y < 58 && !(state.stairWhySaid > Date.now() - 60000)) { state.stairWhySaid = Date.now(); const g = bot.entity.position.floored(); console.log(`[end combat] the stair up at ${g}: dig ${!!actions.dig}, open sky ${openSky}, own pillar ${onOwnPillar()}, obsidian top ${onObsidianTop()}, sides ${[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ['ahead', 0, 1, 2].slice(1).map(dy => bot.blockAt(g.offset(dx, dy, dz))?.name || '?').join('/')).join(' ')}`); }
    if (actions.dig && !openSky && !onOwnPillar() && !onObsidianTop() && bot.entity.position.y < 58) {
      const g0 = bot.entity.position.floored(), sd = c => bot.blockAt(c)?.boundingBox === 'block', diggable = c => !/bedrock|obsidian|end_portal/.test(bot.blockAt(c)?.name || '');
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => diggable(g0.offset(dx, 1, dz)) && diggable(g0.offset(dx, 2, dz)) && sd(g0.offset(dx, 0, dz)));
      // No void test for the way up (note 1748): near the island's underside the void lies under every side, and 25588's dragon-6 (2026-10-15 19:5x to 20:25Z, seven crystals broken) was offered no stair at (-4, 18, 13) for it; the step's floor is the stone itself, the cell ahead at the feet' level.
      if (dirs.length) tree.dig_up_to_the_surface = {
        description: { action: `Dig a staircase up through the island's stone from ${g0}, a step a block (the cell ahead a block up and the two over it), the stone picked up as it goes, until the sky is open overhead: about ${Math.max(1, 62 - g0.y)} steps, two or three seconds each with the pickaxe${pickCarried() ? '' : '; no pickaxe is carried: by hand each step is two blocks of end stone at about fifteen seconds a block, half a minute a step (note 1839: 25588\'s dragon-200 sat sealed in its tunnel at (29, 53, -26) with 396 blocks, its pickaxe gone, every walk failing, this never offered)'}`, depth: Math.max(0, 62 - g0.y), blocksCarried: blocksCarried(bot), health: bot.health },
        run: async () => {
          // Every way in turn (note 1751): one way's step ahead had no floor at the island's underside, 'up the staircase ... 2 steps' 212 times from the same cell (dragon-20 of the new save).
          let way = 0, [dx, dz] = dirs[0]; const t0 = Date.now(); let steps = 0, stuck = 0;
          const turn = () => { way++; if (way >= dirs.length) return false; [dx, dz] = dirs[way]; return true; };
          while (Date.now() - t0 < 180000 && steps < 80) {
            check();
            const g = bot.entity.position.floored();
            if ([2, 3, 4, 5, 6, 7, 8].every(dy => !sd(g.offset(0, dy, 0)))) break;
            const ahead = g.offset(dx, 1, dz);
            for (const c of [g.offset(0, 2, 0), ahead, ahead.offset(0, 1, 0)]) if (sd(c)) { if (!diggable(c)) throw new Error(`The stair's way is ${bot.blockAt(c).name} at ${c}`); await actions.dig(bot, task, c, { requireDrops: false }); }
            if (!sd(ahead.offset(0, -1, 0))) { if (turn()) continue; break; }
            await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'stair_up', keys: ['forward', 'jump'], sneak: false, why: 'up the staircase step just dug', look: ahead.offset(.5, 1.6, .5), maxMs: 1500, tick: 25, until: () => Math.floor(bot.entity.position.y) > g.y && Math.floor(bot.entity.position.x) === ahead.x && Math.floor(bot.entity.position.z) === ahead.z });
            if (Math.floor(bot.entity.position.y) <= g.y) { if (++stuck <= 2 && turn()) continue; break; }
            steps++;
          }
          console.log(`[end combat] up the staircase from ${g0}: ${steps} steps to ${bot.entity.position.floored()}, ${blocksCarried(bot)} blocks carried, ${Math.round((Date.now() - t0) / 1000)} s`);
          if (steps) progress = true;
        } };
    }
    // Off a stub of the bot's own blocks onto the ground beside (note 1749): with no block carried the stub's top offered only observe, no hole (its sides open) and no climb. 25588 (dragon-11 of the new save, 2026-10-15 21:4xZ, two crystals broken) stood on cobblestone at (12, 63, 11) with none carried until a fireball's cloud took it.
    { const g = bot.entity.position.floored(), sd = c => bot.blockAt(c)?.boundingBox === 'block', under = bot.blockAt(g.offset(0, -1, 0))?.name || '';
      if (!onObsidianTop() && /^(cobblestone|cobbled_deepslate|end_stone|netherrack|dirt|stone)$/.test(under) && !sd(g.offset(0, 2, 0))) {
        const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => { const c = g.offset(dx, 0, dz); if (sd(c) || sd(c.offset(0, 1, 0))) return null; for (let fall = 1; fall <= 3; fall++) { if (sd(c.offset(0, -fall, 0))) return null; if (sd(c.offset(0, -fall - 1, 0))) return { dx, dz, fall, land: c.offset(0, -fall, 0) }; } return null; }).filter(Boolean).filter(x => voidEdge(bot, x.land.offset(.5, 0, .5), 3) === null).sort((a, b) => a.fall - b.fall);
        const down = sides[0];
        if (down && down.fall >= 1 && blocksCarried(bot) < 2 && !Object.keys(tree).some(k => k !== 'observe')) tree.step_down = {
          description: { action: `Step off this ${under.replace('_', ' ')} ${down.dx === 1 ? 'east' : down.dx === -1 ? 'west' : down.dz === 1 ? 'south' : 'north'}, ${down.fall} down onto the island at ${down.land}: no harm in a fall of three or under; on the ground the hole, the tunnel and the quarry are to be had`, fall: down.fall, blocksCarried: blocksCarried(bot), health: bot.health },
          run: async () => {
            const from = bot.entity.position.y;
            await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'step_down', keys: ['forward'], sneak: false, why: 'off the stub onto the ground beside', look: down.land.offset(.5, 1.6, .5), maxMs: 2000, tick: 25, intoFall: true, until: () => bot.entity.position.y < from - 0.5 && bot.entity.onGround });
            console.log(`[end combat] stepped down from ${g} to ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health`);
            if (bot.entity.position.y < from - 0.5) progress = true;
          } };
      } }
    // The meal in the fight (note 1634): health comes back a point every four seconds only at hunger eighteen or more, and 25588 (dragon-163, 2026-10-14 12:29 to 12:33Z, all ten crystals broken, the dragon at 140) had its hunger fall to 17 and then 15 by the fountain, regenerated nothing more, took the dragon's blows 18 to 15 to 10 to 7 to 4.6 over four minutes with four cooked rabbit in its pockets, was never offered a meal (none_good 0.46 to 0.73), and died. Offered whenever hunger is under eighteen or health under ten with food carried; eaten where the body stands, in the hole without climbing out.
    {
      // The reserve quarry (note 1688; offered under sixteen, note 1701: the climb out of a cloud is two, a stub's roof five, a pocket eight, and dragon-236 and 239 of 2026-10-15 died with none or one): blocks are the fight's escapes, two a climb out of a cloud, five a stub's roof, eight a pocket, and 25588 ended 199, 201, 214, 215, 219, 220 and 222 of 2026-10-14/15 with two or fewer, the climb out of the breath laying one of two and the body dead in its cloud. Under ten carried, with a pickaxe and the island's end stone within seven, Jev is offered the dig, whatever crystal is next.
      {
        const pick = bot.inventory.items().find(i => /_pickaxe$/.test(i.name)), carriedNow = blocksCarried(bot);
        if (pick && actions.dig && carriedNow < 16 && !inWater() && onTheGround()) {
          const feet = bot.entity.position.floored(), cells = [];
          const { deepBeside } = require('./end-safety');
          const skyOver = p => { for (let dy = 1; dy <= 12; dy++) if (bot.blockAt(p.offset(0, dy, 0))?.boundingBox === 'block') return false; return true; };
          const byWater = p => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([ax, ay, az]) => /water/.test(bot.blockAt(p.offset(ax, ay, az))?.name || ''));
          for (let r = 1; r <= 7 && cells.length < 12; r++) for (let dx = -r; dx <= r && cells.length < 12; dx++) for (let dz = -r; dz <= r && cells.length < 12; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            for (const dy of [1, 0, -1]) {
              const p = feet.offset(dx, dy, dz);
              if (bot.blockAt(p)?.name !== 'end_stone' || bot.blockAt(p.offset(0, -1, 0))?.boundingBox !== 'block' || !skyOver(p) || deepBeside(bot, p.offset(.5, 1, .5))) continue;
              if (byWater(p) || (state.pool && Math.max(Math.abs(p.x - state.pool.x), Math.abs(p.z - state.pool.z)) <= 2)) continue;
              cells.push(p); break;
            }
          }
          if (cells.length >= 4) tree.quarry_reserve = {
            description: { action: `Dig ${cells.length} end stone from the island's ground within seven blocks of where the bot stands, with the ${pick.name.replace('_', ' ')}, as the fight's reserve: ${carriedNow} blocks carried, and the ways out of the breath and the body are laid of blocks (two a climb out of a cloud, five a roof over a stub, eight a pocket at a column's top). The floor cells dug have rock under them; about a second a block.`,
              blocksCarried: carriedNow, cellsToDig: cells.length, health: bot.health, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null,
              record: 'seven of 25588\'s runs of 2026-10-14/15 ended with two blocks or fewer, the climb out of the breath laying one of two and the body dead in its cloud; dragon-236 and 239 (2026-10-15) died with none or one', dropsCollected: 'the dug blocks are walked over and taken only while the dragon is more than 20 blocks off; with it nearer they lie where dug (dragon-235 dug 12 three times and kept almost none)' },
            run: async () => {
              const before = blocksCarried(bot);
              goal.step = { action: 'quarry_reserve', cells: cells.length }; save();
              let dug = 0;
              for (const p of cells) {
                check();
                if (dragonComingAtQuarry()) { console.log(`[end combat] the reserve quarry stopped: the dragon coming, ${dug} cells dug`); break; }
                if (hostileEntities(bot, 5).some(e => live(bot, e) && e.name !== 'ender_dragon')) break;
                if (inWater()) break;
                if (bot.blockAt(p)?.name !== 'end_stone') continue;
                try { await actions.dig(bot, task, p, { requireDrops: false }); dug++; } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; break; }
              }
              // The drops walked over (note 1693): the reserve quarry dug 12 of 12 and carried 7, then 5, the end stone lying in the cells it did not step in (dragon-229 and 230, 2026-10-15 03:2x and 03:5xZ). Each dug cell is stepped to for a second while the dragon is not within 20.
              if (blocksCarried(bot) - before < dug) {
                const dNow = () => { const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e)); return d ? Math.hypot(d.position.x - bot.entity.position.x, d.position.z - bot.entity.position.z) : 99; };
                for (const p of cells) {
                  if (blocksCarried(bot) - before >= dug || dNow() < 20) break;
                  check();
                  try { await actions.navigate(bot, task, new goals.GoalNear(p.x + .5, p.y, p.z + .5, 0.8), { timeoutMs: 1500, stallMs: 800 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
                }
              }
              console.log(`[end combat] the reserve quarry dug ${dug} of ${cells.length} cells: ${blocksCarried(bot)} blocks carried (${before} before)`);
              progress = blocksCarried(bot) > before;
            } };
        }
      }
      // An iron pickaxe crafted in the fight (note 1758): the pickaxe wears out, 250 blocks for iron, and every block of the fight's climbs, roofs and pockets is end stone dug with it. 25588 (dragon-40, 2026-10-16 16:32Z, six crystals broken) wore its iron pickaxe out in the tunnel quarry, dug the staircase up by hand (198 s for three steps) and stood three hours 'only observe' with 3 blocks, 9 iron ingots, 5 sticks and a crafting table carried.
      {
        const count = n => bot.inventory.items().filter(i => i.name === n).reduce((k, i) => k + i.count, 0);
        const anyPick = bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
        const ingots = count('iron_ingot'), sticks = count('stick'), planks = bot.inventory.items().filter(i => /_planks$/.test(i.name)).reduce((k, i) => k + i.count, 0);
        const tableCarried = count('crafting_table') > 0;
        if (!anyPick && actions.craft && ingots >= 3 && (sticks >= 2 || planks >= 2) && tableCarried && !inWater() && onTheGround()) {
          tree.craft_pickaxe = {
            description: { action: `Craft an iron pickaxe here: the crafting table carried is set down beside the body, three iron ingots and two sticks${sticks >= 2 ? '' : ' (made from two planks first)'} are made into the pickaxe, and the table is taken back (a second pickaxe wants two more sticks: the End grows no wood). No pickaxe is carried, and without one end stone is not dug (by hand a block takes about fifteen seconds and drops nothing), so no block for a climb, a roof or a pocket is to be had; an iron pickaxe digs end stone in about a second and lasts 250 blocks. About five seconds, the body on the ground the while.`,
              pickaxeCarried: false, ironIngots: ingots, sticks, planks, craftingTableCarried: true, blocksCarried: blocksCarried(bot), health: bot.health, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null,
              // Where the craft would stand (note 1817): 25588's dragon-187 (2026-10-18 03:24Z) gave craft_pickaxe 0.07 and none_good 0.28 with the body two blocks up out of its hole on the open ground, then died at the foot of a bare climb with no pickaxe; the craft takes about five seconds standing still, and where that is decides it.
              where: holeHere() ? 'in the hole, two deep: out of the dragon\'s sight and reach for the five seconds the craft takes' : inTunnel() ? 'in the tunnel under the island: out of the dragon\'s sight and reach for the five seconds the craft takes' : `on the open ground${dragon ? `, the dragon ${Math.round(dragon.position.distanceTo(bot.entity.position))} blocks off` : ''}: five seconds standing still where a fireball's cloud lands on the body and its charge carries it off${state.hole && Date.now() - state.hole.at < 120000 ? `; the hole at (${state.hole.x}, ${state.hole.y}, ${state.hole.z}) is ${Math.round(Math.hypot(state.hole.x + .5 - bot.entity.position.x, state.hole.z + .5 - bot.entity.position.z))} blocks off` : ''}`,
              afterward: 'with the pickaxe the tunnel to a crystal\'s foot, the hole two deep and the dig down the column after a blow are to be had again; without it none of them, and the climbs end on their columns with no way down',
              record: '25588\'s dragon-40 (2026-10-16) wore its iron pickaxe out in the tunnel quarry 20 minutes in, six crystals broken, and stood three hours by the fountain with 3 blocks, no blow offered at the last four crystals and the ingots for three pickaxes carried' },
            run: async () => {
              goal.step = { action: 'craft_pickaxe_in_the_fight', ingots, sticks }; save();
              // The table taken back whatever cut the craft (note 1816, after 1813): a craft cut by an emergency after the table went down left it standing, and 25588's dragon-186 (2026-10-18 03:07Z) had no craft_pickaxe to choose with 6 ingots and 3 sticks, no table carried, its pickaxe gone at tunnel cell 28; dead on the surface at 03:12Z.
              // The table's drop walked to (note 1835): dug but not picked up, 25588's dragon-195 (2026-10-18 07:34Z) lost its table at (8, 61, -31) and with it every craft after.
              const tableBack = async () => { if (!actions.dig || count('crafting_table') > 0) return; const tb = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 }); if (!tb) return; try { await actions.dig(bot, task, tb.position, { requireDrops: true }); } catch (err) { if (['Cancelled', 'NeedsAir'].includes(err.name)) throw err; } if (!count('crafting_table')) { try { await require('./drop-collection').collectNearbyDrops(bot, task, 'crafting_table', { radius: 6, timeoutMs: 4000, waitForSpawnMs: 300, move: actions.navigate }); } catch (err) { if (['Cancelled', 'NeedsAir'].includes(err.name)) throw err; } } console.log(`[end combat] the crafting table at ${tb.position} ${count('crafting_table') ? 'taken back' : 'dug but not picked up'}`); };
              try {
                if (sticks < 2) await actions.craft(bot, task, { action: 'craft', item: 'stick', count: 4, consumes: {} }, goal);
                await actions.craft(bot, task, { action: 'craft', item: 'iron_pickaxe', count: 1, needs_table: true, consumes: { iron_ingot: 3, stick: 2 } }, goal);
              } finally { try { await tableBack(); } catch (_) { /* the table stays */ } }
              const made = bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
              console.log(`[end combat] the pickaxe crafted in the fight: ${made ? 'an iron pickaxe carried' : 'none made'}, ${count('iron_ingot')} iron ingots left, ${bot.health.toFixed(1)} health at ${bot.entity.position.floored()}`);
              if (!made) throw new Error('No pickaxe was made');
              progress = true;
            } };
        }
      }
      let meal = null; try { meal = require('./low-health').mealOf(bot); } catch (_) { meal = null; }
      const food = bot.food ?? 20;
      // No meal within four seconds of a fireball (note 1775): its cloud lands in that window and the meal is a second and a half still. 25588's dragon-141 (2026-10-17 17:0xZ, two crystals broken) had its climb cut by a fireball nine blocks up the column at (-31, 69, 26), chose eat at 17 health, and the cloud landed on it mid-meal, 17 to 12, dead off the column.
      if (meal && (food < 18 || bot.health <= 10) && bot.health < 20 && !(state.lastFireballAt > Date.now() - 4000)) {
        const secs = require('./survival').EAT_SECONDS;
        tree.eat = { description: { action: `Eat the ${meal.item.name.replaceAll('_', ' ')} where the body stands, ${secs} seconds still${meal.after ? `, hunger ${food} to ${meal.after}` : ''}: health comes back a point every four seconds at hunger eighteen or more and not at all under it${holeHere() ? '; the body stays in its hole for it' : ''}`,
            onTheColumn: onOwnPillar() || onObsidianTop() ? 'the body stands on a column one block wide in the open, still for the meal' : false, secondsSinceTheLastFireball: state.lastFireballAt ? Math.round((Date.now() - state.lastFireballAt) / 1000) : null,
            health: bot.health, hunger: food, regenerating: food >= 18 && bot.health < 20, foodCarried: bot.inventory.items().filter(i => i.name === meal.item.name).reduce((n, i) => n + i.count, 0), inHole: holeHere(), dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null,
            record: 'dragon-163 (2026-10-14) bled 18 to 4.6 over four minutes at hunger 15 to 17 with four cooked rabbit carried and died by the fountain with the dragon at 140 of 200' },
          run: async () => {
            goal.step = { action: 'eat_in_the_fight', food, health: bot.health }; save();
            const before = { food: bot.food, count: meal.item.count };
            const r = await require('./meal').eatThrough(bot, task, meal.item, { eaten: () => (bot.food ?? 0) > before.food || (bot.inventory.items().find(i => i.name === meal.item.name)?.count ?? 0) < before.count });
            console.log(`[end combat] ate the ${meal.item.name.replaceAll('_', ' ')}: hunger ${before.food} to ${bot.food}, ${bot.health.toFixed(1)} health${holeHere() ? ', in the hole' : ''}`);
            if (!r.eaten) throw new Error('The meal was not eaten');
            progress = true;
          } };
      }
    }
    // The sword from the hole (note 1618): the perched head sits a block under
    // the dragon's middle and 6.5 before it, and the dragon turns to the player
    // it sees within twenty; from a hole two deep at 7 from the fountain's
    // middle the eyes are 1.4 under the head's centre and the sword's three
    // reach it, with the body below the wings' boxes and the breath's cloud
    // (half a block deep on the surface). Every run under the head from the
    // open was lifted or breathed on (dragon-151, 153, 154 and 155, 2026-10-14,
    // none struck; the arena's run drill of 10:08Z lost 10 to 20 in two to
    // four seconds in five runs of six).
    const strikeFromHole = async ms => {
      const sword = bot.inventory.items().find(i => /_sword$/.test(i.name) && durable(bot.registry, i));
      if (!sword || !dragon) return 0;
      await bot.equip(sword, 'hand'); check();
      const until = Date.now() + ms; let swings = 0, landed = 0, lastSeen = Date.now(), ever = false, jumps = 0, jumpSwings = 0;
      while (Date.now() < until) {
        check();
        if (!holeHere()) break;
        if (inWater()) { console.log(`[end combat] water in the hole at ${bot.entity.position.floored()}: out of it`); await outOfTheHole(); break; }
        const fresh = live(bot, dragon) && perchedHead(bot, dragon);
        if (fresh) {
          lastSeen = Date.now(); ever = true;
          if (roofed() && actions.dig) { await roofHole(false); continue; }
          // The blows go blind (note 2219; Fable, 2026-10-26 14:30Z): the head here is perchedHead's guess (the dragon's
          // position 6.5 forward, a block down) and the server judges reach against the real head part, which the client
          // never sees, so canStrike said 'in reach' for nine swings that took nothing (dragon-322, 'dragon 183.5 to 184')
          // and 'out of reach' for the jumps that might have. A refused swing costs a packet. Each cycle: a swing from the
          // floor, then a jump and a swing at its apex; the dragon's health read half a second after each, a drop a blow
          // landed (state.holeHead.landed), said on the hole's options as fromHolesThisFight.
          const gapNow = fresh.position.distanceTo(bot.entity.position.offset(0, 1.62, 0));
          if (gapNow <= 6) {
            const tallyH = state.holeHead ||= { tries: 0, dugIn: 0, swings: 0 }; tallyH.landed ||= 0;
            const swing = async where => {
              const before = live(bot, dragon) ? (dragon.health ?? metadata(bot, dragon, 'health')) : null;
              if (typeof bot.lookAt === 'function') await bot.lookAt(fresh.position.offset(0, .5, 0), true);
              bot.attack(fresh); swings++; if (where === 'apex') jumpSwings++;
              for (let n = 0; n < 5; n++) { check(); await sleep(100); }
              const after = live(bot, dragon) ? (dragon.health ?? metadata(bot, dragon, 'health')) : null;
              if (Number.isFinite(before) && Number.isFinite(after) && before - after >= 1) { landed++; tallyH.landed++; }
            };
            await swing('floor');
            if (!roofed()) {
              jumps++; bot.setControlState?.('jump', true);
              try { for (let n = 0; n < 6; n++) { check(); await sleep(50); } await swing('apex'); } finally { bot.setControlState?.('jump', false); }
            }
            save();
            continue;
          }
          // Out of reach from the floor (note 1633): the dragon sits with its belly at 65 on the fountain and its head a block under, 3.4 over the eyes of a body two deep (dragon-163, 2026-10-14 12:55Z: 'from the hole under the head: 0 swings' three times while the runs from the ground beside struck it ten times). Up out of the hole onto its cell for the sword while it sits, and two dug again when it rises.
          const gap = fresh.position.distanceTo(bot.entity.position.offset(0, 1.62, 0));
          // Not under a cloud on the rim (note 1650): the climb out for the sword put the body into the breath's cloud lying on the rim, and 25588 (dragon-183, 2026-10-14 16:46Z, one crystal broken) went 12 to 2.4 to none coming up at (5, 59, 10) with the cloud at (6, 61, 7).
          const rimCell = bot.entity.position.floored().offset(0, 2, 0);
          const cloudOnRim = Object.values(bot.entities).some(e => e.name === 'area_effect_cloud' && e.isValid !== false && Math.abs(e.position.y - rimCell.y) <= 1.5 && Math.hypot(e.position.x - rimCell.x - .5, e.position.z - rimCell.z - .5) <= cloudRadius(bot, e) + 1);
          // The jump for the head from the hole first (note 2209): two deep, the head sits 3.4 over the eyes, a jump lifts them 1.25,
          // and the sword's three reaches it at the apex; the body stays in its hole, below the wings. Today's dragon trials dug 32
          // holes under the head and swung 0 times from them (the climb out for the sword wanted 12 health, two blocks and no cloud
          // on the rim; dragon-311 (25592, 12:19 to 12:43Z) dug five at 2.7 to 13.6 health, 0 swings each, the dragon 127 to 108 to
          // arrows alone). Three jumps without a strike, and the climb out below is tried as before.
          if (gap <= 4.4 && !roofed()) {
            let struck = false; jumps = (jumps || 0) + 1;
            bot.setControlState?.('jump', true);
            try {
              for (let n = 0; n < 12 && !struck; n++) { await sleep(50); check(); const h = live(bot, dragon) && perchedHead(bot, dragon); if (h && canStrike(bot, h)) { if (typeof bot.lookAt === 'function') await bot.lookAt(h.position.offset(0, .5, 0), true); bot.attack(h); swings++; jumpSwings++; struck = true; } }
            } finally { bot.setControlState?.('jump', false); }
            if (struck) { for (let n = 0; n < 5; n++) { check(); await sleep(100); } continue; }
            if (jumps < 3) { await sleep(150); continue; }
            if (!(state.jumpSaidAt > Date.now() - 20000)) { state.jumpSaidAt = Date.now(); console.log(`[end combat] the jump for the head from the hole at ${bot.entity.position.floored()}: ${jumps} jumps, the head ${Math.round(gap * 10) / 10} from the eyes on the floor, none within the sword's three at the apex`); }
          }
          if (gap <= 5 && blocksCarried(bot) >= 2 && actions.dig && bot.health >= 12 && !cloudOnRim) {
            const cell = bot.entity.position.floored();
            console.log(`[end combat] the head ${Math.round(gap * 10) / 10} from the eyes in the hole, out of the sword's three: up onto the rim for it`);
            if (await outOfTheHole()) {
              let up = 0;
              try { await strikeWhilePerched(12000); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; }
              up = (state.headSwings || 0);
              // Back in: the two blocks laid to climb out dug again, dropping in.
              const f2 = bot.entity.position.floored();
              if (f2.x === cell.x && f2.z === cell.z) { for (const dy of [1, 2]) { check(); try { await actions.dig(bot, task, f2.offset(0, -dy, 0), { requireDrops: false, dropInto: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; break; } } for (let i = 0; i < 20 && Math.floor(bot.entity.position.y) > f2.y - 2; i++) await sleep(50); if (Math.floor(bot.entity.position.y) <= f2.y - 2) { state.hole = { x: f2.x, y: f2.y - 2, z: f2.z, at: Date.now() }; save(); } }
              console.log(`[end combat] back ${holeHere() ? 'in the hole' : 'on the ground, the hole not dug again'} at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health, ${up} swings this fight`);
              if (!holeHere()) break;
              continue;
            }
          }
        } else if (ever && Date.now() - lastSeen > 4000) break;
        else if (!ever && ![2, 3, 5, 6, 7].includes(metadata(bot, dragon, 'phase')) && Date.now() - lastSeen > 15000) break;
        else if (!roofed() && !perched(bot, dragon)) await roofHole(true);
        await sleep(100);
      }
      if (swings) { state.headSwings = (state.headSwings || 0) + swings; const t = state.holeHead ||= { tries: 0, dugIn: 0, swings: 0 }; t.swings += swings; save(); }
      if (swings) console.log(`[end combat] from the hole: ${swings} swing${swings === 1 ? '' : 's'} at the head (${jumpSwings} at a jump's apex, ${jumps} jump${jumps === 1 ? '' : 's'}), ${landed} landed by the dragon's health`);
      if (jumps) { state.holeJumps = (state.holeJumps || 0) + jumps; state.holeJumpSwings = (state.holeJumpSwings || 0) + jumpSwings; }
      return swings;
    };
    // In the hole: the wait is its own option, said; every other option climbs out first (the dispatch below). The head in reach is struck from it (note 1618).
    if (holeHere()) tree.stay_in_hole = { description: { dragonSitting: sitsSays(), action: `Stay in the hole another second: two deep in the ground, below the dragon's wings and the breath's cloud; the fountain ${Math.round(byFountain)} blocks off, the way out two blocks laid${head && canStrike(bot, head) ? '; the perched head is within the sword\'s reach from here and is struck for as long as it sits' : head ? `; the perched head is ${Math.round(head.position.distanceTo(bot.entity.position.offset(0, 1.62, 0)) * 10) / 10} from the eyes, out of the sword's three` : ''}`, health: bot.health, dragonPerched: !!(dragon && perched(bot, dragon)), dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null, headSwingsFromHoles: state.holeHead?.swings || 0, healing: healingSays(crystals.length),
      // The cloud over the hole's mouth said (note 1727): the body under it is out of its half-block slab, the way out is through it. 25588 (dragon-271, 2026-10-15 11:47Z, one crystal broken) stood in its hole at (-29, 58, -28) under a fireball's cloud at 61, took move_-3,-6, climbed up into it, 13.5 to none.
      ...(() => { const p = bot.entity.position; const c = Object.values(bot.entities).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position.y > p.y + 1.8 && e.position.y <= p.y + 4.5 && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 0.5); return c ? { cloudAtTheMouth: `the breath's cloud lies over the hole at ${Math.round(c.position.y * 10) / 10}, ${Math.round(cloudRadius(bot, c) * 20) / 10} wide: its reach is a slab half a block high, so the body down here is out of it; a way out climbs through it at six a second, and the cloud lasts about thirty seconds from its burst` } : {}; })() },
      run: async () => { if (!(dragon && perched(bot, dragon)) && !roofed()) await roofHole(true); if (head && canStrike(bot, head)) { const n = await strikeFromHole(60000); console.log(`[end combat] from the hole at ${bot.entity.position.floored()}: ${n} swings at the perched head, dragon ${beforeDragon} to ${dragon && live(bot, dragon) ? Math.round(dragon.health ?? beforeDragon) : '?'}`); if (n) progress = true; return; } if (!(dragon && perched(bot, dragon)) && !roofed()) await roofHole(true); for (let n = 0; n < 10; n++) { check(); if (dragon && perched(bot, dragon)) break; await sleep(100); } } };
    {
      const sword = bot.inventory.items().find(i => /_sword$/.test(i.name) && durable(bot.registry, i));
      const phase = dragon && live(bot, dragon) ? metadata(bot, dragon, 'phase') : null;
      // And while it flies with no crystal standing (note 2203; Fable, 2026-10-26 12:15Z): the dragon comes down to the
      // fountain at the end of every circuit from then on, so the perch is the whole fight, and the hole dug beforehand is
      // the wait for it (stay_in_hole). dragon-313 (25592, 10:58 to 11:09Z) had 152 askings with no crystal standing and
      // the hole offered at none of them.
      const flying = phase !== null && ![2, 3].includes(phase) && !head && !crystals.length;
      const coming = phase !== null && !crystals.length && ([2, 3].includes(phase) || !!head || flying);
      const solid = c => bot.blockAt(c)?.boundingBox === 'block';
      const thickAt = f => !!f && [1, 2, 3, 4, 5, 6].every(dy => solid(f.offset(0, -dy, 0))) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => solid(f.offset(dx, -1, dz)) && solid(f.offset(dx, -2, dz))) && voidEdge(bot, f, 4) === null;
      if (actions.dig && sword && coming && !holeHere() && !onOwnPillar() && !onObsidianTop() && byFountain >= 4 && byFountain <= 30 && blocksCarried(bot) >= 2) {
        const ux = (bot.entity.position.x - centre.x) / byFountain, uz = (bot.entity.position.z - centre.z) / byFountain;
        // The bot's own cell when it stands 5.5 to 8.5 from the middle (note 1625): the sword reaches the head from a hole anywhere in that band (the eyes 1.4 under it, under 2.5 aside), and the walk to the cell at 7.2 passed through the breath's cloud, which lies before the head toward the player; 25588 (dragon-160, 2026-10-14 11:20 to 11:40Z) had the walk cut nine times and dug the hole under the head none.
        const here = bot.entity.position.floored();
        const cell = byFountain >= 5.5 && byFountain <= 8.5 ? { x: here.x, z: here.z } : { x: Math.floor(centre.x + ux * 7.2), z: Math.floor(centre.z + uz * 7.2) };
        let top = null; for (let y = Math.floor(bot.entity.position.y) + 3; y >= Math.floor(bot.entity.position.y) - 6 && top === null; y--) if (solid(new Vec3(cell.x, y, cell.z))) top = y;
        const feetAt = top === null ? null : new Vec3(cell.x, top + 1, cell.z);
        const walk0 = feetAt ? Math.round(feetAt.offset(.5, 0, .5).distanceTo(bot.entity.position)) : 99;
        // No walk into the landing (note 1623): the body comes down within seconds, and 25588 (dragon-159, 2026-10-14 11:07Z) took the hole under the head at 0.67 with the dragon landing 18 blocks off and a walk of 7, met the body on the way, four blows 20 to 6.4 and a throw of 25 blocks. Landing, the hole is dug where the body stands (wait_in_hole) unless the cell is within four.
        // And no walk in from the dragon's side (note 1635): the wings' boxes reach ten aside of the body and six fore and aft, and 25588 (dragon-164, 2026-10-14 12:47Z, one crystal broken) walked to its hole's cell from beside the perched dragon, was lifted at (3, 66, -9) nine blocks from the fountain and thrown, dead on the fall at 13.6. A walk is offered only from in front of the dragon (within 3 of its head's line, ahead of its middle); from anywhere else the hole is dug where the body stands or not at all.
        const axisH = dragon && live(bot, dragon) ? { x: Math.sin(dragon.yaw || 0), z: Math.cos(dragon.yaw || 0) } : null;
        const relH = axisH ? { x: bot.entity.position.x - dragon.position.x, z: bot.entity.position.z - dragon.position.z } : null;
        const frontOfIt = !axisH || (relH.x * axisH.x + relH.z * axisH.z > 0 && Math.abs(relH.x * axisH.z - relH.z * axisH.x) <= 3);
        // The walk into the landing is Jev's (note 2199), said with its seconds against the approach's: the cutoff at four
        // blocks (note 1623) left the bot with the dragon coming down and nothing but the bow and 'observe' to choose from.
        // dragon-313 (25592, 2026-10-26 10:38 to 11:09Z) saw the dragon come down to the fountain at 10:49, 10:53, 11:04
        // and 11:07 with every crystal gone, standing 8 to 24 blocks off, took shoot_dragon or a move each time, and in 31
        // minutes of fight struck the head from a hole once (dragon 200 to 186); 35 askings at a landing across the day's
        // dragon trials, the hole offered at none. The approach's seconds are this server's record (83 of them: 2 to 43 s,
        // 10 as a rule); the walk's are the blocks at a sprint and the two digs.
        const landing = [2, 3].includes(phase) && !head;
        if (thickAt(feetAt) && !solid(feetAt) && !solid(feetAt.offset(0, 1, 0)) && (walk0 === 0 || frontOfIt || landing || flying)) {
          const walk = walk0;
          const whyNow = flying ? (() => { const t = state.holeHead || { tries: 0, dugIn: 0, swings: 0 }, sh = state.dragonShots || { loosed: 0 }; const arrows = (state.shots || []).filter(x => x.target === 'ender_dragon' && Number.isFinite(x.dragonBefore) && Number.isFinite(x.dragonAfter)).reduce((n, x) => n + Math.max(0, x.dragonBefore - x.dragonAfter), 0);
            return `no crystal stands: the dragon comes down to the fountain at the end of every circuit from here on, and it is ${Math.round(Math.hypot(dragon.position.x - centre.x, dragon.position.z - centre.z))} blocks from the fountain now, ${dragon && live(bot, dragon) ? `at ${Math.round(dragon.health ?? beforeDragon)} health` : ''}; this fight it has come down ${state.landings || 0} time${state.landings === 1 ? '' : 's'}; from the hole 7 from the middle the perched head is within the sword's reach, and the hole dug now is the wait for the next landing. This fight: ${t.dugIn} hole${t.dugIn === 1 ? '' : 's'} dug under the head, ${t.swings} swing${t.swings === 1 ? '' : 's'} at it from one; ${sh.loosed || 0} arrow${sh.loosed === 1 ? '' : 's'} at the dragon took ${Math.round(arrows)} of its health.`; })() : null;
          const landingSays = landing ? `the dragon is coming down to land on the fountain, ${Math.round(Math.hypot(dragon.position.x - centre.x, dragon.position.z - centre.z))} blocks from its middle, ${Math.round((Date.now() - (state.landingSince || Date.now())) / 1000)} s into its landing approach; on this server's dragon trials the approach took 2 to 43 s before it sat, 10 as a rule (83 approaches); it sits on while a player is within 20 of it. The walk of ${walk} blocks at a sprint is about ${Math.round(walk / 5.6 * 10) / 10} s and the two digs about 2 s${walk > 4 ? `: met in the open by the body coming down the bot is thrown (dragon-159, 2026-10-14: a walk of 7 into the landing 18 blocks off met the body, four blows 20 to 6.4 and a throw of 25 blocks)` : ''}` : null;
          const t = state.holeHead || { tries: 0, dugIn: 0, swings: 0 };
          tree.hole_under_head = {
            description: { dragonSitting: sitsSays(), action: `${walk ? `Walk ${walk} blocks to the cell 7 from the fountain's middle on the bot's own side, dig` : `Dig`} two down ${walk ? '' : 'here, ' + Math.round(byFountain * 10) / 10 + ' from the fountain\'s middle, '}and strike the dragon's head for as long as it sits: sitting on the fountain with its belly at about 65, its head a block under its middle and 6.5 before it is 3.4 over the eyes of a body two deep, out of the sword's three, so the blows are struck from the hole's rim (two blocks laid, the body up on its cell) and the hole dug again when the dragon rises; the body in the hole is below the wings' boxes and the breath's cloud, the body on the rim is in the breath and the push (dragon-163, 2026-10-14: ten blows struck from the ground by the head at 20 to 17 health). The dig is two seconds; the way out two blocks laid. While the dragon flies a block is laid over the hole's mouth (its fireball bursts on it and the cloud lies above; a hole with its mouth open took a fireball's cloud, dragon-159), and taken off when it sits for the sword.`,
              dragonNow: head ? 'perched now' : flying ? 'flying, no crystal standing' : 'coming down to land now', ...(landingSays ? { landingNow: landingSays } : {}), ...(whyNow ? { whyNow } : {}), walkBlocks: walk,
              ...(walk > 0 ? { walkRecord: require('./landing-walk-record').says(bot) } : {}), holeBlocksFromFountain: 7, blocksFromFountain: Math.round(byFountain), health: bot.health, dragonHealth: beforeDragon, blocksCarried: blocksCarried(bot),
              headHitThroughArmourWorn: headHit(bot),
              // The breath's cloud on the ground at the hole's cell or where the bot stands said (note 2050): the walk and the dig two down are in it, about six a second. full-3 (2026-10-23 21:44Z, dragon 185) took hole_under_head beside a cloud 7 wide 1.4 off at its feet's level, 20 to 0.8 in the dig, and died.
              // The cloud under a stub counted too (note 2231): from two blocks up out of a cloud the hole's cell lies two below the
              // feet and the dig goes back down into it; dragon-331 (25589, 2026-10-26 15:54Z) climbed two up out of a cloud at
              // (-7, 61, -1), took hole_under_head at that cell twice, dug down into the cloud each time, 16.7 to 4.7 and 9.7 to none.
              ...(() => { const near = [feetAt.offset(.5, 0, .5), bot.entity.position].map(p => Object.values(bot.entities || {}).filter(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position && e.position.y >= Math.min(p.y, feetAt.y) - 1 && e.position.y <= Math.max(p.y, feetAt.y) + 1 && Math.hypot(e.position.x - p.x, e.position.z - p.z) <= cloudRadius(bot, e) + 1.5)).flat()[0];
                return near ? { breathCloudThere: `the breath's cloud lies on the ground ${Math.round(Math.hypot(near.position.x - bot.entity.position.x, near.position.z - bot.entity.position.z) * 10) / 10} from the bot at the feet's level, ${Math.round(cloudRadius(bot, near) * 20) / 10} wide, over the way to the hole or the hole's cell: the walk and the two blocks dug are in it at about six health a second, and a cloud lasts about thirty seconds from its burst` } : {}; })(),
              healing: healingSays(crystals.length), ...(crystals.length ? { withCrystalsStanding: headWithCrystalsRecord } : {}), perchRule: 'the dragon stays at its perch only while a player stands within 20 blocks of it; alone there five seconds, it takes off',
              fromHolesThisFight: (() => { const t = state.holeHead || { dugIn: 0, swings: 0, landed: 0 }; return `${t.dugIn} hole${t.dugIn === 1 ? '' : 's'} dug under the head this fight, ${t.swings} swing${t.swings === 1 ? '' : 's'} at it from them, ${t.landed || 0} landed by the dragon's health`; })(),
              // The record cut to this server's own (note 2224; Fable's trim by the 2185 rule): the 10-14 drills and runs ran 900 characters on every offer.
              record: `This server: ${require('./landing-walk-record').says(bot)}. From holes this fight: ${t.tries} tr${t.tries === 1 ? 'y' : 'ies'}, ${t.dugIn} dug in, ${t.swings} swing${t.swings === 1 ? '' : 's'} at the head.` },
            run: async () => {
              const tally = state.holeHead ||= { tries: 0, dugIn: 0, swings: 0 }; tally.tries++;
              if (walk > 0 && dragon && live(bot, dragon)) require('./landing-walk-record').begin(bot, { walk, phase });
              goal.step = { action: 'hole_under_head', at: { x: feetAt.x, y: feetAt.y, z: feetAt.z } }; save();
              try { await actions.navigate(bot, task, new goals.GoalBlock(feetAt.x, feetAt.y, feetAt.z), { timeoutMs: 9000, stallMs: 2500, sprint: true }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
              const feet = bot.entity.position.floored();
              if (Math.abs(feet.x - feetAt.x) > 1 || Math.abs(feet.z - feetAt.z) > 1) throw new Error(`The hole's cell at (${feetAt.x}, ${feetAt.z}) was not reached: the body at ${feet}`);
              { const c = Object.values(bot.entities || {}).find(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position && e.position.y >= feet.y - 2.5 && e.position.y <= feet.y + 0.5 && Math.hypot(e.position.x - feet.x - .5, e.position.z - feet.z - .5) <= cloudRadius(bot, e) + 1);
                if (c) throw new Error(`The breath's cloud lies at the hole's level at ${c.position.floored()}, ${Math.round((feet.y - c.position.y) * 10) / 10} below the feet: the dig down would put the body in it`); }
              if (!thickAt(feet)) throw new Error(`The ground at ${feet} is not the hole's: thin, open beside, or the void within four`);
              if (!await dryTheHoleCell(feet)) throw new Error('Water stands beside the hole\'s cell');
              await centreOn(feet.x, feet.z, 0.12);
              for (const dy of [1, 2]) { check(); state.diggingHole = Date.now(); await actions.dig(bot, task, feet.offset(0, -dy, 0), { requireDrops: false, dropInto: true }); }
              for (let i = 0; i < 30 && Math.floor(bot.entity.position.y) > feet.y - 2; i++) await sleep(50);
              const fNow = bot.entity.position.floored();
              const inIt = Math.floor(bot.entity.position.y) <= feet.y - 2 && fNow.x === feet.x && fNow.z === feet.z;
              console.log(`[end combat] ${inIt ? 'in the hole under the head' : 'not down into the hole under the head'} at ${bot.entity.position.floored()}, ${Math.round(Math.hypot(bot.entity.position.x - centre.x, bot.entity.position.z - centre.z) * 10) / 10} from the fountain's middle${inIt ? '' : ': the body still on the rim'}`);
              if (!inIt) throw new Error('The body did not go down into the hole');
              state.hole = { x: feet.x, y: feet.y - 2, z: feet.z, at: Date.now() }; tally.dugIn++; save();
              const n = await strikeFromHole(90000);
              console.log(`[end combat] from the hole under the head at ${bot.entity.position.floored()}: ${n} swings, dragon ${beforeDragon} to ${dragon && live(bot, dragon) ? Math.round(dragon.health ?? beforeDragon) : '?'}, ${bot.health.toFixed(1)} health`);
              progress = true;
            } };
        }
      }
    }
    // Under the island's rock with a pickaxe (note 1488): the way up to the sky,
    // the blocks over the head dug and the column laid under the feet
    // (pillarUp with end stone diggable). 25588 (dragon-66, 2026-10-13 16:30Z)
    // quarried itself into tunnels four to fourteen blocks under the island's
    // top, and from there every pillar's foot was 'not reached'; the fight's
    // options had no way out.
    {
      const feet = bot.entity.position.floored();
      // Rock, not the roof the column lays over the head (note 1490): three solid blocks or more in the thirty above, and not on the bot's own column or an obsidian top. 25588 (dragon-67, 2026-10-13 16:45Z) was offered the dig to the sky on its column under its own roof, and the least bad took it four times.
      let rock = 0, solidAbove = 0; for (let dy = 1; dy <= 30; dy++) if (bot.blockAt(feet.offset(0, dy, 0))?.boundingBox === 'block') { rock = dy; solidAbove++; }
      const pick = bot.inventory.items().find(i => /_pickaxe$/.test(i.name));
      // Not under the bot's own column (note 1871): the roofs it laid coming down, one every third block, are the 'rock' over the head, and the dig to the sky climbs the whole column again. 25588's dragon-224 (2026-10-18 17:02 to 17:04Z, two crystals) came down from 88 to its foot hole at (-10, 60, -37), 20 to 9.5, took 'dig_to_sky', went up its own column to 91, came down the column from 91 to 82 under the breath, took 'dig_to_sky' again to 94, and died at 88.
      const u = bot._pillarUp, ownColumnAbove = (!!u && u.x === feet.x && u.z === feet.z) || (!!state.lastStub && state.lastStub.x === feet.x && state.lastStub.z === feet.z && Date.now() - (state.lastStub.at || 0) < 20 * 60000);
      // Not up an old column (note 1900): rock that reaches past 72 is a column the bot built, the island's own stone ending lower, and the dig to the sky climbed it. 25588's dragon-270 (2026-10-19 07:56Z, five crystals) at (-36, 70, -29) under an earlier climb's column took dig_to_sky to 95, stood on its top with only moves and observe offered, and died there; note 1871 had caught only the column of the moment.
      const columnAbove = feet.y + rock + 1 > 72;
      if (rock >= 2 && solidAbove >= 3 && !onOwnPillar() && !onObsidianTop() && !ownColumnAbove && !columnAbove && pick && actions.dig && blocksCarried(bot) >= 1) {
        const skyY = feet.y + rock + 1;
        // The breath's cloud over the column said, and the climb held under it (note 2040, as note 2033 for the climb at a pillar's foot): the cloud hurts only what its half-block box touches (note 1889's drill), so the body under the rock is out of it and the dig up rises into it. full-2 (2026-10-23 04:14Z, dragon 197, six crystals standing) in its hole at (15, 61, 9) under a cloud at 63, 6.4 wide, took dig_to_sky at 8.9 health with nothing said of the cloud, and died climbing into it.
        const cloudSays = c => `the breath's cloud lies ${Math.round((c.position.y - bot.entity.position.y) * 10) / 10} over the feet above this column, ${Math.round(cloudRadius(bot, c) * 20) / 10} wide: its reach is a slab half a block high, so the body down here under the rock is out of it, and the dig up rises into it at about six health a second; a cloud lasts about thirty seconds from its burst`;
        const over = cloudOverClimb(bot, rock + 2);
        tree.dig_to_sky = { description: { action: `The bot stands under the island's rock, ${rock} blocks of it over its head to the open sky at ${skyY}: dig up to the sky, the blocks over the head dug with the ${pick.name.replace('_', ' ')} and the column laid under the feet from the ${blocksCarried(bot)} blocks carried. No pillar's foot is walked to from down here.${over ? ` Now ${cloudSays(over)}; the climb waits under the rock while it lies there.` : ''}`,
          rockOverhead: rock, blocksCarried: blocksCarried(bot), health: bot.health },
          run: async () => {
            { const c = cloudOverClimb(bot, rock + 2); if (c) { console.log(`[end combat] dig_to_sky held at ${bot.entity.position.floored()}: ${cloudSays(c)}; the climb left to the next question`); return; } }
            const pr = require('./pillar-recovery');
            goal.step = { action: 'dig_to_sky', from: { ...bot.entity.position }, to: skyY }; save();
            await pr.pillarUp(bot, task, skyY, { dig: actions.dig, maxBlocks: rock + 2, threats: false, canDig: b => !!b && b.diggable && b.name !== 'bedrock' && b.name !== 'obsidian' });
            if (Math.floor(bot.entity.position.y) >= skyY - 1) { progress = true; delete bot._pillarUp; }
            else throw new Error(`The way up stopped ${skyY - Math.floor(bot.entity.position.y)} short of the sky`);
          } };
      }
    }
    // Not in the bot's own pocket on its column (note 1579): its ways out are the drop through the pool side's wall and the dig down, both offered; opening the roof is the fireball's way in. 25588 (dragon-127, 2026-10-14 05:13Z) took open_walls at 0.55 in its pocket under the breath and died at 77.
    if (box && !onColumnCell() && !tree.shoot_dragon && !Object.keys(tree).some(k => /^(crystal_|move_|strike_head|bed_bomb)/.test(k))) {
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
            // The steps cover the cells already laid and the stretch (note
            // 1433): the span walks what stands before it lays, and with
            // twelve steps for twelve blocks a span twelve long is walked to
            // its end and nothing laid. 25588 (dragon-6 to dragon-17,
            // 2026-10-13) stood on the entry platform of mid-243-ma-end-3 with
            // its span of twelve to (91, 48, 5), the island's stone two blocks
            // on at (89, 48, 8), and walked the span out and back every ten
            // seconds, "changed nothing", until the dragon knocked it off.
            const placed = await bridging.bridgeTo(bot, task, new Vec3(to.x, Math.floor(here.y), to.z), { maxBlocks: STRETCH, maxSteps: spanSteps(here, to, STRETCH) });
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
    // Beside the run under the head it is a choice even where the bot does
    // not stand safe (note 1405): with the run the only way offered, the
    // dragon stage of 2026-10-07 (25588, 20:38:58Z) went under a dragon 18
    // seconds into its perch and was thrown to its death as it took off.
    if ((safe || tree.under_head) && dragon) tree.observe = {
      description: { dragonSitting: sitsSays(), action: 'Wait one second without attacking or moving',
        health: bot.health, canRegenerate: bot.health < 20 && bot.food >= 18,
        usefulAttackAvailableNow: !!tree.shoot_dragon || !!tree.strike_head || crystals.some(c => tree[`crystal_${c.id}`]),
        dragonPhase: metadata(bot, dragon, 'phase'), pausesWithoutProgress: state.idleObservations || 0,
        // Said where the wait is on the bot's own column or a pillar's top (note 1566): the dragon's pass there is its body, and the wait at 95 cost 25588 its life. dragon-114 (2026-10-14 03:27Z, six crystals broken) waited twice at 6.5 to 8.3 health on crystal 119's column top with no bucket and no pool, took two blows of the pass (9.8 to 4.6) and was flung 32 blocks down; dragon-112 (02:39Z) the same at 71, carried 30 blocks.
        // Said when the body is walled in and roofed (note 1723): the stub walled out of sight (note 1721) was left at once for a move into the open, and the next cloud built the next one nine blocks dearer; 25588 (dragon-266, 2026-10-15 11:0xZ) walled five stubs in fifteen minutes, three of them left within seconds for move_4,-2, move_-3,3 and move_-4,3 (none_good 0.48, observe 0.14), 31 blocks to 16.
        ...((() => { const g = bot.entity.position.floored(), sd = c => bot.blockAt(c)?.boundingBox === 'block'; return sd(g.offset(0, 2, 0)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => sd(g.offset(dx, 1, dz))); })() ? { sealedHere: `walled on four sides at the head and roofed at ${bot.entity.position.floored()}: out of the dragon's sight, and the dragon throws its fireballs only at a body it sees (a fireball bursting within four blocks puts its cloud on the body: five deaths on stubs before the walls); a way out digs the walls and leaves their blocks, and the next cloud's stub costs nine more` } : {}),
        ...((onOwnPillar() || onObsidianTop()) ? { ...(stubRecordSays() ? { stubRecord: stubRecordSays() } : {}), standingHere: `on ${onObsidianTop() ? 'a pillar\'s top' : 'the bot\'s own column'} at ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.y) - 62} over the island, where the dragon's pass is its body and the breath: 25588 waited so twice today and was carried off both times, 30 blocks (dragon-112, 02:39Z) and 32 (dragon-114, 03:27Z, at 6.5 health), dead; the ways down are the dig (pillar_down, about a second and a half a block) and the drop into a pool where one lies` } : {}) }, run: async () => {
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
    // Off an obsidian pillar's top, where a blow at its crystal left the bot
    // (note 1414): back to the bot's own column and down it. The drill of
    // 2026-10-13 (04:14Z) stood on the top after its blow, 36 up, offered
    // only moves about the top.
    // The water left standing, walked back to for the bucket (note 1572): the
    // step's own walk-back reaches sixteen blocks, and 25588 (dragon-120,
    // 2026-10-14 04:05Z) left its pool at (-36, 61, 19), fought an enderman,
    // walked off to crystal 88 and climbed it with both buckets empty, 'no
    // water bucket carried' at the top. Offered on the ground whenever the
    // water is carried in no bucket and lies somewhere within sixty.
    if (!onOwnPillar() && !onObsidianTop() && countOf(bot, 'water_bucket') === 0 && countOf(bot, 'bucket') > 0 && Array.isArray(state.poolsLeft) && state.poolsLeft.length) {
      state.poolsLeft = state.poolsLeft.filter(w => Date.now() - w.at < 20 * 60000 && bot.blockAt(new Vec3(w.x, w.y, w.z))?.name === 'water');
      const here = bot.entity.position, w = state.poolsLeft.map(w => ({ w, d: here.distanceTo(new Vec3(w.x + .5, w.y, w.z + .5)) })).filter(x => x.d <= 60).sort((a, b) => a.d - b.d)[0];
      if (w) tree.take_back_water = {
        description: { action: `Walk ${Math.round(w.d)} blocks to the water left standing at (${w.w.x}, ${w.w.y}, ${w.w.z}) and take it back into the empty bucket: no water is carried now, so no pool can be poured at the next pillar's foot and the way down from its top is the dig, a minute or more on the column; the walk is out in the open with the dragon's passes and breath about it (${Math.round(w.d / 4.3)} seconds or so)`,
          blocksOff: Math.round(w.d), emptyBuckets: countOf(bot, 'bucket'), health: bot.health, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(here)) : null },
        run: async () => {
          const p = new Vec3(w.w.x, w.w.y, w.w.z);
          goal.step = { action: 'take_back_water', to: { x: p.x, y: p.y, z: p.z }, blocks: Math.round(w.d) }; save();
          try { await actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 25000, stallMs: 5000 }); } catch (err) { if (['Cancelled', 'Blocked', 'EndEmergency', 'NeedsAir'].includes(err.name)) throw err; }
          const eye = bot.entity.position.offset(0, 1.62, 0);
          if (eye.distanceTo(p.offset(.5, .5, .5)) > 4.3) throw new Error(`The water at ${p} was not reached: ${Math.round(bot.entity.position.distanceTo(p.offset(.5, 0, .5)))} blocks off`);
          const { fillWaterBucket } = require('./water');
          await fillWaterBucket(bot, task, p, { timeoutMs: 1500 });
          const full = countOf(bot, 'water_bucket');
          console.log(`[end combat] the water left at ${p} taken back into the bucket (${full} full carried)`);
          state.poolsLeft = state.poolsLeft.filter(x => x !== w.w); if (state.pool && state.pool.x === p.x && state.pool.z === p.z) delete state.pool; save();
          if (!full) throw new Error(`The water at ${p} did not go into the bucket`);
          progress = true;
        } };
    }
    if (onObsidianTop() && bot._pillarUp) tree.pillar_top_down = {
      description: { action: `Walk back to the bot's own pillar at the top's edge, ${Math.round(Math.hypot(bot._pillarUp.x + .5 - bot.entity.position.x, bot._pillarUp.z + .5 - bot.entity.position.z))} blocks off, and dig down it a block at a time from under the feet to the island: no fall on the way`, health: bot.health, dragonHealth: beforeDragon },
      run: async () => { if (!await backToColumn()) throw new Error('The bot\'s own column was not reached from the pillar\'s top'); await digDownColumn(); } };
    // Down its own pillar, a block at a time from under the feet (note
    // 1344): on top of one laid for a throw, the footing is a block wide and
    // nothing else is offered, and the drill of 2026-10-06 (04:16Z) held on
    // top of a 35-block pillar.
    // The bot's pillar is the column under its feet (onOwnPillar, note 1418),
    // not the cell last recorded: a cell off it, 25588 (dragon-7, 2026-10-13
    // 05:50Z) read no pillar of its own 35 up, dropped the record, and was
    // left to the stall's moves and the dragon's blow.
    const ownPillar = onOwnPillar();
    if (ownPillar && actions.dig) {
      const feet = bot.entity.position.floored();
      // The column's depth is its height over the island (note 1446): its
      // blocks and the gaps between them (note 1434) down to the first block
      // that is not the column's. End stone is the column's above the island
      // (note 1438). Counted only through its own blocks, a column with a
      // gap or laid in end stone was 'depth 1', no way down was offered, and
      // 25588 (dragon-27, 2026-10-13 09:24Z), crystal 76 broken, stood 'only
      // observe' on its column at 79 until the dragon knocked it off.
      let depth = 0, gap = 0;
      for (; depth < 64; depth++) {
        const c = feet.offset(0, -1 - depth, 0), b = bot.blockAt(c), name = b?.name || '';
        if (b?.boundingBox !== 'block') { if (++gap > 6) break; continue; }
        gap = 0;
        if (!SCAFFOLD_UNDER.test(name)) break;
        // The sides read from one under the block (note 1581): the pocket's posts (note 1575) stand beside the block under the feet, and with them every side read 'solid within three', the column's end stone read as the island's, and 25588 (dragon-129, 2026-10-14 05:35Z) on its column at 88 had no pillar_down, 'only observe'.
        // With the column's base on its record (note 1610), the island begins below the base and the sides are not read: a lower pocket's walls beside the column read as the island's ground, and 25588 (dragon-150, 2026-10-14 09:08Z) had 'depth 0' between its pockets at 72 and 77.
        const base = bot._pillarUp && bot._pillarUp.until > Date.now() && bot._pillarUp.x === feet.x && bot._pillarUp.z === feet.z ? bot._pillarUp.base : null;
        if (base != null) { if (c.y < base) break; continue; }
        if (name === 'end_stone' && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => { for (let dy = 1; dy <= 3; dy++) if (bot.blockAt(c.offset(dx, -dy, dz))?.boundingBox === 'block') return true; return false; })) break;
      }
      depth -= gap;
      if (!SCAFFOLD_UNDER.test(bot.blockAt(feet.offset(0, -1, 0))?.name || '')) depth = 0;
      // The island's own end stone is no pillar of the bot's (note 1351): the
      // drill of 2026-10-06 (05:52Z on) was offered this on the ground 755
      // times, each changing nothing.
      // Not on the pillar's top (note 1493): standing on the obsidian, the
      // bedrock or the cage's bars after the blow, the column is beside the
      // body, not under it, and the record is the way back to it. 25588
      // (dragon-68, 2026-10-13 17:08Z, crystals 12 and 90 broken) struck 90
      // from the top, had its record dropped on the obsidian at (-13, 79, 37),
      // 'column undefined', and stood 'only observe' with no way down.
      const underName = bot.blockAt(feet.offset(0, -1, 0))?.name || '';
      // Dropped only on the island's own ground (note 1527): on air at the top's rim, the body's middle over the edge, the record is still the way back. 25588 (dragon-87, 2026-10-13 21:51Z, two crystals broken) stood 'on air' at (-17, 88, -37) after the blow, 'column undefined', 'only observe' nine times.
      if (depth < 1 && underName === 'end_stone' && feet.y < 70) delete bot._pillarUp;
      // The drop beside the dig (note 1572): on the column after the blow the
      // way down was asked as 'observe or pillar_down' when the blow's run was
      // cut short before its own way down, and 25588 (dragon-120, 2026-10-14
      // 04:03Z, crystal 104 broken) dug 22 blocks down at (-36, 85, 21) with
      // its pool poured two blocks from the foot, a minute on the column for a
      // second's step. Offered wherever the dig is, with the side, the fall
      // and what lies under it.
      if (depth >= 2 && onOwnPillar()) {
        const side = waterDropSide(), water = countOf(bot, 'water_bucket');
        // The pool's side walled by the pocket's own blocks (notes 1575, 1577): offered still, the wall dug first.
        const walled = side?.clearFirst && state.pool && Date.now() - state.pool.at < 15 * 60000 ? { dx: state.pool.dx, dz: state.pool.dz, fall: Math.max(0, Math.floor(bot.entity.position.y) - state.pool.y), edge: { x: bot._pillarUp.x + state.pool.dx, z: bot._pillarUp.z + state.pool.dz }, pool: true, cells: side.clearFirst.length } : null;
        if (side && (walled || (!side.clearFirst && (water || side.pool)))) {
          const s0 = walled || side;
          // Not offered where the drop itself refuses (note 1714): a fall whose dry landing would take the health, no pool under it. 25588 (dragon-255, 2026-10-15 09:30Z, two crystals broken) took water_drop on crystal 90's column at 90, 'a fall of 29 blocks takes about 26 health and the body has 17.3 ... 11 dug first', refused, and chose it again, 21 passes in a second, until the dragon's body threw it off the top.
          // Nor where a cloud lies under the drop's way (note 1722): waterDrop refuses a drop with the breath's cloud within the fall under the feet and no pool ('no water drop ... the breath's cloud lies 2 blocks below the feet'). 25588 (dragon-265, 2026-10-15 10:3x to 10:48Z, one crystal broken) took water_drop and observe by turns 91 times in a spin at (10, 69, 2) and (6, 64, -8), each refused so.
          const landY0 = Math.floor(bot.entity.position.y) - s0.fall, land0 = new Vec3(s0.edge.x + .5, landY0, s0.edge.z + .5);
          const cloudInTheWay = (!s0.pool && !!cloudUnderfoot(s0.fall + 1)) || Object.values(bot.entities).some(e => e.name === 'area_effect_cloud' && e.isValid !== false && Math.abs(e.position.y - landY0) <= 2.5 && Math.hypot(e.position.x - land0.x, e.position.z - land0.z) <= cloudRadius(bot, e) + 1.5);
          if ((!s0.pool && s0.fall - 3 >= bot.health - 1) || cloudInTheWay) { /* refused by waterDrop */ } else {
          const dir = s0.dx === 1 ? 'east' : s0.dx === -1 ? 'west' : s0.dz === 1 ? 'south' : 'north';
          tree.water_drop = {
            description: { action: `${walled ? `Dig the ${walled.cells} blocks of the bot's own pocket on the column's ${dir} side (a second or two), then step` : 'Step'} off the column's ${dir} edge, ${s0.fall} blocks down onto the island at (${s0.edge.x}, ${s0.edge.z})${s0.pool ? ', into the pool poured at the foot: the landing in water takes nothing' : `, no pool under it: the bucket is clicked under the body in the last blocks of the fall, a click the server refuses about one time in three, and a dry landing takes about ${Math.max(0, s0.fall - 3)}`}; a second or two, against the dig's ${Math.round(depth * 1.5)} seconds on the column where the breath and the passes land; the column's ${depth} blocks stay standing, ${blocksCarried(bot)} carried at the foot against about ${blocksCarried(bot) + depth} dug down (the climb out of a cloud is two, a pillar to a crystal ${depth} or more, and quarrying is cut short by each pass)`,
              fall: s0.fall, blocksCarried: blocksCarried(bot), blocksIfDugDown: blocksCarried(bot) + depth, pool: !!s0.pool, walled: !!walled, waterBuckets: water, health: bot.health, dragonHealth: beforeDragon },
            run: async () => {
              goal.step = { action: 'water_drop_chosen', from: { ...bot.entity.position }, fall: (walled || side).fall }; save();
              if (!await waterDrop({ inCloud: breathThreat(bot)?.name === 'area_effect_cloud' })) throw new Error('The water drop was not taken: no side with ground under it, or the fall too long for the health with no pool');
            } };
          }
        }
      }
      // Not offered while the dig would stop at once (note 1720, as note 1714 for the drop): with a cloud within two under the feet and the body out of it, digDownColumn stops before the first block ('the dig down stops ... the breath's cloud lies 1.4 blocks below'). 25588 (dragon-262, 2026-10-15 09:58 to 10:02Z, one crystal broken) on a column's top at (-13, 81, 36) took pillar_down and dug nothing again and again, 21 passes a second, 17 spins, until the dragon's body struck it there, 7 to none.
      const digStopsNow = breathThreat(bot)?.name !== 'area_effect_cloud' && !!cloudUnderfoot(2);
      if (depth >= 2 && !digStopsNow) tree.pillar_down = {
        description: { action: `Dig down the bot's own pillar a block at a time from under the feet, ${depth} blocks to its foot: no fall on the way, and the pillar's blocks come back into the pack (${blocksCarried(bot)} carried now, about ${blocksCarried(bot) + depth} at the foot)${cloudUnderfoot(depth) ? `; ${cloudUnderfootSays(cloudUnderfoot(depth))}` : ''}`, blocks: depth, blocksCarried: blocksCarried(bot), blocksAtTheFoot: blocksCarried(bot) + depth, health: bot.health, dragonHealth: beforeDragon, ...(cloudUnderfoot(depth) ? { ...(stubRecordSays() ? { stubRecord: stubRecordSays() } : {}), breathAtTheFoot: true } : {}) },
        run: async () => {
          // The column's own way down (digDownColumn): a gap under the block filled, end stone counted, the dragon's pass held through (notes 1434, 1438, 1440).
          await digDownColumn({ limit: depth });
          // The record kept when the dig did not come down (note 1712): 25588 (dragon-254, 2026-10-15 09:23Z) was 'down the column: 0 dug, now at (35, 83, -27)' on its own column beside crystal 92's cage, the record dropped, 'column undefined', and 'only observe' seven times on the top at 82 until the breath and the body came.
          { const u = bot._pillarUp; if (!u || u.base == null || Math.floor(bot.entity.position.y) <= u.base + 2) delete bot._pillarUp; }
        } };
    }
    // Out of the water before the hold (note 1776): in water nothing is offered (no climb, no dig, no tunnel, no quarry), the tree is empty, and the hold stood the body still in its landing pool under the fireballs. 25588's dragon-142 (2026-10-17 17:00 to 17:02Z, one crystal broken) landed its drop in the clutch's water at (-15, 61, 36) at 14 health and held 'end_hold' there 81 s with no question asked and no response, two clouds on it, dead at 17:02:14Z. The water is taken back into the bucket where it can be, or the body steps to the nearest dry cell.
    // Back into the hole from a stub over it (note 1796): the body that came 'up out of the hole' three blocks for a step that failed stands on its own stub with the hole's cavity under it, no hole, no tunnel (no ground four thick under the feet) and no climb to offer, and 'only observe' for minutes; 25588's dragon-165 (2026-10-17 22:3xZ, one crystal, 160 blocks) stood so at (35, 60, 22) with every walk 'no path'. The stub's blocks are dug from under the feet into the cavity, the pack keeping them, and the hole roofed again.
    {
      const f = bot.entity.position.floored(), under = bot.blockAt(f.offset(0, -1, 0));
      const cavity = [2, 3, 4].find(dy => bot.blockAt(f.offset(0, -dy, 0))?.boundingBox !== 'block');
      // Not into a hole the cloud lies over (note 1883): the stub stands two over the breath, and the hole under it is in the breath. 25588's dragon-231 (2026-10-18 18:51Z) on its stub at (53, 55, 7) over a cloud 7 wide took 'back_into_the_hole' to (53, 53, 7), 20 to 14.4 in it, and climbed the stub again. The hole is offered when no cloud lies within its radius of the stub at the hole's own height.
      const cloudAtTheHole = cavity ? Object.values(bot.entities).some(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position.y <= f.y - 0.5 && e.position.y >= f.y - cavity - 0.5 && Math.hypot(f.x + .5 - e.position.x, f.z + .5 - e.position.z) <= cloudRadius(bot, e) + 0.5) : false;
      if (actions.dig && pickCarried() && bot.entity.onGround && !inWater() && under && SCAFFOLD_UNDER.test(under.name) && cavity && !tree.pillar_down && !holeHere() && !inTunnel() && !cloudAtTheHole) {
        tree.back_into_the_hole = {
          description: { action: `Dig the stub's ${cavity - 1} block${cavity - 1 === 1 ? '' : 's'} from under the feet back into the hole below (about a second each, the blocks kept) and roof it: from the hole the tunnel to a crystal's foot is to be had, from this stub nothing is (every walk from here found no path).`, stubBlocks: cavity - 1, blocksCarried: blocksCarried(bot), health: bot.health, dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null },
          run: async () => {
            goal.step = { action: 'back_into_the_hole', blocks: cavity - 1 }; save();
            const t0 = Date.now(); let dug = 0;
            for (let d = 0; d < cavity - 1; d++) { const y0 = Math.floor(bot.entity.position.y), u = new Vec3(f.x, y0 - 1, f.z), b = bot.blockAt(u); if (!b || b.boundingBox !== 'block' || !SCAFFOLD_UNDER.test(b.name)) break; await actions.dig(bot, task, u, { requireDrops: false, dropInto: true, openPit: true }); dug++; for (let i = 0; i < 30 && Math.floor(bot.entity.position.y) >= y0; i++) await sleep(50); for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50); }
            let roofed = false; try { roofed = await roofHole(true); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
            const g = bot.entity.position.floored(); if (dug) { state.hole = { x: g.x, y: g.y, z: g.z, at: Date.now() }; save(); }
            console.log(`[end combat] back into the hole from the stub at (${f.x}, ${f.z}): ${dug} dug, ${roofed ? 'roofed' : 'not roofed'}, now at ${g}, ${blocksCarried(bot)} blocks, ${Math.round((Date.now() - t0) / 100) / 10} s`);
            if (dug) progress = true;
          } };
      }
    }
    // The hole within reach walked back into (note 1812): a hole dug and left stays the body's cover, and 25588's dragon-180 (2026-10-18 01:49Z) left its four-sided hole at (35, 59, 16) for a cloud at the rim and never went back: a stub, a three-block drop with no pool, a hole begun on open ground a block from it, and the next fireball's cloud on the body there, 20 to 14 to 9 to none. Note 1796 covers the stub over the hole; this the hole a few blocks off.
    if (!tree.back_into_the_hole && state.hole && Date.now() - state.hole.at < 120000 && !holeHere() && !inTunnel() && bot.entity.onGround && !inWater() && !onOwnPillar() && !onObsidianTop()) {
      const h = state.hole, f = bot.entity.position.floored(), hc = new Vec3(h.x, h.y, h.z);
      const flat = Math.hypot(h.x + .5 - bot.entity.position.x, h.z + .5 - bot.entity.position.z);
      const air = c => { const b = bot.blockAt(c); return !b || /^(air|cave_air)$/.test(b.name); };
      const open = air(hc) && air(hc.offset(0, 1, 0)) && bot.blockAt(hc.offset(0, -1, 0))?.boundingBox === 'block';
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(hc.offset(dx, 0, dz))?.boundingBox === 'block' && bot.blockAt(hc.offset(dx, 1, dz))?.boundingBox === 'block').length;
      const rimLevel = Math.abs((h.y + 2) - f.y) <= 1;
      // On the hole's own roof (note 1821): the body that climbed out stands over its hole with the roof under its feet, the hole a block aside for nobody, and 25588's dragon-189 (2026-10-18 04:28 to 04:33Z, four crystals, full health) stood so at (-30, 65, 26) over its hole at (-31, 62, 26), asked 288 times in five minutes, none_good 0.66, observe taken. The roof block is dug from under the feet and the body drops in.
      const roofUnder = bot.blockAt(f.offset(0, -1, 0));
      const onItsRoof = flat < 1 && f.y === h.y + 3 && open && roofUnder?.boundingBox === 'block' && (pickCarried() || SCAFFOLD_UNDER.test(roofUnder.name)) && actions.dig;
      if (onItsRoof) {
        tree.back_into_the_hole = {
          description: { action: `Dig the roof block (${roofUnder.name.replaceAll('_', ' ')}) from under the feet and drop the two blocks back into the hole at (${h.x}, ${h.y}, ${h.z}) dug ${Math.round((Date.now() - h.at) / 1000)} s ago (${sides} of 4 sides closed), then roof it again from inside: a hole two deep is untouched by the dragon's body, and a fireball's cloud lands on the ground over it, not in it; from the hole the tunnel to a crystal's foot is to be had`, sidesClosed: sides, health: bot.health, blocksCarried: blocksCarried(bot), dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null },
          run: async () => {
            goal.step = { action: 'back_into_the_hole', roof: true }; save();
            const t0 = Date.now(); const y0 = Math.floor(bot.entity.position.y);
            try { await actions.dig(bot, task, f.offset(0, -1, 0), { dropInto: true, openPit: true, requireDrops: false }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
            for (let i = 0; i < 30 && Math.floor(bot.entity.position.y) >= y0; i++) { check(); await sleep(100); }
            for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50);
            const g = bot.entity.position.floored(), inIt = g.x === h.x && g.z === h.z && g.y <= h.y + 1;
            let roofed = false; if (inIt) { state.hole = { ...h, at: Date.now() }; save(); try { roofed = await roofHole(true); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } }
            console.log(`[end combat] back into the hole at (${h.x}, ${h.y}, ${h.z}) through its roof from ${f}: ${inIt ? 'in it' : `not in it, at ${g}`}, ${roofed ? 'roofed' : 'not roofed'}, ${Math.round((Date.now() - t0) / 100) / 10} s`);
            if (inIt) progress = true; else throw new Error('The hole was not dropped into');
          } };
      } else if (flat >= 1 && flat <= 4.5 && open && sides >= 3 && rimLevel) {
        tree.back_into_the_hole = {
          description: { action: `Walk the ${Math.round(flat * 10) / 10} blocks back to the hole at (${h.x}, ${h.y}, ${h.z}) dug ${Math.round((Date.now() - h.at) / 1000)} s ago and drop into it (two deep, ${sides} of 4 sides closed, roofed again from inside): a hole two deep is untouched by the dragon's body, and a fireball's cloud lands on the ground over it, not in it; from the hole the tunnel to a crystal's foot is to be had`, holeBlocksOff: Math.round(flat * 10) / 10, sidesClosed: sides, health: bot.health, blocksCarried: blocksCarried(bot), dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null, record: '25588\'s dragon-180 (2026-10-18 01:49Z) left its four-sided hole at (35, 59, 16) for a cloud at the rim and never went back: a stub, a three-block drop with no pool, a hole begun on open ground a block from it, and the next fireball\'s cloud on the body there, 20 to 14 to 9 to none' },
          run: async () => {
            goal.step = { action: 'back_into_the_hole', walk: Math.round(flat * 10) / 10 }; save();
            const t0 = Date.now();
            bot.clearControlStates?.(); bot.pathfinder?.setGoal?.(null);
            try { await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'back_into_the_hole', keys: ['forward'], sneak: false, why: 'back into the hole dug before', look: hc.offset(.5, 1, .5), maxMs: 3500, tick: 25, until: () => { const g = bot.entity.position.floored(); return g.x === h.x && g.z === h.z && g.y <= h.y + 1; } }); } catch (err) { check(); }
            for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(50);
            const g = bot.entity.position.floored(), inIt = g.x === h.x && g.z === h.z && g.y <= h.y + 1;
            let roofed = false; if (inIt) { state.hole = { ...h, at: Date.now() }; save(); try { roofed = await roofHole(true); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } }
            console.log(`[end combat] back into the hole at (${h.x}, ${h.y}, ${h.z}) from ${f}: ${inIt ? 'in it' : `not reached, at ${g}`}, ${roofed ? 'roofed' : 'not roofed'}, ${Math.round((Date.now() - t0) / 100) / 10} s`);
            if (inIt) progress = true; else throw new Error('The hole was not reached');
          } };
      }
    }
    // Out by hand (note 1832): with the pickaxe gone and the body walled in at the feet, nothing was offered but moves that failed; 25588's dragon-194 (2026-10-18 06:45 to 07:00Z, 428 blocks, full health) stood sealed in its own column's low rings at (30, 61, 24), none_good and observe for a quarter hour. Cobblestone yields to bare hands in about ten seconds, netherrack in two, dirt in one; end stone takes fifteen and obsidian never.
    if (!pickCarried() && actions.dig && bot.entity.onGround && !inWater() && !holeHere() && !inTunnel() && !Object.keys(tree).some(k => /^(tunnel_to_|pillar_punch_|craft_pickaxe)/.test(k))) {
      const f0 = bot.entity.position.floored(), solid = q => bot.blockAt(q)?.boundingBox === 'block';
      // End stone by hand too (note 1834): the rings of a climb with end stone to spare are end stone, and 25588's dragon-194 (2026-10-18 07:14Z) sat sealed in them at (30, 64, 24) with the option of note 1832 never built; fifteen seconds a block, walled in out of the dragon's reach, is a price Jev can weigh. Obsidian and bedrock stay out.
      const soft = n => /^(cobblestone|cobbled_deepslate|netherrack|dirt|gravel|sand|stone|andesite|diorite|granite|tuff|blackstone|basalt|end_stone)$/.test(n || '');
      const secs = n => /netherrack/.test(n) ? 2 : /dirt|gravel|sand/.test(n) ? 1 : /end_stone/.test(n) ? 15 : 10;
      const sides = [[1, 0, 'east'], [-1, 0, 'west'], [0, 1, 'south'], [0, -1, 'north']];
      const walls = sides.filter(([dx, dz]) => solid(f0.offset(dx, 0, dz)));
      const ways = sides.map(([dx, dz, name]) => { const a = bot.blockAt(f0.offset(dx, 0, dz)), b = bot.blockAt(f0.offset(dx, 1, dz)); const beyond = f0.offset(dx * 2, 0, dz * 2); const landing = [-1, -2, -3, -4].find(dy => solid(beyond.offset(0, dy, 0))); return { dx, dz, name, a, b, open: landing != null && landing >= -4 && !solid(beyond) && !solid(beyond.offset(0, 1, 0)) && !/water|lava/.test(bot.blockAt(beyond.offset(0, landing, 0))?.name || ''), drop: landing == null ? null : -landing - 1, cost: (a?.boundingBox === 'block' ? secs(a.name) : 0) + (b?.boundingBox === 'block' ? secs(b.name) : 0), ok: (a?.boundingBox !== 'block' || soft(a.name)) && (b?.boundingBox !== 'block' || soft(b.name)) && (a?.boundingBox === 'block' || b?.boundingBox === 'block') }; }).filter(w => w.ok && w.open).sort((p, q) => p.cost - q.cost);
      if (walls.length >= 3 && ways.length) {
        const w = ways[0];
        tree.dig_out_by_hand = {
          description: { action: `Dig out of this walled cell by hand to the ${w.name}: ${[w.a, w.b].filter(b => b?.boundingBox === 'block').map(b => b.name.replaceAll('_', ' ')).join(' and ')} (about ${w.cost} s bare-handed, the blocks dropped and picked up), onto the island's ground beyond${w.drop ? ` (a step down of ${w.drop}; note 1833: 25588's dragon-194 sat perched three up inside its shaft with the ground beyond lower than its feet)` : ''}; no pickaxe is carried: end stone is fifteen seconds a block by hand, cobblestone ten, and obsidian is never dug`, seconds: w.cost, wallsClosed: walls.length, health: bot.health, blocksCarried: blocksCarried(bot), dragonBlocksOff: dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : null, record: '25588\'s dragon-194 (2026-10-18) stood sealed in its own column\'s cobblestone rings a quarter hour with 428 blocks and no pickaxe, none_good and observe, nothing else offered' },
          run: async () => {
            goal.step = { action: 'dig_out_by_hand', side: w.name, seconds: w.cost }; save();
            const t0 = Date.now(); let dug = 0;
            for (const cell of [f0.offset(w.dx, 1, w.dz), f0.offset(w.dx, 0, w.dz)]) { if (!solid(cell)) continue; try { await actions.dig(bot, task, cell, { requireDrops: false }); dug++; } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; break; } }
            const out = !solid(f0.offset(w.dx, 0, w.dz)) && !solid(f0.offset(w.dx, 1, w.dz));
            console.log(`[end combat] dug out by hand to the ${w.name} from ${f0}: ${dug} dug, ${out ? 'the way open' : 'still walled'}, ${Math.round((Date.now() - t0) / 100) / 10} s, ${bot.health.toFixed(1)} health`);
            if (out) progress = true; else throw new Error('The way out was not dug');
          } };
      }
    }
    if (!Object.keys(tree).length && !safe && inWater()) {
      const f = bot.entity.position.floored(); let how = 'nothing';
      try { const took = await takeBackWaterNear({ force: true }); if (took) how = `the water at ${took} taken back`; } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
      // The source walked to and scooped (note 1786): flowing water at the feet has its source a few cells off, past the bucket's reach from where the body stands, and the pathfinder's walk times out in the water. 25588's dragon-155 (2026-10-17 19:3xZ, 167 blocks, two tunnels) stood in the run-off at (31, 59, -23) at the foot of its column, 'nothing; no dry cell beside', the walk back to the water at (31, 60, -19) timing out, round after round.
      if (inWater() && countOf(bot, 'bucket') > 0) {
        const { sourceWater } = require('./water');
        const src = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 7, count: 12, useExtraInfo: sourceWater }).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
        if (src) {
          try { await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'to_the_water_source', keys: ['forward', 'jump'], sneak: false, why: 'to the pool\'s source, to take it back', look: src.offset(.5, .5, .5), maxMs: 2500, tick: 25, until: () => bot.entity.position.offset(0, 1.62, 0).distanceTo(src.offset(.5, .5, .5)) <= 3.5 }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
          try { const took = await takeBackWaterNear({ force: true }); if (took) how += `; the source at ${took} walked to and taken back`; else how += `; the source at ${src} not reached (${Math.round(bot.entity.position.distanceTo(src) * 10) / 10} off)`; } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; }
        } else how += '; no source within seven';
      }
      if (inWater()) {
        const dry = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dz]) => f.offset(dx, 0, dz)).find(c => !/water/.test(bot.blockAt(c)?.name || '') && bot.blockAt(c)?.boundingBox !== 'block' && bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block' && bot.blockAt(c.offset(0, 1, 0))?.boundingBox !== 'block');
        if (dry) { goal.step = { action: 'out_of_the_pool', to: { x: dry.x, y: dry.y, z: dry.z } }; save(); try { await require('./motion').move(bot, { check, get cancelled() { return task.cancelled; }, label: task.label }, { label: 'out_of_the_pool', keys: ['forward'], sneak: false, why: 'out of the water, where no climb and no dig is to be had', look: dry.offset(.5, 1.6, .5), maxMs: 1500, tick: 25, until: () => !inWater() }); how += `; stepped to ${dry}`; } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir', 'EndEmergency'].includes(err.name)) throw err; } }
        else how += '; no dry cell beside';
      }
      console.log(`[end combat] in the water with nothing offered at ${f}: ${how}; now ${inWater() ? 'still in the water' : 'out'} at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health`);
      return;
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
    // An enderman's blow within five seconds, and one within twelve (note 1567):
    // the fight is the only business until it is over. The quarry, the climbs
    // and the walks between its blows were the deaths of dragon-97, 100 and
    // 115 (25588, 2026-10-14): six to seven blows of 4.5 each over ten seconds,
    // the body digging, walking or eating between them, never more than two
    // sword blows landed. What stays: the fight, the water at the feet, the
    // pocket, and the watch in the water.
    {
      const hitAt = bot._hurtBy?.enderman || 0;
      const foeNear = hostileEntities(bot, 12).some(e => live(bot, e) && e.name === 'enderman');
      if (foeNear && Date.now() - hitAt < 5000 && (tree.fight_enderman || tree.water_at_feet || tree.hide_from_enderman)) {
        const keep = new Set(['fight_enderman', 'water_at_feet', 'hide_from_enderman', 'observe']);
        const dropped = Object.keys(tree).filter(k => !keep.has(k));
        for (const k of dropped) delete tree[k];
        if (dropped.length && !(state.endermanStanceSaid > Date.now() - 10000)) { state.endermanStanceSaid = Date.now(); console.log(`[end combat] an enderman's blow ${Math.round((Date.now() - hitAt) / 100) / 10} s ago and one within twelve: the fight first; set aside ${dropped.join(', ')}`); }
      }
    }
    // The landing or take-off said on every option (note 1609), not only the hole's.
    // Under the sitting dragon the take-off's throw goes on the options that move the body, not on the hole's wait or observe (note 2224, Fable's trim of note 2205; the landing's and take-off's words go on every option as before).
    { const now = dragonNow(state.dragon, bot.entity.position); const sitting = [5, 6, 7].includes(state.dragon?.phase); if (now) for (const [k, o] of Object.entries(tree)) if (o && o.description && typeof o.description === 'object' && !(sitting && ['stay_in_hole', 'observe', 'wait_in_hole'].includes(k))) o.description.dragonNow = now; }
    // The block budget said on every option (note 1739, the fight plan): the blocks carried, what the climbs to the standing crystals ask, and where blocks come from out of the dragon's sight. 25588's deaths of 2026-10-15 came four in five with none or one block carried; dragon-291 (16:24Z) had 23 after its tunnel and none ten minutes later, in the breath.
    { const carried = blocksCarried(bot), lifts = crystals.map(c => Math.max(0, Math.floor(c.position.y) - Math.floor(bot.entity.position.y))).sort((a, b) => a - b);
      const says = `${carried} blocks carried; ${lifts.length ? `the lowest standing crystal is about ${lifts[0]} up${lifts.length > 1 ? `, all ${lifts.length} together about ${lifts.reduce((a, b) => a + b, 0)}` : ''}` : 'no crystal standing'}; each climb out of the breath takes one or two, a roof one; the tunnel quarry from a hole two deep gains about one a second out of the dragon's sight`;
      for (const o of Object.values(tree)) if (o && o.description && typeof o.description === 'object') o.description.blockBudget = says; }
    // The fight's clock on every option (note 1841): 25588's dragon-201 and 202 (2026-10-18 09:20 to 10:04Z) dug eleven and eight tunnels in their first quarter hour with no crystal struck, three pickaxes spent, every option saying the tunnel count and the budget; the pace and what it projects were nowhere. Said once, on all.
    { try { const t0 = state.fightStartedAt || (state.fightStartedAt = Date.now()); const mins = Math.max(1, Math.round((Date.now() - t0) / 60000)); const struck = (state.climbs?.struck || 0) + (state.crystalsStruck || 0) || (10 - crystals.length); const left = crystals.length; const tunnels = (state.tunnelsTo || []).length; const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)); const digs = picks.reduce((n, i) => n + Math.max(0, (bot.registry.itemsByName[i.name]?.maxDurability || 250) - (i.durabilityUsed || 0)), 0); const crafts = countOf(bot, 'crafting_table') ? Math.min(Math.floor(countOf(bot, 'iron_ingot') / 3), Math.floor(countOf(bot, 'stick') / 2)) : 0; const pace = struck > 0 ? `about ${Math.round(mins / struck)} min a crystal: the ${left} left about ${Math.round(mins / struck * left)} min more` : `no crystal yet: the ${left} left have no pace to go by`; const says = `${mins} min into this fight: ${struck} crystal${struck === 1 ? '' : 's'} struck, ${left} left; ${tunnels} tunnel${tunnels === 1 ? '' : 's'} dug; ${digs} digs left in the pickaxe${picks.length ? '' : ' (none carried)'} and ${crafts} more craftable, about ${Math.round((digs + crafts * 250) / 2)} tunnel cells or ${Math.round((digs + crafts * 250) / 30)} descents by the dig; ${pace}`; for (const o of Object.values(tree)) if (o && o.description && typeof o.description === 'object') o.description.fightClock = says; } catch (_) { /* the clock is a courtesy */ } }
    // The strafe said on every option, and the seal offered on the bot's own column (note 1731): the dragon turns to strafe at the bot (phase 1) and throws one fireball, aimed at the body, then turns away; a burst within four blocks of the feet puts its cloud on the body, and it throws only at a body it sees. 25588 (dragon-278, 2026-10-15 12:5xZ, the first runs with note 1730's log): the throw came 8.2, 1.0, 5.4, 5.8 and 0.9 s after the strafe began, at 10 to 48 blocks, and the one at (35, 80, -22) on the column took 17.3 to 5.3.
    if (state.dragonPhase?.phase === 1 && Date.now() - state.dragonPhase.at < 9000) {
      const d = Object.values(bot.entities).find(e => e.name === 'ender_dragon' && live(bot, e)), secs = ((Date.now() - state.dragonPhase.at) / 1000).toFixed(1);
      const says = `the dragon turned to strafe at the bot ${secs} s ago${d ? `, ${Math.round(d.position.distanceTo(bot.entity.position))} blocks off` : ''}: it throws one fireball aimed at the body, so far 0.9 to 8.2 s after the strafe began, then turns away; a burst within four blocks of the feet puts its cloud on the body (six a second), and it throws only at a body it sees${state.fireballs ? `; of ${state.fireballs.thrown} thrown at the bot this fight, ${state.fireballs.hurt} put their cloud on it` : ''}`;
      for (const o of Object.values(tree)) if (o && o.description && typeof o.description === 'object') o.description.dragonStrafing = says;
      const g = bot.entity.position.floored(), sd = c => bot.blockAt(c)?.boundingBox === 'block';
      const sealed = sd(g.offset(0, 2, 0)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => sd(g.offset(dx, 1, dz)));
      // Not on the ground (note 1840): a box at ground level is a stub with walls, and a fireball bursting on its side lays the cloud inside it; 25588's dragon-200 (2026-10-18 09:15Z, two crystals, 362 blocks, full health) came up its hand-dug staircase, 'sealed against the strafe' on the surface at (28, 59, -29), and took the next fireball's cloud in the box, 20 to 8 to none. The seal is for a column's top, three or more over its base.
      const highOnColumn = !bot._pillarUp || bot._pillarUp.base == null || Math.floor(bot.entity.position.y) >= bot._pillarUp.base + 3;
      if (!sealed && (onOwnPillar() || nearOwnColumnTop()) && !onObsidianTop() && blocksCarried(bot) >= 10 && highOnColumn) tree.seal_against_strafe = {
        description: { action: `Roof the head and wall the four sides at the feet and the head here on the bot's own column (about ten blocks, a second), out of the dragon's sight for its throw`, strafing: says, blocksCarried: blocksCarried(bot), health: bot.health },
        run: async () => { const t0 = Date.now(); let roofed = false; try { roofed = await roofOverhead(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } let r = { laid: 0, closed: 0 }; try { r = await pocketOnColumn({ allSides: true }); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } console.log(`[end combat] sealed against the strafe at ${bot.entity.position.floored()}: roof ${roofed ? 'laid' : 'not laid'}, ${r.laid} laid, ${r.closed} of 4 sides closed, ${Date.now() - t0} ms, ${blocksCarried(bot)} blocks left`); if (r.closed >= 4) progress = true; } };
    }
    // The way out of a hole under a breath cloud said on every way that leaves it (note 2067): the cloud hurts only
    // what touches its half-block box, a body standing two or more under it is out of it, and a jump puts the head in
    // it (the arena's drill of 2026-10-24, note 2066). full-2 (2026-10-23 04:14Z and 20:56Z) and full-3 (21:44Z) died in
    // pits under clouds two to three over their feet, on the ways out that jump.
    if (holeHere()) {
      const p = bot.entity.position;
      const c = Object.values(bot.entities || {}).filter(e => e.name === 'area_effect_cloud' && e.isValid !== false && e.position && e.position.y - p.y >= 1.5 && e.position.y - p.y <= 3.6 && Math.hypot(p.x - e.position.x, p.z - e.position.z) <= cloudRadius(bot, e) + 0.5).sort((a, b) => a.position.y - b.position.y)[0];
      if (c) {
        const over = Math.round((c.position.y - p.y) * 10) / 10, wide = Math.round(cloudRadius(bot, c) * 20) / 10;
        const says = ` The breath's cloud lies ${over} over the feet here, ${wide} wide: standing in the hole the body is out of it, its box half a block high, and a jump or a climb out puts the head in it, about six health a tick while in it; a cloud lasts about thirty seconds from its burst.`;
        for (const [k, node] of Object.entries(tree)) {
          if (/^(stay_in_hole|wait_in_hole|observe|eat|strike_head|none_good)$/.test(k)) continue;
          if (node?.description && typeof node.description.action === 'string') node.description.action += says;
          else if (typeof node?.description === 'string') node.description += says;
        }
      }
    }
    const decision = await decide('dragon_fight', { client, bot, goal, tree, context: { safe }, interrupt: check, watchMs: 50,
      state: endDecisionState({ request: goal.request, health: bot.health, food: bot.food, arrows: countOf(bot, 'arrow'), headNotSought: crystals.length ? `the head is not offered while a crystal stands: its blows are healed back in seconds by the nearest crystal, and the run to it threw dragon-176, 188, 189 and 191 to their deaths on 2026-10-14 with no lasting damage done; the crystals come first` : undefined,
        position: { ...bot.entity.position }, safe, dragon: state.dragon,
        // The footing here (note 1557): how many cells of ground within six are open to step to, and whether the void lies beside the feet. The ledge under the entry platform had none, and 25588 (dragon-106, 2026-10-14 01:26Z) chose to shoot from it with two arrows and died in the breath there with no step to take.
        footing: state.routeLook && Date.now() - (state.routeLook.at || 0) < 10000 ? `${state.routeLook.allowed} cell${state.routeLook.allowed === 1 ? '' : 's'} of ground within six to step to${voidEdge(bot, bot.entity.position, 3) !== null ? ', the void within three of the feet' : ''}` : (voidEdge(bot, bot.entity.position, 3) !== null ? 'the void within three of the feet' : undefined),
        head: head && { position: { ...head.position }, reachable: canStrike(bot, head) }, crystals: state.observedCrystals, combat: state }),
      isFresh: () => dimension(bot) === 'end' && bot.health >= healthBefore && bot.entity.position.distanceTo(start) < 1 });
    if (decision.stale) return;
    chose = true;
    if (Object.keys(tree).length === 1 && tree.observe && !(state.onlyObserveSaid > Date.now() - 10000)) {
      state.onlyObserveSaid = Date.now();
      console.log(`[end combat] only observe: standing on ${bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))?.name || 'nothing'} at ${bot.entity.position.floored()}, column ${JSON.stringify(bot._pillarUp)}, own pillar ${onOwnPillar()}, obsidian top ${onObsidianTop()}, safe ${safe}${safe ? '' : ` (${unsafeBecause(bot, bot.entity.position).slice(0, 3).join(', ')})`}, crystals ${crystals.length} (${crystals.slice(0, 3).map(c => `${c.id}@${Math.round(c.position.distanceTo(bot.entity.position))} bedrock:${bot.blockAt(c.position.floored().offset(0, -1, 0))?.name || 'unloaded'} caged:${caged(bot, c)}`).join('; ')}), ${blocksCarried(bot)} blocks; wet ${wet}, dragon phase ${dragon ? metadata(bot, dragon, 'phase') : 'none'} ${dragon ? Math.round(dragon.position.distanceTo(bot.entity.position)) : '-'} off, head ${head ? `${Math.round(head.position.distanceTo(bot.entity.position))} off` : 'none'}, hostiles ${hostileEntities(bot, 64).map(e => `${e.name} ${Math.round(e.position.distanceTo(bot.entity.position))}`).join(', ') || 'none'}, routes ${JSON.stringify(state.routeLook || {})}, quarry ${state.quarryLook && Date.now() - state.quarryLook.at < 5000 ? JSON.stringify(state.quarryLook) : 'not looked'}, no shot: ${noShot}`);
    }
    goal.step = { action: 'end_combat', selected: decision.path, dragonHealth: beforeDragon, observedCrystals: crystals.length }; save();
    // Out of the hole first for anything but the stay (note 1592).
    if (holeHere() && !['stay_in_hole', 'observe', 'eat'].includes([].concat(decision.path).at(-1)) && !/^(tunnel_to_|tunnel_quarry|stock_up_underground)/.test(String([].concat(decision.path).at(-1)))) { try { await outOfTheHole(); } catch (err) { if (['Cancelled', 'Blocked', 'NeedsAir'].includes(err.name)) throw err; } }
    // The breath's cloud cuts the run within a tick (note 1619): the emergency
    // was read at the step's start and wherever a run happened to call the
    // task's check, and a quarry's dig or a walk in the pathfinder calls it
    // seldom. 25588 (dragon-155, 2026-10-14 10:12Z, four crystals broken, and
    // dragon-156, 10:24Z, three) each stood still under the cloud for three
    // seconds mid-run, 20 to 14 to 8 to 2 to none, 'hurt without a survival
    // response', nothing pressed. The run is raced against a tick watch; the
    // cloud at the feet ends it and the response runs. Not during the drop
    // (the landing is its own matter), and not in a hole two deep, under it.
    let cutRun = null, raced = false; const cut = new Promise((_, reject) => { cutRun = reject; }); cut.catch(() => {});
    // Not on the bot's own column, an obsidian top or in a hole: the hold, the dig down and the stand in the hole answer the breath themselves (notes 1478, 1576, 1618); the ground's runs do not.
    // In the recorded hole as well as a walled one (note 1621): a hole beside an older hole has a side open and holeHere says no, and 25588 (dragon-158, 2026-10-14 10:46Z) had hole_under_head and stay_in_hole cut in its hole at (2, 60, -7). The cloud is named on the cut, to learn where the breath's cloud forms against a body in a hole.
    let cutCloud = null;
    // Cut only with the body in the cloud itself (note 1622), not within the two blocks of margin breathThreat keeps: at the margin 25588 (dragon-159, 2026-10-14 10:55Z) had its walks cut eight times in six minutes at 20 health, each cut a response and a question over again.
    breathWatch = () => { try { if (!raced && !require('./respawn-fresh').standing(goal) && !bot._dropping && !bot._fallRecovery && !onOwnPillar() && !onColumnCell() && !onObsidianTop() && !holeHere() && !inRecordedHole()) { const c = breathThreat(bot); if (c?.name === 'area_effect_cloud' && hazardDistance(bot.entity.position, c) <= cloudRadius(bot, c) - 2 + 0.3) { raced = true; cutCloud = c; stepCut = 'dragon_breath_cloud'; cutRun(Object.assign(new Error('dragon_breath_cloud'), { name: 'EndEmergency' })); } } } catch (_) { /* nothing */ } };
    bot.on('physicsTick', breathWatch);
    try {
      const running = Promise.resolve().then(() => decision.action.run()); running.catch(() => {});
      await Promise.race([running, cut]);
    }
    catch (err) {
      if (err.name === 'EndEmergency') { state.lastCutAt = Date.now(); state.lastCutHealth = bot.health; bot.pathfinder.setGoal(null); bot.clearControlStates(); const c = cutCloud; console.log(`[end combat] ${[].concat(decision.path).join('/')} cut by ${c ? 'the breath\'s cloud at the feet' : `the emergency '${String(err.message).slice(0, 40)}'`} at ${bot.entity.position.floored()}, ${bot.health.toFixed(1)} health${c ? ` (the cloud at ${c.position.floored()}, ${Math.round(cloudRadius(bot, c) * 10) / 10} wide, ${Math.round(hazardDistance(bot.entity.position, c) * 10) / 10} off)` : ''}`); }
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
    clearInterval(crouchKeeper);
    bot.removeListener('entityMoved', moved); bot.removeListener('physicsTick', falling); bot.removeListener('physicsTick', phaseWatch); bot.removeListener('entitySpawn', fireballWatch); if (breathWatch) bot.removeListener('physicsTick', breathWatch); task.interruptCheck = oldInterrupt;
    bot.pathfinder.setGoal(null); bot.clearControlStates(); policy.restore();
  }
}

// The shots at the dragon this fight, said on the option (note 2200): how often chosen, how many arrows left the bow, what the dragon lost to them, and how the other picks ended.
const SHOT_FLIGHT_RECORD = Object.freeze([[1, 156, 120], [1.5, 70, 40], [2, 38, 18], [Infinity, 20, 0]]);
function shotFlightSays(seconds) {
  const band = SHOT_FLIGHT_RECORD.find(([upTo]) => seconds < upTo);
  const [, picks, lost] = band;
  return `This arrow flies about ${Math.round(seconds * 10) / 10} seconds to the dragon. In the record (every End trial's log on 2026-10-27, the dragon's health lost in the eight seconds after each pick): flights under a second, 156 picks for 120 health (0.8 a pick); 1 to 1.5 s, 70 for 40 (0.6); 1.5 to 2 s, 38 for 18 (0.5); 2 s or more, 20 for none. This one is in the ${seconds < 1 ? 'first' : seconds < 1.5 ? 'second' : seconds < 2 ? 'third' : 'last'} band, ${picks} picks for ${lost}.`;
}
function dragonShotsSays(state, dragonHealth) {
  const t = state.dragonShots || { chosen: 0, loosed: 0, ended: {} };
  const since = state.fightStartedAt || 0;
  const shots = (state.shots || []).filter(s => s.target === 'ender_dragon' && s.at >= since && Number.isFinite(s.dragonBefore));
  const lost = shots.reduce((n, s) => n + Math.max(0, s.dragonBefore - (Number.isFinite(s.dragonAfter) ? s.dragonAfter : s.dragonBefore)), 0);
  if (!t.chosen) return `not chosen yet this fight; the dragon's health ${dragonHealth ?? '?'} of 200`;
  const ended = Object.entries(t.ended).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${why} ${n}`).join(', ');
  return `chosen ${t.chosen} time${t.chosen === 1 ? '' : 's'} this fight: ${t.loosed} arrow${t.loosed === 1 ? '' : 's'} left the bow at the dragon and it lost ${Math.round(lost)} health in the seconds after them (its health ${dragonHealth ?? '?'} of 200 now)${t.chosen > t.loosed ? `; the other ${t.chosen - t.loosed} pick${t.chosen - t.loosed === 1 ? '' : 's'} ended before any arrow: ${ended || 'nothing recorded'}` : ''}`;
}
module.exports = { shotFlightSays, dragonShotsSays, cloudOverClimb, runOffSides, spanSteps, PUNCH_RECORD, punchRecordSays, dragonNearRoute, enclosed, dropOffs, leaveHighGround, voidEdge, endermenNearRoute, metadata, perched, perchedHead, repeatedCrystalMiss, observeArena, endHazards, safeEndPoint, arenaMovement, arenaRoutes, fightEndStep };
