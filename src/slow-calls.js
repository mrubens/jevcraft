'use strict';
// A world search that holds the event loop is said by name, with the line
// that asked for it (note 772): returnToSurface's landing search read about
// 2 million cells a call at mid-241's start, y -18, and the bot log said
// only "[lag] event loop held 20.7s" with the step under way; the bot stood
// frozen among zombies three times in the first minutes of a trial. A call
// to bot.findBlocks of SLOW_MS or more is logged as
// "[slow] findBlocks 812 ms (src/survival.js:5939): 128 found, maxDistance 48".
const SLOW_MS = 250;

function callerOf(stack) {
  const lines = String(stack || '').split('\n').slice(1);
  const own = lines.find(l => /[\\/]src[\\/]/.test(l) && !/slow-calls\.js/.test(l)) || lines[1] || '';
  const m = own.match(/(src[\\/][^():]+:\d+)/);
  return m ? m[1].replaceAll('\\', '/') : own.trim().slice(0, 120);
}

function install(bot, { log = console.log, slowMs = SLOW_MS } = {}) {
  if (typeof bot?.findBlocks !== 'function' || bot.findBlocks._slowWatched) return bot;
  const find = bot.findBlocks.bind(bot);
  bot.findBlocks = Object.assign(options => {
    const t0 = Date.now();
    const found = find(options);
    const ms = Date.now() - t0;
    if (ms >= slowMs) {
      const caller = callerOf(new Error().stack);
      // Kept for the event loop's watch (index.js): a hold that a search
      // ended in is said with it (note 795).
      bot._slowLast = { what: 'findBlocks', ms, caller, at: Date.now() };
      log(`[slow] findBlocks ${ms} ms (${caller}): ${Array.isArray(found) ? found.length : 0} found, maxDistance ${options?.maxDistance ?? 16}`);
    }
    return found;
  }, { _slowWatched: true });
  return bot;
}

module.exports = { SLOW_MS, install, callerOf };
