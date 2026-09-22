'use strict';
const { choice } = require('./typesafe');
const { resolveItem } = require('./catalog');
const { buildPalette, validateSchematic, surveyForDesign } = require('./designer');
const { checkAir } = require('./vitals');

// A small construction grammar: Jev chooses typed parameters; code supplies
// exact geometry. This remains available with only a TypeSafe key.
function templateSchematic({ style, floors, size, material }) {
  const width = style === 'tower' ? 9 : size === 'large' ? 17 : style === 'mansion' ? 13 : 9;
  const depth = width, roof = floors * 4, height = roof + 3;
  const regions = [], add = (from, to, block = material) => regions.push({ from, to, block });
  add([0, 0, 0], [width - 1, roof, depth - 1]);
  add([1, 1, 1], [width - 2, roof - 1, depth - 2], 'air');
  for (let floor = 0; floor < floors; floor++) {
    const y = floor * 4;
    if (floor) add([1, y, 1], [width - 2, y, depth - 2]);
    for (let n = 2; n < width - 2; n += 3) {
      add([n, y + 2, 0], [n + 1, y + 3, 0], 'glass');
      add([n, y + 2, depth - 1], [n + 1, y + 3, depth - 1], 'glass');
      add([0, y + 2, n], [0, y + 3, n + 1], 'glass');
      add([width - 1, y + 2, n], [width - 1, y + 3, n + 1], 'glass');
    }
  }
  for (let floor = 0; floor < floors - 1; floor++) {
    const y = floor * 4;
    const x = floor % 2 === 0 ? 1 : width - 3;
    add([x, y + 4, 2], [x + 1, y + 6, 5], 'air');
    for (let step = 1; step <= 4; step++) add([x, y + 1, step + 1], [x + 1, y + step, step + 1]);
  }
  const middle = Math.floor(width / 2);
  add([middle - 1, 1, 0], [middle + 1, 2, 0], 'air');
  for (let inset = 1; inset <= 2; inset++) add([inset, roof + inset, 0], [width - 1 - inset, roof + inset, depth - 1]);
  return { name: `${material.replaceAll('_', ' ')} ${style}`, description: `Jev template: ${floors} floor(s), stepped roof, windows, wide entrance${floors > 1 ? ' and an interior staircase' : ''}.`,
    size: [width, height, depth], palette: [...new Set([material, 'glass'])], regions, entrance: [middle, 1, 0] };
}

const SHELF_PART_DESCRIPTIONS = {
  well: 'A well: a small stone or wooden well, a village well.', farm: 'A farm plot or field with crops.', chapel: 'A chapel, church or small temple.',
  pavilion: 'A pavilion, gazebo or open-sided shelter.', monument: 'A monument, statue, obelisk or memorial.', barn: 'A barn or large farm building.',
  lamp: 'A lamp post, street light or lantern post.', plaza: 'A plaza, square or paved centre.',
};

async function designWithJev(bot, task, request, client, memory) {
  const controller = new AbortController();
  const watcher = setInterval(() => { try { task.check(); checkAir(bot); } catch (e) { controller.abort(e); } }, 100);
  const stopThinking = require('./speech').thinking(bot);
  const cancellable = { systemOne: args => { task.check(); return client.systemOne({ ...args, signal: controller.signal }); } };
  try {
    memory = await require('./preferences').resolvedPreferenceContext(cancellable, bot.registry, memory);
    const world = surveyForDesign(bot);
    // Required here: the shelf itself builds its template entries from this file.
    const { library, chooseSchematic } = require('./schematic-library');
    const shelf = library(bot.registry), shelfParts = [...new Set(shelf.map(e => e.part))].filter(p => !['cottage', 'mansion', 'tower'].includes(p));
    const response = await cancellable.systemOne({ kind: 'design', state: { request, world, memory, templates: 'Rectangular cottage, mansion or tower, one to three floors, glass windows, stepped roof, open entrance and interior full-block stairs. No custom shapes, bridges or statues.' }, questions: {
      style: choice('Choose the closest supported structure that can fulfill this request. Select unsupported if the requested shape or essential feature cannot be represented by these templates.', {
        cottage: 'Small rectangular house/cottage, optionally multiple floors.', mansion: 'Large rectangular mansion with windows, wide entrance and multiple floors.', tower: 'Tall square tower with interior stairs.', unsupported: 'Requires another structure or custom geometry, such as bridge, castle battlements, statue, circular dome, complex wings or unsupported essential details.',
      }),
      floors: choice('Assuming a supported template, select its requested number of floors. Default to two for a mansion, three for a tower, one for a cottage. Select unsupported if more than three floors are essential.', { 1: 'One floor', 2: 'Two floors', 3: 'Three floors', unsupported: 'Requires more than three floors' }),
      size: choice('Select the overall requested size for a supported template.', { normal: 'Ordinary or compact size; default', large: 'Explicitly large, grand or spacious size' }),
      // Asked in the same batch, for when no template fits: the shelf has
      // chapels, wells, farms and more, and "build a chapel" was refused as
      // needing the generative designer with four chapels on it.
      ...(shelfParts.length ? { shelf_part: choice('Assuming the request does not fit a rectangular cottage, mansion or tower, which kind of ready-made building on the shelf does it ask for?',
        { ...Object.fromEntries(shelfParts.map(part => [part, SHELF_PART_DESCRIPTIONS[part] || part])), none: 'None of these: the request needs something the shelf does not have.' }) } : {}),
      material: choice('Can a primary building material be resolved from this request or relevant memory? Current explicit instructions override explicit memory notes, which override learned memory.preferences. Use a remembered wood species as planks for an unspecified building.', { specified: 'A primary material, color or wood species is requested or preferred in relevant memory.', default: 'No requested or remembered preferred material; use oak planks.' }),
    } });
    const answers = response.answers, style = answers?.style?.choice, floors = answers?.floors?.choice, size = answers?.size?.choice;
    const part = answers?.shelf_part?.choice;
    if (style === 'unsupported' && shelfParts.includes(part)) {
      const picked = await chooseSchematic(cancellable, { part, entries: shelf, request });
      task.check();
      return { ...validateSchematic(picked.entry.source, bot.registry), model: client.model || 'jev', backend: 'schematic-library', libraryId: picked.entry.id,
        createdAt: new Date().toISOString(), world, judgments: { ...answers, design: picked.judgments }, usage: response.usage };
    }
    if (!['cottage', 'mansion', 'tower'].includes(style) || !['1', '2', '3'].includes(floors) || !['normal', 'large'].includes(size)) {
      const others = shelfParts.filter(p => !['cottage', 'mansion', 'tower'].includes(p));
      const err = new Error(`Without the custom designer I can build rectangular cottages, mansions and towers of up to three floors${others.length ? `, or a ${others.join(', ')} from my designs` : ''}. The Jev fallback supports nothing else for this request`); err.name = 'Blocked'; throw err;
    }
    let material = 'oak_planks', resolution;
    if (answers.material?.choice === 'specified') {
      const supported = new Set(buildPalette(bot.registry));
      const catalog = { ...bot.registry, itemsArray: bot.registry.itemsArray.filter(i => supported.has(i.name)) };
      resolution = await resolveItem(cancellable, catalog, request, { blocksOnly: true, context: { purpose: 'Primary structural material for a building. A wood species means that species of planks.', memory } });
      if (!resolution.item) { const err = new Error('The requested material is not supported by the template builder'); err.name = 'Blocked'; throw err; }
      material = resolution.item;
    } else if (answers.material?.choice !== 'default') throw new Error('Invalid Jev building material judgment');
    task.check();
    return { ...validateSchematic(templateSchematic({ style, floors: Number(floors), size, material }), bot.registry),
      model: client.model || 'jev', backend: 'jev-template', createdAt: new Date().toISOString(), world,
      judgments: answers, usage: response.usage, materialResolution: resolution };
  } finally { clearInterval(watcher); stopThinking(); }
}
module.exports = { templateSchematic, designWithJev };
