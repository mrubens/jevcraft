#!/usr/bin/env node
'use strict';
// Lava switches (trial note 767d): each new lava the fetch names ("Walking to the lava pool at", "Digging toward the lava at") more than 16 blocks from the last it named, and whether a lava_way or portal_method answer came between.
//   node scripts/lava-switches.js <since ISO> [to ISO]   (JEV_ROOT reads another checkout's records)
const fs=require('fs'),path=require('path');const dir=require('path').join(process.env.JEV_ROOT ? require('path').resolve(process.env.JEV_ROOT) : require('path').join(__dirname, '..'), '.bot-state', 'flight');
const since=Date.parse(process.argv[2]),to=process.argv[3]?Date.parse(process.argv[3]):Infinity;
const st=n=>{const m=n.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)};
const by={};for(const n of fs.readdirSync(dir).filter(n=>n.endsWith('.jsonl')&&st(n)>=since-3600e3&&st(n)<=to).sort((a,b)=>st(a)-st(b))){const p=n.match(/-(\d{5})-Jev-/)[1];(by[p]||=[]).push(n)}
let named=0,sw=0,asked=0;const cases=[];
for(const [port,files] of Object.entries(by)){let last=null,askedSince=false;
 for(const n of files)for(const l of fs.readFileSync(path.join(dir,n),'utf8').split('\n')){if(!/"kind":"(chat|decision)"/.test(l.slice(0,30)))continue;let o;try{o=JSON.parse(l)}catch{continue};const t=Date.parse(o.at);if(t<since||t>to)continue;
  if(o.kind==='decision'){const id=o.snapshot?.decision?.id;if(id==='lava_way'||id==='portal_method'||id==='portal_plan')askedSince=true;continue}
  const m=String(o.detail?.message||'').match(/^(Walking to the lava pool at|Digging toward the lava at) \((-?\d+), (-?\d+), (-?\d+)\)(.*)$/);if(!m)continue;
  const at={x:+m[2],y:+m[3],z:+m[4]};named++;
  if(last&&Math.hypot(at.x-last.x,at.y-last.y,at.z-last.z)>16){ if(askedSince)asked++; else {sw++;cases.push(`${port} ${o.at.slice(11,19)} (${last.x}, ${last.y}, ${last.z}) -> (${at.x}, ${at.y}, ${at.z})${m[5].slice(0,60)}`)} }
  last=at;askedSince=false;}}
console.log(`lava named ${named}; switches to lava over 16 blocks from the last named: ${sw} unasked, ${asked} after a lava_way or portal_method answer`);for(const c of cases)console.log('  '+c);
