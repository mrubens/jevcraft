'use strict';
// The flight recorder: the bot's state and every decision, sampled into a
// trace and written to disk, where the audits read it (scripts/lib/audit.js,
// scripts/first-days.js, scripts/flight.js). No viewer: the recordings are
// JSON lines under `directory`, kept for a day.
const { Trace } = require('./trace');
const { observeBot } = require('./observer');
const { flightRecorder } = require('./flight');

function startRecorder({ directory, label }) {
  const flight = flightRecorder(directory, label);
  const trace = new Trace({ onFrame: frame => flight.record(frame) });
  let observer = null;
  return {
    trace,
    attach(bot, options) { observer?.detach('replaced'); observer = observeBot(trace, bot, options); return observer; },
    async close() { observer?.detach('closed'); observer = null; },
  };
}

module.exports = { startRecorder };
