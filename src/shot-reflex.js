'use strict';
// Shots, answered from where they come from, whatever the bot is doing
// (note 676).
//
// Trial 25589 was watched at a fortress being shot again and again with a
// shield in its off hand and its back to the blazes. Every shot that
// landed on the bot in the flight records of 2026-09-28 and 29 was read
// (scripts/shot-record.js): 2,555, 2,415 of them on a bot carrying a
// shield, and at the impact the shield was down for 1,715 (71%). Of those,
// 1,462 came with no code raising it at all: the shield rose only inside
// the survival layer's own turn (projectile-guard.js deflect, the blaze
// stances' shieldVolley), and the shots came during the work's steps, a
// walk, a meal, a question out to Jev (305 while encounter_stance was
// asked), or a stance that does not raise it; 253 came within a second of
// it going down; 201 within the quarter second it takes to rise; 89 with
// it up and the bot facing away (714 of the 2,415 came from behind or the
// side). A question's own latency was not the cause (1,269 of the 1,715
// came with no question out) and neither was the event loop (4 had the
// recorder silent over 1.5 seconds before). Of the 700 raised at the
// impact, 410 were up and facing the shot and still landed: the flag the
// code kept (_shieldRaised) was not the server's, which any main-hand use
// (a meal, a bow) ends while the flag stays up (combat.js raiseShield now
// reads the server's own flags).
//
// So the warning a shooter gives is Jev's to answer, as a player sees a
// blaze glow and decides: a blaze glows three seconds before its three
// shots (blaze-stand.js VOLLEY), a ghast opens its mouth half a second
// before, a skeleton draws its bow about a second. Jev answers in about a
// fifth of a second. Each warning is asked about as it begins, whatever the
// bot is doing (shot_answer): raise the shield and face it, step behind a
// block out of its line, strike it first, or keep on. The answer is carried
// out here, beside the step: the shield comes up when the shots are due and
// the step's walk waits behind it, then goes on.
//
// A shot already in the air on a line that hits, with no answer about it,
// is the reflex's: the shield up toward it, the walk held, until it has
// landed or gone by. The physical exceptions: in the air over lava or a
// drop (a turn there can put the landing off the edge), laying a span or a
// block on the way (the turn throws the placement and the crouch), in water
// or on a ladder (keys let go sink or slide the body), eating or drawing a
// bow (the raise ends the meal or the draw), and a biter at arm's length
// (the shield turned to the shot gives the biter the back:
// projectile-guard.js meleeClose).
const { Vec3 } = require('vec3');

const LIVING_FLAGS = 8;
const RISE_MS = 250;
// A charge or fight lowers the shield once a shooter is at the sword's
// reach, trusting the swing to answer instead (note 709). That trust holds
// only while a swing is actually landing: canStrike is a geometric test (in
// range, on ground that reaches), true whether or not the body is stuck.
// 25592 (mid-242-wa, note 737) charged a blaze the pathfinder could not
// step toward (see blaze-stand.js walkableToBlaze): canStrike stayed true
// the whole time at 0.8 to 1.1 blocks, no swing ever landed, and the
// blaze's own melee took the bot from 13.1 to 3.5 health with the shield
// down throughout. So the skip below also asks bot._defenseAttackAt
// (combat.js, set at every real swing): within STALL_MS of a swing, the
// melee is happening and the shield stays down for it; past that with
// nothing swung, the closing is stalled and the shield is the safety
// reflex's again.
const STALL_MS = 1500;
const swingingNow = (bot, now = Date.now()) => now - (bot._defenseAttackAt || 0) < STALL_MS;
const MOVE_KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint'];
// The shots, the shooters that fire them, and how near a line passes the
// body and still hits (the fireball's own width and a blast's reach).
const SHOTS = {
  small_fireball: { from: ['blaze'], miss: 1.0 }, fireball: { from: ['ghast'], miss: 2.2 },
  arrow: { from: ['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'piglin'], miss: 1.3 }, spectral_arrow: { from: [], miss: 1.3 },
  trident: { from: ['drowned'], miss: 1.3 }, wither_skull: { from: ['wither'], miss: 1.5 }, shulker_bullet: { from: ['shulker'], miss: 1.5 },
  llama_spit: { from: ['llama', 'trader_llama'], miss: 1.0 }, dragon_fireball: { from: ['ender_dragon'], miss: 2.5 },
};
const BOWMEN = new Set(['skeleton', 'stray', 'bogged', 'parched']);
// What a mob's shot is called, from SHOTS above (a blaze's and a ghast's
// are both fireballs; note 715, item 1: keep_on's "cost the ghast's about
// 4.8 health a shot" named no shot at all).
const MOB_SHOT_WORD = Object.fromEntries(Object.entries(SHOTS).flatMap(([shot, { from }]) => from.map(mob => [mob, shot === 'small_fireball' ? 'fireball' : shot.replaceAll('_', ' ')])));
const shotWord = name => MOB_SHOT_WORD[name] || 'shot';
// A warning: what the shooter shows before it shoots, from the game's own
// goals (26.1.2 jar). `dueFrom`: seconds into the warning the shots can
// come; `after`: seconds after it ends that a shot fired at its end is
// still in the air.
//   blaze: charged from its glow to its last shot, the shots 3.0, 3.3 and
//     3.6 seconds in (BlazeAttackGoal; blaze-stand.js VOLLEY).
//   ghast: is_charging the half second before its fireball (GhastShootFireballGoal).
//   a skeleton's kind: its hand in use while it draws, the arrow loosed at
//     a second (RangedBowAttackGoal).
// `most`: the longest a warning's answer holds from the warning's start
// (its last shot, its flight and a half second more), whatever is seen of
// its end: a shooter out of sight behind the block stepped behind is not
// seen to stop.
const WARNS = {
  blaze: { dueFrom: 2.4, after: 1.0, most: 5.1, says: 'glowing: its three fireballs come 3, 3.3 and 3.6 seconds after the glow begins' },
  ghast: { dueFrom: 0, after: 1.8, most: 2.8, says: 'opening its mouth: its fireball comes half a second after' },
  bow: { dueFrom: 0.5, after: 1.0, most: 3.0, says: 'drawing its bow: the arrow comes about a second after the draw begins' },
};
const warnKind = name => name === 'blaze' ? 'blaze' : name === 'ghast' ? 'ghast' : BOWMEN.has(name) ? 'bow' : null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// The server's own word on the shield: the bot's living entity flags, bit
// one an item in use, bit two the off hand. null before the server has
// said anything.
function flags(bot) { const f = bot.entity?.metadata?.[LIVING_FLAGS]; return typeof f === 'number' ? f : null; }
function shieldActive(bot) { const f = flags(bot); return f === null ? null : (f & 3) === 3; }
// The main hand in use: a meal, a bow's draw, a bucket.
function mainHandBusy(bot) { const f = flags(bot); return f !== null && (f & 1) === 1 && (f & 2) === 0; }
const shieldCarried = bot => bot.inventory?.slots?.[45]?.name === 'shield';

function metaIndex(bot, name, key) { return bot.registry?.entitiesByName?.[name]?.metadataKeys?.indexOf?.(key) ?? -1; }
// Whether this shooter is showing its warning now.
function warningOn(bot, e) {
  const kind = warnKind(e?.name);
  if (!kind) return false;
  if (kind === 'blaze') return require('./blaze-stand').charged(e);
  if (kind === 'ghast') { const i = metaIndex(bot, 'ghast', 'is_charging'); return !!e.metadata?.[i >= 0 ? i : 16]; }
  const f = e.metadata?.[LIVING_FLAGS];
  return typeof f === 'number' && (f & 1) === 1;
}

// Every shot the server has told of, from its own packets: the spawn with
// its velocity (in blocks a tick) and its owner, the velocity again as it
// changes. mineflayer divides these by 8000 as the older protocol wanted,
// and a fireball read so is still (projectile-guard.js judged every shot by
// its moves instead). Kept on bot._shots by id.
function watchShots(bot) {
  if (bot._shotWatch) return;
  bot._shotWatch = true;
  bot._shots ||= new Map();
  const client = bot._client;
  if (!client?.on) return;
  const typeName = t => bot.registry?.entities?.[t]?.name;
  client.on('spawn_entity', p => {
    const name = typeName(p.type);
    if (!SHOTS[name] || !p.velocity) return;
    const owner = bot.entities?.[p.objectData] || bot.entities?.[p.objectData - 1] || null;
    bot._shots.set(p.entityId, { id: p.entityId, name, at: Date.now(), from: new Vec3(p.x, p.y, p.z), v: new Vec3(p.velocity.x, p.velocity.y, p.velocity.z),
      owner: owner && SHOTS[name].from.includes(owner.name) ? owner.id : null });
    if (bot._shots.size > 200) for (const [id, s] of bot._shots) if (Date.now() - s.at > 10000) bot._shots.delete(id);
  });
  bot.on('entityMoved', e => { const s = bot._shots.get(e?.id); if (s) s.movedAt = Date.now(); });
  client.on('entity_velocity', p => {
    const s = bot._shots.get(p.entityId);
    if (s && p.velocity) s.v = new Vec3(p.velocity.x, p.velocity.y, p.velocity.z);
  });
  // What each shot on a line to the bot came to: landed (the server's hurt
  // from it), or gone near the body with the shield up (blocked), or gone
  // (missed). The tally is said to Jev (tallySays).
  client.on('damage_event', p => {
    if (!bot.entity || p.entityId !== bot.entity.id) return;
    const s = bot._shots.get(p.sourceDirectId - 1);
    if (s) s.landed = Date.now();
  });
  bot.on('entityGone', e => {
    const s = bot._shots.get(e?.id);
    if (!s) return;
    // The hurt comes with the shot's end: a moment for it.
    setTimeout(() => settle(bot, s), 150);
  });
}
// Up, by the server's word, and risen: raised a quarter second or more ago.
function shieldHeld(bot, now = Date.now()) {
  const active = shieldActive(bot);
  return (active === null ? !!bot._shieldRaised : active) && now - (bot._shieldRaisedAt || 0) >= RISE_MS;
}
// A shot on a line to the bot comes to an end: it landed (the server's
// hurt from it) or it did not, with the shield up or down as it ended. One
// that did not land with the shield down went wide, or the bot moved; one
// that did not land with it up was blocked or went wide.
function settle(bot, s) {
  bot._shots.delete(s.id);
  if (!s.hitting) return;
  const tally = bot._shotTally ||= { up: { landed: 0, not: 0 }, down: { landed: 0, not: 0 } };
  const up = shieldHeld(bot);
  tally[up ? 'up' : 'down'][s.landed ? 'landed' : 'not']++;
  // The hold's own tally, said to keep_on instead of only the average rate
  // (note 719: 25597 stood boxed 3.5 minutes with keep_on saying a landing
  // costs 3.9 health, true on average, while none had landed on the boxed
  // bot in that whole time).
  try {
    const held = require('./danger').stanceHeld(bot);
    if (held) { held.shotsFaced = held.shotsFaced || { landed: 0, not: 0 }; held.shotsFaced[s.landed ? 'landed' : 'not']++; }
  } catch (_) { /* no hold */ }
  bot.emit('shot', { name: s.name, landed: !!s.landed, shield: up ? 'up' : 'down', answer: s.answer || null, by: s.by || null });
}

// Where a shot is now: its last reported place carried on by its velocity
// since (a fireball's place is sent every half second, its velocity when it
// changes).
function shotAt(bot, s, now = Date.now()) {
  const e = bot.entities?.[s.id];
  const p = e?.position || s.from;
  const since = (now - (s.movedAt || s.at)) / 50;
  return p.plus(s.v.scaled(Math.min(20, since)));
}
// On a line that hits: the nearest the line comes to the body (feet to
// head, where the bot stands), ahead of the shot, within the shot's miss.
// Returns { seconds } to that point, or null.
function hitting(bot, s, now = Date.now()) {
  const here = bot.entity?.position;
  if (!here || !s.v) return null;
  const speed = s.v.norm();
  const at = shotAt(bot, s, now);
  if (speed < 1e-3) return null;
  const u = s.v.scaled(1 / speed);
  // The body's middle, and the point of it nearest the line.
  const mid = here.offset(0, 0.9, 0), r = mid.minus(at);
  const along = r.dot(u);
  if (along < -0.5) return null;
  const closest = at.plus(u.scaled(Math.max(0, along)));
  const dy = closest.y - mid.y, off = Math.hypot(closest.x - mid.x, closest.z - mid.z, Math.max(0, Math.abs(dy) - 0.9));
  if (off > SHOTS[s.name].miss) return null;
  // A fireball speeds up to about 1.9 blocks a tick; counted at no less
  // than half a block a tick, the time is the most it can be.
  return { seconds: Math.max(0, along) / (Math.max(speed, 0.5) * 20), at };
}

// A shot in the air on a line that hits the bot now (the meal waits for
// none, note 701).
function shotComing(bot, now = Date.now()) {
  for (const s of bot?._shots?.values?.() || []) if (hitting(bot, s, now)) return true;
  return false;
}

// The answers, per warning: bot._shotAnswers by shooter id, { key, choice,
// cell?, at }. A warning is keyed by its shooter and when it began.
function answerFor(bot, shooterId, now = Date.now()) {
  const a = bot._shotAnswers?.get(shooterId);
  if (!a) return null;
  const e = bot.entities?.[shooterId];
  const w = e?._shotWarn;
  // Good for the warning it was given for while it lasts (a blaze that
  // loses its line holds its glow and shoots when it has one again), then
  // until that warning's shots are past; a shooter gone from the client's
  // view, until the most a warning's shots take.
  if (w && w.key === a.key) return a;
  if (a.endsAt) return now <= a.endsAt ? a : null;
  if (!e && a.until && now <= a.until) return a;
  return null;
}
// Kept up each look: a warning begun (keyed), ended (its shots' last
// moment kept on the answer).
// The shooters with a warning on are looked at in sight or not: the glow's
// end is in the mob's own data, and one behind a block still stops.
function trackWarnings(bot, shooters, now = Date.now()) {
  const out = [];
  const warned = bot._shotWarned ||= new Set();
  const all = [...shooters, ...[...warned].map(id => bot.entities?.[id]).filter(e => e && !shooters.includes(e))];
  for (const id of [...warned]) if (!bot.entities?.[id]) warned.delete(id);
  for (const e of all) {
    const kind = warnKind(e.name);
    if (!kind) continue;
    const on = warningOn(bot, e);
    if (on && !e._shotWarn) {
      // A blaze's glow first seen part way is taken as begun when the
      // volley watch first saw it, else now.
      const began = kind === 'blaze' && e._glowAt ? e._glowAt : now;
      e._shotWarn = { key: `${e.id}:${began}`, at: began, kind };
      warned.add(e.id);
    }
    if (!on && e._shotWarn) {
      const a = bot._shotAnswers?.get(e.id);
      if (a && a.key === e._shotWarn.key) a.endsAt = now + WARNS[kind].after * 1000;
      e._shotWarn = null;
      warned.delete(e.id);
    }
    if (e._shotWarn && shooters.includes(e)) out.push(e);
  }
  return out;
}
// Due: the warning's shots can come now (or one is in the air).
function warnDue(bot, e, now = Date.now()) {
  const w = e._shotWarn;
  if (w) return now - w.at >= WARNS[w.kind].dueFrom * 1000;
  const a = bot._shotAnswers?.get(e.id);
  return !!(a?.endsAt && now <= a.endsAt);
}

// Why the shield cannot be turned to a shot now (the physical exceptions),
// or null.
function holdRefused(bot) {
  const e = bot.entity;
  if (!e) return 'no body';
  if (bot._spanning) return 'laying a span';
  if (bot.pathfinder?.isBuilding?.()) return 'placing a block on the way';
  if (bot._creativeFlight?.active || bot.vehicle) return 'flying or riding';
  if (e.isInWater || e.isInLava) return 'in water or lava';
  const at = e.position.floored(), feet = bot.blockAt?.(at);
  if (/ladder|vine|scaffolding/.test(feet?.name || '')) return 'on a ladder';
  // A meal the reflex cut for a shot on its way is not a refusal: the cut
  // is the raise (note 701).
  if (mainHandBusy(bot) && !require('./meal').mealOn(bot)?.cut) return 'eating or drawing a bow';
  if (!e.onGround) {
    // In the air: over lava, or over a drop of more than three.
    for (let dy = 0; dy >= -4; dy--) {
      const b = bot.blockAt?.(at.offset(0, dy, 0));
      if (!b) break;
      if (/lava/.test(b.name)) return 'in the air over lava';
      if (b.boundingBox === 'block') { if (dy <= -4) return 'in the air over a drop'; break; }
      if (dy === -4) return 'in the air over a drop';
    }
  }
  try { if (require('./projectile-guard').meleeClose(bot)) return 'a biter at arm\'s length'; } catch (_) { /* no mobs read */ }
  return null;
}

// The facing that covers the most of these points in its front half, the
// soonest first among equals; and those it leaves out. A point's weight
// (`w`, 1 by default) is how sure its shot is: a shot already in the air on
// a line that hits before a warned shooter with a line to the bot, and that
// before one out of its sight. On 25589 at 21:18:21Z the hold faced four
// glowing blazes behind rock (within 42 degrees) and turned its back (130
// degrees) on the one in sight, whose fireball landed through the raised
// shield, 9 to 5.1; it turned to that one, then back to the four, and the
// next landed too, 5.1 to 1.2 (note 691).
const weightOf = p => p.w ?? 1;
// A shot on its way outweighs any number of warnings; a shooter in sight,
// the rest of the room behind rock (at most six from one spawner).
const SHOT_W = 100, SEEN_W = 10;
function facingFor(bot, points) {
  const here = bot.entity.position;
  const dir = p => Math.atan2(-(p.x - here.x), -(p.z - here.z));
  const diff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const sum = list => list.reduce((n, q) => n + weightOf(q), 0);
  let best = null;
  for (const p of points) {
    const yaw = dir(p.at);
    const covered = points.filter(q => diff(dir(q.at), yaw) < Math.PI / 2 - 0.15);
    if (!best || sum(covered) > sum(best.covered)) best = { yaw, covered };
  }
  const mean = best.covered.reduce((s, q) => s.plus(q.at.scaled(weightOf(q))), new Vec3(0, 0, 0)).scaled(1 / sum(best.covered));
  return { point: mean, left: points.filter(p => !best.covered.includes(p)) };
}

// The body held behind the shield: the walk's keys and the looks of
// whatever else is running are not taken while a hold is on (the body
// lock), the look is the hold's. Put on the bot once.
function lockBody(bot) {
  if (bot._shotLock) return;
  bot._shotLock = true;
  const set = bot.setControlState.bind(bot), look = bot.look.bind(bot), lookAt = bot.lookAt.bind(bot);
  bot._shotRaw = { set, look, lookAt };
  // A hold carried while the stance closes (note 709) leaves the walk its keys and looks.
  const held = () => bot._shotHold && !bot._shotHold.free;
  bot.setControlState = (key, on) => { if (held() && on && MOVE_KEYS.includes(key)) return; return set(key, on); };
  bot.look = (...a) => held() ? Promise.resolve() : look(...a);
  bot.lookAt = (...a) => held() ? Promise.resolve() : lookAt(...a);
}

// One look, every tick: the warnings, the question about them, the shots
// in the air, and the hold.
function tick(bot, survival, now = Date.now()) {
  if (!bot.entity?.position) return;
  const carried = shieldCarried(bot);
  let shooters = [];
  // The shooters in sight, a few times a second (a sight line is a ray).
  if (!bot._shotLookAt || now - bot._shotLookAt >= 100) {
    bot._shotLookAt = now;
    try {
      const { threats } = require('./danger');
      // In sight, or within 24 blocks unseen: a blaze that glows behind a
      // pillar shoots the moment it has a line again, too soon for a
      // question then (the scratch server's blaze, note 676).
      const found = threats(bot, 64).filter(t => warnKind(t.entity.name) && (t.visible || t.distance <= 24));
      shooters = found.map(t => t.entity);
      bot._shotInSight = new Set(found.filter(t => t.visible).map(t => t.entity.id));
    } catch (_) { shooters = []; }
    bot._shotShooters = shooters.map(e => e.id);
    const warned = trackWarnings(bot, shooters, now);
    // Asked as each warning begins, one question out at a time.
    const fresh = warned.filter(e => !bot._shotAsked?.has(e._shotWarn.key));
    if (fresh.length && carried && !bot._shotAsking && survival) ask(bot, survival, fresh);
  }
  if (!carried) return release(bot);
  const guard = [];
  // A meal the bot chose, on (meal.js, note 701): the raise ends it, so no
  // warning's answer raises the shield while it is eaten; a shot already on
  // its way that lands inside the meal, late enough for the shield to block
  // it, cuts it, and the meal is begun again after.
  const meal = require('./meal').mealOn(bot, now);
  let eating = !!meal && !meal.cut;
  // A warning answered with the shield, its shots due.
  // Every shooter with a warning on or its shots in the air, in sight or
  // not: the shield held through a line lost for a moment.
  if (!eating) for (const id of new Set([...(bot._shotShooters || []), ...(bot._shotWarned || [])])) {
    const e = bot.entities?.[id], a = answerFor(bot, id, now);
    if (!e?.position || a?.choice !== 'shield_up' || !warnDue(bot, e, now)) continue;
    // A charge's shield (note 709): raised while it closes, down for its
    // swings once the shooter is at the sword's reach, but only while a
    // swing is actually landing (note 737): stuck at reach with nothing
    // swung, the shield is the safety reflex's again.
    if (a.closing && require('./combat').canStrike(bot, e) && swingingNow(bot, now)) continue;
    guard.push({ at: e.position.offset(0, (e.height || 1.8) / 2, 0), why: a.by === 'stance' ? `stance ${a.stance.replaceAll('_', ' ')}: shield up to the ${e.name}${a.closing ? ' while it closes' : ''}` : `answer: shield up to the ${e.name}`, w: bot._shotInSight?.has(id) ? SEEN_W : 1, ...(a.closing ? { closing: true } : {}) });
  }
  // A shot in the air on a line that hits.
  for (const s of bot._shots?.values?.() || []) {
    const h = hitting(bot, s, now);
    if (!h) continue;
    s.hitting = true;
    const a = s.owner != null ? answerFor(bot, s.owner, now) : null;
    s.answer = a?.choice || null;
    // Answered otherwise: Jev chose to step out of its line, strike first
    // or take it; the step it chose is what answers it.
    const answered = a && a.choice !== 'reflex' ? a : null;
    if (answered && answered.choice !== 'shield_up') continue;
    if (eating) {
      // Landing after the meal is eaten, or too soon for a raise to block:
      // the meal goes on.
      const inMs = h.seconds * 1000;
      if (inMs < RISE_MS || now + inMs > meal.endsAt) continue;
      require('./meal').cutMeal(bot, `a ${s.name.replaceAll('_', ' ')} on its way to the bot, landing in about ${round(h.seconds)} seconds, inside the meal: the shield raised for it`, now);
      eating = false;
    }
    s.by = answered ? 'answer' : 'reflex';
    guard.push({ at: h.at, why: answered ? 'answer: shield up' : a ? `reflex: a ${s.name.replaceAll('_', ' ')} on its way, the stance ${String(a.stance || '').replaceAll('_', ' ')} walking on` : `reflex: a ${s.name.replaceAll('_', ' ')} on its way, no answer about it`, shot: s, w: SHOT_W });
  }
  // Behind the block chosen: walked to while the warning is due or on.
  const cover = coverDue(bot, now);
  if (!guard.length && !cover) return release(bot, now);
  const refused = holdRefused(bot);
  if (refused) { bot._shotRefused = { why: refused, at: now }; return release(bot, now, true); }
  const hold = bot._shotHold ||= { since: now, raised: false, why: guard[0]?.why || 'cover' };
  hold.last = now;
  lockBody(bot);
  // Only a charge's warnings: the shield up, the walk and its looks its own.
  hold.free = !cover && guard.every(g => g.closing);
  if (hold.free) { hold.why = guard[0].why; if (require('./combat').raiseShield(bot)) hold.raised = true; return; }
  const { set, look } = bot._shotRaw;
  for (const k of MOVE_KEYS) set(k, false);
  if (require('./terrain').onSpan?.(bot)) set('sneak', true);
  if (cover && !guard.length) return walkCover(bot, cover);
  const { point } = facingFor(bot, guard);
  const eye = bot.entity.position.offset(0, 1.62, 0), d = point.minus(eye);
  look(Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)), true);
  if (require('./combat').raiseShield(bot)) hold.raised = true;
}
// The hold let go once nothing has called for it for a moment; the shield
// lowered only if the hold raised it.
const GRACE_MS = 250;
function release(bot, now = Date.now(), at_once = false) {
  const hold = bot._shotHold;
  if (!hold) return;
  if (!at_once && now - hold.last < GRACE_MS) return;
  bot._shotHold = null;
  if (hold.raised) require('./combat').lowerShield(bot);
}

// Behind a block: the cell chosen, walked to straight (two cells at most, on
// the level), held until the shots it was chosen for are past.
// Given up (the answer dropped, so the reflex meets the shots) once the
// cell is farther than the two steps it was chosen at: the step walked on
// while the question was out.
function coverDue(bot, now) {
  for (const [id, a] of bot._shotAnswers || []) {
    if (a.choice !== 'behind_cover' || !a.cell) continue;
    if (answerFor(bot, id, now) !== a) continue;
    const p = bot.entity.position;
    if (Math.hypot(p.x - a.cell.x - 0.5, p.z - a.cell.z - 0.5) > 2.6 || Math.abs(p.y - a.cell.y) > 0.6) { bot._shotAnswers.delete(id); continue; }
    return a;
  }
  return null;
}
function walkCover(bot, a) {
  const { set, look } = bot._shotRaw;
  const c = a.cell.offset(0.5, 0, 0.5), p = bot.entity.position;
  if (Math.hypot(p.x - c.x, p.z - c.z) < 0.3) return;
  look(Math.atan2(-(c.x - p.x), -(c.z - p.z)), 0, true);
  // The hold's own walk: the lock lets no other key down.
  set('forward', true);
}

// The options for these warnings (shot_answer).
function shotOptions(bot, warned) {
  const { MOBS, afterArmour, armourOf } = require('./combat-estimate');
  const worn = armourOf([5, 6, 7, 8].map(s => bot.inventory.slots?.[s]?.name).filter(Boolean));
  const here = bot.entity.position;
  const who = warned.map(e => `the ${e.name.replaceAll('_', ' ')} ${Math.round(e.position.distanceTo(here))} blocks off`).join(', ');
  const step = bot._survivalGoal?.step?.action || bot._goal?.step?.action || null;
  const doing = step ? `the step (${step.replaceAll('_', ' ')})` : 'what the bot is doing';
  const tree = {};
  if (shieldCarried(bot)) {
    const inSight = bot._shotInSight || new Set();
    const points = warned.map(e => ({ at: e.position, e, w: inSight.has(e.id) ? SEEN_W : 1 }));
    const { left, point } = facingFor(bot, points);
    const secs = Math.max(...warned.map(e => e._shotWarn?.kind === 'blaze' ? require('./blaze-stand').DUE_SECONDS : e._shotWarn?.kind === 'ghast' ? 2 : 1.5));
    const behind = behindSays(bot, point, warned);
    tree.shield_up = { description: `Face ${who} and hold the shield up while the shots come: ${doing} stops for about ${round(secs)} seconds and goes on after. The shield blocks only the half the bot faces${left.length ? `; the shooters are split, and ${left.map(p => `the ${p.e.name}`).join(', ')} would be behind it` : ''}.${behind.says} ${blockedSays(bot, warned)}`,
      // Split: a warned shooter, or a blaze in sight, outside the half faced.
      split: left.length > 0 || behind.seeing > 0 };
  }
  const cover = coverCell(bot, warned);
  if (cover) tree.behind_cover = { description: `Step ${cover.steps} block${cover.steps === 1 ? '' : 's'} to (${cover.cell.x}, ${cover.cell.y}, ${cover.cell.z}), out of the line of ${who}, and stay there while the shots come (until about ${round(Math.max(...warned.map(e => WARNS[e._shotWarn.kind].most - (Date.now() - e._shotWarn.at) / 1000)))} seconds from now); ${doing} goes on after.`, cell: cover.cell };
  // Not only a shooter with a warning on now: one that drifted to the
  // sword's reach between its own volleys is just as real a target, and a
  // player swings at it right then rather than waiting out its rest. 25589
  // (mid-242-wb, note 737) stood at a live spawner with blazes 3 to 6
  // blocks off at least five times, shot_answer flipping shield_up,
  // behind_cover and keep_on, and never swung: none of those blazes was
  // counted here because none of them happened to be glowing at the
  // moment asked.
  const shooterNames = new Set(Object.values(SHOTS).flatMap(s => s.from));
  const nearby = Object.values(bot.entities || {}).filter(e => e?.position && e.isValid !== false && shooterNames.has(e.name));
  const near = [...new Map([...warned, ...nearby].map(e => [e.id, e])).values()]
    .filter(e => require('./combat').canStrike(bot, e)).sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
  if (near) {
    const weapon = require('./combat').defenseWeapon(bot)?.name || 'a fist';
    const hp = typeof near.health === 'number' ? near.health : MOBS[near.name]?.health ?? 20;
    const { WEAPONS } = require('./combat-estimate');
    const [dmg, speed] = WEAPONS?.[weapon] || [1, 2];
    const swings = Math.ceil(hp / dmg), seconds = round(swings / speed);
    const warning = near._shotWarn ? `, against ${round(firesIn(bot, near))} seconds before it shoots` : ', not glowing yet';
    tree.strike_first = { description: `Strike the ${near.name} at arm's length with ${weapon.replaceAll('_', ' ')}: about ${swings} swing${swings === 1 ? '' : 's'}, ${seconds} seconds${warning}; if it lives, its shots land.`, target: near.id };
  }
  const hits = warned.map(e => { const m = MOBS[e.name]; return m ? `the ${e.name.replaceAll('_', ' ')}'s ${shotWord(e.name)}, about ${round(afterArmour(m.hit, worn))} health a landing${e.name === 'blaze' ? ' (three shots, each setting the bot alight five seconds more, about one health a second)' : ''}` : null; }).filter(Boolean);
  // Whether shots have actually been landing here, not only their average
  // cost: a box or hold's own tally, kept since it was chosen (note 719).
  const held = (() => { try { return require('./danger').stanceHeld(bot); } catch (_) { return null; } })();
  const faced = held?.shotsFaced;
  const heldSays = faced && faced.landed + faced.not > 0
    ? ` Held here (${held.choice.replaceAll('_', ' ')}) so far: ${faced.landed ? `${faced.landed} of ${faced.landed + faced.not} shots on the way have landed` : `none of ${faced.not} shot${faced.not === 1 ? '' : 's'} on the way has landed`}.`
    : '';
  // The biters at hand beside the shots, by when each can strike and where
  // it stands from the way the shield would face (note 770: 25598 answered
  // keep_on at 23:39:45Z with a zombie 4 blocks off, told only of the
  // skeleton's arrow; the zombie's blow landed half a second later).
  const bitersSay = (() => {
    try {
      const { blocksPerSecond } = require('./combat-estimate');
      const { shooter } = require('./combat');
      const near = require('./danger').threats(bot, 8).filter(t => t.entity?.position && !shooter(t.entity) && t.entity.name !== 'creeper' && MOBS[t.entity.name]?.hit > 0).slice(0, 2);
      if (!near.length) return { keep: '', shield: '' };
      const point = shieldCarried(bot) ? facingFor(bot, warned.map(e => ({ at: e.position, e, w: 1 }))).point : null;
      const dir = p => Math.atan2(p.z - here.z, p.x - here.x);
      const off = p => point ? Math.round(Math.abs(Math.atan2(Math.sin(dir(p) - dir(point)), Math.cos(dir(p) - dir(point)))) * 180 / Math.PI) : null;
      const each = near.map(t => {
        const secs = round(Math.max(0, t.distance - 1.5) / blocksPerSecond(t.entity.name));
        return `the ${t.entity.name.replaceAll('_', ' ')} ${round(t.distance)} blocks off${t.visible === false ? ', out of sight,' : ''} ${secs <= 0.1 ? 'at arm\'s length now' : `at arm's length in about ${secs} seconds at its own speed`}, about ${round(afterArmour(MOBS[t.entity.name].hit, worn))} a blow`;
      });
      const faced = point ? near.map(t => { const d = off(t.entity.position); return `the ${t.entity.name.replaceAll('_', ' ')} ${d} degrees from that way, ${d <= 90 ? 'on the shield\'s side' : 'behind it: its blows land whole'}`; }) : [];
      return { keep: ` Beside the shots, what bites: ${each.join('; ')}; with the shield down its blows land whole too.`, shield: faced.length ? ` Faced so, ${faced.join('; ')}.` : '' };
    } catch (_) { return { keep: '', shield: '' }; }
  })();
  if (tree.shield_up && bitersSay.shield) tree.shield_up.description += bitersSay.shield;
  tree.keep_on = { description: `Leave the shield down and keep on with ${doing}: the shots that land, ${hits.join('; ') || 'for what they cost'}, at ${round(bot.health ?? 20)} health.${bitersSay.keep}${heldSays}` };
  // What has been hitting the bot, first on every answer, and a hit taken
  // with the shield up from a side it does not face (note 752b: 25594 took
  // two hits "(shield up)" and was offered shield_up and keep_on five times
  // with neither said).
  let hitSays = '';
  try { hitSays = require('./hit-log').says(bot, require('./danger').threats(bot, 32)); } catch (_) { hitSays = ''; }
  if (hitSays) for (const o of Object.values(tree)) o.description = `${hitSays} ${o.description}`;
  return tree;
}
// The rest of the room against that facing: the blazes within sixteen, in
// sight or not, that the half faced leaves out, and how many of those see
// the bot now (note 691: at 21:18:06 to 08Z on 25589 three blows came from a
// blaze at 93 to 101 degrees off the facing, and at 21:18:21 a fireball from
// one at 130 degrees, the shield up each time).
function behindSays(bot, point, warned = []) {
  const here = bot.entity?.position;
  if (!here || !point) return { says: '', out: 0, seeing: 0 };
  const dir = p => Math.atan2(-(p.x - here.x), -(p.z - here.z));
  const diff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const yaw = dir(point);
  const about = Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.position && e.isValid !== false && e.position.distanceTo(here) <= 16);
  if (about.length < 2) return { says: '', out: 0, seeing: 0 };
  const out = about.filter(e => diff(dir(e.position), yaw) >= Math.PI / 2 - 0.15);
  if (!out.length) return { says: ` All ${about.length} blazes within sixteen are in that half.`, out: 0, seeing: 0 };
  const inSight = bot._shotInSight || new Set();
  const seeing = out.filter(e => inSight.has(e.id)).length;
  return { says: ` Of the ${about.length} blazes within sixteen, ${out.length} ${out.length === 1 ? 'is' : 'are'} outside that half (${seeing ? `${seeing} in sight now` : 'none in sight now'}): the shield does not stop what they send.`, out: out.length, seeing };
}
// Seconds until this shooter's first shot.
function firesIn(bot, e, now = Date.now()) {
  const w = e._shotWarn;
  if (!w) return 0;
  const first = w.kind === 'blaze' ? 3 : w.kind === 'ghast' ? 0.5 : 1;
  return Math.max(0, first - (now - w.at) / 1000);
}
// A cell out of the line of every warned shooter, walked to straight on the
// level in one or two steps, with no lava or deadly drop beside the way.
function coverCell(bot, warned) {
  try {
    const bunker = require('./bunker');
    const found = bunker.coverWithin(bot, warned, { steps: 2 });
    if (!found || !found.steps) return null;
    const y = bot.entity.position.floored().y;
    const way = found.path?.length ? found.path : [found.cell];
    if (way.some(c => c.y !== y)) return null;
    const { lavaWithin } = require('./blaze-stand'), terrain = require('./terrain');
    if (way.some(c => lavaWithin(bot, c, 1) || terrain.dropWithin(bot, c, 1))) return null;
    // Straight: each cell a step on from the last.
    let from = bot.entity.position.floored();
    for (const c of way) { if (Math.abs(c.x - from.x) + Math.abs(c.z - from.z) !== 1) return null; from = c; }
    return found;
  } catch (_) { return null; }
}
// The measured rates of the shield, for Jev. The blaze probe's own numbers
// (MEASURED.blaze) are said only where a blaze is among the warned: a
// ghast 40 to 49 blocks off was once told "Measured at work with blazes
// seven blocks off" (note 715, item 1), its own shooter never named.
function blockedSays(bot, warned = []) {
  const t = bot._shotTally;
  const run = t && (t.up.landed + t.up.not + t.down.landed + t.down.not) ? ` This run, of the shots on a line to the bot: with the shield up ${t.up.landed} landed and ${t.up.not} did not; with it down ${t.down.landed} landed and ${t.down.not} did not.` : '';
  const blaze = warned.some(e => e.name === 'blaze') ? ` ${MEASURED.blaze}` : '';
  return `${MEASURED.general}${blaze}${run}`;
}
// The shield against blazes, measured on a scratch server (note 676,
// scripts/shot-reflex-probe.js: a minute each, walking eight blocks and
// standing three seconds facing away, blazes seven blocks to the side).
const MEASURED = {
  general: 'In the trials to 2026-09-29, 71% of the shots that landed on the bot with a shield carried came with it down.',
  blaze: 'Measured at work with blazes seven blocks off, two minutes a round: the shield never raised, 11 of 39 fireballs landed (one blaze) and 13 of 126 (three); raised and faced at each glow, 2 of 45 and 3 of 128, the walk about 40% slower with three.',
};

function shotState(bot, warned) {
  const here = bot.entity.position;
  return {
    health: round(bot.health ?? 20), doing: bot._survivalGoal?.step?.action || bot._goal?.step?.action || null,
    shooters: warned.slice(0, 4).map(e => ({ name: e.name, distance: round(e.position.distanceTo(here)), warning: WARNS[e._shotWarn.kind].says, firstShotInSeconds: round(firesIn(bot, e)) })),
  };
}

// A stance in force answers the shooters' warnings (note 709). 25592 at a
// blaze spawner (2026-09-30 01:39:25 to 01:40:26Z) answered shot_answer 14
// times and encounter_stance 8 times in one minute: behind_cover walked it
// off the charge's line, the charge was asked again, keep_on took the next
// volley, and no stance ran long enough to work (health 20 to 3, no rod).
// Over the fights with blazes from 22:00Z (scripts/fight-asks.js) a spawner's
// fight asked 12.9 questions a fight-minute, 8.4 of them shot_answer, and
// 587 of its 1,073 shot_answers came inside a stance's fifteen seconds. So
// the stance Jev chose carries its answer to each volley, said on the stance
// question (decisions/survival.js encounter_stance guidance):
//   closing: a charge or a fight raises the shield toward the shooters while
//     it closes, lowered for its swings once one is at the sword's reach;
//   holding: a box, a wall, cover or a guard keeps its spot and holds the
//     shield toward the shooters, or steps to a cell out of every line where
//     they are split round it (the rule's answer, shotRule);
//   walking: a stance that walks off, eats or drinks goes on, the shield
//     raised only for a shot on its way that hits (the reflex).
// keep_working and the rest (a creeper's block, a span, a fireball struck
// back) ask at each warning as before.
const STANCE_SHOTS = {
  closing: new Set(['charge_nearest', 'charge', 'charge_shooter', 'close_in', 'fight', 'fight_at_spawner', 'fight_from_footing', 'rail_and_fight', 'strike_from_above', 'low_ceiling', 'shield_the_charge', 'break_spawner', 'dig_in_and_fight']),
  holding: new Set(['shield_guard', 'take_cover', 'back_to_wall', 'corner_ambush', 'box_here', 'box_at_spawner', 'dig_in', 'dig_in_at_spawner', 'bunker', 'seal', 'nook', 'out_of_sight', 'pillar', 'stand_by_spawner']),
  walking: new Set(['retreat', 'leave_reach', 'leave_and_heal', 'step_out_and_eat', 'out_of_the_push', 'come_down', 'dig_down', 'eat', 'eat_golden_apple', 'drink_fire_resistance', 'wait_far_off']),
};
const stanceShotsOf = choice => Object.keys(STANCE_SHOTS).find(k => STANCE_SHOTS[k].has(choice)) || null;
// The answer the stance in force gives this warning, or null (asked).
// 'reflex': no hold for the warning; a shot on its way that hits meets the shield.
// A body_way run out of fire in flight (vitals.js outOfFire, note 709/723):
// its own keys are the way out, chosen and held to already; behind_cover
// would walk the body somewhere else instead, off the route and often back
// toward the flame it just started leaving. 25597 answered out_of_fire
// three times running, each undone the same way, caught fire again each
// time and ate on fire at 11 health. Read the same as a closing stance:
// the shield answers a shot on the way or about to fire, never a walk.
const BODY_WAY_MS = 3000;
function bodyWayHeld(bot, now = Date.now()) {
  const r = bot?._bodyWayRunning;
  return r && r.action === 'out_of_fire' && now - r.at <= BODY_WAY_MS ? r : null;
}
function stanceAnswer(bot, tree, now = Date.now()) {
  const body = bodyWayHeld(bot, now);
  if (body) return tree.shield_up ? { choice: 'shield_up', stance: body.action, how: 'closing', closing: true } : { choice: 'reflex', stance: body.action, how: 'closing' };
  const s = require('./danger').stanceHeld(bot, now);
  const how = s?.choice ? stanceShotsOf(s.choice) : null;
  if (!how) return null;
  if (how === 'walking') return { choice: 'reflex', stance: s.choice, how };
  if (how === 'closing') return tree.shield_up ? { choice: 'shield_up', stance: s.choice, how, closing: true } : { choice: 'reflex', stance: s.choice, how };
  const rule = shotRule(tree);
  return rule ? { choice: rule, stance: s.choice, how } : { choice: 'reflex', stance: s.choice, how };
}

// One shooter alone, far enough off that its shot is seen coming (a
// ghast's fireball, slow, past FAR blocks): the last answer given holds
// for its next warning too, while it has not come FAR_NEARER_BY blocks
// nearer, said for FAR_HOLD_MS. 25583 (mid-242-mh, note 715 item 1) had a
// ghast 40 to 49 blocks off ask shot_answer 8 times in 24 seconds, flipping
// shield_up and keep_on at 0.02 to 0.14 confidence: nothing about a ghast
// that far off and that slow to shoot had changed between one charge and
// the next. -> the held choice, or null (asked fresh: near, come closer,
// too long since, or more than one shooter warned at once).
const FAR = 20, FAR_HOLD_MS = 20000, FAR_NEARER_BY = 6;
function farHeld(bot, warned, now = Date.now()) {
  if (warned.length !== 1) return null;
  const e = warned[0];
  const d = e.position?.distanceTo?.(bot.entity?.position);
  if (!Number.isFinite(d) || d < FAR) return null;
  const h = bot._shotFarHeld?.get(e.id);
  if (!h || now - h.at > FAR_HOLD_MS || h.distance - d >= FAR_NEARER_BY) return null;
  return h.choice;
}

// farHeld above only holds for one shooter far off. At a live spawner with
// several blazes near, each one's own glow begins a moment after the
// last, and every fresh glow is a whole new ask: 25589 (mid-242-wb, note
// 737) had shot_answer asked and answered five to six times a second at a
// spawner (08:39:13-14 and 08:39:40-43Z), the tree barely changed between
// them, and the choice flipped with it (shield_up, behind_cover, keep_on)
// on a close call each time; it never swung and took no rod in the whole
// window. One answer holds through a volley (notes 709/715/719): asked
// again only past NEAR_HOLD_MS, or with more shooters warned now than the
// answer covered (a new one arrived, not just an old one's next glow), or
// the nearest of them closer by NEAR_NEARER_BY. -> the held choice, or
// null (asked fresh).
const NEAR_HOLD_MS = 3000, NEAR_NEARER_BY = 4;
function nearestOf(bot, warned) {
  const here = bot.entity?.position;
  const ds = warned.map(e => e.position?.distanceTo?.(here)).filter(Number.isFinite);
  return ds.length ? Math.min(...ds) : Infinity;
}
// Only where more than one shooter is about: a lone shooter's own next
// glow (shot-reflex.test.js "the next glow is its own question") stays
// asked fresh every time, as it did before. It is the crowd around a
// spawner, each on its own clock, that this dampens.
function recentHeld(bot, warned, now = Date.now()) {
  if ((bot._shotWarned?.size || 0) < 2) return null;
  const h = bot._shotRecentAnswer;
  if (!h || now - h.at > NEAR_HOLD_MS || warned.length > h.count) return null;
  const nearest = nearestOf(bot, warned);
  if (Number.isFinite(h.nearest) && h.nearest - nearest >= NEAR_NEARER_BY) return null;
  return h.choice;
}

// The question about these warnings, not waited for: the answer lands on
// bot._shotAnswers when it comes. Until it comes the reflex answers a shot
// in the air.
function ask(bot, survival, warned) {
  const keys = new Map(warned.map(e => [e.id, e._shotWarn.key]));
  (bot._shotAsked ||= new Set());
  for (const k of keys.values()) bot._shotAsked.add(k);
  if (bot._shotAsked.size > 500) bot._shotAsked = new Set([...bot._shotAsked].slice(-200));
  let tree;
  try { tree = shotOptions(bot, warned); }
  catch (err) { if (!bot._shotErrAt || Date.now() - bot._shotErrAt > 10000) { bot._shotErrAt = Date.now(); console.log(`[shot] options: ${err.message}`); } return; }
  const answers = bot._shotAnswers ||= new Map();
  const until = new Map(warned.map(e => [e.id, e._shotWarn.at + WARNS[e._shotWarn.kind].most * 1000]));
  const record = (choice, by, extra = {}) => {
    for (const [id, key] of keys) answers.set(id, { key, choice, at: Date.now(), until: until.get(id), ...(choice === 'behind_cover' ? { cell: tree.behind_cover.cell } : {}), by, ...extra });
    if (warned.length === 1) {
      const e = warned[0], d = e.position?.distanceTo?.(bot.entity?.position);
      if (Number.isFinite(d) && d >= FAR) (bot._shotFarHeld ||= new Map()).set(e.id, { choice, at: Date.now(), distance: d });
    }
    bot._shotRecentAnswer = { choice, at: Date.now(), count: warned.length, nearest: nearestOf(bot, warned) };
  };
  // The stance Jev chose answers it (note 709).
  const byStance = stanceAnswer(bot, tree);
  if (byStance) {
    record(byStance.choice, 'stance', { stance: byStance.stance, ...(byStance.closing ? { closing: true } : {}) });
    bot._shotByStance = (bot._shotByStance || 0) + 1;
    console.log(`[shot] ${warned.map(e => `the ${e.name}`).join(', ')} warning: answered by the stance ${byStance.stance.replaceAll('_', ' ')} (${byStance.choice.replaceAll('_', ' ')})`);
    return;
  }
  // The stance question out being asked again: its answer carries the
  // answer to the volleys (above), and until it comes the shield is held
  // toward the shooters as a holding stance holds it, not asked beside it
  // (note 770: 25598's shot_answer at 23:39:45.1Z was asked while shield_guard
  // was out again, answered keep_on, and the zombie's blow landed).
  if (bot._asking?.id === 'encounter_stance') { const rule = shotRule(tree); if (rule) { record(rule, 'stance', { stance: 'encounter_stance (being asked)' }); return; } }
  // With JEV_ENCOUNTERS=0 (or no client): the shot's safety rule, the
  // shield; split round the bot, a cell out of their line. Jev not
  // reachable, decide() answers by the same rule (note 707).
  if (!survival.client || process.env.JEV_ENCOUNTERS === '0') { const rule = shotRule(tree); if (rule) record(rule, 'rules'); return; }
  const held = farHeld(bot, warned);
  if (held && tree[held]) {
    record(held, 'held');
    console.log(`[shot] the ${warned[0].name} warning, ${Math.round(warned[0].position.distanceTo(bot.entity.position))} blocks off: the last answer (${held.replaceAll('_', ' ')}) holds`);
    return;
  }
  const near = recentHeld(bot, warned);
  if (near && tree[near]) {
    record(near, 'held');
    console.log(`[shot] ${warned.map(e => `the ${e.name}`).join(', ')} warning: the last answer (${near.replaceAll('_', ' ')}) holds (note 737)`);
    return;
  }
  const state = shotState(bot, warned);
  const goal = bot._survivalGoal || bot._goal || {}, save = bot._goalSave || (() => {});
  const only = { get cancelled() { return false; }, label: 'shot_answer', check() {} };
  bot._shotAsking = true;
  Promise.resolve().then(() => survival.decide(only, goal, save, { id: 'shot_answer', state, tree, aside: true }))
    .then(d => {
      const choice = d && !d.stale ? d.path?.[0] : null;
      if (!choice || !tree[choice]) return;
      record(choice, d.safetyRule ? 'rule' : 'jev');
      if (choice === 'strike_first') strikeFirst(bot, tree.strike_first.target).catch(() => {});
    })
    .catch(() => null)
    .finally(() => { bot._shotAsking = false; });
}
// The shot's safety rule, when Jev cannot answer: the shield, or where the shooters are split round
// the bot and a cell out of their line is a step off, that cell (note 691).
const shotRule = tree => tree.shield_up?.split && tree.behind_cover ? 'behind_cover' : tree.shield_up ? 'shield_up' : null;
// The strike chosen: swings at the shooter while it is in reach and its
// warning is on, as the weapon's recharge allows.
async function strikeFirst(bot, id) {
  const { canStrike } = require('./combat');
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const e = bot.entities?.[id];
    if (!e || e.isValid === false || !canStrike(bot, e)) return;
    const lookAt = bot._shotRaw?.lookAt || bot.lookAt.bind(bot);
    await lookAt(e.position.offset(0, (e.height || 1.8) / 2, 0), true);
    bot.attack(e);
    await sleep(650);
  }
}

// Installed once per bot (survival.js Survival): the look every tick, the
// shots' own packets, the blazes' glow.
function install(bot, survival) {
  if (!bot || bot._shotReflex) return;
  bot._shotReflex = true;
  try { require('./blaze-stand').volleyWatch(bot); } catch (_) { /* no blazes */ }
  watchShots(bot);
  bot._shotSurvival = survival;
  bot.on('physicsTick', () => { try { tick(bot, bot._shotSurvival); } catch (err) { if (!bot._shotErrAt || Date.now() - bot._shotErrAt > 10000) { bot._shotErrAt = Date.now(); console.log(`[shot] ${err.message}`); } } });
}

// Answered otherwise than with the shield: Jev chose to step out of this
// shooter's line, strike it first or take its shots.
const answeredOtherwise = (bot, id, now = Date.now()) => { const a = id != null ? answerFor(bot, id, now) : null; return !!a && a.choice !== 'shield_up' && a.choice !== 'reflex'; };

module.exports = { STANCE_SHOTS, stanceShotsOf, stanceAnswer, shotComing, shotRule, behindSays, SHOT_W, SEEN_W, install, tick, hitting, shotAt, holdRefused, facingFor, shotOptions, answerFor, answeredOtherwise, trackWarnings, warnDue, warningOn, shieldActive, shieldHeld, mainHandBusy, watchShots, settle, release, lockBody, coverCell, blockedSays, MEASURED, SHOTS, WARNS, RISE_MS, ask, farHeld, FAR, FAR_HOLD_MS, FAR_NEARER_BY, shotWord };
