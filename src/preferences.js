'use strict';

// Candidate values come from the versioned catalog. Jev decides whether the
// current message actually chooses one; lexical mentions alone are not evidence.
function woodChoices(registry) {
  return Object.fromEntries(registry.itemsArray.filter(item => item.name.endsWith('_planks'))
    .map(item => [item.name.slice(0, -7), `${item.displayName.replace(/ Planks$/, '')} wood species` ]));
}

function requestedPreferences(kind, answer, candidates) {
  if (!['obtain', 'craft', 'house', 'build'].includes(kind) || !answer || answer.choice === 'none') return [];
  if (!Object.hasOwn(candidates, answer.choice)) throw new Error('Learned preference outside the offered catalog');
  if (!require('./decisions').confident('intake_wood_choice', answer, { missing: false })) return [];
  return [{ category: 'wood_species', value: answer.choice }];
}

// Keep task history for recall/repeat, but do not let a chooser re-infer a
// preference the player erased from an old request still in that history.
function preferenceContext(memory) {
  if (!memory) return undefined;
  return { notes: structuredClone(memory.notes || []), preferences: structuredClone(memory.preferences || []),
    meaning: 'Current explicit requests override explicit notes, then learned preferences as soft defaults for unspecified variants. A wood species applies across wooden item kinds, not unrelated items. Only the listed notes and preferences are evidence of preferences. An empty list means no remembered preference; use ordinary defaults. Do not infer player preferences from inventory or bot choices.' };
}


// The note judgment is independent of the request, so a caller that already
// asked it in a batch passes `noted` and no second request is made.
async function resolvedPreferenceContext(client, registry, memory, { noted } = {}) {
  const context = preferenceContext(memory);
  if (!context?.notes.length) return context;
  const candidates = woodChoices(registry);
  // Judge explicit notes on their own. Do not make every catalog branch
  // repeatedly arbitrate between a declared preference and a conflicting guess.
  const response = noted ? { answers: { noted_wood: noted } } : await require('./decisions').ask(client, { state: { playerNotes: context.notes }, questions: {
    noted_wood: ['noted_wood', { woods: candidates }],
  } });
  const answer = response.answers?.noted_wood;
  if (!answer || !(answer.choice === 'none' || Object.hasOwn(candidates, answer.choice))) throw new Error('Invalid explicit wood preference judgment');
  if (answer.choice !== 'none') {
    context.preferences = context.preferences.filter(p => p.category !== 'wood_species');
    if (require('./decisions').confident('noted_wood', answer, { missing: false })) context.preferences.push({ category: 'wood_species', value: answer.choice, source: 'explicit_note' });
  }
  return context;
}

module.exports = { woodChoices, requestedPreferences, preferenceContext, resolvedPreferenceContext };
