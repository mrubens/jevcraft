'use strict';
const { DAY } = require('./day');
const { handlers, kitReady, observedDead, shooter, fitToFight } = require('./mob-policy');

// The Nether's own mobs were missing: a magma cube killed the dream run in
// two seconds while the bot searched for blazes, and nothing fled or swung.
const hostileNames = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'creeper', 'spider',
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
const GROUP_ANGER = { zombified_piglin: 30000, piglin: 30000 };
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
    return !here || !entity.position || entity.position.distanceTo(here) <= 4;
  }
  return Object.hasOwn(GROUP_ANGER, entity.name) && bot._hurtBy?.[entity.name] > Date.now() - GROUP_ANGER[entity.name];
}
const provokedEnderman = (bot, entity) => entity.name === 'enderman' && provoked(bot, entity);

const wearingGold = bot => [5, 6, 7, 8].some(slot => /^golden_/.test(bot.inventory?.slots?.[slot]?.name || ''));

function hostileEntities(bot, radius = 24) {
  const position = bot.entity.position;
  const daytime = bot.time?.timeOfDay < DAY.DARK || bot.time?.timeOfDay >= DAY.DAWN;
  return Object.values(bot.entities || {}).filter(entity => {
    if ((!hostileNames.has(entity.name) && !provoked(bot, entity)) || !entity.position || entity.isValid === false || observedDead(bot, entity)) return false;
    // A spider turns by day when a spider hits the bot, not when anything
    // does: a fall or a fire set every spider in view back on it.
    if (entity.name === 'spider' && daytime && !(bot._hurtBy?.spider > Date.now() - 10000)) return false;
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
function threats(bot, radius = 24) {
  const position = bot.entity.position;
  const list = hostileEntities(bot, radius).map(entity => {
    const distance = entity.position.distanceTo(position);
    // Seen if any of head, middle or feet is: one ray to one point near the
    // head called a blaze behind a fortress fence or a floor's edge unseen,
    // and the bot walled itself in against "something shooting" that was in
    // plain sight (the user, 2026-09-24).
    const eye = position.offset(0, 1.62, 0), height = entity.height || 1.6;
    const clear = target => {
      const direction = target.minus(eye);
      const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
      return !hit || eye.distanceTo(hit.intersect || hit.position) >= eye.distanceTo(target) - 0.5;
    };
    const visible = [Math.min(height, 1.6), height / 2, 0.15].some(dy => clear(entity.position.offset(0, dy, 0)));
    return { entity, distance, visible };
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
  return list;
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

function immediateThreat(bot) {
  const fighting = inEncounter(bot), hurt = bot._recentHurtAt > Date.now() - 4000;
  // Another of the kind being fought never ends the fight: the hunt's own
  // crowd rule decides how many blazes are too many.
  const kin = t => fighting && t.entity.name === bot._combatEncounter.target?.name;
  // Mobs Jev chose to leave be (the keep_working stance): not a threat for
  // the time it gave them, unless one comes within three blocks or a hit
  // lands.
  const waved = !hurt && bot._wavedOff?.until > Date.now() ? bot._wavedOff.ids : null;
  const leftBe = t => !!waved && waved.includes(t.entity.id) && t.distance > 3;
  return threats(bot, 32).find(t => !combatTarget(bot, t.entity) && t.visible && !kin(t) && !hunted(bot, t.entity) && !leftBe(t) &&
    t.distance <= (shooter(t.entity) ? (fighting ? 8 : hurt ? 32 : 16) : (fighting ? 5 : 8)));
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

module.exports = { hostileEntities, threats, immediateThreat, checkThreats, safeFromHostiles, NeedsSafety, combatTarget, provoked, provokedEnderman, hunted, claimed };
