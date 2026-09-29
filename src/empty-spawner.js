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
  if (!resting) {
    const site = standSite(bot, cage);
    const where = site
      ? `a cell ${site.off} blocks from the cage, ${site.steps ? `a ${site.steps}-block walk` : 'where the bot stands'}, ${bot.blockAt(site.cell.offset(0, 2, 0))?.boundingBox === 'block' ? 'under a ceiling' : 'rock at its back'}`
      : `within four blocks of the cage (${off} off now; no covered cell found near it)`;
    tree.stand_by_spawner = { description: `Take a stand at ${where} and wait for its next blazes: within 16 of it the spawner puts up to ${COUNT} within 4 blocks of the cage every ${DELAY} seconds, until ${CAP} are about; with the bot staying, 4 or more were about by a median ${MEDIAN_FOUR} seconds. Each that sees the bot shoots at it, fought or not. Up to a minute; none by then means its tries fail. ${healthSays}`,
      run: () => {
        const fs = goal.fortressSearch ||= { legs: 0 };
        fs.spawnerWait = { x: cage.x, y: cage.y, z: cage.z, until: now + STAND_MS, startedAt: now, chosen: 'empty_spawner', ...(site ? { cell: P(site.cell) } : {}) };
        delete fs.spawnerWaitEnded; save?.();
      } };
  }
  const canFeed = f.hunger < 18 && f.points > 0;
  if ((f.health < 20 && f.healable) || canFeed) {
    tree.heal_first = { description: `${f.items && f.hunger < 20 ? `Eat what is carried (hunger to ${f.eatenTo}) and w` : 'W'}ait here${f.health < 20 && f.healable ? ` until health is full: about ${f.seconds} seconds` : ''}, at most three minutes, then asked again. ${off <= RANGE ? 'Within sixteen of the spawner, as the bot is now, blazes may come meanwhile; a mob ends the wait.' : 'Beyond sixteen of the spawner none come from it meanwhile.'} No rod meanwhile.`,
      run: () => { goal.emptySpawner = { ...es, pick: 'heal_first', at: now, cage: P(cage) }; save?.(); } };
  }
  if (actions?.returnOverworld && !f.healable) {
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

// One pass of the hunt at a known spawner with no blaze near. -> true when
// this pass was spent here (asked, carried out, or a chosen wait going on);
// false when it is not this question's (a blaze near, no spawner known, the
// trip back chosen, or nothing to offer), and the hunt goes on as before.
// `actions.waitAtSpawner` runs the search's wait by a spawner (mob-hunt.js
// findFortressStep), which carries out the stand.
async function atSpawner(bot, task, goal, save, actions = {}, now = Date.now()) {
  const client = actions.client || task?.opportunityClient;
  if (!client || process.env.JEV_EMPTY_SPAWNER === '0' || !inNether(bot) || !bot.entity) return false;
  const fs = goal.fortressSearch;
  // A blaze the hunt can go at: its own stalk and fights. One come while a
  // stand is held is counted for the stand's end.
  if (blazeNear(bot, goal)) {
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
  const tree = options(bot, task, goal, save, actions, known, { now });
  if (!Object.keys(tree).length) return false;
  const { state } = facts(bot, goal, known);
  if (goal.emptySpawner?.standRest?.until > now) state.standResting = `the stand rests ${Math.round((goal.emptySpawner.standRest.until - now) / 60000)} more minutes: ${goal.emptySpawner.standRest.why}`;
  goal.step = { action: 'at_spawner', target: P(known.cage), off: known.off, health: bot.health, food: bot.food }; save?.();
  const decision = await require('./decisions').decide('empty_spawner', { client, bot, task, goal, save, tree, state, target: P(known.cage) });
  if (decision.stale) return true;
  const pick = decision.path.at(-1);
  if (tree[pick]?.run) await tree[pick].run();
  if (pick === 'stand_by_spawner' && actions.waitAtSpawner) await actions.waitAtSpawner();
  if (pick === 'heal_first') await rest(bot, task, goal, save);
  return true;
}

module.exports = { atSpawner, options, facts, knownSpawner, blazeNear, rest, KNOWN_NEAR, STAND_MS, REST_MS };
