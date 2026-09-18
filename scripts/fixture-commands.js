'use strict';
// Run these console commands only BEFORE a fresh controlled-world trial.
// This places world resources, never items in the bot inventory. The bot must
// mine, craft, smelt and build in survival. It is not a natural-world benchmark.
const lines = ['setworldspawn 0 64 0', 'time set day'];
for (const x of [10, 16, 22]) for (const z of [8, 14, 20]) {
  lines.push(`fill ${x - 1} 68 ${z - 1} ${x + 1} 69 ${z + 1} oak_leaves[persistent=true]`);
  lines.push(`fill ${x} 64 ${z} ${x} 68 ${z} oak_log`);
}
lines.push('fill -14 63 8 -7 63 15 sand');
lines.push('fill -14 63 20 -7 63 27 gravel');
lines.push('fill -8 63 -12 -3 63 -8 water');
lines.push('fill 7 63 -12 12 63 -9 stone');
lines.push('fill 15 63 -12 18 63 -9 iron_ore');
lines.push('fill 21 63 -12 23 63 -10 diamond_ore');
lines.push('fill 27 63 -12 31 63 -10 obsidian');
for (let x = -6; x <= 0; x += 2) {
  lines.push(`setblock ${x} 64 8 poppy`);
  lines.push(`setblock ${x} 64 11 cornflower`);
}
console.log(lines.join('\n'));
