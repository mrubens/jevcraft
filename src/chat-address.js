'use strict';

function chatNames(username) { return [...new Set([username, 'Jev'].filter(Boolean))]; }

function parseAddress(request, username) {
  const names = chatNames(username).sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = request.match(new RegExp(`^\\s*(?:${names.join('|')})(?:\\s*[:,]\\s*|\\s+|$)(.*)$`, 'i'));
  return { explicit: Boolean(match), text: (match ? match[1] : request).trim() };
}

// The reply to a question Jev asked, read with the request it answers,
// while the question is open. Only what can only be an answer counts: one
// of the options offered, a yes to a yes-or-no question, or the exact name
// of a Minecraft thing when the question was which one. Any short message
// counted before, so "brb" or "lol no" became a request and replaced the
// work in hand. Addressed, only a named option counts, since "Jev
// <anything>" is otherwise a new request.
const CLARIFY_MS = 90000;
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|go for it|yes please)$/i;
function clarificationReply(asked, address, { now = Date.now(), known = () => false } = {}) {
  if (!asked || !(asked.until > now)) return null;
  const text = address.text.replace(/[.!?]+$/, '').trim();
  if (!text) return null;
  const names = (asked.options || []).map(option => String(option).replaceAll('_', ' ').toLowerCase());
  const named = names.includes(text.toLowerCase());
  if (named) return `${asked.request} (${text})`;
  if (address.explicit) return null;
  if (asked.confirm && YES.test(text)) return `${asked.request} (yes, now)`;
  if (asked.which && known(text)) return `${asked.request} (${text})`;
  return null;
}

module.exports = { chatNames, parseAddress, clarificationReply, CLARIFY_MS };
