'use strict';
// The ghast, as the 26.1.2 server jar has it, for the stance question: when
// it fires, how its fireball flies, what sends the fireball back, what its
// blast breaks, and how many arrows bring it down. mid-235-p-nether-4-
// fortress-2 hid from one at 15.3 health, told the ghast "has none within
// the fifteen seconds" (a walker's way to a line: a ghast flies and drifts),
// with no way offered to send a fireball back or shoot it past twenty
// blocks; it was struck six more times and died (note 551).
const { Vec3 } = require('vec3');
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
// for 1000. In 26.1 a strike is its own packet (ServerboundAttackPacket,
// which mineflayer's bot.attack sends); handleAttack takes it while the
// struck entity's box is within the attack range of the eyes, and with no
// attack_range on the item that is the entity interaction range (3) and a
// slack of 3 (Player.isWithinAttackRange, AttackRange.defaultFor): six
// blocks. No charge is asked of a plain item (cannotAttackWithItem looks
// only at a minimum_attack_charge) and the deflection comes before any
// damage, so a strike every tick is taken every tick. The fireball struck
// flies along the player's look (ProjectileDeflection.AIM_DEFLECT,
// getLookAngle), and is sent to the clients at once (needsSync). An arrow
// does not send it back: AbstractHurtingProjectile.hurtServer takes nothing.
const STRIKE_REACH = 6;

// Where the fireball is now. The server sends a fireball's place only every
// ten ticks (EntityType FIREBALL updateInterval 10, ServerEntity.sendChanges)
// and a client flies it between; mineflayer does not, so bot.entities has it
// where it was up to half a second before, when it comes up to 1.9 blocks a
// tick. The strike struck a fireball within five blocks as last sent, and
// the server takes the strike only in the three or four ticks before the
// fireball lands, which an update every ten ticks falls in at nine
// distances in fifty from fifteen to sixty-four. Live it was chosen eleven
// times on 28 September, sent a strike at four fireballs, none was seen to
// go back and no ghast was killed (note 574). Now the fireball is flown
// between its updates as the server flies it, from its last place and its
// motion, and struck on every tick it is within reach.
const TICK_MS = 50;
// The motion as the packet carries it: an lpVec3 in blocks a tick since
// 1.21.9 (mineflayer 4.39 divides it by 8000 as the older integer vector,
// which compatibility.js undoes on bot.entities); a vector past 4 is the
// older one.
const perTick = v => v && [v.x, v.y, v.z].every(Number.isFinite)
  ? (Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) > 4 ? { x: v.x / 8000, y: v.y / 8000, z: v.z / 8000 } : { x: v.x, y: v.y, z: v.z }) : null;
// AbstractHurtingProjectile.tick: the gain and the drag, then the move.
function flyTicks(pos, v, ticks) {
  let p = new Vec3(pos.x, pos.y, pos.z), m = new Vec3(v.x, v.y, v.z);
  const whole = Math.min(200, Math.floor(ticks)), step = () => { const n = m.norm(); return n > 0 ? m.plus(m.scaled(0.1 / n)).scaled(0.95) : m; };
  for (let i = 0; i < whole; i++) { m = step(); p = p.plus(m); }
  const part = ticks - Math.floor(ticks);
  if (part > 0 && whole < 200) p = p.plus(step().scaled(part));
  return { position: p, velocity: m };
}
// Toward the bot's middle at the speed a fireball starts at, for one seen
// without its motion.
function towardBot(bot, from) {
  const d = bot.entity.position.offset(0, 0.9, 0).minus(from), n = d.norm() || 1;
  return { x: d.x / n * 0.1, y: d.y / n * 0.1, z: d.z / n * 0.1 };
}
// Each fireball seen while the watch runs: its last place and when it came,
// its motion (from the packet, or from two places), and where it is now.
function fireballTracker(bot, { now = Date.now } = {}) {
  const balls = new Map();
  const onSpawn = p => {
    if (bot.entities?.[p.entityId]?.name !== 'fireball') return;
    balls.set(p.entityId, { id: p.entityId, pos: new Vec3(p.x, p.y, p.z), at: now(), v: perTick(p.velocity) });
  };
  const onVelocity = p => { const b = balls.get(p.entityId), v = perTick(p.velocity); if (b && v) { b.v = v; b.vAt = now(); } };
  const onMoved = e => {
    if (e?.name !== 'fireball' || !e.position) return;
    const t = now(), b = balls.get(e.id);
    if (!b) { balls.set(e.id, { id: e.id, pos: e.position.clone(), at: t, v: null }); return; }
    // No motion packet with this place: the motion is the way it went.
    const ticks = (t - b.at) / TICK_MS;
    if (!(b.vAt >= b.at) && ticks >= 1) { const d = e.position.minus(b.pos); b.v = { x: d.x / ticks, y: d.y / ticks, z: d.z / ticks }; }
    b.pos = e.position.clone(); b.at = t;
  };
  bot._client?.on?.('spawn_entity', onSpawn);
  bot._client?.on?.('entity_velocity', onVelocity);
  bot.on?.('entityMoved', onMoved);
  // One already in the air: where it was last sent, flying at the bot.
  for (const e of Object.values(bot.entities || {})) if (e?.name === 'fireball' && e.position && e.isValid !== false)
    balls.set(e.id, { id: e.id, pos: e.position.clone(), at: now(), v: null });
  return {
    balls,
    at(b, t = now()) {
      const e = bot.entities?.[b.id];
      if (!e || e.isValid === false) return null;
      return flyTicks(b.pos, b.v || towardBot(bot, b.pos), Math.max(0, (t - b.at) / TICK_MS));
    },
    stop() {
      bot._client?.removeListener?.('spawn_entity', onSpawn);
      bot._client?.removeListener?.('entity_velocity', onVelocity);
      bot.removeListener?.('entityMoved', onMoved);
    },
  };
}
// The look goes out with the bot's next physics tick (mineflayer physics.js:
// 'physicsTick' is emitted, then updatePosition sends it); a strike sent
// before it would go with the look before. Resolves once it is out.
function afterLookSent(bot, ms = 60) {
  if (typeof bot.once !== 'function') return sleep(TICK_MS);
  return new Promise(resolve => {
    let done = false;
    const onTick = () => setImmediate(finish);
    const finish = () => { if (done) return; done = true; clearTimeout(timer); bot.removeListener?.('physicsTick', onTick); resolve(); };
    const timer = setTimeout(finish, ms);
    bot.once('physicsTick', onTick);
  });
}

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

// What the strike has done live. Before note 574 it struck where the
// fireball had last been sent (above): chosen eleven times in the trials of
// 28 September, a strike sent at four fireballs, none seen to go back, no
// ghast killed; six fireballs landed during those watches and three of the
// runs died of them, two thrown into lava. Since, the bot's own count, kept
// with the goal (goal.fireballReturns).
const LIVE_BEFORE = { chosen: 11, struck: 4, sentBack: 0, killed: 0, landed: 6, died: 3, intoLava: 2 };
function measured(since) {
  const s = since || {};
  const sentBack = LIVE_BEFORE.sentBack + (s.sentBack || 0), landed = LIVE_BEFORE.landed + (s.landed || 0);
  const b = LIVE_BEFORE;
  const before = `Measured live so far: before its strike was timed by the fireball's flight, it was chosen ${b.chosen} times in trials, a strike was sent at ${b.struck} fireballs, none was seen to go back and no ghast was killed; ${b.landed} fireballs landed during those watches, and ${b.died} of those runs died of them, ${b.intoLava} thrown into lava.`;
  const after = s.watches ? ` Since then, by this bot: ${s.watches} watch${s.watches === 1 ? '' : 'es'}, ${s.came || 0} fireball${s.came === 1 ? '' : 's'} came, ${s.struck || 0} struck at, ${s.sentBack || 0} seen to go back, ${s.killed || 0} ghast${s.killed === 1 ? '' : 's'} killed, ${s.landed || 0} landed.` : ' Since then it has not been tried.';
  return { says: before + after, sentBack, landed, rate: sentBack + landed ? sentBack / (sentBack + landed) : 0 };
}

// Sending its fireball back: offered with a ghast in the bot's sight within
// its reach. Nothing is needed in the hand. Priced by what it has measured:
// with none sent back yet, every fireball of the watch lands; over a drop a
// shooter can push the bot off (survival.js shotOverEdge), one that lands
// is that fall (note 563), and the price says so rather than the fireball's
// own damage.
function returnOption(bot, danger, { hit = 0, others = null, since = null, over = null } = {}) {
  const g = danger.filter(t => t.entity?.name === 'ghast' && t.visible && t.distance <= GHAST.reach).sort((a, b) => a.distance - b.distance)[0];
  if (!g) return null;
  const d = Math.round(g.distance), out = outSeconds(g.distance), back = backSeconds(g.distance);
  const record = measured(since);
  // The next two fireballs: its charge, the flight, the three seconds to
  // the next one and its flight; each lands but for the share measured sent
  // back.
  const seconds = Math.min(15, Math.round((GHAST.firstShot + out + GHAST.every + out) * 10) / 10);
  const landing = 2 * (1 - record.rate);
  const damage = Math.round((hit * landing + (others?.damage || 0)) * 10) / 10;
  const share = `${record.sentBack} of the ${record.sentBack + record.landed} fireballs that came to the bot sent back`;
  const priced = over
    ? `Priced by that record (${share}): ${record.rate ? `about ${Math.round(landing * 10) / 10} of the next 2 fireballs landing` : 'both of the next 2 fireballs landing'}, and here the first that lands is the push over the drop below: the price is that fall, ${over.deadly ? 'the bot\'s death, and everything carried lost with it' : 'the fall and what it costs'}, not its ${hit} damage${others?.damage ? `, with ${Math.round(others.damage * 10) / 10} from the other mobs here while the bot stands in the open` : ''}.`
    : `Priced by that record (${share}): ${record.rate ? `about ${Math.round(landing * 10) / 10} of the next 2 fireballs landing` : 'both of the next 2 fireballs landing'}, about ${damage} damage in about ${seconds} seconds${others?.damage ? `, ${Math.round(others.damage * 10) / 10} of it from the other mobs here while the bot stands in the open` : ''}.`;
  const description = `Stand in the ghast's line ${d} blocks off, look at it, and strike its fireball as it comes: struck with anything, or a bare hand, a fireball flies back the way the bot looks, and one that hits the ghast kills it outright (its 10 health). It fires about ${GHAST.firstShot} second after it has the bot in sight and every ${GHAST.every} seconds after; each fireball takes about ${out} seconds to come ${d} blocks, about ${back} to go back, and the ghast drifts meanwhile. The server takes the strike only while the fireball is within ${STRIKE_REACH} blocks of the bot's eyes, the last three or four ticks before it lands (it comes up to 1.9 blocks a tick); the bot flies it between the server's updates (one each half second) and strikes on each of those ticks with its look on the ghast. ${record.says} A fireball not struck lands for about ${hit} after armour, sets the bot alight and pushes it; an arrow does not send it back. ${priced}`;
  return { ghast: g, expects: { damage, seconds, oneHit: hit }, description };
}

// Watching for the fireball and striking it: a few seconds at a time, then
// back to the stance question (held while it holds). The look stays on the
// ghast; each fireball coming is flown between its updates, and struck on
// every tick the server would take it (its box within six blocks of the
// eyes now or a tick on). What came of each is counted: sent back (its
// next update goes away from the bot), landed (gone within reach of the
// eyes, not sent back), and the ghast killed.
async function returnFireball(bot, task, ghast, { seconds = 4, now = Date.now } = {}) {
  const until = now() + seconds * 1000;
  const centre = e => e.position.offset(0, (e.height || 4) / 2, 0);
  const eye = () => bot.entity.position.offset(0, 1.62, 0);
  // The distance from the eyes to the fireball's box (1 x 1), as the server
  // measures a strike.
  const boxDistance = (p, c) => Math.hypot(Math.max(0, Math.abs(p.x - c.x) - 0.5), Math.max(0, Math.abs(p.y - (c.y + 0.5)) - 0.5), Math.max(0, Math.abs(p.z - c.z) - 0.5));
  const tracker = fireballTracker(bot, { now });
  const seen = new Map();
  const r = { done: true, strikes: 0, came: 0, struck: 0, sentBack: 0, landed: 0, killed: 0 };
  let dead = false;
  const onDead = e => { if (e?.id === ghast.id) dead = true; };
  bot.on?.('entityDead', onDead);
  try {
    // A fireball sent back is watched home (its flight back), to count
    // what it hit.
    const flying = () => [...seen.values()].some(s => s.back && !s.home);
    while (now() < until || (flying() && now() < until + 3000)) {
      task?.check?.();
      const g = bot.entities?.[ghast.id];
      if (!g || g.isValid === false || dead) { r.ghastGone = true; if (dead || r.sentBack) r.killed = 1; break; }
      await bot.lookAt?.(centre(g), true);
      await afterLookSent(bot);
      const t = now(), e = eye();
      for (const b of tracker.balls.values()) {
        if (!seen.has(b.id)) seen.set(b.id, {});
        const s = seen.get(b.id);
        if (s.back && !s.home && !tracker.at(b, t)) s.home = true;
        if (s.over) continue;
        const here = tracker.at(b, t);
        if (!here) { s.over = true; if (s.coming && !s.back && s.last != null && s.last <= STRIKE_REACH) r.landed++; continue; }
        const toward = here.velocity.dot(e.minus(here.position)) > 0;
        if (!toward) {
          // Its next update after a strike goes away from the bot: sent back.
          if (s.struckAt && Math.max(b.at, b.vAt || 0) > s.struckAt) { s.back = true; s.over = true; r.sentBack++; continue; }
          if (!s.coming) { s.over = true; continue; }
          // Flown on past the bot: it is gone (landed) or an update comes
          // (a deflection is sent at once); after a while, it went by.
          s.pastAt ||= t;
          if (t - s.pastAt > 600) s.over = true;
          continue;
        }
        if (!s.coming) { s.coming = true; r.came++; }
        const d = boxDistance(e, here.position); s.last = d;
        const next = boxDistance(e, tracker.at(b, t + TICK_MS)?.position || here.position);
        if (Math.min(d, next) <= STRIKE_REACH - 0.25) {
          const entity = bot.entities?.[b.id];
          try { bot.attack(entity); r.strikes++; if (!s.struckAt) { s.struckAt = t; r.struck++; } } catch (_) { /* the next tick strikes again */ }
        }
      }
    }
    if (!r.ghastGone) { const g = bot.entities?.[ghast.id]; if (!g || g.isValid === false || dead) { r.ghastGone = true; if (dead || r.sentBack) r.killed = 1; } }
  } finally { tracker.stop(); bot.removeListener?.('entityDead', onDead); }
  return r;
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

module.exports = { GHAST, STRIKE_REACH, HOLDS_AT, LIVE_BEFORE, flightSeconds, outSeconds, backSeconds, flyTicks, fireballTracker, carriedAgainstBlast, blastProofMaterial, coverSays, ghastNote, measured, returnOption, returnFireball, arrowAt, bowSays };
