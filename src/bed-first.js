'use strict';
// A bed before the kit, Jev's to choose (note 1413). With no bed carried the
// night is spent out among the mobs or sealed in a pocket, and the record of
// the trials says what that costs: of the 37 Overworld deaths of 2026-10-10
// to 10-13, 36 were with no bed carried, 21 of them at night; the one with a
// bed was by day. With a bed, 20 of 28 bedtimes on 2026-10-13 passed in
// seconds ("Morning. Back to it."). The ladder hands the bed after the tools
// and the armour, so a bot back to life bare makes a pickaxe, a sword and
// iron first and meets the night without it: 25589, 25591 and 25593 each
// died four to six times that day, never with a bed, and were never offered
// one (win_strategy offers the ladder's next rung and the rungs that may
// wait beside it, and the bed stood behind the stone pickaxe). Offered
// beside every win_strategy, with the record and what it costs from here;
// chosen, it is the ladder's next rung for an hour or until a bed is carried.
const { DAY } = require('./day');
const BED_FIRST_MS = 60 * 60000;
const BED_DEATHS = { from: '2026-10-10', to: '2026-10-13', deaths: 37, noBed: 36, noBedAtNight: 21, withBed: 1, bedtimes: { day: '2026-10-13', tried: 28, slept: 20 } };
const bedDeathsSays = () => `Of the ${BED_DEATHS.deaths} Overworld deaths in the trials of ${BED_DEATHS.from} to ${BED_DEATHS.to}, ${BED_DEATHS.noBed} were with no bed carried, ${BED_DEATHS.noBedAtNight} of them at night; the ${BED_DEATHS.withBed} with a bed was by day. With a bed, ${BED_DEATHS.bedtimes.slept} of ${BED_DEATHS.bedtimes.tried} bedtimes on ${BED_DEATHS.bedtimes.day} passed in seconds, the night skipped and no phantom come.`;

const countOf = (bot, test) => (bot.inventory?.items() || []).filter(i => test(i.name)).reduce((n, i) => n + i.count, 0);
const bedCarried = bot => (bot.inventory?.items() || []).some(i => /_bed$/.test(i.name));
const overworld = bot => /overworld/.test(String(bot.game?.dimension || ''));

// Whether the bed goes before the kit now: chosen within the hour, none carried.
function bedFirstHolds(bot, goal, now = Date.now()) {
  const at = goal?.bedFirst?.at;
  return Number.isFinite(at) && now - at < BED_FIRST_MS && overworld(bot) && !bedCarried(bot);
}

// What a bed costs from here, and the night ahead: wool and string carried,
// sheep in view, planks, the minutes to the night.
function bedFirstSays(bot, goal) {
  const wool = countOf(bot, n => n.endsWith('_wool')), string = countOf(bot, n => n === 'string'), planks = countOf(bot, n => n.endsWith('_planks')), logs = countOf(bot, n => /_log$|_stem$/.test(n));
  const here = bot.entity?.position;
  const sheep = here ? Object.values(bot.entities || {}).filter(e => e.name === 'sheep' && e.isValid !== false && e.position && e.position.distanceTo(here) <= 48).length : 0;
  const t = bot.time?.timeOfDay;
  const night = Number.isFinite(t) ? (t >= DAY.NIGHT && t < DAY.DAWN ? 'it is night now' : `night falls in about ${Math.max(1, Math.round(((DAY.NIGHT - t + 24000) % 24000) / 1200))} real minutes`) : '';
  const fromString = Math.floor(string / 4);
  const have = wool + fromString;
  const wants = Math.max(0, 3 - have);
  // The camp's bed, where one stands (portal-camp.js, note 2815): the bed left at the portal is the respawn point and
  // can be slept in there; with none carried the ladder's 'a bed first' was chosen at once after the first death by
  // a camp, the bot 118 blocks under the ground (mid-full-19-campdrill-7, 2026-11-10 17:16:36Z).
  let campSays = null;
  try { const camp = require('./portal-camp').standing(bot, goal); if (camp && here) campSays = `A bed stands already at the camp by the portal, ${Math.round(Math.hypot(camp.bed.x - here.x, camp.bed.z - here.z))} blocks off: it is the respawn point, and a night can be slept in it there.`; } catch (_) { campSays = null; }
  const parts = [`A bed is three wool and three planks: ${wool} wool${string ? ` and ${string} string (four a wool, ${fromString} more)` : ''} carried, ${wants ? `${wants} wool still to find` : 'enough for the bed'}; ${planks} planks${logs ? ` and ${logs} logs` : ''} carried.`];
  if (campSays) parts.unshift(campSays);
  parts.push(sheep ? `${sheep} sheep in view within 48 blocks, a wool or two each sheared or killed.` : 'No sheep in view within 48 blocks.');
  if (night) parts.push(night[0].toUpperCase() + night.slice(1) + '.');
  parts.push(bedDeathsSays());
  return parts.join(' ');
}

module.exports = { BED_FIRST_MS, BED_DEATHS, bedDeathsSays, bedFirstHolds, bedFirstSays, bedCarried };
