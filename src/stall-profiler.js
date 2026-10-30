'use strict';
// The event loop's stalls caught in the act (note 1587): a CPU profile kept
// rolling in the bot's own process, twenty seconds at a time, and the window
// in which the loop was held two seconds or more is written out with its
// hottest frames said in the log. The lag watch (index.js) says a stall
// happened and what step was under way; it cannot say which code held the
// loop, and the profile of the arena drill of 2026-10-14 (05:13Z) found
// the path search's rim test only because the drill happened to hit it.
// 25588's runs of that morning held the loop two to four seconds three to
// nine times a run (0.35 a minute), in the breath (dragon-124, 2.2 s) and
// at the blow (dragon-126, 2.5 s, the blast took 15 through a shield not
// yet raised); 1578 cached the rim test and the count did not move.
//   [stall] 2708 ms held: self getBlock src/movement.js:82 1210 ms, ...; inclusive getNeighbors src/movement.js:191 2400 ms, ...
// JEV_STALL_PROFILE=1 turns it on (off by default since note 2596: the profile's own read held the loop under load). The profiles go to artifacts/stall-profiles, the last thirty kept.
const fs = require('fs');
const path = require('path');

function summarize(profile, root = '') {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const key = n => { const f = n.callFrame; const url = String(f.url || '').replace(/^file:\/\//, ''); return `${f.functionName || '(anon)'} ${root && url.startsWith(root + '/') ? url.slice(root.length + 1) : url.replace(/^.*\/(src|test|scripts|node_modules)\//, '$1/')}:${f.lineNumber + 1}`; };
  const self = {}, incl = {};
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] || 0;
    let id = profile.samples[i];
    const k0 = key(byId.get(id));
    if (!/\(idle\)|\(program\)|\(garbage collector\)/.test(k0)) self[k0] = (self[k0] || 0) + dt;
    const seen = new Set();
    while (id) { const n = byId.get(id); const k = key(n); if (/src\//.test(k) && !seen.has(k)) { seen.add(k); incl[k] = (incl[k] || 0) + dt; } id = parent.get(id); }
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${k} ${Math.round(t / 1000)} ms`);
  return { self: top(self, 5), inclusive: top(incl, 6) };
}

function startStallProfiler({ directory, windowMs = 20000, keepMs = 1500, samplingUs = 4000, keepFiles = 30, log = console.log } = {}) {
  let inspector;
  try { inspector = require('node:inspector'); } catch (_) { return null; }
  const session = new inspector.Session();
  try { session.connect(); } catch (err) { log(`[stall] profiler not started: ${err.message}`); return null; }
  const post = (method, params) => new Promise((resolve, reject) => session.post(method, params || {}, (err, result) => err ? reject(err) : resolve(result)));
  let stalled = [], timer = null, stopped = false;
  const prune = () => { try { const files = fs.readdirSync(directory).filter(f => f.endsWith('.cpuprofile')).sort(); for (const f of files.slice(0, Math.max(0, files.length - keepFiles))) fs.unlinkSync(path.join(directory, f)); } catch (_) { /* nothing to prune */ } };
  const cycle = async () => {
    if (stopped) return;
    try {
      const { profile } = await post('Profiler.stop');
      if (stalled.length && profile) {
        fs.mkdirSync(directory, { recursive: true });
        const name = `stall-${new Date().toISOString().replace(/[:.]/g, '-')}.cpuprofile`;
        fs.writeFileSync(path.join(directory, name), JSON.stringify(profile));
        const s = summarize(profile);
        log(`[stall] ${stalled.map(ms => Math.round(ms)).join('/')} ms held (${name}): self ${s.self.join(', ') || 'none'}; inclusive ${s.inclusive.join(', ') || 'none'}`);
        prune();
      }
      stalled = [];
      if (!stopped) await post('Profiler.start');
    } catch (err) { log(`[stall] profiler: ${String(err.message || err).slice(0, 120)}`); }
  };
  (async () => {
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: samplingUs });
    await post('Profiler.start');
    timer = setInterval(cycle, windowMs); timer.unref?.();
  })().catch(err => log(`[stall] profiler not started: ${String(err.message || err).slice(0, 120)}`));
  return {
    stalled: ms => { if (ms >= keepMs) stalled.push(ms); },
    flush: cycle,
    stop: async () => { stopped = true; if (timer) clearInterval(timer); try { await post('Profiler.stop'); await post('Profiler.disable'); } catch (_) { /* gone */ } try { session.disconnect(); } catch (_) { /* gone */ } },
  };
}

module.exports = { startStallProfiler, summarize };
