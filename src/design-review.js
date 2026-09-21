'use strict';
const { noul } = require('./typesafe');

// The designer is a generative model and the geometry validator only checks
// that what it drew can be built. Neither checks that a requested castle did
// not come back as a hut. Before hours of placing blocks, Jev is asked the one
// question code cannot express: does this design answer the request?
const THRESHOLD = 0.5;

function designSummary(design) {
  const [width, height, depth] = design.source.size;
  return { name: design.source.name, description: design.source.description, size: { width, height, depth },
    solidBlocks: design.blocks.length, materials: design.materials, entrance: design.source.entrance,
    palette: design.source.palette };
}

async function reviewDesign(client, { request, design, memory, editing, signal }) {
  const state = { request, design: designSummary(design), memory, editing: editing ? { name: editing.name, size: editing.size } : undefined };
  const response = await client.systemOne({ state, signal, kind: 'design', questions: {
    fits: noul('Does `design` answer what `request` asks for? Judge the kind of structure, its scale relative to the words used (a castle or mansion is far larger than a hut), and its materials where the request or memory names one. A design that is buildable but plainly not the thing asked for is no. Do not judge geometry details, decoration, or whether it is pretty.'),
  } });
  const fits = response.answers?.fits?.noul;
  if (!Number.isFinite(fits)) throw new Error('Invalid design review response');
  return { fits, accepted: fits >= THRESHOLD, threshold: THRESHOLD, usage: response.usage, summary: state.design, at: new Date().toISOString() };
}

module.exports = { reviewDesign, designSummary, THRESHOLD };
