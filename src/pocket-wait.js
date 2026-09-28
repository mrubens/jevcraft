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
  const nothingComes = noDay && starving
    ? (spawner ? ` Neither daylight nor health comes to this wait, and the mobs outside do not move off: the ${spawnerKind} ${spawner.distance} blocks off makes more of them while the bot is within its 16 blocks.` : ' Neither daylight nor health comes to this wait: only the mobs outside moving off would change it.') : '';
  if (nothingComes && spawner) facts.waitingFor = `nothing: no daylight, no health without food, and the ${spawnerKind} ${spawner.distance} blocks off makes more while the bot is within 16`;
  // The rung, and how long since it last got anywhere.
  const { rungOf, rungSays } = require('./tried');
  const r = goal?.tried?.rung, rung = rungOf(goal);
  const idle = r && r.rung === rung && r.bestAt ? now - r.bestAt : 0;
  const rungLine = idle >= 5 * 60000 ? ` The ${rungSays(rung)} has had no new best for ${minutesSays(idle)}${r.lastBest ? ` (the last: ${r.lastBest})` : ''}.` : '';
  if (rungLine) facts.rung = rungLine.trim();
  return {
    facts, heldOff, minutes,
    stay: ` In this pocket ${minutes} so far.${againstSays}${mobsSays}${countSays}${daySays}${healSays}${foodSays}${nothingComes}${rungLine}`,
    leave: `${againstSays ? ` ${againstSays.trim().replace(/^It was/, 'The pocket was')}` : ''}${mobsSays}${countSays}`,
    claim: { inPocketMinutes: facts.minutes, ...(facts.sealedAgainst ? { sealedAgainst: facts.sealedAgainst } : {}) },
  };
}

module.exports = { watchPocket, leftPocket, pocketWaitSays, mobWait, HELD_MS, SEALING };
