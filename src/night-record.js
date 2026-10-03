'use strict';
// The night by place, from the record, and what a seal is held until
// (note 789).
//
// Measured with `node scripts/night-time.js --to 2026-10-01T04:57:47Z`: every
// Overworld bot-second of the 261 fresh trials since 2026-09-30T12:00Z, the
// Jev-down frames left out (note 781), by the place (the surface at y 56 or
// more, underground from y 0 to 56, deep under y 0), the hour (night from
// 11500 to dawn at 23000) and what the bot did. "Keeping on" is the work and
// the fights it ran into (the stances against mobs), not the time sealed, in
// a night mine or asleep. A death is health falling to 0.
//
// Under the rock the night adds nothing: 22.8 health an hour at night, 22.6
// by day. On the surface it is four and a half times the day's. Deep is the
// costliest place at any hour. And most seals were quiet: 414 of the 623 on
// the surface at night had nothing hostile come within 16 blocks or in sight
// while sealed, 156 of 287 under the rock.
const SURFACE_Y = 56;
const DEEP_Y = 0;
// A threat sealed against is gone when nothing hostile has been within 16
// blocks or in sight for this long.
const CLEAR_MS = 30000;
const CLEAR_WITHIN = 16;

const SINCE = '2026-09-30 12:00Z';
const RECORD = Object.freeze({
  surface: {
    night: { hours: 25.6, damagePerHour: 35.9, deaths: 6, deathsPerHour: 0.23 },
    day: { hours: 48.7, damagePerHour: 8, deaths: 6, deathsPerHour: 0.12 },
    sealed: { spells: 623, quiet: 414, minutes: 207, damagePerHour: 31.5, deaths: 1 },
    nightMine: { hours: 3, damagePerHour: 5.7, deaths: 0 },
  },
  underground: {
    night: { hours: 30.2, damagePerHour: 22.8, deaths: 7, deathsPerHour: 0.23 },
    day: { hours: 36.3, damagePerHour: 22.6, deaths: 6, deathsPerHour: 0.17 },
    sealed: { spells: 287, quiet: 156, minutes: 124.4, damagePerHour: 12.2, deaths: 0 },
    nightMine: { hours: 4.3, damagePerHour: 7.4, deaths: 0 },
  },
  deep: {
    night: { hours: 10, damagePerHour: 44.8, deaths: 13, deathsPerHour: 1.31 },
    day: { hours: 11.8, damagePerHour: 55.2, deaths: 11, deathsPerHour: 0.93 },
    sealed: { spells: 92, quiet: 26, minutes: 27, damagePerHour: 15.3, deaths: 0 },
  },
});
// The sleeps tried (a 'sleep' or 'sleep_failed' report), by the nearest
// monster then (seen or not), with the refusals and the hurt in the minute
// after (the same records, 249 tries).
const BEDS = Object.freeze({
  'within 8': { tries: 18, refused: 12, hurt: 4, health: 21.1 },
  '8 to 16': { tries: 38, refused: 9, hurt: 9, health: 35.5 },
  '8 to 16 with a creeper': { tries: 11, refused: 1, hurt: 5, health: 19.8 },
  'none within 16': { tries: 182, refused: 17, hurt: 16, health: 73 },
});

const WHERE = { surface: 'on the surface', underground: 'under the rock (y 0 to 56)', deep: 'deep, under y 0' };
const round = n => Math.round(n * 10) / 10;

const bandOf = y => !Number.isFinite(y) ? null : y >= SURFACE_Y ? 'surface' : y >= DEEP_Y ? 'underground' : 'deep';
// The place as the bot stands: open sky over it is the surface whatever the
// height; under the rock, deep below y 0.
const placeOf = ({ y, underground }) => !underground ? 'surface' : Number.isFinite(y) && y < DEEP_Y ? 'deep' : 'underground';

const odds = p => p <= 0 ? null : p >= 0.5 ? 'about even' : `about 1 in ${Math.round(1 / p)}`;

// What keeping on with the work here at night has cost, against the day,
// and over the minutes to dawn at the night's rate.
// Back with empty hands: the deaths that followed a death (note 1114). On
// 2026-10-03 (08:00 to 21:00Z, every trial's deaths from its server log),
// 20 of the 110 were followed by another of the same trial within ten
// minutes and 30 within twenty: the bot back at its bed with nothing in
// hand and nothing worn, out again among the night's mobs. The night's
// record above is every bot's, most of them armed and in iron. 25589
// (19:31:06Z), a minute and a half after it came back bare, was told of
// leaving its pocket "about 1 in 37 of a death" to dawn, left at 0.48, and
// was dead seven minutes on.
const BARE = Object.freeze({ day: '2026-10-03', from: '08:00', to: '21:00Z', deaths: 110, again10: 20, again20: 30 });
// Bare: no sword or axe carried and no armour worn.
function bareOf(bot) {
  try {
    const items = bot?.inventory?.items?.() || [];
    const worn = [5, 6, 7, 8].some(slot => bot.inventory?.slots?.[slot]);
    return !worn && !items.some(i => /_(sword|axe)$/.test(i.name));
  } catch (_) { return false; }
}
function bareSays(bot) {
  if (!bareOf(bot)) return '';
  return ` With empty hands and nothing worn the record is another: on ${BARE.day} (${BARE.from} to ${BARE.to}), of ${BARE.deaths} deaths ${BARE.again10} were followed by another of the same trial within ten minutes and ${BARE.again20} within twenty, the bot back bare, about 1 in ${Math.round(BARE.deaths / BARE.again10)} and 1 in ${Math.round(BARE.deaths / BARE.again20)}.`;
}
function keepOnSays(place, { minutesToDawn = null } = {}) {
  const r = RECORD[place];
  if (!r) return '';
  const n = r.night, d = r.day;
  const lead = ` The record (${SINCE} on, fresh trials): keeping on with the work ${WHERE[place]} at night, the fights it ran into counted, cost about ${n.damagePerHour} health and ${n.deathsPerHour} deaths an hour (${n.hours} bot-hours), against ${d.damagePerHour} and ${d.deathsPerHour} by day (${d.hours})`;
  const same = Math.abs(n.damagePerHour - d.damagePerHour) <= 0.1 * d.damagePerHour;
  const verdict = place === 'deep' ? ': the costliest place at any hour, and the night no worse there' : same ? ': the night adds about nothing here' : '';
  const toDawn = Number.isFinite(minutesToDawn) && minutesToDawn > 0
    ? `; to dawn, about ${minutesToDawn} real minutes, that is about ${round(n.damagePerHour * minutesToDawn / 60)} health${odds(n.deathsPerHour * minutesToDawn / 60) ? ` and ${odds(n.deathsPerHour * minutesToDawn / 60)} of a death` : ''} at the night's rate${same ? '' : `, ${round((n.damagePerHour - d.damagePerHour) * minutesToDawn / 60)} health more than by day`}`
    : '';
  return `${lead}${verdict}${toDawn}.`;
}

// What sealing here at night has come to: the seals, how many were quiet
// (nothing hostile within 16 blocks or in sight while sealed), the health
// taken in them, and the minutes to dawn the work waits.
function sealedSays(place, { minutesToDawn = null, waiting = null } = {}) {
  const s = RECORD[place]?.sealed;
  if (!s) return '';
  const wait = Number.isFinite(minutesToDawn) && minutesToDawn > 0 ? ` Sealed to dawn is about ${minutesToDawn} real minutes${waiting ? ` with ${waiting} waiting` : ''}.` : '';
  return ` The record of seals ${WHERE[place]} at night: ${s.spells}, ${s.quiet} of them with nothing hostile within 16 blocks or in sight while sealed; about ${s.damagePerHour} health an hour taken in them.${wait}`;
}

function nightMineSays(place) {
  const m = RECORD[place]?.nightMine;
  return m ? ` The record of night mines ${WHERE[place]}: about ${m.damagePerHour} health an hour (${m.hours} bot-hours, ${m.deaths ? `${m.deaths} deaths` : 'no deaths'}).` : '';
}

// The same as facts, for a question's state.
function facts(place) {
  const r = RECORD[place];
  if (!r) return null;
  return { place, since: SINCE, keepOnAtNight: r.night, keepOnByDay: r.day, ...(r.sealed ? { sealedAtNight: r.sealed } : {}), ...(r.nightMine ? { nightMine: r.nightMine } : {}) };
}

// What ends a sealed hold, from the reason it was sealed for (seal-reason.js):
// the surface's night ends at dawn, a threat when nothing hostile has been
// within 16 blocks or in sight for CLEAR_MS, healing when health is back at
// 20. Health that does not come back (hurt) ends with nothing a pocket
// brings, so it holds nothing by itself. The hold lasts while any holds.
function holdEnds({ reason } = {}) {
  const kinds = reason?.kinds || [];
  const r = { dawn: kinds.includes('surface_night'), threat: kinds.includes('threat'), heal: kinds.includes('heal') };
  return { held: r.dawn || r.threat || r.heal, ...r };
}

// The hold said on each way that seals: what it waits for, and what asks
// again sooner.
function holdSays(reason, { minutesToDawn = null } = {}) {
  const h = holdEnds({ reason });
  if (!h.held) return '';
  const until = [];
  if (h.dawn) until.push(`dawn${Number.isFinite(minutesToDawn) ? `, about ${minutesToDawn} real minutes off` : ''}`);
  if (h.threat) until.push(`nothing hostile within ${CLEAR_WITHIN} blocks or in sight for ${CLEAR_MS / 1000} seconds`);
  if (h.heal) until.push('health back at 20');
  return ` A stay in the pocket is held until ${until.length > 1 ? `${until.slice(0, -1).join(', ')} and ${until.at(-1)}` : until[0]}, not asked again meanwhile unless the bot is hurt, a mob comes within 5 blocks, hunger wants food with none carried or the bed can be slept in; when ${until.length > 1 ? 'the last of these comes' : 'it comes'}, the pocket's question is asked at once.`;
}

// The hold kept from the seal: its reasons and their ends.
function holdOf(reason, { now = Date.now(), health = 20 } = {}) {
  const h = holdEnds({ reason });
  if (!h.held) return null;
  return { at: now, kinds: reason.kinds.slice(), dawn: h.dawn, threat: h.threat, heal: h.heal, health, clearSince: null, origin: null };
}

// Whether the hold holds now. `threatNear`: a hostile within 16 blocks or in
// sight; `night`: the surface's night (day.js night). Mutates the hold's
// clear clock. -> { holds, ended: [reasons ended], waiting: [reasons held] }
function holdNow(hold, { night = false, threatNear = false, health = 20, now = Date.now() } = {}) {
  if (!hold) return { holds: false, ended: [], waiting: [] };
  if (hold.threat) { if (threatNear) hold.clearSince = null; else if (hold.clearSince == null) hold.clearSince = now; }
  const waiting = [], ended = [];
  if (hold.dawn) (night ? waiting : ended).push('dawn');
  if (hold.threat) (hold.clearSince == null || now - hold.clearSince < CLEAR_MS ? waiting : ended).push('the threat gone');
  if (hold.heal) (health < 20 ? waiting : ended).push('health back');
  return { holds: waiting.length > 0, ended, waiting };
}

// The bed: the monsters within 8 blocks of it now (the game refuses the sleep
// while any is, seen or not), those within 16 and how soon each could close
// to 8 at a walk, a creeper's race to the bed, and the record of the sleeps
// tried with the nearest monster as near.
// `monsters`: [{ name, distance (to the bed), visible, coming }].
const WALK = 3;          // blocks a second a walker closes (combat-estimate APPROACH)
const LIGHTS_AT = 3, FUSE = 1.5;
function bedSafety(monsters = []) {
  const list = monsters.filter(m => Number.isFinite(m.distance) && m.distance <= 24).slice().sort((a, b) => a.distance - b.distance);
  const within8 = list.filter(m => m.distance <= 8);
  const within16 = list.filter(m => m.distance > 8 && m.distance <= 16);
  const creeper = list.find(m => m.name === 'creeper' && m.distance <= 16);
  const band = within8.length ? 'within 8' : within16.length ? (creeper ? '8 to 16 with a creeper' : '8 to 16') : 'none within 16';
  const named = m => `a ${String(m.name).replaceAll('_', ' ')} ${Math.round(m.distance)} blocks off${m.visible ? '' : ' (out of sight)'}${m.coming ? ', coming at the bot' : ''}`;
  const parts = [];
  parts.push(within8.length ? `Monsters within 8 blocks of the bed now: ${within8.length} (${within8.slice(0, 3).map(named).join(', ')}); the game refuses the sleep while any is.` : 'Monsters within 8 blocks of the bed now: none.');
  if (within16.length) parts.push(`Within 16: ${within16.slice(0, 3).map(m => `${named(m)}, at the 8-block line in about ${Math.max(1, Math.round((m.distance - 8) / WALK))} seconds at a walk`).join('; ')}${within16.length > 3 ? ` and ${within16.length - 3} more` : ''}.`);
  if (creeper) parts.push(`The creeper ${Math.round(creeper.distance)} blocks off could reach the bed and go off in about ${round(Math.max(0, (creeper.distance - LIGHTS_AT) / WALK) + FUSE)} seconds if it comes on.`);
  const b = BEDS[band];
  if (b) parts.push(`The record of sleeps tried with the nearest monster ${band === 'none within 16' ? 'more than 16 blocks off' : band.replace('8 to 16', '8 to 16 blocks off').replace('within 8', 'within 8 blocks')}: ${b.tries}, ${b.refused} refused, ${b.hurt} hurt within the minute after (${b.health} health in all).`);
  return { band, within8: within8.length, within16: within16.length, creeper: creeper ? round(creeper.distance) : null, says: ` ${parts.join(' ')}`,
    facts: { monstersWithin8OfBed: within8.length, monstersWithin16OfBed: within8.length + within16.length, ...(creeper ? { creeperWithin16OfBed: round(creeper.distance) } : {}), sleepRecord: { band, ...b } } };
}

module.exports = { BARE, bareOf, bareSays, SURFACE_Y, DEEP_Y, CLEAR_MS, CLEAR_WITHIN, RECORD, BEDS, SINCE, bandOf, placeOf, keepOnSays, sealedSays, nightMineSays, facts, holdEnds, holdSays, holdOf, holdNow, bedSafety };
