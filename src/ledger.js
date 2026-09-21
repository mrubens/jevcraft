'use strict';
const fs = require('fs');
const path = require('path');

// Where the time and the tokens went. Every Jev call the TypeSafe client
// makes is charged to a run, and the tally lives on disk so a restart
// carries on counting rather than starting from nothing. A run is a dream,
// from the moment it is given until it is satisfied or cleared, or a single
// player request until it completes or blocks. Calls that belong to no run
// (idle survival with no dream, chat that started no work) go to one
// standing bucket per world, so nothing is ever uncounted.
const PROCESS_ID = `${process.pid}-${Date.now().toString(36)}`;
const KEEP_CLOSED = 20;
const KEEP_OPEN = 20;
const TICKS_PER_DAY = 24000;

const tally = () => ({ calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 });
// TypeSafe names the counts input/output; OpenRouter names them prompt/completion.
const inputOf = usage => Number(usage?.input_tokens ?? usage?.prompt_tokens) || 0;
const outputOf = usage => Number(usage?.output_tokens ?? usage?.completion_tokens) || 0;
function charge(bucket, { usage, latencyMs, ok = true }) {
  bucket.calls++;
  if (!ok) bucket.failed++;
  bucket.inputTokens += inputOf(usage);
  bucket.outputTokens += outputOf(usage);
  bucket.latencyMs += Number.isFinite(latencyMs) ? Math.round(latencyMs) : 0;
}
function merge(into, from) {
  for (const key of Object.keys(tally())) into[key] += from[key] || 0;
}
const iso = ms => new Date(ms).toISOString();
const newRun = ({ id, kind, name, startedAt }) => ({ id, kind, name, status: 'open', startedAt, endedAt: null, restarts: 0, processId: null, ...tally(), byKind: {}, byDay: {} });

class Ledger {
  // `age` reads the world's tick age so a call can be filed under its
  // in-game day; `onClose` hears about every finished run.
  constructor(file, { processId = PROCESS_ID, now = () => Date.now(), age = () => undefined, onClose = () => {} } = {}) {
    this.file = file; this.processId = processId; this.now = now; this.age = age; this.onClose = onClose;
    this.state = this.read();
  }
  read() {
    let saved = null;
    // A ledger that cannot be read is not worth crashing the bot over.
    try { if (this.file && fs.existsSync(this.file)) saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { saved = null; }
    if (saved?.version !== 1) saved = null;
    const state = { version: 1, runs: {}, closed: [], ...saved };
    state.idle ||= newRun({ id: 'idle', kind: 'idle', name: 'Between requests', startedAt: iso(this.now()) });
    return state;
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.state.updatedAt = iso(this.now());
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
  // A run last written by another process was carried across a restart.
  // A reconnect inside one process is not a restart and does not count.
  touch(run) {
    if (run.processId === this.processId) return;
    if (run.processId) run.restarts++;
    run.processId = this.processId;
  }
  // Start a run, or pick an existing one back up: a saved goal resumed after
  // a stop or a restart keeps its id and therefore its totals.
  open({ id, kind = 'request', name = '', startedAt } = {}) {
    let run = id ? this.state.runs[id] : null;
    if (!run && id) {
      const index = this.state.closed.findIndex(r => r.id === id);
      if (index >= 0) { run = this.state.closed.splice(index, 1)[0]; run.status = 'open'; run.endedAt = null; delete run.elapsedMs; this.state.runs[id] = run; }
    }
    if (!run) {
      id ||= `${kind}-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      run = this.state.runs[id] = newRun({ id, kind, name, startedAt: startedAt && Number.isFinite(Date.parse(startedAt)) ? startedAt : iso(this.now()) });
    }
    this.touch(run);
    // Requests that were replaced and never resumed would pile up forever.
    const open = Object.values(this.state.runs).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    while (open.length > KEEP_OPEN) this.close(open.shift().id, 'abandoned');
    this.save();
    return run;
  }
  record({ run: id, kind = 'other', usage, latencyMs, ok = true } = {}) {
    const run = (id && this.state.runs[id]) || this.state.idle;
    this.touch(run);
    const entry = { usage, latencyMs, ok };
    charge(run, entry);
    charge(run.byKind[kind] ||= tally(), entry);
    const age = this.age();
    if (Number.isFinite(age) && age >= 0) charge(run.byDay[Math.floor(age / TICKS_PER_DAY)] ||= tally(), entry);
    this.save();
    return run;
  }
  // A chat message that started no work is not a run of its own; what it
  // cost joins the standing bucket, under the kinds it was asked as.
  fold(id) {
    const run = this.state.runs[id];
    if (!run) return;
    delete this.state.runs[id];
    merge(this.state.idle, run);
    for (const [kind, bucket] of Object.entries(run.byKind)) merge(this.state.idle.byKind[kind] ||= tally(), bucket);
    for (const [day, bucket] of Object.entries(run.byDay)) merge(this.state.idle.byDay[day] ||= tally(), bucket);
    this.save();
  }
  close(id, status = 'complete') {
    const run = this.state.runs[id];
    if (!run) return null;
    delete this.state.runs[id];
    run.status = status; run.endedAt = iso(this.now()); run.elapsedMs = Math.max(0, this.now() - Date.parse(run.startedAt));
    this.state.closed.push(run);
    this.state.closed = this.state.closed.slice(-KEEP_CLOSED);
    this.save();
    try { this.onClose(run); } catch (err) { console.error('[ledger]', err.message); }
    return run;
  }
  get(id) { return (id && this.state.runs[id]) || this.state.closed.find(r => r.id === id) || null; }
  // What the Observatory shows: the named run, or the standing bucket when
  // nothing is running, with the totals worked out for right now.
  view(id) {
    const run = this.get(id) || this.state.idle;
    return { current: summarize(run, this.now()), recent: this.state.closed.slice(-3).reverse().map(r => summarize(r, this.now())) };
  }
}

function summarize(run, now = Date.now()) {
  const { processId: _processId, byKind, byDay, ...rest } = run;
  const bucketRow = ([key, b]) => ({ key, calls: b.calls, failed: b.failed, tokens: b.inputTokens + b.outputTokens, inputTokens: b.inputTokens, outputTokens: b.outputTokens, latencyMs: b.latencyMs });
  return { ...rest, tokens: run.inputTokens + run.outputTokens,
    elapsedMs: run.endedAt ? run.elapsedMs ?? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt)) : Math.max(0, now - Date.parse(run.startedAt)),
    byKind: Object.entries(byKind).map(bucketRow).sort((a, b) => b.calls - a.calls),
    byDay: Object.entries(byDay).map(bucketRow).sort((a, b) => Number(a.key) - Number(b.key)) };
}

// Charge every call made through this client to one run. The run may be a
// function, for a client shared by whatever happens to be active.
function withRun(client, run) {
  return { systemOne(args) { return client.systemOne({ run: typeof run === 'function' ? run() : run, ...args }); } };
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h) return `${h}h ${m % 60}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const HEADER = `# Run ledger

One line per finished run, written by the bot itself (\`src/ledger.js\`): a dream from the moment it was given until it was satisfied or cleared, or a single player request until it completed or blocked. Tokens are Jev's, input plus output, over every call the run made; restarts count the processes that carried the run after the one that started it. A request resumed after it blocked gets a second line with its running totals when it ends again. The live figures, with the breakdown by question kind, are in the Observatory.

| Started (UTC) | Run | Outcome | Elapsed | Restarts | Jev calls | Tokens |
|---|---|---|---|---|---|---|
`;
const cell = text => String(text ?? '').replace(/[|\s]+/g, ' ').trim();
function summaryLine(run) {
  const started = Number.isFinite(Date.parse(run.startedAt)) ? run.startedAt.slice(0, 16).replace('T', ' ') : '—';
  const elapsed = run.elapsedMs ?? (Date.parse(run.endedAt) - Date.parse(run.startedAt));
  return `| ${started} | ${cell(run.kind)} · ${cell(run.name) || 'unnamed'} | ${cell(run.status)} | ${duration(elapsed)} | ${run.restarts} | ${run.calls}${run.failed ? ` (${run.failed} failed)` : ''} | ${(run.inputTokens + run.outputTokens).toLocaleString('en-US')} (${run.inputTokens.toLocaleString('en-US')} in, ${run.outputTokens.toLocaleString('en-US')} out) |`;
}
function appendSummary(file, run) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, HEADER);
  const existing = fs.readFileSync(file, 'utf8');
  fs.appendFileSync(file, `${existing.endsWith('\n') || !existing ? '' : '\n'}${summaryLine(run)}\n`);
}

module.exports = { Ledger, withRun, summarize, summaryLine, appendSummary, duration, charge, HEADER, TICKS_PER_DAY };
