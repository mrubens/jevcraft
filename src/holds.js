'use strict';
// A hold with nothing new is not a question (note 599).
//
// A stance was asked again when its estimate's seconds ran out (fifteen, or
// fewer), whatever had happened. mid-242-af (25598) held its pillar twelve
// minutes over a crossbow piglin that never shot, and was asked every
// fifteen seconds: 48 askings, the same answer, nothing changed (note 590);
// mid-208-k-nether-4-fortress-1 (25589) the same over a hoglin that neither
// came nor went. Each asking was the same facts, and the answer came back
// the same.
//
// Here a stance carries what it was chosen on: its estimate (`expects`,
// damage over seconds), the mobs it was chosen against as they were (each
// one's distance and whether it was in sight), and the options on offer.
// It ends early, and is asked again, when what is observed falsifies that:
//   - more damage taken than priced, at the estimate's own rate, by more
//     than one blow of the hardest hitter (its `oneHit`);
//   - a mob it was chosen against changes: come nearer by NEARER_BY blocks,
//     into sight or out of it, gone, or a shot come at the bot;
//   - a way not on offer when it was chosen is on offer now (body.js's held
//     way out of the fire, note 595, made general).
// Otherwise, at the end of its estimate, it is held on without a question,
// EXTEND_MS at a time (15, 30, then 60 seconds), until HOLD_CAP_MS in all:
// then it is asked again, said with how long it has held and that nothing
// changed, and the rung's question is due (tried.js rungDue). The physical
// triggers are the stance step's own and stay as they were: six health
// lost, a mob it was not chosen against within six, a shooter's line where
// it hid, the bot off its spot.
const EXTEND_MS = [15000, 30000, 60000];
const HOLD_CAP_MS = 5 * 60000;
const NEARER_BY = 4;
const SPOT_MOVED = 1.5;

const name = n => String(n || '').replaceAll('_', ' ');
const secs = ms => { const s = Math.round(ms / 1000); return s < 90 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.round(s / 60)} minute${Math.round(s / 60) === 1 ? '' : 's'}`; };

// The hold as chosen: `mobs` in danger.js threats' shape, `offered` the
// option keys on offer.
function begin({ choice, at = Date.now(), health, expects = null, mobs = [], offered = [] }) {
  return { choice, at, health, ...(expects ? { expects } : {}), offered: offered.filter(k => k !== 'none_good'),
    against: mobs.filter(t => t?.entity).slice(0, 6).map(t => ({ id: t.entity.id, name: t.entity.name, distance: Math.round(t.distance * 10) / 10, visible: !!t.visible })),
    until: at + Math.min(15000, expects?.seconds ? expects.seconds * 1000 : 15000), extended: 0 };
}

// Why the hold's expectation no longer stands, or null. `mobs` now in the
// threats' shape, `offered` the option keys on offer now, `shot` a shot on
// its way at the bot (projectile-guard.js incoming).
function diverged(hold, { now = Date.now(), health, mobs = [], offered = [], shot = null, hurtBy = {}, at = null } = {}) {
  if (!hold) return 'no hold';
  // Off the spot it has held since it was first held on (a pillar's top
  // left, knocked off a ledge): the stance's own place is gone.
  if (hold.spot && at && Math.hypot(at.x - hold.spot.x, at.y - hold.spot.y, at.z - hold.spot.z) >= SPOT_MOVED) return `the bot is off the spot it was holding (moved ${Math.round(Math.hypot(at.x - hold.spot.x, at.y - hold.spot.y, at.z - hold.spot.z) * 10) / 10} blocks)`;
  const e = hold.expects;
  const elapsed = (now - hold.at) / 1000;
  const lost = (hold.health ?? health) - (health ?? hold.health);
  if (e && Number.isFinite(e.damage) && e.seconds > 0) {
    const priced = e.damage * elapsed / e.seconds;
    if (lost > priced + (e.oneHit || 0)) return `${Math.round(lost * 10) / 10} health lost in ${secs(now - hold.at)}, more than the ${Math.round(priced * 10) / 10} it was priced at by then`;
  }
  for (const m of hold.against) {
    const t = mobs.find(x => x?.entity?.id === m.id);
    if (!t) return `the ${name(m.name)} it was chosen against is gone`;
    if (t.distance <= m.distance - NEARER_BY) return `the ${name(m.name)} it was chosen against came from ${Math.round(m.distance)} to ${Math.round(t.distance)} blocks off`;
    if (!!t.visible !== m.visible) return `the ${name(m.name)} it was chosen against ${t.visible ? 'came into sight' : 'went out of sight'}, ${Math.round(t.distance)} blocks off`;
    if ((hurtBy[m.name] || 0) > hold.at) return `the ${name(m.name)} it was chosen against hit the bot`;
  }
  if (shot) return `a shot came at the bot${shot.name ? ` (${name(shot.name)})` : ''}`;
  const fresh = offered.filter(k => k !== 'none_good' && !hold.offered.includes(k));
  if (fresh.length) return `a way not on offer when it was chosen is on offer now: ${fresh.map(name).join(', ')}`;
  return null;
}

// At the end of the hold's time, with nothing diverged: held on, or at its
// cap. -> { extend: ms } or { capped: says }
function extend(hold, now = Date.now(), at = null) {
  if (now - hold.at >= HOLD_CAP_MS) return { capped: `held ${secs(now - hold.at)} and nothing it was chosen on changed` };
  if (!hold.spot && at) hold.spot = { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10, z: Math.round(at.z * 10) / 10 };
  const ms = EXTEND_MS[Math.min(hold.extended, EXTEND_MS.length - 1)];
  hold.extended++;
  hold.until = Math.min(now + ms, hold.at + HOLD_CAP_MS);
  return { extend: ms };
}

// The mobs it was chosen against, as the hold says them.
const againstSays = hold => hold.against.map(m => `the ${name(m.name)} ${Math.round(m.distance)} blocks off${m.visible ? ' in sight' : ' out of sight'}`).join(', ');

module.exports = { begin, diverged, extend, againstSays, EXTEND_MS, HOLD_CAP_MS, NEARER_BY };
