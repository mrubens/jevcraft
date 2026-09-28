'use strict';
const { Vec3 } = require('vec3');
const { DAY } = require('./day');
const { handlers, kitReady, observedDead, shooter, fitToFight } = require('./mob-policy');

// The Nether's own mobs were missing: a magma cube killed the dream run in
// two seconds while the bot searched for blazes, and nothing fled or swung.
// Every mob the game calls hostile, the neutral ones (endermen, zombified
// piglins) left to provoked(): trial 104 was killed by a zombie villager
// that was not on this list, hit five times with no threat in sight.
const hostileNames = new Set(['zombie', 'zombie_villager', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'parched', 'creeper', 'spider', 'vex', 'illusioner', 'guardian', 'elder_guardian', 'creaking',
  'cave_spider', 'witch', 'pillager', 'vindicator', 'evoker', 'ravager', 'phantom', 'blaze', 'wither_skeleton', 'hoglin', 'zoglin',
  'magma_cube', 'slime', 'ghast', 'piglin', 'piglin_brute', 'silverfish', 'endermite', 'warden', 'breeze']);

function combatTarget(bot, entity) {
  const encounter = bot._combatEncounter;
  return !!encounter && encounter.target === entity && Object.hasOwn(handlers, entity.name) &&
    bot.entities[entity.id] === entity && entity.isValid !== false && !encounter.task.cancelled &&
    encounter.dimension === bot.game?.dimension && encounter.expiresAt > Date.now() &&
    bot.health >= 12 && bot.food >= 12 && kitReady(bot);
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
  return Object.hasOwn(GROUP_ANGER, entity.name) && bot._hurtBy?.[entity.name] > Date.now() - GROUP_ANGER[entity.name];
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
    if (!open.has(key) && bot.blockAt?.(new Vec3(c[0], c[1], c[2]))?.boundingBox === 'block') return false;
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

function immediateThreat(bot) {
  const fighting = inEncounter(bot), hurt = bot._recentHurtAt > Date.now() - 4000;
  // Another of the kind being fought never ends the fight: the hunt's own
  // crowd rule decides how many blazes are too many.
  const kin = t => fighting && t.entity.name === bot._combatEncounter.target?.name;
  // Mobs Jev chose to leave be (the keep_working stance): not a threat for
  // the time it gave them, unless one comes within three blocks or a hit
  // lands.
  const waved = !hurt && bot._wavedOff?.until > Date.now() ? bot._wavedOff.ids : null;
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
  const leftBe = t => (!!waved && waved.includes(t.entity.id) && t.distance > (t.entity.name === 'creeper' ? creeperFar : 3)) ||
    // Not a shooter: out of a charge's reach is not out of its bow's. mid-230-p's
    // skeleton, marked unreachable after a charge, shot it every three to
    // six seconds from eight blocks, each gap longer than the four seconds
    // "hurt" lasts, and nothing answered it, 9.7 to none (note 457).
    (unreachable.includes(t.entity.id) && !shooter(t.entity) && t.distance > (t.entity.name === 'creeper' ? 5 : 2));
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
  const seen = t => t.visible || (t.entity.name === 'creeper' && t.distance <= 4) || (t.entity.name === 'warden' && t.distance <= 24) ||
    (t.distance <= 3.5 && !shooter(t.entity) && edge());
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
  const mob = about.find(t => !combatTarget(bot, t.entity) && seen(t) && !kin(t) && (!hunted(bot, t.entity) || (shooter(t.entity) && hitBy(t))) && !leftBe(t) && !nightHunted(bot, t.entity) &&
    t.distance <= (shooter(t.entity) ? shooterReach(t) : t.entity.name === 'warden' ? 24 : (fighting ? 5 : 8)));
  if (mob) return mob;
  // The mobs a stance Jev chose was chosen against, while it holds: the
  // survival layer's, seen or not. mid-242-a's pillar went two up with
  // zombies seven to eight blocks off, now out of sight under its top and
  // past the eight counted for a biter, the skeletons past sixteen: nothing
  // was a threat any more, the claim became shelter, survival_priority was
  // asked in the pillar's place, and the shelter's route searches stood the
  // bot on the pillar's edge five seconds under a skeleton's arrows (note 535).
  const kept = stanceMobs(bot)[0];
  if (kept) return kept;
  // And once it is over, those of them still coming at the bot (followers):
  // mid-244-a's run ended with four zombies ten blocks behind and walking
  // up, past the eight counted for a biter, and the night's pocket was
  // asked and dug in the stance's place until they bit (note 544).
  const follower = followers(bot, { list: about })[0];
  if (follower) return follower;
  // A shot on its way is a threat of its own, its shooter seen or not:
  // mid-230-g, waiting to heal by a fortress, was hit by four fireballs in
  // six seconds from a ghast out of view, the fourth throwing it into the
  // lava (2026-09-27). Not while fighting: the fight answers shots.
  if (fighting) return undefined;
  const shot = require('./projectile-guard').incoming(bot, { reach: 16 })[0];
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

function safeFromHostiles(bot, point, entities = hostileEntities(bot, 64)) {
  if (bot.game?.gameMode === 'creative' || bot.game?.difficulty === 'peaceful') return true;
  return entities.every(entity => {
    // The mob the hunt has claimed is not avoided by the pathfinder either.
    // Every step toward a blaze makes a cell closer to it, and "closer to a
    // shooter" was the definition of unsafe: the approach shaft dug through
    // to within three blocks of the spawner room and the walk into each
    // freshly dug cell was refused, an hour and a half in one spot. The
    // claim still lapses under fourteen health, and the survival layer
    // takes over as before.
    if (combatTarget(bot, entity) || hunted(bot, entity)) return true;
    // Out of sight, a mob only matters when it is nearly at the wall.
    const radius = !seen(bot, entity) ? 6 : shooter(entity) ? 20 : 12;
    return entity.position.distanceTo(point) >= Math.min(radius, entity.position.distanceTo(bot.entity.position) - 0.25);
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
// fifteen seconds from the choice, and until six health is gone since.
// The reflexes that would stop it give way to it meanwhile: the hurt
// watchdog, the shield raised at each arrow, the meal. Asked again sooner
// when it fails or a mob it was not chosen against comes within six blocks.
// Only while it is being carried out (run within the last two seconds): the
// work that comes back once the mobs are gone has its watchdog back.
const STANCE_HOLD_MS = 15000, STANCE_HEALTH = 6, STANCE_NEWCOMER = 6;
function stanceHeld(bot, now = Date.now()) {
  const s = bot?._stance;
  return s && now - s.at < STANCE_HOLD_MS && (s.running || now - (s.ranAt ?? s.at) < 2000) && (bot.health ?? 0) > s.health - STANCE_HEALTH ? s : null;
}
// The mobs the stance holds against: those it was chosen against (its ids)
// still within the twenty-four a stance counts, nearest first, for as long
// as it was said to hold (fifteen seconds, its estimate's seconds where it
// had one, six health), once it has run. A stance ends when it fails
// (survival.js stanceStep drops it), when its time or health is spent, and
// is asked again when a mob it was not chosen against comes near; not
// because one of its mobs stepped out of sight or out of a count. Leaving
// the mobs be (keep_working) holds nothing against them.
function stanceMobs(bot, now = Date.now()) {
  const s = bot?._stance;
  if (!s || s.choice === 'keep_working' || !s.ids?.length || !(s.running || s.ranAt)) return [];
  if (now - s.at >= Math.min(STANCE_HOLD_MS, s.expects?.seconds ? s.expects.seconds * 1000 : Infinity)) return [];
  if ((bot.health ?? 0) <= s.health - STANCE_HEALTH) return [];
  return threats(bot).filter(t => s.ids.includes(t.entity.id) && !combatTarget(bot, t.entity)).map(t => ({ ...t, stance: s.choice }));
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
const PUSH_REACH = 8;
function pushersAbout(bot) {
  const now = Date.now(), kept = bot?._pushers;
  if (kept && now - kept.at < 500) return kept.list;
  let list = [];
  try {
    const { RANGE } = require('./combat-estimate');
    list = threats(bot, 64).filter(t => shooter(t.entity) ? t.visible && t.distance <= Math.max(16, RANGE[t.entity.name] || 0)
      : t.distance <= (t.visible ? PUSH_REACH : 4));
    if (!list.length) {
      const shot = require('./projectile-guard').incoming(bot, { reach: 24 })[0];
      if (shot) list = [{ entity: shot, distance: shot.position.distanceTo(bot.entity.position), visible: true, projectile: true }];
    }
  } catch (_) { list = []; }
  if (bot) bot._pushers = { at: now, list };
  return list;
}

module.exports = { pushersAbout, PUSH_REACH, lineClear, UNPROVOKED, stanceHeld, stanceMobs, STANCE_HOLD_MS, STANCE_HEALTH, STANCE_NEWCOMER, unseenNote, nightHunted, hostileEntities, threats, immediateThreat, checkThreats, safeFromHostiles, NeedsSafety, combatTarget, provoked, provokedEnderman, hunted, claimed, followers, coming, COMING };
