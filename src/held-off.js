'use strict';
// Mobs that have held off, priced at what they have done (note 599).
//
// A mob about for minutes that has not come nearer, fired at the bot or come
// into sight was priced as if it would come at once on the ways off and not
// on the hold: the pocket's leave "should they all come at the bot at once"
// (notes 584, 589), the pillar's way down and the fight each "about 25 and
// 48 damage" against a crossbow piglin that had not shot in twelve minutes
// (note 590), while the stay and the pillar itself were priced at nothing.
// Set side by side, the hold always looked cheaper. Here such a mob is
// priced at its observed rate on every option alike, the hold and each way
// off: over QUIET_MS it has hurt the bot not at all, so it adds nothing to
// the figure of any option that does not go at it, and every option says
// so, with what one of its hits would cost should it come. A fight that
// goes at it is priced as the fight: a mob gone at fights back.
//
// Watched from every look the stance and the pocket take (observe), and
// read also from a pocket's or a pillar's own wait record (pocket-wait.js,
// pillar-wait.js), which keep each mob's first, nearest and farthest.
const QUIET_MS = 3 * 60000;
// Nearer than its distance at the window's start by more than this is
// coming; a shooter out of its range drifting is not.
const NEARER = 2;
const SAMPLE_MS = 5000, GONE_MS = 60000;
// A mob that stands off (note 752): about STANDOFF_MS, never at arm's
// length (ARM) in that time, no nearer than at the window's start by
// NEARER, no hit from its kind, and a shooter out of sight all that while.
// 25595 (mid-242-ya) held on a span 12 of 14 minutes at full health beside
// a hoglin 3.9 blocks off that never came and never hit; survival answered
// it every minute and the work never had the turn. Measured over the flight
// records of 2026-09-29 23Z to 2026-09-30 11:30Z (scripts/turn-owners.js):
// of 5,057 survival wins against a mob, 736 (414.8 bot-minutes) were
// against one that neither closed nor hit in the minute after. Such a mob
// is said with that fact (danger.js reachSays) and is no threat that ends
// the work while it holds; it is one again the moment it comes nearer, to
// its reach, or its kind lands a hit.
const STANDOFF_MS = 60000, ARM = 3, GAP_MS = 15000;
// Past this, in the played record, a shooter's shots coming at the bot
// seldom landed (the flight records' shot frames of 2026-09-26 to 30, the
// nearest ghast's distance at each: from 40 blocks and more 9 of 149
// fireballs landed, under 24 blocks 9 of 56). Said with it (note 752g).
const FAR_SIGHT = { ghast: { blocks: 40, landed: 9, of: 149, nearLanded: 9, nearOf: 56, near: 24 } };
// Its lighting distance and a second's walk (combat-estimate LIGHTS_AT 3,
// APPROACH 3 blocks a second).
const CREEPER_NEAR = 6;
// Where a creeper lights (combat-estimate.js LIGHTS_AT): an unseen one kept
// past it stands off (note 833).
const CREEPER_LIGHTS = 3;

const name = n => String(n || '').replaceAll('_', ' ');
const minutes = ms => Math.max(1, Math.round(ms / 60000));

// Each look: every mob about, with where it has been and whether it came
// into sight.
function observe(bot, list, now = Date.now()) {
  if (!bot) return;
  const w = bot._heldOff ||= {};
  for (const t of list || []) {
    const id = t?.entity?.id;
    if (id == null || !Number.isFinite(t.distance)) continue;
    const m = w[id] ||= { name: t.entity.name, since: now, samples: [], visible: !!t.visible, sightAt: null };
    if (!!t.visible && !m.visible) m.sightAt = now;
    m.visible = !!t.visible;
    const last = m.samples.at(-1);
    // One sample each SAMPLE_MS, holding the nearest and whether it was in
    // sight at any look within it: a mob that steps in and back between
    // samples came that near.
    if (!last || now - last.t >= SAMPLE_MS) m.samples.push({ t: now, d: Math.round(t.distance * 10) / 10, v: !!t.visible });
    else { last.d = Math.min(last.d, Math.round(t.distance * 10) / 10); if (t.visible) last.v = true; }
    m.samples = m.samples.filter(s => now - s.t <= QUIET_MS + SAMPLE_MS);
    m.lastAt = now;
  }
  for (const [id, m] of Object.entries(w)) if (now - (m.lastAt ?? m.since) > GONE_MS) delete w[id];
}

// Whether a mob has held off for QUIET_MS: about that long, not come
// nearer, not come into sight, not hurt the bot, and no shot on its way.
// `record` is a wait record's mobs ({ id: { since, first, min, seen } }).
// -> { minutes, inSight } or null
function quiet(bot, t, { now = Date.now(), record = null } = {}) {
  const id = t?.entity?.id;
  if (id == null) return null;
  const kind = t.entity.name;
  if ((bot?._hurtBy?.[kind] || 0) > now - QUIET_MS) return null;
  const m = bot?._heldOff?.[id];
  if (m && now - m.since >= QUIET_MS) {
    const win = m.samples.filter(s => now - s.t <= QUIET_MS);
    if (win.length && (m.sightAt || 0) <= now - QUIET_MS && Math.min(t.distance, ...win.map(s => s.d)) >= win[0].d - NEARER) return { minutes: minutes(now - m.since), inSight: !!t.visible };
  }
  const r = record?.[id];
  if (r && now - r.since >= QUIET_MS && !r.seen && !t.visible && Math.min(r.min, t.distance) >= r.first - NEARER) return { minutes: minutes(now - r.since), inSight: false };
  return null;
}

// Whether a mob has stood off for STANDOFF_MS (note 752): about that long
// with no gap in the looks over GAP_MS, never within ARM, no nearer than at
// the window's start by NEARER, no hit by it or its kind, and, a shooter,
// out of sight at every look. A creeper or a warden never stands off: one
// goes off through a wall, the other's boom goes through it.
// -> { seconds, nearest, farthest, inSight } or null
function stoodOff(bot, t, { now = Date.now(), ms = STANDOFF_MS, shoots = false } = {}) {
  const id = t?.entity?.id, kind = t?.entity?.name;
  if (id == null || !Number.isFinite(t.distance) || kind === 'warden') return null;
  // A creeper does not hit; it goes off. One stands off only kept past the
  // blocks from which it walks to its lighting distance in a second
  // (CREEPER_NEAR) the whole while, and not walking at the bot now: 25597
  // (mid-241-bd, 13:17:46 to 13:21:27Z) had one parked 7.3 blocks off for
  // three and a half minutes, asked about eleven times (note 752b).
  const creeper = kind === 'creeper';
  const m = bot?._heldOff?.[id];
  // Nearer, one out of sight at every look of the window and never within
  // its lighting reach stands off too (note 833): its fuse burns only while
  // it sees the bot (creeper-sight.js), and the moment it does, or comes
  // within reach, it is the threat again. 25584 (mid-229-aw, 18:10:47 to
  // 18:15:32Z) stood still at full health 4.7 minutes with one 3 to 5
  // blocks off out of sight, encounter_stance asked 41 times.
  const unseen = creeper && !t.visible && !!m && now - m.since >= ms && m.samples.filter(x => now - x.t <= ms + SAMPLE_MS).every(x => !x.v);
  if (creeper && (t.approach >= 1 || (t.distance <= CREEPER_NEAR && !(unseen && t.distance > CREEPER_LIGHTS)))) return null;
  if ((bot?._hurtBy?.[kind] || 0) > now - ms || (bot?._hurtById?.[id] || 0) > now - ms) return null;
  if (!m || now - m.since < ms) return null;
  const win = m.samples.filter(s => now - s.t <= ms + SAMPLE_MS);
  if (win.length < 2 || now - win[0].t < ms - SAMPLE_MS) return null;
  for (let i = 1; i < win.length; i++) if (win[i].t - win[i - 1].t > GAP_MS) return null;
  if (now - win.at(-1).t > GAP_MS) return null;
  const nearest = Math.min(t.distance, ...win.map(s => s.d)), farthest = Math.max(t.distance, ...win.map(s => s.d));
  // A shooter's reach is its line, not arm's length (a skeleton does not
  // strike): judged by its shots below.
  if (nearest <= (creeper ? (unseen ? CREEPER_LIGHTS : CREEPER_NEAR) : shoots ? 0 : ARM) || nearest < win[0].d - NEARER) return null;
  // A shooter in sight stands off only where its shots land so seldom that
  // a line is not a hit: kept past FAR_SIGHT for its kind the whole while,
  // no hit from its kind. A ghast 44 to 60 blocks off in sight re-asked
  // 25584's hide twelve times in ninety seconds at 7.6 health (18:19:37 to
  // 18:21:10Z), no hit from its kind (note 752g).
  const far = FAR_SIGHT[kind]?.blocks;
  // Or in sight by the look for the whole minute and in its reach, yet no
  // shot came at the bot in that time, landed or not (hit-log.js's shot
  // record): the line the look reads is not one it shoots along. 25592
  // (20:08 to 20:17Z) sat boxed in its own cobbled deepslate with a
  // skeleton 1.6 blocks off "in sight" for nine minutes, no shot, the take
  // cover held on and on (note 752i).
  const shotsIn = (bot?._shotLog || []).filter(x => now - x.at <= ms).length;
  const quietLine = shoots && bot?._shotLog !== undefined && shotsIn === 0;
  if (shoots && (t.visible || win.some(s => s.v)) && !(far && nearest > far) && !quietLine) return null;
  return { seconds: Math.round((now - m.since) / 1000), nearest: Math.round(nearest * 10) / 10, farthest: Math.round(farthest * 10) / 10, inSight: !!t.visible };
}
// How long a mob has been about by the record, its nearest and farthest,
// whatever it did: for the reach said of it (danger.js reachSays).
function recordOf(bot, t, { now = Date.now() } = {}) {
  const m = bot?._heldOff?.[t?.entity?.id];
  if (!m?.samples?.length) return null;
  const d = [t.distance, ...m.samples.map(s => s.d)].filter(Number.isFinite);
  return { seconds: Math.round((now - m.since) / 1000), nearest: Math.round(Math.min(...d) * 10) / 10, farthest: Math.round(Math.max(...d) * 10) / 10 };
}

// The quiet ones among a list, each with its record.
function quietOf(bot, list, opts = {}) {
  return (list || []).map(t => ({ t, q: quiet(bot, t, opts) })).filter(x => x.q);
}

// Said with every option they would otherwise be priced on: how long each
// has held off, and what one of its hits costs through the armour worn.
function says(bot, quietList) {
  if (!quietList?.length) return '';
  let hit = () => null;
  try {
    const ce = require('./combat-estimate');
    const worn = ce.armourOf([5, 6, 7, 8].map(s => bot?.inventory?.slots?.[s]?.name).filter(Boolean));
    hit = n => ce.MOBS[n]?.hit ? Math.round(ce.afterArmour(ce.MOBS[n].hit, worn) * 10) / 10 : null;
  } catch (_) { /* no figures */ }
  const each = quietList.map(({ t, q }) => `the ${name(t.entity.name)} ${Math.round(t.distance)} blocks off (${q.minutes} minute${q.minutes === 1 ? '' : 's'}, ${q.inSight ? 'in sight all that while' : 'out of sight'}${hit(t.entity.name) ? `; about ${hit(t.entity.name)} a hit should it come` : ''})`);
  const one = quietList.length === 1;
  return ` Held off: ${each.join('; ')}. ${one ? 'It has' : 'Each has'} been about ${one ? 'that long' : 'as long as said'} without coming nearer, coming into sight or hurting the bot, so ${one ? 'it is' : 'they are'} priced at what ${one ? 'it has' : 'they have'} done, nothing, on every option here that does not go at ${one ? 'it' : 'them'}, the hold and the ways off alike; a fight that goes at ${one ? 'it' : 'them'} is priced as that fight.`;
}

module.exports = { observe, quiet, quietOf, says, stoodOff, recordOf, QUIET_MS, NEARER, STANDOFF_MS, CREEPER_NEAR, FAR_SIGHT };
