'use strict';
// A blaze spawner known and no blaze about (note 681).
//
// mid-242-dc-fortress-22 (25589, 2026-09-29 19:04) closed on a blaze two
// blocks from the cage at (-108, 77, 155), was lit and burned from 12 health
// to 3.8, and the blaze went out of reach. With none in view the hunt fell
// through to the fortress search: health 3.8, hunger 15 and nothing to eat
// took the unfit branch, Jev's earlier keep_on sent it to findFortressStep,
// and that walked the fortress's unwalked floors away from the spawner, 42
// blocks off in a minute, until "No measurable progress on find_fortress"
// and restock_food. Nothing asked what a player asks at an empty spawner
// room: stay for the next ones, heal first, or go for food.
//
// The game (the 26.1.2 server jar, BaseSpawner): a spawner is active only
// while a player is within 16 blocks of it; it then tries every 200 to 800
// ticks (10 to 40 seconds) to put up to 4 of its kind within 4 blocks of the
// cage, while fewer than 6 are near it. Note 665: with the bot staying, the
// count reached 4 or more at a median of 32 seconds.
//
// Here the ways are offered with those facts and the bot's health, hunger,
// food and whether health comes back. The search is not among them: the
// spawner is the target (the stand's step names it, so the rung's measure
// and the stall watch have it).
const { Vec3 } = require('vec3');

const KNOWN_NEAR = 48;           // a spawner known this near is the one at hand
const HUNT_NEAR = 32;            // a blaze this near is the hunt's own stalk
const STAND_MS = 60000;          // every try comes within 40 s of being within 16
const HEAL_MS = 3 * 60000;
const REST_MS = 5 * 60000;       // a stand whose walk found no way rests this long
const RANGE = 16, DELAY = '10 to 40', COUNT = 4, CAP = 6, MEDIAN_FOUR = 32;

const ROUTE_WORDS = { hoglin_walk: 'a hoglin on foot', hoglin_pillar: 'a hoglin from a pillar', mushroom_stew: 'mushroom stew', raid_bastion: "a bastion's chests", cook_meat: 'the raw meat carried cooked', return_for_food: 'the trip back' };
const round = n => Math.round(n * 10) / 10;
const words = s => String(s || '').replaceAll('_', ' ');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const P = v => ({ x: v.x, y: v.y, z: v.z });
const centre = cage => new Vec3(cage.x + 0.5, cage.y + 0.5, cage.z + 0.5);

// The nearest spawner the fortress map holds (or one in sight now), within
// KNOWN_NEAR, not seen broken.
function knownSpawner(bot, goal) {
  const here = bot?.entity?.position;
  if (!here || !inNether(bot)) return null;
  const list = (goal?.fortressSearch?.map?.spawners || []).map(s => new Vec3(s.x, s.y, s.z));
  try { const live = require('./blaze-stand').spawnerAt(bot); if (live && !list.some(s => s.equals(live))) list.push(live); } catch (_) { /* no world */ }
  const standing = s => { const b = typeof bot.blockAt === 'function' ? bot.blockAt(s) : null; return !b || b.name === 'spawner'; };
  const cage = list.filter(standing).sort((a, b) => centre(a).distanceTo(here) - centre(b).distanceTo(here))[0];
  if (!cage) return null;
  const off = centre(cage).distanceTo(here);
  return off <= KNOWN_NEAR ? { cage, off: Math.round(off) } : null;
}

// A blaze the hunt goes at on its own (prepareMobHunt's stalk): within 32,
// not set aside.
function blazeNear(bot, goal) {
  const here = bot.entity.position;
  const { isSetAside } = require('./progress');
  return Object.values(bot.entities || {}).some(e => e?.name === 'blaze' && e.isValid !== false && e.position &&
    e.position.distanceTo(here) < HUNT_NEAR && !isSetAside(goal, 'hunt_target', e.uuid || e.id));
}
function blazesAbout(bot) {
  try { return require('./danger').threats(bot, 48).filter(t => t.entity.name === 'blaze').length; } catch (_) { return 0; }
}

// What a fireball costs through what is worn.
function fireHit(bot) {
  const ce = require('./combat-estimate');
  const worn = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  return round(ce.afterArmour(ce.MOBS.blaze.hit, ce.armourOf(worn)));
}

// The facts the question is asked with.
function facts(bot, goal, { cage, off }) {
  const f = require('./fortress-visit').fitness(bot);
  let need = null; try { need = require('./blaze-stand').rodsNeeded(bot, goal); } catch (_) { need = null; }
  const last = goal.fortressSearch?.spawnerWaitEnded;
  return { f, state: {
    spawner: `at (${cage.x}, ${cage.y}, ${cage.z}), ${off} block${off === 1 ? '' : 's'} off: ${off <= RANGE ? 'within sixteen: trying now' : 'not within sixteen: making none'}`,
    blazesAbout: blazesAbout(bot),
    health: round(f.health), hunger: f.hunger,
    food: f.carried.length ? f.carried.map(c => c.says) : 'nothing to eat carried',
    healthComesBack: f.health >= 20 ? 'health is full' : f.healable ? `yes, about ${f.seconds} seconds to full${f.hunger < 18 ? ' once what is carried is eaten' : ''}` : `no: hunger ${f.hunger} (under 18)${f.points ? `, and what is carried brings it only to ${f.eatenTo}` : ', nothing to eat'}; every point lost stays lost`,
    ...(need != null ? { rodsStillNeeded: need } : {}),
    ...(last ? { lastStandHere: last } : {}),
  } };
}

// The cell the stand is taken in: within three of the cage under a ceiling
// or with rock at its back (blaze-stand.js spawnerSite), where the blazes it
// puts out come within the sword's reach and few have a line to the bot.
function standSite(bot, cage) {
  try { return require('./blaze-stand').spawnerSite(bot, cage); } catch (_) { return null; }
}

// The ways, each a real route from here. `actions` as the hunt has them.
function options(bot, task, goal, save, actions, known, { now = Date.now() } = {}) {
  const { cage, off } = known;
  const quiet = known.lull || null;
  const { f } = facts(bot, goal, known);
  const tree = {};
  const es = goal.emptySpawner || {};
  const resting = es.standRest && es.standRest.until > now;
  // What the fights it waits for come to at this health: a fireball's cost
  // against the health, and the trials' row for fights begun here.
  const hit = fireHit(bot), lands = Math.max(1, Math.ceil(f.health / hit));
  let row = '';
  try {
    const b = require('./blaze-record').bandOf(f.health);
    row = ` Of the trials' fights begun at ${b.said}, ${b.fights}: ${b.diedPct}% died, ${b.rodPct}% brought a rod.`;
  } catch (_) { row = ''; }
  const healthSays = `Health ${round(f.health)}${f.health >= 20 ? '' : f.healable ? ', coming back meanwhile' : ', not coming back'}: a blaze fires three fireballs a volley, one that lands costs ${hit} and sets the bot alight, so ${lands === 1 ? 'one that lands is the end' : `about ${lands} that land are the end`}.${row}`;
  // A stand in the open has no wall to meet a fireball with, and none of
  // the shots land on anything but the bot (note 731, 25588: no shield
  // carried, 20 to 0.8 health in three seconds standing in the open). Said
  // plainly, with the trials' own comparison against a box (blaze-record.js
  // boxedSays, the same figures spawner-clock.js's lull gives).
  const shield = bot.inventory?.slots?.[45]?.name === 'shield';
  const openRisk = `${shield ? '' : ' No shield is carried: every fireball that lands is taken in full.'}${(() => { try { return require('./blaze-record').boxedSays(f.health); } catch (_) { return ''; } })()}`;
  if (!resting) {
    const site = standSite(bot, cage);
    // spawnerSite (standSite) failing says only "no cell under a ceiling or
    // backed by rock was found"; it does not say a walk can reach the cage
    // at all. 25591 (mid-242-vd, note 732) was offered "within four blocks
    // of the cage" on that failure alone, its run tried the pathfinder's
    // own walk there, and it came back "no route" at once: no reachable
    // cell of any kind was within range, not just no covered one. Without
    // a covered site, a plain reachable one is checked before the option is
    // offered at all; with neither, nothing here has a walk to the cage, and
    // that is said instead of offered.
    const reach = site ? null : (() => { try { return require('./blaze-stand').spawnerReach(bot, cage); } catch (_) { return null; } })();
    // What the stand's cell sees of where the blazes come (note 708).
    const line = site ? (() => { try { return require('./blaze-tactics').standLine(bot, site.cell, cage); } catch (_) { return null; } })() : null;
    const where = site
      ? `a cell ${site.off} blocks from the cage, ${site.steps ? `a ${site.steps}-block walk` : 'where the bot stands'}, ${bot.blockAt(site.cell.offset(0, 2, 0))?.boundingBox === 'block' ? 'under a ceiling' : 'rock at its back'}`
      : reach ? `within four blocks of the cage (${off} off now; no covered cell found near it, but the walk there is open)`
      : `within four blocks of the cage (${off} off now; no covered cell found near it, and no plain one either: nothing standable was found on a walk there from here, so the wait may find no way and be asked again)`;
    const sees = line ? ` There it sees ${require('./blaze-tactics').lineWords(line)}.` : '';
    const goCell = site ? site.cell : reach ? reach.cell : null;
    // The trials' row (died%, brought a rod%, at this health band) is the
    // health cost the code has for this stand: kept even in the lull, not
    // stripped for brevity (note 740). 25583 was offered stand_by_spawner
    // seeing 97 in 100 of the spawner's blazes against box_here's 3 in 100,
    // with no cost said for either beyond "Nothing is built" versus box_here's
    // own "Arena: took no damage": the two safety facts were not on the same
    // footing, and box_here (0.7) beat the option that actually fights.
    tree.stand_by_spawner = { description: quiet
      ? `Take a stand in the open at ${where}, up to a minute, and fight its next blazes as they come; each that sees the bot shoots at it. Nothing is built.${sees} ${healthSays}${openRisk}`
      : `Take a stand at ${where} and wait for its next blazes: within 16 of it the spawner puts up to ${COUNT} within 4 blocks of the cage every ${DELAY} seconds, until ${CAP} are about; with the bot staying, 4 or more were about by a median ${MEDIAN_FOUR} seconds. Each that sees the bot shoots at it, fought or not. Up to a minute; none by then means its tries fail.${sees} ${healthSays}${openRisk}`,
      run: () => {
        const fs = goal.fortressSearch ||= { legs: 0 };
        fs.spawnerWait = { x: cage.x, y: cage.y, z: cage.z, until: now + STAND_MS, startedAt: now, chosen: 'empty_spawner', ...(goCell ? { cell: P(goCell) } : {}) };
        delete fs.spawnerWaitEnded; save?.();
      } };
  }
  // The lull by a live spawner (note 691): the time before its next try is
  // the time to prepare. Each way says its seconds against that clock.
  if (quiet) Object.assign(tree, lullOptions(bot, task, goal, save, actions, known, quiet, { now }));
  // The rods carried into a chest first (rod-stash.js, note 704): a death
  // drops them, a chest keeps them.
  const stash = require('./rod-stash').stashOffer(bot, goal, { now });
  if (stash) tree.stash_rods = { description: require('./rod-stash').offerSays(stash, { riskInState: true }), secs: stash.seconds, rodsCarried: require('./rod-stash').carriedSays(stash),
    run: () => require('./rod-stash').stashRods(bot, task, goal, save, { ...actions, place: actions?.place || require('./work').place }, stash) };
  const canFeed = f.hunger < 18 && f.points > 0;
  if ((f.health < 20 && f.healable) || canFeed) {
    tree.heal_first = { description: `${f.items && f.hunger < 20 ? `Eat what is carried (hunger to ${f.eatenTo}) and w` : 'W'}ait here${f.health < 20 && f.healable ? ` until health is full: about ${f.seconds} seconds` : ''}, at most three minutes, then asked again. ${off <= RANGE ? 'Within sixteen of the spawner, as the bot is now, blazes may come meanwhile; a mob ends the wait.' : 'Beyond sixteen of the spawner none come from it meanwhile.'}${quiet && f.health < 20 && f.healable ? require('./spawner-clock').jobSays(quiet, f.seconds) : ''} No rod meanwhile.`,
      run: () => { goal.emptySpawner = { ...es, pick: 'heal_first', at: now, cage: P(cage) }; save?.(); } };
  }
  let tripClosed = null; try { tripClosed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { tripClosed = null; }
  if (actions?.returnOverworld && !f.healable && !tripClosed) {
    const gp = require('./game-progress');
    const d = gp.portalDistance(bot, goal);
    const t = gp.NETHER_TRIPS;
    const low = f.health < 8 ? `; of the ${t.lowTrips} begun under 8 health, ${t.lowArrived} came out and ${t.lowDied} died` : '';
    tree.go_back = { description: `Go back to the Overworld for food and come back fed: ${d != null ? `the way out is ${d} blocks off, about ${Math.max(1, Math.round(d / t.fast))} to ${Math.max(1, Math.round(d / t.slow))} minutes at the walks' measured pace` : 'no portal here is known; it is looked for first'}. Of ${t.trips} walks back over ${t.over} blocks, ${t.arrived} came out, ${t.died} died, the rest given up or stalled${low}. The hunt waits till the bot is fed and back; no rod meanwhile.`,
      run: async () => {
        goal.leaveNether = { reason: 'food', pick: 'go_back', until: 0, at: Date.now() };
        goal.step = { action: 'return_for_food', health: bot.health, food: bot.food }; goal.stockFood = true; save?.();
        await actions.returnOverworld(bot, task, goal, save);
      } };
  }
  try {
    const nf = require('./nether-food');
    if (nf.foodNeed(bot, goal)) {
      const found = nf.foodRoutes(bot, task, goal, save, { actions: actions || {} });
      // The trip back is go_back's where that is offered: not said twice.
      const keys = Object.keys(found.routes).filter(k => !(k === 'return_for_food' && tree.go_back));
      // The hoglin known, and the pillar stance's measure (fortress-visit.js PILLAR).
      let hoglin = '';
      if (keys.some(k => /^hoglin_/.test(k))) {
        try {
          const known = require('./nether-travel').hoglinsKnown(bot, goal), near = known.inView[0], seen = known.seen[0];
          const where = near ? `one in view ${Math.round(near.position.distanceTo(bot.entity.position))} blocks off` : seen ? `one seen ${seen.distance} blocks off ${seen.minutesAgo} minutes ago` : '';
          const p = require('./fortress-visit').PILLAR;
          hoglin = ` Hoglins: ${where ? `${where}; ` : ''}2 to 4 porkchops each; on a pillar two up its blow does not reach (${p.stances} stances lost ${p.lost} health on average); the 66 hunts of ${p.day} brought none, 61 finding no hoglin at the sighting.`;
        } catch (_) { hoglin = ''; }
      }
      if (keys.length) tree.get_food_here = { description: `Get food here first (asked next): ${keys.map(k => ROUTE_WORDS[k] || k.replaceAll('_', ' ')).join(', ')}.${hoglin} No rod meanwhile.`,
        run: () => nf.askRestockFood(bot, task, goal, save, { actions: actions || {}, client: actions?.client || task?.opportunityClient, found }) };
    }
  } catch (_) { /* no route from here */ }
  return tree;
}

// The ways to prepare in a lull (note 691), each a real route from here:
// the box by the cage or where the bot stands (built out of their fire, then
// held for the next blazes), a hole in the rock beside the cage, the rods on
// the ground, out past sixteen, or after the blazes out of sight.
function lullOptions(bot, task, goal, save, actions, known, quiet, { now = Date.now() } = {}) {
  const { cage } = known;
  const T = require('./blaze-tactics'), stand = require('./blaze-stand'), clock = require('./spawner-clock');
  const tree = {};
  const toward = centre(cage), carried = T.blocksCarried(bot);
  const WALK = 4.3, PLACE = 0.45;
  const boxWords = (b, at) => {
    const secs = b.steps / WALK + b.blocks * PLACE + (b.dig ? 1 : 0);
    const where = b.steps ? `Walk ${b.steps} block${b.steps === 1 ? '' : 's'} to a cell ${at}` : `Where the bot stands, ${at}`;
    // Held for the blazes its window sees (note 708): a window with no line
    // to where they come holds for none of them, and is said so.
    const sees = !b.line || b.line.per100 > 0;
    // Not built at the cage on purpose (box_at_spawner, whose own boxSite
    // call passes `cage`, never sets this): a cell this close still inside
    // the spawner's own spawn range lets a blaze spawn already at the
    // box's own wall, not fly in through the window first (note 740, 25588:
    // box_here 1.4 blocks from a live cage, struck at one block inside the
    // box just walled).
    const inRange = b.inSpawnRange ? ' It is inside the spawner\'s own spawn range (up to four blocks across): a blaze can spawn already at the box\'s own wall or window there, not only fly in through it, so "only a blaze in line with the window sees in" does not hold this close.' : '';
    return { secs, says: `${where}: wall it in, ${b.blocks ? `${b.blocks} block${b.blocks === 1 ? '' : 's'} of the ${carried} carried` : 'the box whole already'}, one open at head height toward the spawner, and hold it${sees ? ' for its next blazes: only a blaze in line with the window sees in, from the front' : ''}.${inRange}${T.windowSays(b.line)}${clock.jobSays(quiet, secs)}` };
  };
  const box = (key, site) => ({ description: site.words, secs: site.secs,
    run: () => buildAndHold(bot, task, goal, save, actions, { kind: 'box', site: site.b, key }, site.secs) });
  const offOf = c => round(Math.hypot(c.x + 0.5 - toward.x, c.z + 0.5 - toward.z));
  if (actions?.navigate) {
    const atCage = T.boxSite(bot, { cage, from: toward });
    if (atCage) { const w = boxWords(atCage, `${atCage.off} blocks from the cage, where it puts its blazes beside the box`); tree.box_at_spawner = box('box_at_spawner', { b: atCage, words: w.says + ' Arena: built among four blazes it lost 3 runs of 5, never whole in those.', secs: w.secs }); }
    const here = T.boxSite(bot, { from: toward, sightOf: cage });
    if (here && !(atCage && atCage.cell.equals(here.cell))) { const w = boxWords(here, `${offOf(here.cell)} blocks from the cage`); tree.box_here = box('box_here', { b: here, words: w.says + ' Arena: once whole, 45-second holds took no damage with six to ten blazes about.', secs: w.secs }); }
    // The nearest box whose window sees more of where they come, where the
    // nearest sees less (note 708).
    const inLine = here?.inLine;
    // box_in_line is box_here's own box, walled the same way, at whichever
    // cell gives the window the widest line: its safety is box_here's own,
    // not left unsaid beside box_here's (note 740: box_in_line had no
    // "Arena:" line at all, so its near-zero kill rate stood with no cost
    // beside it, unlike box_here and box_at_spawner which both had one).
    if (inLine && !(atCage && atCage.cell.equals(inLine.cell))) { const w = boxWords(inLine, `${offOf(inLine.cell)} blocks from the cage`); tree.box_in_line = box('box_in_line', { b: inLine, words: w.says + ' Arena: as box_here\'s is, once whole, 45-second holds took no damage with six to ten blazes about.', secs: w.secs }); }
    // A hole in the rock beside the cage, its mouth toward it: rock behind,
    // beside and over, only the front open. Not gated on a pickaxe carried:
    // netherrack, basalt, blackstone and nether bricks all break by hand
    // (hand-dig.js, note 705), only slower and dropping nothing, and
    // spawnerHoleSite's own digMs already prices whichever tool is at hand.
    // 25594 (mid-242-sc, note 720) carried no pickaxe, was told "no covered
    // cell found near it" by the stand, and was never offered this at all.
    const hole = (() => { try { return stand.spawnerHoleSite(bot, cage); } catch (_) { return null; } })();
    if (hole) {
      const digSecs = round((hole.digMs ?? 1500) / 1000);
      const secs = (hole.steps || 0) / WALK + digSecs;
      tree.dig_in_at_spawner = { description: `Walk ${hole.steps || 0} block${hole.steps === 1 ? '' : 's'} and dig a hole one wide and two high into the rock beside the cage (${words(hole.rock)}, dug ${hole.with}, about ${digSecs} s), the mouth toward it, and hold it for its next blazes: rock behind, beside and over, only the front open.${clock.jobSays(quiet, secs)}`, secs,
        run: () => buildAndHold(bot, task, goal, save, actions, { kind: 'hole', site: hole, key: 'dig_in_at_spawner' }, secs) };
    }
    // Out past sixteen: the spawner makes none and its delay stops counting.
    const out = outOfRange(bot, cage);
    if (out) {
      const secs = out.steps / WALK;
      tree.step_out = { description: `Walk ${out.steps} blocks to a cell ${out.off} from the cage, past 16: the spawner makes none and its clock stops. Eat and heal there up to a minute, then asked again.`, secs,
        run: () => stepOut(bot, task, goal, save, actions, out) };
    }
  }
  // Where the bot stands sees none of where they come (a box whose window
  // faces rock, 25591 at (-104, 78, 150), note 708): a slit toward the cage
  // is a way of its own (cage-hold.js, note 700).
  if (known.lineHere && !known.lineHere.per100 && actions?.dig) {
    const fight = require('./cage-hold').cageFight(bot, goal);
    const slit = fight ? require('./cage-hold').slitOption(bot, task, goal, save, fight, { dig: actions.dig, about: '' }) : null;
    if (slit) tree.open_slit = slit;
  }
  // Rods on the ground the hunt's pickup (twelve blocks) left.
  const rods = Object.values(bot.entities || {}).filter(e => e.getDroppedItem?.()?.name === 'blaze_rod' && e.position?.distanceTo(bot.entity.position) <= 24);
  if (rods.length && actions?.navigate) tree.pick_up_rods = { description: `Pick up the ${rods.length} blaze rod${rods.length === 1 ? '' : 's'} on the ground, the nearest ${round(Math.min(...rods.map(e => e.position.distanceTo(bot.entity.position))))} blocks off.`,
    run: async () => { await require('./drop-collection').collectNearbyDrops(bot, task, 'blaze_rod', { radius: 24, timeoutMs: 8000, move: actions.navigate }); } };
  // The blazes out of sight: the hunt's own stalk.
  if (quiet.within16 && blazeNear(bot, goal)) tree.hunt_on = { description: `Go after the ${quiet.within16 === 1 ? 'blaze' : `${quiet.within16} blazes`} out of sight within sixteen, as the hunt does.`,
    run: () => { goal.emptySpawner = { ...(goal.emptySpawner || {}), huntOnUntil: now + HUNT_ON_MS }; save?.(); } };
  return tree;
}
const HUNT_ON_MS = 60000;
// A cell past sixteen of the cage, the nearest by walking within 40 steps.
function outOfRange(bot, cage) {
  try {
    const c = centre(cage);
    const cells = require('./blaze-tactics').walkCells(bot, { steps: 40 });
    const found = cells.find(({ cell }) => cell.offset(0.5, 0.5, 0.5).distanceTo(c) > 17);
    return found ? { ...found, off: round(found.cell.offset(0.5, 0.5, 0.5).distanceTo(c)) } : null;
  } catch (_) { return null; }
}
// A box or a hole, begun in the lull and finished before anything else: the
// build is not cut by a blaze coming out of the spawner (arbiter.js), only by
// a mob at its reach, a push by a drop, the body's own dangers or its own
// failure; then held as the hunt holds a stand.
async function buildAndHold(bot, task, goal, save, actions, option, secs) {
  bot._buildCommit = { until: Date.now() + (secs + 10) * 1000, kinds: ['blaze'], what: option.key };
  const p = bot.entity.position.floored();
  goal.emptySpawner = { ...(goal.emptySpawner || {}), built: { key: option.key, at: Date.now(), from: { x: p.x, y: p.y, z: p.z } } }; save?.();
  try { await require('./blaze-stand').huntFromStand(bot, task, goal, save, actions, option, { item: 'blaze_rod', want: require('./skills').countOf(bot, 'blaze_rod') + 1 }); }
  finally { delete bot._buildCommit; }
}
async function stepOut(bot, task, goal, save, actions, out) {
  const { goals } = require('mineflayer-pathfinder');
  goal.step = { action: 'step_out_of_spawner', target: P(out.cell), health: bot.health }; save?.();
  await actions.navigate(bot, task, new goals.GoalBlock(out.cell.x, out.cell.y, out.cell.z), { timeoutMs: 20000, stallMs: 4000, onFoot: true });
  goal.emptySpawner = { ...(goal.emptySpawner || {}), pick: 'heal_first', at: Date.now(), cage: goal.emptySpawner?.cage || null }; save?.();
}

// The heal chosen: eat what is carried, then wait while health comes back.
// Ends with health full, three minutes, or a mob in sight. -> true while it waits.
async function rest(bot, task, goal, save, now = Date.now()) {
  const es = goal.emptySpawner;
  const f = require('./fortress-visit').fitness(bot);
  const eatable = f.items > 0 && f.hunger < 20 && (f.health < 20 || f.hunger < 18), waitable = f.health < 20 && f.hunger >= 18;
  let mobs = []; try { mobs = require('./danger').threats(bot, 24).filter(t => t.visible); } catch (_) { mobs = []; }
  if ((!eatable && !waitable) || mobs.length || now - es.at > HEAL_MS) { delete goal.emptySpawner.pick; save?.(); return false; }
  goal.step = { action: 'heal_at_spawner', target: es.cage, health: bot.health, food: bot.food }; save?.();
  if (eatable) {
    const food = require('./vitals').chooseFood(bot);
    if (food) {
      try { await bot.equip(food, 'hand'); await bot.consume(); } catch (_) { task?.check?.(); }
      return true;
    }
  }
  await sleep(1000); task?.check?.();
  return true;
}

// Where the bot stands against where the blazes come, in words: "From where
// the bot stands, 6 blocks from the cage, it sees none of the cells round
// the cage where the spawner's blazes come; the 9 blazes within 16 are all
// out of sight."
function lineHereSays(bot, known) {
  const l = known.lineHere;
  let within = []; try { within = require('./danger').threats(bot, RANGE).filter(t => t.entity.name === 'blaze'); } catch (_) { within = []; }
  const unseen = within.filter(t => !t.visible).length;
  const about = unseen ? `; ${within.length === unseen ? `${within.length === 1 ? 'the blaze' : `all ${within.length}`} within 16 out of sight` : `${unseen} of the ${within.length} within 16 out of sight`}` : '';
  return `From here, ${known.off} blocks from the cage, it sees ${require('./blaze-tactics').lineWords(l)}${about}.`;
}

// One pass of the hunt at a known spawner with no blaze near. -> true when
// this pass was spent here (asked, carried out, or a chosen wait going on);
// false when it is not this question's (a blaze near, no spawner known, the
// trip back chosen, or nothing to offer), and the hunt goes on as before.
// `actions.waitAtSpawner` runs the search's wait by a spawner (mob-hunt.js
// findFortressStep), which carries out the stand.
async function atSpawner(bot, task, goal, save, actions = {}, now = Date.now()) {
  const client = actions.client || task?.opportunityClient;
  if (!client || process.env.JEV_EMPTY_SPAWNER === '0' || !inNether(bot) || !bot.entity) return false;
  // A box, hole or slit already built and holding (cage-hold.js holding,
  // note 700) is carried on, not asked over: stand_by_spawner and heal_first
  // already had this protection (spawnerWait, emptySpawner.pick below);
  // a build had none. 25588 (note 731) had empty_spawner asked six times in
  // two minutes, box_here whole and holding at one ask ("held from about
  // here once in the last 46 seconds") and abandoned for stand_by_spawner
  // three asks later ("Nothing is built"), standing in the open where the
  // box already answered the same blazes.
  try { if (require('./cage-hold').holding(bot, goal, now)) return true; } catch (_) { /* no hold */ }
  const fs = goal.fortressSearch;
  // The lull by a live spawner (note 691): blazes about out of sight, none at
  // reach. Asked then too, unless Jev chose to go after them just now.
  let quiet = null;
  { const k = knownSpawner(bot, goal); if (k && k.off <= RANGE) { try { quiet = require('./spawner-clock').lull(bot, { cage: k.cage, now }); } catch (_) { quiet = null; } } }
  if (quiet && goal.emptySpawner?.huntOnUntil > now) quiet = null;
  if (quiet && fs?.spawnerWait?.until > now) quiet = null;
  // A blaze the hunt can go at: its own stalk and fights. One come while a
  // stand is held is counted for the stand's end.
  if (!quiet && blazeNear(bot, goal)) {
    const w = fs?.spawnerWait;
    if (w?.chosen === 'empty_spawner') { w.came = [...new Set([...(w.came || []), ...Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.position?.distanceTo(bot.entity.position) < HUNT_NEAR).map(e => e.id)])].slice(-12); save?.(); }
    return false;
  }
  const known = knownSpawner(bot, goal);
  if (!known) return false;
  // The stand chosen (or a wait by the spawner from the fortress's legs):
  // carried out by the search's wait until its time is up.
  if (fs?.spawnerWait?.until > now && actions.waitAtSpawner) { await actions.waitAtSpawner(); return true; }
  // A stand whose walk found no way rests (said on the next asking).
  if (fs?.spawnerWaitEnded && /^no way to it/.test(fs.spawnerWaitEnded) && !(goal.emptySpawner?.standRest?.at >= (fs.spawnerWaitEndedAt || 0))) {
    goal.emptySpawner = { ...(goal.emptySpawner || {}), standRest: { at: now, until: now + REST_MS, why: fs.spawnerWaitEnded } }; save?.();
  }
  // The trip back chosen goes on as the hunt carries it (leave_nether's hold).
  try { if (require('./game-progress').netherLeaveHeld(goal, 'food', now)) return false; } catch (_) { /* no hold */ }
  if (goal.emptySpawner?.pick === 'heal_first' && await rest(bot, task, goal, save, now)) return true;
  if (quiet) known.lull = quiet;
  // What the bot sees from where it stands of the cells the spawner puts its
  // blazes in (note 708): a hold here is worth only what that line brings.
  if (known.off <= RANGE) { try { known.lineHere = require('./blaze-tactics').standLine(bot, bot.entity.position.floored(), known.cage); } catch (_) { known.lineHere = null; } }
  const tree = options(bot, task, goal, save, actions, known, { now });
  if (!Object.keys(tree).length) return false;
  const { state } = facts(bot, goal, known);
  if (known.lineHere) state.lineHere = lineHereSays(bot, known);
  // In the lull the facts are said once, short (the plain cap, note 672):
  // health and food are the question's own facts here.
  if (quiet) { state.lull = quiet.short; state.healing = state.healthComesBack; delete state.healthComesBack; }
  if (goal.emptySpawner?.standRest?.until > now) state.standResting = `the stand rests ${Math.round((goal.emptySpawner.standRest.until - now) / 60000)} more minutes: ${goal.emptySpawner.standRest.why}`;
  // What the stay at this cage has come to, on each hold (cage-yield.js, note 702).
  const soFar = (() => { try { return require('./cage-yield').annotate(bot, goal, tree, now); } catch (_) { return null; } })();
  if (soFar) state.cageSoFar = soFar;
  // The rods carried and what a death does to them, where the chest is offered (note 704).
  if (tree.stash_rods) state.rodsCarried = tree.stash_rods.rodsCarried;
  // The trip home not offered for its walk cannot begin from here (note 706).
  if (!tree.go_back && (bot.food ?? 20) < 18) { try { const c = require('./mob-hunt').tripHomeClosed(bot, goal); if (c) state.tripHome = c.says; } catch (_) { /* none */ } }
  goal.step = { action: 'at_spawner', target: P(known.cage), off: known.off, health: bot.health, food: bot.food }; save?.();
  const decision = await require('./decisions').decide('empty_spawner', { client, bot, task, goal, save, tree, state, target: P(known.cage) });
  if (decision.stale) return true;
  const pick = decision.path.at(-1);
  if (tree[pick]?.run) await tree[pick].run();
  if (pick === 'stand_by_spawner' && actions.waitAtSpawner) await actions.waitAtSpawner();
  if (pick === 'heal_first') await rest(bot, task, goal, save);
  // Going after them: the hunt's own stalk this very pass.
  if (pick === 'hunt_on') return false;
  return true;
}

module.exports = { atSpawner, options, lullOptions, outOfRange, buildAndHold, facts, knownSpawner, blazeNear, rest, KNOWN_NEAR, STAND_MS, REST_MS, HUNT_ON_MS };
