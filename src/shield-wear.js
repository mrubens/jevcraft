'use strict';
// The shield's wear at the blazes (note 786). A shield is worn by what it
// blocks: the game takes 1 more than the whole of the damage from it for a
// blow of 3 or more (Player.hurtCurrentlyUsedShield), and a blaze's fireball
// is 5 at Normal, so each one blocked takes 6 of the shield's 336: about 56
// fireballs, under nineteen volleys of three. Nothing said so. 24 shields
// broke under blaze fire in the Nether spans of 2026-09-30T06:08Z to
// 2026-10-01T05:00Z (scripts/blaze-deaths.js --shields), a median 9 minutes
// after they were raised there; within two minutes of the break 13 of those
// bots were dead. 20 of the 29 blaze deaths in those spans came with no
// shield in the off hand, 10 of them broken in the last 30 seconds (mid-242-xf
// 09:42:26Z, broken under a volley, dead nine seconds later; mid-231-ad
// 03:49:49Z). The fights went on as they were chosen, with the shield.
//
// So: the wear is said with the questions at the blazes (decide()'s
// shieldWear), with the record; a stance or a cage plan chosen with the
// shield up ends when it breaks or comes to its last volley (holds and
// cage-hold.js planEnd), and is asked again with that said.
const WEAR = Object.freeze({ fireball: 6, max: 336, volley: 3 });
// The record (scripts/blaze-deaths.js --shields over the flight records of
// 2026-09-30T06:08Z to 2026-10-01T05:00Z, the spans of scripts/blaze-span.js).
const RECORD = Object.freeze({ from: '2026-09-30T06:08Z', to: '2026-10-01T05:00Z', broke: 24, deadIn2: 13, deadIn5: 14,
  withMin: 738.8, withDeaths: 9, withoutMin: 290.6, withoutDeaths: 20 });
// The last volley: under this many fireballs left, a hold chosen with the
// shield is asked again.
const LAST = WEAR.volley;

const offhand = bot => bot?.inventory?.slots?.[45] || null;
const maxOf = (bot, item) => bot?.registry?.itemsByName?.[item?.name || 'shield']?.maxDurability || WEAR.max;
const items = bot => { try { return bot?.inventory?.items?.() || []; } catch (_) { return []; } };
const sum = (bot, re) => items(bot).filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);

// The shield as it stands: in the off hand and its uses left, the fireballs
// and volleys that leaves, spares carried, and one makeable from pockets.
function state(bot) {
  const o = offhand(bot);
  const held = o?.name === 'shield';
  const max = held ? maxOf(bot, o) : WEAR.max, used = held ? Math.max(0, o.durabilityUsed || 0) : 0;
  const left = held ? Math.max(0, max - used) : 0;
  const fireballs = Math.floor(left / WEAR.fireball);
  // A spare: a shield in the pockets (items() leaves the off hand out).
  const spare = items(bot).filter(i => i.name === 'shield' && i.slot !== 45).length;
  const iron = sum(bot, /^iron_ingot$/), planks = sum(bot, /_planks$/) + 4 * sum(bot, /_(log|stem|wood|hyphae)$/), table = sum(bot, /^crafting_table$/) > 0;
  // 6 planks and an iron ingot at a table; a table is 4 planks more.
  const makeable = iron >= 1 && planks >= (table ? 6 : 10);
  return { held, max, used, left, fireballs, volleys: Math.floor(fireballs / WEAR.volley), spare, makeable, iron, planks, table };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function recordSays() {
  const r = RECORD, rate = (d, m) => Math.round(d / m * 60 * 10) / 10;
  return `In the trials of ${r.from} to ${r.to}, ${r.broke} shields broke under blaze fire in the Nether, and within two minutes of the break ${r.deadIn2} of those bots were dead; deaths in the blazes' spans came ${rate(r.withDeaths, r.withMin)} a bot-hour with a shield in the off hand and ${rate(r.withoutDeaths, r.withoutMin)} a bot-hour without.`;
}
// In words: the uses left and what they come to against fireballs, the
// spare, and the record. -> string
function says(bot, s = state(bot)) {
  const spare = s.spare ? `${plural(s.spare, 'spare shield')} carried.` : s.makeable ? `No spare carried; one can be made from what is carried (an iron ingot and 6 planks at a ${s.table ? 'crafting table, carried' : 'crafting table, made from 4 more planks'}).` : `No spare carried, and none can be made from what is carried (${s.iron ? 'too few planks' : 'no iron ingot'}).`;
  const now = s.held
    ? `The shield in the off hand has ${s.left} of its ${s.max} uses left: each blaze fireball blocked on it takes ${WEAR.fireball}, so about ${plural(s.fireballs, 'more fireball')} blocked (${plural(s.volleys, 'volley')} of three) before it breaks${s.fireballs < LAST ? ', the last volley' : ''}; broken, every fireball that lands is taken whole and sets the bot alight five seconds.`
    : 'No shield in the off hand: every fireball that lands is taken whole and sets the bot alight five seconds.';
  return `${now} ${spare} ${recordSays()}`;
}

const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
// Blazes about: one within 24 blocks.
function blazesAbout(bot, within = 24) {
  const p = bot?.entity?.position;
  if (!p) return 0;
  return Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.position && e.position.distanceTo(p) <= within).length;
}
// Said with a question in the Nether with a blaze within 24. -> string or null
function fact(bot) {
  if (!bot?.inventory || !inNether(bot) || !blazesAbout(bot)) return null;
  return says(bot);
}

// What changed since a hold was chosen with `then` (state() at the choice):
// the shield broke, or came to its last volley. -> words or null
function changed(then, now) {
  if (!then?.held || !now) return null;
  if (!now.held) return `the shield broke (it had ${plural(then.fireballs, 'fireball')} of wear left when this was chosen): every fireball that lands is taken whole now`;
  if (then.fireballs >= LAST && now.fireballs < LAST) return `the shield is down to its last volley: about ${plural(now.fireballs, 'more fireball')} blocked before it breaks (${now.left} of its ${now.max} uses left)`;
  return null;
}

module.exports = { WEAR, RECORD, LAST, state, says, fact, changed, recordSays };
