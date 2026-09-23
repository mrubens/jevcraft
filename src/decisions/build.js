'use strict';
// Building: whether a request continues something already built, which
// template or shelf design answers it, and whether a drawn design does.
const { choice, noul } = require('../typesafe');
const { define } = require('./index');

const build = spec => define({ area: 'build', kind: 'design', ...spec });

// Code offers only structures that actually exist nearby; Jev decides whether
// this request continues one of them and in what sense. It can never name a
// structure, a mode or a position that was not already on the table.
const MODES = {
  finish: 'Continue building a structure that was never completed, using its existing plan. "Finish the mansion", "carry on with the tower".',
  edit: 'Change a structure that already stands, in any way at all: adding to it, taking part of it away, reshaping it or redecorating it. "Add a porch to the barn", "put a second floor on the house", "take the roof off", "get rid of the tower on top and make it a hut", "make it taller", "paint it red", "build a shed next to it". Anything that alters what the building is or how it looks belongs here.',
  repair: 'Put back parts of an existing structure that have gone missing or been broken, leaving its design exactly as it already is. "Fix the barn", "repair the wall". Never for changing the design itself, only for restoring it.',
  fresh: 'A brand new, separate structure unrelated to anything already built.',
};
// An edit takes out every cell of the old building the new drawing leaves
// out, so it needs a sure answer on both mode and target.
const EDIT = 0.65;
build({
  id: 'build_mode', kind: 'request', primitive: 'choice', stakes: 'high',
  gate: { threshold: EDIT, below: 'caller', why: 'an unsure edit is built fresh beside the structure instead, which destroys nothing' },
  build: () => choice('Does this build request continue a structure Jev has already built, and how? Judge the words of the request, not whether continuing would be convenient. Choose fresh unless the request clearly refers to existing work.', MODES),
});
build({
  id: 'build_target', kind: 'request', primitive: 'choice', stakes: 'high',
  gate: { threshold: EDIT, below: 'caller', why: 'an edit of an unsure target is built fresh beside it instead' },
  build: ({ builds }) => choice('Assuming the request continues existing work, which of these structures does it mean? Match by name, description or the place the speaker refers to. Choose none if the request does not point at any of them.',
    { ...Object.fromEntries(builds.map(b => [b.id, `${b.name} (${b.status}, ${b.standing}% of it still standing), built ${b.distance} blocks away from the speaker for request "${b.request}"`])), none: 'The request does not refer to any of these structures.' }),
});
build({
  id: 'build_placement', kind: 'request', primitive: 'choice', stakes: 'medium',
  build: ({ options }) => choice('Where should this structure go? "Here" means at the speaker\'s own position.', options),
});

// The template designer, for when no generative designer is configured.
build({
  id: 'template_style', primitive: 'choice', stakes: 'medium',
  build: () => choice('Choose the closest supported structure that can fulfill this request. Select unsupported if the requested shape or essential feature cannot be represented by these templates.', {
    cottage: 'Small rectangular house/cottage, optionally multiple floors.', mansion: 'Large rectangular mansion with windows, wide entrance and multiple floors.', tower: 'Tall square tower with interior stairs.', unsupported: 'Requires another structure or custom geometry, such as bridge, castle battlements, statue, circular dome, complex wings or unsupported essential details.',
  }),
});
build({
  id: 'template_floors', primitive: 'choice', stakes: 'low',
  build: () => choice('Assuming a supported template, select its requested number of floors. Default to two for a mansion, three for a tower, one for a cottage. Select unsupported if more than three floors are essential.', { 1: 'One floor', 2: 'Two floors', 3: 'Three floors', unsupported: 'Requires more than three floors' }),
});
build({
  id: 'template_size', primitive: 'choice', stakes: 'low',
  build: () => choice('Select the overall requested size for a supported template.', { normal: 'Ordinary or compact size; default', large: 'Explicitly large, grand or spacious size' }),
});
build({
  id: 'template_shelf_part', primitive: 'choice', stakes: 'medium',
  build: ({ parts }) => choice('Assuming the request does not fit a rectangular cottage, mansion or tower, which kind of ready-made building on the shelf does it ask for?',
    { ...parts, none: 'None of these: the request needs something the shelf does not have.' }),
});
build({
  id: 'template_material', primitive: 'choice', stakes: 'low',
  build: () => choice('Can a primary building material be resolved from this request or relevant memory? Current explicit instructions override explicit memory notes, which override learned memory.preferences. Use a remembered wood species as planks for an unspecified building.', { specified: 'A primary material, color or wood species is requested or preferred in relevant memory.', default: 'No requested or remembered preferred material; use oak planks.' }),
});
build({
  id: 'schematic_design', primitive: 'choice', stakes: 'medium',
  build: ({ part, request, options }) => choice(request ? `Which ${part} design best answers the request?` : `Which ${part} design should the bot build next for this village?`, options),
});
// Before hours of placing blocks, Jev is asked the one question code cannot
// express: does this design answer the request?
build({
  id: 'design_fits', primitive: 'noul', stakes: 'high',
  gate: { threshold: 0.5, below: 'caller', why: 'a design that does not answer the request is sent back to the designer with the reason, up to four times' },
  build: () => noul('Does `design` answer what `request` asks for? Judge the kind of structure, its scale relative to the words used (a castle or mansion is far larger than a hut), and its materials where the request or memory names one. A design that is buildable but plainly not the thing asked for is no. Do not judge geometry details, decoration, or whether it is pretty.'),
});

module.exports = { MODES, EDIT };
