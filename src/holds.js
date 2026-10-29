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
// The stances that stand and take a biter's blows on the shield or the
// sword by design (note 752f).
const FACES = new Set(['shield_guard', 'shield_the_charge', 'fight', 'fight_from_footing', 'strike_from_above', 'rail_and_fight']);
const soloArrowShooter = (mobs, choice) => !HIDING.has(choice) && (() => { try { return !!require('./danger').soloRangedThreat(null, mobs); } catch (_) { return false; } })();

const name = n => String(n || '').replaceAll('_', ' ');
const secs = ms => { const s = Math.round(ms / 1000); return s < 90 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.round(s / 60)} minute${Math.round(s / 60) === 1 ? '' : 's'}`; };

// The hold as chosen: `mobs` in danger.js threats' shape, `offered` the
// option keys on offer.
// The health a stance with no price may cost before it is asked again (note 952).
const UNPRICED_LOSS = 4;
// An arrow as it lands on a bare bot: 4 the most often, 5 at the most in the flight records of 2026-10-29 (note 2501).
const ONE_ARROW = 5;
// A shield's uses blocked away are a cost the hold's price does not carry (note 1955): a hold is asked again once the shield has spent this share of the uses it had at the choice.
const SHIELD_SPENT = 0.25;
function begin({ choice, at = Date.now(), health, expects = null, mobs = [], offered = [], shield = null }) {
  return { choice, at, health, ...(expects ? { expects } : {}), ...(shield?.held ? { shieldLeft: shield.left, shieldMax: shield.max } : {}), offered: offered.filter(k => k !== 'none_good'),
    against: mobs.filter(t => t?.entity).slice(0, 6).map(t => ({ id: t.entity.id, name: t.entity.name, distance: Math.round(t.distance * 10) / 10, visible: !!t.visible })),
    until: at + Math.min(15000, expects?.seconds ? expects.seconds * 1000 : 15000), extended: 0 };
}

// Why the hold's expectation no longer stands, or null. `mobs` now in the
// threats' shape, `offered` the option keys on offer now, `shot` a shot on
// its way at the bot (projectile-guard.js incoming).
// `about`: every hostile within twenty-four blocks, in sight or not (note
// 2134): one that has only gone out of sight is said so, not 'gone'. full-6
// (2026-10-26 03:14:33Z, 7 health) held shield_the_blast against a creeper,
// was asked again for 'the creeper it was chosen against is gone' with it
// 14.7 blocks off behind rock, chose run_from the zombies, and was blown up
// by that creeper six seconds later.
function diverged(hold, { now = Date.now(), health, mobs = [], offered = [], shot = null, hurtBy = {}, at = null, shield = null, about = null } = {}) {
  if (!hold) return 'no hold';
  // The shield spent on the hold (note 1955): full-3 (2026-10-20 11:39 to 11:42Z) held a pillar 193 seconds under one skeleton, the hold extended twice as 'nothing it was chosen on has changed', every arrow blocked on the shield, until the shield broke; shot dead from 18 health within a minute of that. The arrows taken on the shield are what changed.
  if (shield?.held && Number.isFinite(hold.shieldLeft) && hold.shieldLeft - shield.left >= Math.max(1, Math.round(hold.shieldLeft * SHIELD_SPENT))) {
    return `the shield has taken ${hold.shieldLeft - shield.left} of its uses on this hold (${shield.left} of ${shield.max} left, ${hold.shieldLeft} when it was chosen)`;
  }
  // Off the spot it has held since it was first held on (a pillar's top
  // left, knocked off a ledge): the stance's own place is gone.
  if (hold.spot && at && Math.hypot(at.x - hold.spot.x, at.y - hold.spot.y, at.z - hold.spot.z) >= SPOT_MOVED) return `the bot is off the spot it was holding (moved ${Math.round(Math.hypot(at.x - hold.spot.x, at.y - hold.spot.y, at.z - hold.spot.z) * 10) / 10} blocks)`;
  const e = hold.expects;
  const elapsed = (now - hold.at) / 1000;
  const lost = (hold.health ?? health) - (health ?? hold.health);
  // Hit at a health one arrow ends (note 2501, the body's floor): whatever the stance and its price, it is asked again.
  // full-92, full-95 and full-88 (2026-10-29) held on through hits at 7, 5 and 2 health, the lone shooter's
  // nearer-and-sight triggers dropped and the price not yet spent, and the next arrow ended each.
  if (lost > 0 && Number.isFinite(health) && health <= ONE_ARROW) return `hit while at ${Math.round(health * 10) / 10} health, which one arrow that lands ends (${Math.round(lost * 10) / 10} lost since it was chosen)`;
  if (e && Number.isFinite(e.damage) && e.seconds > 0) {
    const priced = e.damage * elapsed / e.seconds;
    if (lost > priced + (e.oneHit || 0)) return `${Math.round(lost * 10) / 10} health lost in ${secs(now - hold.at)}, more than the ${Math.round(priced * 10) / 10} it was priced at by then`;
  } else if (lost >= UNPRICED_LOSS) {
    // A stance chosen with no price said ends on what it has cost as one
    // with a price does (note 952): 25592 (mid-242-ka-nether-1, 2026-10-02
    // 21:45:44Z) held await_in_reach in its box, four blazes 13 to 16
    // blocks off landing fireballs and fire, from 20 health to 0.8 in nine
    // seconds, and was never asked again.
    return `${Math.round(lost * 10) / 10} health lost in ${secs(now - hold.at)} under a stance chosen with no price said`;
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
    if (!t && (m === nearestAgainst || !stillHere.length)) {
      const near = Array.isArray(about) ? about.find(x => x?.entity?.id === m.id) : null;
      return near ? `the ${name(m.name)} it was chosen against is out of sight now, ${Math.round(near.distance * 10) / 10} blocks off: not gone` : `the ${name(m.name)} it was chosen against is gone`;
    }
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
    // A hit from the mob a fight or a shield guard was chosen against is
    // that stance as priced (the damage over its price ends it, above), not
    // news: 25597 (17:54:44Z) asked the fight again for "the zombie it was
    // chosen against hit the bot", 104 stance askings in 15 minutes (note
    // 752f). A hide, a pillar or a wall a hit came through is news.
    if ((hurtBy[m.name] || 0) > hold.at && !FACES.has(hold.choice) && !isClosing(hold.choice)) return `the ${name(m.name)} it was chosen against hit the bot`;
  }
  // A shot from the shooters it faces is that stance as priced, as a hit
  // from them is (note 752f): ended only where a shooter it was not chosen
  // against is about, or the stance hides from them (note 963). 25584
  // (mid-241-dx, 2026-10-03 02:12:10 to 02:13:23Z) was asked its stance
  // against one pillager every 4 to 6 seconds, at each bolt, and turned
  // take_cover, fight, take_cover, fight eleven times, hit six times.
  const shootersNow = mobs.filter(x => x?.entity && (x.shoots || isShooter(x.entity)));
  const facedOnly = (FACES.has(hold.choice) || isClosing(hold.choice)) && shootersNow.length && shootersNow.every(x => hold.against.some(m => m.id === x.entity.id));
  if (shot && !facedOnly) return `a shot came at the bot${shot.name ? ` (${name(shot.name)})` : ''}`;
  // A shot at one mob or another is the one way (shoot_<id> per target):
  // a new target's key is not a new way (25583, 13:05:51Z: "shoot 5353").
  const way = k => String(k).replace(/^shoot_\d+$/, 'shoot');
  const had = new Set(hold.offered.map(way));
  const fresh = offered.filter(k => k !== 'none_good' && !had.has(way(k)));
  if (fresh.length) return `a way not on offer when it was chosen is on offer now: ${fresh.map(name).join(', ')}`;
  return null;
}

// A stance that stands and takes the blows (FACES) held past twice the seconds it was chosen for, nothing it was
// chosen on changed: asked again once with that said, not held on to the five-minute cap (note 2169). Over the six
// full runs' day to 2026-10-26 08:00Z shield_guard stood 298 minutes in all, 151 of its 526 picks past twice their
// stated seconds (182 minutes beyond them), the fight 42 minutes beyond, shield_the_blast 36: the price was said as
// 'about 15 seconds' and the hold ran on while a shooter plinked the shield from range. The hiding and waiting
// stances (a pillar, cover, out of sight) are not: standing is their point. -> says or null
const PAST_STATED = 2, PAST_ASK_ONCE_MS = 5 * 60000;
// `memo`: where the asking is remembered by stance (the survival state's pastAsked), so a stance chosen again after
// the question is not asked again for it within five minutes (note 715's cap on the asking: a handful a skirmish).
function pastStated(hold, { choice, at, expects } = {}, now = Date.now(), memo = hold) {
  if (!hold || !FACES.has(choice) || !(expects?.seconds > 0)) return null;
  const stated = Math.max(5, expects.seconds), held = (now - at) / 1000;
  if (held < PAST_STATED * stated) return null;
  const key = `pastAsked_${choice}`;
  if (memo[key] && now - memo[key] < PAST_ASK_ONCE_MS) return null;
  memo[key] = now;
  return `held ${secs(now - at)}, past twice the ${Math.round(expects.seconds)} seconds it was chosen for, and nothing it was chosen on changed (${againstSays(hold) || 'no mob named'})`;
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

module.exports = { begin, diverged, extend, pastStated, againstSays, FACES, EXTEND_MS, HOLD_CAP_MS, NEARER_BY, SHIELD_SPENT, PAST_STATED, PAST_ASK_ONCE_MS };
