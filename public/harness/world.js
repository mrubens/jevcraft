import * as THREE from '/vendor/three.js';
import { OrbitControls } from '/vendor/OrbitControls.js';
import { MinecraftTextures } from './textures.js';

const colors = { grass_block: '#91aa66', dirt: '#987759', stone: '#a1a499', sand: '#d8c89b', water: '#74adbd',
  cherry_leaves: '#e4b4c2', cherry_log: '#75504e', cherry_planks: '#cc9e9e', oak_log: '#806951', oak_leaves: '#6f915a',
  birch_log: '#d1cbbb', birch_leaves: '#91a65f', jungle_log: '#8b7557', jungle_leaves: '#688657', gravel: '#a5a29d',
  snow: '#e8eee6', snow_block: '#e8eee6', ice: '#b0cddd', lava: '#e99753', cobblestone: '#90988c', deepslate: '#676e69',
  netherrack: '#a36c67', obsidian: '#4c455d', glass: '#c4e1d5' };
function color(name) {
  if (colors[name]) return colors[name];
  if (/leaves|moss/.test(name)) return '#779463';
  if (/log|wood/.test(name)) return '#8d7059';
  if (/planks|slab|stairs|fence/.test(name)) return '#b09a76';
  if (/ore/.test(name)) return '#859494';
  let hash = 0; for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return new THREE.Color().setHSL((Math.abs(hash) % 360) / 360, .13, .57);
}
function dispose(group) { for (const child of [...group.children]) { group.remove(child); child.dispose?.(); child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach(m => m.dispose()); else child.material?.dispose(); } }

export function interpolatePose(frames, at) {
  if (!frames?.length) return null;
  const last = frames.at(-1), sameWorld = frames.slice(frames.findLastIndex(f => f.dimension !== last.dimension) + 1);
  let a = sameWorld[0], b = a;
  for (const frame of sameWorld) { b = frame; if (frame.at >= at) break; a = frame; }
  const span = b.at - a.at, fraction = span > 0 ? Math.max(0, Math.min(1, (at - a.at) / span)) : 0;
  // Teleports/dimension transitions must not animate a made-up route through terrain.
  if (Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z) > 24) return at < b.at ? a : b;
  const yawDelta = Math.atan2(Math.sin((b.yaw || 0) - (a.yaw || 0)), Math.cos((b.yaw || 0) - (a.yaw || 0)));
  return { position: Object.fromEntries(['x', 'y', 'z'].map(k => [k, a.position[k] + (b.position[k] - a.position[k]) * fraction])),
    yaw: (a.yaw || 0) + yawDelta * fraction, pitch: (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * fraction, dimension: a.dimension };
}

export function followHeading(current, target, dt) {
  if (!Number.isFinite(current)) return target;
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const limit = 1.8 * dt; // Limit head-turn-driven camera rotation to about 100 degrees/second.
  return current + Math.max(-limit, Math.min(limit, delta * (1 - Math.exp(-dt * 4))));
}

export class WorldView {
  constructor(container) {
    this.container = container; this.mode = 'orbit'; this.layer = 12; this.preview = true; this.target = new THREE.Vector3();
    this.behindDistance = 4.5; this.cameraBlocks = new Set(); this.motionFrames = [];
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#dfe8df');
    this.scene.fog = new THREE.Fog('#dfe8df', 55, 140);
    this.camera = new THREE.PerspectiveCamera(43, 1, .05, 250);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#dfe8df');
    this.renderer.domElement.setAttribute('aria-label', 'Jev world canvas');
    container.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * .49; this.controls.minDistance = 3; this.controls.maxDistance = 100;
    this.scene.add(new THREE.HemisphereLight('#fff8e8', '#8e9e8a', 2.5));
    const sun = new THREE.DirectionalLight('#fff5de', 2); sun.position.set(-15, 30, 18); this.scene.add(sun);
    this.terrain = new THREE.Group(); this.overlay = new THREE.Group(); this.scene.add(this.terrain, this.overlay);
    this.grid = new THREE.GridHelper(80, 80, '#bccbb8', '#cedac8'); this.grid.position.y = -.1; this.scene.add(this.grid);
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointermove', e => this.pick(e));
    this.renderer.domElement.addEventListener('pointerleave', () => { document.querySelector('#hover').hidden = true; });
    this.renderer.domElement.addEventListener('wheel', event => {
      if (this.mode !== 'behind') return;
      event.preventDefault();
      this.behindDistance = THREE.MathUtils.clamp(this.behindDistance + event.deltaY * .006, 2, 10);
      this.updateBehindTarget();
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize(); this.reset();
    this.textures = new MinecraftTextures(() => {
      const status = this.textures.status(), label = document.querySelector('#texture-status'), toggle = document.querySelector('#textures');
      if (label) { label.textContent = status.label; label.title = status.description; }
      if (toggle) { toggle.disabled = !status.available; toggle.checked = status.available && this.textures.enabled; toggle.parentElement.title = status.description; }
      if (this.snapshot) this.update(this.snapshot, true);
    });
    this.renderer.setAnimationLoop(time => {
      const dt = Math.min(.1, (time - (this.lastRender || time)) / 1000); this.lastRender = time;
      if (this.mode === 'behind') this.behindCamera(dt);
      else if (this.mode === 'eyes') this.eyeCamera();
      else this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }
  resize() { const { width, height } = this.container.getBoundingClientRect(); if (!width || !height) return; this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }
  reset() {
    if (this.mode === 'behind') { this.followYaw = undefined; this.boomLength = undefined; this.behindCamera(0, true); return; }
    if (this.mode === 'eyes') { this.eyeCamera(); return; }
    this.controls.target.copy(this.target);
    const offset = this.mode === 'top' ? new THREE.Vector3(0, 39, .02) : new THREE.Vector3(24, 22, 29);
    this.camera.position.copy(this.target).add(offset); this.camera.lookAt(this.target); this.controls.update(); this.eyeCamera();
  }
  setMode(mode) { this.mode = mode; this.controls.enabled = !['eyes', 'behind'].includes(mode); this.controls.enableRotate = mode !== 'top'; this.update(this.snapshot || {}, true); this.reset(); }
  setLayer(layer) { this.layer = Number(layer); this.worldKey = null; this.update(this.snapshot || {}, true); }
  setPreview(value) { this.preview = value; this.update(this.snapshot || {}, true); }
  setTextures(value) { this.textures.enabled = value; this.textures.changed(); }
  pose() { return interpolatePose(this.motionFrames, Date.now() - 3000) || this.snapshot; }
  eyeCamera() {
    if (this.mode !== 'eyes' || !this.snapshot?.position) return;
    const { position: p, yaw = 0, pitch = 0 } = this.pose();
    const eye = new THREE.Vector3(p.x - this.origin.x, p.y - this.origin.y + 1.62, p.z - this.origin.z);
    const direction = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(eye); this.controls.target.copy(eye).add(direction); this.camera.lookAt(this.controls.target);
  }
  updateBehindTarget() {
    if (this.mode !== 'behind' || !this.snapshot?.position) return null;
    const { position: p, yaw = 0 } = this.pose();
    const focus = new THREE.Vector3(p.x - this.origin.x, p.y - this.origin.y + 1.35, p.z - this.origin.z);
    return { focus, yaw, position: p };
  }
  behindCamera(dt, snap = false) {
    const target = this.updateBehindTarget();
    if (!target) return;
    const { focus, yaw, position } = target;
    this.followYaw = snap ? yaw : followHeading(this.followYaw, yaw, dt);
    // Interpolate the angle around the subject, not a chord through its head.
    const direction = new THREE.Vector3(Math.sin(this.followYaw) * this.behindDistance, 1.25, Math.cos(this.followYaw) * this.behindDistance), distance = direction.length();
    direction.normalize();
    let clear = distance;
    // Pull in for solid terrain, then ease back out. Foliage is translucent in
    // this mode instead of repeatedly collapsing the boom beneath tree canopies.
    for (let d = .12; d <= distance; d += .08) {
      const p = focus.clone().addScaledVector(direction, d);
      if ([[0,0,0],[.12,0,0],[-.12,0,0],[0,.12,0],[0,-.12,0],[0,0,.12],[0,0,-.12]].some(offset =>
        this.cameraBlocks.has(`${Math.floor(p.x + offset[0])},${Math.floor(p.y + offset[1])},${Math.floor(p.z + offset[2])}`))) { clear = Math.max(.08, d - .16); break; }
    }
    this.boomLength = snap || !Number.isFinite(this.boomLength) ? clear : Math.min(clear, this.boomLength + Math.max(0, clear - this.boomLength) * (1 - Math.exp(-dt * 2)));
    this.camera.position.copy(focus).addScaledVector(direction, this.boomLength);
    this.controls.target.copy(focus); this.camera.lookAt(focus);
    for (const mesh of this.overlay.children) if (mesh.userData.jevAvatar) {
      mesh.visible = this.boomLength >= 1;
      mesh.position.set(position.x - this.origin.x, position.y - this.origin.y + mesh.userData.jevHeight, position.z - this.origin.z);
      if (!mesh.userData.jevRing) mesh.rotation.y = yaw;
    }
  }
  update(snapshot, force = false, trail = this.trail || [], motionFrames) {
    const prior = this.origin;
    if (motionFrames !== undefined) this.motionFrames = motionFrames || [];
    if (this.snapshot?.dimension !== snapshot.dimension) { this.followYaw = undefined; this.boomLength = undefined; }
    this.snapshot = snapshot; this.trail = trail;
    this.origin = snapshot.world?.origin || snapshot.position || { x: 0, y: 0, z: 0 };
    const origin = this.origin, p = snapshot.position || origin;
    this.target.set(p.x - origin.x, p.y - origin.y + 1, p.z - origin.z);
    if (prior) {
      const delta = new THREE.Vector3(prior.x - origin.x, prior.y - origin.y, prior.z - origin.z);
      this.camera.position.add(delta); this.controls.target.add(delta);
    } else this.reset();
    const world = snapshot.world, key = world ? JSON.stringify(world) : '';
    if (this.worldKey !== key || force) {
      this.worldKey = key; dispose(this.terrain);
      this.cameraBlocks.clear();
      if (world) {
        const visible = world.blocks.filter(b => b[1] <= this.layer), occupied = new Set(visible.map(b => b.slice(0, 3).join(',')));
        for (const b of visible) if (!/^(water|bubble_column|lava|seagrass|tall_seagrass|kelp|kelp_plant)$|_leaves$/.test(world.palette[b[3]])) this.cameraBlocks.add(b.slice(0, 3).join(','));
        for (const [id, name] of world.palette.entries()) {
          const foliage = this.mode === 'behind' && name.endsWith('_leaves');
          const transparent = foliage || /water|glass|ice/.test(name);
          const entries = visible.filter(b => b[3] === id && (transparent || [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(d => !occupied.has(`${b[0]+d[0]},${b[1]+d[1]},${b[2]+d[2]}`))));
          if (!entries.length) continue;
          const base = color(name);
          const material = Array.from({ length: 6 }, (_, side) => {
            const map = this.textures?.get(name, side);
            return new THREE.MeshLambertMaterial({
              map, color: map ? '#ffffff' : name === 'grass_block' && side !== 2 ? '#9b855e' : base,
              alphaTest: map ? .1 : 0,
              transparent, opacity: foliage ? .35 : transparent ? .62 : 1, depthWrite: !transparent,
            });
          });
          const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, entries.length);
          const matrix = new THREE.Matrix4();
          entries.forEach((b, i) => { matrix.makeTranslation(b[0] + .5, b[1] + .5, b[2] + .5); mesh.setMatrixAt(i, matrix); });
          mesh.instanceMatrix.needsUpdate = true; mesh.userData = { name, blocks: entries }; this.terrain.add(mesh);
        }
      }
    }
    dispose(this.overlay);
    const local = p => new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    const line = (points, tint, elevation = .13) => {
      if (points?.length < 2) return;
      const vertices = (points || []).filter(p => [p.x,p.y,p.z].every(Number.isFinite)).map(p => local(p).add(new THREE.Vector3(0, elevation, 0)));
      if (vertices.length < 2) return;
      this.overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), new THREE.LineBasicMaterial({ color: tint, depthTest: false, transparent: true, opacity: .9 })));
    };
    line(trail, '#78998a', .08); line(snapshot.route, '#eea052', .2);
    const avatar = (p, tint, isJev) => {
      const center = local(p);
      for (const [w,h,d,y,c] of [[.5,.72,.3,.72,tint],[.46,.46,.46,1.4,isJev?'#e7d7b5':'#b7b3a4'],[.17,.5,.22,.25,'#576554']]) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshLambertMaterial({ color: c }));
        mesh.position.copy(center).add(new THREE.Vector3(0,y,0)); mesh.rotation.y = isJev ? snapshot.yaw || 0 : 0; mesh.userData = { jevAvatar: isJev, jevHeight: y }; this.overlay.add(mesh);
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(.48,.58,32), new THREE.MeshBasicMaterial({ color: tint, side: THREE.DoubleSide, depthTest: false }));
      ring.rotation.x = -Math.PI/2; ring.position.copy(center).add(new THREE.Vector3(0,.04,0)); ring.userData = { jevAvatar: isJev, jevHeight: .04, jevRing: true }; this.overlay.add(ring);
      if (isJev && this.mode !== 'behind') {
        const marker = new THREE.Mesh(new THREE.ConeGeometry(.16,.35,4),new THREE.MeshBasicMaterial({color:'#196b50'}));
        marker.rotation.z = Math.PI; marker.position.copy(center).add(new THREE.Vector3(0,2.3,0));this.overlay.add(marker);
      }
    };
    if (snapshot.position && this.mode !== 'eyes') avatar(p, '#277c60', true);
    for (const entity of snapshot.entities || []) if (entity.position) avatar(entity.position, '#9b9f8d', false);
    const blueprint = snapshot.goal?.blueprint;
    if (this.preview && blueprint?.blocks?.length) {
      const blocks = blueprint.blocks.slice(0, 6000);
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.94,.94,.94), new THREE.MeshBasicMaterial({ color: '#73a8d4', transparent: true, opacity: .19, depthWrite: false }), blocks.length);
      const matrix = new THREE.Matrix4();
      blocks.forEach((b,i) => { matrix.makeTranslation(b.x-origin.x+.5,b.y-origin.y+.5,b.z-origin.z+.5);mesh.setMatrixAt(i,matrix); });
      mesh.instanceMatrix.needsUpdate = true;this.overlay.add(mesh);
    }
    this.grid.visible = !world; this.eyeCamera(); this.updateBehindTarget();
  }
  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit = this.raycaster.intersectObjects(this.terrain.children)[0], label = document.querySelector('#hover');
    label.hidden = !hit;
    if (hit) { const b = hit.object.userData.blocks[hit.instanceId]; label.textContent = `${hit.object.userData.name.replaceAll('_',' ')} · ${b[0]+this.origin.x}, ${b[1]+this.origin.y}, ${b[2]+this.origin.z}`; }
  }
}
