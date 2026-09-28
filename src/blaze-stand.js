'use strict';
// Where a player takes blaze rods with iron at most and no fire
// resistance: with the back to rock, where a fireball's push meets a wall
// and not a drop. The fortress stage died three ways in a day: a
// fireball knocked mid-235-p-fortress-1 off an edge at 5.5 health, -2
// burned fighting blazes in the open, -3 touched lava on the walk (notes
// 509, 512, 514); -4 sealed itself in a pocket ten blocks from a spawner
// and sat there twenty-two minutes, offered only to stay or leave. Three
// stands, each said with its seconds and what the mobs cost there
// (stanceCost, the burn included), beside the fight in the open:
// - a hole one wide and two high dug into brick or netherrack, rock
//   behind, beside and over the bot, fought from inside;
// - a cell within three of the spawner's cage under a ceiling, where its
//   blazes come out;
// - the nearest footing with a wall at its back and no drop within a push.
// Offered where the hunt asks how to take them (mob-hunt huntObserved),
// in the encounter's stance (survival stanceOptions) and from a sealed
// pocket (pocket_next).
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const ce = require('./combat-estimate');
const bunker = require('./bunker');
const terrain = require('./terrain');

const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const solid = b => b?.boundingBox === 'block';
const WALK = 4.3; // blocks a second
const KNOCK = ce.FIREBALL.knock;
const SPAWNER_NEAR = 3, SPAWNER_SEARCH = 24;
const round = n => Math.round(n * 10) / 10;
const words = s => String(s || '').replaceAll('_', ' ');
const seconds = n => `${n} second${n === 1 ? '' : 's'}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const debug = (...a) => { if (process.env.BLAZE_DEBUG) console.log('[blaze]', ...a); };

// Lava within a push of the cell, at its level or the one under.
function lavaWithin(bot, c, r = KNOCK) {
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -1; dy <= 0; dy++) {
    if (bot.blockAt(c.offset(dx, dy, dz))?.name === 'lava') return true;
  }
  return false;
}
// A push from here lands on ground: no drop and no lava within it.
const knockLands = (bot, c) => !terrain.dropAt(bot, c) && !terrain.dropWithin(bot, c, KNOCK) && !lavaWithin(bot, c);

// What a push does where the bot stands, said beside the drop (note 469's
// pattern): the drop's distance against the push's.
function knockSays(bot, feet = bot.entity.position.floored(), { what = 'A blaze\'s fireball that lands' } = {}) {
  const drop = terrain.dropNear(bot, feet, 3);
  if (!drop || (drop.into !== 'lava' && drop.damage < 1)) return '';
  const pushes = Math.max(1, Math.ceil(drop.blocksAway / KNOCK));
  return ` ${what} pushes the bot about ${KNOCK} blocks, shield raised or not; the drop ${drop.into === 'lava' ? 'into lava ' : ''}is ${drop.blocksAway ? `${drop.blocksAway} block${drop.blocksAway === 1 ? '' : 's'} off` : 'under the bot'}: ${pushes === 1 ? 'one that lands puts' : `about ${pushes} landing in turn put`} it over.`;
}

// The hole: a cell of brick or netherrack beside a stand (where the bot is,
// or a wall within a short walk) with rock behind it, on both sides and
// over it, two blocks to dig. Its mouth faces the blazes where the rock
// allows. Already in one (rock on three sides and a roof, one side open),
// nothing to dig.
function inHole(bot, feet = bot.entity.position.floored()) {
  if (!solid(bot.blockAt(feet.offset(0, 2, 0))) || !solid(bot.blockAt(feet.offset(0, -1, 0)))) return null;
  const open = SIDES.filter(s => !solid(bot.blockAt(feet.plus(s))) && !solid(bot.blockAt(feet.plus(s).offset(0, 1, 0))));
  if (open.length !== 1) return null;
  if (!SIDES.filter(s => s !== open[0]).every(s => solid(bot.blockAt(feet.plus(s))) && solid(bot.blockAt(feet.plus(s).offset(0, 1, 0))))) return null;
  return { hole: feet, stand: feet.plus(open[0]), side: open[0].scaled(-1), blocks: 0, digMs: 0, walkMs: 0, ms: 0, inside: true };
}
function holeSite(bot, from, { within = bunker.WALK_TO_WALL } = {}) {
  const already = inHole(bot);
  if (already) return already;
  const { safeExcavation } = require('./tunneling');
  const here = bot.entity.position, feet = here.floored();
  const stands = [feet, ...bunker.wallStands(bot, from, { distance: within + 2 }).filter(c => c.distanceTo(here) <= within && !c.equals(feet))];
  const rock = p => { const b = bot.blockAt(p); return solid(b) && bunker.NATURAL.test(b.name) && b.diggable !== false && safeExcavation(bot, p); };
  let best = null;
  for (const stand of stands) {
    if (!stand.equals(feet) && !bunker.standable(bot, stand)) continue;
    const walkMs = stand.equals(feet) ? 0 : stand.distanceTo(here) * 250;
    for (const side of SIDES) {
      const hole = stand.plus(side);
      if (!rock(hole) || !rock(hole.offset(0, 1, 0))) continue;
      const floor = bot.blockAt(hole.offset(0, -1, 0));
      if (!solid(floor) || /magma/.test(floor.name || '')) continue;
      const walls = [side, ...SIDES.filter(t => t.x * side.x + t.z * side.z === 0)].map(t => hole.plus(t));
      if (!walls.every(w => solid(bot.blockAt(w)) && solid(bot.blockAt(w.offset(0, 1, 0))))) continue;
      if (!solid(bot.blockAt(hole.offset(0, 2, 0)))) continue;
      const blocks = [bot.blockAt(hole.offset(0, 1, 0)), bot.blockAt(hole)];
      const digMs = blocks.reduce((n, b) => n + bunker.blockDigMs(bot, b), 0);
      // The rock between the bot and them, the mouth toward them.
      const away = from ? side.x * (from.x - stand.x) + side.z * (from.z - stand.z) <= 0 : true;
      const score = walkMs + digMs + (away ? 0 : 4000);
      if (!best || score < best.score) best = { hole, stand, side, blocks: 2, digMs, walkMs, ms: walkMs + digMs, score, rock: blocks[1].name, with: bunker.digsWith(bot, blocks[1]) };
    }
  }
  return best;
}

// A hole in the rock beside a blaze spawner's cage, its mouth toward the
// cage, as a player takes rods with iron: its blazes come out within four
// blocks of the cage, and those that come within two of the bot close to
// swing, into the mouth and the sword; every other line in is through the
// mouth, so every shot comes from in front, where the shield faces, and
// no fire lands on the cell. The fortress drill's stand at the cage in the
// open was shot from every side and burned from 18 to none in fifteen
// seconds (2026-09-28).
const SPAWNER_HOLE = 4.5;
function spawnerHoleSite(bot, cage = spawnerAt(bot), { steps = 30, avoid = [] } = {}) {
  if (!cage) return null;
  const { safeExcavation } = require('./tunneling');
  const centre = cage.offset(0.5, 0.5, 0.5);
  const rock = p => { const b = bot.blockAt(p); return solid(b) && bunker.NATURAL.test(b.name) && b.diggable !== false && safeExcavation(bot, p); };
  const beside = stand => {
    let best = null;
    for (const side of SIDES) {
      // The mouth toward the cage: the hole goes away from it.
      if (side.x * (centre.x - stand.x - 0.5) + side.z * (centre.z - stand.z - 0.5) > 0) continue;
      const hole = stand.plus(side);
      if (hole.offset(0.5, 0.5, 0.5).distanceTo(centre) > SPAWNER_HOLE) continue;
      if (!rock(hole) || !rock(hole.offset(0, 1, 0))) continue;
      const floor = bot.blockAt(hole.offset(0, -1, 0));
      if (!solid(floor) || /magma/.test(floor.name || '')) continue;
      const walls = [side, ...SIDES.filter(t => t.x * side.x + t.z * side.z === 0)].map(t => hole.plus(t));
      if (!walls.every(w => solid(bot.blockAt(w)) && solid(bot.blockAt(w.offset(0, 1, 0))))) continue;
      if (!solid(bot.blockAt(hole.offset(0, 2, 0)))) continue;
      const blocks = [bot.blockAt(hole.offset(0, 1, 0)), bot.blockAt(hole)];
      const digMs = blocks.reduce((n, b) => n + bunker.blockDigMs(bot, b), 0);
      const off = hole.offset(0.5, 0.5, 0.5).distanceTo(centre);
      if (!best || off < best.off) best = { hole, stand, side, blocks: 2, digMs, off, rock: blocks[1].name, with: bunker.digsWith(bot, blocks[1]) };
    }
    return best;
  };
  const found = walkTo(bot, c => c.offset(0.5, 0.5, 0.5).distanceTo(centre) <= SPAWNER_HOLE + 1 && knockLands(bot, c) && !!beside(c), { steps, avoid });
  if (!found) return null;
  const h = beside(found.cell);
  const walkMs = found.steps * 250;
  return { ...h, spawner: cage, off: round(h.off), steps: found.steps, walkMs, ms: walkMs + h.digMs };
}

// A sealed pocket is a hole with no mouth: one side opened toward the
// blazes, two blocks, makes it one. mid-235-p-fortress-4 sat twenty-two
// minutes sealed ten blocks from a spawner with blazes five to seven off,
// offered only to stay or leave.
function windowSite(bot, from) {
  if (!from) return null;
  const { safeExcavation } = require('./tunneling');
  const feet = bot.entity.position.floored();
  const dx = from.x - (feet.x + 0.5), dz = from.z - (feet.z + 0.5);
  const side = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
  const cells = [feet.plus(side).offset(0, 1, 0), feet.plus(side)];
  const blocks = cells.map(c => bot.blockAt(c));
  if (!blocks.every(b => solid(b) && b.diggable !== false && !/bedrock|obsidian/.test(b.name || '')) || !cells.every(c => safeExcavation(bot, c))) return null;
  // The rest of it rock: the other three sides, the lid and the floor.
  if (!solid(bot.blockAt(feet.offset(0, 2, 0))) || !solid(bot.blockAt(feet.offset(0, -1, 0)))) return null;
  if (!SIDES.filter(s => !s.equals(side)).every(s => solid(bot.blockAt(feet.plus(s))) && solid(bot.blockAt(feet.plus(s).offset(0, 1, 0))))) return null;
  const digMs = blocks.reduce((n, b) => n + bunker.blockDigMs(bot, b), 0);
  return { hole: feet, stand: feet.plus(side), side: side.scaled(-1), window: cells, blocks: 2, digMs, walkMs: 0, ms: digMs, rock: blocks[1].name, with: bunker.digsWith(bot, blocks[1]) };
}

// The cells a walk reaches within `steps`, nearest first, and the first
// that `ok` takes. A walk passes no cell beside a mob that bites, nor one
// a push from which is a fall.
function walkTo(bot, ok, { steps = 8, avoid = [] } = {}) {
  const feet = bot.entity.position.floored();
  const near = c => avoid.some(e => e.position && Math.hypot(e.position.x - (c.x + 0.5), e.position.z - (c.z + 0.5)) < 1.5 && Math.abs(e.position.y - c.y) < 2);
  const seen = new Set([`${feet}`]);
  let ring = [feet];
  for (let n = 0; n <= steps && ring.length; n++) {
    const found = ring.filter(ok).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
    if (found) return { cell: found, steps: n };
    const next = [];
    for (const c of ring) for (const s of SIDES) for (const dy of [0, 1, -1]) {
      const to = c.plus(s).offset(0, dy, 0), key = `${to}`;
      if (seen.has(key)) continue;
      if (dy === 1 && solid(bot.blockAt(c.offset(0, 2, 0)))) continue;
      if (dy === -1 && solid(bot.blockAt(c.plus(s).offset(0, 1, 0)))) continue;
      if (!bunker.standable(bot, to) || near(to) || lavaWithin(bot, to, 1)) continue;
      seen.add(key); next.push(to);
    }
    ring = next;
  }
  return null;
}

// Back to a wall: a cell with rock at its back (the side away from the
// blazes) at feet and head, where a push lands on ground.
function awayFrom(c, from) {
  if (!from) return null;
  const dx = c.x + 0.5 - from.x, dz = c.z + 0.5 - from.z;
  return Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
}
function wallSite(bot, from, { steps = 8, avoid = [] } = {}) {
  const ok = c => { const back = awayFrom(c, from); return !!back && solid(bot.blockAt(c.plus(back))) && solid(bot.blockAt(c.plus(back).offset(0, 1, 0))) && knockLands(bot, c); };
  const found = walkTo(bot, ok, { steps, avoid });
  return found && { ...found, back: awayFrom(found.cell, from) };
}

// The spawner's cage, within three of it under a ceiling: its blazes come
// out there, a ceiling keeps them from hovering over the bot, and ground
// round it takes a push.
function spawnerAt(bot) {
  const id = bot.registry?.blocksByName?.spawner?.id;
  if (id === undefined || typeof bot.findBlocks !== 'function') return null;
  return bot.findBlocks({ matching: id, maxDistance: SPAWNER_SEARCH, count: 1 })[0] || null;
}
function spawnerSite(bot, spawner = spawnerAt(bot), { steps = 24, avoid = [] } = {}) {
  if (!spawner) return null;
  const centre = spawner.offset(0.5, 0.5, 0.5);
  // Under a ceiling, or with rock at the back on the side away from the
  // cage: a blaze out of the cage comes to the bot from the front, where
  // the shield faces (the fortress drill's spawner stands on an open floor
  // by a wall, as the trials' did, and a ceiling was never there).
  const backed = c => { const back = awayFrom(c, centre); return !!back && solid(bot.blockAt(c.plus(back))) && solid(bot.blockAt(c.plus(back).offset(0, 1, 0))); };
  const ok = c => c.offset(0.5, 0.5, 0.5).distanceTo(centre) <= SPAWNER_NEAR && (solid(bot.blockAt(c.offset(0, 2, 0))) || backed(c)) && knockLands(bot, c);
  const found = walkTo(bot, ok, { steps, avoid });
  return found && { ...found, spawner, off: round(found.cell.offset(0.5, 0.5, 0.5).distanceTo(centre)) };
}

// Where a blaze hovers once it has a target, read from the 26.1.2 server
// jar (Blaze.customServerAiStep): it rises only while the target's eyes are
// more than its allowedHeightOffset above its own, and otherwise sinks,
// slowed; the offset is 0.5 plus a triangle of 6.891 either way, picked
// again every hundred ticks. So it keeps its eyes about the target's, most
// often half a block under, anywhere from about seven below to six above,
// and a new height every five seconds. One in front of a hole's mouth that
// is above or below its line now is in it at one of those picks: counted
// from half their five seconds (mid-235-q-nether-3 opened its pocket's wall
// toward eight blazes told none of the two in sight would see in; the one
// that came down to its level twenty blocks out, square in front of the
// mouth, shot it from 7 to none, note 548).
const HEIGHT_PICK_SECONDS = 5;
const SETTLE_SECONDS = HEIGHT_PICK_SECONDS / 2;
const BLAZE_EYE = 1.53;
function settlesInto(bot, blaze, cell, open) {
  const { lineClear } = require('./danger');
  if (!blaze.position) return false;
  const eye = new Vec3(blaze.position.x, cell.y + 1.62 - 0.5, blaze.position.z);
  return [1.6, 0.9, 0.15].some(dy => lineClear(bot, eye, cell.offset(0.5, dy, 0.5), { open }));
}
// What the mobs cost for a stand: the walk and the digging first, in their
// fire as it is now; then, there, fifteen seconds held, the shooters that
// see it shooting and the blazes that come fought one at a time (or as many
// as the cells round it allow). A blaze that comes to a hole's mouth swings
// for its six, not a fireball. Held in a hole (`pinned`) the bot fights
// only what comes to the mouth: a blaze that sees in hovers and shoots for
// the whole hold, the sword never reaching it, and those in front of the
// mouth come into its line as they settle (settlesInto). The fifteen are
// counted after the setup, not within it: a window dug by hand for twenty
// seconds was priced at nothing, its hold after the digging not counted.
function standCost(bot, danger, { setup = 0, at = null, open = null, atOnce = Infinity, melee = false, pinned = false } = {}) {
  const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
  const { defenseWeapon, shooter } = require('./combat');
  const weapon = defenseWeapon(bot)?.name || null, shield = bot.inventory?.slots?.[45]?.name === 'shield';
  const base = danger.slice(0, pinned ? 12 : 8);
  const shooting = base.filter(t => shooter(t.entity)).map(t => t.entity);
  const seeing = at ? new Set(bunker.seenFrom(bot, shooting, at, { open }).map(e => e.id)) : null;
  const settling = pinned && at ? new Set(shooting.filter(e => e.name === 'blaze' && !seeing.has(e.id) && settlesInto(bot, e, at, open)).map(e => e.id)) : new Set();
  const sees = t => !seeing || seeing.has(t.entity.id) || settling.has(t.entity.id);
  const burning = ce.burnLeft(bot);
  const estimate = (vis, burningFor) => ce.fightEstimate({ threats: base.map(t => ({ name: t.entity.name, distance: t.distance, shoots: vis(t) === 'melee' ? false : shooter(t.entity), id: t.entity.id,
    ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: vis(t) !== false })), armour: worn, weapon, health: bot.health, shield,
    poisonedFor: ce.effectLeft(bot, 'poison')?.seconds || 0, burningFor }).mobs;
  const now = estimate(t => t.visible, burning);
  const there = estimate(t => shooter(t.entity) ? (sees(t) ? true : melee && t.entity.name === 'blaze' ? 'melee' : false) : true, Math.max(0, burning - setup));
  const hit = Math.round(ce.afterArmour(ce.FIREBALL.melee, ce.armourOf(worn)) * 10) / 10;
  for (const m of there) if (m.name === 'blaze' && !m.shoots) m.hitsBot = hit;
  const first = setup ? ce.stanceCost({ mobs: now, setup, seconds: setup }) : { damage: 0, blasts: [] };
  const rest = ce.stanceCost({ mobs: there, seconds: ce.HOLD_SECONDS, fight: { atOnce, only: pinned ? m => !m.shoots : m => !m.shoots || m.name === 'blaze' },
    reaches: m => settling.has(m.id) ? SETTLE_SECONDS : m.shoots || m.name === 'creeper' || m.name === 'warden', shield });
  return { seconds: round(setup + ce.HOLD_SECONDS), setup: round(setup), damage: round(first.damage + rest.damage), blasts: [...first.blasts, ...rest.blasts], still: rest.still, later: rest.later, mobs: there,
    seeing: seeing ? seeing.size : null, settling: settling.size, shooters: shooting.length };
}

// A blaze's volley, read from the 26.1.2 jar (Blaze.BlazeAttackGoal): with
// a target in sight more than two blocks off it glows (its charged flag,
// entity metadata 16, bit 0) for three seconds, throws three fireballs 0.3
// seconds apart, stops glowing, and rests five seconds before glowing
// again; within two it swings instead. The glow is seen from the client
// before the shots, so the shield can be up for the volley and down for
// the rest: a shield held up walks at a fifth of a walk and swings
// nothing, and one raised at the fireball itself is late at close range
// (a shield takes a quarter second to block). Up from 2.4 seconds into the
// glow, down a second after it ends, when the last shot has crossed.
const BLAZE_FLAGS = 16;
const VOLLEY = { glow: 3, shots: [3, 3.3, 3.6], rest: 5, shieldFrom: 2.4, flightMs: 1000 };
const charged = e => !!(e?.metadata?.[BLAZE_FLAGS] & 1);
function volleyWatch(bot) {
  if (bot._volleyWatch) return;
  bot._volleyWatch = true;
  const seen = e => {
    if (e?.name !== 'blaze') return;
    const c = charged(e);
    if (c && !e._glowAt) e._glowAt = Date.now();
    if (!c && e._glowAt) { e._restAt = Date.now(); e._glowAt = null; }
  };
  bot.on('entityUpdate', seen); bot.on('entitySpawn', seen);
  // BLAZE_DEBUG: every hurt with the shield, the fire, the cell and each
  // blaze in sight (its distance, * glowing, its angle off the facing).
  if (process.env.BLAZE_DEBUG) {
    let hp = bot.health;
    const act = bot.activateItem.bind(bot), deact = bot.deactivateItem.bind(bot);
    bot.activateItem = (...a) => { bot._dbgRaisedAt = Date.now(); bot._dbgRaises = (bot._dbgRaises || 0) + 1; return act(...a); };
    bot.deactivateItem = (...a) => { bot._dbgLoweredAt = Date.now(); return deact(...a); };
    bot.on('health', () => {
      if (bot.health < hp) {
        const yaw = bot.entity.yaw, face = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const seen = blazesSeeing(bot).map(e => { const d = e.position.minus(bot.entity.position); const n = Math.hypot(d.x, d.z) || 1;
          return `${e.id}@${round(e.position.distanceTo(bot.entity.position))}${charged(e) ? '*' : ''} ${Math.round(Math.acos(Math.max(-1, Math.min(1, (d.x * face.x + d.z * face.z) / n))) * 180 / Math.PI)}deg`; });
        debug('hurt', round(hp - bot.health), 'to', round(bot.health), bot._shieldRaised ? 'shield up' : 'shield down', `using ${bot.entity.metadata?.[8]}`,
          `raised ${Date.now() - (bot._dbgRaisedAt || 0)}ms ago (lowered ${Date.now() - (bot._dbgLoweredAt || 0)}ms ago, ${bot._dbgRaises} raises)`, bot.entity.metadata?.[0] & 1 ? 'alight' : '',
          flamesTouching(bot).length ? 'in flames' : '', `${bot.entity.position.floored()}`, bot._survivalGoal?.step?.action || '', seen.join(' '));
      }
      hp = bot.health;
    });
  }
}
// A volley of this blaze's is coming or in the air now. A glow first seen
// part way through is taken as due.
function volleyDue(bot, e, now = Date.now()) {
  if (charged(e)) return !e._glowAt || now - e._glowAt >= VOLLEY.shieldFrom * 1000;
  return !!e._restAt && now - e._restAt < VOLLEY.flightMs;
}
// Seconds until this blaze can next shoot: its rest left, or its glow's.
function volleyIn(bot, e, now = Date.now()) {
  if (charged(e)) return e._glowAt ? Math.max(0, VOLLEY.glow - (now - e._glowAt) / 1000) : 0;
  if (e._restAt) return Math.max(0, VOLLEY.rest + VOLLEY.glow - (now - e._restAt) / 1000);
  return VOLLEY.glow;
}

// The blazes with a line to the bot, within their forty-eight.
function blazesSeeing(bot) {
  try { return require('./danger').threats(bot, ce.RANGE.blaze).filter(t => t.entity.name === 'blaze' && t.visible).map(t => t.entity); }
  catch (_) { return []; }
}
// The flames the bot's body is in: the feet and head cells of each column
// its box touches. A blaze's fireball that misses lights the ground where
// it lands, one blocked by the shield glances off and lands near, and a
// body stood in fire is lit again every moment it stays: the fortress
// drill burned from 17 to none behind a raised shield, standing in the
// flames its own blocked volleys had lit (2026-09-28).
const FLAMES = new Set(['fire', 'soul_fire']);
function flamesTouching(bot) {
  const p = bot.entity?.position;
  if (!p || typeof bot.blockAt !== 'function') return [];
  const found = new Map();
  for (const dx of [-0.3, 0.3]) for (const dz of [-0.3, 0.3]) for (const dy of [0, 1]) {
    const c = new Vec3(Math.floor(p.x + dx), Math.floor(p.y) + dy, Math.floor(p.z + dz));
    const b = bot.blockAt(c);
    if (b && FLAMES.has(b.name)) found.set(`${c}`, b);
  }
  return [...found.values()];
}
// Put out with a punch, as a player does: fire breaks at the first hit.
async function putOutFlames(bot, task) {
  const flames = flamesTouching(bot);
  if (!flames.length || typeof bot.dig !== 'function') return false;
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  require('./combat').lowerShield(bot);
  for (const b of flames) {
    try { await bot.dig(b, true); } catch (err) { debug('flames', err.message); }
    task.check();
  }
  return true;
}

// The reflex for a volley: while a blaze that sees the bot has one due
// (volleyDue), stop, face it (the middle of those due: a shield covers the
// half in front) and hold the shield until it has gone by. Faster than a
// question, as the shield against an arrow already in flight is. Measured
// on the arena server (scripts/blaze-probe.js, one blaze five blocks off,
// iron armour, 2026-09-28): standing with the shield down, 15.5 damage in
// 31 seconds, 8 of it the fire; timed to the glow, 1 in 36.
async function shieldVolley(bot, task, { holdMs = 4500, graceMs = 300, toward = null } = {}) {
  if (bot.inventory?.slots?.[45]?.name !== 'shield') return false;
  volleyWatch(bot);
  const due = () => blazesSeeing(bot).filter(e => volleyDue(bot, e));
  let now = due();
  if (!now.length) return false;
  const { raiseShield, lowerShield } = require('./combat');
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  // Held through the whole of it: a shield lowered and raised again takes
  // a quarter second to block, and a blaze glimpsed and lost for a tick
  // (another in the line) is still shooting. Down only once none has had a
  // volley due for `graceMs`.
  const deadline = Date.now() + holdMs;
  let last = now, lastDue = Date.now(), over = false;
  try {
    while (Date.now() < deadline) {
      if (now.length) { last = now; lastDue = Date.now(); }
      else if (Date.now() - lastDue > graceMs) { over = true; break; }
      // Flames at the feet are put out first: they light the bot again
      // every moment, the volley only if it lands.
      if (flamesTouching(bot).length) { await putOutFlames(bot, task); }
      const c = last.reduce((sum, e) => sum.plus(e.position), new Vec3(0, 0, 0)).scaled(1 / last.length);
      await bot.lookAt(c.offset(0, 0.9, 0), true);
      raiseShield(bot);
      bot._threatResponseAt = Date.now();
      // Going somewhere the shield faces: on, crouched behind it, which
      // holds the bot at an edge, and not into fire.
      const on = toward && advanceOk(bot, c, toward);
      bot.setControlState?.('sneak', !!on); bot.setControlState?.('forward', !!on);
      task.check();
      await sleep(50);
      now = due();
    }
    bot.setControlState?.('forward', false); bot.setControlState?.('sneak', false);
  } catch (err) { over = true; throw err; }
  finally { if (over) lowerShield(bot); }
  return true;
}

// Walking on behind the shield: the way on is within sixty degrees of
// where it faces, and the cell ahead is not fire, lava or a drop.
function advanceOk(bot, facing, toward) {
  const p = bot.entity.position, a = facing.minus(p), b = toward.minus(p);
  const na = Math.hypot(a.x, a.z), nb = Math.hypot(b.x, b.z);
  if (!na || nb < 1.5 || (a.x * b.x + a.z * b.z) / (na * nb) < 0.5) return false;
  const ahead = p.offset(a.x / na * 0.8, 0, a.z / na * 0.8).floored();
  const cells = [ahead, ahead.offset(0, 1, 0)].map(c => bot.blockAt(c));
  if (cells.some(x => !x || x.boundingBox !== 'empty' || FLAMES.has(x.name) || /lava/.test(x.name))) return false;
  const under = bot.blockAt(ahead.offset(0, -1, 0));
  return under?.boundingBox === 'block' && !/magma/.test(under.name);
}

// Where to stand to strike a blaze: ground within two blocks across of
// it, near the bot's height, where a push lands on ground; the nearest to
// the bot first. None, and the blaze hovers over lava or a drop.
function strikeCells(bot, blaze) {
  const p = blaze.position, y = bot.entity.position.floored().y, out = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const dy of [0, -1, 1]) {
    const c = new Vec3(Math.floor(p.x) + dx, y + dy, Math.floor(p.z) + dz);
    // A push lands on ground from it, with a block to spare: the sword's
    // fight takes a fireball's push and a biter's knock together, and the
    // wither drill's close-in went over a fortress edge three off into the
    // lava sea (2026-09-28).
    if (!bunker.standable(bot, c) || !knockLands(bot, c) || terrain.dropWithin(bot, c, KNOCK + 1) || lavaWithin(bot, c, KNOCK + 1)) continue;
    // Within the sword's three of where the blaze hovers.
    if (c.offset(0.5, 1.62, 0.5).distanceTo(p.offset(0, 0.9, 0)) > 3.2) continue;
    out.push(c);
  }
  return out.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
}

// Going at the blazes is Jev's choice (close_in, break_spawner, a
// sortie): they are the fight's, as the hunt's are (danger.js hunted), so
// the walk may step nearer them. Unclaimed, every cell nearer a shooter in
// sight was refused (safeFromHostiles) and the fortress drill's walks to
// the blazes and to the cage found no path at all.
const claimBlazes = bot => { bot._huntingEntity = { name: 'blaze', until: Date.now() + 5000 }; };

// A volley due from any blaze that sees the bot, with a shield to meet it.
const volleyComing = bot => shieldCarried(bot) && (volleyWatch(bot), blazesSeeing(bot).some(e => volleyDue(bot, e)));

// A blaze a step or two from reach, from a stand: a step out to where the
// sword reaches it, the swings, and back to the stand. Holding a hole or a
// wall struck only what came within the sword's three, and a blaze hovers
// just past it: mid-242-ac-nether-3-fortress-1 held a bunker with one 3.6
// blocks off, burning, and took two fireballs from it with no swing
// thrown (2026-09-28 04:56). Only between volleys, only to ground a push
// lands on, and only two steps from the stand.
const SORTIE_STEPS = 2;
async function sortie(bot, task, goal, save, home, { reach = 5, ms = 3500 } = {}) {
  if (!home) return false;
  const { canStrike, strike } = require('./combat');
  const near = blazesSeeing(bot).filter(e => e.position.distanceTo(bot.entity.position) <= reach && !canStrike(bot, e))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  if (!near.length || volleyComing(bot)) return false;
  const blaze = near[0];
  const cell = strikeCells(bot, blaze).find(c => Math.abs(c.x - home.x) + Math.abs(c.z - home.z) <= SORTIE_STEPS && Math.abs(c.y - home.y) <= 1);
  if (!cell) return false;
  const { move } = require('./motion');
  const live = () => bot.entities[blaze.id] === blaze && blaze.isValid !== false;
  const walk = to => move(bot, task, { label: 'blaze_sortie', keys: ['forward'], sneak: true, why: 'a step or two to a blaze just past the sword, crouched: it holds at an edge',
    look: to.offset(0.5, 1.6, 0.5), maxMs: 1500, tick: 40, until: () => Math.hypot(bot.entity.position.x - to.x - 0.5, bot.entity.position.z - to.z - 0.5) < 0.35 || (to === cell && live() && canStrike(bot, blaze)) });
  debug('sortie', blaze.id, round(blaze.position.distanceTo(bot.entity.position)), `${cell}`);
  claimBlazes(bot);
  goal.step = { action: 'blaze_sortie', blaze: blaze.id }; save?.();
  require('./combat').lowerShield(bot);
  const deadline = Date.now() + ms;
  try {
    await walk(cell);
    while (Date.now() < deadline && live()) {
      task.check();
      if (volleyComing(bot) && !canStrike(bot, blaze)) break;
      if (!canStrike(bot, blaze)) { await sleep(100); continue; }
      const wait = (ce.SWING_MS.sword || 625) - (Date.now() - (bot._defenseAttackAt || 0));
      if (wait > 0) { await sleep(Math.min(wait, 150)); continue; }
      bot.clearControlStates?.();
      await bot.lookAt(blaze.position.offset(0, 0.9, 0), true);
      await strike(bot, task, blaze);
      bot._defenseAttackAt = bot._threatResponseAt = Date.now();
      bot._struck = { id: blaze.id, at: bot._defenseAttackAt };
    }
  } finally {
    bot.clearControlStates?.();
    if (!bot.entity.position.floored().equals(home)) await walk(home).catch(() => {});
  }
  return true;
}

// Breaking the spawner, as a player overwhelmed at one does: a walk to
// within a block reach of its cage behind the shield, the pickaxe to it
// (hardness 5: about a second and a half with iron), then at the blazes
// left with the sword (closeIn). No more come from it; the rods then come
// from those about and the blazes a fortress makes on its own. At a live
// spawner every stand the arena measured lost (the fortress drill,
// 2026-09-28): up to four more every ten to forty seconds while the bot
// is within sixteen, until six are about.
function breakSite(bot, cage = spawnerAt(bot), { steps = 30, avoid = [] } = {}) {
  if (!cage) return null;
  const pick = bot.inventory?.items?.().find(i => /_pickaxe$/.test(i.name));
  if (!pick) return null;
  const centre = cage.offset(0.5, 0.5, 0.5);
  const found = walkTo(bot, c => c.offset(0.5, 1.62, 0.5).distanceTo(centre) <= 4.2 && knockLands(bot, c), { steps, avoid });
  if (!found) return null;
  const digMs = bunker.blockDigMs(bot, bot.blockAt(cage));
  return { ...found, spawner: cage, pick: pick.name, digMs, off: round(found.cell.offset(0.5, 0.5, 0.5).distanceTo(centre)) };
}
async function breakSpawner(bot, task, goal, save, site, { navigate, seconds = CLOSE_SECONDS, item = 'blaze_rod', want = Infinity } = {}) {
  const started = Date.now();
  const cage = site.spawner, centre = cage.offset(0.5, 0.5, 0.5);
  const within = () => bot.entity.position.offset(0, 1.62, 0).distanceTo(centre) <= 4.4;
  goal.step = { action: 'break_spawner', spawner: { ...cage } }; save?.();
  while (Date.now() - started < seconds * 1000 && bot.blockAt(cage)?.name === 'spawner') {
    task.check();
    bot._threatResponseAt = Date.now();
    claimBlazes(bot);
    if (await putOutFlames(bot, task)) continue;
    if (await shieldVolley(bot, task, { toward: centre })) continue;
    if (!within()) {
      if (!navigate) break;
      // Any cell within three of the cage: the one found may be burning.
      try { await navigate(bot, task, new goals.GoalNear(cage.x, cage.y, cage.z, 3), { timeoutMs: 2500, stallMs: 1200, onFoot: true, sprint: true, stopWhen: () => within() || volleyComing(bot) }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; debug('break walk', err.message); }
      await sleep(50);
      continue;
    }
    bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
    require('./combat').lowerShield(bot);
    const pick = bot.inventory.items().find(i => /_pickaxe$/.test(i.name));
    if (!pick) break;
    await bot.equip(pick, 'hand');
    try { await bot.dig(bot.blockAt(cage), true); } catch (err) { task.check(); debug('break dig', err.message); }
    await sleep(50);
  }
  const broke = bot.blockAt(cage)?.name !== 'spawner';
  debug('spawner', broke ? 'broken' : 'standing');
  const left = seconds - (Date.now() - started) / 1000;
  const { kills } = left > 3 ? await closeIn(bot, task, goal, save, { navigate, seconds: left, item, want }) : { kills: 0 };
  return { broke, kills };
}

// The fight a player with a sword and a shield takes to blazes: at the
// nearest that can be stood under, walking in while their volleys rest
// and stopping behind the shield for each that comes (shieldVolley),
// striking whatever is in reach, and picking up a rod that falls near
// between volleys. Ends after `seconds`, with `want` rods carried, or with
// no blaze left that ground reaches.
async function closeIn(bot, task, goal, save, { navigate, seconds = 45, item = 'blaze_rod', want = Infinity } = {}) {
  const { threats } = require('./danger');
  const { canStrike, defendNearby, defenseWeapon, strike } = require('./combat');
  const { countOf } = require('./skills');
  volleyWatch(bot);
  const deadline = Date.now() + seconds * 1000, skip = new Map();
  let kills = 0, target = null, walked = 0;
  const onDeath = e => { if (e?.name === 'blaze' && Date.now() - (bot._struck?.at || 0) < 6000) kills++; };
  bot.on('entityDead', onDeath);
  const live = e => e && bot.entities[e.id] === e && e.isValid !== false;
  const anyDue = () => blazesSeeing(bot).some(e => volleyDue(bot, e));
  try {
    const sword = defenseWeapon(bot);
    if (sword && bot.heldItem?.name !== sword.name) await bot.equip(sword, 'hand');
    // Asked again once as much health is gone as a stance holds for
    // (danger.js STANCE_HEALTH): the fight's price is Jev's to weigh again
    // with what is left, not the close-in's to run on to its end.
    const startHealth = bot.health ?? 20, { STANCE_HEALTH } = require('./danger');
    while (Date.now() < deadline && countOf(bot, item) < want) {
      task.check();
      if (startHealth - (bot.health ?? 20) >= STANCE_HEALTH) { debug('close-in: health down', round(startHealth - bot.health)); break; }
      bot._threatResponseAt = Date.now();
      claimBlazes(bot);
      if (await putOutFlames(bot, task)) continue;
      // A biter at arm's length first (a wither skeleton by the blazes):
      // it lands every second the sword spends on a blaze, and withers.
      const { shooter } = require('./combat');
      if (threats(bot, 4).some(t => !shooter(t.entity) && canStrike(bot, t.entity)) && await defendNearby(bot, task, goal, save)) continue;
      // Then a blaze in reach, before the shield: a swing lowers it for a
      // moment, and a blaze in reach killed shoots no more (the one hunted
      // is not among the threats the defence swings at). The one struck
      // last first while it is in reach: a player finishes the blaze it has
      // hurt; swung at whichever was nearest, the drill's ten swings went
      // on five blazes and killed one.
      const reachable = blazesSeeing(bot).filter(e => canStrike(bot, e)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
      const hurt = bot._struck && Date.now() - bot._struck.at < 4000 ? reachable.find(e => e.id === bot._struck.id) : null;
      if (hurt) target = hurt;
      else if (reachable.length && !(live(target) && canStrike(bot, target))) target = reachable[0];
      const inReach = live(target) && canStrike(bot, target) ? target : null;
      if (!inReach && await shieldVolley(bot, task, { toward: live(target) ? target.position : null })) continue;
      if (inReach) {
        const wait = (ce.SWING_MS.sword || 625) - (Date.now() - (bot._defenseAttackAt || 0));
        if (wait > 0) { await sleep(Math.min(wait, 150)); continue; }
        bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
        require('./combat').lowerShield(bot);
        await bot.lookAt(inReach.position.offset(0, 0.9, 0), true);
        task.check();
        if (live(inReach) && canStrike(bot, inReach)) {
          debug('strike', inReach.id, round(inReach.position.distanceTo(bot.entity.position)));
          await strike(bot, task, inReach);
          bot._defenseAttackAt = bot._threatResponseAt = Date.now();
          bot._struck = { id: inReach.id, at: bot._defenseAttackAt };
        }
        await sleep(50);
        continue;
      }
      if (await defendNearby(bot, task, goal, save)) continue;
      // A rod on the floor near, between volleys.
      const rod = Object.values(bot.entities).find(e => e.getDroppedItem?.()?.name === item && e.position.distanceTo(bot.entity.position) < 8);
      if (rod && navigate) {
        const before = countOf(bot, item), r = rod.position.floored();
        try { await navigate(bot, task, new goals.GoalNear(r.x, r.y, r.z, 0.5), { timeoutMs: 3000, stallMs: 1200, onFoot: true, stopWhen: () => countOf(bot, item) > before || !live(rod) || anyDue() }); }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
        await sleep(50);
        continue;
      }
      if (!live(target) || (skip.get(target.id) || 0) > Date.now()) {
        const about = threats(bot, ce.RANGE.blaze).filter(t => t.entity.name === 'blaze' && !((skip.get(t.entity.id) || 0) > Date.now()));
        target = about.sort((a, b) => (b.visible - a.visible) || a.distance - b.distance)[0]?.entity || null;
      }
      if (!target) {
        // All set aside for now (over lava, or no way yet): face the
        // nearest behind the shield and look again, rather than ending.
        const any = blazesSeeing(bot).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
        if (!any && !threats(bot, ce.RANGE.blaze).some(t => t.entity.name === 'blaze')) { debug('no blaze left'); break; }
        if (any) await bot.lookAt(any.position.offset(0, 0.9, 0), true);
        await sleep(250);
        continue;
      }
      const cells = strikeCells(bot, target);
      goal.step = { action: 'close_in', blaze: target.id, distance: round(target.position.distanceTo(bot.entity.position)), kills, health: bot.health }; save?.();
      if (!cells.length || !navigate) { debug('no ground under', target.id, target.position.floored()); skip.set(target.id, Date.now() + 6000); target = null; await sleep(150); continue; }
      const to = cells[0], from = target.position.distanceTo(bot.entity.position);
      try {
        await navigate(bot, task, new goals.GoalBlock(to.x, to.y, to.z), { timeoutMs: 2500, stallMs: 1200, onFoot: true, sprint: true,
          stopWhen: () => !live(target) || canStrike(bot, target) || anyDue() });
        walked++;
      } catch (err) {
        task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err;
        // A route cut short by its search time still walked part of the
        // way; only a walk that got no nearer sets the blaze aside.
        const nearer = live(target) && from - target.position.distanceTo(bot.entity.position) >= 1;
        debug('walk failed', target.id, err.message, nearer ? '(nearer)' : '');
        if (!nearer) { skip.set(target.id, Date.now() + 6000); target = null; }
      }
      // Under it and out of reach: it keeps its eyes near the bot's, so wait
      // a moment facing it rather than walking off.
      if (live(target) && !canStrike(bot, target) && at(bot, to)) { await bot.lookAt(target.position.offset(0, 0.9, 0), true); await sleep(150); }
      await sleep(50);
    }
  } finally { bot.removeListener('entityDead', onDeath); bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.(); }
  return { kills, walked };
}

// What a blaze does, the game's own (26.1 Blaze: its attack goal, and a
// target it must see): said with every stand.
const BLAZE_WAYS = ` A blaze that sees the bot hangs back and shoots; one that loses sight of it flies toward it for a moment, then wanders (it gives the bot up after three seconds unseen); within two blocks it swings for ${ce.FIREBALL.melee} before armour instead of shooting, and keeps closing. A shield raised toward a fireball takes it whole, the fire with it, but not its push.`;

// A stand's figure is over its setup and the fifteen seconds held after.
const overSays = (cost, doing) => cost.setup ? `in the next ${cost.seconds} seconds this way (fifteen held after the ${doing})` : undefined;

// The stands for the blazes in `danger`, as options: { key: { description,
// expects, site, kind } }. Only with a blaze among them and a sword or axe.
function blazeStands(bot, danger, { dig = true, hunted = false, pocket = false, holds = [] } = {}) {
  const blazes = danger.filter(t => t.entity.name === 'blaze');
  const { defenseWeapon, shooter } = require('./combat');
  if (!blazes.length || !/_(sword|axe)$/.test(defenseWeapon(bot)?.name || '')) return {};
  const { costSays } = require('./survival');
  const from = bunker.centroid(blazes);
  const nearest = blazes.reduce((a, b) => (b.distance < a.distance ? b : a));
  const biting = danger.filter(t => !shooter(t.entity)).map(t => t.entity);
  const hp = bot.health ?? 20;
  const fire = ce.fireballSays(nearest.distance);
  const oneHit = m => Math.max(0, ...m.filter(x => x.name !== 'creeper').map(x => x.hitsBot || 0));
  const options = {};
  // Every blaze within its forty-eight, and how many see a stand's cell:
  // a stand no blaze sees is a wait for one to come (holdSays).
  let aboutAll = blazes.map(t => t.entity);
  try { aboutAll = [...aboutAll, ...require('./danger').threats(bot, ce.RANGE.blaze).filter(t => t.entity.name === 'blaze' && !aboutAll.includes(t.entity)).map(t => t.entity)]; } catch (_) { /* no world */ }
  const seeingAt = cell => bunker.seenFrom(bot, aboutAll, cell).length;
  const hole = pocket ? (dig ? windowSite(bot, from) : null) : dig ? holeSite(bot, from) : inHole(bot);
  if (hole) {
    const open = new Set((hole.window || [hole.hole, hole.hole.offset(0, 1, 0)]).map(c => `${c}`));
    const setup = hole.inside ? 0 : round((hole.ms + 250) / 1000);
    // Every blaze within its reach, not only the stance's: a hole is held
    // for as long as the fight lasts, and one out at forty that comes into
    // the mouth's line shoots in as one at ten does.
    let far = [];
    try { far = require('./danger').threats(bot, ce.RANGE.blaze).filter(t => t.entity.name === 'blaze' && !danger.some(d => d.entity?.id === t.entity.id)); } catch (_) { far = []; }
    const cost = standCost(bot, [...danger, ...far], { setup, at: hole.hole, open, atOnce: 1, melee: true, pinned: true });
    const blazesAbout = blazes.length + far.length;
    const inLine = cost.seeing + cost.settling;
    const lineSays = ` Of the ${blazesAbout} blaze${blazesAbout === 1 ? '' : 's'} within their forty-eight blocks, ${inLine ? `${inLine} ${inLine === 1 ? 'has' : 'have'} a line in through the mouth: ${cost.seeing} now, and ${cost.settling} at the bot's own height, where a blaze after a target hovers (its eyes about the target's, from about seven below to six above, a new height every five seconds), counted from then; each that sees in shoots in for the whole hold, out of the sword's reach` : 'none has a line in through the mouth, now or at the bot\'s own height'}.`;
    const where = hole.walkMs ? `the wall ${round(hole.stand.offset(0.5, 0, 0.5).distanceTo(bot.entity.position))} blocks off` : 'beside the bot';
    options.dig_in_and_fight = { kind: pocket ? 'window' : 'hole', site: hole, expects: { damage: cost.damage, seconds: cost.seconds, oneHit: oneHit(cost.mobs) }, sees: inLine, about: blazesAbout,
      description: (hole.inside
        ? 'Stay in the hole the bot is in and fight from inside: rock behind it, beside it and over it, one side open.'
        : pocket ? `Open the pocket's wall toward the blazes, one wide and two high (2 blocks of ${words(hole.rock)} ${hole.with}, about ${seconds(round(hole.digMs / 1000))} of digging), and fight from inside the pocket through it.`
        : `Dig a hole one wide and two high into the ${words(hole.rock)} ${where} (2 blocks ${hole.with}, about ${seconds(round(hole.digMs / 1000))} of digging${hole.walkMs ? ` after about ${seconds(round(hole.walkMs / 1000))} of walking` : ''}, in their fire meanwhile), step in with the back to the rock and fight from inside.`) +
        ` Rock behind, beside and over the bot: a fireball's push there meets rock, not a drop; only a blaze in line with the mouth can shoot in, and one that comes to the mouth is within the sword, one at a time.` + lineSays + measuredSays('hole', bot).says +
        BLAZE_WAYS + fire + costSays(cost, hp, cost.mobs, { doing: hole.inside ? null : pocket ? 'opening it' : 'digging in', done: 'In the hole', over: overSays(cost, pocket ? 'opening' : 'digging in') }) };
  }
  const cageHole = dig && !pocket ? spawnerHoleSite(bot, undefined, { avoid: biting }) : null;
  if (cageHole) {
    const open = new Set([cageHole.hole, cageHole.hole.offset(0, 1, 0)].map(c => `${c}`));
    const setup = round((cageHole.ms + 250) / 1000);
    const cost = standCost(bot, danger, { setup, at: cageHole.hole, open, atOnce: 1, melee: true, pinned: true });
    const m = measuredSays('cage_hole', bot);
    options.dig_in_at_spawner = { kind: 'hole', site: cageHole, sees: seeingAt(cageHole.hole), about: aboutAll.length, atSpawner: true, expects: { damage: m.damage ?? cost.damage, seconds: m.damage === null ? cost.seconds : HOLD_SECONDS_SPAWNER, oneHit: oneHit(cost.mobs) },
      description: `Walk ${cageHole.steps} block${cageHole.steps === 1 ? '' : 's'} (about ${seconds(round(cageHole.walkMs / 1000))}, in their fire meanwhile) to the ${words(cageHole.rock)} ${cageHole.off} blocks from the blaze spawner's cage, dig a hole one wide and two high into it with the mouth toward the cage (2 blocks ${cageHole.with}, about ${seconds(round(cageHole.digMs / 1000))} of digging), step in and hold it, the shield up and facing each volley as it comes: the spawner puts its blazes within four blocks of itself, up to four at a time every ten to forty seconds while a player is within sixteen, and one that comes within two of the bot closes to swing, into the mouth and the sword. Rock behind, beside and over the bot: every shot comes in through the mouth, from in front where the shield faces, and none lights the cell; a push meets rock. Rods that fall at the mouth are picked up between volleys.` +
        m.says + fire + (m.damage === null ? costSays(cost, hp, cost.mobs, { doing: 'walking and digging in', done: 'In the hole', over: overSays(cost, 'walking and digging in') }) : ` About ${m.damage} damage over a hold, from ${round(hp)} health, as measured.`) };
  }
  const breaking = dig && !pocket && shieldCarried(bot) ? breakSite(bot, undefined, { avoid: biting }) : null;
  if (breaking) {
    const walk = round(breaking.steps / WALK), m = measuredSays('break', bot);
    options.break_spawner = { kind: 'break', site: breaking, expects: { damage: m.damage ?? standCost(bot, danger, { setup: walk }).damage, seconds: CLOSE_SECONDS, oneHit: oneHit(standCost(bot, danger, {}).mobs) },
      description: `Break the blaze spawner: walk ${breaking.steps} block${breaking.steps === 1 ? '' : 's'} (about ${seconds(walk)}, behind the shield for each volley as it comes) to within reach of its cage and break it with the ${words(breaking.pick)} (about ${seconds(round(breaking.digMs / 1000))} of digging), then go at the blazes left with the sword as close_in does. Broken, it makes no more, ever: the ${blazes.length} about now stay, and after them the rods come only from the blazes a fortress makes on its own, one at a time in its corridors; left standing, it makes up to four more every ten to forty seconds while the bot is within sixteen of it, until six are about.` +
        m.says + fire };
  }
  const spawner = spawnerSite(bot, undefined, { avoid: biting });
  if (spawner) {
    const setup = round(spawner.steps / WALK);
    const cost = standCost(bot, danger, { setup, at: spawner.cell, atOnce: Math.max(1, require('./survival').openCells(bot, spawner.cell)) });
    options.fight_at_spawner = { kind: 'spawner', site: spawner, expects: { damage: cost.damage, seconds: cost.seconds, oneHit: oneHit(cost.mobs) }, sees: seeingAt(spawner.cell), about: aboutAll.length, atSpawner: true,
      description: `${spawner.steps ? `Walk ${spawner.steps} block${spawner.steps === 1 ? '' : 's'} (about ${seconds(setup)}, in their fire meanwhile) to` : 'Stay at'} a cell ${spawner.off} blocks from the blaze spawner's cage, ${solid(bot.blockAt(spawner.cell.offset(0, 2, 0))) ? 'under a ceiling' : 'with rock at its back'}, with no drop or lava within a push, and fight the blazes there as they come out, the shield up and facing each volley as it comes: a spawner puts its blazes within four blocks of itself, up to four at a time every ten to forty seconds while a player is within sixteen, so there they come to the sword rather than being walked to; ${solid(bot.blockAt(spawner.cell.offset(0, 2, 0))) ? 'a ceiling keeps them from hovering over the bot' : 'the rock at its back keeps them in front, where the shield faces'}. Broken with a pickaxe, the spawner makes no more.` + measuredSays('spawner', bot).says +
        BLAZE_WAYS + fire + costSays(cost, hp, cost.mobs, { doing: spawner.steps ? 'walking there' : null, done: 'At the cage', over: overSays(cost, 'walking there') }) };
  }
  const wall = wallSite(bot, from, { avoid: biting });
  if (wall) {
    const setup = round(wall.steps / WALK);
    const cost = standCost(bot, danger, { setup, at: wall.cell, atOnce: Math.max(1, require('./survival').openCells(bot, wall.cell)) });
    options.back_to_wall = { kind: 'wall', site: wall, expects: { damage: cost.damage, seconds: cost.seconds, oneHit: oneHit(cost.mobs) }, sees: seeingAt(wall.cell), about: aboutAll.length,
      description: `${wall.steps ? `Walk ${wall.steps} block${wall.steps === 1 ? '' : 's'} (about ${seconds(setup)}, in their fire meanwhile) to` : 'Stay on'} footing with a wall at its back on the side away from the blazes and no drop or lava within ${KNOCK} blocks, and fight there: a fireball from them pushes the bot into the wall, and a push any other way lands on ground.` + measuredSays('wall', bot).says +
        BLAZE_WAYS + fire + costSays(cost, hp, cost.mobs, { doing: wall.steps ? 'walking there' : null, done: 'Back to the wall', over: overSays(cost, 'walking there') }) };
  }
  // At them with the sword and the shield timed to their volleys
  // (closeIn), priced by what the arena measured of it rather than by the
  // steady fire of the estimate: the estimate counts each fireball's
  // chance from where it is thrown and halves it behind a shield, where a
  // shield raised as the blaze glows takes the volley whole.
  const reachable = blazes.filter(t => strikeCells(bot, t.entity).length).sort((a, b) => a.distance - b.distance);
  if (shieldCarried(bot) && reachable.length) {
    const first = reachable[0], over = blazes.length - reachable.length;
    const walk = round(Math.max(0, first.distance - 3) / WALK);
    const m = measuredSays('close', bot);
    options.close_in = { kind: 'close', site: { target: first.entity.id }, expects: { damage: m.damage ?? standCost(bot, danger, {}).damage, seconds: CLOSE_SECONDS, oneHit: oneHit(standCost(bot, danger, {}).mobs) },
      description: `Go at them with the sword: walk in on the nearest blaze ground reaches (${round(first.distance)} blocks off, about ${seconds(walk)} of walking) while their volleys rest, stop and face each volley behind the shield as it comes, strike each in reach, and pick up the rods between volleys; ${reachable.length === 1 ? 'that one is' : `${reachable.length} of the ${blazes.length} are`} over ground the bot can stand on within a sword's reach of them${over ? `, ${over} over lava or a drop, fought only if it comes over ground` : ''}. A blaze glows for three seconds before its three shots and rests five seconds after; a shield raised and facing it as the glow ends takes all three whole, the fire with them, where one not raised lets about a third to a half land at five blocks, each 2.5 through iron and five seconds alight. The shield covers the half in front of the bot, so blazes on two sides at once are not all covered.` +
        m.says + fire + (m.damage === null ? '' : ` About ${m.damage} damage a run, from ${round(hp)} health${m.damage >= hp ? ' (more than the bot has)' : ''}, as measured.`) + ` It runs ${CLOSE_SECONDS} seconds, or until a rod is carried or six health is gone, and is asked again then.` };
  }
  // The hunt says what it is for, and what holding a stand is: a wait for
  // blazes to come to the sword, priced by whether any can see it, and by
  // what the holds already made from about here came to (note 585). The
  // close-in and the spawner's breaking are no holds.
  if (hunted) for (const o of Object.values(options)) o.description += ' Rods that fall near are picked up between volleys.' + (['close', 'break'].includes(o.kind) ? '' : holdSays(bot, o, holds));
  return options;
}

const shieldCarried = bot => bot.inventory?.slots?.[45]?.name === 'shield';
// How long a close-in runs before the question is asked again.
const CLOSE_SECONDS = 45;
// A hold at the cage runs up to two minutes (bunker.js HOLD_MS).
const HOLD_SECONDS_SPAWNER = 120;

// What the arena measured for each stand, with the fortress stage's kit
// (an iron sword, a shield, iron armour, an iron pickaxe, blocks), each
// taken on its own (ARENA_PREFER) in the drills from the fortress deaths
// (scripts/lib/arena.js, 2026-09-28), by the fight it was: runs, blazes
// killed, rods carried away, the damage over the run (median), deaths.
// Said with the stand, every fight measured, so a price is what happened
// and not what a formula expects; the one like the fight at hand leads
// and is its figure.
const SCENES = {
  one: 'against one blaze in the open eight blocks off',
  spawner: 'against three blazes by a live spawner twenty to twenty-five blocks off on a fortress floor over a lava sea',
  wither: 'against a wither skeleton at two blocks and two blazes eight and twenty off, by the same spawner',
  pit: 'from a pit two deep with three blazes hovering five to eight blocks over it',
};
const MEASURED = {
  close: { one: { runs: 2, kills: 2, rods: 1, damage: 2.1, deaths: 0 }, spawner: { runs: 3, kills: 6, rods: 2, damage: 21, deaths: 1 }, wither: { runs: 3, kills: 2, rods: 0, damage: 33.1, deaths: 3 } },
  break: { spawner: { runs: 3, kills: 2, rods: 1, damage: 34.1, deaths: 2 }, wither: { runs: 3, kills: 4, rods: 0, damage: 33.7, deaths: 3 } },
  cage_hole: { spawner: { runs: 3, kills: 1, rods: 1, damage: 29, deaths: 1 } },
  hole: { spawner: { runs: 3, kills: 1, rods: 0, damage: 3.1, deaths: 0 } },
  wall: { spawner: { runs: 3, kills: 0, rods: 0, damage: 34.7, deaths: 2 }, wither: { runs: 3, kills: 3, rods: 0, damage: 13.1, deaths: 0 } },
  open: { spawner: { runs: 3, kills: 1, rods: 0, damage: 39.9, deaths: 2 }, one: { runs: 5, kills: 4, rods: 2, damage: 12.4, deaths: 0 } },
  // Leaving them, and the encounter's stances as Jev chose them after.
  defer: { spawner: { runs: 5, kills: 1, rods: 0, damage: 21.1, deaths: 0 }, wither: { runs: 5, kills: 6, rods: 0, damage: 36.7, deaths: 1 } },
};
function sceneNow(bot) {
  let about = [];
  try { about = require('./danger').threats(bot, ce.RANGE.blaze); } catch (_) { about = []; }
  if (about.some(t => t.entity.name === 'wither_skeleton' && t.distance <= 8)) return 'wither';
  if (spawnerAt(bot)) return 'spawner';
  return about.filter(t => t.entity.name === 'blaze').length <= 1 ? 'one' : 'spawner';
}
function measuredSays(kind, bot = null) {
  const rows = MEASURED[kind];
  if (!rows || !Object.keys(rows).length) return { says: '', damage: null };
  const scene = bot ? sceneNow(bot) : null;
  const order = Object.keys(rows).sort((a, b) => (b === scene) - (a === scene));
  const row = r => `${SCENES[r] || r}, ${rows[r].runs} runs: ${rows[r].kills} killed, ${rows[r].rods} rod${rows[r].rods === 1 ? '' : 's'} carried away, about ${rows[r].damage} damage a run on the median, ${rows[r].deaths ? `${rows[r].deaths} death${rows[r].deaths === 1 ? '' : 's'}` : 'no deaths'}`;
  return { damage: rows[scene]?.damage ?? null, says: ` Measured in the arena with the same kit, this way: ${order.map(row).join('; ')}.` };
}

// What holding a stand for the hunt is (huntFromStand, bunker.holdBunker),
// said on each stand the hunt offers. mid-242-ab-nether-3 held a wall at
// a fortress four times in ten minutes, two minutes each, offered it as
// "About 0 damage ... none of them reaches it": true, and all it said. The
// three blazes about were heard through the walls, none could see the
// wall, and a blaze comes toward a target only once it has seen it; none
// came, none was killed, and each hold's end asked the hunt again with
// the same stand at the same price (note 585).
const HOLD_NEAR = 6, HOLDS_WINDOW_MS = 10 * 60000;
const ago = ms => ms < 90000 ? seconds(Math.max(1, Math.round(ms / 1000))) : `${Math.round(ms / 60000)} minutes`;
const times = n => n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
function holdSays(bot, o, holds = [], now = Date.now()) {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const mins = Math.round(bunker.HOLD_MS / 60000);
  let says = ` Taken, the stand is held up to ${mins === 1 ? 'a minute' : `${mins} minutes`}: the bot stays there and strikes only what comes within the sword's reach; the hold ends sooner once a rod is in hand, or once no blaze is within twenty blocks, seen or heard, for ${bunker.QUIET_MS / 1000} seconds.`;
  if (o.sees === 0 && o.about) says += ` None of the ${plural(o.about, 'blaze')} about sees this spot now (heard through the walls, or out of its line): a blaze comes toward the bot only once it has seen it, so none is coming to it, and the hold waits for one to wander into sight. Waiting does not send blazes away: they keep about the fortress they spawn in${o.atSpawner ? ', and its spawner makes more' : ''}.`;
  else if (o.sees && o.about) says += ` ${o.sees} of the ${plural(o.about, 'blaze')} about ${o.sees === 1 ? 'sees' : 'see'} this spot now.`;
  return says + (heldHereSays(bot, holds, now) || '');
}
// The holds already made from about here, and what came of each.
function heldHereSays(bot, holds = [], now = Date.now()) {
  const here = bot?.entity?.position;
  if (!here || !holds?.length) return null;
  const near = holds.filter(h => h.place && now - Date.parse(h.at) < HOLDS_WINDOW_MS && Math.hypot(h.place.x + 0.5 - here.x, h.place.y - here.y, h.place.z + 0.5 - here.z) <= HOLD_NEAR);
  if (!near.length) return null;
  const sum = k => near.reduce((n, h) => n + (h[k] || 0), 0);
  const heldFor = sum('seconds'), kills = sum('kills'), gained = sum('gained'), swings = sum('swings');
  const most = Math.max(0, ...near.map(h => h.mostInSight || 0));
  const first = Math.min(...near.map(h => Date.parse(h.at)));
  const last = near.at(-1);
  return ` Held from about here ${times(near.length)} in the last ${ago(now - first + (last.seconds || 0) * 1000)}, ${heldFor < 90 ? `${heldFor} seconds` : `${Math.round(heldFor / 6) / 10} minutes`} in all: ${kills} blaze${kills === 1 ? '' : 's'} killed, ${gained} rod${gained === 1 ? '' : 's'}, ${swings ? `${swings} swing${swings === 1 ? '' : 's'} at what came within reach` : 'no blaze came within the sword\'s reach'}, ${most ? `at most ${most} in sight at once` : 'none in sight'}${last.ended ? `; the last ended: ${ENDED[last.ended] || last.ended}` : ''}.`;
}
const ENDED = { time: 'its time was up', quiet: 'no blaze within twenty blocks for twenty seconds', rod: 'a rod in hand', hurt: 'under eight health' };

// One beat of holding a stand: a swing if something is in reach, else
// facing the way it comes from.
async function holdBeat(bot, task, goal, save, face, home = null) {
  const { defendNearby } = require('./combat');
  if (await putOutFlames(bot, task)) return true;
  if (await defendNearby(bot, task, goal, save)) return true;
  if (await shieldVolley(bot, task)) return true;
  if (home && await sortie(bot, task, goal, save, home)) return true;
  if (face) await bot.lookAt?.(face, true);
  await sleep(250);
  return true;
}
const at = (bot, cell) => bot.entity.position.floored().equals(cell);
// Going to the stand, and into the hole: one step of it, for a stance
// held and run again each tick. True while it holds or was carried out.
async function takeStand(bot, task, goal, save, option, { navigate } = {}) {
  const { site, kind } = option;
  const face = kind === 'hole' || kind === 'window' ? site.stand.offset(0.5, 1.2, 0.5) : kind === 'spawner' ? site.spawner.offset(0.5, 0.5, 0.5) : site.back ? site.cell.minus(site.back).offset(0.5, 1.2, 0.5) : null;
  // A walk that ends short says where and why: the stance failed forty
  // times in seven seconds by mid-235-p-nether-3's wall, each said to Jev
  // as "it failed" and no more (note 533).
  const goTo = async cell => {
    if (at(bot, cell)) return true;
    let why = navigate ? null : 'no way to walk';
    if (navigate) {
      try { await navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: Math.max(4000, (site.steps || site.walkMs / 250 || 1) * 750), stallMs: 1500 }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; why = err.message; }
    }
    if (at(bot, cell)) return true;
    const off = round(cell.offset(0.5, 0, 0.5).distanceTo(bot.entity.position));
    throw Object.assign(new Error(`the walk to its cell at (${cell.x}, ${cell.y}, ${cell.z}) ended ${off} blocks short${why ? `: ${why}` : ''}`), { name: 'StanceFailed' });
  };
  if (kind === 'break') {
    await breakSpawner(bot, task, goal, save, site, { navigate, seconds: 15 });
    return true;
  }
  if (kind === 'close') {
    goal.step = { action: 'close_in' }; save?.();
    await closeIn(bot, task, goal, save, { navigate, seconds: 15 });
    return true;
  }
  if (kind === 'window') {
    goal.step = { action: 'dig_in_and_fight', window: { ...site.stand } }; save?.();
    for (const c of site.window) await bunker.digCell(bot, task, c);
    await bot.lookAt?.(face, true);
    return true;
  }
  if (kind !== 'hole') return await goTo(site.cell) && holdBeat(bot, task, goal, save, face, site.cell);
  if (at(bot, site.hole)) return holdBeat(bot, task, goal, save, face, site.hole);
  if (!await goTo(site.stand)) return false;
  goal.step = { action: 'dig_in_and_fight', hole: { ...site.hole } }; save?.();
  await bunker.digCell(bot, task, site.hole.offset(0, 1, 0)); await bunker.digCell(bot, task, site.hole);
  if (!await bunker.stepTo(bot, task, site.hole)) return false;
  await bot.lookAt?.(face, true);
  return true;
}

// The hunt's run of a stand: taken, then held as the bunker is held (the
// shield up facing out, the sword at what comes, until a rod is in hand,
// the blazes are quiet or the hold runs out), then the rods picked up.
async function huntFromStand(bot, task, goal, save, actions, option, { item = 'blaze_rod', want = 1 } = {}) {
  const { countOf } = require('./skills');
  const before = countOf(bot, item);
  if (option.kind === 'break') {
    const state = goal.mobHunt ||= {};
    const { broke, kills } = await breakSpawner(bot, task, goal, save, option.site, { navigate: actions.navigate, seconds: CLOSE_SECONDS, item, want });
    const gained = countOf(bot, item) - before;
    state.standResults = [...(state.standResults || []), { at: new Date().toISOString(), kind: 'break', broke, kills, gained, health: bot.health }].slice(-12); save?.();
    return gained;
  }
  if (option.kind === 'close') {
    const state = goal.mobHunt ||= {};
    state.stand = { kind: 'close', at: Date.now() }; save?.();
    const { kills } = await closeIn(bot, task, goal, save, { navigate: actions.navigate, seconds: CLOSE_SECONDS, item, want });
    const gained = countOf(bot, item) - before;
    state.standResults = [...(state.standResults || []), { at: new Date().toISOString(), kind: 'close', kills, gained, health: bot.health }].slice(-12); save?.();
    return gained;
  }
  return bunker.keepingStep(goal, save, async () => {
    if (!await takeStand(bot, task, goal, save, option, actions)) throw new Error(`Could not take the ${option.kind === 'hole' ? 'hole' : option.kind === 'spawner' ? 'cell by the spawner' : 'wall'}`);
    const { site, kind } = option;
    const inside = kind === 'hole' ? site.hole : site.cell;
    const watch = kind === 'hole' ? site.stand : kind === 'spawner' ? site.spawner : site.cell.minus(site.back);
    const stand = { inside, watch, mouth: watch };
    const state = goal.mobHunt ||= {};
    state.stand = { kind, inside: { ...inside }, at: Date.now() }; save?.();
    // What the hold met is kept however it ends: a hold stopped by a
    // fireball is a hold that came to nothing too.
    const stats = {}, startedAt = new Date().toISOString();
    const result = gained => { state.standResults = [...(state.standResults || []), { at: startedAt, kind, place: { x: inside.x, y: inside.y, z: inside.z }, ...stats, gained, health: bot.health }].slice(-12); save?.(); };
    try { await bunker.holdBunker(bot, task, goal, save, stand, { item, want, stats }); }
    catch (err) { result(countOf(bot, item) - before); throw err; }
    await bunker.collectRods(bot, task, goal, save, stand, actions, item);
    const gained = countOf(bot, item) - before;
    result(gained);
    return gained;
  });
}

module.exports = { holdSays, heldHereSays, breakSite, breakSpawner, sortie, spawnerHoleSite, VOLLEY, MEASURED, volleyComing, flamesTouching, putOutFlames, CLOSE_SECONDS, charged, volleyWatch, volleyDue, volleyIn, shieldVolley, closeIn, strikeCells, measuredSays, blazeStands, holeSite, windowSite, inHole, wallSite, spawnerSite, spawnerAt, standCost, knockSays, knockLands, lavaWithin, takeStand, huntFromStand, BLAZE_WAYS };
