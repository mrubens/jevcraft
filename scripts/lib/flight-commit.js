'use strict';
// The flight records grouped by the git commit the bot ran (the connection
// frame's `commit`, src/recorder/commit.js). Bots restart onto new builds
// every ten to fifteen minutes, so a cohort split at one ISO time mixes
// builds; here each run (one bot process: its flight file and that file's
// -partN continuations) belongs to the commit it loaded. Records written
// before the commit was recorded are grouped as 'unknown'.
//
// Read line by line with cheap patterns, not a JSON parse of every frame
// (a day's records are gigabytes): the time, the health and dimension, and
// the pockets when a frame carries them.
const fs = require('node:fs');
const path = require('node:path');

const GAP_MS = 60000;           // a longer silence between frames is the bot down, not bot time
const HEAD_BYTES = 2 * 1024 * 1024;  // a connection frame is among the first frames of a run

const runKey = file => file.replace(/-part\d+\.jsonl$/, '.jsonl');
const partOf = file => { const m = file.match(/-part(\d+)\.jsonl$/); return m ? Number(m[1]) : 1; };
const timeOf = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };
const VITALS = /"dimension":"([a-z_:]+)",(?:"gameMode":"[a-z]*","flying":(?:true|false),)?"health":(-?[\d.]+)/;
const COMMIT = /(?:^|\n)\{"kind":"connection"[^\n]*?"commit":"([0-9a-f]{4,40})"/;
const INVENTORY = /"inventory":\{([^}]*)\}/;

// The commit named in the head of a flight file's text, or null.
const commitOfText = text => { const m = COMMIT.exec(text); return m ? m[1] : null; };

// The commit of each run in a directory: from its first part's head (a
// later part starts mid-run and carries none of its own unless it
// reconnected). Map of run key -> commit.
function commitsByRun(dir, files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
  const byRun = new Map();
  for (const f of [...files].sort((a, b) => partOf(a) - partOf(b))) {
    const key = runKey(f);
    if (byRun.get(key)) continue;
    let head = '';
    try { const fd = fs.openSync(path.join(dir, f), 'r'); const buf = Buffer.alloc(HEAD_BYTES); const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0); fs.closeSync(fd); head = buf.toString('utf8', 0, n); } catch (_) { continue; }
    const c = commitOfText(head);
    if (c) byRun.set(key, c); else if (!byRun.has(key)) byRun.set(key, null);
  }
  return byRun;
}

// One file's lines to its measures. `from`/`to` (ms) cut frames outside.
// Bot time is the sum of gaps between frames under a minute; a death is
// health going from above zero to zero; rods gained are the rises in the
// blaze rods carried between two pocket samples (a rod picked up again
// after a death counts: the record cannot tell); a Nether entry is a frame in
// the Nether after one in another dimension (a run begun in the Nether by a
// stage save is not an entry).
function measureLines(lines, { from = -Infinity, to = Infinity } = {}) {
  const m = { frames: 0, botMs: 0, deaths: 0, rods: 0, netherEntries: 0, first: null, last: null };
  let prevT = null, prevHp = null, prevDim = null, rods = null;
  for (const line of lines) {
    if (!line) continue;
    const t = timeOf(line);
    if (!(t >= from && t <= to)) continue;
    m.frames++;
    if (m.first === null) m.first = t;
    m.last = t;
    if (prevT !== null && t - prevT <= GAP_MS && t >= prevT) m.botMs += t - prevT;
    prevT = t;
    const v = VITALS.exec(line);
    if (v) {
      const dim = v[1], hp = Number(v[2]);
      if (hp === 0 && prevHp > 0) m.deaths++;
      prevHp = hp;
      if (dim === 'the_nether' && prevDim && prevDim !== 'the_nether') m.netherEntries++;
      prevDim = dim;
    }
    if (line.includes('"inventory":{')) {
      const inv = INVENTORY.exec(line);
      if (inv) {
        const r = /"blaze_rod":(\d+)/.exec(inv[1]), n = r ? Number(r[1]) : 0;
        if (rods !== null && n > rods) m.rods += n - rods;
        rods = n;
      }
    }
  }
  return m;
}

// The runs of a directory: [{ key, commit, port, start, ...measures }],
// each run's parts summed.
function readRuns(dir, { from = -Infinity, to = Infinity } = {}) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && fs.statSync(path.join(dir, f)).mtimeMs >= from);
  const commits = commitsByRun(dir);
  const runs = new Map();
  for (const f of files.sort((a, b) => partOf(a) - partOf(b))) {
    const key = runKey(f);
    let text; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { continue; }
    const m = measureLines(text.split('\n'), { from, to });
    if (!m.frames) continue;
    let r = runs.get(key);
    if (!r) runs.set(key, r = { key, commit: commits.get(key) || null, port: (key.match(/-(\d{4,5})-/) || [])[1] || null, frames: 0, botMs: 0, deaths: 0, rods: 0, netherEntries: 0, first: m.first, last: m.last });
    r.frames += m.frames; r.botMs += m.botMs; r.deaths += m.deaths; r.rods += m.rods; r.netherEntries += m.netherEntries;
    r.first = Math.min(r.first, m.first); r.last = Math.max(r.last, m.last);
  }
  return [...runs.values()];
}

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
// Runs to one row per commit, the first run's time ordering them ('unknown'
// last): runs, ports, bot hours, deaths, rods, the runs that gained a rod
// (the first rod of the run) and Nether entries, each with its per bot-hour.
function groupByCommit(runs) {
  const by = new Map();
  for (const r of runs) {
    const k = r.commit || 'unknown';
    let g = by.get(k);
    if (!g) by.set(k, g = { commit: k, runs: 0, ports: new Set(), botHours: 0, deaths: 0, rods: 0, firstRods: 0, netherEntries: 0, runsEntered: 0, first: r.first, last: r.last });
    g.runs++; if (r.port) g.ports.add(r.port);
    g.botHours += r.botMs / 3600000; g.deaths += r.deaths; g.rods += r.rods; g.netherEntries += r.netherEntries;
    if (r.rods > 0) g.firstRods++;
    if (r.netherEntries > 0) g.runsEntered++;
    g.first = Math.min(g.first, r.first); g.last = Math.max(g.last, r.last);
  }
  return [...by.values()].sort((a, b) => (a.commit === 'unknown') - (b.commit === 'unknown') || a.first - b.first).map(g => ({
    commit: g.commit, runs: g.runs, ports: g.ports.size, botHours: round(g.botHours), deaths: g.deaths, deathsPerHour: g.botHours ? round(g.deaths / g.botHours) : null,
    rods: g.rods, rodsPerHour: g.botHours ? round(g.rods / g.botHours) : null, runsWithRod: g.firstRods, netherEntries: g.netherEntries, runsEntered: g.runsEntered,
    from: new Date(g.first).toISOString(), to: new Date(g.last).toISOString() }));
}

function commitTable(rows) {
  const head = ['commit', 'runs', 'bot-hours', 'deaths', 'deaths/h', 'rods', 'rods/h', 'runs with a rod', 'Nether entries', 'first frame', 'last frame'];
  const body = rows.map(r => [r.commit, r.runs, r.botHours, r.deaths, r.deathsPerHour ?? '-', r.rods, r.rodsPerHour ?? '-', r.runsWithRod, `${r.netherEntries} (${r.runsEntered} runs)`, r.from.slice(5, 16) + 'Z', r.to.slice(5, 16) + 'Z'].map(String));
  const width = head.map((h, i) => Math.max(h.length, ...body.map(r => r[i].length)));
  const line = r => r.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd();
  return [line(head), ...body.map(line)].join('\n');
}

module.exports = { runKey, partOf, timeOf, commitOfText, commitsByRun, measureLines, readRuns, groupByCommit, commitTable, GAP_MS };
