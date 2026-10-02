'use strict';
// The bank walks with rods (rod-bank.js) as the flight records have them:
// each walk begun ("Taking the N blaze rods out to a chest ...") and what
// came next for that bot, the rods in a chest ("Banked ..." or "Out with ...")
// or a death. node scripts/rod-bank-walks.js [YYYY-MM-DD]
const fs = require('fs'), path = require('path');
const day = process.argv[2] || new Date().toISOString().slice(0, 10);
const dir = process.env.FLIGHT_DIR || path.join(__dirname, '..', '.bot-state', 'flight');
const ev = [];
for (const f of fs.readdirSync(dir).filter(f => f.includes(day))) {
  const port = (f.match(/-(\d{5})-/) || [])[1];
  for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!/Taking the \d+ blaze rods? out to a chest|Out with \d+ blaze rods?: into a chest|Banked \d+ blaze rods? in a chest|"health":0[,}]/.test(l)) continue;
    const at = (l.match(new RegExp(`"at":"(${day}T[^"]+)"`)) || [])[1];
    if (at) ev.push({ port, at, k: /Taking the/.test(l) ? 'start' : /Out with|Banked/.test(l) ? 'banked' : 'dead' });
  }
}
ev.sort((a, b) => a.port.localeCompare(b.port) || a.at.localeCompare(b.at));
const WALK_MS = 60 * 60000;
const out = { walks: 0, banked: 0, died: 0, other: 0, open: 0, from: null, to: null };
for (let i = 0; i < ev.length; i++) {
  const e = ev[i], prev = ev[i - 1];
  if (e.k !== 'start' || (prev && prev.port === e.port && prev.k === 'start')) continue;
  out.walks++; const t = e.at.slice(11, 16); if (!out.from || t < out.from) out.from = t; if (!out.to || t > out.to) out.to = t;
  let j = i + 1; while (j < ev.length && ev[j].port === e.port && ev[j].k === 'start') j++;
  const n = ev[j];
  // A death more than WALK_MS after the walk began is not the walk's: the
  // walk ended some other way first (given up, set aside, the trial on).
  if (!n || n.port !== e.port) out.open++; else if (n.k === 'banked') out.banked++; else if (Date.parse(n.at) - Date.parse(e.at) <= WALK_MS) out.died++; else out.other++;
}
console.log(JSON.stringify({ day, ...out }));
