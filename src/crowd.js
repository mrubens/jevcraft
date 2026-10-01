'use strict';
// Mob crowds at arm's length (note 778). Since 2026-09-30T20:00Z, of the
// Overworld deaths and falls under 6 health with two or more mobs within
// four blocks, the stance held was shield_guard 7 times in 15 and the swing
// reflex 4; the first question after the second mob closed came a median
// 4.3 seconds later at 11.4 health, and 3 came with none at all
// (`node scripts/overworld-deaths.js --crowds`). 25593 (mid-237-ap,
// 20:54:33 to 20:55:04Z) chose shield_guard against one zombie 4 blocks off
// beside a zombie spawner; four more closed within two blocks by 20:54:43,
// the guard and its hold ran on 25 seconds (a newcomer of a kind already
// held against is not news, note 743), and the next question came at 11.3
// health with no way out. 25588 (mid-231-ab, 01:29:28Z) chose shield_guard
// unarmoured among seven zombies at 7.5 health, told "144 runs, 6 of them
// took a blow, none ended in death": the guard's record against one.
//
// Here: who is within four blocks (the crowd), the blows a second from each
// biter at arm's length summed through the armour worn, a shield covering
// only the ones within its cover of the way it faces, and the seconds that
// leaves at the health now (note 752h's clock); a crowd grown past what a
// stance was chosen against, said as the reason it is asked again; and what
// each way has done with this many within four, where enough answers stand
// behind the figure.
const CROWD_WITHIN = 4;

// The mobs within CROWD_WITHIN that can get to the bot (those apart, with
// no way to it, left out), nearest first.
function crowdOf(danger, { apartIds = null } = {}) {
  return (danger || []).filter(t => t?.entity && t.distance <= CROWD_WITHIN && !apartIds?.has?.(t.entity.id)).sort((a, b) => a.distance - b.distance);
}

const name = t => t.entity.name.replaceAll('_', ' ');
const r1 = v => Math.round(v * 10) / 10;
const listSays = (crowd, max = 4) => crowd.slice(0, max).map(t => `the ${name(t)} ${r1(t.distance)} blocks off`).join(', ') + (crowd.length > max ? `, and ${crowd.length - max} more` : '');

// Degrees between the way from `here` to `a` and the way from `here` to `b`,
// on the level.
function degreesOff(here, a, b) {
  const bearing = p => Math.atan2(p.z - here.z, p.x - here.x) * 180 / Math.PI;
  return Math.abs(((bearing(b) - bearing(a)) % 360 + 540) % 360 - 180);
}

// The clock standing among `biters` (threat records at arm's length): each
// one's blows a second through the armour worn, summed; with a shield
// raised toward `facing` (a threat record), those within the shield's cover
// of that way (blaze-stand SHIELD_COVER, the arena's measure) are blocked
// and left out of the sum. -> { rate, covered, open, seconds }
function clock({ biters, worn, health, facing = null, here = null }) {
  const ce = require('./combat-estimate');
  const { SHIELD_COVER } = require('./blaze-stand');
  const perSecond = t => { const m = ce.MOBS[t.entity.name]; return m ? (m.ignoresArmour ? m.hit : ce.afterArmour(m.hit, worn)) / (m.blowEvery || 1) : 0; };
  const covered = facing ? biters.filter(t => t === facing || t.entity === facing.entity || (here && facing.entity.position && t.entity.position && degreesOff(here, facing.entity.position, t.entity.position) <= SHIELD_COVER)) : [];
  const open = biters.filter(t => !covered.includes(t));
  const rate = open.reduce((n, t) => n + perSecond(t), 0);
  return { rate, covered, open, seconds: rate > 0 ? health / rate : Infinity, perSecond };
}

// A crowd grown since a stance was chosen: two or more within four now,
// more than when it was chosen. A newcomer of a kind already held against
// was not news (note 743: a cage turning over at the same count); a count
// risen at arm's length is, whatever the kind.
function grew(held, crowdNow) {
  return !!held?.crowd && crowdNow.length >= 2 && crowdNow.length > held.crowd.n;
}

function grewSays(held, crowdNow, now = Date.now()) {
  const ago = Math.max(1, Math.round((now - held.at) / 1000));
  return `a crowd change: ${crowdNow.length} mobs within ${CROWD_WITHIN} blocks now (${listSays(crowdNow)}), ${held.crowd.n} when the ${held.choice.replaceAll('_', ' ')} was chosen ${ago} second${ago === 1 ? '' : 's'} ago`;
}

// What each way has done with two or more mobs within four blocks: every
// encounter_stance answered in the Overworld with a biter within eight, from
// the flight records of 2026-09-30T12:00Z to 2026-10-01T03:00Z (1,663
// answers), by the way answered and the count within four in the question's
// own state: the answers, the median health then, the health lost in the
// ten seconds after (median), how many lost 6 or more, how many died in
// them (`node scripts/overworld-deaths.js --stance-crowds`). Only cells of
// six answers or more; the others are too few to say. Answers in the same
// minute of the same fight are not independent: the deaths are the fights'.
const RECORD = Object.freeze({
  shield_guard: { 2: { answers: 30, health: 18.6, lost: 1, lost6: 3, died: 1 }, '3+': { answers: 10, health: 16.5, lost: 4, lost6: 2, died: 3 } },
  fight: { 2: { answers: 12, health: 20, lost: 0, lost6: 0, died: 0 } },
  retreat: { '3+': { answers: 6, health: 11.3, lost: 7.2, lost6: 3, died: 4 } },
});
const MIN_ANSWERS = 6;
const bandOf = n => n >= 3 ? '3+' : n === 2 ? '2' : null;

function recordOf(stance, n) {
  const b = bandOf(n), r = b && RECORD[stance]?.[b];
  return r && r.answers >= MIN_ANSWERS ? { band: b, ...r } : null;
}

function recordSays(stance, n) {
  const r = recordOf(stance, n);
  if (!r) return '';
  return ` This way's record with ${r.band === '3+' ? 'three or more' : 'two'} mobs within ${CROWD_WITHIN} blocks (the trials since 2026-09-30T12:00Z): answered ${r.answers} times from a median ${r.health} health; in the ten seconds after, a median ${r.lost} health lost, 6 or more ${r.lost6} times, ${r.died ? `${r.died} died` : 'none died'}.`;
}

// Said on each option with a record for this count; only with two or more
// within four (with one or none the cells are the bulk of every way's
// answers and say nothing of a crowd).
function sayOn(options, n) {
  if (!(n >= 2)) return options;
  for (const [k, o] of Object.entries(options || {})) if (typeof o?.description === 'string') o.description += recordSays(k, n);
  return options;
}

// The crowd as a fact of the question: who is within four, and, of those
// that bite at arm's length, the blows a second summed and the seconds of
// it at this health (the shield left out: it covers one way).
function stateSays(crowd, { biters, rate, health }) {
  if (crowd.length < 2) return null;
  return `${crowd.length} mobs within ${CROWD_WITHIN} blocks: ${listSays(crowd, 6)}.${biters.length ? ` ${biters.length === 1 ? 'One bites' : `${biters.length} bite`} at arm's length now: about ${r1(rate)} health a second through the armour worn with no shield raised, at ${r1(health)} health about ${Math.max(1, Math.round(health / Math.max(rate, 0.01)))} seconds of it; a shield raised covers only the ones within its cover of the way it faces.` : ''}`;
}

module.exports = { CROWD_WITHIN, crowdOf, clock, degreesOff, grew, grewSays, RECORD, MIN_ANSWERS, recordOf, recordSays, sayOn, stateSays, listSays };
