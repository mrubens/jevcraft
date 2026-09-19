'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { legacyFrames } = require('./trace');
const MAX_BYTES = 8 * 1024 * 1024;

async function readTail(file) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat(), start = Math.max(0, size - MAX_BYTES), buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start) text = text.slice(text.indexOf('\n') + 1);
    return { text, truncated: start > 0 };
  } finally { await handle.close(); }
}
async function readJson(file) {
  try { const stat = await fs.lstat(file); return stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_BYTES ? JSON.parse(await fs.readFile(file, 'utf8')) : {}; }
  catch { return {}; } // A checkpoint may be replaced between stat and read.
}
function idFor(file) { return createHash('sha256').update(file).digest('hex').slice(0, 20); }
class Archive {
  constructor({ artifacts, stateDirectory } = {}) { this.artifacts = artifacts; this.stateDirectory = stateDirectory; this.entries = new Map(); this.cache = new Map(); }
  async list() {
    const entries = [];
    if (this.artifacts) {
      for (const name of await fs.readdir(this.artifacts, { withFileTypes: true }).catch(() => [])) {
        if (!name.isDirectory()) continue;
        const directory = path.join(this.artifacts, name.name), file = path.join(directory, 'events.jsonl');
        const stat = await fs.lstat(file).catch(() => null);
        if (stat?.isFile() && !stat.isSymbolicLink()) entries.push({ id: idFor(file), label: name.name, mode: 'recording',
          updatedAt: stat.mtime.toISOString(), file, goalFile: path.join(directory, 'goal.json'), mtime: stat.mtimeMs });
      }
    }
    if (this.stateDirectory) {
      for (const name of await fs.readdir(this.stateDirectory).catch(() => [])) {
        if (!name.endsWith('.json') || /-(commands|command-tree|survival)\.json$/.test(name)) continue;
        const file = path.join(this.stateDirectory, name), stat = await fs.lstat(file).catch(() => null);
        if (stat?.isFile() && !stat.isSymbolicLink()) entries.push({ id: idFor(file), label: name.replace(/\.json$/, ''), mode: 'checkpoint',
          updatedAt: stat.mtime.toISOString(), file, goalFile: file, mtime: stat.mtimeMs });
      }
    }
    entries.sort((a, b) => b.mtime - a.mtime);
    this.entries = new Map(entries.slice(0, 100).map(e => [e.id, e]));
    return [...this.entries.values()].map(({ id, label, mode, updatedAt }) => ({ id, label, mode, updatedAt }));
  }
  async get(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const stat = await fs.stat(entry.file).catch(() => null);
    if (!stat) return null;
    const key = `${stat.mtimeMs}:${stat.size}`, cached = this.cache.get(id);
    if (cached?.key === key) return cached.value;
    const goal = await readJson(entry.goalFile);
    let rows = [], truncated = false;
    if (entry.mode === 'checkpoint') {
      rows = (goal.history || []).map(row => ({ ...row, at: row.time }));
      rows.push({ at: goal.updatedAt, status: goal.status, step: goal.step, error: goal.lastError,
        survivalAction: goal.survivalAction, decision: goal.decisions?.at(-1) });
    } else {
      const tail = await readTail(entry.file); truncated = tail.truncated;
      for (const line of tail.text.split('\n')) { try { const row = JSON.parse(line); if (row && typeof row === 'object') rows.push(row); } catch { /* incomplete line */ } }
    }
    const frames = legacyFrames(rows, goal);
    const value = { id, label: entry.label, mode: entry.mode, connected: null, epoch: 0,
      updatedAt: stat.mtime.toISOString(), revision: key, frames,
      limited: truncated || rows.length > frames.length, capabilities: { controls: false, terrain: false },
      note: 'Recorded observations. The Minecraft connection cannot be verified from these files.' };
    this.cache.set(id, { key, value });
    // Keep memory bounded while a long-running harness follows many trials.
    if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
}
module.exports = { Archive, readTail };
