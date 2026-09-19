import { WorldView } from './world.js';
import { branches } from './decisions.js';
const $ = id => document.getElementById(id), human = text => String(text || '').replaceAll('_', ' ');
const text = (id, value) => { $(id).textContent = value ?? '—'; };
const el = (tag, content, className) => { const node = document.createElement(tag); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node; };
const time = at => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Time not recorded';
let viewer;
try { viewer = new WorldView($('viewport')); }
catch { $('world-empty').hidden = false; text('world-empty', '3D requires WebGL 2. The decision inspector and recordings still work in this browser.'); }
let sessions = [], data, frames = [], selectedId, follow = true, playing = null, sessionId = '', fetchRevision = 0, online = false;
const sourceNames = { fable: 'Fable adviser', jev: 'Jev classifier', rules: 'Execution rule', survival: 'Survival response', observed: 'Observation', stale: 'Discarded decision' };
let toastTimer;
function toast(message) { text('toast', message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
async function json(url, options) { const response = await fetch(url, options); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Request failed'); return value; }

async function loadSources() {
  sessions = await json('/api/sessions');
  const selected = sessionId || new URLSearchParams(location.search).get('session') || (sessions.some(s => s.id === 'live') ? 'live' : 'demo');
  $('session').replaceChildren();
  for (const session of sessions) { const option = el('option', `${session.mode === 'checkpoint' ? 'Checkpoint · ' : session.mode === 'recording' ? 'Run · ' : ''}${session.label}`); option.value = session.id; $('session').append(option); }
  if (sessionId === 'import') { const option = el('option', 'Opened trace'); option.value = 'import'; $('session').append(option); }
  $('session').value = selected;
  if (!sessionId) await switchSession(sessions.some(s => s.id === selected) ? selected : 'demo');
}
async function switchSession(id) {
  stopPlayback(); sessionId = id; data = null; frames = []; selectedId = null; follow = true; fetchRevision++;
  $('session').value = id; viewer && (viewer.worldKey = null);
  history.replaceState(null, '', `?session=${encodeURIComponent(id)}`);
  await refresh(); viewer?.reset();
}
async function refresh() {
  if (!sessionId || sessionId === 'import') return;
  const revision = fetchRevision, id = sessionId;
  try {
    const next = await json(`/api/sessions/${id}${id === 'live' && data ? `?after=${frames.at(-1)?.id || 0}` : ''}`);
    if (revision !== fetchRevision || id !== sessionId) return;
    online = true;
    const previousLatest = frames.at(-1)?.id, previousSelected = selectedId;
    const changed = !data || next.epoch !== data.epoch || next.revision !== data.revision || (next.frames.at(-1)?.id ?? previousLatest) !== previousLatest;
    if (data && (id === 'demo' || (!changed && id !== 'live'))) { render(false); return; }
    if (id === 'live' && data) frames = [...frames, ...next.frames].filter(f => f.id >= next.oldestId).slice(-600);
    else frames = next.frames || [];
    data = next;
    if (follow || !frames.some(f => f.id === selectedId)) selectedId = frames.at(-1)?.id;
    render((changed && follow) || previousSelected !== selectedId);
  } catch (err) {
    if (revision !== fetchRevision) return;
    online = false; text('connection', 'Viewer unavailable'); text('freshness', 'Last received data retained'); $('connection-dot').className = 'dot'; $('stop').disabled = $('resume').disabled = true;
    if (!data) toast(err.message);
  }
}
function render(updateScene = true) {
  const index = frames.findIndex(f => f.id === selectedId), frame = frames[index];
  const snapshot = frame?.snapshot || {}, goal = snapshot.goal || {};
  const latest = frames.at(-1), age = latest?.at ? Date.now() - Date.parse(latest.at) : Infinity;
  const live = data.mode === 'live' && data.connected === true && online && age < 6000;
  text('connection', data.mode === 'demo' ? 'Illustrated sample' : data.mode === 'live' ? live ? 'Connected to Jev' : data.connected ? 'Observations stale' : 'Jev disconnected' : 'Recorded observations');
  $('connection-dot').className = `dot${live ? ' live' : ''}`;
  text('freshness', data.mode === 'live' ? `Last sample ${Number.isFinite(age) ? Math.max(0, Math.floor(age / 1000)) + 's ago' : 'unavailable'}` : data.mode === 'demo' ? 'Synthetic · explore the interface' : 'Minecraft connection unverified');
  $('stop').disabled = !(live && data.capabilities?.controls);
  $('resume').disabled = !(live && data.capabilities?.controls && follow);
  text('session-note', data.note || 'Recorded trace. Controls are unavailable.');
  $('scrub').max = String(Math.max(0, frames.length - 1)); $('scrub').value = String(Math.max(0, index));
  if (!updateScene) { renderTimeline(); return; }
  text('objective', goal.request || (frame ? 'No request recorded' : 'Waiting for Jev’s first observation'));
  text('goal-status', human(goal.status || 'unknown'));
  text('step', human([goal.step?.action, goal.step?.item || goal.step?.block].filter(Boolean).join(' ')) || 'No action recorded');
  $('dependencies').replaceChildren();
  for (const dep of (goal.dependencies || []).slice(0, 8)) $('dependencies').append(el('span', `${human(dep.action)} ${dep.count || ''} ${human(dep.item)}`.trim(), 'dependency'));
  for (const metric of ['health', 'food']) { text(metric, snapshot[metric] ?? '—'); $(metric + '-bar').style.width = `${Math.max(0, Math.min(100, (snapshot[metric] || 0) * 5))}%`; }
  text('position', snapshot.position ? ['x', 'y', 'z'].map(k => Math.floor(snapshot.position[k])).join(' / ') : 'Unknown');
  text('dimension', human(snapshot.dimension || 'Dimension unknown'));
  text('world-badge', snapshot.world ? '3D · local terrain' : '3D · recorded trail');
  text('world-description', data.mode === 'demo' ? 'Illustrated scene · not your running world' : snapshot.world ? `${follow ? 'Latest' : 'Selected'} observation · ${snapshot.world.radius * 2 + 1} × ${snapshot.world.radius * 2 + 1} blocks` : 'Terrain was not recorded in this run');
  if (viewer) {
    $('world-empty').hidden = !!snapshot.world;
    text('world-empty', snapshot.position ? 'This older recording includes positions but no terrain. The trail shows where Jev went. Live capture adds nearby blocks.' : 'No terrain or position was recorded. Select another session or connect the live observer.');
    if (updateScene) viewer.update(snapshot, false, frames.slice(Math.max(0, index - 80), index + 1).map(f => f.snapshot?.position).filter(Boolean));
  }
  text('event-time', frame ? `EVENT ${frame.id} · ${time(frame.at)}` : 'NO OBSERVATIONS');
  text('event-label', frame?.label || 'Waiting for observations');
  text('source-badge', sourceNames[frame?.source] || 'Observation'); $('source-badge').className = `pill ${frame?.source || ''}`;
  const advice = frame?.source === 'fable' ? frame.detail : null;
  const decision = advice ? null : snapshot.decision;
  const currentDecision = frame?.source === 'jev' || frame?.kind === 'decision';
  const provenance = data.mode === 'demo' ? 'Illustration only. These choices and probabilities are synthetic.' :
    advice ? 'Recovery advice from the configured LLM. Code validates and executes selected actions; completion is verified separately.' :
    frame?.source === 'jev' ? 'Recorded typed choices from Jev. Probabilities are shown only where the model response included them.' :
    frame?.source === 'stale' ? 'This decision was discarded because the state changed. It was not executed.' :
    frame?.source === 'rules' ? 'This event came from the executor or a rule. Any earlier Jev choice below is context, not a new decision.' :
    frame?.source === 'survival' ? 'A survival or emergency response. Earlier choices are context only.' : 'An observed event. No new Jev decision is attributed to it.';
  text('provenance', provenance);
  $('decision-meta').replaceChildren();
  if (decision?.at) $('decision-meta').append(el('span', `${currentDecision ? 'Decision' : 'Last decision'} ${time(decision.at)}`));
  if (Number.isFinite(decision?.latencyMs)) $('decision-meta').append(el('span', `${decision.latencyMs} ms`));
  renderChoices(decision);
  if (advice) {
    $('decision-meta').append(el('span', advice.model), el('span', `${advice.latencyMs} ms`));
    $('choices').replaceChildren(el('p', advice.diagnosis));
    for (const step of advice.steps || []) $('choices').append(el('p', `${human(step.kind)}: ${step.description || step.item || ''}`));
  }
  text('state-json', JSON.stringify(advice?.context || decision?.state || { message: 'No decision input was recorded for this observation.' }, null, 2));
  $('routing-details').hidden = !goal.interpretation && !goal.itemResolution;
  text('routing-json', JSON.stringify({ interpretation: goal.interpretation, itemResolution: goal.itemResolution }, null, 2));
  text('event-json', JSON.stringify(frame?.detail || {}, null, 2));
  $('inventory').replaceChildren();
  const inventory = snapshot.inventory;
  const items = Array.isArray(inventory) ? inventory.map(i => [i.name, i.count]) : Object.entries(inventory || {});
  const present = items.filter(([, count]) => count > 0);
  text('inventory-count', inventory ? `${present.length} types` : 'Not recorded');
  for (const [name, count] of present) { const item = el('span', human(name), 'item'); item.append(el('b', String(count))); $('inventory').append(item); }
  if (inventory && !present.length) $('inventory').append(el('span', 'Inventory is empty.', 'muted'));
  text('event-count', `${frames.length} observations${data.limited ? ' · recent window' : ''}`);
  $('scrub').max = String(Math.max(0, frames.length - 1)); $('scrub').value = String(Math.max(0, index)); $('scrub').disabled = !frames.length;
  text('cursor-label', frame ? `${index + 1} / ${frames.length}` : '0 / 0');
  text('mode-label', follow ? 'FOLLOWING LATEST' : 'INSPECTING HISTORY');
  $('latest').className = follow ? 'selected' : '';
  renderTimeline();
}
function renderChoices(decision) {
  $('choices').replaceChildren();
  const tree = branches(decision || {});
  if (!tree.length) { $('choices').append(el('p', 'No candidate tree was recorded for this event.', 'muted')); return; }
  const renderBranch = branch => {
    const section = el('div', undefined, 'decision-branch');
    const heading = el('div', undefined, 'branch-heading'); heading.append(el('span', branch.path.length ? human(branch.path.at(-1)) : 'Priority'));
    heading.append(el('span', branch.candidates.length === 1 ? 'Only feasible option' : branch.judgment ? branch.id : 'Response not recorded'));
    section.append(heading);
    for (const candidate of branch.candidates) {
      const chosen = candidate.key === branch.chosen, card = el('div', undefined, `candidate${chosen ? ' chosen' : ''}`);
      const row = el('div', undefined, 'row'), probability = candidate.probability;
      row.append(el('span', `${chosen ? '↳ ' : ''}${human(candidate.key)}`), el('b', Number.isFinite(probability) ? `${Math.round(probability * 100)}%` : chosen ? 'Selected' : '—'));
      card.append(row, el('p', candidate.description));
      if (Number.isFinite(probability)) { const bar = el('div', undefined, 'probability'), fill = el('b'); fill.style.width = `${Math.max(0, Math.min(100, probability * 100))}%`; bar.append(fill); card.append(bar); }
      section.append(card);
    }
    return section;
  };
  for (const branch of tree.filter(b => b.onPath)) $('choices').append(renderBranch(branch));
  const others = tree.filter(b => !b.onPath);
  if (others.length) { const details = el('details'); details.append(el('summary', `${others.length} other candidate branches`)); for (const branch of others) details.append(renderBranch(branch)); $('choices').append(details); }
}
function renderTimeline() {
  // Heartbeats remain scrubbable; keep the visible activity strip useful.
  const important = frames.filter(f => f.kind !== 'observation' || f.id === selectedId || f === frames.at(-1));
  const visible = important.slice(-70);
  if (!visible.some(f => f.id === selectedId)) { const selected = frames.find(f => f.id === selectedId); if (selected) visible.unshift(selected); }
  const oldScroll = $('events').scrollLeft;
  $('events').replaceChildren();
  for (const frame of visible) {
    const button = el('button', undefined, `event ${frame.source} ${frame.kind}${frame.id === selectedId ? ' current' : ''}`);
    button.setAttribute('aria-pressed', String(frame.id === selectedId));
    button.append(el('time', time(frame.at)), el('b', frame.label), el('small', sourceNames[frame.source] || frame.kind));
    button.addEventListener('click', () => select(frame.id)); $('events').append(button);
  }
  $('events').scrollLeft = follow ? $('events').scrollWidth : oldScroll;
}
function select(id) { follow = false; selectedId = id; render(true); }
function stopPlayback() { clearInterval(playing); playing = null; text('play', '▶ Replay'); }
$('session').addEventListener('change', () => switchSession($('session').value));
$('latest').addEventListener('click', () => { stopPlayback(); follow = true; selectedId = frames.at(-1)?.id; render(); });
$('scrub').addEventListener('input', () => { stopPlayback(); select(frames[Number($('scrub').value)]?.id); });
$('play').addEventListener('click', () => {
  if (playing) return stopPlayback();
  if (!frames.length) return;
  if (selectedId === frames.at(-1)?.id) select(frames[0].id);
  text('play', 'Ⅱ Pause replay');
  playing = setInterval(() => { const index = frames.findIndex(f => f.id === selectedId); if (index >= frames.length - 1) return stopPlayback(); select(frames[index + 1].id); }, 1000);
});
for (const mode of ['orbit', 'behind', 'eyes', 'top']) $(mode).addEventListener('click', () => {
  viewer?.setMode(mode); for (const name of ['orbit','behind','eyes','top']) { $(name).className = mode === name ? 'selected' : ''; $(name).setAttribute('aria-pressed',String(mode === name)); }
  $('viewport').title = mode === 'behind' ? 'Third-person follow camera · scroll to change distance' : mode === 'eyes' ? 'Camera follows Jev’s recorded position and gaze' : mode === 'top' ? 'Scroll to zoom · right-drag to pan' : 'Drag to orbit · scroll to zoom · right-drag to pan';
});
$('recenter').addEventListener('click', () => viewer?.reset());
$('blueprint').addEventListener('change', () => viewer?.setPreview($('blueprint').checked));
$('textures').addEventListener('change', () => viewer?.setTextures($('textures').checked));
$('layer').addEventListener('input', () => { viewer?.setLayer($('layer').value); text('layer-value', $('layer').value === '12' ? 'All' : $('layer').value); });
for (const action of ['stop','resume']) $(action).addEventListener('click', async () => {
  $('resume').disabled = true; if (action === 'stop') $('stop').disabled = true;
  try { await json('/api/control', { method:'POST', headers:{'Content-Type':'application/json','X-Jev-Harness':'1'}, body:JSON.stringify({ action, sessionId, expectedEpoch:data.epoch }) }); toast(action === 'stop' ? 'Jev stopped. Progress saved.' : 'Resume requested.'); }
  catch (err) { toast(err.message); }
  await refresh();
});
$('export').addEventListener('click', () => {
  if (!data) return;
  if (sessionId !== 'import') {
    const anchor = el('a'); anchor.href = `/api/export/${sessionId}`; anchor.download = `jev-trace-${sessionId}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); return;
  }
  const blob = new Blob([JSON.stringify({ format:'jev-harness', version:1, ...data, frames, capabilities:{controls:false,terrain:frames.some(f=>f.snapshot?.world)}, mode:data.mode === 'demo' ? 'demo' : 'recording', connected:null })],{type:'application/json'});
  const url = URL.createObjectURL(blob), anchor = el('a');anchor.href=url;anchor.download=`jev-trace-${sessionId}.json`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('import-button').addEventListener('click', () => $('import').click());
$('import').addEventListener('change', async () => {
  const file = $('import').files[0]; if (!file) return;
  try {
    if (file.size > 40 * 1024 * 1024) throw new Error('Open a trace smaller than 40 MB.');
    const trace = JSON.parse(await file.text());
    if (trace.format !== 'jev-harness' || trace.version !== 1 || !Array.isArray(trace.frames) || trace.frames.length > 600 || trace.frames.some(f=>!Number.isFinite(f.id) || !f.snapshot)) throw new Error('This is not a supported Jev trace.');
    stopPlayback(); fetchRevision++; sessionId='import'; data={...trace,mode:trace.mode === 'demo' ? 'demo' : 'recording',connected:null,capabilities:{controls:false},
      note:trace.mode === 'demo' ? 'Opened illustrated sample. Terrain and choices are synthetic. This view cannot control a bot.' : 'Opened recording. This view cannot control a bot.'};
    frames=trace.frames; follow=true; selectedId=frames.at(-1)?.id;
    await loadSources(); render(); viewer?.reset(); toast('Recording opened locally.');
  } catch(err) { toast(err.message); }
  $('import').value='';
});
await loadSources().catch(err=>toast(err.message));
setInterval(refresh, 2000);
setInterval(()=>loadSources().catch(()=>{}), 15000);
