import * as THREE from '/vendor/three.js';

// Minecraft stores some foliage and water in grayscale; the game applies biome colors.
// These are representative default tints, not a claim that the observer captured biome data.
function tint(name) {
  if (/water|bubble_column/.test(name)) return '#3f76e4';
  if (name === 'spruce_leaves') return '#619961';
  if (name === 'birch_leaves') return '#80a755';
  if (/^(oak|jungle|acacia|dark_oak|mangrove)_leaves$/.test(name)) return '#77ab2f';
  if (/grass|fern|vine|lily_pad/.test(name)) return '#91bd59';
  return null; // Cherry, azalea and pale oak textures already contain their color.
}

export class MinecraftTextures {
  constructor(changed) {
    this.changed = changed; this.images = new Map(); this.faces = new Map(); this.enabled = true;
    this.manifest = null; this.failed = 0;
    this.ready = this.load();
  }
  status() {
    const available = !!this.manifest?.available;
    return { available, label: available ? this.enabled ? this.manifest.label : 'Block colors' : 'Block colors',
      description: available ? `${this.manifest.label} textures from your local installation. Shapes and biome tints are approximate.${this.failed ? ' Some missing textures use block colors.' : ''}` :
        'Minecraft textures were not found. Set MINECRAFT_CLIENT_JAR to a local client jar and restart the viewer.' };
  }
  async load() {
    try {
      const response = await fetch('/api/textures');
      if (!response.ok) throw new Error('Texture manifest unavailable');
      this.manifest = await response.json();
    } catch { this.manifest = { available: false }; }
    this.changed();
  }
  notify() {
    if (this.queued) return;
    this.queued = true; requestAnimationFrame(() => { this.queued = false; this.changed(); });
  }
  image(name) {
    if (!this.images.has(name)) this.images.set(name, new Promise((resolve, reject) => {
      const spec = this.manifest.textures[name];
      if (!spec) return reject(new Error('Missing texture'));
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Missing texture'));
      image.src = spec.url;
    }));
    return this.images.get(name);
  }
  get(name, side) {
    if (!this.enabled || !this.manifest?.available) return null;
    const layers = this.manifest.blocks[name]?.[side];
    if (!layers?.length) return null;
    const shade = tint(name), key = JSON.stringify([layers, shade]);
    if (!this.faces.has(key)) {
      this.faces.set(key, null);
      this.compose(layers, shade).then(texture => { this.faces.set(key, texture); this.notify(); })
        .catch(() => { this.failed++; this.notify(); });
    }
    return this.faces.get(key);
  }
  async compose(layers, shade) {
    const images = await Promise.all(layers.map(layer => this.image(layer.texture)));
    const size = Math.min(512, Math.max(...layers.map(layer => this.manifest.textures[layer.texture].crop[2])));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i], tile = document.createElement('canvas'); tile.width = tile.height = size;
      const paint = tile.getContext('2d'); paint.imageSmoothingEnabled = false;
      const crop = this.manifest.textures[layer.texture].crop;
      paint.drawImage(images[i], ...crop, 0, 0, size, size);
      if (layer.tinted && shade) {
        paint.globalCompositeOperation = 'multiply'; paint.fillStyle = shade; paint.fillRect(0, 0, size, size);
        paint.globalCompositeOperation = 'destination-in'; paint.drawImage(images[i], ...crop, 0, 0, size, size);
      }
      ctx.drawImage(tile, 0, 0);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false; texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
}
