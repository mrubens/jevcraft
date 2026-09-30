'use strict';
// A fortress known stays the target until Jev leaves it (note 721).
//
// The most persistent failure of 2026-09-29 and -30: a bot finds a fortress
// or stands at one and, within a second or three, says "Leaving this fortress
// for now. Searching on for another way in." and walks off. Six notes patched
// parts of it (689 one intention, 695 instant failures, 705 plan chains, 706
// one anchor, 714 portal intentions, 717 quiet at the cage) and the live
// critic found it again (critic-20260930T0436Z items 1 and 2). Read from the
// flight records of 25584 (mid-242-sa, 04:28 to 04:35Z) and 25592
// (mid-242-sc-fortress-1, 04:32Z), the ways a known fortress was left without
// Jev choosing it, told what reaching it needed:
//   (a) The one way left, taken unasked. decide's one-way rule took a leave
//       when it was the only option: the ledger rested the walk and the
//       staircase (tried.read left out every resting way while one option
//       was open, and a leave is always open), and keep_searching was "the
//       only way offered" (25584, 04:33:44). The intention gate did the same
//       from the other side: with nothing it kept, it handed back the whole
//       tree, and nether_gather's `without` was taken unasked under the
//       fetch of stems chosen a second before (04:33:41); its run set the
//       stems aside ten minutes as "Jev chose to go on without the stems",
//       so the approach offered no fetch at 04:31:17 and 04:32:52 either.
//   (b) Leaving asked with nothing said of what reaching the fortress needs:
//       keep_searching said the legs and the minutes; the fetch of stems that
//       would make the pickaxe, set aside, was said nowhere, nor the portal
//       resting, nor the hand's seconds (25584 at 04:31:17 and 04:32:52,
//       25592 at 04:32:33 with the fortress 1 block off).
//   (c) A leg chosen with the fortress in view, never recorded as leaving:
//       the leg question asked after an escalation, the fortress 1 block off,
//       offered legs away only, and the next pass found the same bricks and
//       asked the visit again ("A fortress! I'm heading for it" / "Leaving the
//       fortress for now" by turns, 25584 04:34:05 to 04:34:43).
//   (d) A sub-need cut: the stems chosen under the fortress work ended at the
//       gathering's lone `without` (a), and the fortress's visit was asked
//       in the fetch's place.
//   (e) heal_first offered and said at full health ("Healing before going
//       into the fortress: health 20", 25592 at 04:36:33).
//
// The rule, in one place:
//   1. Leaving is Jev's, asked: a leave (keep_searching, leave_fortress,
//      without, other_way) is never the code's one way. Beside a leave the
//      ledger keeps the resting ways on offer with their rests said
//      (tried.read `leave`); a question left with a lone leave, or a lone
//      resting way kept only beside a leave, is not asked and not taken: its
//      failure goes to the answer it serves (an intention whose way it is
//      fails) or to the question above (`loneWhy`, decide).
//   2. Leaving says what it leaves: the fortress's distance, what reaching it
//      needs in tools and blocks with the hand's seconds, and each way to them
//      as it stands here (`reachSays`), in the facts (`leaving`) of every
//      question that offers leaving it: the approach, the visit, and the leg
//      question while the fortress is in view. In the facts, not on the leave
//      itself: said there, it read as the leave's case (probe, note 721).
//   3. One set-aside (`leave`): by the fortress's anchor and reach, the spot it
//      was left from, the ways left over, and the chat that says where.
//      Taken by keep_searching, leave_fortress, and a leg chosen with the
//      fortress in view (findFortressStep).
//   4. A way failing (walk_route's no route) is said on the next asking (the
//      approach's `failed`), never a leave: nothing here leaves on a failure.
//   5. A sub-need chosen under it runs and comes back to it: a fetch of stems
//      still holding when the search's step comes round again is carried on
//      (`errandHolding`), not set down by the fortress's own questions.
//   6. heal_first is offered only where there is health to get back
//      (fortress-visit.js).

const words = s => String(s || '').replaceAll('_', ' ');
const round = n => Math.round(n);
const at3 = p => `(${round(p.x)}, ${round(p.y)}, ${round(p.z)})`;
const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return `${m} minute${m === 1 ? '' : 's'}`; };

// 1. Leaving is asked.
function isLeave(key) {
  return require('./intention').DROP.test(String(key || '').split('/').at(-1));
}
// Why an answer about to be taken unasked (decide's one way, or its best
// listed where the question is spent) is not taken, or null. `kept`: the
// resting ways the ledger kept on offer only beside a leave.
function loneWhy(q, k, kept = []) {
  if (!require('./intention').GATED.has(q)) return null;
  if (isLeave(k)) return `the one option left from here, ${words(k)}, leaves it; leaving is not taken unasked`;
  if (kept.includes(k)) return `the one option left from here, ${words(k)}, rests from here (it came to nothing), with only leaving beside it; a resting way is not taken unasked`;
  return null;
}

// 2. What leaving says: where the fortress is from here, what reaching it
// needs, and the ways to that as they stand. `offered`: the options of the
// question it is said in (a way on offer is named, not described again);
// `facts`: that question's own findings (the approach's pillar and route).
function reachSays(bot, goal, { target, anchor = null, offered = {}, facts = {} } = {}) {
  const here = bot?.entity?.position;
  if (!here || !target) return '';
  const mh = require('./mob-hunt'), bs = require('./block-stock');
  const across = round(Math.hypot(target.x + 0.5 - here.x, target.z + 0.5 - here.z)), dy = round(target.y + 1 - here.y);
  const place = anchor || target;
  const lead = `The fortress at ${at3(place)} is ${across} blocks across${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''} from here, and stays the search's target unless leaving it is chosen.`;
  const needs = [], ways = [];
  const inv = !!bot.inventory?.items;
  // The pickaxe: rock is dug several times faster with one and dug rock
  // drops blocks to lay only to one.
  const pick = inv ? mh.pickaxeFirst(bot) : { carried: true };
  if (!pick.carried) {
    let line = null; try { line = bs.handLine(bot, target); } catch (_) { line = null; }
    const hand = line?.dug ? `; by hand the straight line to it is ${line.dug} block${line.dug === 1 ? '' : 's'} of rock, about ${line.handSeconds} seconds of digging, dropping nothing${line.stopName ? `, up to ${line.stopName} ${line.stopAt} blocks along, which does not break` : ''}` : '';
    needs.push(`a pickaxe first (none carried; ${pick.none ? (pick.short ? `short of ${pick.short.planks} planks, ${pick.short.stems} stem${pick.short.stems === 1 ? '' : 's'}, for ${pick.short.for || 'it'}, then ${pick.short.then}` : 'none can be made from what is carried') : `${pick.name} can be made here from what is carried`}): with one, rock is dug several times faster and the netherrack dug drops as blocks to lay${hand}`);
  }
  // Blocks: to climb, to span.
  const carried = inv ? require('./bridging').blocksCarried(bot) : null;
  // "None to be had here" is the hand's: with a pickaxe the netherrack about is the blocks.
  const pillar = facts.pillar && String(facts.pillar).replace(/^the climb to the floor is not offered: /, '').replace(/ and none to be had here$/, pick.carried ? ' and none to be had here' : '; none by hand, the netherrack about with a pickaxe');
  if (pillar) needs.push(`blocks to climb with: ${pillar}`);
  else if (dy >= 2 && carried !== null && carried < dy) needs.push(`blocks to climb the ${dy} up (${carried} carried)`);
  if (facts.walkRoute) needs.push('a way made, not walked (no route on foot from here)');
  // The ways to what it needs.
  if (!pick.carried && pick.none) {
    if (offered.fetch_stems) ways.push('fetch stems (offered here)');
    else {
      const aside = require('./progress').attemptsFor(goal).of('fetch_stems').nether;
      let place = null; try { place = require('./nether-wood').stemPlaces(bot, goal)[0] || null; } catch (_) { place = null; }
      const known = place?.at ? `the nearest known ${round(Math.hypot(place.at.x - here.x, place.at.z - here.z))} blocks off` : 'none known';
      ways.push(aside ? `fetch stems (${known}): set aside ${mins(aside.until - Date.now())} more, ${aside.why}` : `fetch stems: ${known}${place ? '' : ', so not offered'}`);
    }
  } else if (!pick.carried) ways.push(offered.make_pickaxe ? 'make the pickaxe (offered here)' : 'make the pickaxe');
  if (offered.return_for_blocks) ways.push('back through the portal for the kit (offered here)');
  else if (!pick.carried || (carried !== null && carried < Math.max(dy, 1))) {
    let closed = null; try { closed = mh.tripHomeClosed(bot, goal); } catch (_) { closed = null; }
    if (closed) ways.push(`back through the portal: ${closed.says.replace(/\.$/, '')}`);
  }
  const offers = ['walk_route', 'cross_level', 'descend', 'tunnel', 'pillar_up', 'blocks_then_pillar', 'blocks_then_cross', 'head_toward'].filter(k => offered[k]);
  if (offers.length) ways.push(`the ways in on offer: ${offers.map(words).join(', ')}, each with how it stands from here`);
  // What searching on takes to the next one: the same pockets.
  const same = !pick.carried || (carried !== null && carried < Math.max(dy, 1)) ? ` Searching on takes the same pockets to the next fortress (${pick.carried ? 'a pickaxe' : 'no pickaxe'}, ${carried ?? 0} block${carried === 1 ? '' : 's'}).` : '';
  return `${lead}${needs.length ? ` Reaching it needs ${needs.join('; ')}.` : ''}${ways.length ? ` The ways to it: ${ways.join('; ')}.` : ''}${same}`;
}

// 3. The one set-aside: the fortress by its anchor and reach, from where it
// was left and over which ways, said in chat with where it is.
const LEAVE_FOR_MS = 10 * 60000;
const LEFT_FROM_MS = 60 * 60000;
function leave(bot, state, { anchor, radius = 16, left = [], why = 'Jev chose to leave it and search on', save = () => {}, now = Date.now() }) {
  const p = bot.entity.position, from = { x: round(p.x), y: round(p.y), z: round(p.z) };
  state.leftFrom = [...(state.leftFrom || []).filter(l => now - l.at < LEFT_FROM_MS), { at: now, ...from }].slice(-16);
  (state.shunned ||= []).push({ x: anchor.x, z: anchor.z, radius, until: now + LEAVE_FOR_MS, at: now, why, from, left });
  delete state.target; save();
  bot.chat?.(`Leaving the fortress at ${at3(anchor)} for now, ${round(Math.hypot(anchor.x - p.x, anchor.z - p.z))} blocks off. Searching on for another.`);
}

// 5. A fetch of stems chosen under the fortress work and still holding: it
// is carried on where the search's step comes round, not set down by the
// fortress's own questions. -> the intention, or null.
function errandHolding(bot, goal) {
  let i = null; try { i = require('./intention').holding(bot, goal); } catch (_) { i = null; }
  if (!i || i.choice !== 'fetch_stems') return null;
  if (require('./progress').isSetAside(goal, 'fetch_stems', 'nether')) return null;
  const nw = require('./nether-wood');
  if (!nw.woodWanted(bot).short) return null;
  return i;
}

module.exports = { isLeave, loneWhy, reachSays, leave, errandHolding, LEAVE_FOR_MS, LEFT_FROM_MS };
