'use strict';
// Isolated session/control test: a maintenance wake must not revive old work.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createSession } = require('../src/session'), { startHarness } = require('../src/harness/server');
const { Task } = require('../src/skills'), { waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577, 25579, 25580, 25582].includes(port)) throw new Error('Explicit isolated fixture MC_PORT required');
const id = Date.now().toString(36), username = `Wake${id}`, directory = path.resolve('artifacts', `maintenance-resume-${id}`);
fs.mkdirSync(directory, { recursive: true });
const identity = `127_0_0_1-${port}-${username}`, checkpoint = path.join(directory, identity + '.json');
const old = { kind: 'build', request: 'an older duplicate', status: 'replaced', createdAt: '2026-09-18T00:00:00Z' };
fs.writeFileSync(checkpoint, JSON.stringify({ version: 1, kind: 'build', request: 'the finished build', status: 'complete', createdAt: '2026-09-19T00:00:00Z', suspendedTasks: [old] }));
fs.writeFileSync(path.join(directory, identity + '-survival.json'), JSON.stringify({ version: 1, shelters: [], paused: true }));
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const task = new Task('maintenance wake'), timer = setTimeout(() => task.cancel(), 180000);
(async () => {
  let session, harness;
  try {
    harness = await startHarness({ port: 0 });
    session = createSession({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' }, { ask: () => assert.fail('Maintenance must not request a new plan') }, { stateDirectory: directory, harness });
    await new Promise((resolve, reject) => { session.bot.once('spawn', resolve); session.bot.once('error', reject); });
    await session.bot.waitForChunksToLoad();
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify([`gamemode creative ${username}`], null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 120000);
    await waitFor(task, () => session.bot.game.gameMode === 'creative', 10000);
    const before = JSON.parse(fs.readFileSync(checkpoint)), state = await (await fetch(harness.url + '/api/sessions/live')).json();
    const response = await fetch(harness.url + '/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jev-Harness': '1' },
      body: JSON.stringify({ action: 'resume', resumeScope: 'current', sessionId: 'live', expectedEpoch: state.epoch }) });
    assert.equal(response.status, 200); await session.bot.waitForTicks(30);
    assert.deepEqual(JSON.parse(fs.readFileSync(checkpoint)), before, 'Finished request and suspended tasks remain unchanged');
    const saved = JSON.parse(fs.readFileSync(path.join(directory, identity + '-survival.json'))); assert.equal(saved.paused, false);
    const observation = await (await fetch(harness.url + '/api/sessions/live')).json();
    assert.equal(observation.frames.at(-1).snapshot.goal.kind, 'survive', 'Idle companion resumed without launching older work');
    log({ result: 'PASS', request: before.request, status: before.status, suspendedTasks: before.suspendedTasks.length, idle: true, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); session?.shutdown(); await harness?.close(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
