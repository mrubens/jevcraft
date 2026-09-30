'use strict';
// Out of every shooter's line when one shot is the end (note 701).
//
// Fable's check-in of 2026-09-29 22:50Z: 25581 answered corner_ambush twice
// at 2.2 health with four blazes in sight, and died. Over the flight records
// since 12:00Z, 82 deaths in fights with blazes: in 42 the last stance was
// chosen under 6 health, and in 39 of those a blaze had the bot in sight as
// it was chosen (scripts/low-health-record.js); corner_ambush 8, close_in 7,
// leave_and_heal 6, retreat 5. At a health where one shot that lands ends
// the bot, standing in a shooter's line while the question is out and while
// what was chosen gets going is a matter of the body, not a judgment: a
// player steps behind the nearest rock before thinking. So before the
// stance is asked there, the bot steps to the nearest cell out of every
// shooter's line, or puts a block in the lines, whichever is sooner; then
// the stance is asked, the rule and its numbers said.
//
// The threshold is the game's numbers, said with the rule: a shot's hit
// through the armour worn (combat-estimate MOBS, afterArmour) and, for a
// blaze's fireball, the fire it sets (five seconds, about four more health,
// FIRE_TICKS, and none of it put out in the Nether), the fire already on the
// body counted first (landingsToEnd). Under fire resistance a blaze's
// fireball does nothing (its hurt is fire) and is not counted.
const r1 = n => Math.round(n * 10) / 10;

// One landing's end: the shooters with a line to `cell` whose one shot that
// lands ends the bot from its health now.
// -> { health, alight, lined: [{ e, hit, fire, cost }], worst, says } or null.
function lethal(bot, danger, cell, { shooter = require('./mob-policy').shooter } = {}) {
  const ce = require('./combat-estimate');
  const shooters = (danger || []).map(t => t.entity || t).filter(e => e?.position && shooter(e));
  if (!shooters.length || !(bot?.health > 0)) return null;
  const seen = require('./bunker').seenFrom(bot, shooters, cell);
  if (!seen.length) return null;
  const worn = ce.armourOf([5, 6, 7, 8].map(s => bot.inventory?.slots?.[s]?.name).filter(Boolean));
  const alight = ce.burnLeft(bot);
  let proof = 0; try { proof = require('./fire-resistance').left(bot); } catch (_) { proof = 0; }
  const health = bot.health;
  const lined = [];
  for (const e of seen) {
    const m = ce.MOBS[e.name];
    if (!m?.hit) continue;
    const fireShot = ce.FIRE_SHOTS.has(e.name);
    if (fireShot && proof > 0) continue;
    const hit = ce.afterArmour(m.hit, worn);
    const fire = fireShot ? Math.max(0, ce.FIRE_TICKS.fireball - alight) : 0;
    const ends = fireShot ? ce.landingsToEnd(health, hit, alight) <= 1 : hit + Math.floor(alight) >= health;
    if (ends) lined.push({ e, hit, fire, cost: hit + fire });
  }
  if (!lined.length) return null;
  const worst = lined.sort((a, b) => b.cost - a.cost)[0];
  const kinds = [...new Set(lined.map(l => l.e.name.replaceAll('_', ' ')))];
  const says = `At ${r1(health)} health one shot that lands ends the bot: a ${worst.e.name.replaceAll('_', ' ')}'s is about ${r1(worst.hit)} through the armour worn${worst.fire ? `, and the fire it sets about ${r1(worst.fire)} more` : ''}${alight > 0 ? `, with the fire already on the bot` : ''}. ${lined.length === 1 ? `A ${kinds[0]} has` : `${lined.length} shooters (${kinds.join(', ')}) have`} a line to it here. The rule at a health where one shot ends it: out of every shooter's line first (the nearest cell no line reaches, or a block put in the line, whichever is sooner), then the stance is asked.`;
  return { health, alight, lined, worst, says };
}

// The sooner way out of every line: a walk to the nearest cell no line
// reaches (bunker.coverWithin, 4.3 blocks a second), or blocks put in each
// lined shooter's line (creeper-sight.blockPlan, 0.6 seconds a block).
// -> { how: 'walk', cell, steps, path, seconds } | { how: 'block', plans, cells, seconds } | null
const WALK_BPS = 4.3, BLOCK_SECONDS = 0.6;
function wayOut(bot, danger, L, { shooter = require('./mob-policy').shooter, blocks = 0, canPlace = true, avoid = [], skip = () => false } = {}) {
  const shooters = (danger || []).map(t => t.entity || t).filter(e => e?.position && shooter(e));
  let walk = null;
  try { const c = require('./bunker').coverWithin(bot, shooters, { steps: 8, avoid, skip }); if (c && c.steps) walk = { how: 'walk', cell: c.cell, steps: c.steps, path: c.path, seconds: r1(c.steps / WALK_BPS) }; } catch (_) { walk = null; }
  let block = null;
  if (canPlace && blocks > 0) {
    try {
      const { blockPlan } = require('./creeper-sight');
      // Every shooter with a line here, not only those whose shot ends it:
      // the bot is out of every line or it is not.
      const lined = require('./bunker').seenFrom(bot, shooters, require('./terrain').feetCell(bot));
      const plans = lined.map(e => ({ e, plan: blockPlan(bot, e) }));
      const cells = plans.reduce((n, p) => n + p.plan.cells.length, 0);
      if (plans.length && plans.every(p => p.plan.cells.length || p.plan.stoppedBy) && cells && cells <= blocks) block = { how: 'block', plans, cells, seconds: r1(cells * BLOCK_SECONDS) };
    } catch (_) { block = null; }
  }
  if (walk && block) return walk.seconds <= block.seconds ? walk : block;
  return walk || block;
}

module.exports = { lethal, wayOut, WALK_BPS, BLOCK_SECONDS };
