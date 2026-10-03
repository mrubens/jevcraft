'use strict';
// A switch for finding what a slow stance build spends its time on (note
// 1080): while the file .bot-state/profile-stance exists, each build of the
// stance's options is sampled by the engine's own profiler, and one that
// ran SLOW_MS or more says its heaviest functions of this code. Off (no
// file) nothing is sampled and nothing is paid. On 2026-10-03 the builds at
// blaze spawners blocked the body a median 335 ms (p90 738, 933 of them),
// blazeStands 254 ms a call, and the arena's swarm drill did not show which
// search inside it.
const fs = require('fs');
const path = require('path');
const FLAG = path.join(__dirname, '..', '.bot-state', 'profile-stance');
const SLOW_MS = 300, LOOK_MS = 10000;
let lookedAt = 0, on = false, session = null;

function enabled(now = Date.now()) {
  if (now - lookedAt > LOOK_MS) { lookedAt = now; try { on = fs.existsSync(FLAG); } catch (_) { on = false; } }
  return on;
}
// The heaviest functions by inclusive time, of the files under src/.
function heaviest(profile, top = 8) {
  const nodes = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const incl = {};
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i] || 0, seen = new Set();
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const f = nodes.get(cur).callFrame;
      if (!/\/src\/[^/]+\.js$/.test(f.url) || !f.functionName || /stance-profile\.js$/.test(f.url) || f.functionName === 'stanceOptions') continue;
      const k = `${f.functionName} ${f.url.split('/').pop()}`;
      if (!seen.has(k)) { seen.add(k); incl[k] = (incl[k] || 0) + dt; }
    }
  });
  return Object.entries(incl).sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${k} ${Math.round(v / 1000)} ms`);
}
// Runs `build` and returns what it returns; sampled and said when slow.
function around(build, log = console.log) {
  if (!enabled()) return build();
  let started = false;
  try {
    if (!session) { session = new (require('inspector').Session)(); session.connect(); session.post('Profiler.enable'); session.post('Profiler.setSamplingInterval', { interval: 500 }); }
    session.post('Profiler.start'); started = true;
  } catch (_) { started = false; }
  const t0 = Date.now();
  try { return build(); }
  finally {
    if (started) {
      try {
        session.post('Profiler.stop', (err, r) => {
          const ms = Date.now() - t0;
          if (!err && r?.profile && ms >= SLOW_MS) log(`[slow] stanceOptions profile, ${ms} ms: ${heaviest(r.profile).join(', ')}`);
        });
      } catch (_) { /* not said */ }
    }
  }
}

module.exports = { around, heaviest, enabled, FLAG, SLOW_MS };
