import * as THREE from '/vendor/three.js';

// Standard Minecraft classic-arm UV layout, shared with the in-game PNG.
export function robotParts(texture) {
  const pieces = [];
  for (const [u, v, w, h, d, x, y] of [[0,0,8,8,8,0,28],[16,16,8,12,4,0,18],
    [40,16,4,12,4,-6,18],[32,48,4,12,4,6,18],[0,16,4,12,4,-2,6],[16,48,4,12,4,2,6]]) {
    const geometry = new THREE.BoxGeometry(w/16, h/16, d/16), uv = geometry.attributes.uv;
    // Box faces: right, left, top, bottom, front, back.
    const faces = [[u,v+d,d,h],[u+d+w,v+d,d,h],[u+d,v,w,d],[u+d+w,v,w,d],[u+d,v+d,w,h],[u+2*d+w,v+d,w,h]];
    faces.forEach(([sx,sy,sw,sh], face) => {
      const points = [[sx,sy],[sx+sw,sy],[sx,sy+sh],[sx+sw,sy+sh]];
      points.forEach(([px,py], index) => uv.setXY(face*4+index, px/64, 1-py/64));
    });
    uv.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture, color: texture ? '#ffffff' : '#aabfbe' }));
    mesh.userData = { jevAvatar: true, jevHeight: y/16, jevOffset: x/16 };
    pieces.push(mesh);
  }
  return pieces;
}
