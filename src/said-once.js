'use strict';
// What several options of one kind say word for word is said once, on the
// first of them (note 1104). 25594 (2026-10-03 20:17:19Z), 15 endermen
// about, was asked which of three to fight: each option was about 2,300
// characters, of which the first line (how far, how high, in sight or not)
// and one more (the seconds and the damage) were its own, and the same
// arena's record and the same ways of an enderman filled the rest three
// times over; it answered "none good" at 0.56.
// Sentences end at ". " or the text's end; one of MIN characters or more
// that the first option says is left out of the ones after it, which end
// with where it is said.
const MIN = 60;
const sentences = text => String(text).split(/(?<=\.)\s+/);
// tree: { key: { description } }, keys: the options of one kind, in order.
function saidOnce(tree, keys) {
  const list = keys.filter(k => typeof tree[k]?.description === 'string');
  if (list.length < 2) return tree;
  const first = new Set(sentences(tree[list[0]].description).filter(s => s.length >= MIN));
  for (const k of list.slice(1)) {
    const own = sentences(tree[k].description), kept = own.filter(s => !first.has(s));
    if (kept.length === own.length) continue;
    tree[k].description = `${kept.join(' ')} The rest is as said of the first of them (${list[0]}).`;
  }
  return tree;
}
module.exports = { saidOnce, MIN };
