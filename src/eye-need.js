'use strict';
// How many blaze rods, ender pearls and eyes "enough" is, in one place. The
// ladder (game-progress.js), the Nether stay (crossing-kit.js), the blaze
// hunt (blaze-stand.js rodsNeeded, mob-hunt.js) and every question that says
// what is still needed read it here, so a bot that has what is said is done
// with the rung, and none of them asks for more than another says.
//
// The game: an End portal has twelve frames, each takes one Eye of Ender, an
// eye is one ender pearl and one blaze powder, and a blaze rod makes two
// powder. Twelve eyes are six rods and twelve pearls. The stronghold search
// (stronghold.js) throws eyes to find the portal and never throws the twelfth
// (it keeps twelve for the frames), so it starts with a thirteenth, and a
// thrown eye is picked up again four times in five. One spare eye is what the
// search can begin on: thirteen eyes, seven rods (fourteen powder), thirteen
// pearls. Before this the ladder wanted sixteen eyes, eight rods and sixteen
// pearls without saying so, while the Nether stay's own text said six rods and
// twelve pearls: mid-235-p-nether-4-fortress-6 (2026-09-28, note 648) had
// seven rods at 18:57Z, went home for food, and the ladder sent it back into
// the Nether for an eighth, where it died holding all seven at 19:32Z.
// GOAL.md's milestone of six rods and twelve pearls is what a run is measured
// by (scripts/midgame.js); this is what the ladder asks for.
//
// Once the portal is found, the frames still empty are the number (some come
// filled, about one in ten): neededEyes, saved by end-portal.js.
const PORTAL_EYES = 12, SEARCH_SPARE = 1;
const EYES_WANTED = PORTAL_EYES + SEARCH_SPARE;
const countOf = (bot, name) => (bot.inventory?.items() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

// The eyes the goal wants in all: the frames still empty once the portal is
// found, else the twelve and the spare the search throws with.
const portalFrames = goal => { const needed = goal?.gameProgress?.milestones?.stronghold_located && goal?.endPortal?.neededEyes; return Number.isInteger(needed) ? needed : null; };
const eyeTarget = goal => portalFrames(goal) ?? EYES_WANTED;
// Rods that make `eyes` eyes with `powder` already made and no eyes: two powder a rod.
const rodsFor = (eyes, powder = 0) => Math.ceil(Math.max(0, eyes - powder) / 2);

// What is wanted and what is carried, from the inventory each time: nothing
// here is a counter that a loss, a craft or a partial pickup could leave wrong.
function need(bot, goal) {
  const target = eyeTarget(goal), eyes = countOf(bot, 'ender_eye'), powder = countOf(bot, 'blaze_powder');
  const rods = countOf(bot, 'blaze_rod'), pearls = countOf(bot, 'ender_pearl');
  const rodsWanted = rodsFor(target - eyes, powder), pearlsWanted = Math.max(0, target - eyes);
  return { target, eyes, powder, rods, pearls, rodsWanted, rodsLeft: Math.max(0, rodsWanted - rods), pearlsWanted, pearlsLeft: Math.max(0, pearlsWanted - pearls), located: portalFrames(goal) !== null };
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The one sentence every question about the rods carries: the number, why it
// is that number, and what is carried against it.
// `brief`: the fortress approach and the legs of its search carry the short
// line. On a recorded fortress_approach (25589, 19:19Z) the reasons in full
// ("a rod makes 2 powder", the search's throwing) turned ten answers in ten
// from cross_level to keep_searching, at one rod carried as at seven, where
// the number alone left them; the line below left cross_level at ten in ten.
// The reasons are said where the question is about the rods or the leaving.
function says(bot, goal, { brief = false } = {}) {
  const n = need(bot, goal);
  if (brief) return `Blaze rods: ${n.rods} carried, ${n.rodsWanted} wanted in all (${n.target} eyes for the portal and the search), ${n.rodsLeft ? `${n.rodsLeft} still needed` : 'none still needed, the rods are done'}.`;
  const why = n.located
    ? `the portal has ${n.target} frames still empty, an eye is one pearl and one blaze powder, and a rod makes two powder`
    : `an End portal takes ${PORTAL_EYES} eyes, an eye is one pearl and one blaze powder, a rod makes two powder, and the stronghold search throws only the eyes above ${PORTAL_EYES} (a thrown eye comes back four times in five), so ${EYES_WANTED} eyes are what it begins on: ${plural(rodsFor(EYES_WANTED), 'rod')} and ${EYES_WANTED} pearls`;
  const held = [`${plural(n.rods, 'blaze rod')}`, n.powder ? `${n.powder} blaze powder` : null, n.eyes ? plural(n.eyes, 'eye') : null, `${plural(n.pearls, 'ender pearl')}`].filter(Boolean).join(', ');
  const done = n.rodsLeft ? `${plural(n.rodsLeft, 'rod')} still needed` : 'no rod is still needed: the rods are done, and the fortress has nothing more the goal needs';
  return `The goal wants ${plural(n.rodsWanted, 'blaze rod')} in all for ${n.target} eyes (${why}). Carried: ${held}; ${done}.`;
}

module.exports = { PORTAL_EYES, SEARCH_SPARE, EYES_WANTED, eyeTarget, rodsFor, need, says };
