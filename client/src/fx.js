// Particles, skid marks, debris and shockwaves. All pooled: nothing is allocated mid-game.

import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float a = smoothstep(1.0, uSoft, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

/** A pool of round point particles. */
export class Particles {
  constructor(scene, max, { additive = false, soft = 0.4 } = {}) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.p = Array.from({ length: max }, () => ({
      life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      s0: 1, s1: 1, a0: 1, g: 0, drag: 0, r: 1, gr: 1, b: 1, floor: true,
    }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 }, uSoft: { value: soft } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.cursor = 0;
    this.c = new THREE.Color();
  }
  setScale(v) {
    this.mat.uniforms.uScale.value = v;
  }
  /** opts: x y z vx vy vz life size size1 color alpha gravity drag */
  emit(o) {
    const p = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.life = p.max = o.life ?? 0.6;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.s0 = o.size ?? 0.5;
    p.s1 = o.size1 ?? p.s0;
    p.a0 = o.alpha ?? 1;
    p.g = o.gravity ?? 0;
    p.drag = o.drag ?? 1;
    p.floor = o.floor ?? true;
    this.c.set(o.color ?? '#ffffff');
    p.r = this.c.r; p.gr = this.c.g; p.b = this.c.b;
  }
  update(dt) {
    let n = 0;
    for (const p of this.p) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.g * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor && p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; }
      const t = 1 - p.life / p.max;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 3] = p.r; this.col[n * 3 + 1] = p.gr; this.col[n * 3 + 2] = p.b;
      this.size[n] = p.s0 + (p.s1 - p.s0) * t;
      this.alpha[n] = p.a0 * (1 - t * t);
      n++;
    }
    this.n = n;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) g.attributes[name].needsUpdate = true;
  }
}

/** Dark tyre streaks left on the ground while drifting. */
export class SkidMarks {
  constructor(scene, max = 600) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.32, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#3a2a1c', transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, hidden);
    scene.add(this.mesh);
    this.i = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }
  /** a segment from a to b (Vector3s on the ground) */
  add(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 3) return;
    this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
    this.v.set((a.x + b.x) / 2, 0.025, (a.z + b.z) / 2);
    this.s.set(1, 1, len);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(this.i, this.m);
    this.i = (this.i + 1) % this.max;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Splinters that bounce on the ground, then shrink away. */
export class Debris {
  constructor(scene, max = 80) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ flatShading: true }),
      max,
    );
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    const white = new THREE.Color('#ffffff');
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, white);
    scene.add(this.mesh);
    this.items = Array.from({ length: max }, () => ({
      life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, sx: 1, sy: 1, sz: 1,
    }));
    this.i = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
  }
  burst(x, y, z, vx, vz, colors, count = 14, rnd = Math.random) {
    for (let k = 0; k < count; k++) {
      const d = this.items[this.i];
      this.mesh.setColorAt(this.i, this.c.set(colors[k % colors.length]));
      this.i = (this.i + 1) % this.items.length;
      const a = rnd() * Math.PI * 2;
      const sp = 3 + rnd() * 7;
      d.life = 1.6 + rnd() * 0.8;
      d.x = x + (rnd() - 0.5); d.y = y + rnd() * 0.8; d.z = z + (rnd() - 0.5);
      d.vx = Math.sin(a) * sp + vx * 0.6; d.vy = 5 + rnd() * 7; d.vz = Math.cos(a) * sp + vz * 0.6;
      d.rx = rnd() * 6; d.ry = rnd() * 6; d.rz = rnd() * 6;
      d.wx = (rnd() - 0.5) * 18; d.wy = (rnd() - 0.5) * 18; d.wz = (rnd() - 0.5) * 18;
      const plank = rnd() < 0.6;
      d.sx = plank ? 0.5 + rnd() * 0.4 : 0.22 + rnd() * 0.2;
      d.sy = plank ? 0.12 : 0.25 + rnd() * 0.2;
      d.sz = plank ? 0.25 : 0.25 + rnd() * 0.25;
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    this.items.forEach((d, i) => {
      if (d.life <= 0) {
        this.s.set(0, 0, 0);
      } else {
        d.life -= dt;
        d.vy -= 26 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.y < d.sy / 2) {
          d.y = d.sy / 2;
          d.vy = Math.abs(d.vy) > 2 ? -d.vy * 0.35 : 0;
          d.vx *= 0.7; d.vz *= 0.7;
          d.wx *= 0.6; d.wy *= 0.6; d.wz *= 0.6;
        }
        d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
        const k = Math.min(1, d.life / 0.4);
        this.s.set(d.sx * k, d.sy * k, d.sz * k);
      }
      this.e.set(d.rx, d.ry, d.rz);
      this.q.setFromEuler(this.e);
      this.v.set(d.x, d.y, d.z);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Flat rings that expand and fade on the ground (boosts, bonks, landings). */
export class Rings {
  constructor(scene, max = 8) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2);
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      this.items.push({ m, life: 0, max: 1, r0: 1, r1: 4, a: 1 });
    }
    this.i = 0;
  }
  spawn(x, y, z, color, { r0 = 0.5, r1 = 5, life = 0.45, alpha = 0.9 } = {}) {
    const it = this.items[this.i];
    this.i = (this.i + 1) % this.items.length;
    it.m.position.set(x, y, z);
    it.m.material.color.set(color);
    it.life = it.max = life;
    it.r0 = r0;
    it.r1 = r1;
    it.a = alpha;
    it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      const t = 1 - Math.max(0, it.life) / it.max;
      const e = 1 - (1 - t) * (1 - t);
      const r = it.r0 + (it.r1 - it.r0) * e;
      it.m.scale.set(r, 1, r);
      it.m.material.opacity = it.a * (1 - t);
      if (it.life <= 0) it.m.visible = false;
    }
  }
}
