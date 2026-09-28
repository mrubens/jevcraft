'use strict';
// Every way to ender pearls from where the bot stands, as answers to the
// stall's and the rung's questions while the pearls are the rung in hand.
//
// The ladder (game-progress.js) takes one route by rule: a barter when gold
// is carried and a piglin is in view, a bastion's gold, the warped forest
// (one known, or a sweep for one), and only when every one of those rests,
// home. When the route it took stalled, the stall's question offered ways
// to keep at that same route and nothing else. On 25600
// (mid-242-ae-nether-2-fortress-2, note 588) both warped forests known had
// walks that came no nearer, the sweep for a third turned on a ledge of its
// own stairs for ten minutes, and Jev answered none_good seven times,
// 0.45 to 0.75: the Overworld's endermen, the forests taken up again, and
// the rods it had set aside were not among the answers. Here each route
// that is real from here is an option, said with what it would meet; a
// route that is not (no gold to barter with) is said as not offered, and
// why, so a missing move is not a route that cannot be taken.
const { isSetAside, attemptsFor } = require('./progress');

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const minutesLeft = (until, now) => Math.max(1, Math.ceil((until - now) / 60000));
const count = (bot, name) => (bot.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const inNether = bot => /nether/.test(String(bot.game?.dimension || ''));
const BLOCKS = /^(netherrack|cobblestone|cobbled_deepslate|blackstone|basalt|dirt|stone|deepslate|andesite|diorite|granite|tuff|soul_soil|end_stone|oak_planks|spruce_planks|birch_planks|jungle_planks|acacia_planks|dark_oak_planks|mangrove_planks|cherry_planks|crimson_planks|warped_planks|bamboo_planks|pale_oak_planks)$/;
const blocksCarried = bot => (bot.inventory?.items?.() || []).filter(i => BLOCKS.test(i.name)).reduce((n, i) => n + i.count, 0);

// The routes, as { options: { key: { description, run } }, notOffered: [..] }.
// `actions.navigate` walks toward a piglin for a barter.
function pearlRoutes(bot, goal, { now = Date.now(), save = () => {}, actions = {} } = {}) {
  const options = {}, notOffered = [];
  const here = bot.entity?.position;
  if (!here || goal.kind !== 'win') return { options, notOffered };
  const exploration = require('./exploration');
  const blocks = blocksCarried(bot);
  const carried = `${plural(blocks, 'block')} carried to bridge or pillar with`;
  if (inNether(bot)) {
    // The warped forests known, their walks resting: taken up again, the
    // rest lifted and the pearl step walks there.
    let forests = [];
    try { forests = exploration.knownLandmarks(bot, goal, 'warped_forest', 1024); } catch (_) { forests = []; }
    const tripKey = l => `${l.kind}:${l.x},${l.z}`;
    const resting = forests.filter(k => isSetAside(goal, 'landmark_trip', tripKey(k.landmark), now));
    for (const [i, k] of resting.slice(0, 2).entries()) {
      const l = k.landmark, key = tripKey(l), dy = Number.isFinite(l.y) ? Math.round(l.y - here.y) : 0;
      const entry = attemptsFor(goal).entries[require('./progress').keyOf('landmark_trip', key)];
      const w = l.lastWalk;
      const walked = w ? ` The last walk there, from (${w.from.x}, ${w.from.y}, ${w.from.z}), began ${w.began} blocks off and ended ${w.ended}${w.why ? `: ${w.why}` : ''}`.replace(/[.!?]?$/, m => m || '.') : '';
      const target = { x: l.x, y: Number.isFinite(l.y) ? l.y : Math.round(here.y), z: l.z };
      options[`pearls_forest_${i + 1}`] = { target, surveyTo: target,
        description: `Go for the warped forest at (${l.x}, ${l.z}) again, ${k.distance} blocks off${dy ? ` and ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''}: endermen spawn there in numbers, and the pearls are its hunt. Its walk rests ${plural(minutesLeft(entry.until, now), 'minute')} more (${entry.why}); chosen, the rest is lifted and the pearl step walks there, bridging and digging as the walk does, ${carried}.${walked}`,
        run: async () => { attemptsFor(goal).clear('landmark_trip', key); attemptsFor(goal).clear('rung', 'warped_pearls'); delete goal.pearlRoute; save(); } };
    }
    // The sweep for another forest, when it rests and no forest known is
    // open (an open one is what the pearl step walks to first).
    const openForest = forests.some(k => !isSetAside(goal, 'landmark_trip', tripKey(k.landmark), now));
    if (!openForest && isSetAside(goal, 'rung', 'warped_search', now)) {
      const entry = attemptsFor(goal).entries[require('./progress').keyOf('rung', 'warped_search')];
      options.pearls_search = { description: `Sweep the Nether for another warped forest, legs of sixty-four blocks on a heading at a time, walking and digging through the netherrack, ${carried}. The sweep rests ${plural(minutesLeft(entry.until, now), 'minute')} more (${entry.why}); chosen, the rest is lifted and the sweep starts afresh from here.`,
        run: async () => { attemptsFor(goal).clear('rung', 'warped_search'); attemptsFor(goal).clear('rung', 'warped_pearls'); delete goal.warpedSearch; delete goal.pearlRoute; save(); } };
    }
    // A barter: gold to throw, and piglins about but none near enough for
    // the ladder's own barter (which needs one within 32).
    const bartering = require('./bartering');
    const gold = bartering.goldOnHand(bot);
    const piglins = Object.values(bot.entities || {}).filter(e => e.name === 'piglin' && e.isValid !== false && e.position)
      .map(e => ({ e, d: e.position.distanceTo(here) })).sort((a, b) => a.d - b.d);
    if (gold > 0 && piglins.length && !bartering.barterReady(bot, goal) && actions.navigate) {
      const near = piglins[0];
      options.pearls_barter = { target: { x: Math.round(near.e.position.x), y: Math.round(near.e.position.y), z: Math.round(near.e.position.z) },
        description: `Barter with piglins for pearls: gold enough for ${plural(gold, 'ingot')} carried, measured on this server at about nine ingots a pearl, and a gold piece is worn first or they turn on the bot. ${plural(piglins.length, 'piglin')} about, the nearest ${Math.round(near.d)} blocks off; chosen, the bot walks toward it and barters once one is within thirty-two.`,
        run: async (task) => {
          const { goals } = require('mineflayer-pathfinder');
          const p = near.e.position;
          await actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 12), { timeoutMs: 45000, stallMs: 8000 });
        } };
    } else if (gold <= 0) {
      let bastion = false;
      try { bastion = bartering.bastionKnown(bot, goal); } catch (_) { bastion = false; }
      if (!bastion) notOffered.push(`a barter with piglins: no gold carried (about nine ingots a pearl, measured) and no bastion known to take gold from${piglins.length ? `; ${plural(piglins.length, 'piglin')} about, the nearest ${Math.round(piglins[0].d)} blocks off` : ''}`);
    } else if (!piglins.length) notOffered.push(`a barter with piglins: gold enough for ${plural(gold, 'ingot')} carried, but no piglin about`);
    // Back to the Overworld for its endermen (and a cleric's pearls when
    // one is known), the pearls there before the Nether again.
    const { portalTrip, pearlRouteHeld, PEARL_ROUTE_MS } = require('./game-progress');
    const portals = (goal.portals || []).filter(p => /nether/.test(String(p.dimension || '')));
    if (portals.length && pearlRouteHeld(goal, now)?.pick !== 'overworld') {
      const cleric = Object.values(goal.trading?.offers || {}).some(o => (o.trades || []).some(t => t.outputItem?.name === 'ender_pearl' && !t.tradeDisabled));
      const rods = count(bot, 'blaze_rod');
      const portal = portals.slice().sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
      options.pearls_overworld = { surveyTo: { x: portal.x, y: portal.y, z: portal.z }, description: `Go back to the Overworld for the pearls: endermen spawn in the dark there, in ones and twos anywhere on the surface, each dropping a pearl about half the time; a patrol hunts one in view and explores or goes on an expedition between${cleric ? ', and a cleric\'s pearl trade is known' : ''}. ${portalTrip(bot, goal)} Chosen, it holds half an hour or until the pearls are carried; ${plural(rods, 'blaze rod')} carried, and with rods still short the ladder comes back into the Nether for them after the pearls.`,
        run: async () => { goal.pearlRoute = { pick: 'overworld', at: now, until: now + PEARL_ROUTE_MS }; save(); } };
    } else if (!portals.length) notOffered.push('back to the Overworld for its endermen: no portal is remembered in the Nether');
  } else {
    // In the Overworld on the Overworld's route: the Nether's warped forest
    // instead, the route dropped.
    const { pearlRouteHeld } = require('./game-progress');
    const held = pearlRouteHeld(goal, now);
    if (held?.pick === 'overworld') options.pearls_nether = { description: `Drop the Overworld's hunt chosen ${plural(Math.max(1, Math.round((now - held.at) / 60000)), 'minute')} ago and go back into the Nether for a warped forest's endermen, where they spawn in numbers.`,
      run: async () => { delete goal.pearlRoute; save(); } };
  }
  return { options, notOffered };
}

module.exports = { pearlRoutes, blocksCarried };
