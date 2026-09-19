'use strict';
// Reproducible pixel art on Minecraft's exact 64x64 classic-arm UV layout.
// Original Jev artwork; no Mojang texture is copied or distributed.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { zipSync, strToU8 } = require('fflate');
const pixels = Buffer.alloc(64 * 64 * 4), rectangles = [];
const colors = { shell: '#dee9e6', side: '#aabfbe', shadow: '#627b82', dark: '#20313c', screen: '#142631', cyan: '#69ecd8', glow: '#d0fff2', amber: '#f5ba62' };
function rect(x, y, w, h, color) {
  rectangles.push({ x, y, w, h, color });
  const rgb = color.slice(1).match(/../g).map(n => parseInt(n, 16));
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const i = (py * 64 + px) * 4; pixels.set([...rgb, 255], i);
  }
}
function cube(u, v, w, h, d) {
  rect(u + d, v, w, d, colors.shell); rect(u + d + w, v, w, d, colors.shadow);
  rect(u, v + d, d, h, colors.side); rect(u + d, v + d, w, h, colors.shell);
  rect(u + d + w, v + d, d, h, colors.side); rect(u + 2 * d + w, v + d, w, h, colors.shadow);
  return { x: u + d, y: v + d, back: u + 2 * d + w };
}
const head = cube(0, 0, 8, 8, 8);
rect(8, 9, 8, 5, colors.dark); rect(9, 10, 6, 3, colors.screen);
rect(9, 10, 2, 2, colors.cyan); rect(13, 10, 2, 2, colors.cyan);
rect(10, 10, 1, 1, colors.glow); rect(14, 10, 1, 1, colors.glow);
rect(11, 13, 2, 1, colors.cyan); rect(9, 15, 6, 1, colors.shadow);
rect(2, 10, 3, 3, colors.dark); rect(3, 11, 1, 1, colors.amber);
rect(19, 10, 3, 3, colors.dark); rect(20, 11, 1, 1, colors.cyan);
rect(26, 10, 4, 1, colors.dark); rect(26, 12, 4, 1, colors.dark); rect(26, 14, 4, 1, colors.dark);
rect(11, 2, 2, 3, colors.cyan);
const torso = cube(16, 16, 8, 12, 4);
rect(20, 20, 8, 2, colors.dark); rect(21, 22, 6, 6, colors.side);
rect(22, 23, 4, 4, colors.dark); rect(24, 23, 1, 3, colors.cyan); rect(23, 26, 2, 1, colors.cyan); rect(22, 25, 1, 1, colors.cyan);
rect(21, 29, 2, 1, colors.amber); rect(24, 29, 3, 1, colors.cyan); rect(20, 31, 8, 1, colors.dark);
rect(33, 22, 6, 7, colors.dark); rect(34, 23, 4, 1, colors.cyan); rect(34, 25, 4, 1, colors.side); rect(34, 27, 4, 1, colors.side);
for (const [u, v] of [[40, 16], [32, 48]]) {
  const arm = cube(u, v, 4, 12, 4);
  rect(arm.x, arm.y, 4, 2, colors.side); rect(arm.x, arm.y + 5, 4, 2, colors.dark);
  rect(arm.x + 1, arm.y + 2, 2, 2, colors.cyan); rect(arm.x, arm.y + 10, 4, 2, colors.dark);
  rect(arm.back, arm.y + 5, 4, 2, colors.dark); rect(arm.back, arm.y + 10, 4, 2, colors.dark);
}
for (const [u, v] of [[0, 16], [16, 48]]) {
  const leg = cube(u, v, 4, 12, 4);
  rect(leg.x, leg.y, 4, 2, colors.dark); rect(leg.x, leg.y + 5, 4, 2, colors.shadow);
  rect(leg.x + 1, leg.y + 5, 2, 1, colors.cyan); rect(leg.x, leg.y + 9, 4, 3, colors.dark);
  rect(leg.x, leg.y + 9, 4, 1, colors.amber); rect(leg.back, leg.y + 9, 4, 3, colors.dark);
}
function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
function chunk(type, data) { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc32(body), out.length - 4); return out; }
const header = Buffer.alloc(13); header.writeUInt32BE(64); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6;
const scan = Buffer.alloc(64 * (1 + 64 * 4));
for (let y = 0; y < 64; y++) pixels.copy(scan, y * 257 + 1, y * 256, (y + 1) * 256);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
const output = path.join(__dirname, '../public/harness');
fs.writeFileSync(path.join(output, 'jev-robot.png'), png);
fs.writeFileSync(path.join(output, 'jev-robot.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="crispEdges">${rectangles.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}"/>`).join('')}</svg>\n`);
const metadata = { pack: { description: 'Jev the robot — local offline skin for Jev (wide Efe replacement)', min_format: 84, max_format: 84 } };
const pack = zipSync({ 'pack.mcmeta': strToU8(JSON.stringify(metadata)), 'assets/minecraft/textures/entity/player/wide/efe.png': png, 'pack.png': png,
  'README.txt': strToU8('Original Jev robot artwork. Replaces the wide Efe default skin used by offline Jev in Minecraft 26.1. Other players using that same default skin also change. This is cosmetic and local to clients that enable this pack. No gameplay changes.\n') });
fs.writeFileSync(path.join(output, 'jev-robot-pack.zip'), pack);
console.log('Created Jev robot skin, editable SVG, and Minecraft 26.1 resource pack.');
