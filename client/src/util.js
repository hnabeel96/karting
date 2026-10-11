import * as THREE from 'three';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

/** Frame-rate independent smoothing toward a target. */
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

/** A damped spring. Kick it with `v += impulse` for squash, recoil and wobble. */
export class Spring {
  constructor(k = 220, c = 14, x = 0) {
    this.k = k;
    this.c = c;
    this.x = x;
    this.v = 0;
  }
  step(target, dt) {
    this.v += ((target - this.x) * this.k - this.v * this.c) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/** Small seeded random so the scenery is the same on every phone. */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flat-shaded cartoon material. */
export function toon(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

/** Build a texture by drawing on a 2D canvas. */
export function canvasTexture(w, h, draw, { repeat = 1, nearest = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  if (nearest) tex.magFilter = THREE.NearestFilter;
  return tex;
}

/**
 * Collects many small static shapes into one mesh (one draw call).
 * Each shape gets a flat vertex colour, so one material covers the whole batch.
 */
export class StaticBatch {
  constructor() {
    this.parts = [];
  }
  add(geometry, color, position, rotation, scale) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(
      rotation instanceof THREE.Euler ? rotation : new THREE.Euler(...(rotation || [0, 0, 0])),
    );
    const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...(scale || [1, 1, 1]));
    m.compose(new THREE.Vector3(...(position || [0, 0, 0])), q, s);
    this.parts.push({ geometry, color: new THREE.Color(color), matrix: m });
    return this;
  }
  addMatrix(geometry, color, matrix) {
    this.parts.push({ geometry, color: new THREE.Color(color), matrix: matrix.clone() });
    return this;
  }
  build(material) {
    let count = 0;
    const prepared = this.parts.map((p) => {
      const g = (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone()).applyMatrix4(p.matrix);
      count += g.attributes.position.count;
      return { g, color: p.color };
    });
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let o = 0;
    for (const { g, color } of prepared) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      for (let i = 0; i < n; i++) {
        col[(o + i) * 3] = color.r;
        col[(o + i) * 3 + 1] = color.g;
        col[(o + i) * 3 + 2] = color.b;
      }
      o += n;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, material || new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  }
}
