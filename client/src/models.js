// Loads the model files named in models/manifest.js and turns them into
// instanced meshes, so a prop used 20 times still costs one draw call per part.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const RANDOM_YAW_DEFAULT = new Set(['palm', 'pillar', 'rock']);

/**
 * @returns {Promise<{kart: {scene, opts}|null, props: Record<string, {scene, opts}>}>}
 * A model that fails to load is skipped with a console warning; the built-in art is used instead.
 */
export async function loadModels(manifest, baseUrl) {
  const loader = new GLTFLoader();
  const load = async (opts, label) => {
    if (!opts || !opts.file) return null;
    try {
      const gltf = await loader.loadAsync(new URL(opts.file, baseUrl).href);
      return { scene: gltf.scene, opts };
    } catch (err) {
      console.warn(`[models] could not load ${label} from ${opts.file}; using the built-in one.`, err);
      return null;
    }
  };
  const props = {};
  const jobs = Object.entries(manifest.props || {}).map(async ([kind, opts]) => {
    const m = await load(opts, kind);
    if (m) props[kind] = m;
  });
  const [kart] = await Promise.all([load(manifest.kart, 'kart'), ...jobs]);
  return { kart, props };
}

/** Bounding box of a model in its own space. */
export function modelBox(scene) {
  scene.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(scene);
}

/**
 * Many copies of one model. Each mesh inside the model becomes one InstancedMesh.
 * Call setMatrixAt(i, matrix) to place copy i, then commit().
 */
export class ModelInstances {
  constructor(scene, model, count, { castShadow = true, receiveShadow = true } = {}) {
    model.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    this.parts = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const local = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
      const mesh = new THREE.InstancedMesh(o.geometry, o.material, count);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.parts.push({ mesh, local });
    });
    this.count = count;
    this.tmp = new THREE.Matrix4();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.setMatrixAt(i, hidden);
    this.commit();
  }
  setMatrixAt(i, m) {
    for (const p of this.parts) {
      this.tmp.multiplyMatrices(m, p.local);
      p.mesh.setMatrixAt(i, this.tmp);
    }
  }
  commit() {
    for (const p of this.parts) p.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Where one copy of a prop goes: on the obstacle's position, turned and scaled
 * by the manifest options. With fit: 'footprint' it is stretched to cover the collision shape.
 */
export function placement(kind, o, opts, box, rnd) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  let sx = opts.scale ?? 1;
  let sy = sx;
  let sz = sx;
  let yaw = THREE.MathUtils.degToRad(opts.rotateY ?? 0);
  const randomYaw = opts.randomYaw ?? RANDOM_YAW_DEFAULT.has(kind);
  if (randomYaw) yaw += rnd() * Math.PI * 2;

  if (opts.fit === 'footprint' && size.x > 0 && size.z > 0) {
    let w;
    let d;
    if (o.shape === 'circle') {
      w = d = o.r * 2;
    } else {
      // long walls: turn the model so its long side follows the box's long side
      const modelLongX = size.x >= size.z;
      const boxLongX = o.hw >= o.hd;
      if (modelLongX !== boxLongX) yaw += Math.PI / 2;
      w = (boxLongX === modelLongX ? o.hw : o.hd) * 2;
      d = (boxLongX === modelLongX ? o.hd : o.hw) * 2;
    }
    sx = w / size.x;
    sz = d / size.z;
    // height is left as modelled (times scale): stretching a wall longer should not make it taller
  }

  // centre the model on the obstacle and stand it on the ground
  const offset = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(o.x, opts.y ?? 0, o.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(sx, sy, sz),
  );
  return m.multiply(offset);
}

/** Pink outlines of every collision shape, to check that models line up with them. */
export function colliderOverlay(scene, arena, world, TUNING) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: '#ff2bd6', depthTest: false });
  const ring = (x, z, r) => {
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pts.push(new THREE.Vector3(x + Math.sin(a) * r, 0.15, z + Math.cos(a) * r));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  };
  const rect = (x, z, hw, hd) => {
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => new THREE.Vector3(x + a * hw, 0.15, z + b * hd));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  };
  for (const o of arena.obstacles) {
    if (o.shape === 'circle') ring(o.x, o.z, o.r);
    else rect(o.x, o.z, o.hw, o.hd);
  }
  rect(0, 0, arena.half, arena.half);
  for (const c of world.crates) ring(c.x, c.z, TUNING.crateR);
  for (const f of world.fruit) ring(f.x, f.z, TUNING.fruitR);
  group.renderOrder = 10;
  group.visible = false;
  scene.add(group);
  return group;
}
