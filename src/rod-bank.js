'use strict';
// Banking rods (note 760): out through the portal with the rods already got,
// into a chest on the Overworld side, and back in for the rest. No bot
// carried a rod out of the Nether from 2026-09-29T23:00Z to 2026-09-30T17:00Z
// (scripts/rod-stage.js, note 759): 55 lives carried 2 or more there and 49
// died with them; of the 46 deaths that dropped 2 or more, 34 carried
// neither a chest nor the wood for one (scripts/rod-chest-kit.js), so the
// chest in the Nether (rod-stash.js, note 704) could not be offered. The
// Overworld has the trees a chest is made of, and a death there, or a death
// in the Nether after, leaves the chest where it is.
//
// The goal counts rods carried at once (scripts/midgame.js counts the most
// carried, eye-need.js what the eyes are made of): a banked rod counts once
// it is taken out again with the rest, so the bank is emptied before the
// eyes, once the rods carried and banked together are what the goal wants.
//
// Here: the offer (bank_rods, in the rods stage's questions: empty_spawner
// and hunt_target), the held intention through the portal (bankStage, read by
// game-progress.js nextGameStage), the store on the Overworld side (bank),
// and the take-out there (collectHere). The chests are rod-stash.js's
// goal.rodStashes, with dimension 'overworld'; eye-need.js counts them held.
const { setAside, isSetAside } = require('./progress');

// The Nether leg held at most this long (the walk out measured 17 to 30
// blocks a minute, game-progress.js NETHER_TRIPS): past it the bank is
// ended, said, and the hunt goes on.
const OUT_MS = 20 * 60000;
const FAILS = 2, REST_MS = 10 * 60000;
const P = v => ({ x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) });
const at = p => `(${p.x}, ${p.y}, ${p.z})`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function rs() { return require('./rod-stash'); }
const where = bot => rs().dimOf(bot);
const carriedKept = bot => rs().KEPT.filter(n => rs().countOf(bot, n) > 0).map(n => ({ item: n, count: rs().countOf(bot, n) }));
// The bank's chests on the Overworld side, with something in them.
const banks = goal => rs().stashes(goal).filter(s => s.dimension === 'overworld' && rs().withContents(s));
const pending = goal => { const b = goal?.rodBank; return b && !b.doneAt && !b.endedAt ? b : null; };

function end(goal, why, save) {
  const b = pending(goal);
  if (!b) return;
  b.endedAt = Date.now(); b.why = why;
  save?.();
}

// What the chest on the Overworld side is: one banked in before (known by
// its place), the chest carried, one made from the wood carried, or one made
// from a tree there.
function chestThere(bot, goal) {
  const known = rs().stashes(goal).filter(s => s.dimension === 'overworld')[0];
  if (known) return { how: 'known', position: known.position, says: `the chest at ${at(known.position)} on the Overworld side, banked in before` };
  if (rs().countOf(bot, 'chest')) return { how: 'carried', seconds: 1, says: 'the chest carried, set down by the Overworld portal (about a second)' };
  const m = rs().chestMaking(bot);
  if (m) return { how: 'wood', seconds: 8, says: `a chest made there from the wood carried (8 planks${m.table ? ' at the crafting table carried' : ', and a crafting table of 4 more'}, about 8 seconds)` };
  return { how: 'tree', says: 'a chest made on the Overworld side from a tree\'s wood there (2 logs for the chest and 1 for a crafting table; no chest or wood is carried, and where the nearest tree on the Overworld side stands is not known from here)' };
}

// Whether bank_rods is on offer here, and what it is: in the Nether in
// Survival, 2 or more rods carried (powder a half each) and rods still
// wanted, the walk to the portal open and its distance known, not resting
// after a failure and not already under way.
function bankOffer(bot, goal, { now = Date.now() } = {}) {
  if (!bot?.entity || where(bot) !== 'nether' || bot.game?.gameMode !== 'survival') return null;
  const rods = rs().rodsEquivalent(bot);
  if (rods < rs().ROD_MIN || pending(goal) || isSetAside(goal, 'rod_bank', 'out', now)) return null;
  let n = null; try { n = require('./eye-need').need(bot, goal); } catch (_) { n = null; }
  if (!n?.rodsLeft) return null;
  let closed = null; try { closed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { closed = null; }
  if (closed) return null;
  const gp = require('./game-progress');
  const d = gp.portalDistance(bot, goal);
  if (d == null) return null;
  const pace = gp.netherPaceSays(bot, d);
  const chest = chestThere(bot, goal);
  return { rods, wanted: n.rodsWanted, left: n.rodsLeft, what: carriedKept(bot), d, seconds: Math.round(pace.seconds), paceSays: pace.says, chest };
}

// The option's words: what goes out and where, the walk and its record, the
// round trip, what it keeps, and what staying with them has come to.
function offerSays(offer) {
  const list = offer.what.map(w => plural(w.count, w.item.replaceAll('_', ' ')));
  const what = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  const walk = offer.paceSays ? offer.paceSays.trim() : `About ${Math.max(1, offer.seconds)} seconds at a walk.`;
  const minutes = Math.max(1, Math.round((2 * offer.seconds + (offer.chest.seconds || 0)) / 60));
  let staying = ''; try { staying = ` Staying with them: ${require('./rod-risk').recordSays(offer.rods)}`; } catch (_) { staying = ''; }
  return `Bank the rods got so far: walk back to the portal ${offer.d} blocks off with the ${what}, go through the portal, put them in ${offer.chest.says}, and come back through for the ${plural(offer.left, 'rod')} still needed. ${walk} There and back is about ${minutes} minute${minutes === 1 ? '' : 's'}${offer.chest.how === 'tree' ? ' and the time the wood takes on the Overworld side' : ''}, no rod meanwhile. The walk out carries them, and a death on it drops them as one here does; once in the chest they are kept through any death after, counted as held, and taken out once the rods carried and banked together are what the goal wants, so a death after loses only the rods got since.${staying}`;
}

// The option as a tree entry: taken, the intention is kept (bankStage) and
// the walk begins at once where the caller can walk it.
function option(bot, task, goal, save, actions, offer) {
  return { description: offerSays(offer), trip: 'the portal', secs: 2 * offer.seconds,
    run: async () => {
      goal.rodBank = { at: Date.now(), rods: offer.rods, from: P(bot.entity.position), chest: offer.chest.how };
      save?.();
      bot.chat?.(`Taking the ${plural(offer.rods, 'blaze rod')} out to a chest past the portal, then back for the rest.`);
      if (actions?.returnOverworld) await actions.returnOverworld(bot, task, goal, save);
    } };
}

// Out of the Nether with rods carried for another reason (food, a rung
// turned to), and rods still wanted: they are banked on arrival, as if
// bank_rods had been chosen (note 868). 25597 (mid-241-cc-nether-1,
// 2026-10-02 12:37Z) came out for food with two rods, the first out in a
// day, and went after gold, a bed and oak logs at 9 health with both in its
// pack: a death there loses them, and the chest is seconds beside the
// portal. Once a trip out: a bank that fails is not begun again for half an
// hour. With every rod the goal wants carried or banked, nothing is banked.
const ARRIVAL_MS = 5 * 60000;
function bankOnArrival(bot, goal, dim, now = Date.now()) {
  if (dim !== 'overworld' || !bot?.entity || bot.game?.gameMode !== 'survival' || pending(goal)) return false;
  // On arrival: the dimension became the Overworld within the last few minutes (game-progress.js here).
  const here = goal?.gameProgress?.here;
  if (!(here?.dimension === 'overworld' && now - here.at < ARRIVAL_MS)) return false;
  const rods = rs().rodsEquivalent(bot);
  if (!(rods >= 1) || isSetAside(goal, 'rod_bank', 'arrival', now) || isSetAside(goal, 'rung', 'bank_rods', now)) return false;
  let n = null; try { n = require('./eye-need').need(bot, goal); } catch (_) { n = null; }
  if (!n?.rodsLeft) return false;
  goal.rodBank = { at: now, rods, from: P(bot.entity.position), chest: chestThere(bot, goal).how, onArrival: true };
  setAside(goal, 'rod_bank', 'arrival', 'banked on coming out with rods', 30 * 60000);
  bot.chat?.(`Out with ${plural(rods, 'blaze rod')}: into a chest here first, ${n.rodsLeft} more to get.`);
  return true;
}

// The rods carried, asked on their own (rods_now, note 871): take them out
// now, or stay for more. bank_rods was one of up to fifteen answers at the
// cage (empty_spawner, hunt_target) and was taken at 0.17 where a box was at
// 0.33; on 2026-10-02, of five lives that carried two or more rods, four
// died with them (4, 3, 2 and 2 rods) and the one that left carried its two
// out by a tunnel dug to its portal (note 860). Asked once for each count of
// rods carried, and again after ten minutes; with the way out closed or
// resting it is not asked.
const TODAY = Object.freeze({ day: '2026-10-02 (11:45Z to 13:00Z)', lives: 5, died: 4, lost: [4, 3, 2, 2], out: 1, outRods: 2 });
const ASK_AGAIN_MS = 10 * 60000;
async function askBank(bot, task, goal, save, actions, client, { now = Date.now() } = {}) {
  if (!client) return null;
  const offer = bankOffer(bot, goal, { now });
  if (!offer) return null;
  const a = goal.rodsNowAsked;
  if (a && a.rods >= offer.rods && now - a.at < ASK_AGAIN_MS) return null;
  goal.rodsNowAsked = { rods: offer.rods, at: now }; save?.();
  const opt = option(bot, task, goal, save, actions, offer);
  let staying = ''; try { staying = require('./rod-risk').recordSays(offer.rods); } catch (_) { staying = ''; }
  const today = `On ${TODAY.day}, ${TODAY.lives} lives carried 2 or more rods at a fortress: ${TODAY.died} stayed and died with them (${TODAY.lost.join(', ')} rods lost), ${TODAY.out} left and carried its ${TODAY.outRods} out.`;
  const tree = {
    bank_now: { description: `${opt.description} ${today} The way out can be the tunnel dug straight at the portal (asked on the way where the walk fails): in the rock nothing sees or pushes the bot.`, trip: 'the portal', run: opt.run },
    stay_for_more: { description: `Stay and hunt on for the ${plural(offer.left, 'rod')} still needed with the ${plural(offer.rods, 'rod')} in the pack: no walk out now, and every rod carried is lost with a death here. ${staying} ${today} Asked again when another rod is carried, or in ten minutes.` },
  };
  let decision;
  try { decision = await require('./decisions').decide('rods_now', { client, bot, task, goal, save, tree, state: { rodsCarried: offer.rods, rodsWanted: offer.wanted, rodsStillNeeded: offer.left, portalBlocks: offer.d, health: bot.health, food: bot.food } }); }
  catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[rods_now] not asked: ${String(err.message || err).slice(0, 900)}`); return null; }
  if (decision.stale) return null;
  if (decision.path?.at(-1) !== 'bank_now') return 'stay';
  await tree.bank_now.run();
  return 'banked';
}

// The bank under way, for the ladder: through the portal in the Nether, the
// chest's making or the store on the Overworld side. Ended (and said in the
// record) when there is nothing left to bank, the walk out has run past
// OUT_MS or is closed, or the store failed twice. -> stage or null
function bankStage(bot, goal, dim, now = Date.now()) {
  const b = pending(goal);
  if (!b) return null;
  if (!carriedKept(bot).some(k => k.item === 'blaze_rod' || k.item === 'blaze_powder')) { end(goal, 'no rods carried now (a death, or used)'); return null; }
  if (isSetAside(goal, 'rung', 'bank_rods', now)) { end(goal, `set aside: ${require('./progress').attemptsFor(goal).why('rung', 'bank_rods') || 'failed'}`); return null; }
  if (dim === 'nether') {
    if (now - b.at > OUT_MS) { end(goal, 'the walk out ran past twenty minutes'); return null; }
    let closed = null; try { closed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { closed = null; }
    if (closed) { end(goal, `the way out closed: ${closed.says}`); return null; }
    return { phase: 'bank_rods', action: 'return_overworld', rods: rs().rodsEquivalent(bot) };
  }
  if (dim !== 'overworld') return null;
  if ((b.fails || 0) >= FAILS) { end(goal, `the store failed ${b.fails} times: ${b.lastError || ''}`); return null; }
  if (isSetAside(goal, 'rod_bank', 'store', now)) return null;
  const near = bot.entity ? rs().nearStash(bot, goal) : null;
  if (!near && !rs().countOf(bot, 'chest') && !rs().chestMaking(bot)) return { phase: 'bank_rods', action: 'acquire', item: 'chest', count: 1 };
  return { phase: 'bank_rods', action: 'bank_rods' };
}

// The store on the Overworld side: the known chest within twelve, or a
// chest set down in reach. -> true when stored.
async function bank(bot, task, goal, save, actions = {}) {
  const b = pending(goal);
  if (!b || where(bot) !== 'overworld') return false;
  const what = carriedKept(bot), rods = rs().rodsEquivalent(bot);
  const near = rs().nearStash(bot, goal);
  let offer;
  if (near) offer = { existing: near.s, what, rods, steps: Math.max(0, Math.round(near.d - 3)) };
  else {
    const site = rs().chestCell(bot);
    const making = rs().chestMaking(bot);
    if (!site || !making) {
      b.fails = (b.fails || 0) + 1; b.lastError = !site ? 'no cell for a chest in reach' : 'no chest and no wood for one';
      setAside(goal, 'rod_bank', 'store', b.lastError, 60000); save?.();
      return false;
    }
    offer = { site, making, what, rods };
  }
  const stored = await rs().stashRods(bot, task, goal, save, actions, offer, { step: 'bank_rods', rest: ['rod_bank', 'store'],
    chat: (list, place) => `Banked ${list} in a chest at ${place}. Back to the Nether for the rest.` });
  if (stored) { b.doneAt = Date.now(); b.chestAt = offer.existing ? offer.existing.position : P(offer.site.cell); save?.(); return true; }
  b.fails = (b.fails || 0) + 1; b.lastError = goal.rodStashFailed?.why || 'not stored'; save?.();
  return false;
}

// On the Overworld side with banked rods: taken out once the rods carried
// and banked together are what the goal wants (the eyes are made from rods
// carried). -> the take-out stage (rod-stash.js collectStage) or null
function collectHere(bot, goal) {
  if (where(bot) !== 'overworld' || !banks(goal).length) return null;
  const inBank = { blaze_rod: 0, blaze_powder: 0, ender_eye: 0 };
  for (const s of banks(goal)) for (const k of Object.keys(inBank)) inBank[k] += s.contents?.[k] || 0;
  const en = require('./eye-need');
  const eyes = rs().countOf(bot, 'ender_eye') + inBank.ender_eye;
  const wanted = en.rodsFor(en.eyeTarget(goal) - eyes, rs().countOf(bot, 'blaze_powder') + inBank.blaze_powder);
  if (rs().countOf(bot, 'blaze_rod') + inBank.blaze_rod < wanted) return null;
  return rs().collectStage(bot, goal);
}

module.exports = { OUT_MS, askBank, bankOnArrival, bankOffer, offerSays, option, bankStage, bank, collectHere, pending, chestThere };
