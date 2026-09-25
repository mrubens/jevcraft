'use strict';
// Animals the bot never hurts (the user, 2026-09-25: "Add one rule that's
// hard enforced - never hurt a chicken", then "Or a pig"). Not a judgment
// Jev weighs: the one place a swing leaves the bot refuses it, a sword's
// sweep that would reach one is refused too, and a bow is not drawn with
// one near the line of the shot. Nothing offers them as food or drops.
const { Vec3 } = require('vec3');
const PROTECTED = new Set(['chicken', 'pig']);

class ProtectedAnimal extends Error { constructor(message) { super(message); this.name = 'ProtectedAnimal'; } }

const isProtected = entity => !!entity && PROTECTED.has(entity.name);
const live = (bot, e) => isProtected(e) && e.isValid !== false && e.position && bot.entities?.[e.id] === e;

// A sword's sweep reaches whatever stands within a block of the target;
// counted generously, two and a half blocks of its middle.
function nearTarget(bot, target, reach = 2.5) {
  if (!target?.position) return [];
  return Object.values(bot.entities || {}).filter(e => e !== target && live(bot, e) && e.position.distanceTo(target.position) <= reach);
}

// Anything protected within a block and a half of the line from the eye to
// the target, or of the target itself: an arrow that misses goes on.
function nearShot(bot, target) {
  if (!target?.position || !bot.entity?.position) return [];
  const eye = bot.entity.position.offset(0, 1.62, 0), end = target.position.offset(0, (target.height || 1) / 2, 0);
  const line = end.minus(eye), length = line.norm() || 1;
  return Object.values(bot.entities || {}).filter(e => e !== target && live(bot, e)).filter(e => {
    const p = e.position.offset(0, (e.height || 0.7) / 2, 0);
    const along = Math.max(0, Math.min(length + 8, p.minus(eye).dot(line) / length));
    const closest = eye.plus(line.scaled(along / length));
    return closest.distanceTo(p) <= 1.5;
  });
}

// Only a grounded, walking swing sweeps: a critical (falling) or sprinting
// hit does not.
const sweeps = bot => /_sword$/.test(bot.heldItem?.name || '') && !!bot.entity?.onGround &&
  !(bot.getControlState ? bot.getControlState('sprint') : bot.controlState?.sprint);

function installGuard(bot) {
  if (!bot || bot._protectedGuard || typeof bot.attack !== 'function') return;
  const attack = bot.attack.bind(bot);
  bot._protectedGuard = { refused: 0 };
  bot.attack = (target, ...rest) => {
    if (isProtected(target)) { bot._protectedGuard.refused++; throw new ProtectedAnimal(`Never a ${target.name}: the swing was refused`); }
    const near = sweeps(bot) ? nearTarget(bot, target) : [];
    if (near.length) { bot._protectedGuard.refused++; throw new ProtectedAnimal(`A ${near[0].name} beside the ${target?.name || 'target'} would be caught by the sword's sweep: the swing was refused`); }
    return attack(target, ...rest);
  };
}

module.exports = { PROTECTED, ProtectedAnimal, isProtected, nearTarget, nearShot, installGuard };
