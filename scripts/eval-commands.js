'use strict';
require('../src/env').loadEnv();
const fs = require('fs');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { TypeSafe } = require('../src/typesafe');
const { classifyCommand } = require('../src/command-classifier');
const server = mineflayer.createBot({ host: '127.0.0.1', port: 25567, version: '26.1', username: 'TreeProbe', auth: 'offline' });
server._client.on('declare_commands', tree => { server.commandTree = tree; });
const cases = [
  ['Jev please make it daytime', /^\/time set (?:minecraft:)?day$/],
  ['Jev turn it to night', /^\/time set (?:minecraft:)?night$/],
  ['Jev can you stop the rain?', /^\/weather clear$/],
  ['Jev teleport me to you', /^\/teleport Steve (Jev|@s)$/],
  ['Jev teleport yourself to me', /^\/teleport (?:(?:Jev|@s) )?Steve$/],
  ['Jev put me in creative mode', /^\/gamemode creative Steve$/],
  ['Jev set the difficulty to peaceful', /^\/difficulty peaceful$/],
  ['Jev enable keep inventory when we die', /^\/gamerule (?:minecraft:)?(?:keep_inventory|keepInventory) true$/],
  ['Jev summon a cow at my position', /^\/summon (?:minecraft:)?cow 10 64 20$/],
  ['Jev set the block at 10 70 20 to gold', /^\/setblock 10 70 20 minecraft:gold_block(?: replace)?$/],
];
server.once('spawn', async () => {
  const results = [];
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (server.commandTree.nodes.length < 100) throw new Error('TreeProbe needs temporary OP for the full command catalog');
    const bot = { username: 'Jev', registry: server.registry, commandTree: server.commandTree,
      players: { Jev: { entity: { position: new Vec3(0, 64, 0) } }, Steve: { entity: { position: new Vec3(10, 64, 20) } }, Alex: {} },
      tabComplete: (...args) => server.tabComplete(...args) };
    const client = new TypeSafe();
    for (const [request, expected] of cases) {
      try {
        const result = await classifyCommand(client, bot, request, 'Steve');
        const pass = expected.test(result.command);
        results.push({ request, pass, expected: expected.source, result });
        console.log(JSON.stringify({ request, pass, command: result.command, latencyMs: result.latencyMs }));
      } catch (err) { results.push({ request, pass: false, error: err.message, command: err.command, judgments: err.judgments }); console.log(JSON.stringify({ request, pass: false, error: err.message, command: err.command, verification: err.judgments?.at(-1)?.verification })); }
    }
    const artifact = `artifacts/command-eval-${Date.now()}.json`;
    fs.writeFileSync(artifact, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, total: results.length, artifact }));
    if (results.some(r => !r.pass)) process.exitCode = 1;
  } catch (err) { console.error(err); process.exitCode = 1; }
  finally { server.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
