'use strict';
// One hit ends the bot and health cannot come back (note 706).
//
// 25588 (mid-243-hf) sat at 0.2 to 1.2 health with hunger 7 to 9 and nothing
// to eat for over ten minutes in the Nether (2026-09-30, 00:47 to 00:59Z).
// The questions it was asked went on as if that were one fact among many:
// upkeep's stems and a spare wooden pickaxe, a staircase's rest spent on
// "other work", keep_on ("go on without food for twenty minutes"), and a trip
// home to a portal whose way had just been found unreachable. A player at half
// a heart with no food does one of two things: gets food, or takes no risk.
//
// Here that state is said once, in the game's numbers: health under the
// lightest blow the dimension's hostile mobs deal through the armour worn,
// with hunger under 18 and not brought to 18 by what is carried (natural
// health comes back only at 18 or more). Nothing here gates an answer; the
// questions say it first (decisions/index.js), and the options that promise
// to go on without food are not offered while it holds (nether-food.js,
// nether-travel.js).
const r1 = n => Math.round(n * 10) / 10;
const KINDS = {
  nether: ['blaze', 'ghast', 'zombified_piglin', 'piglin', 'hoglin', 'magma_cube', 'wither_skeleton', 'skeleton'],
  overworld: ['zombie', 'skeleton', 'spider', 'creeper'],
  end: ['enderman'],
};
const dim = bot => { const d = String(bot?.game?.dimension || 'overworld'); return /nether/.test(d) ? 'nether' : /end/.test(d) ? 'end' : 'overworld'; };

// -> null or { health, hunger, points, lightest, kind, says }
function lastHit(bot) {
  const health = bot?.health, hunger = bot?.food ?? 20;
  if (!(health > 0) || health >= 20 || hunger >= 18) return null;
  if (bot.game?.gameMode === 'creative' || bot.game?.difficulty === 'peaceful') return null;
  let points = 0; try { points = require('./food-facts').carried(bot).points; } catch (_) { points = 0; }
  if (Math.min(20, hunger + points) >= 18) return null;
  const ce = require('./combat-estimate');
  const worn = ce.armourOf([5, 6, 7, 8].map(s => bot.inventory?.slots?.[s]?.name).filter(Boolean));
  let lightest = Infinity, kind = null;
  for (const k of KINDS[dim(bot)]) {
    const m = ce.MOBS[k];
    if (!m?.hit) continue;
    const least = Math.min(m.least ?? m.hit, ...(m.splits || []).map(s => s.hit));
    const hit = ce.afterArmour(least, worn);
    if (hit < lightest) { lightest = hit; kind = k; }
  }
  // The mobs about now count as well (note 2404): the lightest blow of the dimension's mobs is a piglin's or a magma
  // cube's, and full-21 (25589, 2026-10-28 17:12 to 17:3xZ) sat at 6.6 health with hunger 13 and nothing to eat beside a
  // blaze spawner, its blazes' fireball about 2.7 through its iron and five of fire after; no hit was the last by the
  // lightest, so its 'go on without food' held and no food was asked for half an hour.
  let about = null;
  try {
    const here = bot.entity?.position;
    for (const e of Object.values(bot.entities || {})) {
      const m = e?.name && ce.MOBS[e.name];
      if (!m?.hit || !here || !e.position || e.position.distanceTo(here) > 16 || e.isValid === false) continue;
      let hit = ce.afterArmour(m.hit, worn);
      if (e.name === 'blaze' && typeof ce.landingCost === 'function') hit = ce.landingCost(hit);
      if (!about || hit > about.hit) about = { hit, kind: e.name, distance: e.position.distanceTo(here) };
    }
  } catch (_) { about = null; }
  if (about && health <= about.hit && (!kind || health > lightest)) { lightest = about.hit; kind = about.kind; }
  if (!kind || health > lightest) return null;
  const place = { nether: "the Nether's", overworld: "the Overworld's", end: "the End's" }[dim(bot)];
  const food = points ? `${points} food points carried bring hunger only to ${Math.min(20, hunger + points)}` : 'nothing to eat carried';
  const byAbout = about && kind === about.kind && lightest === about.hit;
  const says = `At ${r1(health)} health ${byAbout ? `a hit from the ${kind.replaceAll('_', ' ')} ${Math.round(about.distance)} blocks off ends the bot: about ${r1(lightest)} through the armour worn${kind === 'blaze' ? ', its fire counted' : ''}` : `any hit ends the bot: the lightest blow of ${place} mobs is about ${r1(lightest)} through the armour worn (a ${kind.replaceAll('_', ' ')}'s)`}, and a drop of four blocks costs one. Health does not come back: hunger ${hunger}, under 18, and ${food}. Only food brings it back; a way that brings none risks the end and gains no health.`;
  return { health: r1(health), hunger, points, lightest: r1(lightest), kind, says };
}

// The short line an option adds where it risks a hit and brings no food.
function riskSays(bot) {
  const h = lastHit(bot);
  return h ? ` At ${h.health} health any hit ends it, and this brings no food.` : '';
}

module.exports = { lastHit, riskSays, KINDS };
