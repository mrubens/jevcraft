'use strict';

function chatNames(username) { return [...new Set([username, 'Jev'].filter(Boolean))]; }

function parseAddress(request, username) {
  const names = chatNames(username).sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = request.match(new RegExp(`^\\s*(?:${names.join('|')})(?:\\s*[:,]\\s*|\\s+|$)(.*)$`, 'i'));
  return { explicit: Boolean(match), text: (match ? match[1] : request).trim() };
}

module.exports = { chatNames, parseAddress };
