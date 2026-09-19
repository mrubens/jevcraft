'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let imported;
async function cameraModule() {
  if (!imported) imported = (async () => {
    const source = await fs.readFile(path.join(__dirname, '../public/harness/world.js'), 'utf8');
    const three = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
    // The camera math has no DOM/WebGL dependency; exercise the renderer's real
    // methods without constructing a browser canvas or loading UI-only helpers.
    const module = source.replace(/^import .*;\n/gm, '');
    return import(`data:text/javascript;base64,${Buffer.from(`import * as THREE from '${three}';\n${module}`).toString('base64')}`);
  })();
  return imported;
}

test('buffered camera interpolates walking between sparse observations and wraps yaw through the short arc', async () => {
  const { interpolatePose } = await cameraModule();
  const frames = [0, 1, 2, 3, 4].map(i => ({ at: i * 1000, dimension: 'overworld', position: { x: i * 4, y: 64, z: 0 }, yaw: i ? -Math.PI + .02 : Math.PI - .02 }));
  let previous = interpolatePose(frames, 0);
  for (let at = 1000 / 60; at < 4000; at += 1000 / 60) {
    const next = interpolatePose(frames, at);
    assert(Math.abs(next.position.x - previous.position.x) < .068, 'walking stays continuous at display frame rate');
    previous = next;
  }
  assert(Math.abs(interpolatePose(frames, 500).yaw - Math.PI) < .001);
  assert.equal(interpolatePose(frames, 10000).position.x, 16, 'never extrapolate movement after observations stop');
  const changed = [...frames, { at: 5000, dimension: 'the_nether', position: { x: 500, y: 70, z: 500 }, yaw: 0 }];
  assert.equal(interpolatePose(changed, 4500).dimension, 'the_nether');
  assert.equal(interpolatePose(changed, 4500).position.x, 500, 'dimension changes never invent a path between worlds');
});

test('a sudden head reversal rotates behind the avatar without collapsing camera distance', async () => {
  const THREE = await import('three');
  const { WorldView } = await cameraModule();
  const subject = { position: { x: 0, y: 64, z: 0 }, yaw: 0 };
  const view = Object.assign(Object.create(WorldView.prototype), {
    mode: 'behind', snapshot: subject, pose: () => subject, origin: { x: 0, y: 64, z: 0 }, behindDistance: 4.5,
    cameraBlocks: new Set(), camera: { position: new THREE.Vector3(), lookAt() {} },
    controls: { target: new THREE.Vector3() }, overlay: { children: [] },
  });
  view.behindCamera(0, true);
  const expectedDistance = Math.hypot(4.5, 1.25), focus = new THREE.Vector3(0, 1.35, 0);
  subject.yaw = Math.PI;
  for (let i = 0; i < 180; i++) {
    const previous = view.camera.position.clone();
    view.behindCamera(1 / 60);
    assert(Math.abs(view.camera.position.distanceTo(focus) - expectedDistance) < .00001);
    assert(view.camera.position.distanceTo(previous) < .14, 'rotation is rate limited even when head yaw changes instantly');
  }
  view.cameraBlocks.add('0,2,-2'); view.cameraBlocks.add('0,1,-2');
  view.behindCamera(1 / 60);
  assert(view.boomLength < 2, 'camera still pulls forward for solid terrain');
  const compressed = view.boomLength;
  view.cameraBlocks.clear(); view.behindCamera(1 / 60);
  assert(view.boomLength > compressed && view.boomLength - compressed < .16, 'camera eases back after an obstruction clears');
});
