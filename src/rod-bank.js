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
const { setAside, isSetAside, attemptsFor } = require('./progress');

// The Nether leg held at most this long (the walk out measured 17 to 30
// blocks a minute, game-progress.js NETHER_TRIPS): past it the bank is
// ended, said, and the hunt goes on.
// The walk out is given up when it has come no nearer its portal for twenty
// minutes (OUT_MS, by the distance left: a gain of eight blocks counts), or
// has run an hour in all. It was twenty minutes flat: 25592
// (mid-242-dc-nether-1, 2026-10-02 13:43 to 14:03Z) tunnelled 300 blocks of
// its way out with a rod, was ended at the twentieth minute 236 blocks from
// its portal, and turned to walk back to the fortress (note 888).
const OUT_MS = 20 * 60000, OUT_MAX_MS = 60 * 60000, OUT_GAIN = 8;
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

// The tunnel home (work.js portal_way tunnel_home) is open unless it was set aside for making no ground.
const tunnelOpen = (goal, now = Date.now()) => !isSetAside(goal, 'tunnel_home', 'nether', now);

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
// Survival, a rod or more carried (powder a half each) and rods still
// wanted, the walk to the portal open and its distance known, not resting
// after a failure and not already under way.
// From the first rod (note 874): a stash wants two (rod-stash.js ROD_MIN, a
// chest's worth), but the way out is a rod kept whatever its count, and on
// 2026-10-02 most lives that got a rod got one and died with it, never asked.
const BANK_MIN = 1;
function bankOffer(bot, goal, { now = Date.now() } = {}) {
  if (!bot?.entity || where(bot) !== 'nether' || bot.game?.gameMode !== 'survival') return null;
  const rods = rs().rodsEquivalent(bot);
  if (rods < BANK_MIN || pending(goal) || isSetAside(goal, 'rod_bank', 'out', now)) return null;
  let n = null; try { n = require('./eye-need').need(bot, goal); } catch (_) { n = null; }
  if (!n) return null;
  // Every rod wanted had, with pearls still wanted (note 1021): the rods
  // carried are asked about still. The offer ended with the last rod, the
  // ladder went on to the pearls, and 25590 (mid-242-sc-fortress-9,
  // 2026-10-03 08:35 to 08:47Z), five rods in a chest and five in its pack,
  // none still needed, searched for a warped forest past its fortress's
  // blazes for twelve minutes, alight five times, and was asked nothing.
  const complete = !n.rodsLeft;
  if (complete && !(n.pearlsLeft > 0)) return null;
  let closed = null; try { closed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { closed = null; }
  if (closed && !tunnelOpen(goal, now)) return null;
  const gp = require('./game-progress');
  const d = gp.portalDistance(bot, goal);
  if (d == null) return null;
  const pace = gp.netherPaceSays(bot, d);
  const chest = chestThere(bot, goal);
  return { rods, wanted: n.rodsWanted, left: n.rodsLeft, complete, pearlsLeft: n.pearlsLeft, inChest: n.stashed?.rods || 0, what: carriedKept(bot), d, seconds: Math.round(pace.seconds), paceSays: pace.says, chest };
}

// The option's words: what goes out and where, the walk and its record, the
// round trip, what it keeps, and what staying with them has come to.
function offerSays(offer) {
  const list = offer.what.map(w => plural(w.count, w.item.replaceAll('_', ' ')));
  const what = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  const walk = offer.paceSays ? offer.paceSays.trim() : `About ${Math.max(1, offer.seconds)} seconds at a walk.`;
  const minutes = Math.max(1, Math.round((2 * offer.seconds + (offer.chest.seconds || 0)) / 60));
  let staying = ''; try { staying = ` Staying with them: ${require('./rod-risk').recordSays(offer.rods)}`; } catch (_) { staying = ''; }
  if (offer.complete) return `Take the rods out: every rod wanted is had (${offer.rods} carried${offer.inChest ? `, ${offer.inChest} in the bot's chest in the Nether, counted as held and taken out on the way out` : ''}, ${offer.wanted} wanted), and ${plural(offer.pearlsLeft, 'ender pearl')} ${offer.pearlsLeft === 1 ? 'is' : 'are'} still wanted. Walk back to the portal ${offer.d} blocks off with the ${what}, go through the portal and put them in ${offer.chest.says}; the pearls are hunted after, from either side, with no rod in the pack. ${walk} The walk out carries them, and a death on it drops them as one here does; once in the chest they are kept through any death after, counted as held, and taken out when the pearls are had too.${staying}`;
  return `Bank the rods got so far: walk back to the portal ${offer.d} blocks off with the ${what}, go through the portal, put them in ${offer.chest.says}, and come back through for the ${plural(offer.left, 'rod')} still needed. ${walk} There and back is about ${minutes} minute${minutes === 1 ? '' : 's'}${offer.chest.how === 'tree' ? ' and the time the wood takes on the Overworld side' : ''}, no rod meanwhile. The walk out carries them, and a death on it drops them as one here does; once in the chest they are kept through any death after, counted as held, and taken out once the rods carried and banked together are what the goal wants, so a death after loses only the rods got since.${staying}`;
}

// The option as a tree entry: taken, the intention is kept (bankStage) and
// the walk begins at once where the caller can walk it.
function option(bot, task, goal, save, actions, offer) {
  return { description: offerSays(offer), trip: 'the portal', secs: 2 * offer.seconds,
    run: async () => {
      goal.rodBank = { at: Date.now(), rods: offer.rods, from: P(bot.entity.position), chest: offer.chest.how };
      // Chosen now: a set-aside of the stage from before (a step for the
      // wrong dimension met on the last walk out, note 885) is not its
      // answer. 25594 chose bank_now at 0.83 with four rods at 13:58:17Z, the
      // set-aside of 13:53Z still standing; the bank ended the moment it
      // began and the bot went on into the fortress (note 887).
      require('./progress').attemptsFor(goal).clear('rung', 'bank_rods');
      save?.();
      bot.chat?.(`Taking the ${plural(offer.rods, 'blaze rod')} out to a chest past the portal, ${offer.complete ? 'every rod I need is had with them: the pearls after' : 'then back for the rest'}.`);
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
function bankOnArrival(bot, goal, dim, now = Date.now()) {
  if (dim !== 'overworld' || !bot?.entity || bot.game?.gameMode !== 'survival' || pending(goal)) return false;
  // Through this stay in the Overworld (game-progress.js here), not only its
  // first minutes (note 873): rods carried out before this rule, or past a
  // bank set aside and since run out, would otherwise go back into the Nether
  // in the pack. A stay the bot began with a play of this kind already made
  // (the fixture of a stage test, a world joined in the Overworld) has no
  // arrival and is left alone.
  const here = goal?.gameProgress?.here;
  if (!(here?.dimension === 'overworld' && here.at)) return false;
  const rods = rs().rodsEquivalent(bot);
  // A set-aside of the bank's stage from before this arrival was about the
  // walk out (a stall on the way, Jev's rung answer there), and the walk is
  // done: cleared, it does not stop the store. 25592 (2026-10-02 14:36Z)
  // came out with its rod after eight minutes beside a portal gone out,
  // where the stall's question had set the stage aside, and went after an
  // iron pickaxe with the rod in its pack (note 897). One made on this side
  // (the store's own failure) stands.
  const aside = attemptsFor(goal).of('rung', now).bank_rods;
  if (aside && aside.at < here.at) attemptsFor(goal).clear('rung', 'bank_rods');
  if (!(rods >= 1) || isSetAside(goal, 'rod_bank', 'arrival', now) || isSetAside(goal, 'rung', 'bank_rods', now)) return false;
  let n = null; try { n = require('./eye-need').need(bot, goal); } catch (_) { n = null; }
  // Every rod had and pearls still wanted (note 1050): banked on coming out
  // all the same, the pearls hunted with none in the pack, and taken out
  // when the pearls are had too (collectHere). The ladder walks the rods
  // out when the Nether's pearls rest, and they stayed in the pack through
  // the Overworld's hunt and the next crossing.
  if (!n || (!n.rodsLeft && !(n.pearlsLeft > 0))) return false;
  goal.rodBank = { at: now, rods, from: P(bot.entity.position), chest: chestThere(bot, goal).how, onArrival: true };
  setAside(goal, 'rod_bank', 'arrival', 'banked on coming out with rods', 30 * 60000);
  bot.chat?.(`Out with ${plural(rods, 'blaze rod')}: into a chest here first, ${n.rodsLeft ? `${n.rodsLeft} more to get` : `${plural(n.pearlsLeft, 'pearl')} still to get`}.`);
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
// The bank walks themselves (scripts/rod-bank-walks.js, note 955): what each
// walk begun with rods came to, said on both answers. The walk's own price
// had only 2026-09-28's walks back to a portal (22 of 181 came out), from
// before the bank; on 2026-10-02 rods_now was answered bank_now 61 times and
// stay_for_more none.
// The day after (note 1038; scripts/rod-bank-walks.js 2026-10-03): 30 walks
// to 09:53Z, 20 banked, 4 died, where the day before's 47 came to 27 and 13.
const BANK_WALKS = Object.freeze({ day: '2026-10-03 (00:25Z to 09:53Z)', walks: 30, banked: 20, died: 4, other: 4, open: 2, before: 'the day before, 47 walks: 27 banked (57%), 13 died (28%)' });
const bankWalksSays = () => `On ${BANK_WALKS.day}, ${BANK_WALKS.walks} bank walks were begun with rods: ${BANK_WALKS.banked} put them in a chest (${Math.round(BANK_WALKS.banked / BANK_WALKS.walks * 100)}%), ${BANK_WALKS.died} died within the hour it was begun (${Math.round(BANK_WALKS.died / BANK_WALKS.walks * 100)}%), ${BANK_WALKS.other} ended another way, ${BANK_WALKS.open} were still under way${BANK_WALKS.before ? ` (${BANK_WALKS.before})` : ''}.`;
// The last bank walk, where it ended without the chest (note 983): said on
// every answer of the next asking. 25591 (mid-242-nc-fortress-7, 2026-10-03)
// set its walk aside at 05:14:41Z after 31 minutes, the portal 137 blocks
// off and the nearest it had come 102, and at 05:18:04Z answered bank_now at
// 0.86 to a question that said nothing of it.
function lastWalkSays(goal, now = Date.now()) {
  const b = goal?.rodBank;
  if (!b?.endedAt || b.doneAt || now - b.endedAt > 60 * 60000) return '';
  const mins = ms => plural(Math.max(1, Math.round(ms / 60000)), 'minute');
  return ` The last bank walk, begun ${mins(now - b.at)} ago with ${plural(b.rods, 'rod')} from ${at(b.from)}, ended ${mins(now - b.endedAt)} ago after ${mins(b.endedAt - b.at)} without reaching the chest: ${String(b.why || 'ended').replace(/[.!?]+$/, '')}.`;
}
const ASK_AGAIN_MS = 10 * 60000, OWN_CHEST_REACH = 96;
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
  // The chest here (note 931): the rods kept in the Nether, the hunt on.
  let keep = null; try { keep = rs().keepOption(bot, task, goal, save, actions, { thenSays: offer.complete ? 'Then the pearls are hunted with nothing in the pack to lose, and the chest is emptied on the way out.' : `Then the hunt goes on here for the ${plural(offer.left, 'rod')} still needed with nothing in the pack to lose, and the walk out is made once, with them all.` }); } catch (_) { keep = null; }
  const last = lastWalkSays(goal, now);
  // No chest and no wood for one: the wood fetched first where stems are
  // known, then the chest here (note 997). On 2026-10-03 (04:00 to 06:40Z)
  // keep_here was taken at all 18 askings it was offered at; at the other
  // 14 the bot carried no chest and under eight planks, and the walk to the
  // portal was taken at 12 of them, 161 to 519 blocks off.
  let woodFirst = null;
  if (!keep && !rs().chestMaking(bot)) {
    try {
      const nw = require('./nether-wood');
      bot._woodAlso = { planks: 8, for: 'a chest to keep the rods in', until: Date.now() + 15 * 60000 };
      const fetch = await nw.fetchStemsOffer(bot, task, goal);
      if (fetch?.place) {
        const said = fetch.describe ? await fetch.describe() : fetch.description;
        woodFirst = { description: `Get the wood for a chest first, then keep the rods here in it: ${said} With the wood a chest is made (eight planks, two stems' worth) and the ${plural(offer.rods, 'rod')} put in it where the hunt is: no walk to the portal ${offer.d} blocks off, ${offer.complete ? 'the pearls hunted' : `the hunt going on for the ${plural(offer.left, 'rod')} still needed`} with nothing in the pack to lose, and the walk out made once, with them all.`,
          run: async () => {
            const acquireStep = actions?.acquireStep || require('./work').acquireStep;
            try { await nw.fetchStems(bot, task, goal, save, { acquireStep }); }
            catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[rods_now] the wood for a chest was not got: ${String(err.message || err).slice(0, 200)}`); }
            finally { delete bot._woodAlso; }
            const kept = rs().chestMaking(bot) ? rs().keepOption(bot, task, goal, save, actions) : null;
            if (!kept) return false;
            return kept.run();
          } };
      }
    } catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; woodFirst = null; }
    if (!woodFirst) delete bot._woodAlso;
  }
  // The bot's own chest farther off (note 1021): where none is within the
  // few blocks keep_here walks and none can be made, the chest it left its
  // rods in is a walk too, and nearer than the portal. 25590's held five
  // rods 45 blocks from where it stood with five more in its pack, no chest
  // carried and no wood, its portal 180 off.
  let ownChest = null;
  if (!keep) {
    try {
      const { Vec3 } = require('vec3'), here = bot.entity.position;
      const far = rs().stashes(goal).filter(c => c.dimension === rs().dimOf(bot))
        .map(c => ({ c, d: Math.round(here.distanceTo(new Vec3(c.position.x + 0.5, c.position.y, c.position.z + 0.5))) })).filter(x => x.d <= OWN_CHEST_REACH && x.d < offer.d).sort((x, y) => x.d - y.d)[0];
      if (far) {
        const pace = require('./game-progress').netherPaceSays(bot, far.d), p = far.c.position;
        const holds = rs().listed(far.c.contents || {});
        ownChest = { description: `Walk ${far.d} blocks to the bot's own chest at (${p.x}, ${p.y}, ${p.z})${holds ? `, which holds ${holds}` : ''}, and put the ${plural(offer.rods, 'rod')} carried in with them: ${String(pace.says || '').trim() || `about ${Math.round(pace.seconds)} seconds at a walk`} The portal is ${offer.d} blocks off. The walk carries them, and a death on it drops them; in the chest they are kept through any death after, counted as held, and taken out on the way out. ${offer.complete ? 'Then the pearls are hunted with nothing in the pack to lose.' : `Then the hunt goes on for the ${plural(offer.left, 'rod')} still needed with nothing in the pack to lose.`}`,
          trip: 'the chest', secs: Math.round(pace.seconds),
          run: async () => {
            const { goals } = require('mineflayer-pathfinder');
            const acts = { ...actions, navigate: actions?.navigate || require('./skills').navigate };
            goal.step = { action: 'stash_rods', at: { ...p }, walk: far.d }; save?.();
            try { await acts.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 180000, stallMs: 8000, passing: true }); }
            catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[rods_now] the walk to the bot's chest ended: ${String(err.message || err).slice(0, 200)}`); return false; }
            return rs().stashRods(bot, task, goal, save, acts, { existing: far.c, what: carriedKept(bot) });
          } };
      }
    } catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; ownChest = null; }
  }
  const tree = {
    bank_now: { description: `${opt.description}${last} ${bankWalksSays()} ${today} The way out can be the tunnel dug straight at the portal (asked on the way where the walk fails): in the rock nothing sees or pushes the bot.`, trip: 'the portal', run: opt.run },
    ...(keep ? { keep_here: { description: keep.description, run: keep.run } } : {}),
    ...(woodFirst ? { wood_for_chest: woodFirst } : {}),
    ...(ownChest ? { own_chest: ownChest } : {}),
    stay_for_more: { description: `${offer.complete ? `Go on to the pearls (${offer.pearlsLeft} still wanted)` : `Stay and hunt on for the ${plural(offer.left, 'rod')} still needed`} with the ${plural(offer.rods, 'rod')} in the pack: no walk out now, and every rod carried is lost with a death here.${last} ${staying} ${today} ${bankWalksSays()} Asked again when another rod is carried, or in ten minutes.` },
  };
  let decision;
  try { decision = await require('./decisions').decide('rods_now', { client, bot, task, goal, save, tree, state: { rodsCarried: offer.rods, rodsWanted: offer.wanted, rodsStillNeeded: offer.left, portalBlocks: offer.d, health: bot.health, food: bot.food } }); }
  catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[rods_now] not asked: ${String(err.message || err).slice(0, 900)}`); return null; }
  if (decision.stale) return null;
  if (decision.path?.at(-1) === 'keep_here') { await tree.keep_here.run(); return 'kept'; }
  if (decision.path?.at(-1) === 'own_chest') { delete bot._woodAlso; const kept = await tree.own_chest.run(); return kept ? 'kept' : 'stay'; }
  if (decision.path?.at(-1) === 'wood_for_chest') { const kept = await tree.wood_for_chest.run(); return kept ? 'kept' : 'stay'; }
  delete bot._woodAlso;
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
  if (!carriedKept(bot).some(k => k.item === 'blaze_rod' || k.item === 'blaze_powder' || k.item === 'ender_eye')) { end(goal, 'no rods or eyes carried now (a death, or used)'); return null; }
  // Set aside in the Nether (a step on the way met something else's
  // failure, note 885): the walk waits the set-aside out and goes on; on the
  // Overworld side it is the store's own failure, and the bank ends.
  if (isSetAside(goal, 'rung', 'bank_rods', now)) {
    if (dim === 'nether' && now - b.at <= OUT_MAX_MS) return null;
    end(goal, `set aside: ${require('./progress').attemptsFor(goal).why('rung', 'bank_rods') || 'failed'}`); return null;
  }
  if (dim === 'nether') {
    let d = null; try { d = require('./game-progress').portalDistance(bot, goal); } catch (_) { d = null; }
    if (Number.isFinite(d) && (!Number.isFinite(b.best) || d <= b.best - OUT_GAIN)) { b.best = d; b.bestAt = now; }
    if (now - (b.bestAt || b.at) > OUT_MS) { end(goal, `the walk out came no nearer its portal for twenty minutes${Number.isFinite(b.best) ? ` (${b.best} blocks off at its nearest)` : ''}`); return null; }
    if (now - b.at > OUT_MAX_MS) { end(goal, 'the walk out ran past an hour'); return null; }
    // The walks' rests (a leg, a crossing, the staircase) do not close the
    // tunnel dug straight at the portal (portal_way's tunnel_home, note
    // 860): with it open the walk out goes on and the way is asked there;
    // with it resting too the bank waits, and ends only by its own clock.
    // 25590 (2026-10-02 14:20Z), three rods carried, had its bank ended "the
    // way out closed ... the staircase toward it rests", the tunnel not
    // tried (note 892).
    let closed = null; try { closed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { closed = null; }
    if (closed && !tunnelOpen(goal, now)) return null;
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
  // Stored: the next coming out with rods banks again at once. The half
  // hour's rest (bankOnArrival) is for a bank that failed; kept after one
  // that stored, 25597 came out again fourteen minutes later with two rods
  // and nothing was begun (note 881).
  if (stored) { b.doneAt = Date.now(); b.chestAt = offer.existing ? offer.existing.position : P(offer.site.cell); require('./progress').attemptsFor(goal).clear('rod_bank', 'arrival'); save?.(); return true; }
  b.fails = (b.fails || 0) + 1; b.lastError = goal.rodStashFailed?.why || 'not stored'; save?.();
  return false;
}

// On the Overworld side with banked rods: taken out once the rods carried
// and banked together are what the goal wants (the eyes are made from rods
// carried). -> the take-out stage (rod-stash.js collectStage) or null
function collectHere(bot, goal) {
  if (where(bot) !== 'overworld' || !banks(goal).length) return null;
  // Eyes put away for an errand before the End stay put while the errand is in hand (eye-bank.js, note 1193).
  if (require('./eye-bank').held(goal)) return null;
  const inBank = { blaze_rod: 0, blaze_powder: 0, ender_eye: 0 };
  for (const s of banks(goal)) for (const k of Object.keys(inBank)) inBank[k] += s.contents?.[k] || 0;
  const en = require('./eye-need');
  const eyes = rs().countOf(bot, 'ender_eye') + inBank.ender_eye;
  const wanted = en.rodsFor(en.eyeTarget(goal) - eyes, rs().countOf(bot, 'blaze_powder') + inBank.blaze_powder);
  if (rs().countOf(bot, 'blaze_rod') + inBank.blaze_rod < wanted) return null;
  // Not before the pearls are had too (note 1021): an eye wants both, and
  // rods taken out with pearls still to hunt are rods in the pack again.
  let pearlsLeft = 0; try { pearlsLeft = en.need(bot, goal).pearlsLeft; } catch (_) { pearlsLeft = 0; }
  if (pearlsLeft > 0) return null;
  return rs().collectStage(bot, goal);
}

module.exports = { lastWalkSays, tunnelOpen, OUT_MS, OUT_MAX_MS, askBank, bankOnArrival, bankOffer, offerSays, option, bankStage, bank, collectHere, pending, chestThere };
