'use strict';
// The crowd at a blaze spawner, asked on its own (note 2810). Walking far off for the room to thin (blaze-stand.js
// wait_far_off, note 665) was one of about twenty stances on encounter_stance: in the middle batch of 2026-11-09 and
// 10 it was offered 210 times and chosen none, the bots spending 187 of their 515 minutes at the blazes with five or
// more within sixteen, where the rods came at 6 to 12 an hour and the deaths at 2.8 to 5.4 (15 to 19 and about 1.5
// with four or fewer). Re-asked from the record: among the stances its weight was 0.03, 0.04 with its facts
// corrected, 0.07 to 0.12 with the question said short; asked alone beside fighting on, it was chosen 11 times in 42
// with five or more about and 4 in 42 with two or fewer. The user, 2026-11-10: 'ask the crowd as its own question'.
// Asked before the stance where walking far off is on offer, once for each band of the count (one or two, three or
// four, five or six, seven or more) and again after three minutes in it. Its answer narrows the stance's tree: walking
// off chosen, the stance is that; fighting on, the stance is asked without it.
const { BATCH_ROWS } = require('./blaze-record');
const AGAIN_MS = 180000;
const band = n => (n <= 2 ? 0 : n <= 4 ? 1 : n <= 6 ? 2 : 3);
// [rods an hour, deaths an hour] with that many within sixteen, the batch's; and seven rods at that pace.
const RATE = [[15, 1.7, 'one or two'], [19, 1.4, 'three or four'], [12, 2.8, 'five or six'], [6, 5.4, 'seven or eight']];
const sevenAt = ([rods, deaths]) => `seven rods at that pace are about ${Math.round(7 / rods * 60)} minutes and ${Math.round(deaths * 7 / rods * 10) / 10} deaths`;
const first = (d, n) => String(d).split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, n).join(' ');
const DEATH = 'A death in the Nether drops the kit and the rods carried; in the batch of 2026-11-09 and 10 it cost a median 38 minutes before any kit was back on.';

// tree is the stance's, changed in place. -> 'wait_far_off' | 'fight_on' | null (not asked).
async function ask(survival, bot, task, goal, save, tree, state, { within16 = 0, now = Date.now() } = {}) {
  const far = tree?.wait_far_off;
  if (process.env.JEV_BLAZE_CROWD === '0' || !far || typeof far.description !== 'string' || !(within16 >= 1) || Object.keys(tree).length < 2) return null;
  const b = band(within16), last = survival.state.crowdAsk;
  if (last && last.band === b && now - last.at < AGAIN_MS) { if (last.pick === 'fight_on') delete tree.wait_far_off; return null; }
  // Both ways said in the same terms (asked from the record with the walk off argued and the fight only named, Jev
  // walked off 88 in 100 times with one or two about): the batch's pace at this count against the pace after the wait.
  const r = RATE[b], few = b <= 1;
  const crowdTree = {
    fight_on: { description: `Stay within sixteen of the spawner and fight on with the ${within16} blaze${within16 === 1 ? '' : 's'} about; which way is asked next. Rods come only from fighting: in the batch the minutes with ${r[2]} about came to ${r[0]} rods and ${r[1]} deaths an hour, and ${sevenAt(r)}. The spawner makes up to four more every ten to forty seconds while the bot is within sixteen of it.` },
    wait_far_off: { description: `${first(far.description, 2)} No rod comes while away: about two and a half minutes with the walk. After it about one in ten of the ${within16} is left, and the spawner's first try on coming back is up to four more. ${few ? `With ${r[2]} about the fight after is at the pace it is now (${r[0]} rods and ${r[1]} deaths an hour): the wait buys nothing but its minutes back.` : `The fight after is the one with four or fewer about: 15 to 19 rods and about 1.5 deaths an hour, where ${sevenAt(RATE[0])}.`}`, ...(far.expects ? { expects: far.expects } : {}) },
  };
  const crowdState = { health: state.health, food: state.food, armour: state.armour, shield: state.shield, blazesWithinSixteen: within16, ...(state.healing ? { healing: state.healing } : {}), ...(state.hereSoFar ? { hereSoFar: state.hereSoFar } : {}), ...(state.rodsNeedMet ? { rodsNeedMet: state.rodsNeedMet } : {}), deathCosts: DEATH, blazeRecord: BATCH_ROWS };
  const decision = await survival.decide(task, goal, save, { id: 'blaze_crowd', state: crowdState, tree: crowdTree, situation: `crowd:${b}`, isFresh: () => true });
  if (!decision || decision.stale) return null;
  const pick = decision.path.at(-1) === 'wait_far_off' ? 'wait_far_off' : 'fight_on';
  survival.state.crowdAsk = { at: now, band: b, pick, within16 };
  if (pick === 'wait_far_off') { for (const k of Object.keys(tree)) if (k !== 'wait_far_off') delete tree[k]; }
  else delete tree.wait_far_off;
  return pick;
}
module.exports = { ask, band, AGAIN_MS };
