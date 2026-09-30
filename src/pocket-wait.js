'use strict';
// How the wait in a sealed pocket has gone, said with staying and leaving.
// mid-242-ac-nether-2-fortress-3 (port 25585, note 584) dug down twice in
// ten minutes against a ghast in sight 25 and 33 blocks off, and sat nine
// minutes in the first pocket and eleven and more in the second, pocket_next
// answered stay twenty-one times. The ghast was gone within a minute of each;
// what was left outside was a piglin or two heard 13 to 15 blocks off through
// the rock, at the same distance for five minutes on end, never in sight, and
// a blaze 24 blocks off, the thing the rung was for. Stay was said as
// "Stay in the pocket while a piglin 13 blocks off ... is outside", with no
// clock: by night a stay says the minutes to dawn, by day in the Overworld the
// daylight going by, and in the Nether nothing, so a stay there read as free
// and without end, and the leave was priced as fighting every mob heard.
// Now the wait says what it has been: how long the bot has been in this
// pocket, what it was sealed against and where that is now, how each mob
// outside has moved while it waited (come nearer, or held off out of sight),
// that no daylight comes where there is none to wait for, that a stay at full
// health heals nothing, and how long the rung has gone without a new best.

// A mob has held off once it has been about this long with the bot waited on.
const HELD_MS = 60000;
// Nearer than it began by more than this is coming.
const NEARER = 2;
// Forgotten when not heard again within this.
const GONE_MS = 60000;
// What a pocket was sealed against is gone past this, out of sight.
const GONE_BEYOND = 16;
// The stances that shut the bot in where it stands.
const SEALING = new Set(['seal', 'dig_down']);

const name = n => String(n || '').replaceAll('_', ' ');
const round = d => Math.round(d);
const minutesSays = ms => {
  const m = ms / 60000;
  if (m < 1) { const s = Math.max(1, Math.round(ms / 1000)); return `${s} second${s === 1 ? '' : 's'}`; }
  const r = m < 10 ? Math.round(m * 2) / 2 : Math.round(m);
  return `${r} minute${r === 1 ? '' : 's'}`;
};

// Each step in a sealed pocket: the pocket's clock, what it was sealed
// against (the stance that made it, chosen within two minutes), and the mobs
// about, each with where it began, its nearest and farthest, and whether it
// has had the bot in sight.
// The clock runs from the seal, not from the first look: mid-242-ab-nether-
// 3-fortress-1 (note 589) sealed in at 05:09 and was told "13 minutes so far"
// at 05:34, the bot restarted at 05:22 (the record began then, a look more
// than half a minute after the last) and the blaze it had sealed against
// forgotten with it. The seal pass keeps where and when it sealed
// (state.sealing), and every step out of a pocket when it was last seen out
// (pocketOutAt): a pocket sealed since the bot was last seen out is the same
// wait, across a restart or a gap in the looks, and a new one begins only
// when the bot has been out of it or it has been sealed again.
function watchPocket(state, refuge, about, now = Date.now()) {
  const o = refuge.origin, key = `${o.x},${o.y},${o.z}`;
  let w = state.pocketWait;
  const s = state.sealing, sealedAt = s?.origin && `${s.origin.x},${s.origin.y},${s.origin.z}` === key && s.at <= now ? s.at : null;
  const outAt = state.pocketOutAt || 0;
  // Sealed since the bot was last seen out: the wait began at the seal.
  const start = sealedAt && sealedAt > outAt ? sealedAt : null;
  // The stance chosen for this seal: within two minutes before it.
  const againstAt = since => {
    const st = state.stance;
    return st && SEALING.has(st.choice) && st.at <= since + 30000 && since - st.at < 120000
      ? { choice: st.choice, at: st.at, ids: st.ids || [], mobs: st.mobs || [].concat(st.kinds || []).map(n => ({ name: n })) } : null;
  };
  if (!w || w.key !== key || outAt > w.since || (sealedAt && sealedAt > w.since)) {
    const since = start ?? now;
    w = state.pocketWait = { key, since, against: againstAt(since), mobs: {} };
  } else if (start && start < w.since) {
    // A record begun after the seal (by a look after a gap, or before this
    // was kept): moved back to it.
    w.since = start; w.against ||= againstAt(start);
  }
  w.seenAt = now;
  // How many were about at the first look, for how that has gone.
  w.firstLook ||= { at: now, count: about.length };
  for (const t of about) {
    const id = t.entity?.id;
    if (id === undefined) continue;
    const d = Math.round(t.distance * 10) / 10;
    const m = w.mobs[id] ||= { name: t.entity.name, since: now, first: d, min: d, max: d, seen: false };
    m.min = Math.min(m.min, d); m.max = Math.max(m.max, d); m.last = d; m.lastAt = now;
    if (t.visible) m.seen = true;
  }
  for (const [id, m] of Object.entries(w.mobs)) if (now - (m.lastAt ?? m.since) > GONE_MS) delete w.mobs[id];
  return w;
}

// Out of any pocket: its record goes with it, and when the bot was last seen
// out is kept (a pocket sealed after it is a new wait).
function leftPocket(state, now = Date.now()) { delete state.pocketWait; state.pocketOutAt = now; }

// How one mob outside has gone while the bot waited, or null when it has not
// been about a minute of it. One come nearer is said with how near and how
// far it has been over the wait: the blazes outside mid-242-ab-nether-3-
// fortress-1's pocket were said as "come from 23 to 8 blocks off" and had
// been from 4 to 24 and back, drifting about their fortress (note 589).
// Whether it has had the bot in sight is said either way for one come
// nearer: a mob takes the bot as its target only once it has seen it.
function mobWait(w, t, now) {
  const m = w?.mobs?.[t.entity?.id];
  if (!m || now - m.since < HELD_MS) return null;
  const nearer = t.distance < m.first - NEARER;
  const seen = m.seen || !!t.visible;
  const span = round(m.min) < round(t.distance) - NEARER || round(m.max) > round(m.first) + NEARER ? `, from ${round(m.min)} to ${round(m.max)} over it` : '';
  return { m, id: t.entity?.id, nearer, seen,
    says: `the ${name(t.entity.name)} ${round(t.distance)} blocks off, about for ${minutesSays(now - m.since)} of the wait, ${nearer ? `come from ${round(m.first)} to ${round(t.distance)} blocks off${span}` : `${round(m.min)}${round(m.max) > round(m.min) ? ` to ${round(m.max)}` : ''} blocks off all that time, never nearer`}${seen ? ', and it has had the bot in sight' : nearer ? ', never with the bot in sight' : ''}` };
}

// What the wait has been, said: `outside` is the mobs within sixteen that the
// options name, `near` the threats list the pocket read (for the one it was
// sealed against). Returns the facts for the state and the sentences for
// stay and leave; `heldOff` is true when every mob outside has held off out
// of sight for a minute or more of the wait.
function pocketWaitSays(bot, state, goal, { outside = [], near = [], night = false, noFood = false, spawner = null, now = Date.now() } = {}) {
  const w = state.pocketWait;
  if (!w) return null;
  const minutes = minutesSays(now - w.since);
  const facts = { minutes: Math.round((now - w.since) / 6000) / 10 };
  // What it was sealed against, and where that is now.
  let againstSays = '', againstNow = null;
  if (w.against?.mobs?.length) {
    const was = w.against.mobs.slice(0, 3).map(m => `${m.name ? `a ${name(m.name)}` : 'a mob'}${m.visible ? ' in sight' : ''}${m.distance !== undefined ? ` ${round(m.distance)} blocks off` : ''}`);
    const now_ = (w.against.ids || []).map(id => {
      const e = bot.entities?.[id];
      if (!e || e.isValid === false || !e.position) return null;
      const t = near.find(x => x.entity?.id === id);
      const d = t ? t.distance : e.position.distanceTo(bot.entity.position);
      return { name: e.name, distance: d, visible: !!t?.visible };
    }).filter(Boolean);
    const kinds = [...new Set(w.against.mobs.map(m => name(m.name)).filter(Boolean))];
    againstNow = now_.length ? now_.map(m => `the ${name(m.name)} ${round(m.distance)} blocks off${m.visible ? ', in sight' : ', out of sight'}`).join(', ') : null;
    const whatNow = againstNow ? `now ${againstNow}` : `${kinds.length === 1 && w.against.mobs.length === 1 ? `that ${kinds[0]} is` : 'none of them is'} not about now`;
    againstSays = ` It was sealed when ${name(w.against.choice)} was chosen against ${was.join(', ')}; ${whatNow}.`;
    facts.sealedAgainst = `${was.join(', ')} (${name(w.against.choice)}); ${whatNow}`;
  }
  // The mobs outside, as they have gone while the bot waited. Held off is
  // every one of them about a minute or more of the wait, none with the bot
  // in sight in it, and none the mob the pocket was sealed against (which
  // may be after the bot still). One come nearer unseen counts: a mob takes
  // the bot as its target only on sight (a warden aside), so its coming is
  // not coming at the bot. mid-242-ab-nether-3-fortress-1's two blazes,
  // drifting 4 to 24 blocks off unseen, priced "out among them" at 27.5
  // damage, kept it in its pocket twenty-six minutes (note 589).
  const waits = outside.map(t => mobWait(w, t, now)).filter(Boolean);
  const againstIds = new Set(w.against?.ids || []);
  const heldOff = outside.length > 0 && waits.length === outside.length && waits.every(x => !x.seen && !againstIds.has(x.id)) && !outside.some(t => t.entity?.name === 'warden');
  const anyNearer = waits.some(x => x.nearer);
  const mobsSays = waits.length ? ` Of the mobs outside: ${waits.map(x => x.says).join('; ')}${heldOff ? (anyNearer ? '. None of them has had the bot in sight while it waited, and a mob takes the bot as its target only once it has seen it' : '. None of them has come nearer or had the bot in sight while it waited') : ''}.` : '';
  if (waits.length) facts.mobsOutside = waits.map(x => x.says);
  // No daylight to wait for.
  const dim = String(bot.game?.dimension || 'overworld');
  const noDay = !/overworld/.test(dim);
  const daySays = noDay ? ' No daylight comes here: nothing outside burns off or goes away with the hour, so a stay here ends only when the bot opens the pocket.' : '';
  if (noDay) facts.daylight = 'none here: a stay ends only when the bot opens the pocket';
  const hp = bot.health ?? 20;
  const healSays = !night && hp >= 20 ? ' Health is full: staying heals nothing.' : '';
  // Nothing to eat, hurt and under eighteen: the wait brings no health back
  // however long it runs (mid-242-ab-nether-3-fortress-1 ate its last
  // rotten flesh two minutes before it sealed in, note 589).
  const food = bot.food ?? 20;
  const starving = noFood && hp < 20 && food < 18;
  const foodSays = starving ? ` Nothing carried is food: hunger ${food} does not rise in here, so health does not come back in this pocket however long it waits.` : '';
  if (starving) facts.health = `${Math.round(hp * 10) / 10}, not coming back: nothing carried to eat and hunger ${food}`;
  // A trip for food already chosen (note 726): 25598 sealed at 7 health
  // with nothing to eat, chose return_for_food, and was sealed in again a
  // few seconds later with no word that the trip it had just begun was
  // sitting unwalked. Sealing here may still be the safer choice against a
  // real mob (this is said, not held), but it should never look free:
  // sitting in this pocket does not walk the trip, and each minute here is
  // a minute of it spent standing still.
  let tripSays = '';
  if (starving) {
    let held = null;
    try { const i = require('./intention').holding(bot, goal, now); if (i && /^(return_for_food|restock_food)$/.test(i.choice)) held = i; } catch (_) { held = null; }
    if (held) {
      tripSays = ` A trip for food (${name(held.choice)}) was already chosen ${minutesSays(now - held.at)} ago${held.target ? `, toward (${held.target.x}, ${held.target.y}, ${held.target.z})` : ''}: staying here does not walk it, and each minute sealed is a minute of it spent standing still.`;
      facts.foodTripHeld = `${name(held.choice)}, chosen ${minutesSays(now - held.at)} ago`;
    } else if (goal?.leaveNether?.reason === 'food') {
      const at = goal.leaveNether.at;
      tripSays = ` A trip back for food was already chosen${Number.isFinite(at) ? ` ${minutesSays(now - at)} ago` : ''}: staying here does not walk it.`;
      facts.foodTripHeld = 'a trip back for food, already chosen';
    }
  }
  // How many are about now against the first look: mid-242-ab-nether-3-
  // fortress-1 sealed in twelve blocks from a blaze spawner with five
  // blazes about, and twenty minutes on twenty and more mobs were within 24
  // blocks and nineteen blazes within their 48 (note 597); each mob was
  // said, the count never.
  const countNow = near.filter(t => t.distance <= 24).length;
  const fl = w.firstLook;
  const countSays = fl && now - fl.at >= HELD_MS && countNow !== fl.count
    ? ` Within 24 blocks of the pocket: ${fl.count} mob${fl.count === 1 ? '' : 's'} at the wait's first look ${minutesSays(now - fl.at)} ago, ${countNow} now.` : '';
  if (countSays) facts.mobsWithin24 = { firstLook: fl.count, now: countNow };
  // What a stay could wait for, where neither comes. By a spawner in reach
  // the mobs outside do not move off either: it makes more of them while
  // the bot is within its sixteen, and "only the mobs outside moving off
  // would change it" was said there as if they might (note 597).
  const spawnerKind = spawner ? `${spawner.mob ? `${name(spawner.mob)} ` : 'mob '}spawner` : '';
  // And what it was sealed against gone as well (not about, or more than
  // sixteen blocks off and out of sight): the wait waits for nothing, said
  // plainly. mid-242-dc-fortress-22 sat sealed at 12 health with nothing to
  // eat, the skeleton it sealed against 32 blocks off and then gone, and
  // chose stay three times, nothing changing in any (note 679).
  // Nor another of its kind in its place within sixteen: the blazes of a
  // fortress drift in and out, and one gone is not the kind gone.
  const sealedKinds = new Set(w.against?.mobs?.map(m => m.name).filter(Boolean) || []);
  const againstGone = !!w.against?.mobs?.length && !near.some(t => sealedKinds.has(t.entity?.name) && t.distance <= GONE_BEYOND) && !(w.against.ids || []).some(id => {
    const e = bot.entities?.[id];
    if (!e || e.isValid === false || !e.position) return false;
    const t = near.find(x => x.entity?.id === id);
    return (t ? t.distance : e.position.distanceTo(bot.entity.position)) <= GONE_BEYOND || !!t?.visible;
  });
  // Or within sixteen still, but out of sight for the whole wait (at least
  // a minute of it, HELD_MS, the same span held-off.js reads a mob as no
  // longer coming): a piglin that never closes and is never seen wastes the
  // wait the same as one that walked off past sixteen does. mid-242-sd's
  // 25590 sealed against one 15 blocks off, out of sight, for seven minutes
  // straight; it never crossed sixteen so againstGone never read it gone,
  // and stay went on being offered as if the piglin might yet reach the
  // door (note 723). Read from the pocket's own per-mob record (w.mobs),
  // not from `near`'s single look, so a mob out of sight now that was in
  // sight a moment ago still counts as about.
  const againstUnseen = !!w.against?.mobs?.length && !!(w.against.ids || []).length && (w.against.ids || []).every(id => {
    const m = w.mobs[id];
    return !!m && !m.seen && now - m.since >= HELD_MS;
  });
  const noGain = starving || (!night && hp >= 20);
  // Or nothing about at all: no mob within sixteen and none in sight, the
  // pocket's own record of what it was sealed against or not (note 698: in
  // the Nether, stays with nothing within twenty blocks and nothing to gain).
  const noneAbout = !near.some(t => t.distance <= GONE_BEYOND || t.visible);
  const waitsForNothing = noDay && noGain && (againstGone || againstUnseen || noneAbout) && !spawner;
  const goneKinds = [...new Set((w.against?.mobs || []).map(m => name(m.name)).filter(Boolean))];
  const goneSays = againstGone ? `the ${goneKinds.length === 1 ? goneKinds[0] : 'mobs'} it was sealed against ${goneKinds.length === 1 && w.against.mobs.length === 1 ? 'is' : 'are'} gone`
    : againstUnseen ? `the ${goneKinds.length === 1 ? goneKinds[0] : 'mobs'} it was sealed against ${goneKinds.length === 1 && w.against.mobs.length === 1 ? 'has' : 'have'} not been seen since the seal, ${minutesSays(now - w.since)} ago` : 'no mob is within 16 blocks or in sight';
  const nothingComes = waitsForNothing
    ? ` Nothing this wait could wait for is coming: ${goneSays}, no daylight comes here, and ${starving ? 'health does not come back without food' : 'health is full'}. Staying is standing idle.`
    : noDay && starving
      ? (spawner ? ` Neither daylight nor health comes to this wait, and the mobs outside do not move off: the ${spawnerKind} ${spawner.distance} blocks off makes more of them while the bot is within its 16 blocks.` : ` Neither daylight nor health comes to this wait: the bot goes out at ${Math.round(hp * 10) / 10} health whenever it goes, so a stay buys only the chance that the mobs outside move off${near.some(t => t.entity?.name === 'blaze') ? ', and blazes keep about the fortress they spawn in' : ''}, and each minute of it is a minute of the run.`) : '';
  if (nothingComes && spawner) facts.waitingFor = `nothing: no daylight, no health without food, and the ${spawnerKind} ${spawner.distance} blocks off makes more while the bot is within 16`;
  if (waitsForNothing) facts.waitingFor = `nothing: ${againstGone ? 'what it was sealed against is gone' : againstUnseen ? 'what it was sealed against has not been seen since the seal' : 'no mob within 16 or in sight'}, no daylight, and ${starving ? 'no health without food' : 'health full'}`;
  // The rung, and how long since it last got anywhere.
  const { rungOf, rungSays } = require('./tried');
  const r = goal?.tried?.rung, rung = rungOf(goal);
  const idle = r && r.rung === rung && r.bestAt ? now - r.bestAt : 0;
  const rungLine = idle >= 5 * 60000 ? ` The ${rungSays(rung)} has had no new best for ${minutesSays(idle)}${r.lastBest ? ` (the last: ${r.lastBest})` : ''}.` : '';
  if (rungLine) facts.rung = rungLine.trim();
  // Stays in this pocket that came to nothing (tried.js judges a wait by what
  // changed while it lasted), for the question that sends the turn here.
  const { about } = require('./tried');
  const p = bot.entity?.position;
  const stays = p ? about(goal, { q: 'pocket_next', method: 'stay', here: { x: p.x, y: p.y, z: p.z }, now }).filter(e => e.outcome === 'blocked' && e.at >= w.since).length : 0;
  if (waitsForNothing && stays) facts.staysForNothing = stays;
  // What a stay waits for (waits.js, note 698): with nothing coming, it is
  // not offered, and this is said in the facts instead.
  const waitFor = require('./waits');
  const stayWaits = waitsForNothing ? waitFor.event('the mobs outside to go', { comes: false, why: `${goneSays}, no daylight comes here, and ${starving ? 'health does not come back without food' : 'health is full'}` }) : null;
  return {
    facts, heldOff, minutes, waitsForNothing, stays, waits: stayWaits,
    stay: ` In this pocket ${minutes} so far.${againstSays}${mobsSays}${countSays}${daySays}${healSays}${foodSays}${tripSays}${nothingComes}${rungLine}`,
    leave: `${againstSays ? ` ${againstSays.trim().replace(/^It was/, 'The pocket was')}` : ''}${mobsSays}${countSays}`,
    claim: { inPocketMinutes: facts.minutes, ...(facts.sealedAgainst ? { sealedAgainst: facts.sealedAgainst } : {}), ...(waitsForNothing ? { waitingFor: facts.waitingFor, staysForNothing: stays } : {}) },
  };
}

module.exports = { watchPocket, leftPocket, pocketWaitSays, mobWait, HELD_MS, SEALING, GONE_BEYOND };
