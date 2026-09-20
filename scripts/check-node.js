'use strict';

// package.json declares engines.node, but npm only enforces that at install
// time. Running the suite on an older Node fails somewhere unrelated instead:
// on Node 18 the node:test mock-timers option object is rejected with
// ERR_INVALID_ARG_TYPE, which reads like two broken boat tests. Say the real
// reason before any of that runs.

const required = Number(/^>=(\d+)/.exec(require('../package.json').engines.node)?.[1]);
const current = Number(process.versions.node.split('.')[0]);

if (!Number.isInteger(required)) {
  console.error('Could not read the required Node version from package.json engines.node');
  process.exit(1);
}
if (current < required) {
  console.error(`JevBot needs Node ${required} or newer. This is ${process.version}.`);
  console.error('Install a supported Node (for example: nvm install 22 && nvm use), then run npm ci again.');
  process.exit(1);
}
