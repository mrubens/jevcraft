'use strict';
// The ghast, as the 26.1.2 server jar has it, for the stance question: when
// it fires, how its fireball flies, what sends the fireball back, what its
// blast breaks, and how many arrows bring it down. mid-235-p-nether-4-
// fortress-2 hid from one at 15.3 health, told the ghast "has none within
// the fifteen seconds" (a walker's way to a line: a ghast flies and drifts),
// with no way offered to send a fireball back or shoot it past twenty
// blocks; it was struck six more times and died (note 551).
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ghast$GhastShootFireballGoal: it fires only at a target within 64 blocks
// it can see; each tick in sight adds one to its charge (one taken off each
// tick out of it), it shrieks at 10 and fires at 20, and the charge goes
// back to -40: a fireball about a second after it has a line, then one
// every three seconds while it keeps it. The fireball starts four blocks
// in front of it. Ghast.createAttributes: 10 health. Its explosion power
// is 1.
const GHAST = { reach: 64, health: 10, firstShot: 1, every: 3, spawnAhead: 4, power: 1 };

// AbstractHurtingProjectile: each tick the fireball's motion gains 0.1
// along itself and is then scaled by 0.95 (toward 1.9 blocks a tick),
// before it moves. It starts at 0.1 a tick. Struck back by a player
// (Player.deflectProjectile, ProjectileDeflection.AIM_DEFLECT) its motion
// becomes the player's look, one block a tick, and it gains as before
// (onDeflection resets the gain to 0.1).
function flightSeconds(distance, { start = 0, speed = 0.1 } = {}) {
  let at = start, v = speed, ticks = 0;
  while (at < distance && ticks < 400) { v = (v + 0.1) * 0.95; at += v; ticks++; }
  return Math.round(ticks / 20 * 10) / 10;
}
const outSeconds = distance => flightSeconds(distance, { start: GHAST.spawnAhead });
const backSeconds = distance => flightSeconds(distance, { speed: 1 });

// Player.attack: a projectile tagged redirectable_projectile (fireball,
// wind_charge, breeze_wind_charge) that is struck is deflected, before any
// damage, whatever is in the hand and however charged the swing, its owner
// the player. Ghast.hurtServer: a large fireball owned by a player hits it
// for 1000. The server takes a strike at an entity whose box is within the
// player's interaction range (3) and three more of the eyes
// (ServerGamePacketListenerImpl.handleInteract): six blocks. An arrow does
// not send it back: AbstractHurtingProjectile.hurtServer takes nothing.
const STRIKE_REACH = 6, STRIKE_AT = 5;

// ServerExplosion.calculateExplodedPositions: each ray starts at the power
// times 0.7 to 1.3, and every block it meets takes (resistance + 0.3) x 0.3
// off it; the block breaks while something is left. A ghast's power of 1
// is at most 1.3 at a block: one with a blast resistance of about 4 or more
// is never broken (cobblestone, stone, deepslate, blackstone, basalt, end
// stone, obsidian), below it may be (netherrack 0.4, dirt 0.5, planks 3).
const HOLDS_AT = 1.3 / 0.3 - 0.3;
function blastResistance(bot, name) { return bot.registry?.blocksByName?.[name]?.resistance ?? null; }
// The building blocks carried, each with whether a ghast's blast breaks it.
function carriedAgainstBlast(bot, materials) {
  const counts = new Map();
  for (const i of bot.inventory?.items?.() || []) if (materials.has(i.name)) counts.set(i.name, (counts.get(i.name) || 0) + i.count);
  return [...counts].map(([name, count]) => { const r = blastResistance(bot, name); return { name, count, resistance: r, holds: r != null && r >= HOLDS_AT }; })
    .sort((a, b) => b.holds - a.holds || b.count - a.count);
}
function blastProofMaterial(bot, materials, need = 1) {
  return carriedAgainstBlast(bot, materials).find(b => b.holds && b.count >= need)?.name || null;
}
function coverSays(bot, materials) {
  const list = carriedAgainstBlast(bot, materials);
  if (!list.length) return '';
  const say = b => `${b.name.replaceAll('_', ' ')} (${b.count}, blast resistance ${b.resistance})`;
  const holds = list.filter(b => b.holds), breaks = list.filter(b => !b.holds);
  return ` A ghast's fireball blast breaks a block with a blast resistance under about 4 and never one of 4 or more.${holds.length ? ` Carried that holds: ${holds.map(say).join(', ')}; the cover is put from it.` : ' None of the blocks carried holds: the cover can be blown out by the fireball it stops.'}${breaks.length ? ` Carried that it can break: ${breaks.map(say).join(', ')}.` : ''}`;
}

// Said with every stance while a ghast is about: when it fires, and that it
// does not come by a way.
function ghastNote(danger, hit) {
  const ghasts = danger.filter(t => t.entity?.name === 'ghast' && t.distance <= GHAST.reach);
  if (!ghasts.length) return '';
  const g = ghasts[0];
  return ` The ghast ${Math.round(g.distance)} blocks off fires only at a bot it can see within ${GHAST.reach} blocks: its fireball about ${GHAST.firstShot} second after it has a line, then one every ${GHAST.every} seconds while it keeps it, each taking about ${outSeconds(g.distance)} seconds to cross ${Math.round(g.distance)} blocks${hit ? ` and about ${hit} after armour where it lands` : ''}. It drifts through the air at random and walks no way, so when it next has a line on a hidden bot cannot be worked out.`;
}

// Sending its fireball back: offered with a ghast in the bot's sight within
// its reach. Nothing is needed in the hand.
function returnOption(bot, danger, { hit = 0, others = null } = {}) {
  const g = danger.filter(t => t.entity?.name === 'ghast' && t.visible && t.distance <= GHAST.reach).sort((a, b) => a.distance - b.distance)[0];
  if (!g) return null;
  const d = Math.round(g.distance), out = outSeconds(g.distance), back = backSeconds(g.distance);
  // One missed fireball, then the next struck: its charge, the flight, the
  // three seconds to the next one and that flight.
  const seconds = Math.min(15, Math.round((GHAST.firstShot + out + GHAST.every + out + back) * 10) / 10);
  const damage = Math.round((hit + (others?.damage || 0)) * 10) / 10;
  const description = `Stand in the ghast's line ${d} blocks off, look at it, and strike its fireball when it comes within ${STRIKE_AT} blocks: struck with anything, or a bare hand, a fireball flies back the way the bot looks, and one that hits the ghast kills it outright (its 10 health). It fires about ${GHAST.firstShot} second after it has the bot in sight and every ${GHAST.every} seconds after; each fireball takes about ${out} seconds to come ${d} blocks, about ${back} to go back, and the ghast drifts meanwhile. The fireball comes up to 1.9 blocks a tick: the strike has about two ticks, the bot's look must be on the ghast at that moment, and no trial has yet measured how often it is struck or how often a struck one hits. A fireball not struck lands for about ${hit} after armour, sets the bot alight and pushes it; an arrow does not send it back. Priced with one fireball missed: about ${damage} damage in about ${seconds} seconds${others?.damage ? `, ${Math.round(others.damage * 10) / 10} of it from the other mobs here while the bot stands in the open` : ''}.`;
  return { ghast: g, expects: { damage, seconds, oneHit: hit }, description };
}

// Watching for the fireball and striking it: a few seconds at a time, then
// back to the stance question (held while it holds). True once the ghast is
// gone or the watch ran its time; the look stays on the ghast between.
async function returnFireball(bot, task, ghast, { seconds = 4 } = {}) {
  const until = Date.now() + seconds * 1000;
  const centre = e => e.position.offset(0, (e.height || 4) / 2, 0);
  const eye = () => bot.entity.position.offset(0, 1.62, 0);
  // The distance from the eyes to the fireball's box (1 x 1), as the server
  // measures a strike.
  const boxDistance = e => { const p = eye(), c = e.position; const dx = Math.max(0, Math.abs(p.x - c.x) - 0.5), dy = Math.max(0, Math.abs(p.y - (c.y + 0.5)) - 0.5), dz = Math.max(0, Math.abs(p.z - c.z) - 0.5); return Math.hypot(dx, dy, dz); };
  const struck = new Set();
  let strikes = 0;
  while (Date.now() < until) {
    task?.check?.();
    const g = bot.entities?.[ghast.id];
    if (!g || g.isValid === false) return { done: true, ghastGone: true, strikes };
    const coming = Object.values(bot.entities || {}).filter(e => e.name === 'fireball' && e.position && e.isValid !== false && !struck.has(e.id))
      .map(e => ({ e, d: boxDistance(e), next: e.velocity ? e.position.plus(e.velocity).distanceTo(eye()) : null }))
      .filter(f => f.next == null || f.next < f.e.position.distanceTo(eye()))
      .sort((a, b) => a.d - b.d)[0];
    await bot.lookAt?.(centre(g), true);
    if (coming && coming.d <= STRIKE_AT) {
      try { bot.attack(coming.e); strikes++; struck.add(coming.e.id); } catch (_) { /* the next tick looks again */ }
    }
    await sleep(50);
  }
  return { done: true, strikes };
}

// The arrows that bring a ghast down from this far: an arrow leaves a full
// bow at 3 blocks a tick and keeps 0.99 of it each tick; it lands for its
// speed times 2, rounded up (AbstractArrow.onHitEntity), and a full draw's
// critical adds more at random.
function arrowAt(distance) {
  let at = 0, v = 3, ticks = 0;
  while (at < distance && ticks < 200) { at += v; v *= 0.99; ticks++; }
  const damage = Math.ceil(v * 2);
  return { seconds: Math.round(ticks / 20 * 100) / 100, damage, arrows: Math.ceil(GHAST.health / damage) };
}
function bowSays(t, arrowsCarried) {
  const a = arrowAt(t.distance);
  return `Shoot the ghast ${Math.round(t.distance)} blocks off with the bow from here, each arrow about a second to draw, standing still in its line: an arrow takes about ${a.seconds} seconds to get there and lands for at least ${a.damage}, so about ${a.arrows} that land bring down its ${GHAST.health} health (${arrowsCarried} carried). It drifts while the arrow flies, and no trial has yet measured how often one lands from this far.`;
}

module.exports = { GHAST, STRIKE_REACH, STRIKE_AT, HOLDS_AT, flightSeconds, outSeconds, backSeconds, carriedAgainstBlast, blastProofMaterial, coverSays, ghastNote, returnOption, returnFireball, arrowAt, bowSays };
