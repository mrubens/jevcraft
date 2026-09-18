'use strict';

const { Vec3 } = require('vec3');
const skills = require('./skills');

// ---------------------------------------------------------------------------
// The primitive action space.
//
// There are no skills here — no "gather wood", no "build a shelter". There are
// only the operations the game itself offers: move, dig, place, equip, drop,
// attack, eat, wait. Jev chooses one operation and its arguments each tick, so
// composite behaviour (a wall, a staircase, a mine shaft, handing something
// over) is something it assembles, not something anyone coded.
//
// Code's remaining job is enumeration. A Choice needs a closed option set and
// the world has unbounded coordinates, so each tick we list what is actually
// reachable right now — the blocks in view, the empty spots a block could go,
// what is in the inventory, who is nearby — and Jev picks among those. That is
// generic perception, not task-specific logic.
// ---------------------------------------------------------------------------

const round = (n) => Math.round(n * 10) / 10;

const COMPASS = (dx, dz) => {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west';
  if (dz !== 0) return dz > 0 ? 'south' : 'north';
  return 'here';
};

/** Describe a position the way a player would say it aloud. */
function relative(bot, pos) {
  const me = bot.entity.position.floored();
  const dx = pos.x - me.x, dy = pos.y - me.y, dz = pos.z - me.z;
  const dist = round(Math.hypot(dx, dy, dz));
  const vert = dy > 0 ? `${dy} up` : dy < 0 ? `${-dy} down` : 'level';
  return `${dist} blocks ${COMPASS(dx, dz)}, ${vert} (${pos.x} ${pos.y} ${pos.z})`;
}

// --- candidate enumeration --------------------------------------------------

/** Blocks worth considering as a dig target, nearest first. */
function diggableCandidates(bot, { radius = 6, limit = 6 } = {}) {
  const me = bot.entity.position.floored();
  const out = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx === 0 && dz === 0 && dy === 0) continue;
        const pos = me.offset(dx, dy, dz);
        const block = bot.blockAt(pos);
        if (!block || block.boundingBox !== 'block') continue;
        if (block.name === 'bedrock' || !block.diggable) continue;
        out.push({
          key: `dig_${pos.x}_${pos.y}_${pos.z}`,
          pos,
          name: block.name,
          distance: round(pos.distanceTo(bot.entity.position)),
        });
      }
    }
  }
  // Nearest first, but keep one of each block type so rarer things stay visible.
  out.sort((a, b) => a.distance - b.distance);
  const seen = new Set();
  const picked = [];
  for (const c of out) {
    const firstOfType = !seen.has(c.name);
    seen.add(c.name);
    if (firstOfType || picked.length < limit / 2) picked.push(c);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** Empty spots a block could actually be placed into, next to something solid. */
function placeableCandidates(bot, { radius = 4, limit = 6 } = {}) {
  const me = bot.entity.position.floored();
  const out = [];
  const faces = [
    new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
  ];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -2; dy <= 3; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const pos = me.offset(dx, dy, dz);
        // Never brick the bot into its own body.
        if (dx === 0 && dz === 0 && (dy === 0 || dy === 1)) continue;
        const here = bot.blockAt(pos);
        if (!here || here.boundingBox !== 'empty') continue;
        const anchor = faces.find((f) => {
          const n = bot.blockAt(pos.plus(f));
          return n && n.boundingBox === 'block';
        });
        if (!anchor) continue;
        out.push({
          key: `place_${pos.x}_${pos.y}_${pos.z}`,
          pos,
          anchor,
          distance: round(pos.distanceTo(bot.entity.position)),
        });
      }
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, limit);
}

/** Places worth walking to: people, and anything notable in view. */
function destinationCandidates(bot, { limit = 10 } = {}) {
  const me = bot.entity.position;
  const out = [];

  for (const [name, player] of Object.entries(bot.players)) {
    if (name === bot.username || !player.entity) continue;
    out.push({
      key: `goto_player_${name}`,
      pos: player.entity.position.floored(),
      label: `to ${name}`,
      distance: round(player.entity.position.distanceTo(me)),
    });
  }

  const NOTABLE = [
    'oak_log', 'birch_log', 'diamond_ore', 'deepslate_diamond_ore', 'iron_ore',
    'deepslate_iron_ore', 'coal_ore', 'deepslate_coal_ore', 'gold_ore',
    'crafting_table', 'furnace', 'water', 'pumpkin',
  ];
  for (const name of NOTABLE) {
    const type = bot.registry.blocksByName[name];
    if (!type) continue;
    const found = bot.findBlock({ matching: type.id, maxDistance: 48 });
    if (!found) continue;
    out.push({
      key: `goto_${name}`,
      pos: found.position,
      blockName: name,
      label: `to the nearest ${name}`,
      distance: round(found.position.distanceTo(me)),
    });
  }

  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, limit);
}

function entityCandidates(bot, { radius = 16, limit = 3 } = {}) {
  const me = bot.entity.position;
  return Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position && (e.type === 'mob' || e.type === 'hostile' ||
      e.type === 'animal' || e.kind === 'Hostile mobs' || e.type === 'player'))
    .map((e) => ({
      key: `attack_${e.id}`,
      entity: e,
      name: e.username || e.displayName || e.name,
      distance: round(e.position.distanceTo(me)),
    }))
    .filter((c) => c.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function itemCandidates(bot) {
  const stacks = new Map();
  for (const item of bot.inventory.items()) {
    if (!stacks.has(item.name)) stacks.set(item.name, { name: item.name, count: 0, item });
    stacks.get(item.name).count += item.count;
  }
  return [...stacks.values()];
}

/**
 * Every action available this instant, as a flat set of labelled options.
 * Each carries a `run` closure, so choosing a label is choosing a concrete
 * operation with concrete arguments — no second lookup, no argument parsing.
 */
/**
 * The higher tier: each of these is worth many blocks of work.
 *
 * With only one-block primitives every choice was arbitrary — placing block 40
 * of an imagined house has no more reason behind it than the eleven other open
 * spots, which is why confidence sat at 0.18 and the bot thrashed. A skill
 * carries its own intent, so choosing it is a real decision, and one decision
 * buys dozens of blocks instead of one.
 *
 * Primitives stay available underneath for anything these do not cover.
 */
function skillActions(bot, { speaker, request } = {}) {
  const actions = {};
  const inv = {};
  for (const i of bot.inventory.items()) inv[i.name] = (inv[i.name] || 0) + i.count;
  const blockCount = bot.inventory.items()
    .filter((i) => bot.registry.blocksByName[i.name])
    .reduce((n, i) => n + i.count, 0);

  const sees = (name) => {
    const t = bot.registry.blocksByName[name];
    return t ? Boolean(bot.findBlock({ matching: t.id, maxDistance: 48 })) : false;
  };

  const GATHERABLE = [
    ['wood', 'oak_log', 'logs for planks, tools and building'],
    ['stone', 'stone', 'cobblestone for building and tools'],
    ['dirt', 'dirt', 'dirt, the quickest building material'],
    ['coal', 'coal_ore', 'coal for fuel and torches'],
    ['iron', 'iron_ore', 'iron ore to smelt into ingots'],
  ];
  const { MINEABLE, TOOL_TIERS } = require('./plan');
  const tier = skills.pickaxeTier(bot);
  for (const [label, block, why] of GATHERABLE) {
    const visible = sees(block);
    const info = MINEABLE[block] || { drops: block, tier: 0 };
    const toolOk = tier >= info.tier;
    const status = !toolOk
      ? `NOT POSSIBLE: this needs at least a ${TOOL_TIERS[info.tier - 1]} pickaxe and the bot has ${tier ? `a ${TOOL_TIERS[tier - 1]} pickaxe` : 'no pickaxe'}.`
      : !visible
        ? 'NOT POSSIBLE: none in range right now.'
        : 'Possible: the tool is right and there is some within range.';
    actions[`gather_${label}`] = {
      description:
        `Go and collect about 16 ${block}, which drops ${info.drops} — ${why}. ` +
        `Walks to it and mines repeatedly; one choice, many blocks. ${status}`,
      run: (t) => skills.gatherMaterial(bot, t, { material: block, amount: 16 }),
    };
  }

  // Crafting, one option per recipe the planner knows, each stating exactly
  // what is still missing. A bare-handed bot can now see the whole chain:
  // gather_wood is possible, craft_planks needs logs, craft_wooden_pickaxe
  // needs planks + sticks + a table, gather_stone needs that pickaxe.
  const { RECIPES } = require('./plan');
  const tableNearby = Boolean(bot.findBlock({
    matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 8,
  }));
  for (const [item, recipe] of Object.entries(RECIPES)) {
    const short = [];
    for (const [ing, per] of Object.entries(recipe.from)) {
      if ((inv[ing] || 0) < per) short.push(`${per - (inv[ing] || 0)} more ${ing}`);
    }
    const needsTable = recipe.table && !tableNearby && !(inv.crafting_table > 0);
    const status = short.length
      ? `NOT POSSIBLE YET: still needs ${short.join(' and ')}.`
      : needsTable
        ? 'NOT POSSIBLE YET: needs a crafting table placed nearby or carried.'
        : `Possible now; the bot has the materials${recipe.table ? ' and a table' : ''}.`;
    const ingredients = Object.entries(recipe.from).map(([k, v]) => `${v} ${k}`).join(' + ');
    actions[`craft_${item}`] = {
      description: `Craft ${recipe.yields} ${item} from ${ingredients}${recipe.table ? ' at a crafting table' : ''}. ${status}`,
      run: (t) => skills.craftItem(bot, t, { item, count: recipe.yields }),
    };
  }

  actions.clear_a_space = {
    description:
      'Flatten and clear a 5x5 space where the bot is standing, so there is somewhere level to build. ' +
      'Takes many digs; one choice.',
    run: (t) => skills.clearArea(bot, t, { size: 5 }),
  };

  actions.build_a_shelter = {
    description:
      'Build a complete small house: a 5x5 hut with four walls, a doorway and a roof, where the bot is standing, ' +
      'out of the blocks it is carrying. This is the whole building in one go. ' +
      (blockCount >= 85
        ? `Possible: the bot has ${blockCount} blocks, enough for the whole hut.`
        : `NOT POSSIBLE YET: this needs 85 blocks and the bot has ${blockCount}; ${85 - blockCount} more to gather ` +
          `(about ${Math.ceil((85 - blockCount) / 16)} rounds of gathering). Keep the blocks — do not spend them on lines.`),
    run: (t) => skills.buildShelter(bot, t, { material: Object.keys(inv).find((n) => bot.registry.blocksByName[n]) || 'dirt', size: 5 }),
  };

  actions.dig_a_tunnel = {
    description: 'Dig a walkable two-high tunnel about 12 blocks straight ahead, rather than a pit.',
    run: (t) => skills.digTunnel(bot, t, { length: 12 }),
  };

  actions.dig_down_to_diamond_level = {
    description:
      `Travel down to about y=-55 where diamonds are found, digging a safe way down. ` +
      `The bot is at y=${Math.round(bot.entity.position.y)}.`,
    run: (t) => skills.descendTo(bot, t, { y: -55 }),
  };

  actions.go_to_the_surface = {
    description: `Climb back up to daylight around y=65. The bot is at y=${Math.round(bot.entity.position.y)}.`,
    run: (t) => skills.ascendTo(bot, t, { y: 65 }),
  };

  // Smelting: the step that turns raw iron into the ingots every tool past
  // stone needs. Iron is always listed so the chain stays visible; other
  // smeltables appear only once their input is carried.
  const { SMELTING } = require('./plan');
  const furnaceNearby = Boolean(bot.findBlock({
    matching: bot.registry.blocksByName.furnace.id, maxDistance: 32,
  }));
  const hasFurnace = furnaceNearby || inv.furnace > 0;
  const fuelName = ['coal', 'charcoal', 'oak_planks'].find((f) => inv[f] > 0);
  for (const [item, { from }] of Object.entries(SMELTING)) {
    if (item !== 'iron_ingot' && !(inv[from] > 0)) continue;
    const short = [];
    if (!(inv[from] > 0)) short.push(`some ${from} to smelt`);
    if (!hasFurnace) short.push('a furnace (carried or nearby)');
    if (!fuelName) short.push('fuel (coal, charcoal or planks)');
    actions[`smelt_${item}`] = {
      description:
        `Smelt ${from} into ${item} in a furnace, placing one if the bot is carrying it. ` +
        (short.length ? `NOT POSSIBLE YET: needs ${short.join(', ')}.` : `Possible now: has ${inv[from]} ${from}, a furnace and ${fuelName}.`),
      run: (t) => skills.smeltItems(bot, t, { item, from, count: Math.min(inv[from] || 1, 8), fuel: 2 }),
    };
  }

  // Survival options exist only while they mean something: no food, no eat;
  // no hostile in range, no fight or flight. An option that can never help
  // just splits probability away from ones that can.
  const FOODS = new Set(['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
    'cooked_cod', 'cooked_salmon', 'baked_potato', 'carrot', 'apple', 'golden_apple', 'melon_slice',
    'sweet_berries', 'beef', 'porkchop', 'chicken', 'mutton', 'pumpkin_pie']);
  const food = Object.keys(inv).find((n) => FOODS.has(n));
  if (food && bot.food < 20) {
    actions.eat_something = {
      description: `Eat ${food}. Hunger is ${bot.food} out of 20; below 18 the bot stops regenerating health.`,
      run: (t) => skills.eatSomething(bot, t),
    };
  }

  const me = bot.entity.position;
  const hostiles = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position && (e.type === 'hostile' || e.kind === 'Hostile mobs'))
    .map((e) => ({ name: e.displayName || e.name, distance: Math.round(e.position.distanceTo(me)), entity: e }))
    .filter((h) => h.distance <= 16)
    .sort((a, b) => a.distance - b.distance);
  if (hostiles.length) {
    const h = hostiles[0];
    actions[`fight_${h.name.replace(/\W+/g, '_')}`] = {
      description: `Chase and keep hitting the ${h.name} ${h.distance} blocks away until it is dead. Health is ${Math.round(bot.health)}/20.`,
      run: (t) => skills.attackTarget(bot, t, { target: h.name }),
    };
    actions.run_away = {
      description: `Run about 16 blocks away from the ${h.name}. Safe, gives up ground. Health is ${Math.round(bot.health)}/20.`,
      run: (t) => skills.fleeFrom(bot, t, { entity: h.entity }),
    };
  }

  const here = bot.blockAt(me);
  const light = here && here.light != null ? here.light : 15;
  if (inv.torch > 0 && light < 8) {
    actions.place_a_torch = {
      description: `Place a torch here. Light level is ${light}; hostile mobs appear below 8. ${inv.torch} torches carried.`,
      run: (t) => skills.lightArea(bot, t),
    };
  }

  // Lines of blocks, in the two directions that come up: ahead, and toward the
  // player (a bridge or path). Both need blocks in hand.
  const yaw = bot.entity.yaw;
  const dir = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const lineStart = { x: Math.round(me.x + dir.x * 1), y: Math.floor(me.y), z: Math.round(me.z + dir.z * 1) };
  const ahead = { x: Math.round(me.x + dir.x * 6), y: Math.floor(me.y), z: Math.round(me.z + dir.z * 6) };
  const material = Object.keys(inv).find((n) => bot.registry.blocksByName[n]);
  actions.build_a_line_ahead = {
    // Described as "a wall segment", this looked like house-building and the
    // bot spent every block it had on six-block lines pointing wherever it last
    // walked, never saving up for the hut. Say exactly what it is.
    description:
      'Lay one straight row of 6 blocks on the ground, pointing whichever way the bot happens to be facing right now. ' +
      'It is a path or a fence, not a building, and it uses up blocks a structure would need. ' +
      (blockCount >= 6 ? `Possible: ${blockCount} blocks carried.` : `NOT POSSIBLE YET: needs blocks in hand, has ${blockCount}.`),
    run: (t) => skills.buildLine(bot, t, { from: lineStart, to: ahead, material }),
  };

  actions.explore_new_ground = {
    description: 'Walk about 32 blocks in a random direction to bring new terrain, trees or ore into view. Use when nothing needed is in range.',
    run: (t) => skills.explore(bot, t, {}),
  };

  // Coordinates the player typed, e.g. "go to 120 64 -30" — exact, so code
  // reads them; Jev only decides whether going there is the right move.
  const coords = request && /(-?\d{1,6})\s*[, ]\s*(-?\d{1,3})\s*[, ]\s*(-?\d{1,6})/.exec(request);
  if (coords) {
    const [x, y, z] = [Number(coords[1]), Number(coords[2]), Number(coords[3])];
    actions.go_to_the_coordinates_mentioned = {
      description: `Travel to ${x} ${y} ${z}, the coordinates in the request. The bot is at ${Math.round(me.x)} ${Math.round(me.y)} ${Math.round(me.z)}.`,
      run: (t) => skills.goToCoordinates(bot, t, { x, y, z }),
    };
  }

  if (speaker) {
    const sp = bot.players[speaker] && bot.players[speaker].entity;
    const dist = sp ? Math.round(sp.position.distanceTo(me)) : null;
    actions.come_to_the_player = {
      description: sp
        ? `Walk over to ${speaker} once, ${dist} blocks away, and stop there.`
        : `Walk over to ${speaker} — NOT POSSIBLE: they are not in sight.`,
      run: (t) => skills.comeToSpeaker(bot, t, { target: speaker }),
    };
    if (sp && dist > 8 && blockCount >= 4) {
      actions.build_a_bridge_to_the_player = {
        description: `Lay a line of blocks from here toward ${speaker} (${dist} blocks) — a bridge or path. ${blockCount} blocks carried.`,
        run: (t) => skills.buildLine(bot, t, { from: me.floored(), to: sp.position.floored(), material }),
      };
    }
    actions.follow_the_player = {
      description: `Keep following ${speaker} around as they move, until told otherwise.`,
      run: (t) => skills.followSpeaker(bot, t, { target: speaker }),
    };
    actions.give_everything_to_player = {
      description: `Walk to ${speaker} and hand over everything the bot is carrying.`,
      run: (t) => skills.giveItems(bot, t, { item: 'everything', amount: null, to: speaker }),
    };
  }

  return actions;
}

function actionsNow(bot, { speaker, request } = {}) {
  const actions = {};
  const held = bot.heldItem ? bot.heldItem.name : 'nothing';

  // Higher tier first; primitives below cover whatever these miss.
  Object.assign(actions, skillActions(bot, { speaker, request }));

  // A destination the bot has already reached must say so. Left describing
  // itself as "walk to the nearest oak_log, 4 blocks away" it reads like
  // progress, gets chosen again, does nothing, and the bot stands at the tree
  // repeating it forever.
  const reachable = new Set(diggableCandidates(bot).map((d) => d.name));
  for (const c of destinationCandidates(bot)) {
    const alreadyThere = c.distance <= 4 || (c.blockName && reachable.has(c.blockName));
    actions[c.key] = {
      description: alreadyThere
        ? `Walk ${c.label} — but the bot is already right next to it, so this would achieve nothing.`
        : `Walk ${c.label}, ${round(c.distance)} blocks away.`,
      run: (t, api) => api.goTo(c.pos),
    };
  }

  for (const c of diggableCandidates(bot)) {
    actions[c.key] = {
      description: `Break the ${c.name} ${relative(bot, c.pos)}.`,
      run: (t, api) => api.dig(c.pos),
    };
  }

  const placeable = placeableCandidates(bot);
  const placeableItem = bot.inventory.items().find((i) => bot.registry.blocksByName[i.name]);
  for (const c of placeable) {
    actions[c.key] = {
      description: placeableItem
        ? `Put a block (${held !== 'nothing' && bot.registry.blocksByName[held] ? held : placeableItem.name}) at ${relative(bot, c.pos)}.`
        : `Put a block at ${relative(bot, c.pos)} — but the bot is carrying no blocks.`,
      run: (t, api) => api.place(c.pos, c.anchor),
    };
  }

  for (const c of itemCandidates(bot)) {
    actions[`equip_${c.name}`] = {
      description: `Hold the ${c.name} (${c.count} carried)${held === c.name ? ' — already held' : ''}.`,
      run: (t, api) => api.equip(c.name),
    };
    actions[`drop_${c.name}`] = {
      description: `Drop all ${c.count} ${c.name} on the ground${speaker ? `, for ${speaker} to pick up` : ''}.`,
      run: (t, api) => api.drop(c.name),
    };
  }

  for (const c of entityCandidates(bot)) {
    actions[c.key] = {
      description: `Hit the ${c.name}, ${c.distance} blocks away.`,
      run: (t, api) => api.attack(c.entity),
    };
  }

  actions.wait = {
    description: 'Do nothing for a moment and look again.',
    run: (t, api) => api.wait(),
  };
  actions.report = {
    description:
      'Answer the player out loud: where the bot is, what it is carrying, how it is doing. ' +
      'Choose when they asked a question rather than for an action. Saying it once answers them completely.',
    // Answering IS the completion. Left as an ordinary action, "are you ok?"
    // got eleven identical replies, because nothing about the world changes
    // when the bot speaks and so request_satisfied never rose.
    run: async (t, api) => { await api.report(); return 'FINISHED'; },
  };
  actions.finished = {
    description:
      'The whole request has been carried out and nothing further remains. Stand still and wait. ' +
      'Do not choose this while any part of the request is still outstanding.',
    run: (t, api) => api.finish(),
  };
  return actions;
}

module.exports = {
  actionsNow, skillActions, relative,
  diggableCandidates, placeableCandidates, destinationCandidates,
  entityCandidates, itemCandidates,
};
