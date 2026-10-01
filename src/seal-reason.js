'use strict';
// Why a pocket would be sealed now, said in the first words of every option
// that seals, and said plainly when there is none (note 755).
//
// 25594 (12:18:55Z) chose secure_shelter, then seal_here, at health 20 and
// hunger 18, underground, the six skeletons about all out of sight and the
// nearest 20 blocks off; the option opened "Prepare and enter a sealed
// shelter before hostile mobs spawn at night", which is no reason under the
// rock. Eight seconds later pocket_next chose night_mine and the pocket was
// dug open again. 25585 (11:48Z) sealed the same way at 20 and 18. The facts
// were in the state; the option's words gave a reason that did not hold.
//
// The reasons are the game's: a hostile in sight or close enough to reach
// the bot in a few seconds (seen or heard), the night on the surface, where
// mobs spawn in the open until dawn, and health under twenty, which comes
// back in the pocket at hunger eighteen or more and is kept from being lost
// meanwhile when it does not. Underground the night changes nothing (mobs
// spawn by light, not the hour), and the sleep owed is not paid in a pocket:
// only a bed pays it, and phantoms come only to a player under open sky.
// None of these holding is said as that, with what sealing costs: the
// building, the minutes sealed, and what this bot's own last seals with no
// reason came to (sealLog below).

// Heard, out of sight, but a walker's few seconds off: said as a threat.
const HEARD_NEAR = 8;
const SEAL_LOG_MAX = 20;
// The night's last seconds, said as seconds rather than "about 1 real
// minutes" (note 773).
const LAST_OF_NIGHT_S = 180;
// A seal opened again within this is a reversal of it.
const REVERSAL_MS = 60000;
const round = n => Math.round(n * 10) / 10;
const named = s => String(s).replaceAll('_', ' ');

// -> { kinds: ['threat'|'surface_night'|'heal'|'hurt'], none, says, short, facts }
// hostiles: [{ name, distance, visible }] within 24; coming: those coming at
// the bot (danger.js coming), [{ entity: { name }, distance, atBotIn }] or
// [{ name, distance }].
function sealReason({ health = 20, food = 20, underground = false, night = false, overworld = true, minutesToDawn = null, secondsToDawn = null, hostiles = [], coming = [], sleepDebt = false } = {}) {
  const list = hostiles.filter(h => Number.isFinite(h.distance) && h.distance <= 24).slice().sort((a, b) => a.distance - b.distance);
  const seen = list.filter(h => h.visible);
  const close = list.filter(h => !h.visible && h.distance <= HEARD_NEAR);
  const comers = coming.map(c => ({ name: c.entity?.name || c.name, distance: c.distance, atBotIn: c.atBotIn })).filter(c => c.name);
  const kinds = [], parts = [];
  const threat = seen[0] || close[0] || comers[0];
  if (threat) {
    kinds.push('threat');
    const how = seen[0] === threat ? 'in sight' : comers[0] === threat && !close.includes(threat) ? `coming at the bot${Number.isFinite(threat.atBotIn) ? `, at it in about ${round(threat.atBotIn)} seconds` : ''}` : 'heard, out of sight';
    const more = list.length - 1;
    parts.push(`against the ${named(threat.name)} ${Math.round(threat.distance)} blocks off, ${how}${more > 0 ? `, ${more} more hostile within 24 blocks` : ''}`);
  }
  if (overworld && night && !underground) {
    kinds.push('surface_night');
    // The last minutes of the night said in seconds, with what dawn ends
    // and what it does not (note 773): 25588 was given the turn for a
    // shelter thirteen times "about 1 real minutes" from dawn.
    parts.push(Number.isFinite(secondsToDawn) && secondsToDawn <= LAST_OF_NIGHT_S
      ? `for the night on the surface, about ${Math.round(secondsToDawn)} seconds of it left: mobs spawn in the open until dawn; from dawn none spawn there, and the zombies and skeletons out then burn in the sun (creepers, spiders and the rest stay out)`
      : `for the night on the surface: mobs spawn in the open until dawn${Number.isFinite(minutesToDawn) ? `, about ${minutesToDawn} real minutes off` : ''}`);
  }
  if (health < 20) {
    if (food >= 18) { kinds.push('heal'); parts.push(`to heal out of reach: health ${round(health)} of 20 comes back at hunger ${food}, about ${Math.round((20 - health) * 4)} seconds to full`); }
    else { kinds.push('hurt'); parts.push(`to keep health ${round(health)} of 20 from being lost while it does not come back (hunger ${food}, under eighteen)`); }
  }
  const unseen = list.filter(h => !h.visible).length;
  const facts = { health: round(health), food, underground: !!underground, hostilesWithin24: list.length, inSight: seen.length, ...(comers.length ? { comingAtTheBot: comers.length } : {}) };
  if (kinds.length) {
    const says = `Sealing ${parts.join('; and ')}.`;
    return { kinds, none: false, says, short: parts[0], facts: { ...facts, reason: kinds } };
  }
  // None: said plainly, with what is about and why the night is no reason.
  const where = !overworld ? 'off the Overworld, where no night comes'
    : underground ? 'underground, where the night changes nothing: mobs spawn in the dark there by day as by night'
      : 'on the surface by day';
  const about = list.length ? `nothing hostile in sight within 24 blocks (${unseen} heard, out of sight, none within ${HEARD_NEAR} and none coming at the bot)` : 'nothing hostile within 24 blocks';
  const debt = sleepDebt && overworld ? ' The sleep owed is not paid in a pocket: only a bed pays it, and phantoms come only to a player under open sky.' : '';
  const says = `No reason to seal: health ${round(health)} of 20, ${about}, ${where}.${debt}`;
  return { kinds: [], none: true, says, short: 'no reason named', facts: { ...facts, reason: 'none' } };
}

// What sealing costs, said after the reason: the building, the minutes
// sealed against the work waiting, and what this bot's own last seals of
// the same kind came to.
// In the night's last minutes the time sealed is said in seconds against
// the building's own (note 773): sealed for the last minute of the night,
// a shelter gains about that minute, less its building.
function sealCostSays({ blocks = null, minutesToDawn = null, secondsToDawn = null, waiting = null, log = [], none = false } = {}) {
  const buildS = Number.isFinite(blocks) && blocks > 0 ? Math.round(blocks * 0.6) : null;
  const build = buildS != null ? `about ${buildS} seconds of building (${blocks} blocks)` : 'the building';
  const last = Number.isFinite(secondsToDawn) && secondsToDawn <= LAST_OF_NIGHT_S;
  const left = last ? Math.max(0, Math.round(secondsToDawn - (buildS || 0))) : null;
  const time = last ? (left > 0 ? `, then about ${left} seconds sealed before dawn${waiting ? ` with ${waiting} waiting` : ''}` : `: dawn comes about when the building is done (${Math.round(secondsToDawn)} seconds off), so nothing of the night is spent sealed`)
    : Number.isFinite(minutesToDawn) ? `, then up to ${minutesToDawn} real minutes sealed to dawn${waiting ? ` with ${waiting} waiting` : ''}` : waiting ? `, then each minute sealed a minute with ${waiting} waiting` : '';
  return ` Sealing costs ${build}${time}.${none ? recordSays(log) : ''}`;
}

// This bot's own last seals with no reason named, and what followed.
function recordSays(log = []) {
  const done = (log || []).filter(e => e.none && e.next);
  if (!done.length) return '';
  const opened = done.filter(e => e.next !== 'stay' && e.afterS <= REVERSAL_MS / 1000);
  if (!opened.length) return ` Of this bot's last ${done.length} seal${done.length === 1 ? '' : 's'} with no reason named, none was opened again within a minute.`;
  const by = {};
  for (const e of opened) by[e.next] = (by[e.next] || 0) + 1;
  return ` Of this bot's last ${done.length} seal${done.length === 1 ? '' : 's'} with no reason named, ${opened.length} ${opened.length === 1 ? 'was' : 'were'} opened again within a minute (${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${named(k)} ${n}`).join(', ')}).`;
}

// The seal chosen (survival_priority, shelter_method), kept on the layer's
// state for pocket_next to read.
function noteSeal(state, reason, { now = Date.now(), how = null } = {}) {
  state.lastSeal = { at: now, none: !!reason?.none, short: reason?.short || null, ...(how ? { how } : {}) };
}
// pocket_next's answers after a seal: the first that opens the pocket, or a
// stay once the minute is up, logged with how long after the seal.
function noteAfter(state, choice, now = Date.now()) {
  const s = state?.lastSeal;
  if (!s || s.next) return;
  if (choice === 'stay' && now - s.at <= REVERSAL_MS) return;
  s.next = choice;
  const entry = { at: s.at, none: s.none, next: choice, afterS: Math.round((now - s.at) / 1000) };
  state.sealLog = [...(state.sealLog || []), entry].slice(-SEAL_LOG_MAX);
}
// A way out of the pocket chosen within a minute of the seal is its
// reversal, said as such on each way that opens it.
function reversalSays(state, now = Date.now()) {
  const s = state?.lastSeal;
  if (!s || s.next || now - s.at > REVERSAL_MS) return '';
  const ago = Math.max(1, Math.round((now - s.at) / 1000));
  return `Undoes the seal chosen ${ago} seconds ago (${s.none ? 'with no reason named for it' : s.short}): the pocket is opened again and its building spent for nothing. `;
}

module.exports = { sealReason, sealCostSays, recordSays, noteSeal, noteAfter, reversalSays, HEARD_NEAR, REVERSAL_MS, LAST_OF_NIGHT_S };
