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
// Where a biter's blow lands (a block and a half centre to centre), with room.
const ARMS = 2;
const isShooter = e => { try { return !!e && require('./combat').shooter(e); } catch (_) { return false; } };
// A stance whose point is to close the ground to what it was chosen
// against (fight, charge_shooter and the rest of shot-reflex.js's
// STANCE_SHOTS.closing): moving is the stance acting, not the bot straying
// off a spot it was ever meant to keep (note 715: closing on a lone
// skeleton, the spot extend() fixed on the first hold's end was a stride
// behind by the very next tick, chasing it, and the hold ended there every
// time, asked again every two or three seconds though the skeleton itself
// had not come to anything, gone, or landed a hit past what was priced).
const isClosing = choice => { try { return require('./shot-reflex').STANCE_SHOTS.closing.has(choice); } catch (_) { return false; } };
// One arrow shooter alone (skeleton, stray, bogged, parched, pillager, or a
// piglin with a crossbow; danger.js's soloRangedThreat), with no other
// threat about: the sight it loses and regains, and the few blocks it
// closes or backs off skirmishing, is not the encounter changing while it
// is still that one mob. Only its being gone, or the health lost past what
// the hold priced (the check above), ends it (note 715). Not for a stance
// that hid the bot (survival.js's HIDING_STANCES): a shooter regaining the
// line to where the bot hid is that hide failing, not skirmish noise, even
// alone against the one it hid from (mid-242-y, note 522).
const HIDING = new Set(['out_of_sight', 'nook', 'take_cover']);
const soloArrowShooter = (mobs, choice) => !HIDING.has(choice) && (() => { try { return !!require('./danger').soloRangedThreat(null, mobs); } catch (_) { return false; } })();

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
  const solo = soloArrowShooter(mobs, hold.choice);
  // One gone of several is news only when it was the nearest of them, or
  // the last: the rest are still what the stance answers. 25583 (mid-244-fe,
  // 13:06:10Z) on its pillar over two hoglins was asked again for "the
  // piglin brute it was chosen against is gone", 10.5 blocks off behind
  // them, and at 13:06:26 for a piglin the same, nothing else changed
  // (note 752b).
  const nearestAgainst = hold.against.reduce((a, m) => (!a || m.distance < a.distance ? m : a), null);
  const stillHere = hold.against.filter(m => mobs.some(x => x?.entity?.id === m.id));
  for (const m of hold.against) {
    const t = mobs.find(x => x?.entity?.id === m.id);
    if (!t && (m === nearestAgainst || !stillHere.length)) return `the ${name(m.name)} it was chosen against is gone`;
    if (!t) continue;
    // Come to arm's length, one that bites, from out of it: mid-242-ah-
    // fortress-3's retreat was held on past its run with the wither skeleton
    // it ran from at 4.2, 6.7 and then 2 blocks, never four nearer; it was
    // struck twice standing, 13.5 to 5.3, before the stance was asked again
    // (note 601).
    if (t.distance <= ARMS && m.distance > ARMS + 1 && !t.shoots && !isShooter(t.entity)) return `the ${name(m.name)} it was chosen against came to arm's length, ${Math.round(t.distance * 10) / 10} blocks off`;
    if (solo) continue;
    if (t.distance <= m.distance - NEARER_BY) return `the ${name(m.name)} it was chosen against came from ${Math.round(m.distance)} to ${Math.round(t.distance)} blocks off`;
    if (!!t.visible !== m.visible) return `the ${name(m.name)} it was chosen against ${t.visible ? 'came into sight' : 'went out of sight'}, ${Math.round(t.distance)} blocks off`;
    if ((hurtBy[m.name] || 0) > hold.at) return `the ${name(m.name)} it was chosen against hit the bot`;
  }
  if (shot) return `a shot came at the bot${shot.name ? ` (${name(shot.name)})` : ''}`;
  // A shot at one mob or another is the one way (shoot_<id> per target):
  // a new target's key is not a new way (25583, 13:05:51Z: "shoot 5353").
  const way = k => String(k).replace(/^shoot_\d+$/, 'shoot');
  const had = new Set(hold.offered.map(way));
  const fresh = offered.filter(k => k !== 'none_good' && !had.has(way(k)));
  if (fresh.length) return `a way not on offer when it was chosen is on offer now: ${fresh.map(name).join(', ')}`;
  return null;
}

// At the end of the hold's time, with nothing diverged: held on, or at its
// cap. -> { extend: ms } or { capped: says }
function extend(hold, now = Date.now(), at = null) {
  if (now - hold.at >= HOLD_CAP_MS) return { capped: `held ${secs(now - hold.at)} and nothing it was chosen on changed` };
  if (!hold.spot && at && !isClosing(hold.choice)) hold.spot = { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10, z: Math.round(at.z * 10) / 10 };
  const ms = EXTEND_MS[Math.min(hold.extended, EXTEND_MS.length - 1)];
  hold.extended++;
  hold.until = Math.min(now + ms, hold.at + HOLD_CAP_MS);
  return { extend: ms };
}

// The mobs it was chosen against, as the hold says them.
const againstSays = hold => hold.against.map(m => `the ${name(m.name)} ${Math.round(m.distance)} blocks off${m.visible ? ' in sight' : ' out of sight'}`).join(', ');

module.exports = { begin, diverged, extend, againstSays, EXTEND_MS, HOLD_CAP_MS, NEARER_BY };
