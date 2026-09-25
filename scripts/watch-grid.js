'use strict';
// A page to watch the trial servers side by side: for each, the trial and
// its verdict so far, where the bot is and what it is doing, its health,
// food, armour and the rods and pearls it carries, and what it last said.
// Read-only: the flight recordings, the server logs and the trial log.
//
//   node scripts/watch-grid.js          # http://localhost:3050
//   WATCH_PORTS=25581,25582 WATCH_HTTP=3051 node scripts/watch-grid.js
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORTS = (process.env.WATCH_PORTS || '25581,25582,25583,25584,25585,25586').split(',').map(Number);
const HTTP = Number(process.env.WATCH_HTTP || 3050);
const serverDir = port => path.join(ROOT, port === 25581 ? '.clean-run' : `.clean-run-${port}`);

function tail(file, bytes = 262144) {
  try {
    const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd);
    return buf.toString('utf8').split('\n').slice(start ? 1 : 0).filter(Boolean);
  } catch (_) { return []; }
}

function latestFlight(port) {
  const dir = path.join(ROOT, '.bot-state', 'flight'), prefix = `127_0_0_1-${port}-Jev-`;
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.startsWith(prefix)).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t); } catch (_) {}
  if (!files.length) return {};
  const lines = tail(path.join(dir, files[0].f));
  const out = { updated: files[0].t };
  for (let i = lines.length - 1; i >= 0 && !(out.snapshot && out.inventory && out.equipment && out.step); i--) {
    let d; try { d = JSON.parse(lines[i]); } catch (_) { continue; }
    const s = d.snapshot || {};
    if (!out.snapshot && s.position) out.snapshot = s;
    if (!out.inventory && s.inventory && typeof s.inventory === 'object') out.inventory = s.inventory;
    if (!out.equipment && s.equipment && typeof s.equipment === 'object') out.equipment = s.equipment;
    if (!out.step && (s.step || s.goal?.step)) out.step = s.step || s.goal.step;
    if (!out.decision && d.kind === 'decision') out.decision = { at: d.at, label: d.label };
  }
  return out;
}

const DEATH = /Jev (was|died|burned|drowned|fell|blew|hit the ground|froze|suffocated|starved|tried|withered|went up)/;
function serverLog(port) {
  const lines = tail(path.join(serverDir(port), 'logs', 'latest.log'), 131072);
  const chat = lines.filter(l => l.includes('<Jev>')).slice(-40).map(l => ({ at: l.slice(1, 9), text: l.replace(/^.*<Jev> /, '') }));
  const deaths = lines.filter(l => DEATH.test(l)).map(l => ({ at: l.slice(1, 9), text: l.replace(/^.*\]: /, '') }));
  return { chat, deaths };
}

function trialFor(port) {
  const read = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', f), 'utf8')); } catch (_) { return []; } };
  const midDir = path.join(ROOT, 'artifacts', 'midgame');
  let mid = [];
  try { mid = fs.readdirSync(midDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(midDir, f), 'utf8'))); } catch (_) {}
  mid = mid.filter(t => t.port === port).map(t => ({ ...t, kind: 'midgame' }));
  const first = read('first-days-trials.json').filter(t => (t.port || 25581) === port).map(t => ({ ...t, kind: 'first days' }));
  return [...mid, ...first].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] || null;
}

function status() {
  return PORTS.map(port => {
    const flight = latestFlight(port), log = serverLog(port), trial = trialFor(port);
    const s = flight.snapshot || {}, inv = flight.inventory || {}, eq = flight.equipment || {};
    const count = k => Number(inv[k] || 0);
    const since = trial ? Date.parse(trial.startedAt) : 0;
    return {
      port, trial: trial && { world: trial.world, kind: trial.kind, minutes: Math.round((Date.now() - since) / 60000), verdict: trial.verdict || null },
      health: s.health, food: s.food, dimension: s.dimension, position: s.position && { x: Math.round(s.position.x), y: Math.round(s.position.y), z: Math.round(s.position.z) },
      step: flight.step && [flight.step.action, flight.step.phase, flight.step.item || flight.step.block].filter(Boolean).join(' · '),
      decision: flight.decision?.label, armour: ['head', 'torso', 'legs', 'feet'].map(k => eq[k]).filter(Boolean).map(n => n.split('_')[0]),
      rods: count('blaze_rod') + count('blaze_powder') / 2 + count('ender_eye') / 2, pearls: count('ender_pearl') + count('ender_eye'),
      food_carried: Object.entries(inv).filter(([k]) => /bread|cooked_|beef|mutton|apple|carrot|potato|salmon|cod|stew|rabbit/.test(k)).reduce((n, [, v]) => n + v, 0),
      chat: log.chat, deaths: log.deaths.filter(d => !since || true).slice(-2), stale: flight.updated ? Math.round((Date.now() - flight.updated) / 1000) : null,
    };
  });
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Jev trials</title>
<style>
:root{--bg:#101418;--card:#1a2027;--line:#2b333c;--text:#e6e9ec;--dim:#8b96a1;--good:#5fc27e;--warn:#e0b050;--bad:#e06464;--nether:#c0563a}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.35 -apple-system,system-ui,sans-serif}
main{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr;gap:8px;padding:8px;height:100vh;box-sizing:border-box}
.c{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow:hidden;display:flex;flex-direction:column;gap:6px}
.h{display:flex;justify-content:space-between;align-items:baseline}.h b{font-size:15px}.dim{color:var(--dim)}
.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%}
.row{display:flex;gap:10px;flex-wrap:wrap}.pill{padding:1px 7px;border-radius:9px;background:var(--line)}
.ok{color:var(--good)}.bad{color:var(--bad)}.warn{color:var(--warn)}.nether{color:var(--nether)}
.chat{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;border-top:1px solid var(--line);padding-top:6px}.chat div{flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body><main id="g"></main>
<script>
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const bar=(v,max,col)=>'<div class="bar"><i style="width:'+Math.max(0,Math.min(100,(v||0)/max*100))+'%;background:'+col+'"></i></div>';
async function tick(){
  let d; try{ d=await (await fetch('/status')).json(); }catch(e){ return; }
  document.getElementById('g').innerHTML=d.map(t=>{
    const v=t.trial&&t.trial.verdict, reached=v&&v.reachedAtMinute?Object.keys(v.reachedAtMinute):[];
    const verdict=!v?'<span class="dim">running</span>':v.pass?'<span class="ok">PASS</span>':v.failedAlready?'<span class="bad">'+esc((v.reasons||[])[0]||'failed')+'</span>':'<span class="dim">clean so far</span>';
    const dim=String(t.dimension||'');
    return '<div class="c"><div class="h"><b>'+t.port+' · '+esc(t.trial?t.trial.world:'-')+'</b><span class="dim">'+(t.trial?t.trial.minutes+' min':'')+(t.stale>30?' · <span class="warn">quiet '+t.stale+'s</span>':'')+'</span></div>'
      +'<div>'+verdict+(reached.length?' · '+reached.map(k=>'<span class="pill">'+esc(k)+' '+v.reachedAtMinute[k]+'</span>').join(' '):'')+'</div>'
      +'<div class="row"><span>❤ '+(t.health==null?'-':Math.round(t.health))+'</span><span>🍖 '+(t.food??'-')+' ('+t.food_carried+' carried)</span><span>🛡 '+(t.armour.length?esc(t.armour.join(' ')):'none')+'</span></div>'
      +bar(t.health,20,t.health<8?'var(--bad)':'var(--good)')
      +'<div class="row"><span class="'+(/nether/.test(dim)?'nether':'')+'">'+esc(dim.replace('minecraft:',''))+' '+(t.position?t.position.x+', '+t.position.y+', '+t.position.z:'')+'</span><span>rods '+t.rods+'/6</span><span>pearls '+t.pearls+'/12</span></div>'
      +'<div class="dim">'+esc(t.step||'')+(t.decision?' · <i>'+esc(t.decision)+'</i>':'')+'</div>'
      +(t.deaths.length?'<div class="bad">'+esc(t.deaths.at(-1).at+' '+t.deaths.at(-1).text)+'</div>':'')
      +'<div class="chat">'+t.chat.map(c=>'<div><span class="dim">'+esc(c.at)+'</span> '+esc(c.text)+'</div>').join('')+'</div></div>';
  }).join('');
}
tick(); setInterval(tick,3000);
</script></body></html>`;

http.createServer((req, res) => {
  if (req.url === '/status') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(status())); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
}).listen(HTTP, '127.0.0.1', () => console.log(`Watching ${PORTS.join(', ')} at http://localhost:${HTTP}`));
