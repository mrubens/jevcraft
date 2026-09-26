'use strict';
// One line of chat when the bot starts on something new: a different source,
// a different kind of work, or survival taking over. It is the cheapest window
// there is into what Jev decided, and a player watching from behind should
// never have to guess why the bot turned around. Nothing here repeats a line
// for the same phase, and nothing speaks more often than the gap allows,
// because vanilla kicks a chatty client.
const MIN_GAP_MS = 4000;
// The same creeper interrupting five times is one story, not five: an escape
// from the same kind of mob is announced once within this window, and once
// the chase has been quiet for a while the bot says it thinks it got away.
const ESCAPE_REPEAT_MS = 120000;
const ESCAPE_QUIET_MS = 12000;
const name = value => String(value || '').replace(/^minecraft:/, '').replaceAll('_', ' ');
// "Getting 5 oak log" reads badly. Mass nouns stay as they are; the rest
// take an s, and a torch takes an es.
const MASS = /(^| )(cobblestone|cobbled deepslate|dirt|sand|red sand|gravel|coal|charcoal|raw iron|raw gold|raw copper|string|wool|wheat|bread|flint|leather|obsidian|iron|gold|copper|redstone|lapis lazuli|glowstone dust|gunpowder|netherrack|stone|granite|andesite|diorite|tuff|deepslate|clay|snow|kelp|paper|sugar|glass|ice|blaze powder|bone meal|water|lava|milk|beef|pork|porkchop|mutton|chicken|cod|salmon|rotten flesh|glow ink sac|ink sac)$/;
const article = value => /^[aeiou]/.test(name(value)) ? 'an ' : 'a ';
const plural = (count, value) => {
  const n = name(value);
  if (!(count > 1) || MASS.test(n) || /(s|planks|seeds|boots|leggings)$/.test(n)) return n;
  return /(ch|sh|x)$/.test(n) ? `${n}es` : `${n}s`;
};

// Jev's own voice, first person (the user, 2026-09-25: "more first-person
// from Jev. 'Ahhh I'm on fire!'"), and more than one way to say each thing
// ("a few different templates for each event that it could choose between
// randomly"): a list is picked from at random, never the line just said.
// Tests pin the pick with setRandom.
let random = Math.random;
const setRandom = fn => { random = fn || Math.random; };
function pick(variants, last, ...args) {
  if (!Array.isArray(variants)) return typeof variants === 'function' ? variants(...args) : variants;
  const said = variants.map(v => typeof v === 'function' ? v(...args) : v).filter(Boolean);
  if (!said.length) return null;
  const fresh = said.length > 1 ? said.filter(l => l !== last) : said;
  return fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))];
}
const names = action => [...new Set((action.threats || []).map(t => name(t.name || t)))];
const SURVIVAL = {
  gather_shelter_materials: ["It's getting dark. I'd better grab some blocks to dig in with.", 'Night soon. Grabbing some blocks for a shelter.', "Sun's going down. I need blocks to wall myself in."],
  seal_shelter: ['Walling myself in for the night.', 'Sealing up my little hideout.', 'Closing myself in till morning.'],
  sheltered: ["Safe and snug in here. I'll wait for morning.", "Nothing's getting in here. Waiting out the night.", "Cosy. I'll sit tight till sunrise."],
  sleep: ['Bedtime. Goodnight!', "Time for bed. Night night!", "Yawn. I'm off to sleep."],
  // Only a trip worth the name: "heading home to bed" ten blocks from the
  // bed, then "home before bedtime", read as a bot talking to itself (the
  // user, 2026-09-24).
  go_home_for_night: [(goal, action) => (action.distance ?? 99) > 24 ? "It's getting dark. Time to head home to bed." : null,
    (goal, action) => (action.distance ?? 99) > 24 ? "Getting late. I'm heading home." : null,
    (goal, action) => (action.distance ?? 99) > 24 ? 'Home to bed before the monsters come out.' : null],
  wait_for_bedtime: ['Home before dark. Just waiting for bedtime now.', 'Made it home. Bed soon.', "Home! I'll wait here till it's dark enough to sleep."],
  evening_chore: (goal, action) => `Home before dark, so I'll ${({ stock_stash: 'stock the chest', harvest_and_bake: 'harvest and bake some bread', tend_farm: 'tend the field', breed_cows: 'breed the cows', light_home: 'put some torches up', wall_home: 'put a wall round home' })[action.chore] || 'do a chore'} before bed.`,
  grow_plot: ['Home before dark. I could use a bigger field; one more row tomorrow.', "I'll make the field a row bigger tomorrow."],
  sleep_failed: (goal, action) => `I can't sleep: ${String(action.reason || '').replace(/^The server refused the sleep: /, '').replaceAll('_', ' ').replace(/^block\.minecraft\./, '')}.`,
  stay_up: ["I'm staying up tonight. There's work I can do in the dark.", 'No sleep for me tonight. Too much to do.', "I'll pull an all-nighter."],
  leave_shelter: [(goal, action) => action.reason || 'Morning! Back to it.', (goal, action) => action.reason || "Sun's up. Let's go!", (goal, action) => action.reason || 'Good morning! Where was I?'],
  escape_threat: [
    (goal, action) => names(action).length ? `Yikes, a ${names(action).join(' and a ')}! I'm getting out of here.` : "Something's after me! I'm getting out of here.",
    (goal, action) => names(action).length ? `Nope, not fighting that ${names(action).join(' and that ')}. Running!` : 'Nope. Running!',
    (goal, action) => names(action).length ? `There's a ${names(action).join(' and a ')} after me! Backing off.` : 'Something is after me! Backing off.'],
  hold_defensive_position: ["I'm cornered. I'll hold here and fight.", 'Nowhere to go. I stand my ground here.'],
  dig_in_bunker: (goal, action) => `Too many of them out here (${[...new Set(action.threats || [])].join(', ')}). I'll dig into the rock and take them one at a time.`,
  fight: [(goal, action) => `Come on then, ${names(action).join(' and ')}!`, (goal, action) => `Take that, ${names(action).join(' and ')}!`, (goal, action) => `Fighting the ${names(action).join(' and the ')}!`],
  charge: (goal, action) => `Nowhere to run, so I'm going for the ${name(action.target)}!`,
  // Named when known: "something is shooting" was said of a blaze in plain
  // sight, and read as the bot not seeing it (the user, 2026-09-24).
  // Nothing seen: said as such, not guessed at.
  dig_in: [(goal, action) => names(action).length ? `I'm walling myself off from the ${names(action).join(' and the ')} until it goes away.` : "I'm walling myself in until it's safe.",
    (goal, action) => names(action).length ? `Blocks up! That ${names(action).join(' and that ')} can wait outside.` : 'Blocks up until things calm down.'],
  wall_off: "I'm cornered, so I'm walling the tunnel shut.",
  no_shelter_here: "There's nowhere to shelter and nothing to build with. I'll keep going and keep my eyes open.",
  leave_lava_edge: ['Whoa, lava! Backing away from that first.', 'Too close to the lava. Stepping back.', "Hot hot hot! Away from the lava."],
  douse: ['Still burning! Water on my feet.', 'Hiss! Putting myself out with the bucket.'],
  out_of_fire: ["Ahh, I'm on fire! Getting out of it!", 'Ow ow ow, fire! Running!', "I'm burning! Out, out, out!"],
  return_to_surface: ["I'm heading back up to the surface.", 'Up I go, back to daylight.', 'Climbing back up top.'],
  recover_items: ["I'm going back for the stuff I dropped.", 'My things are still over there. Going to get them.'],
  gather_food: [(goal, action) => `I'm getting hungry. ${action.item ? `Some ${name(action.item)} would do.` : 'Time to find some food.'}`,
    (goal, action) => `My stomach's rumbling. ${action.item ? `Going for some ${name(action.item)}.` : 'Food first.'}`],
  search_food: ["I'm hungry. Looking around for something to eat.", 'Anything to eat around here?', "I'd better find some food."],
  return_for_food: "I've got nothing to eat here. Back through the portal for food.",
  cook_food: ["I'll cook this food first.", 'Cooking up something to eat.', 'Dinner time. Into the furnace it goes.'],
  go_home_for_food: ["I'm heading home for something to eat.", "There's food at home. Going there."],
  village_found: ["Ooh, a village! I'll remember this spot.", "A village! That's worth knowing about.", "Look, a village! Noted."],
  landmark_found: [(goal, action) => action.what ? `Ooh, a ${action.what}! I'll remember that.` : "Ooh, that's worth remembering.",
    (goal, action) => action.what ? `A ${action.what}. Noted!` : "Interesting! I'll remember that.",
    (goal, action) => action.what ? `Look at that, a ${action.what}.` : 'Noted. Might come back to that.'],
  village_food: ["I'm off to the village for something to eat.", 'The village should have food. Heading there.'],
  prepare_hunting_weapon: ["I'll make a weapon so I can hunt.", 'I need something to hunt with first.'],
  reach_shore: ["I'm swimming for the shore.", 'Paddling back to land.', 'Land ho! Swimming for it.'],
  surface: ['I need air! Swimming up.', 'Air! Up, up, up!', 'Running out of breath. Heading up.'],
};

// What the source Jev chose looks like, from the recorded decision tree.
function sourceDescription(decision, key) {
  if (!decision?.options || !key) return null;
  const stack = [decision.options];
  while (stack.length) {
    const children = stack.pop();
    for (const [k, node] of Object.entries(children || {})) {
      if (k === key && node.description && typeof node.description === 'object') return node.description;
      if (node.children) stack.push(node.children);
    }
  }
  return null;
}

const some = (count, value) => count > 1 ? `${count} ${plural(count, value)}` : `some ${plural(2, value)}`;
function stepVariants(goal, step) {
  const detail = step.detail && typeof step.detail === 'object' ? step.detail : null;
  switch (step.action) {
    case 'combined_request': return detail ? stepVariants(goal, detail) : null;
    // Once per resource, not once per tree: which trunk Jev picked is in the
    // decision log, and a line per tree drowned the lines that mattered.
    case 'mine': { const what = some(step.count, step.drops || step.block); return [`I need ${what}.`, `Off to get ${what}.`, `Time to gather ${what}.`]; }
    case 'craft': { const what = step.count > 1 ? `${step.count} ${plural(step.count, step.item)}` : `${article(step.item)}${name(step.item)}`; return [`I'll make ${what}.`, `Crafting ${what}.`, `Let me put together ${what}.`]; }
    case 'smelt': { const what = some(step.count, step.item); return [`Smelting ${what}.`, `Into the furnace: ${what} coming up.`, `Firing up the furnace for ${what}.`]; }
    case 'harden': return "I'm hardening the concrete in water.";
    case 'make_obsidian': return `Water on lava: I'm making ${step.count ? `${step.count} ` : ''}obsidian.`;
    case 'fill_bucket': return step.item === 'lava_bucket' ? ["I'm fetching lava in a bucket.", 'Off to a lava pool with my buckets.'] : ["I'm fetching some water.", 'Filling up my bucket.'];
    case 'cast_portal': return "Lava in, water on top: I'm casting the portal frame.";
    case 'hunt_mob': return [`I'm going after a ${name(step.entity)} for ${name(step.item)}.`, `Hunting a ${name(step.entity)}. I need ${name(step.item)}.`];
    case 'strike_out': return ["Nothing here. I'll try somewhere new.", 'Time to look somewhere else.'];
    case 'stock_food_for_nether': return "I'm stocking up on food before the Nether.";
    case 'return_for_food': return "I'm out of food. Back through the portal to eat.";
    case 'find_fortress': return step.walking ? "I'm in the fortress. Now, where are the blazes?" : step.found ? "A fortress! I'm heading for it." : `I'm looking for a fortress (leg ${step.legs || 1}).`;
    case 'collect': return `I'm picking up the ${name(step.item || step.drops)}.`;
    case 'place': case 'build': case 'build_schematic': {
      const what = goal.kind === 'house' ? ' the house' : goal.design?.source?.name ? ` ${goal.design.source.name}` : '';
      return [`I'm building${what}.`, `Building time${what ? `:${what}` : ''}!`];
    }
    case 'clear': return "I'm clearing the site.";
    case 'prepare_build_site': return "I'm getting the ground ready.";
    case 'find_build_site': return "I'm looking for a level spot to build.";
    case 'return_to_site': return "I'm heading back to the site.";
    case 'deliver': return `I'm bringing you ${step.count ? `${step.count} ` : ''}${name(step.item)}.`;
    case 'prepare_expedition_food': return "I'm stocking up on food before the trip.";
    case 'refuel_furnace': return 'The furnace needs more fuel.';
    case 'return_overworld': return "I'm heading back to the Overworld.";
    case 'return_to_portal': return "I'm walking back to my portal.";
    case 'home_site': return step.origin ? [`This spot by the water at ${step.origin.x}, ${step.origin.z} will be home.`, `I'll make my home by the water at ${step.origin.x}, ${step.origin.z}.`]
      : ["I'm looking for level ground by some water to make a home.", 'Time to find a nice spot for a home.'];
    case 'return_home': return ["I'm heading home.", 'Back home I go.'];
    case 'gather_wool': return ['I need wool for a bed. Where are the sheep?', 'Sheep, where are you? I need wool for a bed.'];
    case 'explore': return step.target ? [`I'm going to see what's over at ${step.target.x}, ${step.target.z}.`, `Wonder what's at ${step.target.x}, ${step.target.z}. Let's find out.`] : "I'm going exploring.";
    case 'village_bed': return step.village?.igloo ? [`There's an igloo at ${step.village.x}, ${step.village.z}, and igloos always have a bed. Going to get it!`, `Igloo at ${step.village.x}, ${step.village.z}. There's a bed in there for me.`]
      : step.village ? `I'm off to the village at ${step.village.x}, ${step.village.z} for a bed.` : "I'm off to the village for a bed.";
    case 'village_harvest': return `I'll take the ripe ${name(step.crop)} from the village farm.`;
    case 'village_hay': return "I'll take a hay bale for bread.";
    case 'place_bed': return ["I'm putting my bed down at home.", 'Setting up my bed.'];
    case 'claim_bed': return "I'll use the bed so I wake up here if anything goes wrong.";
    case 'till': return ["I'm tilling the field.", 'Hoeing the field.'];
    case 'plant': return ["I'm planting wheat.", 'In go the seeds.'];
    case 'harvest': return ["The wheat's ready. Harvest time!", 'Harvesting the wheat.'];
    case 'bake': return [`I'm baking ${step.loaves ? `${step.loaves} loaves of ` : 'some '}bread.`, 'Fresh bread coming up.'];
    case 'build_pen': return ["I'm fencing in a pen for cows.", 'Building a cow pen.'];
    case 'lure_cows': return ['Come on, cows, into the pen!', "Here, cows! This way."];
    case 'breed_cows': return ["I'm breeding the cows.", 'Some wheat for the cows. Baby cows soon!'];
    case 'take_steak': return "I'll take a steak from the pen.";
    case 'cut_cobwebs': return ['Snip snip. Cobwebs into string.', 'Cutting cobwebs for string.'];
    case 'wall_home': return ["I'm putting a wall round home. No more creepers at my bed!", 'Walling home in, with a door.'];
    case 'place_chest': return ["I'm putting a chest by the bed for spare gear.", 'A chest by the bed, for my spares.'];
    case 'stock_stash': return ["I'm stocking the chest with spares.", 'Putting spares in the chest.'];
    case 'restock': return ["I'm grabbing my spare gear from the chest.", 'Restocking from my chest.'];
    case 'stash_valuables': return "I'll leave my valuables in the chest while I'm home.";
    case 'idle': return {
      cook_food: `Quiet for now, so I'll cook the ${name(step.item).replace(/^(cooked|baked) /, '')}.`,
      stone_tools: `Quiet for now, so I'll make a ${name(step.item)}.`,
      stock_wood: "Quiet for now, so I'll stock up on wood.",
      torches: "Quiet for now, so I'll make some torches.",
      long_game: `Nothing needs me right now, so I'll work on the long game: ${name(step.phase)}.`,
      tend_farm: "Quiet for now, so I'll tend the farm.",
      harvest_and_bake: "Quiet for now, so I'll harvest the wheat and bake some bread.",
      breed_cows: "Quiet for now, so I'll breed the cows.",
      lure_cows: "Quiet for now, so I'll bring some cows into the pen.",
      stock_stash: "Quiet for now, so I'll stock the stash chest.",
    }[step.choice] || null;
    case 'game_progression': return `Next on the way to beating the game: ${name(step.phase)}.`;
    default: return null;
  }
}
function stepLine(goal, step, decision, last = null) {
  if (!step?.action) return null;
  const variants = stepVariants(goal, step);
  return variants ? pick(variants, last) : null;
}

// The key that has to change before another line is spoken. A source is part
// of it, so a new tree is a new line, but a continued source is not.
function stepKey(goal, step, decision) {
  if (!step?.action) return null;
  const inner = step.action === 'combined_request' && step.detail && typeof step.detail === 'object' ? step.detail : step;
  const target = inner.item || inner.drops || inner.block || inner.material || inner.entity || inner.choice || inner.phase || '';
  const action = ['place', 'build', 'build_schematic'].includes(inner.action) ? 'build' : inner.action;
  return `${action}:${target}`;
}

function narrate(bot, goal, { now = Date.now() } = {}) {
  if (typeof bot?.chat !== 'function' || !goal) return null;
  const state = goal.narrated ||= {};
  const speak = line => {
    if (!line || (state.at && now - state.at < MIN_GAP_MS)) return false;
    try { bot.chat(line); } catch (_) { return false; }
    state.at = now; state.line = line;
    return true;
  };
  const action = goal.survivalAction;
  const escape = state.escape;
  if (escape && !escape.resolved && now - escape.at >= ESCAPE_QUIET_MS && !(action?.action === 'escape_threat' && action.at !== state.survival)) {
    if (speak('I think I lost it.')) { escape.resolved = true; return 'I think I lost it.'; }
    return null;
  }
  if (action?.at && action.at !== state.survival) {
    const phrase = SURVIVAL[action.action];
    let line = pick(phrase, state.line, goal, action);
    if (action.action === 'escape_threat') {
      const names = [...new Set((action.threats || []).map(t => name(t.name || t)))].sort().join(',');
      const repeat = escape && escape.names === names && now - escape.at < ESCAPE_REPEAT_MS;
      state.escape = { at: now, names, resolved: false, announced: repeat ? escape.announced : false };
      if (repeat) { state.survival = action.at; return null; }
    }
    // Any survival line repeated word for word inside the window is the same
    // news again: five food searches in a row read as a stuck bot.
    // Said another way it is still the same news: the same action about the
    // same mobs or item is kept quiet through the window.
    const news = `${action.action}:${names(action).sort().join(',')}:${action.item || ''}:${action.what || ''}`;
    if (line && state.lastSurvivalLine?.news === news && now - state.lastSurvivalLine.at < ESCAPE_REPEAT_MS) { state.survival = action.at; return null; }
    if (!phrase || !line || speak(line)) { state.survival = action.at; if (line) state.lastSurvivalLine = { news, at: now }; return line || null; }
    return null;
  }
  const decision = goal.decisions?.at(-1);
  const key = stepKey(goal, goal.step, decision);
  if (!key || key === state.step) return null;
  const line = stepLine(goal, goal.step, decision, state.line);
  // A step with nothing to say (a tunnel segment, a climb) must not reset
  // the key, or the resource line fires again after every one of them.
  if (!line) return null;
  if (speak(line)) { state.step = key; return line; }
  return null;
}

module.exports = { narrate, stepLine, stepKey, SURVIVAL, MIN_GAP_MS, setRandom, pick };
