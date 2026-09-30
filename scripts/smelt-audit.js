#!/usr/bin/env node
'use strict';
// Every smelt in the flight records (note 766): started, what went in (the
// raw input and the fuel), what came out, and each wait that timed out with
// what it came of. Read-only.
//   node scripts/smelt-audit.js [--since 2026-09-30T12:00:00Z] [--until ISO] [--port N] [--json] [--list]
// JEV_ROOT reads another checkout's records (from a worktree).
//
// A smelt is the run of "smelt <item>" action frames for one item with no
// gap of more than 45 seconds. The inventory is read from the frames that
// carry it (decisions, errors, every tenth observation): the last before the
// smelt began and the first from three to thirty seconds after it ended, so
// what went in and came out is net of anything else done meanwhile.
//
// Each "Timed out waiting for world/inventory update: <item> after smelting
// (have A of B, N free slots)" is read for its cause:
//   no_free_slot   no free slot at the wait (the take puts the output on the
//                  cursor, and with no slot for it mineflayer's putAway
//                  throws it on the ground: prismarine-windows' furnace
//                  output is a result slot)
//   late           a free slot, and the item arrived within ten seconds after
//                  with no smelt between (the inventory's own update late)
// and, for either, whether the item arrived after (picked up off the floor,
// or late) and how long after, whether a stack was dropped by the bot in
// the ten seconds before (the room made, then picked up again), the longest
// gap in the bot's own frames in the ten seconds before (a client that did
// not run), and the server's "Can't keep up" lines within two minutes before
// (its tick lag).
// Other ends: "Smelting X timed out" (the batch's own deadline), no fuel or
// input (refuel_furnace, "I need"), another batch in the furnace ("different
// output", "another input"), the furnace out of reach or gone, a window that
// would not open, and interruptions (a threat, a preemption).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T12:00:00Z'));
const until = Date.parse(arg('until', new Date(Date.now() + 60000).toISOString()));
const onlyPort = arg('port');
const asJson = argv.includes('--json');
const list = argv.includes('--list');
const dir = path.join(ROOT, '.bot-state', 'flight');
const GAP_MS = 45000;
const FUELS = /^(coal|charcoal|coal_block|lava_bucket|blaze_rod|.*_planks|.*_log|.*_wood|stick|dried_kelp_block|bamboo)$/;
const TIMEOUT = /inventory update: ([a-z ]+) after smelting \(have (\d+) of (\d+), (\d+|\?) free slots/;
const OTHER = [
  ['deadline', /^Smelting [a-z_]+ timed out/],
  ['no_fuel_or_input', /^I need |SmeltingSuppliesNeeded|as furnace fuel/],
  ['other_batch', /different output|another input|from another batch/],
  ['furnace_unreachable', /reach a furnace|furnace holding our saved batch stayed out of reach|reach the furnace holding|furnace is out of reach/],
  ['furnace_gone', /furnace holding our saved batch is gone|saved batch has nothing left/],
  ['window', /window|Window|openFurnace/],
];
const INTERRUPT = /^(Threat nearby|Preempted by|Low air|Interrupted|Cancelled|The detour has had its time)/;

const round = n => Math.round(n * 10) / 10;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// The server's lag lines by port, as UTC milliseconds (the logs are in the
// machine's local time).
const lagCache = new Map();
function lagLines(port) {
  if (lagCache.has(port)) return lagCache.get(port);
  const out = [];
  const logs = path.join(ROOT, `.clean-run-${port}`, 'logs');
  let files = [];
  try { files = fs.readdirSync(logs).filter(f => /^\d{4}-\d{2}-\d{2}-\d+\.log(\.gz)?$|^latest\.log$/.test(f)); } catch (_) { /* none */ }
  for (const f of files) {
    const file = path.join(logs, f);
    let day = f.slice(0, 10);
    if (f === 'latest.log') { try { day = new Date(fs.statSync(file).mtimeMs - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); } catch (_) { continue; } }
    if (Date.parse(`${day}T23:59:59Z`) + 86400000 < since) continue;
    let text = '';
    try { text = f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)).toString('utf8') : fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    for (const m of text.matchAll(/^\[(\d\d):(\d\d):(\d\d)\] \[Server thread\/WARN\]: Can't keep up! .*?Running (\d+)ms or (\d+) ticks behind/gm)) {
      const local = new Date(`${day}T${m[1]}:${m[2]}:${m[3]}`);
      out.push({ at: local.getTime(), ms: Number(m[4]), ticks: Number(m[5]) });
    }
  }
  lagCache.set(port, out);
  return out;
}

function readRecord(file) {
  const frames = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch (_) { continue; }
    const at = Date.parse(j.at);
    if (!Number.isFinite(at)) continue;
    frames.push({ at, kind: j.kind, label: j.label || '', s: j.snapshot || {}, detail: j.detail });
  }
  return frames;
}

const smelts = [], timeouts = [];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
for (const f of files) {
  const m = /-(\d{5})-Jev-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)\.jsonl$/.exec(f);
  if (!m) continue;
  const port = m[1];
  if (onlyPort && port !== String(onlyPort)) continue;
  // Records go while this reads (the janitor): one gone is passed over.
  let frames;
  try { if (fs.statSync(path.join(dir, f)).mtimeMs < since) continue; frames = readRecord(path.join(dir, f)); } catch (_) { continue; }
  const inv = frames.filter(x => x.s.inventory);
  const invBefore = t => { let best = null; for (const x of inv) { if (x.at <= t) best = x; else break; } return best; };
  const invAfter = (t, within = 30000) => inv.find(x => x.at >= t && x.at <= t + within) || null;
  // The episodes.
  let cur = null;
  const close = () => { if (cur) { smelts.push(cur); cur = null; } };
  for (const x of frames) {
    if (x.at < since || x.at > until) continue;
    const sm = x.kind === 'action' && /^smelt /.test(x.label) ? x.label.slice(6).replaceAll(' ', '_') : null;
    if (sm) {
      if (cur && (cur.item !== sm || x.at - cur.last > GAP_MS)) close();
      if (!cur) cur = { port, file: f, item: sm, start: x.at, last: x.at, step: x.s.step || null, errors: [], decisions: [] };
      cur.last = x.at;
      if (!cur.step && x.s.step) cur.step = x.s.step;
    } else if (cur && x.at - cur.last > GAP_MS) close();
    if (cur && x.at >= cur.start && x.at <= cur.last + 5000) {
      if (x.kind === 'error') cur.errors.push(x.label);
      if (x.kind === 'decision' && /^(leave_cooking|wait_here|mine_nearby|dig_in_reach|dig_stone)$/.test(x.label)) cur.decisions.push(x.label);
    }
  }
  close();
  for (const sm of smelts.filter(s => s.file === f)) {
    const b = invBefore(sm.start), a = invAfter(sm.last + 3000);
    const from = sm.step?.from || null;
    sm.wanted = sm.step?.count ?? null;
    sm.from = from;
    if (b && a) {
      const bi = b.s.inventory, ai = a.s.inventory;
      sm.inputUsed = from ? Math.max(0, (bi[from] || 0) - (ai[from] || 0)) : null;
      sm.fuelUsed = Object.keys(bi).filter(k => FUELS.test(k) && k !== from).reduce((n, k) => n + Math.max(0, (bi[k] || 0) - (ai[k] || 0)), 0);
      // The most of the output carried from the start to twenty seconds
      // after: an iron pickaxe crafted at once takes the ingots again.
      const peak = inv.filter(y => y.at >= sm.start && y.at <= sm.last + 20000).reduce((n, y) => Math.max(n, y.s.inventory[sm.item] || 0), ai[sm.item] || 0);
      sm.outputGained = Math.max(0, peak - (bi[sm.item] || 0));
    }
  }
  // The timeouts after smelting, read for their cause.
  const smeltAt = frames.filter(x => x.kind === 'action' && /^smelt /.test(x.label)).map(x => x.at);
  for (let i = 0; i < frames.length; i++) {
    const x = frames[i];
    if (x.kind !== 'error' || x.at < since || x.at > until) continue;
    const t = TIMEOUT.exec(x.label);
    if (!t) continue;
    // The same error logged twice by the layers it passes through.
    if (timeouts.some(o => o.port === port && o.label === x.label && Math.abs(Date.parse(o.at) - x.at) < 2000)) continue;
    const item = t[1].replaceAll(' ', '_'), have = Number(t[2]), want = Number(t[3]), free = t[4] === '?' ? null : Number(t[4]);
    // The item's count from the frame's own inventory on; arrival is the
    // first frame after with more of it than the wait saw.
    let arrived = null, newSmelt = null;
    for (const y of inv) {
      if (y.at <= x.at) continue;
      if (y.at > x.at + 60000) break;
      if ((y.s.inventory[item] || 0) > have) { arrived = y.at; break; }
    }
    if (arrived) newSmelt = smeltAt.find(s => s > x.at + 500 && s < arrived) || null;
    // A stack dropped by the bot in the ten seconds before: a kind that was
    // carried and is gone, or fell by a whole stack or more, with no smelt
    // input or fuel among them.
    const b = invBefore(x.at - 10000), n = invBefore(x.at);
    const dropped = b && n ? Object.keys(b.s.inventory).filter(k => k !== item && !FUELS.test(k) && !/^raw_|^(beef|mutton|porkchop|chicken|rabbit|cod|salmon|potato|kelp)$/.test(k) && (b.s.inventory[k] || 0) - (n.s.inventory[k] || 0) >= Math.min(b.s.inventory[k], 16)) : [];
    // The client's own stalls: the longest gap in its frames.
    let gap = 0, prev = null;
    for (let j = i; j >= 0 && frames[j].at >= x.at - 10000; j--) { if (prev !== null) gap = Math.max(gap, prev - frames[j].at); prev = frames[j].at; }
    const lag = lagLines(x.port || port).filter(l => l.at >= x.at - 120000 && l.at <= x.at + 5000);
    const after = arrived ? round((arrived - x.at) / 1000) : null;
    const cause = free === 0 ? 'no_free_slot' : after !== null && after <= 10 && !newSmelt ? 'late' : 'other';
    timeouts.push({ port, label: x.label, at: new Date(x.at).toISOString(), item, have, want, free, cause, arrivedAfterS: after, arrivedByNewSmelt: !!newSmelt, droppedBefore: dropped, frameGapMs: gap, serverLag: lag.length ? { lines: lag.length, maxTicksBehind: Math.max(...lag.map(l => l.ticks)) } : null });
  }
}

// Each smelt's end.
for (const sm of smelts) {
  const e = sm.errors.find(l => TIMEOUT.test(l));
  const other = OTHER.find(([, re]) => sm.errors.some(l => re.test(l)));
  sm.outcome = e ? 'timeout_after_smelting'
    : sm.decisions.includes('leave_cooking') ? 'left_to_cook'
      : sm.wanted && sm.outputGained >= sm.wanted ? 'done'
        : other ? other[0]
          : sm.outputGained > 0 ? 'part'
            : sm.errors.some(l => INTERRUPT.test(l)) ? 'interrupted'
              : sm.outputGained === undefined ? 'unread' : 'nothing_out';
}
const by = (a, k) => a.reduce((o, x) => { o[x[k]] = (o[x[k]] || 0) + 1; return o; }, {});
const summary = {
  since: new Date(since).toISOString(),
  smelts: smelts.length,
  started: smelts.filter(s => s.inputUsed > 0).length,
  startedWithOutput: smelts.filter(s => s.inputUsed > 0 && s.outputGained > 0).length,
  byItem: by(smelts, 'item'),
  byOutcome: by(smelts, 'outcome'),
  inputUsed: smelts.reduce((n, s) => n + (s.inputUsed || 0), 0),
  fuelUsed: smelts.reduce((n, s) => n + (s.fuelUsed || 0), 0),
  outputGained: smelts.reduce((n, s) => n + (s.outputGained || 0), 0),
  withInputAndNothingOut: smelts.filter(s => s.inputUsed > 0 && !s.outputGained).length,
  timeoutsAfterSmelting: timeouts.length,
  timeoutsByCause: by(timeouts, 'cause'),
  timeoutsByFreeSlots: by(timeouts, 'free'),
  timeoutItemArrivedAfter: { count: timeouts.filter(t => t.arrivedAfterS !== null && !t.arrivedByNewSmelt).length, medianS: median(timeouts.filter(t => t.arrivedAfterS !== null && !t.arrivedByNewSmelt).map(t => t.arrivedAfterS)) },
  timeoutsWithAStackDroppedBefore: timeouts.filter(t => t.droppedBefore.length).length,
  timeoutsWithAClientGapOver2s: timeouts.filter(t => t.frameGapMs > 2000).length,
  timeoutsWithServerLagBefore: timeouts.filter(t => t.serverLag).length,
};
for (const t of timeouts) delete t.label;
if (asJson) { console.log(JSON.stringify({ summary, timeouts, smelts: list ? smelts : undefined }, null, 2)); process.exit(0); }
console.log(JSON.stringify(summary, null, 2));
console.log('\nTimeouts after smelting:');
for (const t of timeouts) console.log(`  ${t.port} ${t.at} ${t.item} have ${t.have} of ${t.want}, ${t.free} free: ${t.cause}; arrived ${t.arrivedAfterS === null ? 'not within 60 s' : `${t.arrivedAfterS} s after${t.arrivedByNewSmelt ? ' (by a new smelt)' : ''}`}; dropped before: ${t.droppedBefore.join(', ') || 'none'}; frame gap ${t.frameGapMs} ms; server lag ${t.serverLag ? `${t.serverLag.lines} lines, ${t.serverLag.maxTicksBehind} ticks` : 'none'}`);
if (list) for (const s of smelts) console.log(`  ${s.port} ${new Date(s.start).toISOString()} ${s.item} want ${s.wanted} in ${s.inputUsed} fuel ${s.fuelUsed} out ${s.outputGained}: ${s.outcome}${s.errors.length ? ` [${[...new Set(s.errors)].slice(0, 3).join(' | ').slice(0, 160)}]` : ''}`);
