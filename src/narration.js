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
// A count reported where the names go is no names (note 1032): the cap
// overhead reported its mobs as a number, the map threw, and the error ended
// the goal in hand four times on 2026-10-03 (25592 01:08Z, 25591 06:52Z,
// 25598 08:35Z and 09:31Z).
const threatsOf = action => Array.isArray(action?.threats) ? action.threats : [];
const names = action => [...new Set(threatsOf(action).map(t => name(t.name || t)))];
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
  sleep_failed: (goal, action) => `I can't sleep: ${/\bbed\.[a-z_]+/.test(String(action.reason || '')) ? require('./survival').sleepRefusalSays(String(action.reason)) : String(action.reason || '').replace(/^The server refused the sleep: /, '').replace(/ \(\d+ by the bot's clock; sleep from about \d+\)$/, '')}.`,
  // With the shelter that just failed, when one did (note 755b: 25581 went
  // from "Closing myself in till morning" to this with nothing said of it).
  stay_up: ["I'm staying up tonight. There's work I can do in the dark.", 'No sleep for me tonight. Too much to do.', "I'll pull an all-nighter."]
    .map(line => (goal, action) => action?.shelterFailed ? `My shelter didn't work (${String(action.shelterFailed).replace(/\.$/, '')}), so I'm staying up tonight.` : line),
  leave_shelter: [(goal, action) => action.reason || 'Morning! Back to it.', (goal, action) => action.reason || "Sun's up. Let's go!", (goal, action) => action.reason || 'Good morning! Where was I?'],
  escape_threat: [
    (goal, action) => names(action).length ? `Yikes, a ${names(action).join(' and a ')}! I'm getting out of here.` : "Something's after me! I'm getting out of here.",
    (goal, action) => names(action).length ? `Nope, not fighting that ${names(action).join(' and that ')}. Running!` : 'Nope. Running!',
    (goal, action) => names(action).length ? `There's a ${names(action).join(' and a ')} after me! Backing off.` : 'Something is after me! Backing off.'],
  hold_defensive_position: ["I'm cornered. I'll hold here and fight.", 'Nowhere to go. I stand my ground here.'],
  dig_in_bunker: (goal, action) => `Too many of them out here (${[...new Set(threatsOf(action))].join(', ')}). I'll dig into the rock and take them one at a time.`,
  fight: [(goal, action) => `Come on then, ${names(action).join(' and ')}!`, (goal, action) => `Take that, ${names(action).join(' and ')}!`, (goal, action) => `Fighting the ${names(action).join(' and the ')}!`],
  // Not "nowhere to run": said with the retreat on offer beside it (25590,
  // note 752g).
  charge: (goal, action) => `Going for the ${name(action.target)}!`,
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

// Off the Overworld no sun rises and no night falls: a pocket left in the
// Nether said "Sun's up. Let's go!" (the live critic, note 677). The lines
// said there, where the Overworld's speak of the day; and the actions only
// the Overworld has (a bed, the dusk, the surface), never said elsewhere.
const SURVIVAL_ELSEWHERE = {
  seal_shelter: ['Walling myself in.', 'Sealing up my little hideout.', 'Closing myself in for now.'],
  sheltered: ["Safe in here for now.", "Nothing's getting in here.", 'Walled in. Time to think.'],
  leave_shelter: [(goal, action) => action.reason || 'Out I go. Back to it.', (goal, action) => action.reason || "Right, let's go!", (goal, action) => action.reason || 'Opening up. Where was I?'],
  return_to_surface: ["I'm climbing back up.", 'Up I go.'],
};
// Morning only where it is morning: a pocket left at night on the Overworld
// said "Good morning!" too.
const SURVIVAL_BY_NIGHT = {
  // Not "back to daylight" at night (note 755b: 25590 said it climbing out
  // at 18:43Z).
  return_to_surface: ["I'm heading back up to the surface. It's night up there.", 'Climbing back up top, into the dark.', 'On my way up to the surface. Night out there, so eyes open.'],
  leave_shelter: [(goal, action) => action.reason || 'Out I go. Back to it.', (goal, action) => action.reason || "Right, let's go!", (goal, action) => action.reason || 'Opening up. Where was I?'],
};
const OVERWORLD_ONLY = new Set(['gather_shelter_materials', 'sleep', 'go_home_for_night', 'wait_for_bedtime', 'evening_chore', 'grow_plot', 'sleep_failed', 'stay_up']);
const isMorning = bot => { const t = bot?.time?.timeOfDay; return !Number.isFinite(t) || t >= 23000 || t < 9500; };
// Food looked for while not hungry is a stock-up, and said as one: 25595
// chatted "I'm hungry" at hunger 20 with 75 food points carried (note 702).
const STOCKING = {
  gather_food: (goal, action) => action.item ? `Stocking up: some ${name(action.item)} for the pack.` : 'Stocking up on food.',
  search_food: ['Stocking up on food. Looking for animals.', 'Topping up my food supplies.'],
  go_home_for_food: ['Heading home to stock up on food.', "There's food at home. Stocking up."],
};
// Hunger at 18 or more, or what is carried fills the bar: not hungry.
function fed(bot) {
  const hunger = bot?.food;
  if (!Number.isFinite(hunger)) return false;
  if (hunger >= 18) return true;
  try { return require('./foraging').foodSupply(bot) >= 20 - hunger; } catch (_) { return false; }
}
function survivalLines(action, { dimension = 'overworld', morning = true, fed: full = false } = {}) {
  if (full && STOCKING[action]) return STOCKING[action];
  const off = !/overworld/.test(String(dimension || 'overworld'));
  if (off) return OVERWORLD_ONLY.has(action) ? null : SURVIVAL_ELSEWHERE[action] || SURVIVAL[action];
  return !morning && SURVIVAL_BY_NIGHT[action] ? SURVIVAL_BY_NIGHT[action] : SURVIVAL[action];
}
// Every line an action can say where it is said, for the prompt audit
// (scripts/audit-prompts.js): null where the action is the Overworld's only.
function linesFor(action, where = {}) {
  const phrase = survivalLines(action, where);
  if (phrase == null) return null;
  const variants = Array.isArray(phrase) ? phrase : [phrase];
  const sample = { threats: ['zombified_piglin'], reason: null, item: 'porkchop', what: 'fortress', distance: 40, chore: 'stock_stash', target: 'blaze' };
  return variants.map(v => typeof v === 'function' ? v({}, sample) : v).filter(Boolean);
}

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

// Jev chose to go on in the Nether without food (keep_on) and the bot is
// under hunger 18 with nothing to eat: the hunt then searches, it does not
// go after blazes (note 708).
function keptOnHungry(goal, bot) {
  try {
    if (!require('./progress').isSetAside(goal, 'nether_return', 'food')) return false;
    return (bot.food ?? 20) < 18 && !(require('./foraging').foodSupply(bot) > 0);
  } catch (_) { return false; }
}
const fortressLeft = goal => (goal?.fortressSearch?.shunned || []).some(sh => sh.until > Date.now() && /Jev chose|came to nothing/.test(sh.why || ''));
// A fortress already announced is not announced again as a new find: note
// 725 fixed this for the landmark notice (exploration.js) but not for this
// ambient line, so 25588 (mid-242-we-fortress-1) still said "A fortress!
// I'm heading for it." three times in a minute about the one fortress it
// was standing in and leaving and re-finding (note 739). Read only, by the
// anchor's own firstAt (set once, kept while the fortress is); narrate()
// records it once said.
//
// By its place too (note 750): the anchor's firstAt is made anew whenever the
// search re-anchors the fortress, and a step with no `fortress` field (the
// spawner wait's fallback) carries none, so 25590 (mid-242-yc) said "A
// fortress! I'm heading for it." at 11:13:42Z standing level with the floor
// of the fortress it had been at for 54 minutes (announced under firstAt
// ...68572, the anchor by then ...80826), and the trials of 2026-09-29 23Z to
// 09-30 11:30Z said it 158 times at a fortress already known. A place within
// the same Nether region (one fortress to a region, nether-regions.js) or
// within FORTRESS_SAME of one announced is that fortress.
const FORTRESS_SAME = 128;
const fortressPlace = step => { const p = step?.fortress || step?.found; return p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : null; };
const sameFortressPlace = (a, b) => {
  if (Math.hypot(a.x - b.x, a.z - b.z) <= FORTRESS_SAME) return true;
  try { const { regionOf } = require('./nether-regions'), ra = regionOf(a.x, a.z), rb = regionOf(b.x, b.z); return ra.rx === rb.rx && ra.rz === rb.rz; } catch (_) { return false; }
};
const fortressAlreadyAnnounced = (goal, step) => {
  const at = step?.fortress?.firstAt;
  if (at != null && goal?.narrated?.fortressFirstAt === at) return true;
  const p = fortressPlace(step);
  return !!p && (goal?.narrated?.fortressesSaid || []).some(s => sameFortressPlace(s, p));
};
// The fortress the search knows, where the step is not a find: going back to
// it (its point the leg's target), or searching past it. -> the line, null
// (none known: the search's own line), or false (nothing to say).
const knownFortressSays = (goal, step) => {
  const s = goal?.fortressSearch, f = s?.fortressAt;
  if (s && (s.inFortressSince || step?.goingTo || s.goTo || s.spawnerWait)) return false;
  if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.z)) return null;
  // On its floors, or on a walk to a place of it (where blazes were seen, a
  // spawner, a floor unwalked): no search at all, said by the walk's own
  // chat. 25581 (mid-243-jd, 12:57:55Z) said "Searching past the fortress I
  // know at -65, 520" standing on that fortress's floor 80 blocks from its
  // anchor, on its way to blazes seen in it (note 750b).
  if (s.inFortressSince || step?.goingTo || s.goTo || s.spawnerWait) return false;
  const t = step?.target;
  if (s.rememberedTarget && t && Math.hypot(t.x - f.x, t.z - f.z) <= 16) return `Going back to the fortress at ${Math.round(f.x)}, ${Math.round(f.z)}.`;
  return `Searching past the fortress I know at ${Math.round(f.x)}, ${Math.round(f.z)} (leg ${step.legs || 1}${legHeading(goal)}).`;
};
// Which way the leg goes, so a person watching sees the search turn (note 689).
const legHeading = goal => { const h = goal?.fortressSearch?.lastHeading; return Number.isInteger(h) && h >= 0 && h < 4 ? `, heading ${['east', 'south', 'west', 'north'][h]}` : ''; };
const some = (count, value) => count > 1 ? `${count} ${plural(count, value)}` : `some ${plural(2, value)}`;
function stepVariants(goal, step, bot = null) {
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
    case 'to_lava_for_portal': return "I'll cast the portal down by the lava, so each bucket is a short trip.";
    case 'buckets_for_portal': return "More buckets first: each one is another lava per trip.";
    // Going on without food under hunger 18, the hunt goes after no blaze
    // (mob-hunt.js prepareMobHunt): said so, not "going after a blaze" a
    // second after keep_on (25591, note 708).
    case 'hunt_mob': if (bot && keptOnHungry(goal, bot)) return [`Going on without food for now: I won't go after a ${name(step.entity)}, but I'll fight one that comes.`];
      return [`I'm going after a ${name(step.entity)} for ${name(step.item)}.`, `Hunting a ${name(step.entity)}. I need ${name(step.item)}.`];
    case 'strike_out': return ["Nothing here. I'll try somewhere new.", 'Time to look somewhere else.'];
    case 'stock_food_for_nether': return "I'm stocking up on food before the Nether.";
    case 'return_for_food': return "I'm out of food. Back through the portal to eat.";
    // A fortress left for now is not searched for: said so (note 708).
    case 'find_fortress': return step.walking ? "I'm in the fortress. Now, where are the blazes?"
      : step.found && fortressAlreadyAnnounced(goal, step) ? null
      : step.found ? "A fortress! I'm heading for it."
      // On its floors or on a walk to a place of it, nothing of a search is
      // said, a leave included (note 750e): 25583 said "Crossing to a part of
      // the fortress not yet walked" and "Leaving the fortress for now,
      // searching on (leg 1, heading north)" in the same second (04:32:12Z).
      : knownFortressSays(goal, step) === false ? null
      : fortressLeft(goal) ? `Leaving the fortress for now, searching on (leg ${step.legs || 1}${legHeading(goal)}).`
      // A fortress already known is not searched for as if none were (note
      // 750): 25590 said "I'm looking for a fortress (leg 37, heading north)"
      // 98 minutes after reaching one.
      : knownFortressSays(goal, step) || `I'm looking for a fortress (leg ${step.legs || 1}${legHeading(goal)}).`;
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
function stepLine(goal, step, decision, last = null, bot = null) {
  if (!step?.action) return null;
  const variants = stepVariants(goal, step, bot);
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
    const phrase = survivalLines(action.action, { dimension: bot.game?.dimension, morning: isMorning(bot), fed: fed(bot) });
    let line = pick(phrase, state.line, goal, action);
    if (action.action === 'escape_threat') {
      const names = [...new Set(threatsOf(action).map(t => name(t.name || t)))].sort().join(',');
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
  // The work's step is not said while the body is out of air or its head
  // in a block: the step is stopped then, and "Crafting a bread." as the
  // head sat in gravel read as work going on through it (note 680).
  let breathless = false;
  try { breathless = require('./vitals').needsAir(bot); } catch (_) { breathless = false; }
  if (breathless) return null;
  const decision = goal.decisions?.at(-1);
  const key = stepKey(goal, goal.step, decision);
  if (!key || key === state.step) return null;
  const line = stepLine(goal, goal.step, decision, state.line, bot);
  // A step with nothing to say (a tunnel segment, a climb) must not reset
  // the key, or the resource line fires again after every one of them.
  if (!line) return null;
  if (speak(line)) {
    state.step = key;
    // Once said, this fortress's own find is not said again (above).
    if (goal.step.action === 'find_fortress' && goal.step.fortress?.firstAt != null) state.fortressFirstAt = goal.step.fortress.firstAt;
    if (goal.step.action === 'find_fortress' && line === "A fortress! I'm heading for it." && fortressPlace(goal.step)) state.fortressesSaid = [...(state.fortressesSaid || []), fortressPlace(goal.step)].slice(-16);
    return line;
  }
  return null;
}

module.exports = { narrate, stepLine, stepKey, SURVIVAL, SURVIVAL_ELSEWHERE, OVERWORLD_ONLY, linesFor, survivalLines, MIN_GAP_MS, setRandom, pick };
