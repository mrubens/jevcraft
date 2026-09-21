'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Trace } = require('./trace');
const { Archive } = require('./archive');
const { observeBot } = require('./observer');
const { demo } = require('./demo');
const { createTextures } = require('./textures');
const publicDir = path.join(__dirname, '../../public/harness');

async function startHarness({ port = 3040, artifacts, stateDirectory, textureOptions } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid dashboard port');
  const archive = new Archive({ artifacts, stateDirectory });
  const trace = new Trace();
  const sample = demo();
  const textures = createTextures(textureOptions);
  let observer, controlBusy = false;
  const threeDir = path.dirname(path.dirname(require.resolve('three')));
  const assets = new Map([
    ['/', [path.join(publicDir, 'index.html'), 'text/html']],
    ...['style.css', 'app.js', 'world.js', 'decisions.js', 'textures.js', 'robot.js'].map(f => [`/${f}`, [path.join(publicDir, f), f.endsWith('.css') ? 'text/css' : 'text/javascript']]),
    ['/jev-robot.png', [path.join(publicDir, 'jev-robot.png'), 'image/png']],
    ['/jev-robot-pack.zip', [path.join(publicDir, 'jev-robot-pack.zip'), 'application/zip']],
    ['/vendor/three.js', [path.join(threeDir, 'build/three.module.js'), 'text/javascript']],
    ['/vendor/three.core.js', [path.join(threeDir, 'build/three.core.js'), 'text/javascript']],
    ['/vendor/OrbitControls.js', [path.join(threeDir, 'examples/jsm/controls/OrbitControls.js'), 'text/javascript']],
  ]);
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  function live(after = 0) { return { ...trace.view(after), capabilities: { controls: !!observer?.connected &&
    typeof observer.controls.stop === 'function' && typeof observer.controls.resume === 'function', terrain: true },
    observationError: trace.observationError, ledger: observer?.ledger?.() ?? null,
    note: 'Live observations from the attached bot. Only loaded nearby blocks are rendered. Shapes, lighting and biome tints are simplified; textures come from the local Minecraft client when available.' }; }
  async function session(id, after = 0) {
    if (id === 'live') return live(after);
    if (id === 'demo') return sample;
    return archive.get(id);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    // Reject DNS rebinding and cross-site requests even on the loopback listener.
    const expectedHost = `127.0.0.1:${server.address()?.port}`;
    if (req.headers.host !== expectedHost && req.headers.host !== `localhost:${server.address()?.port}`) return json(res, 403, { error: 'Use the local dashboard address' });
    const origin = `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Cross-origin requests are not allowed' });
    try {
      const url = new URL(req.url, origin), pathname = url.pathname;
      if (req.method === 'GET' && pathname === '/api/textures') return json(res, 200, await textures.manifest());
      const texture = /^\/textures\/(block\/[a-z0-9_/-]+)\.png$/.exec(pathname);
      if (req.method === 'GET' && texture) {
        const png = await textures.png(texture[1]);
        if (!png) return json(res, 404, { error: 'Texture not found' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
        return res.end(png);
      }
      if (req.method === 'GET' && assets.has(pathname)) {
        const [file, type] = assets.get(pathname);
        let body = await fs.readFile(file);
        if (pathname === '/vendor/OrbitControls.js') body = body.toString().replace("from 'three'", "from '/vendor/three.js'");
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(body);
      }
      if (req.method === 'GET' && pathname === '/api/sessions') return json(res, 200, [
        ...(observer || trace.serial ? [{ id: 'live', label: trace.label, mode: 'live' }] : []),
        { id: 'demo', label: sample.label, mode: 'demo' }, ...await archive.list(),
      ]);
      const match = /^\/api\/(sessions|export)\/([a-z0-9-]+)$/.exec(pathname);
      if (req.method === 'GET' && match) {
        const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
        const value = await session(match[2], match[1] === 'export' ? 0 : after);
        if (!value) return json(res, 404, { error: 'Recording no longer available' });
        if (match[1] === 'export') res.setHeader('Content-Disposition', `attachment; filename="jev-${match[2]}.json"`);
        return json(res, 200, { format: 'jev-harness', version: 1, ...value });
      }
      if (req.method === 'POST' && pathname === '/api/control') {
        if (req.headers['x-jev-harness'] !== '1' || req.headers['content-type'] !== 'application/json') return json(res, 403, { error: 'Dashboard control header required' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) return json(res, 413, { error: 'Request too large' }); }
        let command; try { command = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        if (command.sessionId !== 'live' || !['stop', 'resume'].includes(command.action)) return json(res, 400, { error: 'Only live stop/resume controls are available' });
        if (command.resumeScope !== undefined && (command.action !== 'resume' || !['current', 'saved'].includes(command.resumeScope))) return json(res, 400, { error: 'Resume scope must be current or saved' });
        const target = observer;
        if (!target?.connected || command.expectedEpoch !== target.epoch || Date.now() - Date.parse(trace.frames.at(-1)?.at || 0) > 6000) return json(res, 409, { error: 'The connection changed or observations are stale. Refresh before controlling Jev.' });
        if (controlBusy && command.action === 'resume') return json(res, 409, { error: 'A resume request is already running' });
        if (typeof target.controls[command.action] !== 'function') return json(res, 409, { error: 'Controls are not attached' });
        if (command.action === 'resume') controlBusy = true;
        try {
          if (command.action === 'resume') await target.controls.resume({ currentOnly: command.resumeScope === 'current' });
          else await target.controls.stop();
          target.sample('control', { action: command.action });
          return json(res, 200, { ok: true });
        } finally { if (command.action === 'resume') controlBusy = false; }
      }
      json(res, 404, { error: 'Not found' });
    } catch (err) { json(res, 500, { error: 'The dashboard could not read this observation.' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`, trace,
    attach(bot, options) { observer?.detach('replaced'); observer = observeBot(trace, bot, options); return observer; },
    async close() { observer?.detach('dashboard closed'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
module.exports = { startHarness };
