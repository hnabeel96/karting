// Draws an arena from its shared data file. Static scenery is batched into a
// couple of meshes so phones stay at 60fps. Crates and mangoes are live objects.

import * as THREE from 'three';
import { StaticBatch, canvasTexture, seeded, toon, Spring } from './util.js';
import { ModelInstances, modelBox, placement } from './models.js';

export const PALETTE = {
  sky: '#7cc8f2',
  skyTop: '#3a9ae0',
  haze: '#bfe6e8',
  grass: '#4f9a3a',
  grassDark: '#3b7d2c',
  sand: '#e8c48a',
  sandDark: '#cfa468',
  grout: '#a87e4b',
  stone: '#a59c88',
  stoneDark: '#7d7564',
  stoneLight: '#c6bea8',
  moss: '#5f8f34',
  leaf: '#3f9a35',
  leafDark: '#2c7a2a',
  trunk: '#8a5a33',
  wood: '#c07a37',
  woodDark: '#7a4519',
  gold: '#ffc23d',
  mango: '#ffa424',
  mangoRed: '#ff5d2a',
};

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export function buildSky(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.haze, 80, 260);

  const tex = canvasTexture(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, PALETTE.skyTop);
    grd.addColorStop(0.42, PALETTE.sky);
    grd.addColorStop(0.5, PALETTE.haze);
    grd.addColorStop(1, PALETTE.haze);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 12),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -1;
  scene.add(dome);

  // a few chunky clouds
  const rnd = seeded(7);
  const clouds = new StaticBatch();
  const puff = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.4;
    const r = 230 + rnd() * 60;
    const cx = Math.sin(a) * r;
    const cz = Math.cos(a) * r;
    const cy = 70 + rnd() * 40;
    for (let j = 0; j < 4; j++) {
      const s = 10 + rnd() * 9;
      clouds.add(puff, '#ffffff', [cx + (j - 1.5) * 12 + rnd() * 4, cy + rnd() * 5, cz + rnd() * 6], [rnd(), rnd(), 0], [s * 1.3, s * 0.7, s]);
    }
  }
  const cm = clouds.build(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  scene.add(cm);
}

export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight('#dff4ff', '#7a9a45', 1.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d4', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -24;
  sc.right = 24;
  sc.top = 24;
  sc.bottom = -24;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  return {
    sun,
    offset: new THREE.Vector3(-22, 38, -14),
    follow(x, z) {
      // snap to shadow texels so shadows do not shimmer while moving
      const step = 48 / 1024;
      const sx = Math.round(x / step) * step;
      const sz = Math.round(z / step) * step;
      sun.position.set(sx + this.offset.x, this.offset.y, sz + this.offset.z);
      sun.target.position.set(sx, 0, sz);
    },
  };
}

function floorTexture(repeat = 7) {
  const rnd = seeded(3);
  return canvasTexture(
    512,
    512,
    (g, w, h) => {
      g.fillStyle = PALETTE.grout;
      g.fillRect(0, 0, w, h);
      const n = 8;
      const t = w / n;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const off = y % 2 ? t / 2 : 0;
          const shade = 0.88 + rnd() * 0.14;
          const base = new THREE.Color(PALETTE.sand).multiplyScalar(shade);
          g.fillStyle = '#' + base.getHexString();
          g.fillRect(x * t + off + 3, y * t + 3, t - 6, t - 6);
          if (off) g.fillRect(-t / 2 + 3, y * t + 3, t - 6, t - 6);
          // a crack here and there
          if (rnd() < 0.18) {
            g.strokeStyle = 'rgba(120,85,45,0.55)';
            g.lineWidth = 2;
            g.beginPath();
            let cx = x * t + off + rnd() * t;
            let cy = y * t + rnd() * t;
            g.moveTo(cx, cy);
            for (let k = 0; k < 4; k++) {
              cx += (rnd() - 0.5) * 22;
              cy += (rnd() - 0.5) * 22;
              g.lineTo(cx, cy);
            }
            g.stroke();
          }
          // moss creeping in the grout
          if (rnd() < 0.22) {
            g.fillStyle = 'rgba(95,143,52,0.55)';
            for (let k = 0; k < 6; k++) {
              g.beginPath();
              g.arc(x * t + off + (rnd() < 0.5 ? 2 : t - 2), y * t + rnd() * t, 3 + rnd() * 5, 0, Math.PI * 2);
              g.fill();
            }
          }
        }
      }
    },
    { repeat },
  );
}

function grassTexture() {
  const rnd = seeded(11);
  return canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = PALETTE.grass;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(59,125,44,0.6)' : 'rgba(120,180,70,0.45)';
        g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 5 + rnd() * 6);
      }
    },
    { repeat: 40 },
  );
}

function dirtTexture() {
  const rnd = seeded(5);
  return canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#b98a52';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        const v = rnd();
        g.fillStyle = v < 0.5 ? 'rgba(140,98,55,0.5)' : 'rgba(214,174,120,0.5)';
        g.beginPath();
        g.arc(rnd() * w, rnd() * h, 1 + rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
    },
    { repeat: 6 },
  );
}

function crateTexture() {
  return canvasTexture(256, 256, (g, w) => {
    // planks
    g.fillStyle = PALETTE.wood;
    g.fillRect(0, 0, w, w);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#c98543' : '#b56f2f';
      g.fillRect(0, i * 64 + 2, w, 60);
      g.strokeStyle = 'rgba(90,50,20,0.35)';
      g.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(10 + k * 80, i * 64 + 18 + k * 9);
        g.bezierCurveTo(60 + k * 80, i * 64 + 10, 80 + k * 80, i * 64 + 40, 120 + k * 80, i * 64 + 30);
        g.stroke();
      }
    }
    // frame
    g.strokeStyle = PALETTE.woodDark;
    g.lineWidth = 26;
    g.strokeRect(13, 13, w - 26, w - 26);
    // nails
    g.fillStyle = '#4b3a2c';
    for (const [x, y] of [[13, 13], [w - 13, 13], [13, w - 13], [w - 13, w - 13]]) {
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
    // stamped sun emblem
    g.save();
    g.translate(w / 2, w / 2);
    g.fillStyle = '#ffd36b';
    g.strokeStyle = PALETTE.woodDark;
    g.lineWidth = 6;
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      g.beginPath();
      g.moveTo(0, -38);
      g.lineTo(12, -66);
      g.lineTo(-12, -66);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, 36, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = PALETTE.woodDark;
    g.beginPath();
    g.arc(-11, -6, 5, 0, Math.PI * 2);
    g.arc(11, -6, 5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.lineWidth = 5;
    g.arc(0, 4, 14, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    g.restore();
  });
}

// ---------------------------------------------------------------- props

function addPalm(b, x, z, rnd) {
  const lean = (rnd() - 0.5) * 0.5;
  const leanDir = rnd() * Math.PI * 2;
  let px = x;
  let pz = z;
  let py = 0;
  const L = 1.5;
  const seg = new THREE.CylinderGeometry(0.28, 0.36, L, 6);
  const dx = Math.sin(leanDir);
  const dz = Math.cos(leanDir);
  for (let i = 0; i < 5; i++) {
    const tilt = lean * ((i + 1) / 5); // the trunk curves more toward the top
    const ux = dx * Math.sin(tilt);
    const uy = Math.cos(tilt);
    const uz = dz * Math.sin(tilt);
    const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ux, uy, uz));
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px + (ux * L) / 2, py + (uy * L) / 2, pz + (uz * L) / 2),
      rot,
      new THREE.Vector3(1 - i * 0.07, 1, 1 - i * 0.07),
    );
    b.addMatrix(seg, i % 2 ? PALETTE.trunk : '#9c6a3c', m);
    px += ux * L * 0.96;
    py += uy * L * 0.96;
    pz += uz * L * 0.96;
  }
  const leaf = box(0.9, 0.08, 3.4);
  leaf.translate(0, 0, 1.6);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.3;
    const e = new THREE.Euler(0.45 + rnd() * 0.25, a, 0, 'YXZ');
    b.add(leaf, i % 2 ? PALETTE.leaf : PALETTE.leafDark, [px, py + 0.1, pz], e);
  }
  const nut = new THREE.IcosahedronGeometry(0.28, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(nut, '#6b4423', [px + Math.sin(a) * 0.35, py - 0.25, pz + Math.cos(a) * 0.35]);
  }
}

function addPillar(b, o, rnd) {
  const broken = rnd() < 0.35;
  const h = broken ? 2.6 + rnd() : 5;
  b.add(box(o.r * 2.4, 0.6, o.r * 2.4), PALETTE.stoneDark, [o.x, 0.3, o.z]);
  b.add(new THREE.CylinderGeometry(o.r * 0.95, o.r, h, 8), PALETTE.stone, [o.x, 0.6 + h / 2, o.z], [0, rnd(), 0]);
  if (!broken) {
    b.add(box(o.r * 2.5, 0.7, o.r * 2.5), PALETTE.stoneLight, [o.x, 0.6 + h + 0.35, o.z]);
    b.add(box(o.r * 2.1, 0.2, o.r * 2.1), PALETTE.moss, [o.x, 0.6 + h + 0.8, o.z]);
  } else {
    // fallen chunk lying beside it
    b.add(new THREE.CylinderGeometry(o.r * 0.9, o.r * 0.9, 1.6, 8), PALETTE.stoneDark, [o.x + 2.6, 0.9, o.z - 1.2], [0, 0.8, Math.PI / 2]);
  }
}

function addRuin(b, o, rnd) {
  const along = o.hw > o.hd ? 'x' : 'z';
  const len = (along === 'x' ? o.hw : o.hd) * 2;
  const thick = (along === 'x' ? o.hd : o.hw) * 2;
  const n = Math.round(len / 2);
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + 1 + i * 2;
    const h = 1.2 + rnd() * 2.2;
    const x = along === 'x' ? o.x + t : o.x;
    const z = along === 'x' ? o.z : o.z + t;
    const w = along === 'x' ? 1.96 : thick;
    const d = along === 'x' ? thick : 1.96;
    b.add(box(w, h, d), rnd() < 0.5 ? PALETTE.stone : PALETTE.stoneLight, [x, h / 2, z]);
    if (rnd() < 0.5) b.add(box(w * 0.9, 0.16, d * 0.9), PALETTE.moss, [x, h + 0.08, z]);
  }
}

function addTemple(batch, o) {
  // draw at size 1 around (o.x, o.z), scaled by o.scale
  const k = o.scale || 1;
  const b = {
    add: (g, c, p = [0, 0, 0], r, sc = 1) => {
      const scl = typeof sc === 'number' ? [sc * k, sc * k, sc * k] : sc.map((v) => v * k);
      batch.add(g, c, [o.x + (p[0] - o.x) * k, p[1] * k, o.z + (p[2] - o.z) * k], r, scl);
    },
  };
  const tiers = [12, 10, 8, 6];
  let y = 0;
  tiers.forEach((s, i) => {
    b.add(box(s, 1.3, s), i % 2 ? PALETTE.stoneLight : PALETTE.stone, [o.x, y + 0.65, o.z]);
    b.add(box(s + 0.1, 0.18, s + 0.1), PALETTE.moss, [o.x, y + 1.3, o.z]);
    y += 1.3;
  });
  // shrine
  b.add(box(3.8, 2.6, 3.8), PALETTE.stoneDark, [o.x, y + 1.3, o.z]);
  b.add(box(4.6, 0.5, 4.6), PALETTE.stone, [o.x, y + 2.85, o.z]);
  b.add(box(1.4, 1.8, 0.1), '#2a2018', [o.x, y + 0.9, o.z - 1.92]);
  b.add(box(1.4, 1.8, 0.1), '#2a2018', [o.x, y + 0.9, o.z + 1.92]);
  // stairs on two sides
  for (let i = 0; i < 4; i++) {
    const s = 1.3 * (i + 1);
    b.add(box(3, s, 1.4), PALETTE.stoneLight, [o.x, s / 2, o.z - 6.7 + i * 1.0]);
    b.add(box(3, s, 1.4), PALETTE.stoneLight, [o.x, s / 2, o.z + 6.7 - i * 1.0]);
  }
  // hanging vines
  const vine = box(0.18, 1, 0.18);
  for (let i = 0; i < 14; i++) {
    const side = i % 4;
    const t = ((i * 37) % 10) / 10 - 0.5;
    const s = 6.05;
    const x = side < 2 ? t * 10 : side === 2 ? s : -s;
    const z = side < 2 ? (side === 0 ? s : -s) : t * 10;
    const len = 0.6 + ((i * 53) % 7) * 0.18;
    b.add(vine, PALETTE.leafDark, [o.x + x, 1.3 - len / 2 + 0.1, o.z + z], [0, 0, 0], [1, len, 1]);
  }
  return (y + 3.1) * k; // top of the shrine, where the idol sits
}

function addRock(b, o, rnd) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  b.add(g, PALETTE.stoneDark, [o.x, o.r * 0.55, o.z], [rnd(), rnd(), rnd()], [o.r * 1.15, o.r * 0.9, o.r * 1.05]);
  b.add(g, PALETTE.stone, [o.x + o.r * 0.5, o.r * 0.3, o.z - o.r * 0.4], [rnd(), rnd(), rnd()], [o.r * 0.6, o.r * 0.5, o.r * 0.6]);
}

function addWalls(b, half, rnd) {
  const block = box(2, 1, 2);
  for (let side = 0; side < 4; side++) {
    for (let i = -half; i <= half; i += 2) {
      const h = 1.9 + rnd() * 0.7;
      const x = side < 2 ? i : side === 2 ? half + 1 : -half - 1;
      const z = side < 2 ? (side === 0 ? half + 1 : -half - 1) : i;
      const shade = rnd();
      b.add(block, shade < 0.33 ? PALETTE.stone : shade < 0.66 ? PALETTE.stoneLight : PALETTE.stoneDark, [x, h / 2, z], [0, 0, 0], [0.98, h, 0.98]);
      if (rnd() < 0.3) b.add(block, PALETTE.moss, [x, h + 0.08, z], [0, 0, 0], [0.9, 0.16, 0.9]);
    }
  }
  // corner towers with a gold cap
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = x * (half + 1);
    const cz = z * (half + 1);
    b.add(box(4.4, 5, 4.4), PALETTE.stoneDark, [cx, 2.5, cz]);
    b.add(box(5, 0.6, 5), PALETTE.stone, [cx, 5.3, cz]);
    b.add(new THREE.ConeGeometry(1.6, 2.4, 4), PALETTE.gold, [cx, 6.8, cz], [0, Math.PI / 4, 0]);
  }
  // torches every so often along the walls (small orange cubes on posts)
  for (let side = 0; side < 4; side++) {
    for (let i = -30; i <= 30; i += 20) {
      const x = side < 2 ? i : side === 2 ? half - 0.3 : -half + 0.3;
      const z = side < 2 ? (side === 0 ? half - 0.3 : -half + 0.3) : i;
      b.add(box(0.3, 2.8, 0.3), PALETTE.trunk, [x, 1.4, z]);
      b.add(box(0.7, 0.4, 0.7), PALETTE.stoneDark, [x, 2.9, z]);
    }
  }
}

function addJungle(b, half, rnd) {
  const crown = new THREE.IcosahedronGeometry(1, 0);
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 1, 5);
  const greens = [PALETTE.leaf, PALETTE.leafDark, '#4aa83c', '#2f8a3a', '#5aa63a'];
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const r = half + 8 + Math.pow(rnd(), 0.8) * 70;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const s = 3 + rnd() * 4.5;
    const th = s * 1.1;
    b.add(trunk, PALETTE.trunk, [x, th / 2, z], [0, 0, 0], [s * 0.25, th, s * 0.25]);
    b.add(crown, greens[i % greens.length], [x, th + s * 0.7, z], [rnd(), rnd(), rnd()], [s, s * 0.9, s]);
    if (rnd() < 0.5) b.add(crown, greens[(i + 2) % greens.length], [x + s * 0.5, th + s * 1.3, z], [rnd(), rnd(), rnd()], s * 0.65);
  }
  // bushes hugging the outside of the wall
  for (let i = 0; i < 70; i++) {
    const side = i % 4;
    const t = (rnd() - 0.5) * 2 * half;
    const x = side < 2 ? t : side === 2 ? half + 3.5 : -half - 3.5;
    const z = side < 2 ? (side === 0 ? half + 3.5 : -half - 3.5) : t;
    b.add(crown, greens[(i + 1) % greens.length], [x, 1, z], [rnd(), rnd(), 0], [2 + rnd() * 1.5, 1.6 + rnd(), 2 + rnd() * 1.5]);
  }
  // distant mountains
  const peak = new THREE.ConeGeometry(1, 1, 6);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.2;
    const r = Math.max(175, half + 110) + rnd() * 30;
    const h = 40 + rnd() * 45 + Math.max(0, half - 46) * 0.5;
    b.add(peak, rnd() < 0.5 ? '#5b8a6a' : '#6f9a72', [Math.sin(a) * r, h / 2 - 2, Math.cos(a) * r], [0, rnd(), 0], [35 + rnd() * 20, h, 35 + rnd() * 20]);
  }
}

// ---------------------------------------------------------------- race track

function trackSurface(track) {
  const { center } = track;
  const n = center.length;
  const half = track.width / 2 + 0.3;
  const pos = [];
  const uv = [];
  const idx = [];
  let dist = 0;
  for (let i = 0; i <= n; i++) {
    const c = center[i % n];
    if (i > 0) {
      const p = center[i - 1];
      dist += Math.hypot(c.x - p.x, c.z - p.z);
    }
    pos.push(c.x + c.nx * half, 0.015, c.z + c.nz * half, c.x - c.nx * half, 0.015, c.z - c.nz * half);
    uv.push(0, dist / 10, 1.6, dist / 10);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = dirtTexture();
  tex.repeat.set(1, 1);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.receiveShadow = true;
  return m;
}

function addTrackWalls(b, track, rnd) {
  const segs = track.walls;
  const piece = box(1, 1, 1);
  segs.forEach((w, i) => {
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const len = Math.hypot(dx, dz) + 0.15;
    const h = 1.05 + ((i * 7) % 5) * 0.06;
    const yaw = Math.atan2(dx, dz);
    const cx = (w.x1 + w.x2) / 2;
    const cz = (w.z1 + w.z2) / 2;
    const tone = (i * 13) % 3;
    b.add(piece, tone === 0 ? PALETTE.stone : tone === 1 ? PALETTE.stoneLight : PALETTE.stoneDark, [cx, h / 2, cz], [0, yaw, 0], [w.r * 2, h, len]);
    if ((i * 5) % 7 < 2) b.add(piece, PALETTE.moss, [cx, h + 0.06, cz], [0, yaw, 0], [w.r * 2 * 0.9, 0.12, len * 0.9]);
    // a taller post every few pieces
    if (i % 9 === 0) {
      b.add(piece, PALETTE.stoneDark, [w.x1, 0.9, w.z1], [0, yaw, 0], [1.4, 1.8, 1.4]);
      b.add(piece, PALETTE.stoneLight, [w.x1, 1.9, w.z1], [0, yaw, 0], [1.6, 0.25, 1.6]);
    }
  });
}

function addKerbs(b, track) {
  // red and cream stripes along the inside of the bends
  const { center } = track;
  const n = center.length;
  const piece = box(1, 1, 1);
  const off = track.width / 2 - 0.5;
  for (let i = 0; i < n; i++) {
    const a = center[(i - 2 + n) % n];
    const c = center[i];
    const z = center[(i + 2) % n];
    const turn = Math.atan2(Math.sin(z.yaw - a.yaw), Math.cos(z.yaw - a.yaw));
    if (Math.abs(turn) < 0.22) continue;
    const inside = turn > 0 ? 1 : -1; // turning left -> kerb on the left
    const next = center[(i + 1) % n];
    const len = Math.hypot(next.x - c.x, next.z - c.z);
    for (const sideSign of [inside, -inside]) {
      const o = sideSign === inside ? off : off;
      const x = c.x + c.nx * o * sideSign + (next.x - c.x) / 2;
      const zz = c.z + c.nz * o * sideSign + (next.z - c.z) / 2;
      b.add(piece, i % 2 ? '#e8463c' : '#fff1d6', [x, 0.04, zz], [0, c.yaw, 0], [1.1, 0.08, len]);
    }
  }
}

function startLine(scene, b, track, name) {
  const g = track.gates[0];
  const c = track.center[g.index];
  // chequered strip on the road
  const tex = canvasTexture(256, 32, (ctx, w, h) => {
    const sq = 16;
    for (let y = 0; y < h / sq; y++) for (let x = 0; x < w / sq; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#1d1726' : '#fff4dc';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  });
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(track.width + 0.6, 2).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -3 }),
  );
  strip.position.set(c.x, 0.02, c.z);
  strip.rotation.y = c.yaw + Math.PI / 2;
  strip.receiveShadow = true;
  scene.add(strip);

  // arch: two stone towers and a banner
  const span = track.width / 2 + 2.2;
  for (const sgn of [1, -1]) {
    const x = c.x + c.nx * span * sgn;
    const z = c.z + c.nz * span * sgn;
    b.add(box(1, 1, 1), PALETTE.stoneDark, [x, 3.5, z], [0, c.yaw, 0], [2.2, 7, 2.2]);
    b.add(box(1, 1, 1), PALETTE.stoneLight, [x, 7.2, z], [0, c.yaw, 0], [2.8, 0.5, 2.8]);
    b.add(new THREE.ConeGeometry(1.4, 2, 4), PALETTE.gold, [x, 8.4, z], [0, c.yaw + Math.PI / 4, 0]);
  }
  b.add(box(1, 1, 1), PALETTE.stone, [c.x, 6.4, c.z], [0, c.yaw, 0], [span * 2, 0.6, 1.2]);
  const banner = canvasTexture(512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#d9620b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3b2412';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#fff4dc';
    ctx.font = '900 56px "Lilita One", "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.toUpperCase(), w / 2, h / 2 + 3);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.4, span * 0.26), new THREE.MeshBasicMaterial({ map: banner, side: THREE.DoubleSide }));
  sign.position.set(c.x, 5.4, c.z);
  sign.rotation.y = c.yaw + Math.PI; // readable as you drive toward it
  scene.add(sign);
}

// ---------------------------------------------------------------- live objects

/**
 * Wrap a loaded model so it sits at a known size and pivot, whatever units it was made in.
 * pivot 'bottom': origin at the centre of its base. 'center': origin at its middle.
 */
function normalized(model, { size, pivot, opts }) {
  const box = modelBox(model);
  const dims = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const k = (size / Math.max(dims.x, dims.y, dims.z, 1e-6)) * (opts.scale ?? 1);
  const inner = new THREE.Group();
  inner.add(model);
  model.position.set(-centre.x, pivot === 'bottom' ? -box.min.y : -centre.y, -centre.z);
  const outer = new THREE.Group();
  outer.add(inner);
  inner.scale.setScalar(k);
  inner.rotation.y = THREE.MathUtils.degToRad(opts.rotateY ?? 0);
  inner.position.y = opts.y ?? 0;
  return outer;
}

function builtInCrate() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshLambertMaterial({ map: crateTexture() }));
  m.position.y = 0.8;
  g.add(m);
  return g;
}

function builtInMango() {
  const body = new THREE.SphereGeometry(0.5, 10, 8);
  // yellow at the top, red-orange at the bottom
  const pos = body.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#ffd23a');
  const bot = new THREE.Color(PALETTE.mangoRed);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(bot).lerp(top, pos.getY(i) + 0.5);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  body.scale(0.85, 1, 0.75);
  const leaf = new THREE.ConeGeometry(0.16, 0.5, 4);
  leaf.rotateZ(-0.9);
  leaf.translate(0.18, 0.55, 0);
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(body, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ff8a1f', emissiveIntensity: 0.25, flatShading: true })),
    new THREE.Mesh(leaf, toon('#3faa3a')),
  );
  return g;
}

export class Crates {
  constructor(scene, list, model) {
    const src = model ? normalized(model.scene, { size: 1.6, pivot: 'bottom', opts: model.opts }) : builtInCrate();
    this.inst = new ModelInstances(scene, src, list.length);
    this.items = list.map((c, i) => ({
      x: c.x,
      z: c.z,
      yaw: ((i * 0.37) % 0.5) - 0.25,
      spring: new Spring(260, 12, 1),
      alive: true,
    }));
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }
  smash(i) {
    this.items[i].alive = false;
  }
  respawn(i) {
    const it = this.items[i];
    it.alive = true;
    it.spring.x = 0;
    it.spring.v = 4;
  }
  update(dt, t) {
    this.items.forEach((it, i) => {
      const k = it.alive ? Math.max(0, it.spring.step(1, dt)) : 0;
      this.q.setFromAxisAngle(this.up, it.yaw);
      this.v.set(it.x, Math.sin(t * 2 + it.x) * 0.04, it.z);
      this.s.set(k, k, k);
      this.m.compose(this.v, this.q, this.s);
      this.inst.setMatrixAt(i, this.m);
    });
    this.inst.commit();
  }
}

export class Mangoes {
  constructor(scene, list, model) {
    const src = model ? normalized(model.scene, { size: 1, pivot: 'center', opts: model.opts }) : builtInMango();
    this.inst = new ModelInstances(scene, src, list.length, { receiveShadow: false });
    this.items = list.map((f) => ({ x: f.x, z: f.z, alive: true, spring: new Spring(240, 11, 1) }));
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }
  take(i) {
    this.items[i].alive = false;
  }
  respawn(i) {
    const it = this.items[i];
    it.alive = true;
    it.spring.x = 0;
    it.spring.v = 5;
  }
  update(dt, t) {
    this.items.forEach((it, i) => {
      const k = it.alive ? Math.max(0, it.spring.step(1, dt)) : 0;
      this.e.set(0.25, t * 2.2 + i, 0);
      this.q.setFromEuler(this.e);
      this.v.set(it.x, 1.1 + Math.sin(t * 3 + i * 0.7) * 0.18, it.z);
      this.s.set(k, k, k);
      this.m.compose(this.v, this.q, this.s);
      this.inst.setMatrixAt(i, this.m);
    });
    this.inst.commit();
  }
}

// ---------------------------------------------------------------- the whole arena

export function buildArena(scene, arena, world, models = { props: {} }) {
  const rnd = seeded(42);
  const half = arena.half;

  // ground outside the walls
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ map: grassTexture() }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  scene.add(grass);

  // tiled courtyard floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 4, half * 2 + 4), new THREE.MeshLambertMaterial({ map: floorTexture(Math.round((half * 2 + 4) / 13.7)) }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // a worn dirt ring around the temple: where everyone ends up driving
  if (!arena.track) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(10.5, 21.5, 48, 1),
    new THREE.MeshLambertMaterial({ map: dirtTexture(), transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  ring.receiveShadow = true;
  scene.add(ring);
  }

  // static scenery: one batch that casts shadows, one far batch that does not
  const near = new StaticBatch();
  const far = new StaticBatch();
  addWalls(near, half, rnd);
  let idolY = 6;
  let idolAt = { x: 0, z: 0 };
  const swapped = {}; // kind -> obstacles drawn with a model file instead
  if (arena.track) {
    scene.add(trackSurface(arena.track));
    addTrackWalls(near, arena.track, rnd);
    addKerbs(near, arena.track);
    startLine(scene, near, arena.track, arena.name);
  }
  const shaped = (o) => (o.shape ? o : { ...o, shape: o.hw ? 'box' : 'circle', r: o.r || 1 });
  const props = [...arena.obstacles.filter((o) => o.kind !== 'trackwall'), ...(arena.decor || []).map(shaped)];
  for (const o of props) {
    if (models.props[o.kind]) {
      (swapped[o.kind] ||= []).push(o);
      continue;
    }
    if (o.kind === 'temple') {
      idolY = addTemple(near, o);
      idolAt = o;
    }
    else if (o.kind === 'ruin') addRuin(near, o, rnd);
    else if (o.kind === 'pillar') addPillar(near, o, rnd);
    else if (o.kind === 'palm') addPalm(near, o.x, o.z, rnd);
    else if (o.kind === 'rock') addRock(near, o, rnd);
  }
  addJungle(far, half, rnd);

  // props replaced by model files: one instanced copy per obstacle
  for (const [kind, list] of Object.entries(swapped)) {
    const { scene: model, opts } = models.props[kind];
    const box = modelBox(model);
    const inst = new ModelInstances(scene, model, list.length);
    list.forEach((o, i) => {
      const m = placement(kind, o, opts, box, rnd);
      inst.setMatrixAt(i, m);
      // the idol floats just above whatever temple model is used
      if (kind === 'temple') {
        idolY = box.clone().applyMatrix4(m).max.y + 0.2;
        idolAt = o;
      }
    });
    inst.commit();
  }

  const nearMesh = near.build();
  nearMesh.castShadow = true;
  nearMesh.receiveShadow = true;
  scene.add(nearMesh);
  const farMesh = far.build();
  scene.add(farMesh);

  // golden idol spinning on the temple
  const idol = new THREE.Group();
  const gold = new THREE.MeshLambertMaterial({ color: PALETTE.gold, emissive: '#b8740a', emissiveIntensity: 0.5, flatShading: true });
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0), gold);
  head.position.y = 1.4;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 1, 6), gold);
  base.position.y = 0.5;
  idol.add(head, base);
  idol.position.set(idolAt.x, idolY, idolAt.z);
  idol.scale.setScalar(idolAt.scale || 1);
  scene.add(idol);

  // torch flames: little glowing cubes on top of the posts
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb02e' });
  const flames = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.35, 0), flameMat, 16);
  const flamePos = [];
  for (let side = 0; side < 4; side++) {
    for (let i = -30; i <= 30; i += 20) {
      const x = side < 2 ? i : side === 2 ? half - 0.3 : -half + 0.3;
      const z = side < 2 ? (side === 0 ? half - 0.3 : -half + 0.3) : i;
      flamePos.push([x, 3.35, z]);
    }
  }
  scene.add(flames);

  const crates = new Crates(scene, world.crates, models.props.crate);
  const mangoes = new Mangoes(scene, world.fruit, models.props.mango);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  return {
    crates,
    mangoes,
    update(dt, t) {
      crates.update(dt, t);
      mangoes.update(dt, t);
      idol.rotation.y = t * 0.6;
      idol.position.y = idolY + Math.sin(t * 1.5) * 0.15 * (idolAt.scale || 1);
      flamePos.forEach(([x, y, z], i) => {
        const k = 0.85 + Math.sin(t * 13 + i * 1.7) * 0.15 + Math.sin(t * 7.3 + i) * 0.1;
        e.set(t * 2 + i, t * 3 + i, 0);
        q.setFromEuler(e);
        v.set(x, y + Math.sin(t * 9 + i) * 0.05, z);
        s.set(k, k * 1.3, k);
        m.compose(v, q, s);
        flames.setMatrixAt(i, m);
      });
      flames.instanceMatrix.needsUpdate = true;
    },
  };
}

