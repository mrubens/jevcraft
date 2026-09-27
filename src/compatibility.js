'use strict';

// minecraft-data can emit a harvest restriction tag as the mining material.
// This makes diamond-pickaxe obsidian mining take 75 seconds instead of 9.4.
// https://github.com/PrismarineJS/mineflayer/issues/3921
// Keep harvestTools intact; only recover the tool-speed group when every
// permitted harvest tool establishes that this is a pickaxe block.
function fixMiningMaterials(registry) {
  if (!registry.materials['mineable/pickaxe']) return;
  for (const block of registry.blocksArray) {
    if (!/^incorrect_for_.*_tool$/.test(block.material || '')) continue;
    const tools = Object.keys(block.harvestTools || {}).map(id => registry.items[id]?.name);
    if (tools.length && tools.every(name => name?.endsWith('_pickaxe'))) block.material = 'mineable/pickaxe';
  }
}

function fixPlayerDimensions(physics) {
  // Minecraft stores EntityDimensions as floats, then widens them to doubles
  // for collision tests. Using decimal doubles lets us enter a wall by ~1e-8
  // blocks. In 26.1 the resulting corrections repeatedly clear onGround and
  // prevent jumping out. Only replace upstream defaults, preserving overrides.
  if (physics?.playerHalfWidth === 0.3) physics.playerHalfWidth = Math.fround(0.6) / 2;
  if (physics?.playerHeight === 1.8) physics.playerHeight = Math.fround(1.8);
}

// A position set by the server (a teleport, a correction) can leave the
// float-widened body a hundred-millionth of a block inside a wall beside it:
// at exactly x.3 against stone, every move the physics made from there was
// corrected back, twenty times a second, and the bot hung in the water
// where it was until it drowned (trial 87, reproduced on the arena server:
// at x.3 it could not sink, at x.31 it could). Out of any overlap under a
// millionth of a block, after each position the server sets.
function clearHairlineOverlap(bot) {
  const p = bot.entity?.position, hw = bot.physics?.playerHalfWidth, h = bot.physics?.playerHeight;
  if (!p || !hw || !h || typeof bot.blockAt !== 'function') return false;
  const solid = (x, y, z) => bot.blockAt(new (require('vec3').Vec3)(x, y, z))?.boundingBox === 'block';
  const ys = []; for (let y = Math.floor(p.y); y <= Math.floor(p.y + h - 1e-9); y++) ys.push(y);
  let moved = false;
  for (const [axis, other] of [['x', 'z'], ['z', 'x']]) {
    const spanOther = []; for (let o = Math.floor(p[other] - hw); o <= Math.floor(p[other] + hw - 1e-9); o++) spanOther.push(o);
    const at = (a, y, o) => axis === 'x' ? solid(a, y, o) : solid(o, y, a);
    const low = p[axis] - hw, lowEdge = Math.ceil(low);
    if (lowEdge - low > 0 && lowEdge - low < 1e-6 && ys.some(y => spanOther.some(o => at(lowEdge - 1, y, o)))) { p[axis] += lowEdge - low + 1e-7; moved = true; }
    const high = p[axis] + hw, highEdge = Math.floor(high);
    if (high - highEdge > 0 && high - highEdge < 1e-6 && ys.some(y => spanOther.some(o => at(highEdge, y, o)))) { p[axis] -= high - highEdge + 1e-7; moved = true; }
  }
  return moved;
}

// Mineflayer's window sync clicks the window and waits for the server to send
// its contents again, twenty seconds at most, checking nothing. A window
// already closed never answers: trial 31's smelting synced its furnace after
// the window shut and stood, unchecked for ten seconds, while a zombie killed
// it (reproduced on its world). A closed window has nothing to sync; any
// sync is given up after two seconds (it is best effort), and at once when
// a watchdog has stopped the step (stillness.js, survival.js).
function boundSyncWindow(bot) {
  const original = bot._syncWindow;
  if (typeof original !== 'function' || original._bounded) return;
  const bounded = async window => {
    if (window && window !== bot.inventory && window !== bot.currentWindow) return;
    let settled = false, failure = null;
    original(window).then(() => { settled = true; }, err => { settled = true; failure = err; });
    const end = Date.now() + 2000;
    while (!settled && Date.now() < end) {
      if (bot._preempt) throw require('./stillness').preempted(bot._preempt);
      if (bot._threatAbort) { const { NeedsSafety, threats } = require('./danger'); let near = null; try { near = threats(bot, 16)[0]; } catch (_) { /* no entities yet */ } throw new NeedsSafety(near || { entity: { name: 'something unseen' }, distance: 0 }); }
      if (bot._airAbort) { const { NeedsAir } = require('./vitals'); throw new NeedsAir(); }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (failure && !/did not fire within timeout/.test(failure.message)) throw failure;
  };
  bounded._bounded = true;
  bot._syncWindow = bounded;
}

function compatibilityPlugin(bot) {
  boundSyncWindow(bot);
  bot.once?.('spawn', () => boundSyncWindow(bot));
  require('./flight').installFlight(bot);
  require('./block-search').installBlockSearch(bot);
  require('./furnace-properties').installFurnaceProperties(bot);
  // Never a chicken or a pig (protected-animals.js): every swing passes here.
  require('./protected-animals').installGuard(bot);
  fixPlayerDimensions(bot.physics);
  // Modern set_passengers names the VEHICLE and its remaining passengers.
  // Mineflayer only removes our mount when entityId is -1 (never sent here).
  bot._client.on('set_passengers', ({ entityId, passengers }) => {
    // The seat as the server says it, whether or not the vehicle is known yet:
    // on joining, the seat can come before the boat, and mineflayer's own
    // bot.vehicle is then nothing (mid-218-h sat thirteen minutes, note 357).
    if (bot.entity && passengers.includes(bot.entity.id)) bot._seatedIn = entityId;
    else if (bot._seatedIn === entityId) bot._seatedIn = null;
    const observed = bot.entities?.[entityId];
    if (observed) {
      for (const old of observed.passengers || []) if (!passengers.includes(old.id) && old.vehicle === observed) delete old.vehicle;
      observed.passengers = (observed.passengers || []).filter(e => passengers.includes(e.id));
    }
    if (bot.vehicle?.id === entityId && !passengers.includes(bot.entity?.id)) {
      const vehicle = bot.vehicle;
      vehicle.passengers = (vehicle.passengers || []).filter(e => e.id !== bot.entity.id);
      delete bot.entity.vehicle; bot.vehicle = null; bot.emit('dismount', vehicle);
    }
  });
  bot.once?.('spawn', () => fixPlayerDimensions(bot.physics));
  bot.on?.('forcedMove', () => { try { clearHairlineOverlap(bot); } catch (_) { /* no world yet */ } });
  const commandFields = bot.registry?.protocol?.play?.toServer?.types?.packet_client_command?.[1];
  const command = Array.isArray(commandFields) && commandFields.find(f => f.name === 'actionId');
  if (typeof bot._client.write === 'function') {
    // Mineflayer's credits handler writes {action: 0}; its death handler uses
    // numeric actionId. The 26.1 mapper expects the named actionId instead.
    const originalWrite = bot._client.write, names = command?.type?.[0] === 'mapper' ? command.type[1].mappings : null;
    bot._client.write = function (name, packet, ...args) {
      if (name === 'client_command' && names) {
        const value = packet.actionId ?? packet.action;
        if (Object.hasOwn(names, value)) packet = { actionId: names[value] };
      }
      const result = originalWrite.call(this, name, packet, ...args);
      // Mineflayer's look promise checks yaw alone, while the physics loop
      // smooths pitch independently. Keep evidence of the actual queued
      // rotation so projectile release can wait for both axes.
      if (['look', 'position_look'].includes(name) && Number.isFinite(packet.yaw) && Number.isFinite(packet.pitch)) {
        bot.lastSentRotation = { yaw: packet.yaw, pitch: packet.pitch, at: Date.now() };
      }
      return result;
    };
    bot._client.on('respawn', () => { delete bot.lastSentRotation; });
  }
  // lpVec3 is already decoded to blocks/tick. Mineflayer 4.39 still divides
  // these packets by 8000, as though they carried the older integer vector.
  // Select by the actual installed packet schema so old protocols are intact.
  for (const name of ['spawn_entity', 'entity_velocity']) {
    const fields = bot.registry?.protocol?.play?.toClient?.types?.[`packet_${name}`]?.[1];
    if (!Array.isArray(fields) || !fields.some(f => f.name === 'velocity' && f.type === 'lpVec3')) continue;
    bot._client.on(name, packet => {
      const entity = bot.entities?.[packet.entityId];
      if (entity?.velocity && packet.velocity) entity.velocity.set(packet.velocity.x, packet.velocity.y, packet.velocity.z);
    });
  }
  // 26.1's protocol decoder returns named difficulty values; Mineflayer's
  // game plugin still indexes a numeric lookup table and loses that value.
  bot._client.on('difficulty', packet => {
    const names = ['peaceful', 'easy', 'normal', 'hard'];
    const difficulty = typeof packet.difficulty === 'number' ? names[packet.difficulty] : packet.difficulty;
    if (names.includes(difficulty)) bot.game.difficulty = difficulty;
  });
  // Mineflayer 4.39's named-metadata path updates bot.oxygenLevel for EVERY
  // entity, including dolphins with 6000 air ticks (displayed as 400 bubbles).
  // Restore only this player's latest reading after the built-in listener.
  let ownOxygen = 20;
  bot._client.on('entity_metadata', packet => {
    if (packet.entityId === bot.entity?.id) {
      const keys = bot.registry?.entitiesByName?.player?.metadataKeys;
      const index = keys ? keys.indexOf('air_supply') : 1;
      const air = packet.metadata.find(entry => entry.key === index);
      if (air && Number.isFinite(air.value)) ownOxygen = Math.max(0, Math.min(20, Math.round(air.value / 15)));
    }
    bot.oxygenLevel = ownOxygen;
  });
  // A new body has full air, and the server does not say so (it sends the
  // air only when it changes). Drowned once, the clean run came back with
  // a reading of none that never moved, and "came up for air" standing on
  // grass for four minutes (2026-09-24 01:31).
  const refill = () => { ownOxygen = 20; bot.oxygenLevel = 20; };
  bot.on?.('respawn', refill);
  bot.on?.('spawn', refill);
}

function fixPathfinderResults() {
  const AStar = require('mineflayer-pathfinder/lib/astar');
  const patched = Symbol.for('jevbot.independentPathResults');
  if (AStar.prototype[patched]) return;
  const original = AStar.prototype.makeResult;
  AStar.prototype.makeResult = function (...args) {
    const result = original.apply(this, args);
    // The upstream search returns its internal Move objects. Path smoothing
    // then changes their coordinates, and execution shifts their action lists.
    // Continuing a partial search reuses those altered nodes: we observed
    // waypoints sinking farther on successive ticks. Return independent moves.
    result.path = result.path.map(move => Object.assign(Object.create(Object.getPrototypeOf(move)), move, {
      toBreak: move.toBreak.map(p => p.clone ? p.clone() : { ...p }),
      toPlace: move.toPlace.map(p => ({ ...p, ...(p.returnPos ? { returnPos: p.returnPos.clone() } : {}) })),
    }));
    return result;
  };
  AStar.prototype[patched] = true;
}

module.exports = { clearHairlineOverlap, boundSyncWindow, fixMiningMaterials, compatibilityPlugin, fixPathfinderResults, fixPlayerDimensions };
