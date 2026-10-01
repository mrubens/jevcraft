'use strict';
const { Vec3 } = require('vec3');
const { DAY } = require('./day');
const { handlers, observedDead, shooter, fitToFight } = require('./mob-policy');

// The Nether's own mobs were missing: a magma cube killed the dream run in
// two seconds while the bot searched for blazes, and nothing fled or swung.
// Every mob the game calls hostile, the neutral ones (endermen, zombified
// piglins) left to provoked(): trial 104 was killed by a zombie villager
// that was not on this list, hit five times with no threat in sight.
const hostileNames = new Set(['zombie', 'zombie_villager', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'parched', 'creeper', 'spider', 'vex', 'illusioner', 'guardian', 'elder_guardian', 'creaking',
  'cave_spider', 'witch', 'pillager', 'vindicator', 'evoker', 'ravager', 'phantom', 'blaze', 'wither_skeleton', 'hoglin', 'zoglin',
  'magma_cube', 'slime', 'ghast', 'piglin', 'piglin_brute', 'silverfish', 'endermite', 'warden', 'breeze']);

// The kit is not asked here: going on with what is carried is Jev's answer
// at combat_kit, said on the hunt's own question (fitness), and the full
// kit asked again here made the hunt's own target a threat the moment it
// turned, so a bot short of leggings never swung (note 790).
function combatTarget(bot, entity) {
  const encounter = bot._combatEncounter;
  return !!encounter && encounter.target === entity && Object.hasOwn(handlers, entity.name) &&
    bot.entities[entity.id] === entity && entity.isValid !== false && !encounter.task.cancelled &&
    encounter.dimension === bot.game?.dimension && encounter.expiresAt > Date.now() &&
    bot.health >= 12 && bot.food >= 12;
}

// A neutral mob that has turned. An enderman that was looked at, anything
// the bot struck, and a piglin or zombified piglin after one of them hurt
// the bot: in the game one angry zombified piglin brings every one in range,
// and none of them was ever a threat here, so a horde could beat the bot
// down while it went on digging.
// Wolves, bees and llamas turn as a pack too: mid-218-k was bitten from
// twenty to none by wolves, never counted a threat, while it went on
// choosing which cow to hunt (2026-09-27).
const GROUP_ANGER = { zombified_piglin: 30000, piglin: 30000, wolf: 30000, bee: 30000, llama: 30000, trader_llama: 30000 };
// Any other mob that hurt the bot itself, for as long.
const STRUCK_MS = 30000;
// Three blocks nearer within three seconds: an enderman walks about a block
// a second when it wanders.
const ENDERMAN_WINDOW_MS = 3000, ENDERMAN_CLOSING = 3;
function provoked(bot, entity) {
  if (bot._provokedMobs?.get(entity.id) === entity) return true;
  if (entity.name === 'enderman') {
    const key = bot.registry?.entitiesByName?.enderman?.metadataKeys?.indexOf('creepy');
    if (!(key >= 0 && entity.metadata?.[key])) return false;
    // Angry is not angry at the bot. An enderman the dragon's charge hits
    // turns on the dragon and screams all the same: seven at once in the
    // rehearsal, and the bot, counting them all its own, fought and stared
    // them into its real enemies. One that has hurt the bot lately, or has
    // come within four blocks of it, is taken as the bot's.
    if (bot._hurtBy?.enderman > Date.now() - 20000) return true;
    const here = bot.entity?.position;
    if (!here || !entity.position) return true;
    const d = entity.position.distanceTo(here);
    if (d <= 4) return true;
    // Or one closing on the bot, faster than a wander: mid-236-c's came
    // from twenty blocks screaming, counted the bot's only at four, and hit
    // for seven three times through no armour in the two seconds after
    // (2026-09-26). An enderman after the dragon closes on the dragon.
    const now = Date.now(), seen = (bot._angryEndermen ||= new Map()), was = seen.get(entity.id);
    if (!was || now - was.at > ENDERMAN_WINDOW_MS) { seen.set(entity.id, { d, at: now }); if (seen.size > 32) seen.delete(seen.keys().next().value); return false; }
    if (was.d - d >= ENDERMAN_CLOSING) {
      bot._provokedMobs ||= new Map(); bot._provokedMobs.set(entity.id, entity);
      return true;
    }
    return false;
  }
  if (bot._hurtById?.[entity.id] > Date.now() - STRUCK_MS) return true;
  if (Object.hasOwn(GROUP_ANGER, entity.name) && bot._hurtBy?.[entity.name] > Date.now() - GROUP_ANGER[entity.name]) return true;
  // The bot's own hit on one of a group, or one with its arms up coming at
  // the bot (anger.js, note 703).
  return require('./anger').angry(bot, entity);
}
// Animals that hit a player unprovoked, now and then: a goat rams whoever
// is near every half-minute to five minutes, a polar bear goes for one near
// its cubs. One that has hurt the bot lately is attacking it, as the game
// has it; the rest are facts for Jev (riskNow's animalsThatHit), not a
// threat by rule. first-days-210, at 0.7 health among goats on a mountain,
// walked up to a rabbit beside two of them and was rammed to death, told
// of neither (2026-09-26).
const UNPROVOKED = {
  goat: { hit: 2, note: 'rams whoever is near every half-minute to five minutes: about two damage and a throw of several blocks, off an edge if there is one' },
  polar_bear: { hit: 6, note: 'goes for a player near its cubs' },
};
function unprovokedThreat(bot, entity) {
  return Object.hasOwn(UNPROVOKED, entity.name) && bot._hurtBy?.[entity.name] > Date.now() - 20000;
}
const provokedEnderman = (bot, entity) => entity.name === 'enderman' && provoked(bot, entity);

const wearingGold = bot => [5, 6, 7, 8].some(slot => /^golden_/.test(bot.inventory?.slots?.[slot]?.name || ''));

// Unknown light (no block loaded) counts as lit, as the hour alone did.
function litForSpider(bot, entity) {
  const cell = entity.position && bot.blockAt?.(entity.position.offset(0, 0.5, 0).floored());
  if (!cell || (cell.skyLight == null && cell.light == null)) return true;
  return Math.max(cell.skyLight ?? 0, cell.light ?? 0) >= 12;
}

function hostileEntities(bot, radius = 24) {
  const position = bot.entity.position;
  const daytime = bot.time?.timeOfDay < DAY.DARK || bot.time?.timeOfDay >= DAY.DAWN;
  return Object.values(bot.entities || {}).filter(entity => {
    if ((!hostileNames.has(entity.name) && !provoked(bot, entity) && !unprovokedThreat(bot, entity)) || !entity.position || entity.isValid === false || observedDead(bot, entity)) return false;
    // A spider turns by day when a spider hits the bot, not when anything
    // does: a fall or a fire set every spider in view back on it.
    // Calm is the daylight where the spider stands, not the hour: the game
    // leaves one be in light of twelve or more. first-days-203, at y 19 in
    // a cave by day, charged four skeletons with a spider at arm's length
    // that no layer counted, eleven health to one in three seconds
    // (2026-09-26).
    if (entity.name === 'spider' && daytime && litForSpider(bot, entity) && !(bot._hurtBy?.spider > Date.now() - 10000)) return false;
    // A piglin leaves a player in gold alone; a brute does not. With the
    // golden boots on, the bot was digging in from piglins at eight blocks.
    // The truce ends when a piglin strikes, not when anything does: a
    // blaze's fire ended it too, and the swing reflex then started a second
    // fight with a whole group of them.
    if (entity.name === 'piglin' && wearingGold(bot) && !provoked(bot, entity)) return false;
    // A hoglin with a warped fungus, a nether portal or a respawn anchor
    // within its sensing box drops its target and attacks nothing while it
    // stays that near, struck or not (hoglin-repellent.js, note 587).
    if (require('./hoglin-repellent').pacified(bot, entity)) return false;
    return entity.position.distanceTo(position) <= radius;
  });
}

const ATTRIBUTE_MS = 5000;
// The mobs about that a list built from those in sight leaves out, said:
// every stance was told of the visible ones only, and a creeper behind a
// corner was in no option (the decision audit, 2026-09-25).
function unseenNote(bot, shown = [], radius = 16) {
  const ids = new Set(shown.map(t => t.entity?.id));
  const hidden = threats(bot, radius).filter(t => !ids.has(t.entity.id) && !t.visible).slice(0, 4);
  if (!hidden.length) return '';
  return ` Out of sight but about: ${hidden.map(t => `a ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`).join(', ')}.`;
}
// A straight line from one point to another with no block across it: the
// game's raycast, a hit within half a block of the target counted as none.
// `open`, cell keys of blocks still to be dug: a line that meets one goes on
// through it, cell by cell, as it will once they are dug (the nook below the
// rock, survival.js).
function lineClear(bot, from, to, { open = null } = {}) {
  const direction = to.minus(from), length = direction.norm();
  if (length < 1e-6) return true;
  const hit = bot.world?.raycast?.(from, direction.unit(), length);
  if (!hit || from.distanceTo(hit.intersect || hit.position) >= length - 0.5) return true;
  const at = hit.position ? hit.position.floored() : null;
  if (!open || !at || !open.has(`${at}`)) return false;
  return cellsClear(bot, hit.intersect || at.offset(0.5, 0.5, 0.5), to, open);
}
// Whether a block stops the ray from `from` along the unit `u` for
// `length`: a full block always, one with a shape of its own (a stair, a
// slab, a fence, soul sand) only where the ray meets that shape, as the
// game's raycast and mineflayer's do. Counted as a whole cube, the low half
// of a fortress stair hid a bot in a nether wart bed from a blaze resting
// on the stair above, and it was shot through the open half (note 618).
function blocksRay(b, cell, from, u, length) {
  if (b?.boundingBox !== 'block') return false;
  const shapes = b.shapes;
  if (!shapes?.length || shapes.some(s => s[0] <= 0 && s[1] <= 0 && s[2] <= 0 && s[3] >= 1 && s[4] >= 1 && s[5] >= 1)) return true;
  const o = [from.x, from.y, from.z], d = [u.x, u.y, u.z], base = [cell.x, cell.y, cell.z];
  return shapes.some(s => {
    let t0 = 0, t1 = length;
    for (let i = 0; i < 3; i++) {
      const lo = base[i] + s[i], hi = base[i] + s[i + 3];
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) return false; continue; }
      let a = (lo - o[i]) / d[i], z = (hi - o[i]) / d[i];
      if (a > z) [a, z] = [z, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, z);
      if (t0 > t1) return false;
    }
    return true;
  });
}
// Cell by cell along the line (Amanatides and Woo), a solid block not in
// `open` stopping it.
function cellsClear(bot, from, to, open) {
  const d = to.minus(from), length = d.norm(), u = d.scaled(1 / length);
  const cell = from.floored(), end = to.floored();
  const step = ['x', 'y', 'z'].map(k => Math.sign(u[k]));
  const next = ['x', 'y', 'z'].map((k, i) => step[i] ? ((step[i] > 0 ? cell[k] + 1 : cell[k]) - from[k]) / u[k] : Infinity);
  const delta = ['x', 'y', 'z'].map((k, i) => step[i] ? Math.abs(1 / u[k]) : Infinity);
  const c = [cell.x, cell.y, cell.z];
  for (let n = 0; n < 512; n++) {
    const key = `(${c[0]}, ${c[1]}, ${c[2]})`;
    if (c[0] === end.x && c[1] === end.y && c[2] === end.z) return true;
    if (!open.has(key)) { const at = new Vec3(c[0], c[1], c[2]); if (blocksRay(bot.blockAt?.(at), at, from, u, length)) return false; }
    const i = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
    if (next[i] > length) return true;
    c[i] += step[i]; next[i] += delta[i];
  }
  return false;
}
function threats(bot, radius = 24) {
  const position = bot.entity.position;
  const list = hostileEntities(bot, radius).map(entity => {
    const distance = entity.position.distanceTo(position);
    // Seen if any of head, middle or feet is: one ray to one point near the
    // head called a blaze behind a fortress fence or a floor's edge unseen,
    // and the bot walled itself in against "something shooting" that was in
    // plain sight (the user, 2026-09-24).
    const eye = position.offset(0, 1.62, 0), height = entity.height || 1.6;
    const visible = [Math.min(height, 1.6), height / 2, 0.15].some(dy => lineClear(bot, eye, entity.position.offset(0, dy, 0)));
    return { entity, distance, visible, sighted: visible };
  }).sort((a, b) => a.distance - b.distance);
  // Hit by a kind of mob a moment ago and none of that kind in sight: the
  // nearest one is the one, as a player turning to the fire knows. Fire in
  // the Nether is a blaze or a ghast, and the server says which (the hurt
  // event's source); "something is shooting at me" while hunting blazes
  // was the bot not using what it knew (the user, 2026-09-24).
  const now = Date.now();
  for (const kind of Object.keys(bot._hurtBy || {})) {
    if (now - bot._hurtBy[kind] > ATTRIBUTE_MS || list.some(t => t.entity.name === kind && t.visible)) continue;
    const attacker = list.find(t => t.entity.name === kind);
    if (attacker) Object.assign(attacker, { visible: true, attributed: true });
  }
  // The mob being fought is not forgotten when it steps below a ledge's
  // edge: in the replay of trial 57's ledge the bot turned to building a
  // shelter with the zombie it had been punching three blocks off, out of
  // sight under the lip, and was hit four times before it looked again.
  const struck = bot._struck && now - bot._struck.at < 8000 && list.find(t => t.entity.id === bot._struck.id && t.distance <= 6);
  if (struck && !struck.visible) Object.assign(struck, { visible: true, attributed: true });
  // A mob seen close a moment ago is still there when a stair edge or a
  // zombie in front hides it for a look: trial 65's creeper dropped out of
  // view for one look at four blocks, the stance was asked again without
  // it (a pillar), and again when it came back; four stances in five
  // seconds, none carried through, and the blast.
  const seen = bot._seenClose ||= new Map();
  for (const t of list) {
    if (t.sighted && t.distance <= 8) seen.set(t.entity.id, now);
    else if (!t.visible && t.distance <= 8 && now - (seen.get(t.entity.id) || 0) < 3000) Object.assign(t, { visible: true, remembered: true });
  }
  if (seen.size > 64) for (const [id, at] of seen) if (now - at > 3000) seen.delete(id);
  // Where each was a moment ago, for how fast it is coming (approach).
  trackMobs(bot, list, now);
  // And where each has been over the last minutes, and whether it came into
  // sight: from every look, not only the stance's and the pocket's, so a
  // mob that stands off is known as one wherever the turn is (note 752).
  try { require('./held-off').observe(bot, list, now); } catch (_) { /* no record */ }
  return list;
}

// Whether a mob is coming at the bot: how much nearer to where the bot is
// now it has walked over the last second or two, in blocks a second. Its
// own walk, not the gap: a zombie after a running player walks at it at
// 2.3 blocks a second while the gap grows. mid-244-a's retreat ran fourteen
// blocks from four zombies, told they would be at the bot 3.5 seconds after
// the run; the run over, they were ten blocks off, past the eight counted
// for a biter, and nothing was a threat: the night's pocket was asked in
// the stance's place and dug with them walking up (note 544).
const TRACK_MS = 2000, TRACK_MIN_MS = 400;
function trackMobs(bot, list, now = Date.now()) {
  const tracks = bot._mobTracks ||= new Map();
  for (const t of list) {
    const p = t.entity.position, id = t.entity.id;
    if (!p || id === undefined) continue;
    const samples = tracks.get(id) || [];
    if (!samples.length || now - samples.at(-1).at >= 100) samples.push({ at: now, x: p.x, y: p.y, z: p.z });
    while (samples.length && now - samples[0].at > TRACK_MS + 500) samples.shift();
    tracks.set(id, samples);
    const here = bot.entity.position;
    const old = samples.find(s => now - s.at <= TRACK_MS && now - s.at >= TRACK_MIN_MS);
    if (old && here) t.approach = (new Vec3(old.x, old.y, old.z).distanceTo(here) - t.distance) / ((now - old.at) / 1000);
  }
  if (tracks.size > 128) for (const [id, s] of tracks) if (!s.length || now - s.at(-1).at > 5000) tracks.delete(id);
}
// A block a second nearer: coming, not milling about. A walker's chase is
// two to five blocks a second (combat-estimate MOB_SPEED).
const COMING = 1;
// The walkers coming at the bot now, within the twenty-four a stance
// counts and their own follow range: each with its speed and how soon it
// is at the bot at that speed (the jar's, as dig_down's race and the
// retreat's chase are said). Facts for the questions asked while they
// come: the night's pocket, the wait for daylight, the stance.
function coming(bot, { radius = 24, list = null } = {}) {
  const { blocksPerSecond, followRange } = require('./combat-estimate');
  return (list || threats(bot, radius)).filter(t => t.distance <= Math.min(radius, followRange(t.entity.name)) && !shooter(t.entity) && t.visible && t.approach >= COMING)
    .map(t => ({ ...t, speed: blocksPerSecond(t.entity.name), atBotIn: Math.max(0, t.distance - 1.5) / blocksPerSecond(t.entity.name) }))
    .sort((a, b) => a.atBotIn - b.atBotIn);
}
// The mobs a stance Jev chose was chosen against, still coming at the bot
// once it is over: a retreat's chasers walking up after the run, the
// zombies come back round a pillar come down. The stance question is
// asked again with them, not the night's pocket or the work in its place.
// In sight: a pocket closed round the bot hides the ones outside it.
function followers(bot, { list = null } = {}) {
  const s = bot?._stance;
  if (!s || s.choice === 'keep_working' || !s.ids?.length || !(s.running || s.ranAt)) return [];
  if (!s.ids.some(id => bot.entities?.[id])) return [];
  return coming(bot, { list: list && list.filter(t => t.distance <= 24) }).filter(t => s.ids.includes(t.entity.id) && !combatTarget(bot, t.entity) && !hunted(bot, t.entity)).map(t => ({ ...t, following: s.choice }));
}

// Mid-encounter, a second mob interrupts only when it is nearly on the
// bot: every blaze in a fortress has another in view, and the fight was
// abandoned for a flight each time one showed.
function inEncounter(bot) {
  const e = bot._combatEncounter;
  return !!e && e.expiresAt > Date.now() && !e.task?.cancelled && e.dimension === bot.game?.dimension;
}
// A blaze shoots from forty blocks; the bot was hit on a ledge from
// beyond sixteen and stood there recovering health it was losing. Hurt in
// the last few seconds, a shooter in view counts at twice the range.
// The mob the bot came for is not an emergency. The arena's blaze drills
// sealed it in against the very blazes it was hunting: the crowd rule fired
// first, the hunt never got its turn, and three runs ended with no swing and
// no rod. While a hunt for this kind is live and the bot is whole and
// armoured, the hunt owns them; below the fight floor the survival layer
// takes them back.
// The hunt's claim alone. Where the question is "should this mob keep the
// bot hidden" rather than "should it swing", a blaze at the door is the
// best reason to come out, not a reason to stay in.
function claimed(bot, entity) {
  const hunt = bot._huntingEntity;
  return !!hunt && hunt.name === entity.name && hunt.until > Date.now() && fitToFight(bot);
}

// The kind a chosen stance is walking in on to strike (blaze-stand.js), for
// the walk only: not a claim the reflexes or the survival layer yield to.
function closingOn(bot, entity) {
  const c = bot._closingOn;
  return !!c && c.name === entity?.name && c.until > Date.now();
}

function hunted(bot, entity) {
  const hunt = bot._huntingEntity;
  // Never within a sword's reach. The exemption exists so a distant blaze
  // is not sealed against; a blaze in the bot's face is an emergency
  // whatever the hunt intends, and the emergency answer is a swing. Without
  // this, four blazes sat at two blocks while the deliberate fight found no
  // candidate and the reactive one had been told to look away: forty-three
  // damage, no swing thrown.
  if (entity.position && entity.position.distanceTo(bot.entity.position) <= 3.5) return false;
  return !!hunt && hunt.name === entity.name && hunt.until > Date.now() && fitToFight(bot);
}

// The kind Jev chose to hunt tonight (survival.js huntStep): closed on and
// struck by the hunt, not fled from or bunkered against. Any other mob that
// comes is still the encounter's.
function nightHunted(bot, entity) {
  const hunt = bot._nightHunt;
  return !!hunt && hunt.until > Date.now() && entity?.name === hunt.name;
}

// The walkers out of sight within a few blocks that have a way to the bot
// (walk-reach.js, which judges only those that walk; the ones it cannot
// judge, a spider that climbs or a cube that leaps, are left to the rules
// above): out of sight is not out of reach (note 542). A creeper and a
// warden are counted by their own rules above.
const UNSEEN_CLOSE = 5;
function unseenClose(bot, list) {
  const { WALKERS, walkersApart } = require('./walk-reach');
  const near = (list || threats(bot, UNSEEN_CLOSE)).filter(t => !t.visible && t.distance <= UNSEEN_CLOSE && t.entity?.position && WALKERS.has(t.entity.name) && !shooter(t.entity) && !['creeper', 'warden'].includes(t.entity.name));
  if (!near.length) return [];
  let apart = { ids: new Set() };
  try { apart = walkersApart(bot, near); } catch (_) { /* unsure: they reach */ }
  return near.filter(t => !apart.ids.has(t.entity.id));
}

// The walkers about with no way to the bot (walk-reach.js: none within the
// search's twelve blocks, sure or with any way round past them), kept half
// a second: every look asks, and the search is a few thousand cells.
// mid-244-ad-nether-2 stood on its own bridge for minutes, the stance asked
// every fifteen seconds for a sword piglin on the slope below that had no
// way onto it, and the crossing never went on (notes 560, 566).
const NO_WAY_MS = 500, NO_WAY_REACH = 16;
function noWayIds(bot, list = null) {
  const { WALKERS, walkersApart } = require('./walk-reach');
  const walkers = (list || threats(bot, NO_WAY_REACH)).filter(t => t.distance <= NO_WAY_REACH && t.entity?.position && WALKERS.has(t.entity.name) && !shooter(t.entity) && !t.entity.vehicle);
  if (!walkers.length || !bot.entity?.position) return new Set();
  const cell = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  const key = `${bot.game?.dimension}|${cell(bot.entity.position)}|${walkers.map(t => `${t.entity.id}@${cell(t.entity.position)}`).sort().join(';')}`;
  const now = Date.now(), kept = bot._noWay;
  if (kept && kept.key === key && now - kept.at < NO_WAY_MS) return kept.ids;
  let ids = new Set();
  try { ids = walkersApart(bot, walkers).ids; } catch (_) { /* unsure: they reach */ }
  bot._noWay = { key, at: now, ids };
  return ids;
}
// A walker with no way to the bot is no encounter while it stays so, unless
// it has hit the bot a moment ago (then the search is wrong about it: a
// knock, a gap it fits). What it holds is its own: a crossbow piglin
// shoots, and walk-reach judges no shooter.
const WALKERS_JUDGED = { has: name => require('./walk-reach').WALKERS.has(name) };
// A creeper the alert was raised for (arbiter.js observeReflexes), kept as
// the threat out of sight while it is alive and under CREEPER_MARK_REACH
// (one in sight counts to eight already), for CREEPER_MARK_MS after it was
// last within the alert's line: the work does not resume beside it (note
// 752i, 25597's death at 19:49:12Z: out of sight at 4.6, round the corner at
// 1.7). Past five out of sight it is note 696's creeper behind the rock.
const CREEPER_MARK_MS = 30000, CREEPER_MARK_REACH = 5;
function markCreeper(bot, t, now = Date.now()) { if (bot && t?.entity?.id != null) (bot._creeperMarks ||= {})[t.entity.id] = now; }
function creeperMarked(bot, t, now = Date.now()) {
  const e = t?.entity;
  return !!e && e.name === 'creeper' && e.isValid !== false && t.distance < CREEPER_MARK_REACH && (bot?._creeperMarks?.[e.id] || 0) > now - CREEPER_MARK_MS;
}
// A mob that has stood off for held-off.js's STANDOFF_MS (note 752): never
// at its reach, no nearer, no hit from its kind in that time, a shooter
// out of sight all the while. It is said with that fact (reachSays) and is
// not a threat that ends the work while it holds. 25595 (mid-242-ya) stood
// on its span 12 of 14 minutes at full health beside a hoglin 3.9 blocks
// off, the stance and turn_priority answering it every minute, its
// set_aside_rung answer never carried out; the hoglin never came.
// A run at a mob that found no way to it (survival.js charge and the
// fight's stand), kept per mob while the bot stays within NO_RUN_MOVED of
// where it ran from and the mob lands no hit (note 752e). bot._unreachable
// keeps the same for twenty seconds only; 25595 (16:43:50 to 16:53Z) was
// offered the fight about twelve times against a magma cube no run could
// reach, each ending in no route, the stance never told.
const NO_RUN_MOVED = 4;
function noteNoRun(bot, t, now = Date.now()) {
  const e = t?.entity, p = bot?.entity?.position;
  if (!e || !p) return;
  const runs = bot._noRunTo ||= {};
  const was = runs[e.id];
  runs[e.id] = { at: now, first: was?.first ?? now, tries: (was?.tries || 0) + 1, from: { x: p.x, y: p.y, z: p.z }, name: e.name };
}
// The standing record for a mob, or null: gone once the bot has moved off,
// or the mob has hit the bot since the run.
function noRunTo(bot, t, now = Date.now()) {
  const e = t?.entity, p = bot?.entity?.position, r = bot?._noRunTo?.[e?.id];
  if (!r || !p) return null;
  if (Math.hypot(p.x - r.from.x, p.y - r.from.y, p.z - r.from.z) > NO_RUN_MOVED || (bot._hurtById?.[e.id] || 0) > r.at || (bot._hurtBy?.[e.name] || 0) > r.at) { delete bot._noRunTo[e.id]; return null; }
  return { secondsAgo: Math.max(1, Math.round((now - r.at) / 1000)), tries: r.tries };
}
function standsOff(bot, t, now = Date.now()) {
  if (!t?.entity || atItsReach(bot, t)) return null;
  // No run could reach it and it has not hit since: it stands off from now,
  // not after a minute (note 752e). Not a shooter (no reach of its own to
  // judge), nor a creeper or a warden.
  // Not while the bot has been hurt in the last four seconds by what it
  // cannot tell (a hit with no source named): as immediateThreat's own.
  const hurtNow = (bot._recentHurtAt || 0) > now - 4000;
  const nr = !hurtNow && !shooter(t.entity) && !['creeper', 'warden'].includes(t.entity.name) ? noRunTo(bot, t, now) : null;
  if (nr) return { seconds: nr.secondsAgo, nearest: Math.round(t.distance * 10) / 10, farthest: Math.round(t.distance * 10) / 10, inSight: !!t.visible, noRun: nr };
  try { return require('./held-off').stoodOff(bot, t, { now, shoots: shooter(t.entity) }); } catch (_) { return null; }
}
const r1 = n => Math.round(n * 10) / 10;
// Whether a mob can reach the bot, as a fact said on every threat claim and
// stance (note 752): at its reach now; a shooter's line of sight; a
// walker's way to the bot (walk-reach.js) and the bot's own way to it (a
// run at it that found none, bot._unreachable); and what it has done over
// the time it has been about (held-off.js): how near it came and whether
// it or its kind hit the bot. -> words, or '' for nothing known.
function reachSays(bot, t, { list = null, now = Date.now() } = {}) {
  const e = t?.entity;
  if (!e) return '';
  if (atItsReach(bot, t)) return 'at its reach of the bot now';
  const parts = [];
  const shoots = shooter(e);
  if (shoots) parts.push(t.visible ? 'in sight: it can shoot the bot from where it is' : 'out of sight: no line to shoot the bot along now');
  else if (WALKERS_JUDGED.has(e.name) && !e.vehicle) {
    let apart = false;
    try { apart = noWayIds(bot, list || [t]).has(e.id); } catch (_) { apart = false; }
    parts.push(apart ? 'no way to the bot is found through the ground between' : 'a way to the bot is found');
  }
  const runAt = bot?._unreachable, nr = noRunTo(bot, t, now);
  if (nr) parts.push(`a run at it ${nr.secondsAgo} seconds ago found no way to it from here${nr.tries > 1 ? ` (${nr.tries} runs in all)` : ''}`);
  else if (runAt?.until > now && runAt.ids?.includes(e.id)) parts.push(`a run at it ${Math.max(1, Math.round((now - (runAt.until - 20000)) / 1000))} seconds ago found no way to it`);
  let rec = null, off = null;
  try { const h = require('./held-off'); rec = h.recordOf(bot, t, { now }); off = standsOff(bot, t, now); } catch (_) { rec = null; }
  const hitAt = Math.max(bot?._hurtById?.[e.id] || 0, bot?._hurtBy?.[e.name] || 0);
  const hit = hitAt ? `its kind hit the bot ${Math.max(1, Math.round((now - hitAt) / 1000))} seconds ago` : null;
  const far = require('./held-off').FAR_SIGHT[e.name];
  const noShots = off && shoots && t.visible && !(far && off.nearest > far.blocks);
  if (noShots) { const i = parts.indexOf('in sight: it can shoot the bot from where it is'); if (i >= 0) parts.splice(i, 1); }
  if (noShots) parts.push(`in sight by the look for ${off.seconds} seconds and within its reach, yet no shot has come at the bot in that time, landed or not: its line is not one it can shoot along (a wall of the bot's own, or it is not shooting); not a threat that stops the work while that holds, and one again the moment a shot comes or its kind lands a hit`);
  else if (off && far && shoots) parts.push(`it has stood off ${off.seconds} seconds, ${off.nearest} to ${off.farthest} blocks off, in sight, no hit from its kind in that time: in the played record, of the ${e.name.replaceAll('_', ' ')}'s shots coming at the bot from ${far.blocks} blocks and more ${far.landed} of ${far.of} landed (from under ${far.near}, ${far.nearLanded} of ${far.nearOf}); not a threat that stops the work while that holds, and one again the moment it comes within ${far.blocks} or its kind lands a hit`);
  else if (off?.noRun) parts.push('it has not hit the bot since: not a threat that stops the work while that holds, and one again the moment it lands a hit, comes to its reach, or the bot moves off');
  else if (off && e.name === 'creeper') parts.push(`it has stood off ${off.seconds} seconds, ${off.nearest} to ${off.farthest} blocks off, no nearer and never within ${require('./held-off').CREEPER_NEAR} (its lighting distance and a second's walk), not walking at the bot: not a threat that stops the work while that holds, and one again the moment it walks at the bot or comes within ${require('./held-off').CREEPER_NEAR}`);
  else if (off) parts.push(`it has stood off ${off.seconds} seconds, ${off.nearest} to ${off.farthest} blocks off, no nearer and no hit from its kind in that time: not a threat that stops the work while that holds, and one again the moment it comes nearer, to its reach, or its kind lands a hit`);
  else if (rec && rec.seconds >= 10) parts.push(`about ${rec.seconds} seconds, ${rec.nearest} to ${rec.farthest} blocks off${hit && now - hitAt <= rec.seconds * 1000 ? `; ${hit}` : ', no hit from its kind in that time'}`);
  else if (hit && now - hitAt < 60000) parts.push(hit);
  return parts.join('; ');
}
const cannotGetToTheBot = (bot, t, list) =>!shooter(t.entity) && !(bot._hurtById?.[t.entity.id] > Date.now() - ATTRIBUTE_MS) && noWayIds(bot, list).has(t.entity.id);

// At a live blaze spawner the bot still owes rods to, a blaze beyond arm's
// length is the work, not a threat that ends it: the box, the slit and the
// stay-and-fight are all built to answer exactly that blaze, said with the
// cage's own cap on every one of their options (spawner-clock.js capSays).
// Without this, the generic guard every dig and walk carries (task.check,
// checkThreats below) threw on the very blaze a spawner job was for: 25598
// (note 731) chose open_slit at 07:31:05, was cut a second later by
// "Threat nearby: blaze at 4 blocks" with one dig done of the slit's own,
// and the job could never finish, over and over. One that has closed to
// arm's length is still the body's own danger: the stance answers it as
// any melee mob (fight, back off, box), same as before.
const SPAWNER_MELEE = 3;
// { stoodOff: true }: the mob that would be the threat but that it has
// stood off (standsOff), for the claim that offers it beside the work
// (survival.js claim, note 752); undefined when a real threat is about.
function immediateThreat(bot, { stoodOff = false } = {}) {
  if (stoodOff) {
    if (immediateThreat(bot)) return undefined;
    const t = immediateThreat(bot, { keepStoodOff: true });
    return t && !t.projectile && standsOff(bot, t) ? { ...t, stoodOff: standsOff(bot, t) } : undefined;
  }
  return threatScan(bot, arguments[1]?.keepStoodOff);
}
function threatScan(bot, keepStoodOff = false) {
  const fighting = inEncounter(bot), hurt = bot._recentHurtAt > Date.now() - 4000;
  // Computed at most once a call: cageFight reads the goal's rods and the
  // fortress map, not cheap to ask of every mob in the scan below.
  let liveSpawner;
  const atLiveSpawner = () => { if (liveSpawner === undefined) { try { liveSpawner = !!require('./cage-hold').cageFight(bot, bot._goal); } catch (_) { liveSpawner = false; } } return liveSpawner; };
  const spawnerCombat = t => t.entity.name === 'blaze' && t.distance > SPAWNER_MELEE && atLiveSpawner();
  // The cage's plan held, the bot in its box or at its slit (cage-hold.js,
  // note 774): a blaze or its fireball ends the step only from inside the
  // box or by a hit through it. 25584's box and slit were cut by "Threat
  // nearby: blaze at 4 to 6 blocks" and "small_fireball at 5 to 16 blocks"
  // within seconds, every time: 100 of 160 such holds since 06:00Z.
  const sheltered = t => { try { return require('./cage-hold').shelterKeepsOff(bot, t); } catch (_) { return false; } };
  // Another of the kind being fought never ends the fight: the hunt's own
  // crowd rule decides how many blazes are too many.
  const kin = t => fighting && t.entity.name === bot._combatEncounter.target?.name;
  // Mobs Jev chose to leave be (the keep_working stance): not a threat for
  // the time it gave them, unless one comes within three blocks or a hit
  // lands.
  const waved = !hurt && bot._wavedOff?.until > Date.now() ? bot._wavedOff.ids : null;
  // Left be beyond a distance of its own where one was set: a quiet scene's
  // mobs are left only while none comes within eight (note 700).
  const wavedBeyond = bot._wavedOff?.beyond || 3;
  // And mobs a charge could not reach (survival.js charge), while they
  // land nothing: they cannot reach the bot either.
  const unreachable = !hurt && bot._unreachable?.until > Date.now() ? bot._unreachable.ids : [];
  // A creeper Jev chose to leave be is left only while it is further than
  // its fuse's reach and a second and a half's walk: at three it is already
  // lighting. (One a charge could not reach, off on a ledge, stays left be
  // to five: trial 73 faced such a one for three minutes.)
  // mid-231-i, at two health, had one follow it in from nine blocks to two,
  // no stance asked, and was blown up (2026-09-27).
  const { LIGHTS_AT, APPROACH } = require('./combat-estimate');
  const creeperFar = LIGHTS_AT + APPROACH * 1.5;
  const leftBe = t => (!!waved && waved.includes(t.entity.id) && t.distance > (t.entity.name === 'creeper' ? Math.max(creeperFar, wavedBeyond) : wavedBeyond)) ||
    // Not a shooter: out of a charge's reach is not out of its bow's. mid-230-p's
    // skeleton, marked unreachable after a charge, shot it every three to
    // six seconds from eight blocks, each gap longer than the four seconds
    // "hurt" lasts, and nothing answered it, 9.7 to none (note 457).
    // Nor one walking at the bot: its own walk is the way a charge did not
    // find. mid-208-k-nether-1's hoglin, left be as out of reach at twelve
    // blocks, came on at four blocks a second while nothing claimed it and
    // bit from two, where a hoglin's wide body already reaches (note 552).
    // Nor a walker: a charge that could not reach it says the bot has no way
    // to the mob, not that the mob has none to the bot, and whether it has is
    // walk-reach's to judge (cannotGetToTheBot, last below). mid-242-ae's
    // spear piglin, two below and four blocks off, was set aside so when the
    // fight's run at it went nowhere; after the meal survival claimed
    // nothing, the work had the turn unasked, and the piglin came up and
    // speared it from 7.7 to none (note 586). Nor one at its own reach now.
    (unreachable.includes(t.entity.id) && !shooter(t.entity) && !WALKERS_JUDGED.has(t.entity.name) && !atItsReach(bot, t) && !(t.approach >= COMING) && t.distance > (t.entity.name === 'creeper' ? 5 : 2));
  // A creeper within four blocks is one whether it is in sight or not: it
  // comes round the corner already at its fuse's distance. mid-79-b stood
  // recovering for five seconds with one out of sight beside it, and the
  // blast was the first it knew (2026-09-26).
  // Nor does a warden need to be seen: its sonic boom goes through walls,
  // ten a hit. mid-230-h stood recovering at y -52 with one sixteen blocks
  // off behind the rock and was "obliterated by a sonically-charged
  // shriek" with nothing answering it (2026-09-27).
  // A biter within a hit and a jump, seen or not, where a knock is a fall:
  // mid-227-r-nether-1-nether-1 stood at the lip of a forty-six-block drop
  // into lava with a magma cube three blocks up on a ledge, out of every
  // ray, for twelve seconds; its first hit threw the bot over (note 476).
  let deadlyEdge;
  const edge = () => {
    if (deadlyEdge === undefined) {
      const drop = require('./terrain').dropNear(bot, bot.entity.position.floored(), 3);
      deadlyEdge = !!drop && (drop.into === 'lava' || drop.damage >= (bot.health ?? 20) / 2);
    }
    return deadlyEdge;
  };
  // A biter out of sight a few blocks off with a way to the bot comes
  // round the corner at arm's length (unseenClose). mid-242-ac-nether-1-
  // fortress-1, at 13.1 health, had a wither skeleton 3.6 blocks off round
  // a fortress corner; nothing claimed it, the meal took the turn, and the
  // skeleton's first blow took 6.7 (note 559).
  let close;
  const unseenNear = t => { if (!close) close = new Set(unseenClose(bot, about).map(u => u.entity.id)); return close.has(t.entity.id); };
  const seen = t => t.visible || (t.entity.name === 'creeper' && (t.distance <= 4 || creeperMarked(bot, t))) || (t.entity.name === 'warden' && t.distance <= 24) ||
    (t.distance <= 3.5 && !shooter(t.entity) && edge()) || (t.distance <= UNSEEN_CLOSE && !shooter(t.entity) && unseenNear(t));
  // A shooter is a threat within its own reach: a ghast fires from forty
  // blocks. mid-244-e walked a ledge at y 89 with one in sight at seventeen
  // to nineteen, outside the sixteen counted for any shooter, and its
  // fireball threw the bot off, shield in hand (2026-09-27).
  const { RANGE, FIRE_REACH } = require('./combat-estimate');
  // A shooter whose kind has hit the bot a moment ago is in reach by that
  // fact, however far: mid-227-r-nether-3 stood on a span taking fire and
  // fireballs from three blazes thirty-two to thirty-five blocks off for
  // fourteen seconds, past the thirty-two counted when hurt and hunted
  // besides, and no stance was asked, twenty health to none (note 491).
  const hitBy = t => Date.now() - (bot._hurtBy?.[t.entity.name] || 0) < ATTRIBUTE_MS;
  // A blaze is counted where its fire lands, not as far as it fires: its
  // volleys land one more often than not within about twenty-two blocks
  // (combat-estimate FIRE_REACH, the game's scatter), and past that its
  // shots landing are what make it one. Counted at its forty-eight, every
  // blaze in sight near a fortress held the turn (notes 509, 513).
  const shooterReach = t => fighting ? 8 : Math.max(hitBy(t) ? Math.max(48, RANGE[t.entity.name] || 0) : hurt ? 32 : 16, FIRE_REACH[t.entity.name] || 0);
  const about = threats(bot, 64);
  const mob = about.find(t => !combatTarget(bot, t.entity) && seen(t) && !kin(t) && (!hunted(bot, t.entity) || (shooter(t.entity) && hitBy(t))) && !leftBe(t) && !nightHunted(bot, t.entity) && !spawnerCombat(t) && !sheltered(t) &&
    t.distance <= (shooter(t.entity) ? shooterReach(t) : t.entity.name === 'warden' ? 24 : (fighting ? 5 : 8)) &&
    // Nor one that has stood off (note 752): about a minute and more, never
    // at its reach, no nearer, no hit from its kind, a shooter out of sight.
    (keepStoodOff || !standsOff(bot, t)) &&
    // Last, as it is the dearest: a walker that cannot get to the bot.
    !cannotGetToTheBot(bot, t, about));
  if (mob) return mob;
  // The mobs a stance Jev chose was chosen against, while it holds: the
  // survival layer's, seen or not. mid-242-a's pillar went two up with
  // zombies seven to eight blocks off, now out of sight under its top and
  // past the eight counted for a biter, the skeletons past sixteen: nothing
  // was a threat any more, the claim became shelter, survival_priority was
  // asked in the pillar's place, and the shelter's route searches stood the
  // bot on the pillar's edge five seconds under a skeleton's arrows (note 535).
  const kept = stanceMobs(bot, Date.now(), { keepStoodOff }).filter(t => !sheltered(t))[0];
  if (kept) return kept;
  // And once it is over, those of them still coming at the bot (followers):
  // mid-244-a's run ended with four zombies ten blocks behind and walking
  // up, past the eight counted for a biter, and the night's pocket was
  // asked and dug in the stance's place until they bit (note 544).
  const follower = followers(bot, { list: about }).filter(t => !sheltered(t))[0];
  if (follower) return follower;
  // A shot on its way is a threat of its own, its shooter seen or not:
  // mid-230-g, waiting to heal by a fortress, was hit by four fireballs in
  // six seconds from a ghast out of view, the fourth throwing it into the
  // lava (2026-09-27). Not while fighting: the fight answers shots.
  if (fighting) return undefined;
  const shot = require('./projectile-guard').incoming(bot, { reach: 16 }).find(e => !sheltered({ entity: e, distance: e.position.distanceTo(bot.entity.position) }));
  if (shot) return { entity: shot, distance: shot.position.distanceTo(bot.entity.position), visible: true, projectile: true };
  return undefined;
}

// Keep a route outside attack range plus a movement margin. If a mob already
// approached us, allow retreat without forcing a path to start outside the
// buffer. Cover is intentionally not an invitation to tunnel toward a mob.
// Whether a mob has a line of sight to the bot. One behind twenty blocks of
// rock cannot shoot, and underground there is always one somewhere: the
// dream run could not dig a staircase toward a skeleton in the next cave.
function seen(bot, entity) {
  const eye = bot.entity.position.offset(0, 1.5, 0);
  const target = entity.position.offset(0, Math.min(entity.height || 1.6, 1.6), 0);
  const direction = target.minus(eye);
  const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
  return !hit || eye.distanceTo(hit.intersect || hit.position) >= eye.distanceTo(target) - 0.5;
}

// `sight`: a Map kept by the caller for one look at the mobs (movement.js's
// quarter-second observation), each mob's line of sight to the bot worked
// out once, not once a cell: the route search asked it of every cell it
// expanded, a raycast a mob a cell, 9 of 20 seconds of a bot's CPU in its
// lava fetch, and the event loop held 3 to 6 seconds at a time (25598,
// 2026-10-01 12:41Z, note 806). The line is the bot's, whatever the cell.
function safeFromHostiles(bot, point, entities = hostileEntities(bot, 64), sight = null) {
  if (bot.game?.gameMode === 'creative' || bot.game?.difficulty === 'peaceful') return true;
  return entities.every(entity => {
    // The mob the hunt has claimed is not avoided by the pathfinder either.
    // Every step toward a blaze makes a cell closer to it, and "closer to a
    // shooter" was the definition of unsafe: the approach shaft dug through
    // to within three blocks of the spawner room and the walk into each
    // freshly dug cell was refused, an hour and a half in one spot. The
    // claim still lapses under fourteen health, and the survival layer
    // takes over as before.
    // And the kind a stance Jev chose goes at (close_in, break_spawner:
    // blaze-stand.js closingOn), whatever the health: the hunt's claim
    // lapses under fourteen, and with it every walk toward a blaze in sight
    // was "no route". mid-243-ag-fortress-1 chose close_in at 14.1 and stood
    // on one cell 22 seconds behind the shield, burning, the walk refused at
    // 13.1 (note 602); six live deaths chose it and closed on nothing.
    if (combatTarget(bot, entity) || hunted(bot, entity) || closingOn(bot, entity)) return true;
    // Out of sight, a mob only matters when it is nearly at the wall.
    const toPoint = entity.position.distanceTo(point), toBot = entity.position.distanceTo(bot.entity.position) - 0.25;
    // Far enough by the widest radius, or by the mob's own distance: no
    // line of sight to work out.
    if (toPoint >= Math.min(shooter(entity) ? 20 : 12, toBot)) return true;
    let isSeen = sight?.get(entity);
    if (isSeen === undefined) { isSeen = seen(bot, entity); sight?.set(entity, isSeen); }
    const radius = !isSeen ? 6 : shooter(entity) ? 20 : 12;
    return toPoint >= Math.min(radius, toBot);
  });
}

class NeedsSafety extends Error {
  constructor(threat) { super(`Threat nearby: ${threat.entity.name} at ${Math.round(threat.distance)} blocks`); this.name = 'NeedsSafety'; }
}

function checkThreats(bot) {
  const threat = immediateThreat(bot);
  if (threat) throw new NeedsSafety(threat);
}

// The encounter stance Jev chose (survival.js stanceStep), while it holds:
// fifteen seconds from the choice, and until six health, or half the health
// it was chosen at, is gone since (holdLoss, note 793).
// The reflexes that would stop it give way to it meanwhile: the hurt
// watchdog, the shield raised at each arrow, the meal. Asked again sooner
// when it fails or a mob it was not chosen against comes within six blocks.
// Only while it is being carried out (run within the last two seconds): the
// work that comes back once the mobs are gone has its watchdog back.
const STANCE_HOLD_MS = 15000, STANCE_HEALTH = 6, STANCE_NEWCOMER = 6;
// The health a held answer loses before it gives way (note 793): six, or
// half the health it was chosen at, whichever is less. Six alone is no end
// for an answer chosen under six: of the 66 Overworld deaths on fresh trials
// from 2026-09-30T08:40Z to the Jev-down at 04:57:47Z, 22 died under a
// stance whose damage end was never reached, each priced at or past the
// health it was chosen at (scripts/fatal-spans.js); 25583 (mid-242-yd,
// 09:15:16Z) chose shield_guard at 4.9 health priced 38.7 and held it to
// none 16.8 seconds later with food carried, the meal and the hurt
// watchdog giving way to it throughout.
const holdLoss = health => Math.min(STANCE_HEALTH, Math.max(0, health ?? 20) / 2);
// Chosen on its own estimate, at the estimate's pace (its damage spread
// over its seconds, past them at its rate while held on, and one blow of
// the hardest hitter's give): and never more than half the health it was
// chosen at, so a price at or past the health is not a hold to the death.
function pacedLoss(health, expects, elapsed, { extended = false } = {}) {
  if (!expects) return holdLoss(health);
  const paced = expects.damage * (extended ? elapsed : Math.min(elapsed, expects.seconds)) / Math.max(0.1, expects.seconds) + (expects.oneHit || 0);
  return Math.min(paced, Math.max(0, health ?? 20) / 2);
}
// A stance held on past its estimate with nothing new (holds.js, note 599)
// holds to its hold's time.
const stanceEnds = s => s.hold?.extended ? s.hold.until : s.at + STANCE_HOLD_MS;
// A box, hole or wall Jev chose outside encounter_stance (the hunt's own
// hunt_target, or empty_spawner's lull) holds the same way while it is
// actively run: blaze-stand.js huntFromStand keeps bot._standHold up for as
// long as its run() is in flight (note 719: 25597 stood boxed 3.5 minutes
// with shot_answer asked 23 times, about every 9 seconds, because box_here
// chosen through hunt_target never set bot._stance, so note 709's stance
// answer never saw it holding).
function standHeld(bot, now = Date.now()) {
  const s = bot?._standHold;
  return s && (bot.health ?? 0) > s.health - holdLoss(s.health) ? s : null;
}
// defer, chosen a moment ago and near here: hunt_target's own answer that
// the observed situation is unsuitable to hunt right now (note 723). A
// closing stance (shot-reflex.js STANCE_SHOTS.closing) chosen against the
// same mobs a second later reverses it without either question having seen
// the other's answer, as plan-chain.js reads a reversal among the plan's
// own questions (note 705): 25597 answered hunt_target defer at 04:59:17
// and, ten seconds later, encounter_stance answered charge_nearest against
// the blazes just left alone, took fireballs, and died.
const DEFER_NEAR = 12, DEFER_MS = 30000;
function huntAnswerJustNow(goal, bot, now = Date.now()) {
  const d = goal?.lastHuntDefer;
  if (!d || now - d.at > DEFER_MS) return null;
  const here = bot?.entity?.position;
  if (!here || Math.hypot(here.x - d.position.x, here.y - d.position.y, here.z - d.position.z) > DEFER_NEAR) return null;
  return { at: d.at, secondsAgo: Math.round((now - d.at) / 1000) };
}
function stanceHeld(bot, now = Date.now()) {
  const s = bot?._stance;
  if (s && now < stanceEnds(s) && (s.running || now - (s.ranAt ?? s.at) < 2000) && (bot.health ?? 0) > s.health - holdLoss(s.health)) return s;
  return standHeld(bot, now);
}
// The mobs the stance holds against: those it was chosen against (its ids)
// still within the twenty-four a stance counts, nearest first, for as long
// as it was said to hold (fifteen seconds, its estimate's seconds where it
// had one, six health), once it has run. A stance ends when it fails
// (survival.js stanceStep drops it), when its time or health is spent, and
// is asked again when a mob it was not chosen against comes near; not
// because one of its mobs stepped out of sight or out of a count. Leaving
// the mobs be (keep_working) holds nothing against them.
function stanceMobs(bot, now = Date.now(), { keepStoodOff = false } = {}) {
  const s = bot?._stance;
  if (!s || s.choice === 'keep_working' || !s.ids?.length || !(s.running || s.ranAt)) return [];
  if (s.hold?.extended ? now >= s.hold.until : now - s.at >= Math.min(STANCE_HOLD_MS, s.expects?.seconds ? s.expects.seconds * 1000 : Infinity)) return [];
  if ((bot.health ?? 0) <= s.health - holdLoss(s.health)) return [];
  // Every side closed at the feet or the head (unstuck.js walledOf): a box
  // shut all round, not a mob stepping out of sight for a tick mid-fight
  // in the open (this comment's own case above, kept unchanged for that).
  // A mob out of sight then has no line through the rock either, walker or
  // shooter, and is not still held against the bot (note 741, 25588: a
  // blaze 1.9 blocks off through such a box was "kept" twenty-one
  // turn_priority asks running, take_cover and box_here doing nothing
  // against a wall already shut, while the box could not be touched).
  let sealed;
  const walledAllRound = () => { if (sealed === undefined) { try { const u = require('./unstuck'); sealed = !!u.walledOf(u.liveView(bot), bot.entity.position.floored()); } catch (_) { sealed = false; } } return sealed; };
  // Nor one that has stood off since (note 752): a stance held on and on
  // (holds.js) against a hoglin that never came kept 25595 on its span.
  return threats(bot, 64).filter(t => s.ids.includes(t.entity.id) && t.distance <= stanceReach(t.entity) && !combatTarget(bot, t.entity) && (t.visible || !walledAllRound()) && (keepStoodOff || !standsOff(bot, t, now))).map(t => ({ ...t, stance: s.choice }));
}
// How far a mob a stance was chosen against is kept: the twenty-four a
// stance counts, and a shooter as far as it fires from (a ghast's sixty-
// four, a blaze's forty-eight). mid-235-p-nether-4-fortress-2 hid from a
// ghast that drifted to twenty-five to forty blocks: past twenty-four the
// stance kept nothing, the work had the turn and stood still, and the
// ghast found a new line and fired, three times (note 551).
function stanceReach(entity) {
  if (!shooter(entity)) return 24;
  const { RANGE } = require('./combat-estimate');
  return Math.max(24, RANGE[entity.name] || 0);
}

// Skeletons, strays, bogged, parched, pillagers and piglins with a
// crossbow: the arrow shooters shot-reflex.js answers for on their own
// (SHOTS.arrow.from), a bow drawn about a second before the loose. Alone,
// with no other threat about, a chosen stance against this one is the
// outcome's to end (killed or gone, the bot hurt past a hold's health, or
// the bot moved off its spot), not one tick's line of sight or one failed
// try at closing the ground (note 715: 25588 stood within five blocks of
// one skeleton for three minutes, full health throughout, and
// encounter_stance flipped every two to three seconds as fight and
// charge_shooter each failed to close in a single tick and take_cover was
// retaken at each of the skeleton's steps round the block it hid behind).
const ARROW_SHOOTERS = new Set(['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'piglin']);
// -> the one entry in `danger`, if it is alone and one of these, else null
function soloRangedThreat(bot, danger = []) {
  if (!Array.isArray(danger) || danger.length !== 1) return null;
  const t = danger[0];
  return t?.entity && ARROW_SHOOTERS.has(t.entity.name) && shooter(t.entity) ? t : null;
}

// What can push the bot where it stands, now: a shooter in sight within
// its own reach (a shot that lands pushes, shield raised or not: note 517),
// anything that bites within eight blocks in sight or four out of it, a
// creeper among them (its blast throws), or a shot on its way. An edge is a
// fall only by a push or a misstep: the Nether's pathfinder and staircases
// refuse a cell beside a deadly drop while something here can push, and
// walk it at its cost while nothing can. mid-235-p-nether-3-fortress-2
// patrolled its fortress for seventy-three minutes and reached none of its
// stretches, every bridge's edge refused with no mob about, while the four
// knock-offs of the same hour were a push each (note 541). Kept half a
// second: the pathfinder asks for every cell it weighs.
// A walker with no way to the bot (walk-reach.js) pushes nothing: a blow or
// a blast has to land, and it has no ground to come to it on. mid-243-bc
// stood at the end of a one-wide ridge in the lava sea, a hoglin 7.7 blocks
// off on a wart block of its own across four cells of lava: it was counted
// a pusher for sixteen minutes, so the crossing's edge was refused, the work
// was preempted four times a second, and turn_priority was asked every ten
// seconds and answered "survival" each time (note 624). immediateThreat
// left it be already (cannotGetToTheBot); the push did not.
const PUSH_REACH = 8;
function pushersAbout(bot) {
  const now = Date.now(), kept = bot?._pushers;
  if (kept && now - kept.at < 500) return kept.list;
  let list = [];
  try {
    const { RANGE } = require('./combat-estimate');
    const about = threats(bot, 64);
    list = about.filter(t => shooter(t.entity) ? t.visible && t.distance <= Math.max(16, RANGE[t.entity.name] || 0)
      : t.distance <= (t.visible ? PUSH_REACH : 4) && !standsOff(bot, t, now) && !cannotGetToTheBot(bot, t, about));
    if (!list.length) {
      const shot = require('./projectile-guard').incoming(bot, { reach: 24 })[0];
      if (shot) list = [{ entity: shot, distance: shot.position.distanceTo(bot.entity.position), visible: true, projectile: true }];
    }
  } catch (_) { list = []; }
  if (bot) bot._pushers = { at: now, list };
  return list;
}

// Whether a biter can land a hit from where it stands now. A mob's blow
// lands on what its own box, widened sideways by its reach and not at all
// up or down, touches (26.1.2 Mob.isWithinMeleeAttackRange). Bare-handed or
// with a sword that is about eight tenths of a block, arm's length, three
// blocks counted centre to centre here as everywhere. A spear reaches 4.5
// in a player's hand and half that in a mob's (AttackRange 2 to 4.5, mob
// factor 0.5): 2.25 past its own box, so its box and the bot's overlap in
// height and lie within about 2.85 of each other along each of x and z,
// two and eight tenths straight ahead and four on the diagonal. And a spear
// holder charges (SpearAttack): it runs in with the spear raised from as
// far as ten blocks until within two, then backs off six or seven and
// comes again, landing its hit on the way in. The hits seen: mid-242-ae's
// spear piglin from 3.2 and 3.4 blocks (20 to 13.3, 13.3 to 7.5) and from
// 2 up a two-block rise; mid-242-ac-nether-3-fortress-2's from 3.0 and 3.1,
// a block below the bot's floor (note 586).
const ARM = 3;
const SPEAR_MOB_REACH = 2.25;
const holdsSpear = entity => /_spear$/.test(entity?.heldItem?.name || '');
function atItsReach(bot, t) {
  const e = t?.entity, me = bot?.entity;
  if (!e?.position || !me?.position || shooter(e) || e.name === 'creeper') return false;
  if (!holdsSpear(e)) return t.distance <= ARM;
  const p = me.position, q = e.position, span = (e.width || 0.6) / 2 + (me.width || 0.6) / 2 + SPEAR_MOB_REACH;
  const overlap = q.y < p.y + (me.height || 1.8) && p.y < q.y + (e.height || 1.95);
  return overlap && Math.abs(p.x - q.x) < span && Math.abs(p.z - q.z) < span;
}
// The biters at their reach of the bot now, in sight or within two (a
// mob round a stair's edge at arm's length is not hidden from its own
// blow), save the one the hunt has claimed and tonight's hunted kind: the
// arbiter asks whose turn it is when one comes to it (note 586).
function atReach(bot, list = null) {
  return (list || threats(bot, 8)).filter(t => (t.visible || t.distance <= 2) && atItsReach(bot, t) && !claimed(bot, t.entity) && !nightHunted(bot, t.entity));
}
// A drop beside the bot a push can put it over to its death: into lava or
// half its health and more (immediateThreat's edge, note 476).
function deadlyDropBeside(bot, radius = 3) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
  const drop = require('./terrain').dropNear(bot, bot.entity.position.floored(), radius);
  return drop && (drop.into === 'lava' || drop.damage >= (bot.health ?? 20) / 2) ? drop : null;
}
// Something that can push the bot (pushersAbout) with such a drop beside
// it: { pushers, drop }, or null. mid-242-ac-nether-3 stood 57 seconds in
// a rest's hold beside a nineteen-block drop at 10.6 health while a
// crossbow piglin came on from 28 blocks; the work held the turn the whole
// while, and the piglin's first arrow put it over (note 586).
// Those Jev chose to leave be (keep_working) are not counted while that
// holds, as immediateThreat leaves them; when it ends, a push is asked
// about again. mid-242-af-nether-3 left a ghast 34 blocks off be at 05:36:53,
// and the work's rest hold that followed kept the turn past the fifteen
// seconds and on until the ghast's fireball put it in the lava at 05:37:30.
function pushOverDrop(bot) {
  // Walled at the feet and the head on every side, a push meets a wall
  // (note 774): 25585 (mid-227-aa, 2026-10-01 01:24:10 and 01:27:33Z) boxed
  // in its own basalt was preempted "something that can push the bot is
  // about, a deadly drop beside it" at every move it began from the box.
  if (walledRound(bot)) return null;
  const now = Date.now(), waved = !(bot?._recentHurtAt > now - 4000) && bot?._wavedOff?.until > now ? bot._wavedOff.ids : [];
  const beyond = bot?._wavedOff?.beyond || 0;
  // Nor a blaze's push at the cage's held box or slit (note 774): only one
  // inside or a hit through it ends the hold (cage-hold.js shelterKeepsOff).
  const sheltered = t => { try { return require('./cage-hold').shelterKeepsOff(bot, t, now); } catch (_) { return false; } };
  const pushers = pushersAbout(bot).filter(t => !(waved.includes(t.entity?.id) && t.distance > beyond) && !sheltered(t));
  if (!pushers.length) return null;
  // As far as the throw of the kinds about (knock-record.js): a ghast's
  // fireball carried the bot 4.1 to 4.5 blocks before it went over, past the
  // three blocks looked at, and the work went on with the ghast in sight
  // until the fireball (25593 mid-243-fc, 04:31Z on 2026-09-29, note 662).
  const drop = deadlyDropBeside(bot, require('./knock-record').reachFor(pushers.map(t => t.entity?.name)));
  return drop ? { pushers, drop } : null;
}

function walledRound(bot) {
  const p = bot?.entity?.position;
  if (!p || typeof bot.blockAt !== 'function') return false;
  const f = p.floored();
  // Near the middle of its cell: a body against one side reaches past it.
  if (Math.abs(p.x - f.x - 0.5) > 0.35 || Math.abs(p.z - f.z - 0.5) > 0.35) return false;
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => [0, 1].every(dy => bot.blockAt(f.offset(dx, dy, dz))?.boundingBox === 'block'));
}
// A fight on (note 696): a threat by immediateThreat's counts, a stance
// Jev chose still holding, a mob that hurt the bot in the last ten seconds
// with one of its kind still about, or a blaze within six blocks seen or
// not (it flies, and one that loses sight of the bot flies toward it: a
// wall between at six is a second of its flight). A question about the plan
// (the legs, the upkeep, the detours) waits while one is on: survival's
// turn comes first. 25592 (mid-242-aa-fortress-17, 22:21:52Z) was asked
// fortress_leg with blazes 1.9, 4.6 and 4.7 blocks off round the bricks and
// took leg_west; seventeen seconds later, at 3 health with a blaze five
// blocks off, upkeep asked for a spare pickaxe and one was made there.
// -> what makes it one, in words, or null
const FIGHT_HURT_MS = 10000, FIGHT_FLIER_NEAR = STANCE_NEWCOMER;
const FIGHT_FLIERS = new Set(['blaze', 'ghast', 'phantom', 'vex', 'breeze']);
function fightOn(bot, now = Date.now()) {
  if (!bot?.entity?.position || !bot.entities || bot.game?.gameMode === 'creative') return null;
  const name = s => String(s).replaceAll('_', ' ');
  const at = t => `${Math.round(t.distance * 10) / 10} blocks off${t.visible === false ? ' (out of sight)' : ''}`;
  try {
    const t = immediateThreat(bot);
    if (t) return t.projectile ? 'a shot on its way at the bot' : `the ${name(t.entity.name)} ${at(t)}`;
  } catch (_) { /* no world */ }
  const s = stanceHeld(bot, now);
  if (s && s.choice && s.choice !== 'keep_working') return `the ${name(s.choice)} stance chosen ${Math.round((now - s.at) / 1000)} seconds ago holds`;
  let about = [];
  try { about = threats(bot, 24); } catch (_) { about = []; }
  const hurt = Object.entries(bot._hurtBy || {}).filter(([kind, t]) => now - t < FIGHT_HURT_MS && about.some(m => m.entity.name === kind)).sort((a, b) => b[1] - a[1])[0];
  if (hurt) return `a ${name(hurt[0])} hit the bot ${Math.max(1, Math.round((now - hurt[1]) / 1000))} seconds ago and one is ${at(about.find(m => m.entity.name === hurt[0]))}`;
  const flier = about.find(t => FIGHT_FLIERS.has(t.entity.name) && t.distance <= FIGHT_FLIER_NEAR);
  if (flier) return `a ${name(flier.entity.name)} ${at(flier)}`;
  return null;
}
// Waits while a fight is on, up to `ms`, looking four times a second; the
// task's check throws meanwhile (a threat for survival, a preemption). ->
// { first, waitedMs, still }: what made it one at first, how long it waited,
// and what makes it one still at the end (null once it is over).
const FIGHT_WAIT_MS = 15000;
async function waitOutFight(bot, task, { ms = Number(process.env.JEV_FIGHT_WAIT_MS) || FIGHT_WAIT_MS, every = 250, now = () => Date.now() } = {}) {
  const first = fightOn(bot, now());
  if (!first || process.env.JEV_FIGHT_WAIT === '0') return { first: null, waitedMs: 0, still: first || null };
  const start = now();
  let still = first;
  while (still && now() - start < ms) {
    task?.check?.();
    await new Promise(r => setTimeout(r, every));
    still = fightOn(bot, now());
  }
  return { first, waitedMs: now() - start, still };
}

module.exports = { walledRound, markCreeper, creeperMarked, CREEPER_MARK_MS, noteNoRun, noRunTo, standsOff, reachSays, fightOn, waitOutFight, FIGHT_WAIT_MS, FIGHT_HURT_MS, FIGHT_FLIER_NEAR, blocksRay, closingOn, atItsReach, atReach, holdsSpear, deadlyDropBeside, pushOverDrop, SPEAR_MOB_REACH, noWayIds, cannotGetToTheBot, unseenClose, UNSEEN_CLOSE, pushersAbout, PUSH_REACH, lineClear, UNPROVOKED, stanceHeld, standHeld, huntAnswerJustNow, stanceMobs, stanceReach, soloRangedThreat, STANCE_HOLD_MS, STANCE_HEALTH, STANCE_NEWCOMER, holdLoss, pacedLoss, unseenNote, nightHunted, hostileEntities, threats, immediateThreat, checkThreats, safeFromHostiles, NeedsSafety, combatTarget, provoked, provokedEnderman, hunted, claimed, followers, coming, COMING };
