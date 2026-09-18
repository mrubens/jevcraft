'use strict';

const { goals } = require('mineflayer-pathfinder');
const { choice, noul } = require('./typesafe');
const { actionsNow } = require('./act');
const { terrainView, builtSoFar } = require('./view');

// ---------------------------------------------------------------------------
// The agent loop.
//
//   your message  ->  perceive  ->  Jev picks one primitive  ->  do it  ->  repeat
//
// The message goes to Jev verbatim. There is no classifier deciding "this is a
// gather request" before anything happens, and no per-capability skill: Jev
// sees the request, sees the world, and picks one concrete operation from what
// is possible this instant. Everything larger than one operation — a wall, a
// staircase, fetching and handing something over — is composed by repetition.
// ---------------------------------------------------------------------------

const DEFAULTS = { maxTicks: 200, actionBudgetMs: 15000, idleMs: 150 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cancelled extends Error {
  constructor() { super('cancelled'); this.name = 'Cancelled'; }
}
const isCancel = (err) => err instanceof Cancelled || (err && err.name === 'Cancelled');

/** The raw operations. Each is a thin pass-through to mineflayer. */
function makeApi(bot, task, goal) {
  const check = () => { if (task.cancelled) throw new Cancelled(); };

  const bounded = (p, ms) => {
    let timer;
    const deadline = new Promise((r) => { timer = setTimeout(() => r('timeout'), ms); });
    return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
  };

  return {
    async goTo(pos) {
      check();
      // GoalGetToBlock means "stand somewhere you can touch this block", which
      // is what walking to a target actually means. GoalNear asks to stand
      // within 2 blocks of the block itself — for a tree trunk five blocks up
      // in the air that often has no solution, so pathfinder spins until it
      // times out and the bot appears to freeze.
      const walking = bot.pathfinder.goto(new goals.GoalGetToBlock(pos.x, pos.y, pos.z));
      const watch = (async () => { while (!task.cancelled) await sleep(120); bot.pathfinder.stop(); throw new Cancelled(); })();
      try {
        await Promise.race([walking, watch]);
      } catch (err) {
        if (isCancel(err)) throw err;
        bot.pathfinder.stop();
        // Report the truth so the next tick sees it in actions_taken_so_far
        // rather than believing the walk succeeded.
        const d = Math.round(bot.entity.position.distanceTo(pos));
        return `could not find a path; still ${d} blocks away`;
      }
      return 'arrived';
    },

    async dig(pos) {
      check();
      const block = bot.blockAt(pos);
      if (!block) return 'gone';
      if (bot.entity.position.distanceTo(pos) > 4) {
        await bounded(bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2)), 8000);
      }
      check();
      // Equip whatever mines it fastest — mechanical, not a judgment.
      let best = null, bestTime = block.digTime(null, false, false, false, [], {});
      for (const item of bot.inventory.items()) {
        const t = block.digTime(item.type, false, false, false, [], {});
        if (t < bestTime) { bestTime = t; best = item; }
      }
      if (best && (!bot.heldItem || bot.heldItem.type !== best.type)) await bot.equip(best, 'hand');
      if (!bot.canDigBlock(bot.blockAt(pos))) return 'cannot reach';
      await bot.dig(bot.blockAt(pos));
      return `broke ${block.name}`;
    },

    async place(pos, anchorFace) {
      check();
      const item = bot.inventory.items().find((i) => bot.registry.blocksByName[i.name]);
      if (!item) return 'no blocks to place';
      if (bot.entity.position.distanceTo(pos) > 4) {
        await bounded(bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2)), 8000);
      }
      check();
      if (!bot.heldItem || bot.heldItem.name !== item.name) await bot.equip(item, 'hand');
      const ref = bot.blockAt(pos.plus(anchorFace));
      if (!ref || ref.boundingBox !== 'block') return 'nothing to place against';
      await bot.placeBlock(ref, anchorFace.scaled(-1));
      return `placed ${item.name}`;
    },

    async equip(name) {
      check();
      const item = bot.inventory.items().find((i) => i.name === name);
      if (!item) return 'not carrying that';
      await bot.equip(item, 'hand');
      return `holding ${name}`;
    },

    async drop(name) {
      check();
      const speaker = goal.from && bot.players[goal.from] && bot.players[goal.from].entity;
      if (speaker) {
        const p = speaker.position;
        if (bot.entity.position.distanceTo(p) > 3) {
          await bounded(bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2)), 10000);
        }
        check();
        await bot.lookAt(p.offset(0, 1.2, 0));
      }
      let dropped = 0;
      for (const stack of bot.inventory.items().filter((i) => i.name === name)) {
        await bot.toss(stack.type, null, stack.count);
        dropped += stack.count;
        await sleep(100);
      }
      return `dropped ${dropped} ${name}`;
    },

    async attack(entity) {
      check();
      if (!entity || !entity.isValid) return 'gone';
      if (entity.position.distanceTo(bot.entity.position) > 3) {
        await bounded(bot.pathfinder.goto(new goals.GoalFollow(entity, 2)), 6000);
      }
      check();
      await bot.lookAt(entity.position.offset(0, entity.height * 0.5, 0));
      bot.attack(entity);
      return 'hit it';
    },

    async eat() {
      const FOODS = new Set(['bread','cooked_beef','cooked_porkchop','cooked_chicken','cooked_mutton',
        'cooked_cod','cooked_salmon','baked_potato','carrot','apple','golden_apple','melon_slice',
        'sweet_berries','beef','porkchop','chicken','mutton','pumpkin_pie']);
      const food = bot.inventory.items().find((i) => FOODS.has(i.name));
      if (!food) return 'no food';
      await bot.equip(food, 'hand');
      try { await bot.consume(); return `ate ${food.name}`; } catch { return 'could not eat'; }
    },

    async craftBest() {
      check();
      const tableId = bot.registry.blocksByName.crafting_table.id;
      const tableBlock = bot.findBlock({ matching: tableId, maxDistance: 8 });
      const table = tableBlock ? bot.blockAt(tableBlock.position) : null;
      // Try everything the inventory currently supports; take the first that works.
      for (const item of Object.values(bot.registry.itemsByName)) {
        const recipes = bot.recipesFor(item.id, null, 1, table);
        if (recipes.length === 0) continue;
        try {
          await bot.craft(recipes[0], 1, table || undefined);
          return `crafted ${item.name}`;
        } catch { /* not actually makeable; keep looking */ }
      }
      return 'nothing craftable right now';
    },

    async wait() { await sleep(1200); return 'waited'; },

    report() {
      const p = bot.entity.position;
      const items = bot.inventory.items();
      bot.chat(`At ${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}, health ${Math.round(bot.health)}/20. ` +
        (items.length ? `Carrying: ${items.map((i) => `${i.count} ${i.name}`).join(', ')}.` : 'Carrying nothing.'));
      return Promise.resolve('reported');
    },

    finish() { return Promise.resolve('FINISHED'); },
  };
}

function senseState(bot, goal, history, placed = new Set()) {
  const p = bot.entity.position;
  const speaker = goal.from && bot.players[goal.from] && bot.players[goal.from].entity;
  const here = bot.blockAt(p);
  return {
    request: { text: goal.request, from: goal.from },
    bot: {
      position: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
      health: bot.health, food: bot.food,
      holding: bot.heldItem ? bot.heldItem.name : 'nothing',
      light_level: here && here.light != null ? here.light : null,
      time_of_day: bot.time && bot.time.isDay ? 'day' : 'night',
    },
    speaker: speaker
      ? { name: goal.from, distance: Math.round(speaker.position.distanceTo(p)) }
      : { name: goal.from, visible: false },
    // The bot was killed by a spider it could not see: the action list offered
    // "attack the Spider" while the state never mentioned one existed. Anything
    // the bot may need to react to has to be visible here.
    nearby_creatures: Object.values(bot.entities)
      .filter((e) => e !== bot.entity && e.position &&
        (e.type === 'hostile' || e.kind === 'Hostile mobs' || e.type === 'mob' || e.type === 'animal'))
      .map((e) => ({
        name: e.displayName || e.name,
        hostile: e.type === 'hostile' || e.kind === 'Hostile mobs',
        distance: Math.round(e.position.distanceTo(p) * 10) / 10,
      }))
      .filter((e) => e.distance <= 20)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8),
    inventory: bot.inventory.items().reduce((acc, i) => {
      const found = acc.find((x) => x.item === i.name);
      if (found) found.count += i.count; else acc.push({ item: i.name, count: i.count });
      return acc;
    }, []),
    // The blocks themselves. Without this the bot was placing its fortieth
    // block with no picture of the first thirty-nine, and spent 25 actions
    // filling in holes it had just dug.
    surroundings: terrainView(bot, placed),
    built_so_far: builtSoFar(placed),
    actions_taken_so_far: history.slice(-8),
  };
}

async function pursue(bot, task, client, goal, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const onTick = options.onTick || (() => {});
  const history = [];
  const placed = new Set();   // "x,y,z" of every block this run has laid down
  let usageIn = 0, usageOut = 0;

  for (let tick = 0; tick < opts.maxTicks; tick++) {
    if (task.cancelled) return { ok: false, reason: 'cancelled' };

    const state = senseState(bot, goal, history, placed);
    const available = actionsNow(bot, { speaker: goal.from, request: goal.request });

    const criteria = {};
    for (const [key, a] of Object.entries(available)) criteria[key] = a.description;

    let answers, usage;
    try {
      const res = await client.systemOne({
        state,
        questions: {
          next_action: choice(
            `A player said to the bot: "${goal.request}". Every option below is a single action the bot ` +
            `could take right now. Which one is the best next step toward what they asked for? ` +
            `A request may take many actions; this is choosing only the next one.`,
            criteria,
          ),
          // Asked only on the first tick, batched with the rest so it costs no
          // extra round trip. Without the old classifier there is nothing else
          // stopping the bot from answering every line of chat — including
          // another bot's.
          addressed_to_bot: noul(
            `The bot is called "${bot.username}". Is "${goal.request}", said by ${goal.from}, aimed at the bot — asking it to do something or asking it a question — rather than chatter, or someone talking to somebody else?`,
            {
              true: 'It is aimed at the bot and expects it to act or answer.',
              false: 'It is not aimed at the bot: chatter, or talk between other people.',
            },
          ),
          request_satisfied: noul(
            `Has the bot already done what "${goal.request}" asked for? Judge by \`inventory\`, \`bot\` and \`actions_taken_so_far\`.`,
            {
              true: 'The request has been carried out; nothing further is needed.',
              false: 'There is still more to do before the request is met.',
            },
          ),
        },
      });
      answers = res.answers; usage = res.usage;
    } catch (err) {
      history.push({ action: 'think', result: `failed: ${err.message.slice(0, 50)}` });
      await sleep(800);
      continue;
    }
    usageIn += usage.input_tokens; usageOut += usage.output_tokens;

    if (tick === 0) {
      if (answers.addressed_to_bot.noul < 0.5) {
        return { ok: true, reason: 'not-addressed', ticks: 0, usage: { input: usageIn, output: usageOut } };
      }
      if (options.claim) options.claim();
      if (task.cancelled) return { ok: false, reason: 'cancelled' };
    }

    if (answers.request_satisfied.noul >= 0.85 && tick > 0) {
      bot.chat('Done.');
      return { ok: true, ticks: tick, usage: { input: usageIn, output: usageOut } };
    }

    const key = answers.next_action.choice;
    const action = available[key];
    onTick({ tick, key, answers, optionCount: Object.keys(criteria).length });
    if (!action) { await sleep(500); continue; }

    const api = makeApi(bot, task, goal);
    // Skills from skills.js expect a Task object with .check(); the loop's task
    // is a plain flag. Give them one view of the same cancellation state.
    const skillTask = {
      get cancelled() { return task.cancelled; },
      check() { if (task.cancelled) throw new Cancelled(); },
      describe: () => goal.request,
    };
    let result;
    try {
      result = await action.run(skillTask, api);
    } catch (err) {
      if (isCancel(err)) return { ok: false, reason: 'cancelled' };
      result = `failed: ${err.message.slice(0, 60)}`;
    }

    // Keep the map honest about the bot's own work.
    const coord = /^(place|dig)_(-?\d+)_(-?\d+)_(-?\d+)$/.exec(key);
    if (coord) {
      const spot = `${coord[2]},${coord[3]},${coord[4]}`;
      if (coord[1] === 'place' && String(result).startsWith('placed')) placed.add(spot);
      if (coord[1] === 'dig') placed.delete(spot);
    }

    history.push({ action: key, result: String(result) });
    if (options.onResult) options.onResult({ tick, key, result: String(result) });
    if (history.length > 30) history.shift();
    if (result === 'FINISHED') {
      return { ok: true, ticks: tick, usage: { input: usageIn, output: usageOut } };
    }
    await sleep(opts.idleMs);
  }

  bot.chat("I've done as much as I can with that.");
  return { ok: false, reason: 'max-ticks', usage: { input: usageIn, output: usageOut } };
}

module.exports = { pursue, senseState, makeApi, Cancelled, DEFAULTS };
