'use strict';
// One fact of the portal's state that every portal step reads (note 763,
// the reviewer's rule of artifacts/fable's check-in after 20:00Z): the frame
// begun and the cells of it standing, what is in hand for it (lava, water,
// empty buckets, obsidian), whether a portal is lit here, and the lava the
// fetch holds. A step may claim the turn only while its precondition holds
// against it; two steps trading the turn within the reach-nether rung,
// each holding its claim, are a question to Jev with the flip named, not a
// rest and a list of detours.
//
// 6 of 9 loop verdicts since 18:00Z on 2026-09-30 were in the reach nether:
// enter_nether with fill_bucket (25595 19:09Z, 25584 19:38Z), with
// ascend_to_surface (25592 19:55Z), and "the lava chosen ... staircase set
// aside" (25593 18:02Z, 25581 19:32Z twice). enter_nether is the ladder's
// label, written before every pass of the crossing (game-progress.js
// gameStep, note 748): it claims nothing unless a portal is lit to enter,
// and a trade with it was the work of one step read as two. 25583 (mid-242-
// ai, 19:40-19:49Z and 20:08-20:13Z), its cast five and then nine of ten
// standing with lava in hand, was rested as "cast portal and enter nether"
// and sent on detours, and set the reach nether aside at nine of ten.
const { Vec3 } = require('vec3');

const count = (bot, name) => (bot?.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const at = p => new Vec3(p.x, p.y, p.z);
const PORTAL_STEPS = /^(enter_nether|cast_portal|fill_bucket|go_to_landmark|to_lava_for_portal|ascend_to_surface|return_to_portal|return_to_frame|dig_portal_site|buckets_for_portal|to_ruined_portal|make_obsidian|clear_cast_walls|pillar_to_portal)$/;

// A portal lit where the bot is: its blocks in the world loaded about it.
function litHere(bot) {
  try {
    if (typeof bot.findBlocks !== 'function' || !bot.registry?.blocksByName?.nether_portal) return false;
    return (bot.findBlocks({ matching: bot.registry.blocksByName.nether_portal.id, maxDistance: 64, count: 1 }) || []).length > 0;
  } catch (_) { return false; }
}

// The fact. Cheap enough for a flip's judging, not for every tick.
function portalFact(bot, goal = {}) {
  const here = bot?.entity?.position;
  const f = goal.portalFrame && !goal.portalFrame.ruin ? goal.portalFrame : null;
  let frame = null;
  if (f?.origin) {
    const blocks = Array.isArray(f.blocks) ? f.blocks : [];
    const loaded = typeof bot.blockAt === 'function' && blocks.every(b => bot.blockAt(at(b)));
    const standing = loaded ? blocks.filter(b => bot.blockAt(at(b))?.name === 'obsidian').length : (Number.isFinite(f.placedSeen) ? f.placedSeen : null);
    frame = { origin: { ...f.origin }, standing, of: blocks.length || 10, cast: !!f.cast, distance: here ? Math.round(here.distanceTo(at(f.origin).offset(0.5, 0, 0.5))) : null };
  }
  const lava = count(bot, 'lava_bucket'), water = count(bot, 'water_bucket'), buckets = count(bot, 'bucket'), obsidian = count(bot, 'obsidian');
  const owed = Math.max(0, (frame?.of || 10) - (frame?.standing || 0) - obsidian - lava);
  const held = goal.lavaFetch ? { at: { ...goal.lavaFetch.lava }, way: goal.lavaFetch.way } : goal.portalMethod?.near ? { at: { ...goal.portalMethod.near }, way: 'cast beside' } : null;
  const lit = litHere(bot);
  const says = `${lit ? 'A portal is lit here. ' : 'No portal is lit here. '}${frame ? `The frame begun at (${frame.origin.x}, ${frame.origin.y}, ${frame.origin.z}), ${frame.distance} blocks off: ${frame.standing ?? 'some'} of ${frame.of} standing${frame.cast ? ', cast in place' : ''}.` : 'No frame begun.'} In hand: ${lava} lava, ${water} water and ${buckets} empty bucket${buckets === 1 ? '' : 's'}, ${obsidian} obsidian; ${owed} lava still to fetch.${held ? ` The lava held: (${held.at.x}, ${held.at.y}, ${held.at.z}), ${held.way}.` : ''}`;
  return { lit, frame, lava, water, buckets, obsidian, owed, held, says };
}

// Whether a step's claim on the turn holds against the fact: the ladder's
// label enter_nether only with a portal lit to enter; the cast only at a
// frame begun; the lava fetch only with lava still owed and a bucket to
// carry it; the walk to a portal only with one known or a frame begun. A
// climb or a site's dig is its own question's, and holds.
function claimHolds(step, fact) {
  switch (step) {
    case 'enter_nether': return fact.lit;
    case 'cast_portal': case 'clear_cast_walls': case 'return_to_frame': case 'pillar_to_portal': return !!fact.frame;
    case 'fill_bucket': case 'go_to_landmark': case 'to_lava_for_portal': return fact.owed > 0 && fact.buckets + fact.lava > 0;
    case 'return_to_portal': return fact.lit || !!fact.frame;
    default: return true;
  }
}

module.exports = { PORTAL_STEPS, portalFact, claimHolds, litHere };
