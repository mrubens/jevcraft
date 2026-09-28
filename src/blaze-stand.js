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
  const ok = c => c.offset(0.5, 0.5, 0.5).distanceTo(centre) <= SPAWNER_NEAR && solid(bot.blockAt(c.offset(0, 2, 0))) && knockLands(bot, c);
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

// What a blaze does, the game's own (26.1 Blaze: its attack goal, and a
// target it must see): said with every stand.
const BLAZE_WAYS = ` A blaze that sees the bot hangs back and shoots; one that loses sight of it flies toward it for a moment, then wanders (it gives the bot up after three seconds unseen); within two blocks it swings for ${ce.FIREBALL.melee} before armour instead of shooting, and keeps closing. A shield raised toward a fireball takes it whole, the fire with it, but not its push.`;

// A stand's figure is over its setup and the fifteen seconds held after.
const overSays = (cost, doing) => cost.setup ? `in the next ${cost.seconds} seconds this way (fifteen held after the ${doing})` : undefined;

// The stands for the blazes in `danger`, as options: { key: { description,
// expects, site, kind } }. Only with a blaze among them and a sword or axe.
function blazeStands(bot, danger, { dig = true, hunted = false, pocket = false } = {}) {
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
    options.dig_in_and_fight = { kind: pocket ? 'window' : 'hole', site: hole, expects: { damage: cost.damage, seconds: cost.seconds, oneHit: oneHit(cost.mobs) },
      description: (hole.inside
        ? 'Stay in the hole the bot is in and fight from inside: rock behind it, beside it and over it, one side open.'
        : pocket ? `Open the pocket's wall toward the blazes, one wide and two high (2 blocks of ${words(hole.rock)} ${hole.with}, about ${seconds(round(hole.digMs / 1000))} of digging), and fight from inside the pocket through it.`
        : `Dig a hole one wide and two high into the ${words(hole.rock)} ${where} (2 blocks ${hole.with}, about ${seconds(round(hole.digMs / 1000))} of digging${hole.walkMs ? ` after about ${seconds(round(hole.walkMs / 1000))} of walking` : ''}, in their fire meanwhile), step in with the back to the rock and fight from inside.`) +
        ` Rock behind, beside and over the bot: a fireball's push there meets rock, not a drop; only a blaze in line with the mouth can shoot in, and one that comes to the mouth is within the sword, one at a time.` + lineSays +
        BLAZE_WAYS + fire + costSays(cost, hp, cost.mobs, { doing: hole.inside ? null : pocket ? 'opening it' : 'digging in', done: 'In the hole', over: overSays(cost, pocket ? 'opening' : 'digging in') }) };
  }
  const spawner = spawnerSite(bot, undefined, { avoid: biting });
  if (spawner) {
    const setup = round(spawner.steps / WALK);
    const cost = standCost(bot, danger, { setup, at: spawner.cell, atOnce: Math.max(1, require('./survival').openCells(bot, spawner.cell)) });
    options.fight_at_spawner = { kind: 'spawner', site: spawner, expects: { damage: cost.damage, seconds: cost.seconds, oneHit: oneHit(cost.mobs) },
      description: `${spawner.steps ? `Walk ${spawner.steps} block${spawner.steps === 1 ? '' : 's'} (about ${seconds(setup)}, in their fire meanwhile) to` : 'Stay at'} a cell ${spawner.off} blocks from the blaze spawner's cage, under a ceiling, with no drop or lava within a push, and fight the blazes there as they come out: a spawner puts its blazes within four blocks of itself, up to four at a time every ten to forty seconds while a player is within sixteen, so there they come to the sword rather than being walked to; a ceiling keeps them from hovering over the bot. Broken with a pickaxe, the spawner makes no more.` +
        BLAZE_WAYS + fire + costSays(cost, hp, cost.mobs, { doing: spawner.steps ? 'walking there' : null, done: 'At the cage', over: overSays(cost, 'walking there') }) };
  }
  const wall = wallSite(bot, from, { avoid: biting });
  if (wall) {
    const setup = round(wall.steps / WALK);
    const cost = standCost(bot, danger, { setup, at: wall.cell, atOnce: Math.max(1, require('./survival').openCells(bot, wall.cell)) });
    options.back_to_wall = { kind: 'wall', site: wall, expects: { damage: cost.damage, seconds: cost.seconds, oneHit: oneHit(cost.mobs) },
      description: `${wall.steps ? `Walk ${wall.steps} block${wall.steps === 1 ? '' : 's'} (about ${seconds(setup)}, in their fire meanwhile) to` : 'Stay on'} footing with a wall at its back on the side away from the blazes and no drop or lava within ${KNOCK} blocks, and fight there: a fireball from them pushes the bot into the wall, and a push any other way lands on ground.` +
        BLAZE_WAYS + fire + costSays(cost, hp, cost.mobs, { doing: wall.steps ? 'walking there' : null, done: 'Back to the wall', over: overSays(cost, 'walking there') }) };
  }
  // The hunt says what it is for.
  if (hunted) for (const o of Object.values(options)) o.description += ' Rods that fall where the bot cannot see them are picked up once no blaze has it in sight.';
  return options;
}

// One beat of holding a stand: a swing if something is in reach, else
// facing the way it comes from.
async function holdBeat(bot, task, goal, save, face) {
  const { defendNearby } = require('./combat');
  if (await defendNearby(bot, task, goal, save)) return true;
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
  if (kind === 'window') {
    goal.step = { action: 'dig_in_and_fight', window: { ...site.stand } }; save?.();
    for (const c of site.window) await bunker.digCell(bot, task, c);
    await bot.lookAt?.(face, true);
    return true;
  }
  if (kind !== 'hole') return await goTo(site.cell) && holdBeat(bot, task, goal, save, face);
  if (at(bot, site.hole)) return holdBeat(bot, task, goal, save, face);
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
  if (!await takeStand(bot, task, goal, save, option, actions)) throw new Error(`Could not take the ${option.kind === 'hole' ? 'hole' : option.kind === 'spawner' ? 'cell by the spawner' : 'wall'}`);
  const { site, kind } = option;
  const inside = kind === 'hole' ? site.hole : site.cell;
  const watch = kind === 'hole' ? site.stand : kind === 'spawner' ? site.spawner : site.cell.minus(site.back);
  const stand = { inside, watch, mouth: watch };
  const state = goal.mobHunt ||= {};
  state.stand = { kind, inside: { ...inside }, at: Date.now() }; save?.();
  const kills = await bunker.holdBunker(bot, task, goal, save, stand, { item, want });
  await bunker.collectRods(bot, task, goal, save, stand, actions, item);
  const gained = countOf(bot, item) - before;
  state.standResults = [...(state.standResults || []), { at: new Date().toISOString(), kind, kills, gained, health: bot.health }].slice(-12); save?.();
  return gained;
}

module.exports = { blazeStands, holeSite, windowSite, inHole, wallSite, spawnerSite, spawnerAt, standCost, knockSays, knockLands, lavaWithin, takeStand, huntFromStand, BLAZE_WAYS };
