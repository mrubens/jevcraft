'use strict';
// What the server holds, when this client's view of the blocks is wrong.
//
// A player's client and the server keep two copies of the blocks, and the
// server's is the game's. Mineflayer edits its own copy in one place without
// the server's word: when a dig's time is up it writes air into the view and
// sends "finished" (digging.js finishDigging), and the dig resolves on that
// local write. A server that does not break the block (it counted the time
// differently, the start was not the one it was digging) says nothing, and
// the view keeps a hole where the game has a block. The body then falls, or
// walks, into a place the server does not let it be, and the server puts it
// back every tick: "Repeated server movement corrections at the same
// position" (mid-243-bf, 2026-09-28: the server held dirt at (23, 78, -5),
// the view had air, and the body stood 0.07 over the dirt for two minutes,
// a thousand corrections, while every move Jev was offered was read from the wrong
// cell, note 632).
//
// The game has an honest way to ask: a use of a block's face is always
// answered with the block the server holds there and the block across the
// face, placed or not (ServerGamePacketListenerImpl handleUseItemOn). The
// recording of that trial shows it: the pillar that ended the two minutes
// put a block against the dirt's face and the server answered (23, 78, -5)
// dirt, (23, 79, -5) air, and the view was right from then on. This module
// asks on purpose, with an empty or harmless hand, so nothing is placed:
//   - after every dig, the server's word that the block is gone, or a
//     question about the cell when it gave none;
//   - when the server keeps putting the body back, the cells round the body
//     (a walk's recovery, and a move Jev is offered, src/unstuck.js).
const { Vec3 } = require('vec3');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const DOWN = new Vec3(0, -1, 0), UP = new Vec3(0, 1, 0);
// The faces in the order a reference block is looked for: the block under
// the cell first (a floor is the cell a body rests on), then the sides.
const AROUND = [DOWN, new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0), UP];
const directionOf = v => (v.y < 0 ? 0 : v.y > 0 ? 1 : v.z < 0 ? 2 : v.z > 0 ? 3 : v.x < 0 ? 4 : 5);
// Blocks a use would do something to: never the block asked through.
const USABLE = /door|gate|chest|barrel|furnace|smoker|blast_furnace|crafting_table|_bed$|button|lever|anvil|shulker|lectern|loom|sign|bell|hopper|dispenser|dropper|jukebox|cake|composter|cauldron|respawn_anchor|beacon|enchanting_table|smithing_table|grindstone|stonecutter|cartography_table|fletching_table|repeater|comparator|command_block|structure_block|brewing_stand|note_block|daylight_detector|decorated_pot|vault|crafter|candle|pot$|head$|skull$|end_portal_frame|bookshelf|target|lightning_rod|spawner|trial_spawner|redstone/;

const hhmmss = at => new Date(at).toISOString().slice(11, 19);
const cellOf = p => ({ x: p.x, y: p.y, z: p.z });
const says = b => (b?.name || 'nothing').replaceAll('_', ' ');

// The server's own block messages, as they arrive (mineflayer's blocks
// plugin applies them to the view; a local write does not pass here).
function watchServer(bot) {
  if (bot._serverWatch) return bot._serverWatch;
  const watchers = new Set();
  const said = (x, y, z, state) => { for (const w of [...watchers]) w(x, y, z, state); };
  const client = bot._client;
  client?.on?.('block_change', packet => { const l = packet?.location; if (l) said(l.x, l.y, l.z, packet.type); });
  client?.on?.('multi_block_change', packet => {
    for (const record of packet?.records || []) {
      let x, y, z, state;
      if (typeof record === 'object') {
        x = (packet.chunkX ?? 0) * 16 + ((record.horizontalPos >> 4) & 0x0f); z = (packet.chunkZ ?? 0) * 16 + (record.horizontalPos & 0x0f); y = record.y; state = record.blockId;
      } else {
        const c = packet.chunkCoordinates || { x: packet.chunkX ?? 0, y: 0, z: packet.chunkZ ?? 0 };
        x = c.x * 16 + ((record >> 8) & 0x0f); z = c.z * 16 + ((record >> 4) & 0x0f); y = c.y * 16 + (record & 0x0f); state = record >> 12;
      }
      said(x, y, z, state);
    }
  });
  return (bot._serverWatch = { watchers });
}

// Listen for the server's word about one cell. `until(ms, differs)` is true
// when it spoke (with a state other than `was`, when differs), false when
// the time ran out.
function hear(bot, cell, was) {
  const watch = watchServer(bot);
  const states = [];
  const listener = (x, y, z, state) => { if (x === cell.x && y === cell.y && z === cell.z) states.push(state); };
  watch.watchers.add(listener);
  const heard = differs => (differs ? states.some(s => s !== was) : states.length > 0);
  return {
    heard,
    async until(ms, differs = false) {
      const end = Date.now() + ms;
      while (!heard(differs) && Date.now() < end) await sleep(20);
      return heard(differs);
    },
    stop() { watch.watchers.delete(listener); },
  };
}

// What to hold to ask: the off hand when it is empty or a shield, else the
// main hand when it is empty or a pickaxe or a sword. Never a block, a
// flint and steel, a bucket or a tool that changes ground: a use of one of
// those on a face does something.
function probeHand(bot) {
  const off = bot.inventory?.slots?.[45];
  if (!off || off.name === 'shield') return { hand: 1, holding: off?.name ?? 'nothing' };
  const held = bot.heldItem;
  if (!held || /_(pickaxe|sword)$/.test(held.name)) return { hand: 0, holding: held?.name ?? 'nothing' };
  return null;
}

// A block to ask through: solid in the view, nothing a use would work, and
// in reach of the body (the server takes a use within about five blocks).
function referenceFor(bot, cell) {
  const eye = bot.entity?.position?.offset?.(0, 1.62, 0);
  for (const d of AROUND) {
    const at = cell.plus(d), block = bot.blockAt?.(at);
    if (!block || block.boundingBox !== 'block' || USABLE.test(block.name || '')) continue;
    if (eye && eye.distanceTo(at.offset(0.5, 0.5, 0.5)) > 5) continue;
    return { block, face: d.scaled(-1) };
  }
  return null;
}

// Ask the server what is in each cell: a use of a neighbour's face towards
// it, answered with what the server holds there. Nothing is placed or broken
// (an empty or harmless hand). The view is made to match by the client's own
// handling of the answer; what differed is returned.
async function askServer(bot, cells, { task, waitMs = 400 } = {}) {
  const result = { asked: 0, answered: 0, corrected: [], skipped: [], holding: null };
  const hand = probeHand(bot);
  if (!hand) { result.skipped.push('nothing safe in the hands to ask with (a block, a bucket or a tool that changes ground would do something to the face)'); return result; }
  if (typeof bot._client?.write !== 'function') { result.skipped.push('no connection to ask through'); return result; }
  result.holding = hand.holding;
  const jobs = [];
  for (const c of cells) {
    const cell = new Vec3(c.x, c.y, c.z), ref = referenceFor(bot, cell);
    if (!ref) { result.skipped.push(`(${cell.x}, ${cell.y}, ${cell.z}): no block beside it to ask through`); continue; }
    const before = bot.blockAt(cell);
    jobs.push({ cell, ref, before, listen: hear(bot, cell, before?.stateId ?? before?.type) });
  }
  try {
    for (const { ref } of jobs) {
      const f = ref.face;
      bot._client.write('block_place', { location: ref.block.position, direction: directionOf(f), hand: hand.hand,
        cursorX: 0.5 + f.x * 0.5, cursorY: 0.5 + f.y * 0.5, cursorZ: 0.5 + f.z * 0.5, insideBlock: false, sequence: 0, worldBorderHit: false });
      result.asked++;
    }
    const end = Date.now() + waitMs;
    while (Date.now() < end && !jobs.every(j => j.listen.heard())) { task?.check?.(); await sleep(20); }
  } finally { for (const j of jobs) j.listen.stop(); }
  for (const j of jobs) {
    if (j.listen.heard()) result.answered++;
    const now = bot.blockAt(j.cell);
    if ((j.before?.stateId ?? j.before?.type) !== (now?.stateId ?? now?.type)) result.corrected.push({ ...cellOf(j.cell), was: j.before?.name ?? 'nothing', now: now?.name ?? 'nothing' });
  }
  return result;
}

// The cells the body's box could next touch that the view says are open:
// a step in any direction from where the server holds it. Nearest first.
function suspectCells(bot, { limit = 36 } = {}) {
  const p = bot.entity?.position;
  if (!p || typeof bot.blockAt !== 'function') return [];
  const out = [];
  for (let x = Math.floor(p.x - 0.6); x <= Math.floor(p.x + 0.6); x++) for (let z = Math.floor(p.z - 0.6); z <= Math.floor(p.z + 0.6); z++) for (let y = Math.floor(p.y - 0.6); y <= Math.floor(p.y + 2.4); y++) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (block && block.boundingBox !== 'block') out.push({ x, y, z, d: Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + 0.9), z + 0.5 - p.z) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, limit).map(({ x, y, z }) => ({ x, y, z }));
}

// The server keeps putting the body back: ask about the cells round it, and
// keep what was found for the facts (correctionSays).
async function resyncAround(bot, task, { loop } = {}) {
  // One asking at a time: a walk that finds the loop and the watcher below
  // that finds it too share the answer.
  if (bot._resyncing) return bot._resyncing;
  const asking = (async () => {
    const at = bot.entity?.position;
    const result = await askServer(bot, suspectCells(bot), { task });
    const record = { at: Date.now(), position: at ? cellOf(at) : null, count: loop?.count ?? null, seconds: loop?.seconds ?? null,
      asked: result.asked, answered: result.answered, corrected: result.corrected, skipped: result.skipped.length };
    // Kept with the loop it was asked about, for the facts (correctionSays).
    const noted = latestLoop(bot, at);
    if (noted) noted.checked = record;
    bot.emit?.('view_resync', { ...record, holding: result.holding });
    return result;
  })();
  bot._resyncing = asking;
  try { return await asking; } finally { if (bot._resyncing === asking) bot._resyncing = null; }
}

// The last loop of corrections within five minutes and three blocks of `p`.
function latestLoop(bot, p, within = 300000) {
  return (bot._correctionLoops || []).filter(l => l.position && p && Date.now() - l.at < within && Math.hypot(l.position.x - p.x, l.position.y - p.y, l.position.z - p.z) < 3).at(-1) || null;
}

// A loop of corrections, noted where it was found (skills.js navigate).
function noteLoop(bot, { position, count, seconds }) {
  const loops = bot._correctionLoops ||= [];
  // The same place within ten seconds is the same loop.
  const same = loops.at(-1) && Date.now() - loops.at(-1).at < 10000 && Math.hypot(loops.at(-1).position.x - position.x, loops.at(-1).position.y - position.y, loops.at(-1).position.z - position.z) < 1;
  if (same) { Object.assign(loops.at(-1), { at: Date.now(), count: Math.max(count || 0, loops.at(-1).count || 0), seconds: Math.max(seconds || 0, loops.at(-1).seconds || 0) }); return; }
  loops.push({ at: Date.now(), position: cellOf(position), count, seconds, checked: null });
  if (loops.length > 6) loops.shift();
}

// What the server did and what was found, for the unstuck question and the
// step's failure: null unless the server put the body back within five
// minutes, near where it stands.
function correctionSays(bot, { within = 300000 } = {}) {
  const p = bot.entity?.position;
  const loop = latestLoop(bot, p, within);
  if (!loop) return null;
  // Counted from every position the server has set since a minute before the
  // loop was noted, at that place.
  const ring = (bot._forcedMoves || []).filter(r => r.at >= loop.at - 60000 && Math.hypot(r.x - loop.position.x, r.y - loop.position.y, r.z - loop.position.z) < 0.6);
  const times = Math.max(loop.count || 0, ring.length), seconds = ring.length > 1 ? (ring.at(-1).at - ring[0].at) / 1000 : loop.seconds || 0;
  const parts = [`The server put the body back where it was ${times} times in ${Math.max(1, Math.round(seconds))} second${Math.round(seconds) > 1 ? 's' : ''} at (${Math.floor(loop.position.x)}, ${Math.floor(loop.position.y)}, ${Math.floor(loop.position.z)}), at ${hhmmss(loop.at)}Z: it does that when a move would put the body into a block the server has and this client's view does not.`];
  const rests = p.y - Math.floor(p.y + 1e-3);
  const under = bot.blockAt?.(new Vec3(Math.floor(p.x), Math.floor(p.y + 1e-3) - 1, Math.floor(p.z)));
  if (rests < 0.25 && under && under.boundingBox !== 'block') parts.push(`The body is held ${rests.toFixed(2)} over the top of (${under.position.x}, ${under.position.y}, ${under.position.z}), which the view says is ${says(under)}: the server is treating that cell as solid.`);
  const c = loop.checked;
  if (c) {
    if (!c.asked) parts.push('The server was not asked what the blocks round the body are (nothing safe to ask with, or no block beside them to ask through).');
    else if (!c.corrected.length) parts.push(`The server was asked about ${c.asked} blocks round the body at ${hhmmss(c.at)}Z and its answers matched the view.`);
    else parts.push(`The server was asked about ${c.asked} blocks round the body at ${hhmmss(c.at)}Z and its answer differed from the view at ${c.corrected.map(x => `(${x.x}, ${x.y}, ${x.z}): the view had ${x.was.replaceAll('_', ' ')}, the server has ${x.now.replaceAll('_', ' ')}`).join('; ')}, now in the view.`);
  }
  return { times, withinSeconds: Math.round(seconds), at: { x: Math.floor(loop.position.x), y: Math.floor(loop.position.y), z: Math.floor(loop.position.z) },
    secondsAgo: Math.round((Date.now() - loop.at) / 1000), askedAbout: c?.asked ?? 0, viewDiffered: c?.corrected ?? [], says: parts.join(' ') };
}

// Wait this long for the server to say the block is gone.
const CONFIRM_MS = 1000;

// bot.dig that resolves only once the server has broken the block. Mineflayer
// resolves on its own write of air; here the server's word is waited for, and
// without it the server is asked what the cell holds. Still a block there for
// the server: the dig is tried once more, and then refused with the truth
// in the view.
function confirmDigs(bot, { confirmMs = CONFIRM_MS } = {}) {
  const dig = bot.dig;
  if (typeof dig !== 'function' || dig._confirmed || !bot._client?.on) return;
  const confirmed = async function (block, ...rest) {
    const cell = block?.position;
    if (!cell) return dig.call(this ?? bot, block, ...rest);
    // Air has nothing for the server to break, so no word will come and none
    // is owed: the path planner and the tunnel steps hand over a cell they
    // planned to dig that is already open, and the wait plus the question
    // ended each in DigNotConfirmed, 383 times in five hours on 2026-09-28
    // (all "air", a second each, from the frame 20:36Z on) with no block ever
    // in question. What the server holds under an air view is asked about
    // when the body is put back (resyncAround), not here.
    if (/^(?:cave_|void_)?air$/.test(String(block.name))) return dig.call(this ?? bot, block, ...rest);
    let target = block;
    for (let attempt = 0; ; attempt++) {
      const was = target.stateId ?? target.type, name = target.name;
      const listen = hear(bot, cell, was);
      let word;
      try { await dig.call(this ?? bot, target, ...rest); word = await listen.until(confirmMs, true); } finally { listen.stop(); }
      if (word) return;
      // No word. What does the server hold there?
      const reply = await askServer(bot, [cellOf(cell)]);
      const now = bot.blockAt(cell);
      const gone = now && (now.stateId ?? now.type) !== was;
      if (reply.answered && gone) return;
      // The view has the hole and the server never said so: not answered
      // (nothing to ask through), or answered with the block still there.
      if (!reply.answered && bot._updateBlockState) bot._updateBlockState(cell, was);
      const fresh = bot.blockAt(cell);
      if (attempt === 0 && fresh && (fresh.stateId ?? fresh.type) === was && fresh.boundingBox === 'block') { target = fresh; continue; }
      const err = Object.assign(new Error(`The server did not break the ${String(name || 'block').replaceAll('_', ' ')} at (${cell.x}, ${cell.y}, ${cell.z}): it still has it there, and the view has it again`), { name: 'DigNotConfirmed' });
      try { bot.emit?.('dig_unconfirmed', { block: name, at: cellOf(cell), asked: reply.asked, answered: reply.answered }); } catch (_) { /* the log has it */ }
      throw err;
    }
  };
  confirmed._confirmed = true;
  bot.dig = confirmed;
}

function serverTruthPlugin(bot) {
  if (!bot._client) return;
  watchServer(bot);
  confirmDigs(bot);
  // Every position the server sets, for how often it put the body back.
  const ring = bot._forcedMoves = [];
  const asks = [];
  bot.on?.('forcedMove', () => {
    const p = bot.entity?.position; if (!p) return;
    const now = Date.now();
    ring.push({ at: now, x: p.x, y: p.y, z: p.z });
    while (ring.length > 600 || (ring.length && now - ring[0].at > 600000)) ring.shift();
    // The server putting the body back where it was, five times in two
    // seconds: whatever the bot is doing, the view of the blocks round it is
    // asked about (at most three times a minute), so that the walk, the dig
    // or the climb that met it goes on with the server's blocks. What is
    // done about a place the view cannot be mended is Jev's (src/unstuck.js).
    const here = ring.filter(r => now - r.at < 2000 && Math.hypot(r.x - p.x, r.y - p.y, r.z - p.z) < 0.25);
    if (here.length < 5 || bot._resyncing) return;
    while (asks.length && now - asks[0] > 60000) asks.shift();
    if (asks.length >= 3) return;
    asks.push(now);
    noteLoop(bot, { position: p, count: here.length, seconds: (now - here[0].at) / 1000 });
    resyncAround(bot, null, { loop: { count: here.length, seconds: (now - here[0].at) / 1000 } }).catch(() => { /* asked again at the next loop */ });
  });
  bot.serverTruth = { askServer: (cells, options) => askServer(bot, cells, options), resyncAround: (task, options) => resyncAround(bot, task, options),
    noteLoop: details => noteLoop(bot, details), says: options => correctionSays(bot, options), suspectCells: options => suspectCells(bot, options) };
}

module.exports = { serverTruthPlugin, askServer, resyncAround, suspectCells, correctionSays, noteLoop, confirmDigs, probeHand, referenceFor, hear, CONFIRM_MS };
