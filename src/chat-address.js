'use strict';

function chatNames(username) { return [...new Set([username, 'Jev'].filter(Boolean))]; }

function parseAddress(request, username) {
  const names = chatNames(username).sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = request.match(new RegExp(`^\\s*(?:${names.join('|')})(?:\\s*[:,]\\s*|\\s+|$)(.*)$`, 'i'));
  return { explicit: Boolean(match), text: (match ? match[1] : request).trim() };
}

// The reply to a question Jev asked, read with the request it answers.
// Unaddressed, it counts only while the question is open and only if it is
// short enough to be an answer rather than talk to someone else; addressed,
// only if it names one of the options offered, since "Jev <anything>" is
// otherwise a new request.
const CLARIFY_MS = 90000;
function clarificationReply(asked, address, now = Date.now()) {
  if (!asked || !(asked.until > now)) return null;
  const text = address.text.replace(/[.!?]+$/, '').trim();
  if (!text) return null;
  const names = (asked.options || []).map(option => String(option).replaceAll('_', ' ').toLowerCase());
  const named = names.includes(text.toLowerCase());
  if (address.explicit ? !named : text.split(/\s+/).length > 6) return null;
  return `${asked.request} (${text})`;
}

module.exports = { chatNames, parseAddress, clarificationReply, CLARIFY_MS };
