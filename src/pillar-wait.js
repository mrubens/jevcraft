'use strict';
// How a hold on the bot's own pillar has gone, said with the pillar and the
// fight while the bot is up on it. Two trials of 2026-09-28 (note 590) held a
// pillar most of a quarter hour each: mid-208-k-nether-4-fortress-1 (25589),
// at 7.9 health with nothing to eat, over a hoglin four blocks off that
// stood there the whole eleven minutes, never nearer and never in the
// sword's reach; and mid-242-af (25598), at full health, over a piglin with
// a crossbow eight blocks off and three more out of sight twelve to fourteen
// off, twelve minutes with no health lost after its first minute and nothing
// struck. encounter_stance was asked every fifteen seconds (the stance's own
// clock) and the pillar was said each time as it is said at the foot: "Go two
// blocks straight up ... and fight from there ... the sword still reaches
// them", about 0 or 25 damage "in the next fifteen seconds". Nothing said how
// long it had been up there, that nothing had been struck, that the mob had
// neither come nor gone, or what the fight chosen from the top had come to.
// Now the hold says what it has been. Nothing is decided by it: the stances
// are Jev's as before.

// A mob has held off once it has been about this long in the hold.
const HELD_MS = 60000;
// Nearer than it began by more than this is coming.
const NEARER = 2;
// Forgotten when not seen or heard again within this.
const GONE_MS = 60000;
// Not looked at for this long: the bot was off the top, and a new hold.
const LEFT_MS = 60000;
// Holds from about here: within these blocks and minutes.
const HOLD_NEAR = 16, HOLDS_WINDOW_MS = 10 * 60000;

const name = n => String(n || '').replaceAll('_', ' ');
const round = d => Math.round(d);
const minutesSays = ms => {
  const m = ms / 60000;
  if (m < 1) { const s = Math.max(1, Math.round(ms / 1000)); return `${s} second${s === 1 ? '' : 's'}`; }
  const r = m < 10 ? Math.round(m * 2) / 2 : Math.round(m);
  return `${r} minute${r === 1 ? '' : 's'}`;
};
const times = n => n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
const keyOf = p => `${p.x},${p.y},${p.z},${p.at || 0}`;

// Each look while the bot is up on its pillar: the hold's clock, what it was
// chosen against (the pillar stance chosen within two minutes), the health
// lost up here, the swings and kills, and each mob about with where it began,
// its nearest and farthest, and whether it has had the bot in sight.
function watchPillar(state, pillar, about, bot, now = Date.now()) {
  if (!pillar) return null;
  const key = keyOf(pillar);
  let w = state.pillarWait;
  if (w && (w.key !== key || now - (w.seenAt ?? w.since) > LEFT_MS)) endPillarHold(state, w.key !== key ? 'another pillar' : 'left the top', w.seenAt ?? now);
  w = state.pillarWait;
  const hp = bot?.health ?? 20;
  if (!w) {
    const st = state.stance;
    const against = st && st.choice === 'pillar' && now - st.at < 120000
      ? { ids: st.ids || [], mobs: st.mobs || (st.kinds || []).map(n => ({ name: n })) } : null;
    w = state.pillarWait = { key, place: { x: pillar.x, y: pillar.y, z: pillar.z }, since: now, against, mobs: {}, health: hp, lastHealth: hp, lost: 0, swings: 0, kills: 0, struck: {}, choices: {} };
  }
  w.seenAt = now;
  if (hp < w.lastHealth) { w.lost = Math.round((w.lost + w.lastHealth - hp) * 10) / 10; w.lostAt = now; }
  w.lastHealth = hp;
  // A swing is the defense's strike (combat.js strikeTarget, bot._struck).
  const s = bot?._struck;
  if (s && s.at > (w.struckAt ?? w.since)) { w.swings++; w.struckAt = s.at; w.struck[s.id] = s.at; }
  for (const [id, at] of Object.entries(w.struck)) {
    const e = bot?.entities?.[id];
    if (!e || e.isValid === false) { if (now - at < 5000) w.kills++; delete w.struck[id]; }
    else if (now - at > 30000) delete w.struck[id];
  }
  for (const t of about) {
    const id = t.entity?.id;
    if (id === undefined) continue;
    const d = t.distance;
    const m = w.mobs[id] ||= { name: t.entity.name, since: now, first: d, min: d, max: d, seen: false };
    m.min = Math.min(m.min, d); m.max = Math.max(m.max, d); m.last = d; m.lastAt = now;
    if (t.visible) m.seen = true;
  }
  for (const [id, m] of Object.entries(w.mobs)) if (now - (m.lastAt ?? m.since) > GONE_MS) delete w.mobs[id];
  return w;
}

// A stance chosen while up here, counted for what the next asking says.
function noteChoice(state, choice, now = Date.now()) {
  const w = state.pillarWait;
  if (!w || !choice) return;
  const c = w.choices[choice] ||= { times: 0, swingsBefore: w.swings };
  c.times++; c.lastAt = now;
}

// The hold is over (the bot is off the top): kept, with the place, the
// seconds, what was struck and killed, the health lost and how it ended, for
// the holds after it to say.
function endPillarHold(state, ended, now = Date.now()) {
  const w = state.pillarWait;
  if (!w) return;
  delete state.pillarWait;
  const seconds = Math.round(((w.seenAt ?? now) - w.since) / 1000);
  if (seconds < 5) return;
  const kinds = [...new Set([...(w.against?.mobs || []).map(m => m.name), ...Object.values(w.mobs).map(m => m.name)].filter(Boolean))];
  state.pillarHolds = [...(state.pillarHolds || []), { at: new Date(w.since).toISOString(), place: w.place, seconds, kinds, lost: w.lost, swings: w.swings, kills: w.kills, ended }].slice(-12);
}

// The holds already made on a pillar from about here, and what came of them.
function earlierHoldsSays(state, here, now = Date.now()) {
  if (!here) return '';
  const near = (state.pillarHolds || []).filter(h => h.place && now - Date.parse(h.at) - h.seconds * 1000 < HOLDS_WINDOW_MS && Math.hypot(h.place.x + 0.5 - here.x, h.place.y - here.y, h.place.z + 0.5 - here.z) <= HOLD_NEAR);
  if (!near.length) return '';
  const sum = k => Math.round(near.reduce((n, h) => n + (h[k] || 0), 0) * 10) / 10;
  const secs = sum('seconds'), swings = sum('swings'), kills = sum('kills'), lost = sum('lost');
  const last = near.at(-1);
  return ` Held a pillar from about here ${times(near.length)} before in the last ${minutesSays(now - Math.min(...near.map(h => Date.parse(h.at))))}, ${minutesSays(secs * 1000)} in all: ${swings ? `${swings} swing${swings === 1 ? '' : 's'}` : 'nothing struck'}, ${kills ? `${kills} killed` : 'nothing killed'}, ${lost ? `${lost} health lost` : 'no health lost'}; the last ended: ${last.ended}.`;
}

// What the hold has been, said. `about` is the threats list the stance read
// (entity, distance, visible); `reachesTop(t)` whether a mob's blow or shot
// reaches the bot up here, `strikes(t)` whether the sword reaches it from
// here, `shoots(t)` whether it shoots; `hurtBy` the bot's last hurt time by kind. Returns the facts for the
// state and the sentences for the pillar and the fight.
function pillarWaitSays(bot, state, goal, { about = [], reachesTop = () => false, strikes = () => false, shoots: shootsOf = t => !!t.shoots, hurtBy = {}, now = Date.now() } = {}) {
  const w = state.pillarWait;
  if (!w) return null;
  const held = now - w.since;
  const minutes = minutesSays(held);
  const facts = { minutes: Math.round(held / 6000) / 10, healthLost: w.lost, swings: w.swings, kills: w.kills };
  // What it was chosen against, and where that is now.
  let againstSays = '';
  if (w.against?.mobs?.length) {
    const was = w.against.mobs.slice(0, 3).map(m => `the ${name(m.name)}${m.distance !== undefined ? ` ${round(m.distance)} blocks off` : ''}`);
    const gone = (w.against.ids || []).filter(id => { const e = bot.entities?.[id]; return !e || e.isValid === false; }).length;
    const allGone = w.against.ids?.length && gone === w.against.ids.length;
    againstSays = `, chosen against ${was.join(', ')}${allGone ? `; ${w.against.mobs.length === 1 ? 'it is' : 'they are'} not about now` : ''}`;
    facts.chosenAgainst = was.join(', ') + (allGone ? ' (not about now)' : '');
  }
  const doneSays = ` In that time: ${w.lost ? `${w.lost} health lost up here` : 'no health lost up here'}, ${w.swings ? `${w.swings} swing${w.swings === 1 ? '' : 's'} at what came within reach` : 'nothing struck'}, ${w.kills ? `${w.kills} killed` : 'nothing killed'}.`;
  // The stances chosen up here, and that nothing came of the fight's.
  const fightUp = w.choices.fight;
  const fightSays = fightUp ? ` The fight has been chosen up here ${times(fightUp.times)} in this hold${w.swings > (fightUp.swingsBefore || 0) ? '' : ': nothing came within the sword\'s reach and nothing was struck'}.` : '';
  if (fightUp) facts.fightChosenUpHere = fightUp.times;
  // The mobs about, as they have gone while the bot held.
  const mobs = about.map(t => {
    const m = w.mobs[t.entity?.id];
    if (!m || now - m.since < HELD_MS) return null;
    const nearer = t.distance < m.first - NEARER;
    const reach = reachesTop(t), strike = strikes(t);
    const shoots = shootsOf(t);
    const hurt = hurtBy[t.entity.name] > w.since;
    const reachSays = shoots
      ? (hurt ? `; it shoots, and a ${name(t.entity.name)} last hit the bot up here ${minutesSays(now - hurtBy[t.entity.name])} ago` : `; it shoots, and no ${name(t.entity.name)} has hit the bot up here`)
      : `${reach ? '; it reaches the top' : '; it does not reach the top'}${strike ? ', and the sword reaches it from here' : ', and the sword does not reach it from up here'}`;
    const hurtLately = hurt && now - hurtBy[t.entity.name] < 2 * HELD_MS;
    return { nearer, reach, strike, shoots, hurt: hurtLately, visible: !!(m.seen || t.visible),
      says: `the ${name(t.entity.name)} ${round(t.distance)} blocks off, about for ${minutesSays(now - m.since)} of the hold, ${nearer ? `come from ${round(m.first)} to ${round(t.distance)} blocks off` : `${round(m.min)}${round(m.max) > round(m.min) ? ` to ${round(m.max)}` : ''} blocks off all that time, never nearer`}${m.seen || t.visible ? ', in sight' : ', out of sight'}${reachSays}` };
  }).filter(Boolean);
  if (mobs.length) facts.mobsAbout = mobs.map(x => x.says);
  // None of them come, none reaching the bot, none struck: the hold waits on
  // them, and they have not gone.
  // A mob come within the last minute and already within eight is not
  // one the hold has waited on.
  const newNear = about.some(t => { const m = w.mobs[t.entity?.id]; return (!m || now - m.since < HELD_MS) && t.distance <= 8; });
  // Nothing lost for the last two minutes, whatever came before.
  const quiet = !w.lostAt || now - w.lostAt >= 2 * HELD_MS;
  const stood = mobs.length > 0 && !newNear && quiet && mobs.every(x => !x.nearer && !x.strike && (x.shoots ? !x.hurt : !x.reach));
  const one = mobs.length === 1 ? `The ${name(about.find(t => w.mobs[t.entity?.id] && now - w.mobs[t.entity.id].since >= HELD_MS)?.entity.name)}` : null;
  const who = one ? `${one} has not come nearer` : 'None of them has come nearer';
  const gone = one ? 'it has not gone' : 'none has gone';
  const stoodSays = stood ? ` ${who}${w.lostAt ? ` or within the sword's reach in ${minutes}, and ${gone}; nothing has hurt the bot for the last ${minutesSays(now - w.lostAt)}` : `, reached the bot or come within the sword's reach in ${minutes}, and ${gone}`}: the hold has had nothing to strike, and waiting up here has not sent ${one ? 'it' : 'them'} away.` : '';
  const mobsSays = mobs.length ? ` Of the mobs about: ${mobs.map(x => x.says).join('; ')}.` : '';
  // What waiting up here brings, past its first minute: no daylight where
  // there is none, and health that does not come back (as the pocket's stay
  // says, note 584).
  let waitSays = '';
  if (held >= HELD_MS) {
    const noDay = !/overworld/.test(String(bot.game?.dimension || 'overworld'));
    const hp = Math.round((bot.health ?? 20) * 10) / 10, food = bot.food ?? 20;
    if (noDay) waitSays += ' No daylight comes here: nothing about burns off or goes away with the hour, so a hold here ends only when the bot leaves the top.';
    waitSays += hp >= 20 ? ' Health is full: holding heals nothing.' : food < 18 ? ` Health ${hp} does not come back at hunger ${food}: holding heals nothing.` : '';
    if (noDay) facts.daylight = 'none here: a hold ends only when the bot leaves the top';
  }
  // The rung, and how long since it last got anywhere (note 571's ledger).
  let rungLine = '';
  try {
    const { rungOf, rungSays } = require('./tried');
    const r = goal?.tried?.rung, rung = rungOf(goal);
    const idle = r && r.rung === rung && r.bestAt ? now - r.bestAt : 0;
    if (idle >= 5 * 60000) rungLine = ` The ${rungSays(rung)} has had no new best for ${minutesSays(idle)}${r.lastBest ? ` (the last: ${r.lastBest})` : ''}.`;
  } catch (_) { /* no ledger */ }
  if (rungLine) facts.rung = rungLine.trim();
  const earlier = earlierHoldsSays(state, w.place && { x: w.place.x + 0.5, y: w.place.y, z: w.place.z + 0.5 }, w.since);
  if (earlier) facts.earlierHolds = earlier.trim();
  return {
    facts, stood, minutes,
    hold: ` Up on this pillar ${minutes} so far${againstSays}.${doneSays}${fightSays}${mobsSays}${stoodSays}${waitSays}${earlier}${rungLine}`,
    fight: fightSays ? ` Up on the pillar ${minutes} so far.${fightSays}` : '',
  };
}

// For the turn's own question (survival.js claim): the hold as it stands,
// from the record alone.
function pillarClaimSays(state, now = Date.now()) {
  const w = state.pillarWait;
  if (!w || now - (w.seenAt ?? w.since) > LEFT_MS || now - w.since < HELD_MS) return null;
  const mobs = Object.values(w.mobs).filter(m => now - m.since >= HELD_MS && now - (m.lastAt ?? m.since) < 10000)
    .map(m => `the ${name(m.name)} ${m.last < m.first - NEARER ? `come from ${round(m.first)} to ${round(m.last)} blocks off` : `${round(m.min)}${round(m.max) > round(m.min) ? ` to ${round(m.max)}` : ''} blocks off all that time, never nearer`}`);
  return `Up on its pillar ${minutesSays(now - w.since)} so far: ${w.lost ? `${w.lost} health lost up here` : 'no health lost up here'}, ${w.swings ? `${w.swings} swing${w.swings === 1 ? '' : 's'}` : 'nothing struck'}${w.kills ? `, ${w.kills} killed` : ''}${mobs.length ? `; ${mobs.slice(0, 3).join('; ')}` : ''}.`;
}

module.exports = { pillarClaimSays, watchPillar, noteChoice, endPillarHold, pillarWaitSays, earlierHoldsSays, HELD_MS };
