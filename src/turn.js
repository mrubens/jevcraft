'use strict';
// Who has the bot's turn, and since when. The flight record showed stretches
// of seconds in which the bot was hurt and no survival action was reported,
// and could not say what held the turn: mid-227-j's creeper at four blocks
// for three seconds with nothing from the survival layer (note 366), mid-
// 242-n's eleven seconds of suffocation with no dig out after a meal (note
// 391), mid-230-k's fights chosen that did not swing (note 358). Each layer
// marks the turn as it takes it (the survival step, a stance held, a
// question out to Jev, a meal, the work's own step), and the recorder's
// frames carry the mark with how long it has been held (observer.js), so
// the next such stretch names its holder.
function takeTurn(bot, holder, phase, detail = null) {
  if (!bot) return null;
  const previous = bot._turn || null;
  bot._turn = { holder, phase, ...(detail ? { detail } : {}), since: Date.now() };
  return previous;
}
// The mark as the record keeps it: holder, phase, detail and the time held.
function turnHeld(bot, now = Date.now()) {
  const t = bot?._turn;
  if (!t) return undefined;
  return { holder: t.holder, phase: t.phase, ...(t.detail ? { detail: t.detail } : {}), forMs: Math.max(0, now - t.since) };
}
// Back to the mark that was there before (a question answered, a stance
// done): the layer that took the turn has it again.
function giveBack(bot, previous) { if (bot) bot._turn = previous || null; }

module.exports = { takeTurn, turnHeld, giveBack };
