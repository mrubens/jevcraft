'use strict';
// What the ways to ender pearls have come to, said where a way is chosen
// (note 788): the trials' flight records (scripts/pearl-record.js), the
// arena's drills (notes 713, 718, 727), the measured barter (note 87), and
// this run's own record of each way Jev chose at pearl_order (pearl-order.js):
// the minutes it was held, the pearls it brought, the deaths in it. The rows
// are what the bot did and how it went, not a promise of what a way yields.

// The trials, 2026-09-26T17:38Z to 2026-10-01T07:30Z: 932 flight records,
// 296 bot-hours played (29 more with Jev down, off the clock), and the 1,521
// trial verdicts of the same days (artifacts/midgame).
const TRIALS = {
  window: '2026-09-26 to 2026-10-01', records: 932, botHours: 296, verdicts: 1521,
  pearlsEver: 0, sevenRodTrials: 10,
  netherMinutes: 3356, netherRecords: 204,
  // The pearl rung held the turn in 22 records, 119 minutes in all, every
  // time with the rods resting (0 to 5 carried), never after seven.
  pearlRungRecords: 22, pearlRungMinutes: 119, pearlRungSweepMinutes: 55,
  // Endermen within sixteen blocks on the way, none struck.
  endermenNether: 155, endermenNetherMinutes: 113, endermenOverworld: 136, endermanFights: 0,
  // A hunt stalking endermen in a warped forest, the only one recorded.
  forestStalkMinutes: 4.3,
  warpedFoundRecords: 71,
  // Gold: a throwable ingot (beyond the four golden boots take) in 36 of
  // 204 Nether records; a piglin within 32 with gold to throw, 67 minutes.
  goldRecords: 36, piglinGoldMinutes: 67,
  barters: 1, barterIngots: 4, barterPearls: 0,
};

// The arena (scripts/arena.js, real Jev answers): one enderman at a time
// (enderman_single, note 713 after its fix: 8 runs, 8 kills at a median
// 8.9 s, 5 pearls, no death, a median 4.1 damage), and the forest's density
// (enderman_forest_trio, 3 endermen 90 s; enderman_forest_five, 5 endermen
// 120 s; notes 718 and 727 after their fixes: 16 runs, 28 minutes, 5 pearls,
// no death). Before note 713's fix the trio killed the bot in 4 of 5 runs.
const ARENA = {
  single: { runs: 8, kills: 8, pearls: 5, deaths: 0, killSeconds: 8.9, damage: 4.1 },
  forest: { runs: 16, minutes: 28, pearls: 5, deaths: 0, engaged: 7 },
  forestBefore: { runs: 5, deaths: 4, pearls: 1 },
};

// The hunt's own fight with one enderman and nothing else about, by kit
// (scripts/arena.js enderman_single, the hunt's answer given and the
// encounter's stance fixed to fight, Jev's credits being out; note 713's
// eight runs and note 790's): the runs, the kills, the damage of a kill
// the hunt's fight carried to the end, and the fights that went under the
// hunt's floor of twelve health, where the fight is the encounter's stance's
// and no longer the hunt's guarded one. Before note 790 a kit short of a
// piece never struck at all (the fight's readiness asked the full kit):
// 7 runs, 7 hunts chosen, no blow.
const ENDERMAN_FIGHTS = [
  { kit: 'the iron set with golden boots, a diamond sword and a shield', runs: 28, kills: 29, damage: 4.1, pastFloor: 2, deaths: 0 },
  { kit: 'an iron helmet and chestplate, an iron sword and a shield (the trials\' kit)', runs: 13, kills: 11, damage: 5.7, pastFloor: 6, deaths: 3 },
];
function endermanSays() {
  const rows = ENDERMAN_FIGHTS.map(r => `with ${r.kit}, ${plural(r.runs, 'run')}, ${plural(r.kills, 'kill')}, a median ${r.damage} damage for a kill the hunt's own fight carried through, ${r.pastFloor} of the fights going under twelve health and on as the encounter's stance${r.pastFloor ? ` (${r.deaths ? `${plural(r.deaths, 'death')} among them` : 'no death'})` : ''}`);
  return `The arena's record of the hunt's fight with one enderman, nothing else about: ${rows.join('; ')}. Under twelve health the hunt's own fight ends and what to do with the enderman then at the bot is the encounter's question. The hunt keeps its eyes off the enderman's head (looked in the eye, it turns and comes, and one stared at within four blocks teleports off) and strikes it first, the shield raised between swings; once turned, a two-high gap or a block over the head keeps its blows off while the sword reaches its legs (the encounter's cap_fight). In the trials ${TRIALS.endermenNether} endermen came within sixteen blocks in the Nether and ${TRIALS.endermenOverworld} in the Overworld and none was ever struck.`;
}

// The barter, measured on this server (note 87): 160 ingots thrown to eight
// penned piglins bought 18 pearls; the barter drill, 40 ingots, 2 to 4.
const BARTER = { ingots: 160, pearls: 18, perPearl: 9, drillIngots: 40, drillPearls: '2 to 4', admireSeconds: 8, perRound: 3 };

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const round = (n, d = 10) => Math.round(n * d) / d;

// This run's record of the ways chosen at pearl_order: goal.pearlLedger,
// by route: { chosen, ms, pearls, deaths }.
function ledger(goal) { return goal.pearlLedger ||= {}; }
function settle(goal, held, { pearls = 0, deaths = 0, now = Date.now() } = {}) {
  if (!held || held.settled) return null;
  const row = ledger(goal)[held.pick] ||= { chosen: 0, ms: 0, pearls: 0, deaths: 0 };
  row.chosen++;
  row.ms += Math.max(0, Math.min(now, held.until || now) - held.at);
  row.pearls += Math.max(0, pearls - (held.pearlsAt || 0));
  row.deaths += Math.max(0, deaths - (held.deathsAt || 0));
  held.settled = true;
  return row;
}
function runSays(goal, route) {
  const row = goal?.pearlLedger?.[route];
  if (!row?.chosen) return 'This run: not chosen yet.';
  const min = row.ms / 60000;
  return `This run: chosen ${plural(row.chosen, 'time')}, held ${round(min)} minutes, ${plural(row.pearls, 'pearl')} brought${row.pearls ? ` (${round(min / row.pearls)} minutes a pearl)` : ''}, ${plural(row.deaths, 'death')} in it.`;
}

const LIVE = () => `In the trials of ${TRIALS.window} (${TRIALS.records} flight records, ${TRIALS.botHours} bot-hours, ${TRIALS.verdicts} trial verdicts) the bot never carried a pearl: the pearls came after the rods in the ladder's order, ${TRIALS.sevenRodTrials} trials ever carried seven rods' worth, and the pearl rung held the turn in ${TRIALS.pearlRungRecords} records for ${TRIALS.pearlRungMinutes} minutes in all, each time with the rods resting, ${TRIALS.pearlRungSweepMinutes} of those minutes sweeping for a warped forest.`;

// What each way has come to, said on its option.
function routeSays(route, goal) {
  const a = ARENA;
  if (route === 'hunt_enderman') {
    const perMin = round(a.single.pearls / (a.single.kills * a.single.killSeconds / 60));
    return `Record: in the arena, one enderman at a time (${a.single.runs} runs) was killed in a median ${a.single.killSeconds} s, ${a.single.pearls} pearls from ${a.single.kills} kills (about ${perMin} pearls a minute of fighting, the walk to it not counted), ${a.single.deaths ? plural(a.single.deaths, 'death') : 'no death'}, a median ${a.single.damage} damage. In the trials ${TRIALS.endermenNether} endermen came within sixteen blocks in the Nether (${TRIALS.endermenNetherMinutes} minutes) and ${TRIALS.endermenOverworld} in the Overworld, and none was ever struck: no pearl, no death, no record either way. ${runSays(goal, route)}`;
  }
  if (route === 'warped_forest') {
    return `Record: in the arena's forest drills (three and five endermen about, ${a.forest.runs} runs, ${a.forest.minutes} minutes) ${a.forest.pearls} pearls (about ${round(a.forest.minutes / a.forest.pearls)} minutes a pearl in the forest, the walk there not counted), ${a.forest.deaths ? plural(a.forest.deaths, 'death') : 'no death'}; before note 713's fix the three killed the bot in ${a.forestBefore.deaths} of ${a.forestBefore.runs} runs. In the trials a forest hunt held the turn ${TRIALS.forestStalkMinutes} minutes in all, stalking endermen, and struck none; ${TRIALS.warpedFoundRecords} of ${TRIALS.netherRecords} Nether records found a warped forest on the way. ${runSays(goal, route)}`;
  }
  if (route === 'barter_gold') {
    return `Record: measured on this server, ${BARTER.ingots} ingots thrown bought ${BARTER.pearls} pearls (about ${BARTER.perPearl} ingots a pearl, every throw a roll), the barter drill ${BARTER.drillIngots} ingots for ${BARTER.drillPearls}; a round throws one ingot to each of up to ${BARTER.perRound} piglins and waits about ${BARTER.admireSeconds} s while they admire it, so a pearl's ${BARTER.perPearl} ingots are about three rounds. In the trials one barter was made: ${TRIALS.barterIngots} ingots thrown, ${TRIALS.barterPearls ? plural(TRIALS.barterPearls, 'pearl') : 'no pearl'} (about half of one was the expectation); gold to throw was carried in ${TRIALS.goldRecords} of ${TRIALS.netherRecords} Nether records, with a piglin within 32 for ${TRIALS.piglinGoldMinutes} minutes. ${runSays(goal, route)}`;
  }
  if (route === 'rods_first') return `${LIVE()} ${runSays(goal, route)}`;
  return runSays(goal, route);
}

module.exports = { TRIALS, ARENA, BARTER, ENDERMAN_FIGHTS, endermanSays, routeSays, runSays, settle, ledger, LIVE };
