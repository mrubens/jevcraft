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
const { feetCell } = terrain;

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
function knockSays(bot, feet = feetCell(bot), { what = 'A blaze\'s fireball that lands' } = {}) {
  // With fire resistance on the body a blaze's fireball pushes nothing
  // while it lasts (note 656).
  const proof = /blaze/.test(what) ? require('./fire-resistance').left(bot) : 0;
  const drop = terrain.dropNear(bot, feet, 3);
  if (!drop || (drop.into !== 'lava' && drop.damage < 1)) return '';
  if (proof >= ce.HOLD_SECONDS) return ` ${what} does not push the bot toward the drop ${drop.blocksAway ? `${drop.blocksAway} block${drop.blocksAway === 1 ? '' : 's'} off` : 'under it'} while the fire resistance on it lasts (about ${Math.round(proof)} seconds left): a fire hurt that does not land pushes nothing.`;
  const pushes = Math.max(1, Math.ceil(drop.blocksAway / KNOCK));
  return ` ${what} pushes the bot about ${KNOCK} blocks, shield raised or not; the drop ${drop.into === 'lava' ? 'into lava ' : ''}is ${drop.blocksAway ? `${drop.blocksAway} block${drop.blocksAway === 1 ? '' : 's'} off` : 'under the bot'}: ${pushes === 1 ? 'one that lands puts' : `about ${pushes} landing in turn put`} it over.`;
}

// The hole: a cell of brick or netherrack beside a stand (where the bot is,
// or a wall within a short walk) with rock behind it, on both sides and
// over it, two blocks to dig. Its mouth faces the blazes where the rock
// allows. Already in one (rock on three sides and a roof, one side open),
// nothing to dig.
function inHole(bot, feet = feetCell(bot)) {
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
  const feet = feetCell(bot);
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
  const feet = feetCell(bot);
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
  const found = bot.findBlocks({ matching: id, maxDistance: SPAWNER_SEARCH, count: 1 })[0] || null;
  return found && bot.blockAt(found)?.name === 'spawner' ? found : null;
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
  // Fire resistance on the body: the blazes' fire counts from when it ends
  // (note 656).
  const proof = require('./fire-resistance').left(bot);
  const estimate = (vis, burningFor, fireproofFor = 0) => ce.fightEstimate({ threats: base.map(t => ({ name: t.entity.name, distance: t.distance, shoots: vis(t) === 'melee' ? false : shooter(t.entity), id: t.entity.id,
    ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: vis(t) !== false })), armour: worn, weapon, health: bot.health, shield,
    poisonedFor: ce.effectLeft(bot, 'poison')?.seconds || 0, burningFor, fireproofFor }).mobs;
  const now = estimate(t => t.visible, burning, proof);
  const there = estimate(t => shooter(t.entity) ? (sees(t) ? true : melee && t.entity.name === 'blaze' ? 'melee' : false) : true, Math.max(0, burning - setup), Math.max(0, proof - setup));
  const hit = Math.round(ce.afterArmour(ce.FIREBALL.melee, ce.armourOf(worn)) * 10) / 10;
  for (const m of there) if (m.name === 'blaze' && !m.shoots) m.hitsBot = hit;
  const first = setup ? ce.stanceCost({ mobs: now, setup, seconds: setup }) : { damage: 0, blasts: [] };
  const rest = ce.stanceCost({ mobs: there, seconds: ce.HOLD_SECONDS, fight: { atOnce, only: pinned ? m => !m.shoots : m => !m.shoots || m.name === 'blaze' },
    reaches: m => settling.has(m.id) ? SETTLE_SECONDS : m.shoots || m.name === 'creeper' || m.name === 'warden', shield });
  return { seconds: round(setup + ce.HOLD_SECONDS), setup: round(setup), damage: round(first.damage + rest.damage), blasts: [...first.blasts, ...rest.blasts], still: rest.still, later: rest.later, mobs: there,
    seeing: seeing ? seeing.size : null, settling: settling.size, shooters: shooting.length };
}

// The close-in worked from the fight at hand (note 602), where it was
// priced by the drill it was measured in: three blazes twenty to twenty-five
// off, "about 21 damage a run", said the same at a live spawner with four
// blazes nine to eleven off (mid-243-ag-fortress-1, 14.1 health) and with
// eight within one to seven (mid-242-ah-nether-2-fortress-1, 13 and 5.5),
// beside every other stance's 48 to 87: close_in was chosen each time, and
// each ended in death. The game's own numbers, blaze by blaze:
// - each that sees the bot throws three fireballs about every nine seconds
//   (FIREBALL.volleySeconds), each landing by its distance (fireballHit);
//   within two blocks it swings for six before armour, once a second
//   (Blaze.BlazeAttackGoal), instead of shooting;
// - a fireball that lands is its hit through the armour worn and five
//   seconds alight at a health a second; the chance the bot is alight at a
//   moment, with fireballs landing at λ a second, 1 - e^(-5λ);
// - the shield timed to the glow (shieldVolley) took all but about one
//   fireball in thirty from three to five blazes within about sixty degrees
//   of where it faced (scripts/blaze-probe.js, note 577); one farther round
//   is counted as if the shield were down: live, a fireball from 84 degrees
//   off the facing landed through the raised shield (mid-243-ag, 11:45:32);
// - the walk goes only while no volley is due (the shield is up from 2.4
//   seconds into a glow to a second after it, about 2.2 of each nine), so
//   with k blazes in sight the walk has the lulls, (1 - 2.2/9)^k of the
//   time;
// - a blaze in reach takes the sword's swings to kill at the pace the bot's
//   fights go (swingEvery), the shield down meanwhile, every other one
//   shooting as if it were down;
// - a live spawner within sixteen makes up to four more every ten to forty
//   seconds, about one every six, up to six about.
const SHIELD_LEAK = 1 / 30, SHIELD_COVER = 60;
const SPAWN_SECONDS = 25 / 4, SPAWN_CAP = 6;
// How many more a live spawner puts in over `seconds`, beyond the `present`
// already about (about one every six seconds, up to six about). Measured on
// the trials of 2026-09-28 at the cage at (-108, 77, 155), twelve of the
// day's deaths in its rooms: two within sixteen blocks at first sight (the
// median), five by twenty or thirty seconds, six to eight by a minute; every
// price of a fight there counted the two (note 631).
function spawnerNewcomers(present, seconds) {
  return Math.max(0, Math.min(SPAWN_CAP - present, (seconds || 0) / SPAWN_SECONDS));
}
const bearing = (from, to) => Math.atan2(to.z - from.z, to.x - from.x) * 180 / Math.PI;
const angleOff = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };
// Which blazes a shield faced at their middle covers: the middle of the arc
// they span round the bot (the widest gap between them left behind it).
// `here`: where the bot will stand (the cage's cell for break_spawner).
function shieldArc(bot, entities, here = bot.entity.position) {
  const angles = entities.map(e => bearing(here, e.position)).sort((a, b) => a - b);
  if (!angles.length) return { facing: 0, spread: 0, covered: new Set() };
  let gap = -1, after = 0;
  for (let i = 0; i < angles.length; i++) {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 360;
    if (next - angles[i] > gap) { gap = next - angles[i]; after = i; }
  }
  const start = angles[(after + 1) % angles.length], spread = angles.length === 1 ? 0 : 360 - gap;
  const facing = start + spread / 2;
  return { facing, spread: Math.round(spread), covered: new Set(entities.filter(e => angleOff(bearing(here, e.position), facing) <= SHIELD_COVER).map(e => e.id)) };
}
const lull = k => (1 - DUE_SECONDS / ce.FIREBALL.volleySeconds) ** k;
// Damage a second from the blazes in `list` that see the bot ({ d, sees,
// covered }): the shield up (walking in the lulls, behind it for each
// volley) or down (striking); `extra` more at `extraAt`, the spawner's.
function blazeRate(list, { shield, shieldUp, fireHit, meleeHit, extra = 0, extraAt = 8 }) {
  let fire = 0, melee = 0;
  for (const b of list.filter(x => x.sees)) {
    if (b.d <= ce.FIREBALL.meleeReach) { melee += meleeHit; continue; }
    const q = shield && shieldUp && b.covered ? SHIELD_LEAK : ce.fireballHit(b.d);
    fire += ce.FIREBALL.volley * q / ce.FIREBALL.volleySeconds;
  }
  fire += extra * ce.FIREBALL.volley * ce.fireballHit(extraAt) / ce.FIREBALL.volleySeconds;
  const hits = Math.min(fire * fireHit + melee, 2 * Math.max(fireHit, melee ? meleeHit : 0));
  // With fire resistance on the body the fireballs are nothing and only the
  // swings are left (note 656).
  const proofHits = Math.min(melee, 2 * (melee ? meleeHit : 0));
  return { hits, proofHits, fire, burn: 1 - Math.exp(-ce.FIRE_TICKS.fireball * fire) };
}
// What the biters among them do meanwhile (a wither skeleton by the
// blazes, a piglin brute): each gets to the bot at its own pace and strikes
// until the sword, turning to it first, has killed it, over `seconds`.
// mid-208-k-fortress-5 chose close_in at 15.3 on a price of the blazes
// alone; the walk went twenty blocks on to two wither skeletons and one
// struck it from 15.3 to 5.7 inside the stance (2026-09-28 13:56:57).
function biteCost(bot, danger, seconds) {
  const { shooter, defenseWeapon } = require('./combat');
  const biters = danger.filter(t => t.entity.name !== 'blaze' && !shooter(t.entity));
  if (!biters.length || !(seconds > 0)) return { damage: 0, biters: [] };
  const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
  const mobs = ce.fightEstimate({ threats: biters.map(t => ({ name: t.entity.name, distance: t.distance, shoots: false, visible: t.visible !== false, id: t.entity.id })),
    armour: worn, weapon: defenseWeapon(bot)?.name || null, health: bot.health ?? 20, shield: shieldCarried(bot) }).mobs;
  const cost = ce.stanceCost({ mobs, seconds, fight: { atOnce: 1 }, reaches: () => true, effectsTo: bot.health ?? 20 });
  return { damage: round(cost.damage), biters: biters.map(t => ({ name: t.entity.name, distance: round(t.distance) })), seconds };
}
// `upTo` kills and the run ends there, asked again (charge_nearest). With
// no shield there is nothing to stop behind for a volley: the walk goes on
// through them, every fireball landing at its chance.
function closeInCost(bot, danger, { shield = shieldCarried(bot), horizon = CLOSE_SECONDS, spawner = spawnerAt(bot), breakFirst = null, upTo = Infinity } = {}) {
  const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
  const armour = ce.armourOf(worn);
  const { defenseWeapon } = require('./combat');
  const weapon = defenseWeapon(bot)?.name || null;
  const fireHit = ce.afterArmour(ce.MOBS.blaze.hit, armour), meleeHit = ce.afterArmour(ce.FIREBALL.melee, armour);
  const swings = ce.fightEstimate({ threats: [{ name: 'blaze', distance: 3, shoots: true, visible: true }], armour: worn, weapon, health: 20 }).mobs[0]?.swingsToKill || 4;
  const every = ce.swingEvery(weapon), strikeSeconds = round(swings * every);
  const here = bot.entity.position;
  const blazes = danger.filter(t => t.entity.name === 'blaze');
  const seen = blazes.filter(t => t.visible);
  // Out of sight within sixteen: the walk in to strike puts the bot in
  // their sight, and they are counted as seeing it from the start.
  // mid-243-ag-fortress-4 took close_in at 2.9 health on "about 0 damage"
  // with four blazes ten to thirteen off out of sight, walked in, and two
  // fireballs ended it (2026-09-28 14:27:00, note 606).
  // The charge at the nearest alone (upTo 1) goes no farther than where it
  // strikes that one: one out of sight counts from the start only if it has
  // a line to the cell the sword strikes from (note 614: four behind the
  // walls, counted as seeing a one-block step to a blaze at four, priced
  // the charge over the fight beside it by half again).
  const strikeAt = upTo === 1 ? (() => { const n = seen.filter(t => strikeCells(bot, t.entity).length).sort((a, b) => a.distance - b.distance)[0]; return n ? strikeCells(bot, n.entity)[0] : null; })() : null;
  const into = blazes.filter(t => !t.visible && t.distance <= 16 && (!strikeAt || bunker.seenFrom(bot, [t.entity], strikeAt).length));
  const arc = shieldArc(bot, [...seen, ...into].map(t => t.entity));
  // Each blaze as the sum sees it: where it is, whether it sees the bot,
  // whether the shield faced at their middle covers it, and ground under
  // it the sword reaches from.
  let alive = blazes.map(t => ({ id: t.entity.id, at: t.entity.position, d: t.distance, sees: !!t.visible || into.includes(t), covered: arc.covered.has(t.entity.id), reach: strikeCells(bot, t.entity).length > 0 }));
  const rate = (list, { shieldUp, extra = 0, extraAt = 8 }) => blazeRate(list, { shield, shieldUp, fireHit, meleeHit, extra, extraAt });
  const burning = ce.burnLeft(bot);
  // Fire resistance on the body (note 656): until it ends the fireballs
  // are nothing and light nothing, the swings of one within two blocks
  // still land.
  const proof = require('./fire-resistance').left(bot);
  const hp = bot.health ?? 20;
  const open = rate(alive, { shieldUp: false });
  const spawnAt = spawner ? spawner.offset(0.5, 0.5, 0.5).distanceTo(here) : null;
  let spawning = spawner && spawnAt <= 16;
  let t = 0, damage = 0, kills = 0, deathAt = null, extra = 0, from = here;
  const phases = [], landings = [];
  const spend = (seconds, r, what) => {
    if (!(seconds > 0) || t >= horizon || deathAt != null) return;
    const s = Math.min(seconds, horizon - t);
    // The fire on the bot now burns on at a health a second whatever else;
    // the fire the landings so far light comes a second after each and not
    // all at once (combat-estimate burnBetween, note 647).
    landings.push({ from: t, to: t + s, perSecond: r.fire });
    const covered = Math.max(0, Math.min(s, proof - t));
    const add = r.proofHits * covered + r.hits * (s - covered) + ce.burnBetween(landings, t, t + s, burning, proof);
    if (damage + add >= hp) deathAt = round(t + (hp - damage) / Math.max(0.01, add / s));
    damage += add; t += s;
    if (spawning) extra = Math.min(Math.max(0, SPAWN_CAP - alive.length), extra + s / SPAWN_SECONDS);
    phases.push({ what, seconds: round(s), perSecond: round(add / s) });
  };
  const order = () => alive.filter(b => b.reach).sort((a, b) => a.at.distanceTo(from) - b.at.distanceTo(from));
  let firstWalk = null;
  // The spawner broken first (break_spawner): the walk to its cage in the
  // lulls, the digging with the shield down, and no more come after.
  // Priced where it is done: the digging from the cell by the cage, each
  // blaze by its distance from there (within two it swings), the shield's
  // cover as faced from there, and the walk from halfway. Priced from where
  // the bot stood, mid-242-bc-fortress-2 (25587, 17:56:27) read "about 7.8
  // damage over the 7 seconds" for a walk of five blocks to the cage the
  // blazes hovered round, one to five off it; two fireballs and a blow
  // took it from 14.3 to 1.7 in three seconds (note 623).
  let atCage = null;
  if (breakFirst) {
    const seeing = alive.filter(b => b.sees).length;
    const cell = breakFirst.at || null, there = cell ? cell.offset(0.5, 0, 0.5) : null;
    const half = there ? here.plus(there).scaled(0.5) : null;
    const standingAt = p => {
      if (!p) return alive;
      const arcThere = shieldArc(bot, alive.filter(b => b.sees).map(b => ({ id: b.id, position: b.at })), p);
      return alive.map(b => ({ ...b, d: b.at.distanceTo(p), covered: arcThere.covered.has(b.id) }));
    };
    const walking = standingAt(half), digging = standingAt(there);
    const wall = breakFirst.steps / WALK / (shield ? lull(seeing) : 1);
    firstWalk = { walk: round(breakFirst.steps / WALK), wall: round(wall), seeing };
    spend(wall, rate(walking, { shieldUp: true, extra, extraAt: spawnAt ?? 8 }), 'walk');
    spend(breakFirst.digSeconds, rate(digging, { shieldUp: false, extra, extraAt: spawnAt ?? 8 }), 'dig');
    spawning = false;
    if (cell) {
      from = cell; alive = digging;
      const ds = digging.filter(b => b.sees).map(b => b.d).sort((a, b) => a - b);
      atCage = { nearest: ds.length ? round(ds[0]) : null, within2: ds.filter(d => d <= ce.FIREBALL.meleeReach).length, within5: ds.filter(d => d <= 5).length };
    }
  }
  while (t < horizon && deathAt == null && kills < upTo && order().length) {
    const target = order()[0];
    const walk = Math.max(0, target.at.distanceTo(from) - 3) / WALK;
    const seeing = alive.filter(b => b.sees).length + Math.round(extra);
    const wall = walk / (shield ? lull(seeing) : 1);
    firstWalk ??= { walk: round(walk), wall: round(wall), seeing };
    spend(wall, rate(alive, { shieldUp: true, extra, extraAt: spawnAt ?? 8 }), 'walk');
    spend(strikeSeconds, rate(alive, { shieldUp: false, extra, extraAt: spawnAt ?? 8 }), 'strike');
    if (deathAt != null || t >= horizon) break;
    kills++; from = target.at; alive = alive.filter(b => b !== target);
    // The spawner's newcomers are fought as they come, where it puts them.
    if (spawning && extra >= 1) { alive.push({ id: `new${kills}`, at: spawner.offset(0.5, 1, 0.5), d: spawnAt, sees: true, covered: false, reach: true }); extra -= 1; }
  }
  // The rest of the run with nothing left the sword reaches: the others
  // shoot on while it faces them behind the shield.
  if (t < horizon && deathAt == null && kills < upTo && alive.some(b => b.sees)) spend(horizon - t, rate(alive, { shieldUp: true, extra, extraAt: spawnAt ?? 8 }), 'hold');
  // The biters meanwhile, over the same seconds.
  const bite = biteCost(bot, danger, Math.max(t, 1));
  if (bite.damage > 0) {
    if (deathAt == null && damage + bite.damage >= hp) deathAt = round(Math.max(0.5, t * hp / (damage + bite.damage)));
    damage += bite.damage;
  }
  return { bite, shield: !!shield, upTo, strikeOnly: !!strikeAt, atCage, damage: round(damage), seconds: round(t), deathAt, kills, seeing: seen.length, covered: seen.filter(t => arc.covered.has(t.entity.id)).length, spread: arc.spread,
    reachable: blazes.filter(t => strikeCells(bot, t.entity).length).length, blazes: blazes.length, unseen: blazes.length - seen.length - into.length, into: into.length, firstWalk, strikeSeconds, swings, every,
    lull: round(lull(seen.length), 2), fireHit: round(fireHit), meleeHit: round(meleeHit), spawning: !!spawning, phases, striking: round(open.hits + open.burn), ...(proof > 0 ? { fireproofFor: round(proof) } : {}) };
}
// The arena's rows after the sum, each said with its own fight: led by a
// row, the figure read as the price of the fight at hand (note 602).
const rowsSays = m => m.says.replace(/ Measured in the arena (with .*?), this way:/, ' The arena\'s runs of it $1, fight by fight:');
// The close-in's sum, said: what each part of it is and what it comes to.
function closeInSays(c, hp, { breaking = false } = {}) {
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const inHundred = p => Math.round(p * 100);
  const parts = [];
  parts.push(` Worked from this fight: ${c.seeing ? `${n(c.seeing, 'blaze')} ${c.seeing === 1 ? 'sees' : 'see'} the bot now${c.seeing > 1 ? `, spread over ${c.spread} degrees round it` : ''}` : 'none of them sees the bot now'}${c.into ? `; ${c.into} more about out of sight ${c.strikeOnly ? `with a line to where the sword strikes it from ${c.into === 1 ? 'is' : 'are'} counted as seeing it` : `within sixteen blocks ${c.into === 1 ? 'is' : 'are'} counted as seeing it, the walk in to strike putting the bot in their sight`}` : ''}${c.unseen ? ` (${c.unseen} more about out of sight ${c.strikeOnly ? 'with no line to where the sword strikes it from' : 'farther off'}, not counted until they see it)` : ''}.`);
  if (c.seeing && c.shield === false) parts.push(` No shield is carried: every fireball from those that see the bot lands at its chance by distance, walking or striking.`);
  else if (c.seeing) parts.push(` The shield faced at their middle covers ${c.covered === c.seeing ? (c.seeing === 1 ? 'it' : 'all of them') : `${c.covered} of them`} (within ${SHIELD_COVER} degrees of where it faces, where about one fireball in thirty still landed in the arena's probe)${c.covered < c.seeing ? `; the other ${c.seeing - c.covered} land${c.seeing - c.covered === 1 ? 's' : ''} as if it were down, as a fireball from 84 degrees off the facing did through a raised shield in a trial` : ''}.${c.seeing > 1 ? ' They move round as it fights: in the arena\'s drill of four nine to eleven off by a live spawner, 19 of the 28 fireballs that landed came with the shield raised, 14 of them with a blaze past the half it covered.' : ''}`);
  if (c.firstWalk && c.firstWalk.walk > 0 && c.shield === false) parts.push(` The ${c.firstWalk.walk} seconds of walking to ${breaking ? 'the cage' : 'the nearest'} go straight on, in their fire.`);
  else if (c.firstWalk && c.firstWalk.walk > 0) parts.push(` Each throws three about every ${Math.round(ce.FIREBALL.volleySeconds)} seconds and the shield is up about ${Math.round(DUE_SECONDS * 10) / 10} seconds of each, so with ${n(c.firstWalk.seeing, 'blaze')} at it the walk has the lulls, about ${inHundred((1 - DUE_SECONDS / ce.FIREBALL.volleySeconds) ** c.firstWalk.seeing)} in 100 of the time: the ${c.firstWalk.walk} seconds of walking to ${breaking ? 'the cage' : 'the nearest'} take about ${c.firstWalk.wall}.`);
  parts.push(` Each blaze in reach takes about ${c.swings} swings of the sword, about ${c.strikeSeconds} seconds${c.shield === false ? '' : ' with the shield down'}, while ${c.blazes === 1 ? 'it shoots' : 'every one that sees the bot shoots'}${c.shield === false ? '' : ' as if it were down'}${c.striking > 0 ? ` (about ${c.striking} damage a second from those in sight now, the burning with it)` : ''}; a fireball that lands is about ${c.fireHit} through the armour worn and five seconds alight at a health a second, and a blaze within two blocks swings for about ${c.meleeHit} once a second instead.`);
  if (breaking && c.atCage?.nearest != null) parts.push(` At the cell by the cage ${c.atCage.within5 ? `${c.atCage.within5} of them ${c.atCage.within5 === 1 ? 'is' : 'are'} within five blocks, the nearest ${c.atCage.nearest} off${c.atCage.within2 ? `, ${c.atCage.within2} within two, swinging` : ''}` : `the nearest is ${c.atCage.nearest} off`}: the digging is done with the shield down, each shooting meanwhile from where it is to there; after it no more come.`);
  else if (breaking) parts.push(' The digging is done with the shield down, the others shooting meanwhile; after it no more come.');
  else if (c.spawning) parts.push(' The spawner within sixteen blocks puts in about one more every six seconds (four every ten to forty), up to six about, and those are fought too.');
  // Fire resistance on the body (note 656), counted in the sum.
  if (c.fireproofFor > 0) parts.push(` Fire resistance is on the body, about ${Math.round(c.fireproofFor)} seconds left: until it ends a fireball that lands does nothing (no hurt, no push, no fire), and only the swing of a blaze within two blocks hurts; ${c.fireproofFor >= c.seconds ? 'it outlasts this run' : `the rest of the run after it is counted as without it`}.`);
  const reach = c.reachable < c.blazes ? ` (${c.reachable} of the ${c.blazes} over ground the sword reaches from; the rest shoot on throughout)` : '';
  if (c.bite?.damage > 0) parts.push(` ${c.bite.biters.map(b => `The ${words(b.name)} ${b.distance} blocks off`).join('; ')} ${c.bite.biters.length === 1 ? 'gets' : 'get'} to the bot meanwhile and ${c.bite.biters.length === 1 ? 'strikes' : 'strike'} until the sword, turning to ${c.bite.biters.length === 1 ? 'it' : 'each'} first, has killed ${c.bite.biters.length === 1 ? 'it' : 'them'}: about ${c.bite.damage} of the damage below, the wither and the like counted.`);
  parts.push(c.deathAt != null
    ? ` About ${c.damage} damage by then, from ${round(hp)} health: the health runs out at about ${c.deathAt} seconds in, after about ${c.kills} of them killed${reach}.`
    : c.upTo === 1 && c.kills === 1 ? ` About ${c.damage} damage over the ${c.seconds} seconds to that one killed, from ${round(hp)} health, ${round(Math.max(0, hp - c.damage))} after.`
    : c.upTo === 1 ? ` About ${c.damage} damage over the ${c.seconds} seconds, from ${round(hp)} health, and it not killed in that time${reach}.`
    : c.blazes === 1 && c.kills === 1 ? ` About ${c.damage} damage over the ${c.seconds} seconds, from ${round(hp)} health, and the blaze killed.`
    : ` About ${c.damage} damage over the ${c.seconds} seconds, from ${round(hp)} health, with about ${c.kills} of them killed${reach}.`);
  return parts.join('');
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
// The seconds of each volley the shield is up for (volleyDue): about 2.2.
const DUE_SECONDS = VOLLEY.shots[2] + VOLLEY.flightMs / 1000 - VOLLEY.shieldFrom;
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
          flamesTouching(bot).length ? 'in flames' : '', `${feetCell(bot)}`, bot._survivalGoal?.step?.action || '', seen.join(' '));
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
// `face`: a point to face instead of the blazes due, where every shot must
// come through it (a box's window): turned to the one blaze glowing, a box
// at the cage left those in line with the window on its other side outside
// the half the shield covers, and two fireballs came in (note 623).
async function shieldVolley(bot, task, { holdMs = 4500, graceMs = 300, toward = null, face = null } = {}) {
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
      await bot.lookAt(face || c.offset(0, 0.9, 0), true);
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
// it, at any height the sword reaches it from, where a push lands on
// ground; the nearest to the bot first. None, and the blaze hovers over
// lava or a drop. Sought at the bot's own height and a block either side
// only, a blaze resting on a fortress stair four up had none: the stair
// run beside it, walkable from the wart bed the bot stood in, was never
// looked at, the charge at it went off after blazes 35 blocks away, and
// it shot the bot for a minute and a half from 4.9 blocks (note 618). The
// walk finds which of them it reaches.
function strikeCells(bot, blaze) {
  const p = blaze.position, by = Math.floor(p.y), out = [];
  // Feet from four under the blaze's to two over: an eye 1.62 up within
  // 3.2 of its middle 0.9 up.
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -4; dy <= 2; dy++) {
    const c = new Vec3(Math.floor(p.x) + dx, by + dy, Math.floor(p.z) + dz);
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
// Under fourteen health the hunt's claim lapses (mob-policy fitToFight), so
// the walk is let near them by its own mark too (danger.js closingOn).
const claimBlazes = bot => { bot._huntingEntity = { name: 'blaze', until: Date.now() + 5000 }; bot._closingOn = { name: 'blaze', until: Date.now() + 5000 }; };

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
    if (!feetCell(bot).equals(home)) await walk(home).catch(() => {});
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
  const biter = require('./blaze-tactics').biterWatch(bot);
  // Asked again once as much health is gone as a stance holds for, as the
  // close-in is, the walk and the digging counted with what follows: run on
  // to the cage, mid-242-bc-fortress-2 went from 14.3 to 1.7 in three
  // seconds, a blaze's blow after two fireballs, and was asked only then
  // (note 623).
  const startHealth = bot.health ?? 20, { STANCE_HEALTH } = require('./danger');
  const hurt = () => startHealth - (bot.health ?? 20) >= STANCE_HEALTH;
  let came = null;
  while (Date.now() - started < seconds * 1000 && bot.blockAt(cage)?.name === 'spawner') {
    task.check();
    if (hurt()) { came = 'health down'; debug('break: health down', round(startHealth - bot.health)); break; }
    if ((came = biter())) break;
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
  const { kills } = left > 3 && !came ? await closeIn(bot, task, goal, save, { navigate, seconds: left, item, want, startHealth }) : { kills: 0 };
  return { broke, kills, ...(came ? { ended: came } : {}) };
}

// The fight a player with a sword and a shield takes to blazes: at the
// nearest that can be stood under, walking in while their volleys rest
// and stopping behind the shield for each that comes (shieldVolley),
// striking whatever is in reach, and picking up a rod that falls near
// between volleys. Ends after `seconds`, with `want` rods carried, or with
// no blaze left that ground reaches.
async function closeIn(bot, task, goal, save, { navigate, seconds = 45, item = 'blaze_rod', want = Infinity, upTo = Infinity, stallMs = ce.FIREBALL.volleySeconds * 1000, startHealth: begunAt = null } = {}) {
  const { threats } = require('./danger');
  const { canStrike, defendNearby, defenseWeapon, strike } = require('./combat');
  const { countOf } = require('./skills');
  volleyWatch(bot);
  const deadline = Date.now() + seconds * 1000, skip = new Map();
  let kills = 0, target = null, walked = 0, chargeOn = null;
  const walkFailedAt = new Map();
  const onDeath = e => { if (e?.name === 'blaze' && Date.now() - (bot._struck?.at || 0) < 6000) kills++; };
  bot.on('entityDead', onDeath);
  const live = e => e && bot.entities[e.id] === e && e.isValid !== false;
  // A volley due stops a walk only with a shield to meet it: without one,
  // standing still for it takes the same fire and gets no nearer.
  const anyDue = () => shieldCarried(bot) && blazesSeeing(bot).some(e => volleyDue(bot, e));
  // Getting somewhere (note 602): a swing, a rod, or a block nearer the
  // blaze it goes for. mid-243-ag-fortress-1 chose it at 14.1 with four
  // blazes nine to eleven off and stood 22 seconds on one cell behind the
  // shield, never a step nor a swing, burning to 7.1; chosen again, the
  // same to 0.4. A volley's cycle with none of these ends it, said why, so
  // the next question has it.
  const started = Date.now(), cycleMs = stallMs;
  const stats = { shieldMs: 0, noGround: 0, walkFailed: 0, lastWhy: null };
  let progressAt = started, closest = null, closestFor = null, swungAt = bot._defenseAttackAt || 0, rods = countOf(bot, item);
  const progressed = () => {
    if ((bot._defenseAttackAt || 0) > swungAt || countOf(bot, item) > rods) { swungAt = bot._defenseAttackAt || 0; rods = countOf(bot, item); progressAt = Date.now(); }
    if (!live(target)) return;
    const d = target.position.distanceTo(bot.entity.position);
    if (closestFor !== target.id) { closestFor = target.id; closest = d; return; }
    if (d <= closest - 1) { closest = d; progressAt = Date.now(); }
  };
  let stalled = null, interrupted = null;
  const stallSays = () => {
    const secs = Math.round((Date.now() - progressAt) / 1000);
    const parts = [`${secs} seconds without a step nearer a blaze or a swing`];
    if (stats.shieldMs >= 1000) parts.push(`the shield up for volleys ${Math.round(stats.shieldMs / 1000)} of them, from ${blazesSeeing(bot).length} blaze${blazesSeeing(bot).length === 1 ? '' : 's'} in sight`);
    if (stats.walkFailed) parts.push(`the walk to one failed ${stats.walkFailed === 1 ? 'once' : `${stats.walkFailed} times`}${stats.lastWhy ? ` (${stats.lastWhy})` : ''}`);
    if (stats.noGround) parts.push(`no ground within the sword's reach of ${stats.noGround === 1 ? 'one' : `${stats.noGround} of them`}`);
    return parts.join('; ');
  };
  try {
    const sword = defenseWeapon(bot);
    if (sword && bot.heldItem?.name !== sword.name) await bot.equip(sword, 'hand');
    // Asked again once as much health is gone as a stance holds for
    // (danger.js STANCE_HEALTH): the fight's price is Jev's to weigh again
    // with what is left, not the close-in's to run on to its end.
    // `begunAt`: the health the stance began at, when the close-in follows
    // its walk and digging (breakSpawner).
    const startHealth = begunAt ?? bot.health ?? 20, { STANCE_HEALTH } = require('./danger');
    const biter = require('./blaze-tactics').biterWatch(bot);
    while (Date.now() < deadline && countOf(bot, item) < want && kills < upTo) {
      task.check();
      if (startHealth - (bot.health ?? 20) >= STANCE_HEALTH) { debug('close-in: health down', round(startHealth - bot.health)); break; }
      const came = biter(); if (came) { debug('close-in:', came); interrupted = came; break; }
      progressed();
      if (Date.now() - progressAt > cycleMs) { stalled = stallSays(); debug('close-in: stalled', stalled); break; }
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
      const shieldFrom = Date.now();
      if (!inReach && await shieldVolley(bot, task, { toward: live(target) ? target.position : null })) { stats.shieldMs += Date.now() - shieldFrom; continue; }
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
      // The nearest in sight before one out of sight, as the target is first
      // chosen (below): a target behind the walls is given up for a blaze
      // that has come into sight nearer, one the walk would otherwise pass
      // with its fire at the bot's back. mid-243-ch (25581) went on at a blaze
      // out of sight 12.7 off past one in sight at 9.2, walked under it, and
      // was struck at the back by it a second apart to its death (note 657).
      // Not the charge, which is at its one blaze.
      const seeing = upTo === Infinity && live(target) ? blazesSeeing(bot) : [];
      if (seeing.length && !seeing.includes(target)) {
        const d = target.position.distanceTo(bot.entity.position);
        const nearer = seeing.filter(e => !((skip.get(e.id) || 0) > Date.now()) && e.position.distanceTo(bot.entity.position) < d)
          .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
        if (nearer) { debug('close-in: in sight and nearer', nearer.id, 'for', target.id); target = nearer; }
      }
      if (!live(target) || (skip.get(target.id) || 0) > Date.now()) {
        // The charge is at one blaze, the nearest (charge_nearest): that
        // one set aside (no ground the sword reaches it from, no walk
        // there) or gone, it ends and says why, and is asked again. It
        // went on to blazes 35 and 39 blocks off out of sight, and stood
        // eight seconds walking at nothing under the one 4.9 off (note 618).
        if (upTo !== Infinity && chargeOn) { stalled = `${stallSays()}; the blaze it charged ${live(chargeOn) ? 'is set aside' : 'is gone'}`; debug('charge: set aside', chargeOn.id); break; }
        const about = threats(bot, ce.RANGE.blaze).filter(t => t.entity.name === 'blaze' && !((skip.get(t.entity.id) || 0) > Date.now()));
        target = about.sort((a, b) => (b.visible - a.visible) || a.distance - b.distance)[0]?.entity || null;
        if (upTo !== Infinity && target) chargeOn = target;
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
      // The nearest of its cells not yet found out of the walk's reach: a
      // stand on a stair beside it may be walked to where one over a wall
      // is not.
      const failed = walkFailedAt.get(target.id) || new Set();
      if (!cells.length || !navigate) { debug('no ground under', target.id, target.position.floored()); stats.noGround++; skip.set(target.id, Date.now() + 6000); target = null; await sleep(150); continue; }
      const to = cells.find(c => !failed.has(`${c}`)) || cells[0], from = target.position.distanceTo(bot.entity.position);
      try {
        // Stopped too by any blaze in sight come within the sword's reach on
        // the way: each in reach is struck (above), not walked past with its
        // blows and fire at the back (note 657).
        await navigate(bot, task, new goals.GoalBlock(to.x, to.y, to.z), { timeoutMs: 2500, stallMs: 1200, onFoot: true, sprint: true,
          stopWhen: () => !live(target) || canStrike(bot, target) || anyDue() || blazesSeeing(bot).some(e => e !== target && canStrike(bot, e)) });
        walked++;
      } catch (err) {
        task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err;
        // A route cut short by its search time still walked part of the
        // way; only a walk that got no nearer sets the blaze aside.
        const nearer = live(target) && from - target.position.distanceTo(bot.entity.position) >= 1;
        debug('walk failed', target.id, err.message, nearer ? '(nearer)' : '');
        if (!nearer) {
          stats.walkFailed++; stats.lastWhy = String(err.message || err).slice(0, 80);
          failed.add(`${to}`); walkFailedAt.set(target.id, failed);
          // Set aside once three of its cells, or all it has, found no walk.
          if (failed.size >= Math.min(3, cells.length)) { walkFailedAt.delete(target.id); skip.set(target.id, Date.now() + 6000); target = null; }
        }
      }
      // Under it and out of reach: it keeps its eyes near the bot's, so wait
      // a moment facing it rather than walking off.
      if (live(target) && !canStrike(bot, target) && at(bot, to)) { await bot.lookAt(target.position.offset(0, 0.9, 0), true); await sleep(150); }
      await sleep(50);
    }
    // The charge's one kill made: its rod, if it dropped one, before the
    // question is asked again.
    if (kills >= upTo && navigate) {
      // A drop appears with the death; a second's look is enough.
      const until = Date.now() + 1000;
      while (Date.now() < until) {
        const before = countOf(bot, item);
        const rod = Object.values(bot.entities).find(e => e.getDroppedItem?.()?.name === item && e.position.distanceTo(bot.entity.position) < 8);
        if (!rod) { await sleep(250); continue; }
        const r = rod.position.floored();
        try { await navigate(bot, task, new goals.GoalNear(r.x, r.y, r.z, 0.5), { timeoutMs: 3000, stallMs: 1200, onFoot: true, stopWhen: () => countOf(bot, item) > before || !live(rod) }); }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
        break;
      }
    }
  } finally { bot.removeListener('entityDead', onDeath); bot._closingOn = null; bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.(); }
  return { kills, walked, stalled, interrupted };
}

// What a blaze does, the game's own (26.1 Blaze: its attack goal, and a
// target it must see): said with every stand.
const BLAZE_WAYS = ` A blaze that sees the bot hangs back and shoots; one that loses sight of it flies toward it for a moment, then wanders (it gives the bot up after three seconds unseen); within two blocks it swings for ${ce.FIREBALL.melee} before armour instead of shooting, and keeps closing. A shield raised toward a fireball takes it whole, the fire with it, but not its push.`;

// What an option at a blaze fight gains toward the rods the goal needs
// (note 614). mid-242-aa-fortress-5 at 15:16:45, full health, a stone
// sword, one blaze 4.3 off in sight and four more ten to thirteen off
// behind the walls, was offered cover, holds, heal and retreat each priced
// in damage alone, and chose cover and heal over and over: every price was
// a cost, and nothing said that none of them came any nearer a rod, nor
// that the blazes at a fortress stay. Said with each option, a fact: the
// kills its own figures make, a kill only if one comes to the sword, or
// none. `gain`: { kills, seconds, dies } | 'comes' | 'none' | 'stops'.
const ROD_CHANCE = 0.5;
// The rods still needed, ONE number: for the ladder's own hunt (the win goal
// on its rods rung) it is eye-need.js's, read from what is carried now; for
// a hunt a request began ("get me 3 blaze rods") it is that hunt's own
// count. The hunt's saved targetCount was the ladder's number at the moment
// the step began, and read after a powder was made or a rod lost it was a
// second number (note 648).
const ladderHunt = goal => goal?.kind === 'win' && goal.gameProgress?.phase === 'obtain_blaze_rods';
function rodsNeeded(bot, goal) {
  const h = goal?.mobHunt;
  if (!h || h.entity !== 'blaze' || !(h.targetCount > 0)) return 0;
  if (ladderHunt(goal)) return require('./eye-need').need(bot, goal).rodsLeft;
  return Math.max(0, h.targetCount - require('./skills').countOf(bot, h.item || 'blaze_rod'));
}
// The rods a hunt is done at: the number rodsNeeded counts to.
function rodsTarget(bot, goal) {
  const h = goal?.mobHunt;
  if (!h) return 0;
  if (h.entity === 'blaze' && ladderHunt(goal)) { const n = require('./eye-need').need(bot, goal); return n.rods + n.rodsLeft; }
  return h.targetCount;
}
// What is carried against what the goal wants, for the "still needed" said
// on each option: "the goal wants 7 in all, 5 carried".
function rodsOf(bot, goal) {
  if (!ladderHunt(goal)) return '';
  const n = require('./eye-need').need(bot, goal);
  return `the goal wants ${n.rodsWanted} in all for ${n.target} eyes, ${n.rods} carried`;
}
function towardRods(need, gain, { spawner = false, of = '' } = {}) {
  if (!(need > 0) || !gain) return '';
  // Short: said on every option (note 614's question grew by a fifth).
  const still = `; ${need} rod${need === 1 ? '' : 's'} still needed${of ? ` (${of})` : ''}`;
  if (typeof gain === 'object') {
    const k = gain.kills || 0;
    if (gain.dies && !k) return ` Toward the rods: none, the health running out before a blaze is killed by these figures${still}.`;
    if (gain.dies && gain.all) return ` Toward the rods: the health runs out by these figures before the ${k} blaze${k === 1 ? '' : 's'} counted ${k === 1 ? 'is' : 'are all'} killed${still}.`;
    const rods = round(k * ROD_CHANCE);
    return ` Toward the rods: about ${k} blaze${k === 1 ? '' : 's'} killed${gain.seconds ? ` in about ${seconds(gain.seconds)}` : ''}${gain.dies ? ' before the health runs out' : ''}, about ${rods} rod${rods === 1 ? '' : 's'} on the average (a blaze drops one about half the time)${still}.`;
  }
  if (gain === 'comes') return ` Toward the rods: a kill only if a blaze comes within the sword's reach${still}.`;
  if (gain === 'stops') return ` Toward the rods: none; no blaze killed, and the spawner makes no more while it is lit${still}.`;
  return ` Toward the rods: none, no blaze killed; the blazes stay${spawner ? ' and the spawner makes more' : ''}, and waiting does not send them away${still}.`;
}
const STAND_GAIN = { close: 'kills', charge: 'kills', break: 'kills', hole: 'comes', window: 'comes', spawner: 'comes', wall: 'comes', box: 'comes', corner: 'comes', light: 'stops', heal: 'none', far: 'none' };
const gainOf = o => STAND_GAIN[o.kind] === 'kills' ? { kills: o.cost?.kills || 0, seconds: o.cost?.deathAt ?? o.cost?.seconds, dies: o.cost?.deathAt != null } : STAND_GAIN[o.kind] || null;

// A stand's figure is over its setup and the fifteen seconds held after.
const overSays = (cost, doing) => cost.setup ? `in the next ${cost.seconds} seconds this way (fifteen held after the ${doing})` : undefined;

// The stands for the blazes in `danger`, as options: { key: { description,
// expects, site, kind } }. Only with a blaze among them and a sword or axe.
// The stance's own list (those in sight) and every other blaze within
// sixteen: a stand that walks in on them puts the bot in their sight.
// The walk to a cell `ok` takes, cell by cell (walkTo's rules, with the way
// back kept): null past `steps` or `cap` cells looked at.
function walkRoute(bot, ok, { steps = 40, cap = 6000 } = {}) {
  const feet = feetCell(bot);
  const from = new Map([[`${feet}`, null]]);
  let ring = [feet], looked = 0;
  for (let n = 0; n <= steps && ring.length; n++) {
    const found = ring.find(ok);
    if (found) {
      const path = [];
      for (let c = found; c; c = from.get(`${c}`)) path.unshift(c);
      return path;
    }
    const next = [];
    for (const c of ring) for (const s of SIDES) for (const dy of [0, 1, -1]) {
      const to = c.plus(s).offset(0, dy, 0), key = `${to}`;
      if (from.has(key)) continue;
      if (++looked > cap) return null;
      if (dy === 1 && solid(bot.blockAt(c.offset(0, 2, 0)))) continue;
      if (dy === -1 && solid(bot.blockAt(c.plus(s).offset(0, 1, 0)))) continue;
      if (!bunker.standable(bot, to) || lavaWithin(bot, to, 1)) continue;
      from.set(key, c); next.push(to);
    }
    ring = next;
  }
  return null;
}
// Going past one blaze to reach another (note 657): the walk to the cell a
// strike at `target` is made from, and the other blazes it passes within
// arm's length of (three blocks, where one within two swings instead of
// shooting), and those behind the bot there as it faces the one it goes at:
// their fireballs come at the back, where a shield raised toward the one
// struck does not face. mid-243-ch (25581) at 03:33:39Z on 2026-09-29 chose
// close_in at the nearest of three blazes at a fortress crossing, 11 blocks
// off behind the walls, with nothing said of the one its walk went round the
// corridor and in under; that one then stood 2 blocks behind it and struck
// it at the back a second apart to its death. Those within sixteen of the
// cell, as the price counts them; the walk as the cells stand, not the
// pathfinder's own (which may go another way).
function behindAtStrike(bot, target, others) {
  const cells = strikeCells(bot, target);
  if (!cells.length) return '';
  const keys = new Set(cells.map(c => `${c}`));
  const route = walkRoute(bot, c => keys.has(`${c}`));
  const cell = route?.at(-1) || cells[0];
  const stand = cell.offset(0.5, 0, 0.5);
  const fx = target.position.x - stand.x, fz = target.position.z - stand.z, fn = Math.hypot(fx, fz);
  const rest = others.filter(e => e && e !== target && e.id !== target.id && e.position);
  const at = p => `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
  const passed = route ? rest.map(e => {
    let d = Infinity, i = -1;
    route.slice(0, -1).forEach((c, n) => { const x = e.position.distanceTo(c.offset(0.5, 1, 0.5)); if (x < d) { d = x; i = n; } });
    return { e, d: round(d), i };
  }).filter(k => k.d <= 3).sort((a, b) => a.i - b.i) : [];
  const behind = fn < 0.2 ? [] : rest.map(e => {
    const dx = e.position.x - stand.x, dz = e.position.z - stand.z, h = Math.hypot(dx, dz);
    const off = h < 0.2 ? 0 : Math.round(Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (h * fn)))) * 180 / Math.PI);
    return { e, d: round(e.position.distanceTo(stand)), off };
  }).filter(k => k.d <= 16 && k.off >= 90).sort((a, b) => a.d - b.d).slice(0, 3);
  if (!passed.length && !behind.length) return '';
  const parts = [];
  if (passed.length) parts.push(` The walk there, ${route.length - 1} step${route.length === 2 ? '' : 's'} as the ground stands, passes within arm's length of ${passed.map(k => `the blaze now at ${at(k.e.position)} (${k.d} blocks from its nearest cell, ${k.i} step${k.i === 1 ? '' : 's'} in)`).join(' and ')}: a blaze within two blocks swings instead of shooting, ${ce.FIREBALL.melee} a blow before armour, a blow a second, and one walked past is left behind the bot.`);
  if (behind.length) parts.push(` Where the bot strikes that one from, ${at(cell)}, facing it: ${behind.map(k => `the blaze now at ${at(k.e.position)}, ${k.d} blocks from that cell, is behind the bot (${k.off} degrees from where it faces)`).join('; ')}; ${behind.length === 1 ? 'its' : 'their'} fireballs come at the back, where a shield raised toward the one struck does not face.`);
  return parts.join('');
}
function withinSixteen(bot, danger) {
  try { return [...danger, ...require('./danger').threats(bot, 16).filter(t => t.entity.name === 'blaze' && !danger.some(d => d.entity?.id === t.entity.id))]; } catch (_) { return danger; }
}
function blazeStands(bot, danger, { dig = true, hunted = false, pocket = false, holds = [], need = 0, of = '' } = {}) {
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
    options.dig_in_at_spawner = { kind: 'hole', site: cageHole, sees: seeingAt(cageHole.hole), about: aboutAll.length, atSpawner: true, expects: { damage: cost.damage, seconds: cost.seconds, oneHit: oneHit(cost.mobs) },
      description: `Walk ${cageHole.steps} block${cageHole.steps === 1 ? '' : 's'} (about ${seconds(round(cageHole.walkMs / 1000))}, in their fire meanwhile) to the ${words(cageHole.rock)} ${cageHole.off} blocks from the blaze spawner's cage, dig a hole one wide and two high into it with the mouth toward the cage (2 blocks ${cageHole.with}, about ${seconds(round(cageHole.digMs / 1000))} of digging), step in and hold it${shieldCarried(bot) ? ', the shield up and facing each volley as it comes' : ''}: the spawner puts its blazes within four blocks of itself, up to four at a time every ten to forty seconds while a player is within sixteen, and one that comes within two of the bot closes to swing, into the mouth and the sword. Rock behind, beside and over the bot: every shot comes in through the mouth, from in front${shieldCarried(bot) ? ' where the shield faces' : ''}, and none lights the cell; a push meets rock. Rods that fall at the mouth are picked up between volleys.` +
        m.says + fire + costSays(cost, hp, cost.mobs, { doing: 'walking and digging in', done: 'In the hole', over: overSays(cost, 'walking and digging in') }) };
  }
  const breaking = dig && !pocket && shieldCarried(bot) ? breakSite(bot, undefined, { avoid: biting }) : null;
  if (breaking) {
    const walk = round(breaking.steps / WALK), m = measuredSays('break', bot);
    // Priced as the close-in is (note 602), the walk and the digging first:
    // by the drill's row alone it read 34.1 with four blazes nine off, and
    // was taken twice to death there once close_in said its sum.
    // With every blaze within sixteen, seen or not, as the close-in is
    // (note 606's rule): the walk goes to the cage they hover round.
    const sum = closeInCost(bot, withinSixteen(bot, danger), { breakFirst: { steps: breaking.steps, digSeconds: breaking.digMs / 1000, at: breaking.cell } });
    options.break_spawner = { kind: 'break', site: breaking, cost: sum, expects: { damage: sum.damage, seconds: Math.max(1, sum.seconds), oneHit: oneHit(standCost(bot, danger, {}).mobs) },
      description: `Break the blaze spawner: walk ${breaking.steps} block${breaking.steps === 1 ? '' : 's'} (about ${seconds(walk)}, behind the shield for each volley as it comes) to within reach of its cage and break it with the ${words(breaking.pick)} (about ${seconds(round(breaking.digMs / 1000))} of digging), then go at the blazes left with the sword as close_in does. Broken, it makes no more, ever: the ${aboutAll.length} about now stay, and after them the rods come only from the blazes a fortress makes on its own, one at a time in its corridors; left standing, it makes up to four more every ten to forty seconds while the bot is within sixteen of it, until six are about.` +
        fire + closeInSays(sum, hp, { breaking: true }) + rowsSays(m) + ` It runs ${CLOSE_SECONDS} seconds, or until six health is gone, and is asked again then.` };
  }
  const spawner = spawnerSite(bot, undefined, { avoid: biting });
  if (spawner) {
    const setup = round(spawner.steps / WALK);
    const cost = standCost(bot, danger, { setup, at: spawner.cell, atOnce: Math.max(1, require('./survival').openCells(bot, spawner.cell)) });
    options.fight_at_spawner = { kind: 'spawner', site: spawner, expects: { damage: cost.damage, seconds: cost.seconds, oneHit: oneHit(cost.mobs) }, sees: seeingAt(spawner.cell), about: aboutAll.length, atSpawner: true,
      description: `${spawner.steps ? `Walk ${spawner.steps} block${spawner.steps === 1 ? '' : 's'} (about ${seconds(setup)}, in their fire meanwhile) to` : 'Stay at'} a cell ${spawner.off} blocks from the blaze spawner's cage, ${solid(bot.blockAt(spawner.cell.offset(0, 2, 0))) ? 'under a ceiling' : 'with rock at its back'}, with no drop or lava within a push, and fight the blazes there as they come out${shieldCarried(bot) ? ', the shield up and facing each volley as it comes' : ''}: a spawner puts its blazes within four blocks of itself, up to four at a time every ten to forty seconds while a player is within sixteen, so there they come to the sword rather than being walked to; ${solid(bot.blockAt(spawner.cell.offset(0, 2, 0))) ? 'a ceiling keeps them from hovering over the bot' : `the rock at its back keeps them in front${shieldCarried(bot) ? ', where the shield faces' : ''}`}. Broken with a pickaxe, the spawner makes no more.` + measuredSays('spawner', bot).says +
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
  // (closeIn), priced by the sum of this fight (closeInCost): how many see
  // the bot and from where, what the shield covers, the lulls the walk
  // needs, the swings each takes with the shield down while the rest shoot,
  // the burning, and the spawner's newcomers. The arena's rows are said
  // with it, each with the fight it was measured in; priced by the row
  // alone, three blazes twenty off, it read 21 by four at ten and by eight
  // within seven, and each of the three ended in death (note 602).
  // Offered with or without a shield (note 614): a player with a sword and
  // no shield still charges a blaze four blocks off, and mid-242-aa-
  // fortress-5, a stone sword and no shield, was offered only cover, holds
  // and heal against one at four with nothing else in sight. Without the
  // shield the walk goes straight in and every fireball lands at its
  // chance, and the price says so.
  const reachable = blazes.filter(t => strikeCells(bot, t.entity).length).sort((a, b) => a.distance - b.distance);
  if (reachable.length) {
    const first = reachable[0], over = blazes.length - reachable.length, shield = shieldCarried(bot);
    const walk = round(Math.max(0, first.distance - 3) / WALK);
    const m = measuredSays('close', bot);
    // Priced with every blaze within sixteen, seen or not, as the hunt's
    // is: the stance's own list has only those in sight, and the walk in
    // puts the bot in the others' sight (note 606's rule, closeInCost into).
    const priced = withinSixteen(bot, danger);
    const sum = closeInCost(bot, priced);
    const how = shield
      ? `walk in on the nearest blaze ground reaches (${round(first.distance)} blocks off, about ${seconds(walk)} of walking) while their volleys rest, stop and face each volley behind the shield as it comes, strike each in reach, and pick up the rods between volleys`
      : `no shield carried: walk straight in on the nearest blaze ground reaches (${round(first.distance)} blocks off, about ${seconds(walk)} of walking), strike it until it dies, then the next, and pick up the rods as they fall`;
    const backSays = behindAtStrike(bot, first.entity, aboutAll);
    const shieldSays = shield ? ` A blaze glows for three seconds before its three shots and rests five seconds after; a shield raised and facing it as the glow ends takes all three whole, the fire with them, where one not raised lets about a third to a half land at five blocks, each 2.5 through iron and five seconds alight. The shield covers the half in front of the bot, so blazes on two sides at once are not all covered.` : '';
    options.close_in = { kind: 'close', site: { target: first.entity.id }, expects: { damage: sum.damage, seconds: Math.max(1, sum.seconds), oneHit: oneHit(standCost(bot, danger, {}).mobs) }, cost: sum,
      description: `Go at them with the sword: ${how}; ${reachable.length === 1 ? 'that one is' : `${reachable.length} of the ${blazes.length} are`} over ground the bot can stand on within a sword's reach of ${reachable.length === 1 ? 'it' : 'them'}${over ? `, ${over} over lava or a drop, fought only if it comes over ground` : ''}.${backSays}${shieldSays}` +
        fire + closeInSays(sum, hp) + rowsSays(m) + ` It runs ${CLOSE_SECONDS} seconds, or until a rod is carried or six health is gone, and is asked again then; it ends sooner, said why, if a volley's cycle passes without a step nearer a blaze or a swing.` };
    // The nearest alone, as its own option: with several about, the close-in
    // is priced over all of them, and a player takes the one at hand and
    // looks again. Priced by the same sum, up to its one kill (upTo).
    if (aboutAll.length > 1) {
      const one = closeInCost(bot, priced, { upTo: 1 });
      options.charge_nearest = { kind: 'charge', site: { target: first.entity.id }, expects: { damage: one.damage, seconds: Math.max(1, one.seconds), oneHit: oneHit(standCost(bot, danger, {}).mobs) }, cost: one,
        description: `Charge the nearest blaze alone: ${round(first.distance)} blocks off, over ground the bot can stand on within a sword's reach of it; ${shield ? 'walk in on it while the volleys rest, behind the shield for each as it comes' : 'no shield carried: walk straight in on it'}, strike it until it dies, pick up its rod if it drops one, and be asked again then with what is left; the other ${aboutAll.length - 1} about are not gone at.${backSays}` +
          closeInSays(one, hp) + ` It ends at the kill, after ${CLOSE_SECONDS} seconds, or once six health is gone.` };
    }
  }
  Object.assign(options, tacticOptions(bot, danger, { blazes, biting, from, aboutAll, hp, pocket, dig }));
  // The box and the corner are holds as the stands are: what the holds made
  // from about here came to, said on them in the hunt and the stance alike
  // (note 620).
  for (const o of Object.values(options)) if (HOLD_TACTICS.has(o.kind)) o.description += heldHereSays(bot, holds) || '';
  // The hunt says what it is for, and what holding a stand is: a wait for
  // blazes to come to the sword, priced by whether any can see it, and by
  // what the holds already made from about here came to (note 585). The
  // close-in and the spawner's breaking are no holds.
  if (hunted) for (const o of Object.values(options)) o.description += (TACTICS.has(o.kind) ? '' : ' Rods that fall near are picked up between volleys.') + (['close', 'charge', 'break', ...TACTICS].includes(o.kind) ? '' : holdSays(bot, o, holds));
  if (need > 0) {
    const cage = spawnerAt(bot), live = !!cage && cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position) <= 16;
    for (const o of Object.values(options)) o.description += towardRods(need, gainOf(o), { spawner: live, of });
  }
  // What followed the answers of this kind in the played fights, in this
  // situation (blaze-record.js, note 645).
  const record = require('./blaze-record'), situation = record.situationOf(bot);
  for (const [k, o] of Object.entries(options)) o.description += record.optionSays(bot, k, situation);
  return options;
}

// The tactics of note 606 (blaze-tactics.js), as options: the box with a
// window, lighting the spawner, the corner and going away to heal. Each is
// said with the rules of the game it rests on, a price worked out from the
// fight at hand (the walk and the building in their fire, then what reaches
// the bot there) and what the arena measured of it, fight by fight.
const TACTICS = new Set(['box', 'light', 'corner', 'heal', 'far']);
const PLACE_SECONDS = 0.45, TORCH_SECONDS = 0.45;
function tacticOptions(bot, danger, { blazes, biting, from, aboutAll, hp, pocket, dig }) {
  const T = require('./blaze-tactics');
  const options = {};
  if (pocket) return options;
  const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
  const armour = ce.armourOf(worn), shield = shieldCarried(bot);
  const fireHit = round(ce.afterArmour(ce.MOBS.blaze.hit, armour)), meleeHit = ce.afterArmour(ce.FIREBALL.melee, armour);
  const here = bot.entity.position;
  const cage = spawnerAt(bot);
  const cageNear = cage && cage.offset(0.5, 0.5, 0.5).distanceTo(here) <= 16 ? cage : null;
  const arc = shieldArc(bot, blazes.filter(t => t.visible).map(t => t.entity));
  const list = blazes.map(t => ({ d: t.distance, sees: !!t.visible, covered: arc.covered.has(t.entity.id) }));
  const burning = ce.burnLeft(bot);
  // Fire resistance on the body (note 656): the fireballs and the fire count
  // from when it ends; `from` seconds from now, the hits over `seconds`.
  const proof = require('./fire-resistance').left(bot);
  const fireOver = (r, seconds, from = 0) => { const covered = Math.max(0, Math.min(seconds, proof - from)); return r.proofHits * covered + r.hits * (seconds - covered); };
  // In their fire for `seconds` of work done in the lulls, the shield up for
  // each volley: the wall-clock seconds and the damage, the burn on the
  // body now included.
  const underFire = seconds => {
    // With no shield nothing waits for a volley: the work goes straight on.
    const k = list.filter(b => b.sees).length, wall = seconds / (shield ? lull(k) : 1);
    const r = blazeRate(list, { shield, shieldUp: true, fireHit, meleeHit });
    const damage = round(fireOver(r, wall) + ce.burnBetween([{ from: 0, to: wall, perSecond: r.fire }], 0, wall, burning, proof) + biteCost(bot, danger, wall).damage);
    // Said with the share of time the volleys take, which is what makes it
    // long: with many blazes at the bot there is hardly a lull to work in.
    const busy = k && shield ? Math.round(100 * (1 - lull(k))) : 0;
    return { wall: round(wall), damage, time: `${round(wall)} seconds${busy >= 50 ? ` (${k} blazes see the bot, and the shield is up for a volley ${busy >= 99 ? 'nearly all' : `about ${busy} in 100`} of the time, when nothing else is done)` : ''}`,
      hurt: `${damage} damage${damage >= hp ? ' (more than the bot has)' : ''}` };
  };
  const n = (k, w) => `${k} ${k === 1 ? w : w.endsWith('ch') ? `${w}es` : `${w}s`}`;
  const about = aboutAll.filter(e => e.position);
  const spawnSays = cageNear ? ` The spawner ${round(cageNear.offset(0.5, 0.5, 0.5).distanceTo(here))} blocks off makes more while the bot is within sixteen of it: up to four tries every ten to forty seconds at a cell within four blocks of its cage, until six are about.` : '';

  // The box with a window: at the spawner, two to four and a half from its
  // cage where its blazes come out beside it (box_at_spawner), and where
  // the bot stands (box_here), the window toward the spawner or the blazes.
  // At the drill's live spawner the walk in went through the four already
  // there and the blazes stood in the cells to be walled (2026-09-28).
  // The box at the cage and the spawner lit are built and were measured
  // (note 606: at the drill's live spawner with four blazes about, 3 and 4
  // deaths in 5, no rod), and are offered only where they are being
  // measured (BLAZE_TACTICS_ALL=1): the tactics that worked are offered.
  const all = process.env.BLAZE_TACTICS_ALL === '1';
  const boxes = [];
  if (cageNear && all) { const b = T.boxSite(bot, { cage: cageNear, from, avoid: biting }); if (b) boxes.push(['box_at_spawner', b]); }
  const toward = cageNear ? cageNear.offset(0.5, 0.5, 0.5) : from;
  const boxHere = T.boxSite(bot, { from: toward, avoid: biting });
  // One box, not two, where the nearest box is the one by the cage.
  if (boxHere && !boxes.some(([, b]) => b.cell.equals(boxHere.cell))) boxes.push(['box_here', boxHere]);
  for (const [key, box] of boxes) {
    const walk = box.steps / WALK, build = box.blocks * PLACE_SECONDS + (box.dig ? 1 : 0);
    const setup = underFire(walk + build);
    const walls = new Set(box.walls.map(c => `${c}`));
    const inLine = T.seeing(bot, about, box.cell, walls);
    const d = e => e.position.distanceTo(box.cell.offset(0.5, 1.6, 0.5));
    // In the box every blaze in line with the window is in front, where the
    // shield faces (the probe's one in thirty), and none has a line past it.
    const inside = blazeRate(inLine.map(e => ({ d: d(e), sees: true, covered: true })), { shield, shieldUp: true, fireHit, meleeHit });
    const hold = round(fireOver(inside, ce.HOLD_SECONDS, setup.wall) + ce.burnBetween([{ from: 0, to: ce.HOLD_SECONDS, perSecond: inside.fire }], 0, ce.HOLD_SECONDS, 0, Math.max(0, proof - setup.wall)));
    const cageOff = cageNear ? round(Math.hypot(box.cell.x + 0.5 - cageNear.x - 0.5, box.cell.z + 0.5 - cageNear.z - 0.5)) : null;
    const byCage = cageOff != null && cageOff <= T.BOX_NEAR[1];
    const crowd = about.filter(e => e.position.distanceTo(box.cell.offset(0.5, 1, 0.5)) <= 4).length;
    const m = measuredSays(key === 'box_here' ? 'box_here' : 'box', bot);
    const where = box.steps ? `Walk ${n(box.steps, 'block')} (about ${round(walk)} seconds) to a cell${cageOff != null ? ` ${cageOff} blocks from the spawner's cage` : ''}` : `Where the bot stands${cageOff != null ? `, ${cageOff} blocks from the spawner's cage` : ''}`;
    options[key] = { kind: 'box', site: box, sees: inLine.length, about: about.length, expects: { damage: round(setup.damage + hold), seconds: round(setup.wall + ce.HOLD_SECONDS), oneHit: fireHit },
      description: `${where}, wall it in at feet and head on all four sides and roof it (${n(box.blocks, 'block')} to place of the ${T.blocksCarried(bot)} carried${box.dig ? ', and the window dug' : ''}), leaving one block open at head height ${cageNear ? 'toward the spawner' : 'toward the blazes'}, and hold it: the rod farm players build by hand. Inside, only a blaze in line with the window sees the bot, and every shot from it comes from in front${shield ? ', where the shield faces each volley' : ' (no shield carried to meet it)'}; no fireball's fire lands in the box, and a push meets a wall. What it kills: a blaze that sees the bot and is more than two blocks off hovers where it is and shoots (the game's blaze does not come to a window); one within two that sees in flies at it and swings, into the sword through the window.${byCage ? ' Within four of the cage the spawner puts its blazes beside the box, and those are the ones that come.' : cageNear ? ' The spawner puts its blazes within four of its cage, not beside this box: those that see in through the window shoot from there.' : ' No spawner puts any beside this box: the blazes about now stay where they hover.'}${crowd ? ` ${crowd === 1 ? 'A blaze is' : `${crowd} blazes are`} within four blocks of that cell now: one in a cell to be walled holds that block out until it moves or is struck.` : ''} Rods fall outside; they are fetched through the block under the window when none is within four and no volley is due, and it is put back.${spawnSays}` +
        ` ${box.steps ? 'Walking there and building' : 'Building'} takes about ${setup.time} in their fire${shield ? ' with the shield up for each volley' : ''} (about ${setup.hurt}, the burning included); in it, ${inLine.length ? `${n(inLine.length, 'blaze')} of the ${about.length} about ${inLine.length === 1 ? 'is' : 'are'} in line with the window, about ${hold} damage over fifteen seconds${shield ? ' behind the shield' : ''}` : `none of the ${about.length} about is in line with the window now`}. Food can be eaten in it. It is held up to 45 seconds, until a rod is carried, six health is gone, or twenty seconds with no blaze in line or within eight.` + m.says };
  }

  // Lighting the spawner.
  const plan = cageNear && dig !== false && all ? T.lightPlan(bot, cageNear) : null;
  if (plan && plan.torches.length && !plan.dark.length) {
    const have = T.torchesCarried(bot), can = T.makeable(bot);
    if (have + can >= plan.torches.length) {
      // Walking round the cage to put them in reach, about half a step a torch.
      const walk = Math.max(0, cageNear.offset(0.5, 0.5, 0.5).distanceTo(here) - 3) / WALK + plan.torches.length * 0.5 / WALK;
      const setup = underFire(walk + plan.torches.length * TORCH_SECONDS + (have >= plan.torches.length ? 0 : 1));
      const m = measuredSays('light', bot);
      options.light_spawner = { kind: 'light', site: { spawner: cageNear, torches: plan.torches.length }, expects: { damage: setup.damage, seconds: setup.wall, oneHit: fireHit },
        description: `Stop the spawner with light: ${n(plan.torches.length, 'torch')} on and round its cage (${have >= plan.torches.length ? `${have} carried` : `${have} carried and ${plan.torches.length - have} more made from the coal and sticks carried, four a pair`}), placed from within reach of each${shield ? ', the shield up for each volley as it comes' : ''}. A blaze spawner's tries fail where the light is 12 or more (the game's light test for a blaze in the Nether), and a round in which every try fails is tried again the next tick: every open cell within four blocks of the cage, from one below it to one above, has to be lit, or the blazes come in the cells left dark at the same pace. ${plan.alreadyLit ? `${plan.alreadyLit} of its ${plan.cells} open cells are lit already; ` : `Its ${plan.cells} open cells are all dark now; `}the torches planned light the rest. Lit, it makes no more while the torches stand (unlike a spawner broken, it makes them again once they are taken down); the ${n(about.length, 'blaze')} about stay and are the fight after, asked again. About ${setup.time} in their fire (about ${setup.hurt}, the burning included).` + m.says };
    }
  }

  // The corner.
  const corner = about.length ? T.cornerSite(bot, about, { avoid: biting }) : null;
  if (corner) {
    const built = corner.build?.length || 0;
    const setup = underFire(corner.steps / WALK + built * PLACE_SECONDS);
    const m = measuredSays('corner', bot);
    options.corner_ambush = { kind: 'corner', site: corner, expects: { damage: round(setup.damage + Math.max(0, burning - Math.max(setup.wall, proof))), seconds: round(setup.wall + ce.HOLD_SECONDS), oneHit: fireHit },
      description: `${built ? `No rock to go round within ten blocks of walking: make a corner where the bot stands, a wall two high and three wide a step toward the blazes' middle (${n(built, 'block')} of the ${T.blocksCarried(bot)} carried, about ${setup.time} in their fire), and wait behind it` : corner.steps ? `Walk ${n(corner.steps, 'block')} (about ${setup.time} in their fire) round` : 'Stay at'}${built ? ` at (${corner.cell.x}, ${corner.cell.y}, ${corner.cell.z})` : ` the corner at (${corner.cell.x}, ${corner.cell.y}, ${corner.cell.z})`}, where none of the ${n(about.length, 'blaze')} about has a line to the bot and the cell beside it has one, and wait there facing the corner${shield ? ', the shield up' : ''}, striking what comes within reach: the nearest is ${corner.nearest} blocks from it. What comes: a blaze that loses sight of the bot flies toward it for a quarter of a second and then hovers where it is; it gives the bot up after three seconds unseen and wanders after that, and comes round the corner only by wandering. Out of their sight the bot takes nothing from them (about ${setup.hurt} ${built ? 'while building' : 'on the way'}, the burning on the body burning on).${spawnSays} Held up to thirty seconds, or until a rod is carried or six health is gone.` + m.says };
  }

  // Away to heal. Offered whenever a blaze fight is on and a cell out of
  // every blaze's sight exists (note 638): it was hidden at hunger under 18
  // with nothing to eat, the one state where walking out of their sight is
  // the whole of it (no health comes back, but the fire and the volleys
  // end). What it does at that hunger is said as it is: nothing comes back.
  const food = require('./vitals').chooseFood?.(bot);
  if (hp < 20 && about.length) {
    const site = T.healSite(bot, about, { avoid: biting });
    if (site) {
      const walled = site.build?.length || 0;
      const setup = underFire(site.steps / WALK + walled * PLACE_SECONDS);
      const after = Math.max(0, hp - setup.damage);
      const hunger = bot.food ?? 20;
      const points = (() => { try { return require('./healing').foodCarried(bot).reduce((n, f) => n + f.count * f.points, 0); } catch (_) { return food ? 4 : 0; } })();
      // Health comes back at hunger 18 or more, and eating what is carried
      // raises hunger by its points.
      const eatenTo = Math.min(20, hunger + (food ? points : 0));
      const healable = hunger >= 18 || eatenTo >= 18;
      const fast = eatenTo >= 20;
      const eat = food && hunger < 20;
      const heal = healable ? round((20 - after) * (fast ? 0.5 : 4) + (eat ? 1.6 : 0)) : 0;
      const m = measuredSays('heal', bot);
      const where = walled ? `no rock to go behind within fourteen blocks of walking, so wall the bot in where it stands, the box shut all round (${n(walled, 'block')} of the ${T.blocksCarried(bot)} carried, about ${setup.time} in their fire, about ${setup.hurt}), where none of the ${n(about.length, 'blaze')} about has a line to it (the nearest ${site.nearest} blocks off), ` : `walk ${n(site.steps, 'block')} (about ${setup.time} in their fire, about ${setup.hurt}) to (${site.cell.x}, ${site.cell.y}, ${site.cell.z}), where none of the ${n(about.length, 'blaze')} about has a line to the bot (the nearest ${site.nearest} blocks off), `;
      const clock = require('./food-facts').clock(bot);
      const holds = healable ? ` The health it heals to holds only while hunger stays at 18 or more: fights spent ${clock.rate} hunger a minute (note 664), so from hunger ${hunger} that is about ${clock.noEating} minutes of fighting${points ? ` and at most ${clock.withFood} with all ${points} carried points eaten` : ' with nothing carried to eat'}.` : '';
      const stays = `The blazes stay where they are${cageNear ? ', and the spawner makes more meanwhile while the bot is within sixteen of it' : ''}; the fight after is asked again${healable ? ' with the health back' : ' at the health it has now'}${walled ? ', the side toward them opened first' : ''}.${holds}`;
      const what = healable
        ? `${eat ? `eat the ${words(food.name)} (about 1.6 seconds) and ` : ''}stay until the health is full: at hunger 20 with saturation a point comes back each half second, at 18 or 19 one each four seconds${setup.damage >= hp ? `; but the health runs out before it is out of their sight` : `, so from about ${round(after)} to 20 takes about ${heal} seconds${food ? '' : ' (nothing carried to eat)'}`}.`
        : `${food ? `eat the ${words(food.name)} (it brings hunger only to ${eatenTo}) and ` : ''}stay only until the fire on the body is out: at hunger ${hunger}, under eighteen, no health comes back (${food ? `eating all that is carried leaves hunger at ${eatenTo}` : 'nothing carried is food'}), so healing there would take never. It gets the bot out of the fire and the volleys and no health back${setup.damage >= hp ? '; and the health runs out before it is out of their sight' : `: it stays at about ${round(after)} health`}, and each point lost from here on stays lost until the bot has eaten to eighteen.`;
      options.leave_and_heal = { kind: 'heal', site, expects: { damage: round(setup.damage + Math.max(0, burning - Math.max(setup.wall, proof))), seconds: round(setup.wall + heal), oneHit: fireHit, heals: healable ? round(20 - after) : 0 },
        description: `Go out of their sight${healable ? ' to heal and come back' : ' (no health comes back at this hunger)'}: ${where}${what} ${stays}` + m.says };
    }
  }

  // Waiting far off (note 665): past 32 blocks of every blaze, the game's own
  // clock removes a monster with no player near; the spawner makes none beyond
  // sixteen. Offered where a live spawner is within sixteen and a way out
  // was found (T.scoutFar, from the retreat's scouting), whatever the count.
  const far = cageNear && about.length ? T.farSite(bot) : null;
  if (far) {
    const walk = far.blocks / WALK, setup = underFire(walk);
    const hunger = bot.food ?? 20, eatable = (() => { try { return require('./healing').foodCarried(bot).reduce((k, f) => k + f.count * f.points, 0); } catch (_) { return 0; } })();
    const heals = hunger >= 18 || Math.min(20, hunger + eatable) >= 18;
    const rule = ` The game's rule (read from the server jar): a monster with no player within 32 blocks for 30 seconds is removed by chance, one in 800 each tick (a mean of about 40 seconds each: about ${T.farGone(90)} in 100 gone at 90 seconds, ${T.farGone(T.FAR.seconds)} in 100 after ${T.FAR.seconds} seconds here), and at once beyond 128; the blazes a spawner makes are ordinary monsters to it, and a blaze that follows in sight, or flies toward the bot, keeps its clock at nothing. The spawner makes none while no player is within sixteen of it.`;
    const back = ` Coming back, the spawner's first try is up to four blazes, ten to forty seconds after the bot is within sixteen of it again (of the fights at a spawner that began with one to three in sight, half had four or more about by a median 32 seconds), plus any that stayed. Nothing in the record shows a bot doing this: no bot has walked out and waited, so what is left of the room after ${T.FAR.seconds} seconds is not counted.`;
    options.wait_far_off = { kind: 'far', site: far, expects: { damage: round(setup.damage), seconds: round(setup.wall + T.FAR.seconds), oneHit: fireHit },
      description: `Go out of their reach and let the room thin: walk ${n(far.blocks, 'block')} (about ${setup.time} in their fire${shield ? ', the shield up for each volley' : ''}, about ${setup.hurt}) to a place ${far.radius} blocks from the cage, the nearest blaze now ${far.nearestNow} blocks off and none nearer than that along the way (${far.nearestAlong} at the closest)${far.lava ? `; lava lies beside ${far.lava.beside ?? far.lava.cells ?? 'some'} of its cells` : ''}, and stay ${T.FAR.seconds} seconds${heals ? `, eating what is carried (health comes back at hunger 18 or more)` : `; at hunger ${hunger} with ${eatable ? `only ${eatable} points of food` : 'nothing to eat'} no health comes back there`}. It ends sooner if a mob other than a blaze comes to arm's length or the health falls under eight.${rule}${back} It kills no blaze itself.` };
  }
  return options;
}

const shieldCarried = bot => bot.inventory?.slots?.[45]?.name === 'shield';
// How long a close-in runs before the question is asked again.
const CLOSE_SECONDS = 45;

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
  // Note 606's drills, with the kit the fortress trials carried when they
  // died there (an iron helmet and chestplate, an iron sword, a shield, a
  // stone pickaxe, 24 cobblestone, coal and sticks).
  near4: 'against four blazes nine to eleven off round the bot by a live spawner eleven off on a fortress floor over a lava sea (more come from it as the run goes), with an iron helmet and chestplate only',
  one_trial: 'against one blaze in the open eight blocks off, with an iron helmet and chestplate only',
};
// The fights most like each other, said next after the one at hand.
const SCENE_NEAR = { one: ['one_trial'], one_trial: ['one'], spawner: ['near4'], near4: ['spawner'] };
const MEASURED = {
  close: { near4: { runs: 10, kills: 17, rods: 7, damage: 32.2, deaths: 3, seconds: 27.3, note: 'each run ended at the first rod carried, or a death' }, one_trial: { runs: 5, kills: 5, rods: 3, damage: 1, deaths: 0, seconds: 7.2 }, one: { runs: 2, kills: 2, rods: 1, damage: 2.1, deaths: 0 }, spawner: { runs: 3, kills: 6, rods: 2, damage: 21, deaths: 1 }, wither: { runs: 3, kills: 2, rods: 0, damage: 33.1, deaths: 3 } },
  break: { spawner: { runs: 3, kills: 2, rods: 1, damage: 34.1, deaths: 2 }, wither: { runs: 3, kills: 4, rods: 0, damage: 33.7, deaths: 3 } },
  cage_hole: { spawner: { runs: 3, kills: 1, rods: 1, damage: 29, deaths: 1 } },
  hole: { spawner: { runs: 3, kills: 1, rods: 0, damage: 3.1, deaths: 0 } },
  wall: { spawner: { runs: 3, kills: 0, rods: 0, damage: 34.7, deaths: 2 }, wither: { runs: 3, kills: 3, rods: 0, damage: 13.1, deaths: 0 } },
  open: { spawner: { runs: 3, kills: 1, rods: 0, damage: 39.9, deaths: 2 }, one: { runs: 5, kills: 4, rods: 2, damage: 12.4, deaths: 0 } },
  // Leaving them, and the encounter's stances as Jev chose them after.
  defer: { spawner: { runs: 5, kills: 1, rods: 0, damage: 21.1, deaths: 0 }, wither: { runs: 5, kills: 6, rods: 0, damage: 36.7, deaths: 1 } },
  // Note 606, each taken whenever offered (ARENA_PREFER), the rest Jev's.
  box: { near4: { runs: 5, kills: 0, rods: 0, damage: 33.8, deaths: 3, seconds: 120, note: 'the walk in and the building under the four already there and those the spawner added; in the three deaths the box was never whole' } },
  box_here: { near4: { runs: 5, kills: 0, rods: 0, damage: 31.5, deaths: 1, seconds: 124.9, note: 'built where it stood, eleven from the cage: once whole, holds of 45 seconds took no damage with six to ten blazes about, and nothing came to the window; the damage was the building and what was chosen between holds' },
    one_trial: { runs: 5, kills: 0, rods: 0, damage: 0, deaths: 0, seconds: 99.6, note: 'the blaze shot into the window at the shield and never came' } },
  light: { near4: { runs: 5, kills: 0, rods: 0, damage: 32.8, deaths: 4, seconds: 22.1, note: 'twenty torches to place round the cage among the blazes there; none finished it' } },
  corner: { near4: { runs: 5, kills: 1, rods: 0, damage: 32.2, deaths: 3, seconds: 93.6, note: 'no rock there: offered twice in five runs, a corner built of two blocks; the rest was Jev\'s other stances' },
    one_trial: { runs: 5, kills: 0, rods: 0, damage: 0, deaths: 0, seconds: 60, note: 'two holds of thirty seconds a run, ten in all: the blaze never came round; it was killed after by close_in each time' } },
  heal: { near4: { runs: 5, kills: 4, rods: 3, damage: 23.6, deaths: 1, seconds: 35.1, note: 'close_in, then this whenever hurt: walled in where it stood, fed and healed, the side opened again' } },
};
function sceneNow(bot) {
  let about = [];
  try { about = require('./danger').threats(bot, ce.RANGE.blaze); } catch (_) { about = []; }
  if (about.some(t => t.entity.name === 'wither_skeleton' && t.distance <= 8)) return 'wither';
  if (spawnerAt(bot)) return about.filter(t => t.entity.name === 'blaze' && t.distance <= 16).length >= 3 ? 'near4' : 'spawner';
  return about.filter(t => t.entity.name === 'blaze').length <= 1 ? 'one' : 'spawner';
}
function measuredSays(kind, bot = null) {
  const rows = MEASURED[kind];
  if (!rows || !Object.keys(rows).length) return { says: '', damage: null };
  const scene = bot ? sceneNow(bot) : null;
  const rank = r => (r === scene ? 0 : (SCENE_NEAR[scene] || []).includes(r) ? 1 : 2);
  const order = Object.keys(rows).sort((a, b) => rank(a) - rank(b));
  const row = r => `${SCENES[r] || r}, ${rows[r].runs} runs: ${rows[r].kills} killed, ${rows[r].rods} rod${rows[r].rods === 1 ? '' : 's'} carried away, about ${rows[r].damage} damage a run on the median${rows[r].seconds ? ` over about ${rows[r].seconds} seconds` : ''}, ${rows[r].deaths ? `${rows[r].deaths} death${rows[r].deaths === 1 ? '' : 's'}` : 'no deaths'}${rows[r].note ? ` (${rows[r].note})` : ''}`;
  return { damage: rows[scene]?.damage ?? null, says: ` Measured in the arena ${kitSays(bot)}, this way: ${order.map(row).join('; ')}.` };
}
// The arena's kit against the bot's: "with the same kit" was said to
// mid-242-aa-fortress-5 with a stone sword, no armour and no shield, of
// runs made with an iron sword, a shield and iron armour (note 614).
const IRON_UP = /^(iron|diamond|netherite)_/;
function kitSays(bot) {
  if (!bot?.inventory) return 'with the same kit';
  const { defenseWeapon } = require('./combat');
  const weapon = defenseWeapon(bot)?.name || null, shield = shieldCarried(bot);
  const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
  const iron = worn.filter(n => IRON_UP.test(n)).length;
  if (IRON_UP.test(weapon || '') && /_sword$/.test(weapon) && shield && iron >= 2) return 'with the same kit';
  const armour = !worn.length ? 'no armour' : iron === worn.length ? `${iron} piece${iron === 1 ? '' : 's'} of iron or better armour` : `${worn.length} piece${worn.length === 1 ? '' : 's'} of armour, ${iron} of it iron or better`;
  return `with an iron sword, a shield and iron armour unless a run says otherwise, not this bot's kit (${weapon ? `${/^[aeiou]/.test(weapon) ? 'an' : 'a'} ${words(weapon)}` : 'no sword or axe'}, ${armour}, ${shield ? 'a shield' : 'no shield'})`;
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
const ENDED = { time: 'its time was up', quiet: 'no blaze within twenty blocks for twenty seconds', rod: 'a rod in hand', hurt: 'under eight health', cut: 'cut off, something else taking the turn' };
// A box's and a corner's holds, kept where they were held as a stand's are
// (note 620): the stance's box and corner kept nothing, and the hunt's kept
// no place, so heldHereSays never found them. On mid-242-ba-fortress-5 a box
// seven blocks from a spawner was chosen sixteen times in thirty-five
// minutes with no blaze killed, and every asking offered it as the first
// time.
const HOLD_TACTICS = new Set(['box', 'corner']);
const placeOf = option => {
  const c = HOLD_TACTICS.has(option?.kind) ? option.site?.cell : null;
  return c && Number.isFinite(c.x) ? { place: { x: c.x, y: c.y, z: c.z } } : {};
};
// A box's hold ends on its own quiet (holdBox), not a stand's; one stopped
// by a throw is said as cut off, not by the reason its loop began with.
const TACTIC_ENDED = { quiet: 'twenty seconds with no blaze in line with its window or within eight', time: 'its time was up' };
function noteTacticHold(bot, goal, save, option, stats, { startedAt, before = 0 } = {}) {
  if (!HOLD_TACTICS.has(option?.kind) || !goal) return;
  const state = goal.mobHunt ||= {};
  const gained = Math.max(0, require('./skills').countOf(bot, 'blaze_rod') - before);
  const seconds = Number.isFinite(stats.seconds) && stats.seconds > 0 ? stats.seconds : Math.round((Date.now() - Date.parse(startedAt)) / 1000);
  state.standResults = [...(state.standResults || []), { at: startedAt, kind: option.kind, ...placeOf(option), ...stats, seconds,
    ended: option.kind === 'box' && TACTIC_ENDED[stats.ended] ? TACTIC_ENDED[stats.ended] : stats.ended, gained, health: bot.health }].slice(-12);
  save?.();
}

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
const at = (bot, cell) => feetCell(bot).equals(cell);
// Going to the stand, and into the hole: one step of it, for a stance
// held and run again each tick. True while it holds or was carried out.
async function takeStand(bot, task, goal, save, option, { navigate, stallMs } = {}) {
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
  if (kind === 'close' || kind === 'charge') {
    goal.step = { action: kind === 'charge' ? 'charge_nearest' : 'close_in' }; save?.();
    const { stalled } = await closeIn(bot, task, goal, save, { navigate, seconds: 15, ...(kind === 'charge' ? { upTo: 1 } : {}), ...(stallMs ? { stallMs } : {}) });
    if (stalled) throw Object.assign(new Error(`the close-in got nowhere: ${stalled}`), { name: 'StanceFailed' });
    return true;
  }
  if (TACTICS.has(kind)) {
    const stats = {}, startedAt = new Date().toISOString(), before = require('./skills').countOf(bot, 'blaze_rod');
    try { await runTactic(bot, task, goal, save, option, { navigate, seconds: 15, stats }); }
    catch (err) { noteTacticHold(bot, goal, save, option, { ...stats, ended: 'cut' }, { startedAt, before }); throw err; }
    noteTacticHold(bot, goal, save, option, stats, { startedAt, before });
    // A lighting that ran out of reach or torches with cells still dark has
    // not stopped the spawner: said, so the next question has it.
    if (kind === 'light' && stats.dark) throw Object.assign(new Error(`the spawner is not stopped: ${stats.dark} of its ${stats.cells} open cells still dark after ${stats.placed} torch${stats.placed === 1 ? '' : 'es'} placed`), { name: 'StanceFailed' });
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
  if (option.kind === 'close' || option.kind === 'charge') {
    const state = goal.mobHunt ||= {};
    state.stand = { kind: option.kind, at: Date.now() }; save?.();
    const { kills } = await closeIn(bot, task, goal, save, { navigate: actions.navigate, seconds: CLOSE_SECONDS, item, want, ...(option.kind === 'charge' ? { upTo: 1 } : {}) });
    const gained = countOf(bot, item) - before;
    state.standResults = [...(state.standResults || []), { at: new Date().toISOString(), kind: option.kind, kills, gained, health: bot.health }].slice(-12); save?.();
    return gained;
  }
  if (TACTICS.has(option.kind)) {
    const state = goal.mobHunt ||= {};
    const stats = {}, startedAt = new Date().toISOString();
    const result = (cut = false) => {
      if (HOLD_TACTICS.has(option.kind)) return noteTacticHold(bot, goal, save, option, cut ? { ...stats, ended: 'cut' } : stats, { startedAt, before });
      state.standResults = [...(state.standResults || []), { at: startedAt, kind: option.kind, ...stats, gained: countOf(bot, item) - before, health: bot.health }].slice(-12); save?.();
    };
    return bunker.keepingStep(goal, save, async () => {
      try { await runTactic(bot, task, goal, save, option, { navigate: actions.navigate, item, want, stats }); }
      catch (err) { result(true); throw err; }
      if (option.kind === 'box') await bunker.collectRods(bot, task, goal, save, { mouth: option.site.cell.offset(0.5, 0, 0.5), inside: option.site.cell }, actions, item).catch(err => { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; });
      result();
      return countOf(bot, item) - before;
    });
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

// One of note 606's tactics, run: `seconds` of it (its own length when not
// given), what it met written into `stats`.
async function runTactic(bot, task, goal, save, option, { navigate, seconds, item = 'blaze_rod', want = Infinity, stats = {} } = {}) {
  const T = require('./blaze-tactics');
  const { site, kind } = option;
  if (kind === 'box') {
    if (!T.inBox(bot, site) || !T.boxWhole(bot, site)) await T.buildBox(bot, task, goal, save, site, { navigate });
    return T.holdBox(bot, task, goal, save, site, { navigate, seconds: seconds ?? 45, item, want, stats });
  }
  if (kind === 'light') { Object.assign(stats, await T.lightSpawner(bot, task, goal, save, site.spawner, { navigate, seconds: seconds ?? 60 })); return stats; }
  if (kind === 'corner') return T.holdCorner(bot, task, goal, save, site, { navigate, seconds: seconds ?? 30, item, want, stats });
  if (kind === 'heal') return T.leaveAndHeal(bot, task, goal, save, site, { navigate, seconds: seconds ?? 60, stats });
  if (kind === 'far') return T.waitFarOff(bot, task, goal, save, site, { navigate, stats });
  return null;
}

module.exports = { behindAtStrike, spawnerNewcomers, SPAWN_CAP, SPAWN_SECONDS, rodsNeeded, rodsTarget, rodsOf, towardRods, ROD_CHANCE, TACTICS, tacticOptions, runTactic, claimBlazes, blazeRate, closeInCost, closeInSays, shieldArc, SHIELD_LEAK, SHIELD_COVER, DUE_SECONDS, holdSays, heldHereSays, breakSite, breakSpawner, sortie, spawnerHoleSite, VOLLEY, MEASURED, volleyComing, flamesTouching, putOutFlames, CLOSE_SECONDS, charged, volleyWatch, volleyDue, volleyIn, shieldVolley, closeIn, strikeCells, measuredSays, blazeStands, holeSite, windowSite, inHole, wallSite, spawnerSite, spawnerAt, standCost, knockSays, knockLands, lavaWithin, takeStand, huntFromStand, BLAZE_WAYS };
