'use strict';
const { Vec3 } = require('vec3');
const { threats } = require('./danger');
const { checkAir } = require('./vitals');
const { durable, SHOOTERS, shooter } = require('./mob-policy');
const { countOf } = require('./skills');
const { besideDrop } = require('./terrain');
const { move } = require('./motion');
const { bowSolution, aimAtEntity, shootBow } = require('./projectiles');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Mobs that shoot. A piglin counts only with a crossbow in hand; one with a
// sword is a melee mob and the charge rule's business.
const bowReady = bot => bot.inventory.items().some(i => i.name === 'bow' && durable(bot.registry, i)) && countOf(bot, 'arrow') > 0;

// Where to point the bow at a target this far off, moving this way: the
// vanilla arc solved from the eye. `drop` is how far the pitch rises above
// the straight line to cover gravity, `lead` how far ahead of the target the
// aim point sits to cover its motion. Pure: no bot, no world.
function aim(origin, target, velocity = new Vec3(0, 0, 0)) {
  const solution = bowSolution(origin, target, velocity);
  if (!solution) return null;
  const straight = target.minus(origin);
  const level = Math.atan2(straight.y, Math.hypot(straight.x, straight.z));
  return { yaw: solution.yaw, pitch: solution.pitch, ticks: solution.ticks, distance: straight.norm(),
    drop: solution.pitch - level, lead: solution.target.minus(target).norm(), aimPoint: solution.target };
}

// The shooters worth an arrow: in clear view, four to twenty blocks off,
// with a clear arc from where the bot stands, and a bow and arrows to hand.
// any: every mob in clear view at bow range, not only those that shoot
// back: a creeper walking up is shot as a player shoots one (mid-202-a was
// offered the bow only at a skeleton, a creeper coming on from eight
// blocks, and was blown up; 2026-09-26). Not an enderman: it dodges arrows.
function shotTargets(bot, danger, { minimum = 4, maximum = 20, any = false } = {}) {
  if (!bowReady(bot)) return [];
  return danger.filter(t => (any ? t.entity.name !== 'enderman' : shooter(t.entity)) && t.visible && t.distance >= minimum && t.distance <= maximum && aimAtEntity(bot, t.entity));
}

// The shield goes up after a shot so the answer lands on it while the bot
// looks again, and comes down before anything that needs the hands: a swing,
// the next draw, a walk (a raised shield is sneaking speed).
function raiseShield(bot) {
  if (bot._shieldRaised || bot.inventory.slots?.[45]?.name !== 'shield') return false;
  bot.activateItem(true); bot._shieldRaised = true; return true;
}
function lowerShield(bot) {
  if (!bot._shieldRaised) return;
  bot.deactivateItem(); bot._shieldRaised = false;
}

// One arrow: bow in hand, aim with lead and drop, draw about a second,
// release, then cover behind the shield until the next observation.
async function shoot(bot, task, target, { guard, threatCheck, chargeMs = 1100, cover = true } = {}) {
  lowerShield(bot);
  try { return await shootBow(bot, task, target, { guard, threatCheck, chargeMs }); }
  finally { if (cover) raiseShield(bot); }
}

// Prefer carried combat equipment, then a mining tool, then bare hands. These
// are conservative equipment/cooldown policies, not predicted damage values.
function defenseWeapon(bot) {
  const classes = { sword: 500, axe: 450, trident: 480, pickaxe: 200, shovel: 180 };
  const materials = ['wooden', 'golden', 'stone', 'copper', 'iron', 'diamond', 'netherite'];
  const rank = item => {
    if (item.name === 'trident') return classes.trident;
    const parts = item.name.split('_'), kind = parts.at(-1);
    return classes[kind] ? classes[kind] + Math.max(0, materials.indexOf(parts[0])) * 20 : 0;
  };
  return bot.inventory.items().filter(item => rank(item) > 0).sort((a, b) => rank(b) - rank(a))[0];
}

function canStrike(bot, entity) {
  if (!entity?.position || entity.isValid === false) return false;
  const eye = bot.entity.position.offset(0, 1.62, 0);
  const halfWidth = (entity.width || 0.6) / 2;
  const closest = entity.position.clone();
  closest.x = Math.max(entity.position.x - halfWidth, Math.min(eye.x, entity.position.x + halfWidth));
  closest.z = Math.max(entity.position.z - halfWidth, Math.min(eye.z, entity.position.z + halfWidth));
  closest.y = Math.max(entity.position.y, Math.min(eye.y, entity.position.y + (entity.height || 1.8)));
  if (eye.distanceTo(closest) > 3) return false;
  // A mob at arm's length is hittable whatever the ray says: on a staircase
  // the one a step up or down is hidden behind the stair edge from the eye
  // to its head, and it lands every hit while the bot waits for a clear
  // line. That is how the dream run died, in iron armour, without a swing.
  // But not through a full block: the ray to the nearest point of the mob
  // (not its head) clears a stair edge, and stops at a pocket's lid. A
  // zombie standing on the lid over mid-235-n measured 1.38 from the eye,
  // was "in reach" twice a second for two hours, and not one swing landed
  // (note 478).
  if (eye.distanceTo(closest) <= 2) {
    const toward = closest.minus(eye), gap = toward.norm();
    if (gap < 0.05) return true;
    const wall = bot.world?.raycast?.(eye, toward.unit(), gap);
    if (!wall || eye.distanceTo(wall.intersect || wall.position) >= gap - 0.05) return true;
    const block = wall.boundingBox ? wall : bot.blockAt?.(wall.position);
    const full = block?.boundingBox === 'block' && (!block.shapes || (block.shapes.length === 1 && block.shapes[0].join() === '0,0,0,1,1,1'));
    return !full;
  }
  const aim = entity.position.offset(0, (entity.height || 1.8) / 2, 0), direction = aim.minus(eye);
  const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
  return !hit || eye.distanceTo(hit.intersect || hit.position) >= direction.norm() - 0.1;
}

// A critical hit is a swing on the way down from a jump: half as much again,
// so a diamond sword kills a zombie or a skeleton in two swings, not three.
// Every swing jumps when it safely can: on the ground, out of liquid, head
// room for the jump, no drop beside it (a hit taken in the air throws the
// bot further), not sprinting, and not at the mobs below. Otherwise, or if
// the jump's window is missed, a plain swing.
const NO_CRIT = new Set(['creeper', 'hoglin', 'zoglin']);
function critReady(bot, target) {
  const e = bot.entity;
  // Not at a creeper, which is struck and backed from, nor a hoglin or a
  // zoglin, which throw what they hit into the air: in the arena the jump
  // took 15.2 damage from a hoglin against 9.6 for plain swings.
  if (!e?.onGround || e.isInWater || e.isInLava || NO_CRIT.has(target?.name)) return false;
  // Nor at anything with a creeper close: the jump holds the bot in the air
  // for most of a second it needs for backing off. Trial 114 jumped for a
  // crit on a zombie with a creeper under four blocks off and was blown up
  // from twelve health mid-jump.
  if (Object.values(bot.entities || {}).some(c => c.name === 'creeper' && c.isValid !== false && c.position && c.position.distanceTo(e.position) <= 5)) return false;
  if (bot.getControlState ? bot.getControlState('sprint') : bot.controlState?.sprint) return false;
  const feet = e.position.floored();
  const head = bot.blockAt?.(feet.offset(0, 2, 0));
  if (!head || head.boundingBox !== 'empty' || /water|lava/.test(head.name)) return false;
  return !besideDrop(bot, feet);
}
// A jump that came down out of reach is not tried again at the same mob for
// a while: on a staircase the jump lands a step up, the zombie below is out
// of reach, and the dream run died jumping on its stairs for fourteen
// seconds while a zombie hit it every second and not one swing landed.
const CRIT_MISS_MS = 8000;
// A sword's full swing on the ground sweeps: every mob within a block of the
// target takes a hit too. Beside a neutral zombified piglin that is the
// whole group turned on the bot (the replay run, from its hoglin pillar).
// With one near, the swing is made with a tool that does not sweep, or as a
// critical, which does not either; failing both, it is held.
const BYSTANDERS = new Set(['zombified_piglin', 'piglin', 'enderman']);
function bystanders(bot, target) {
  const { provoked } = require('./danger');
  return Object.values(bot.entities || {}).filter(e => (BYSTANDERS.has(e.name) || require('./protected-animals').isProtected(e)) && e !== target && e.isValid !== false && e.position &&
    target.position && e.position.distanceTo(target.position) <= 2.5 && !provoked(bot, e));
}
async function strike(bot, task, target) {
  const near = bystanders(bot, target);
  if (near.length && /_sword$/.test(bot.heldItem?.name || '')) {
    const tool = bot.inventory.items().find(i => /_axe$/.test(i.name)) || bot.inventory.items().find(i => /_pickaxe$/.test(i.name));
    if (tool) { await bot.equip(tool, 'hand'); bot.attack(target); return 'unswept'; }
    if (!critReady(bot, target)) return 'held';
  }
  const missed = bot._critMiss && bot._critMiss.id === target.id && Date.now() - bot._critMiss.at < CRIT_MISS_MS;
  // No critical's jump while a stance other than the fight holds: the jump
  // leaves the bot in the air when the stance comes to build or dig, and
  // measured from the air the pillar's headroom is a block off. mid-239-b
  // chose the pillar nine times with zombies coming down its stairs, and
  // each time the swing's jump went first and the pillar was not built;
  // twenty health to none (2026-09-27).
  const stance = bot._stance?.choice;
  if (!missed && !(stance && stance !== 'fight') && critReady(bot, target)) {
    // Past the top of the jump: seen rising, now coming down. Standing
    // still reads a small downward velocity too, and the first version
    // swung the instant the feet left the ground, on the way up: no crit.
    let rose = false;
    // The server reads the fall a tick behind: swung on the first falling
    // tick the hit was plain; two ticks down it is a critical.
    const falling = () => { const vy = bot.entity.velocity?.y ?? 0; if (vy > 0.05) rose = true; return rose && !bot.entity.onGround && vy < -0.15; };
    const down = await move(bot, task, { label: 'crit_jump', keys: ['jump'], sneak: false, until: falling, maxMs: 900, tick: 10 });
    if (down && bot.entities[target.id] === target && target.isValid !== false && canStrike(bot, target)) {
      await bot.lookAt(target.position.offset(0, (target.height || 1.8) / 2, 0), true);
      bot.attack(target); bot._critSwings = (bot._critSwings || 0) + 1; return 'critical';
    }
    for (let i = 0; i < 10 && !bot.entity.onGround; i++) { task.check(); await sleep(25); }
    if (!(bot.entities[target.id] === target && target.isValid !== false && canStrike(bot, target))) { bot._critMiss = { id: target.id, at: Date.now() }; return 'missed'; }
  }
  bot.attack(target); return 'plain';
}

function strikeTarget(bot) {
  return threats(bot, 5).find(({ entity, visible, distance }) => (visible || distance <= 2) && canStrike(bot, entity));
}

// Immediate self-defense never chases a mob or chooses an unobserved target.
// One swing/cooldown slice returns to the survival controller so movement,
// health, air and new threats are observed again before the next action.
async function defendNearby(bot, task, goal, save) {
  task.check(); checkAir(bot);
  // On a one-wide span over a drop (terrain.js onSpan) the swing is crouched
  // and still: no keys, no critical's jump (sneak lets go for the jump). A
  // player crouched with its keys up cannot walk off an edge whichever way
  // it faces; mid-215-e went into the lava sea with forward held through a
  // turn (note 273). Not swinging at all left a mob at arm's length hitting
  // a bot that only stood there.
  const span = require('./terrain').onSpan(bot);
  let threat = strikeTarget(bot);
  if (!threat) return false;
  const weapon = defenseWeapon(bot), kind = weapon?.name.split('_').at(-1);
  // Bare hands: a mob struck is unhurt for half a second after, so a punch
  // sooner is wasted (the ledge replay landed every other one at 300 ms).
  // The fight's estimate prices a creeper's race with its fuse by the same
  // times (combat-estimate.js SWING_MS).
  const { SWING_MS } = require('./combat-estimate');
  const cooldown = SWING_MS[kind] || SWING_MS.fist;
  const remaining = cooldown - (Date.now() - (bot._defenseAttackAt || 0));
  if (remaining > 0) {
    // Keep trying to retreat from a creeper between knockback attempts.
    if (threat.entity.name === 'creeper') return false;
    await sleep(Math.min(remaining, 100)); task.check(); checkAir(bot); return true;
  }
  bot.pathfinder.setGoal(null); bot.clearControlStates(); lowerShield(bot);
  if (span) bot.setControlState('sneak', true);
  if (weapon) await bot.equip(weapon, 'hand');
  else if (bot.heldItem) await bot.unequip('hand');
  task.check(); checkAir(bot);
  threat = strikeTarget(bot);
  if (!threat) return false;
  const target = threat.entity;
  await bot.lookAt(target.position.offset(0, (target.height || 1.8) / 2, 0), true);
  task.check(); checkAir(bot);
  if (bot.entities[target.id] !== target || target.isValid === false || strikeTarget(bot)?.entity !== target) return false;
  const swing = span ? (bot.attack(target), 'on_span') : await strike(bot, task, target); bot._defenseAttackAt = bot._threatResponseAt = Date.now();
  bot._struck = { id: target.id, at: bot._defenseAttackAt };
  // The shield comes up for the cooldown between swings: a wither skeleton
  // took twenty health in six seconds of unguarded swordplay. Not against
  // a creeper, which is struck and backed away from.
  if (target.name !== 'creeper' && bot.inventory.slots?.[45]?.name === 'shield') raiseShield(bot);
  goal.survivalAction = { action: 'defend', target: target.name, entityId: target.id,
    distance: Number(threat.distance.toFixed(2)), weapon: weapon?.name || 'bare hands', health: bot.health, swing,
    at: new Date().toISOString() };
  save(); return true;
}

module.exports = { critReady, strike, bystanders, defenseWeapon, canStrike, strikeTarget, defendNearby, SHOOTERS, shooter, bowReady, aim, shotTargets, shoot, raiseShield, lowerShield };
