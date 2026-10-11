// Writes small blocky example .glb files into client/models/examples/.
// They show the model contract (sizes, facing, part names) and let you test swapping.
//   node scripts/make-example-models.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/models/examples');

// ------------------------------------------------------------------ geometry

function box(w, h, d, [ox, oy, oz] = [0, 0, 0]) {
  const x = w / 2, y = h / 2, z = d / 2;
  const faces = [
    [[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]],
    [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]],
    [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]],
    [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
    [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
  ];
  const pos = [], nor = [], idx = [];
  faces.forEach(([n, vs], f) => {
    for (const v of vs) { pos.push(v[0] + ox, v[1] + oy, v[2] + oz); nor.push(...n); }
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { pos, nor, idx };
}

/** cylinder lying along X (a wheel), centred on the origin */
function wheel(r, width, seg = 12) {
  const pos = [], nor = [], idx = [];
  const hw = width / 2;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const y = Math.cos(a) * r, z = Math.sin(a) * r;
    pos.push(-hw, y, z, hw, y, z);
    nor.push(0, Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a));
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  for (const side of [-1, 1]) {
    const c = pos.length / 3;
    pos.push(side * hw, 0, 0);
    nor.push(side, 0, 0);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(side * hw, Math.cos(a) * r, Math.sin(a) * r);
      nor.push(side, 0, 0);
    }
    for (let i = 0; i < seg; i++) idx.push(...(side > 0 ? [c, c + 1 + i, c + 2 + i] : [c, c + 2 + i, c + 1 + i]));
  }
  return { pos, nor, idx };
}

// ------------------------------------------------------------------ glb writer

class Gltf {
  constructor() {
    this.json = { asset: { version: '2.0', generator: 'karting example models' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
    this.chunks = [];
    this.byteLength = 0;
    this.matIndex = {};
  }
  material(name, hex, emissive) {
    if (name in this.matIndex) return this.matIndex[name];
    const c = [1, 3, 5].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2)); // sRGB -> linear
    const m = { name, pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0, roughnessFactor: 0.9 } };
    if (emissive) m.emissiveFactor = c;
    this.json.materials.push(m);
    return (this.matIndex[name] = this.json.materials.length - 1);
  }
  view(typed, target) {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.byteLength, byteLength: bytes.length, target });
    this.chunks.push(bytes, Buffer.alloc(pad));
    this.byteLength += bytes.length + pad;
    return this.json.bufferViews.length - 1;
  }
  accessor(data, type, componentType, target, minmax) {
    const typed = componentType === 5126 ? new Float32Array(data) : new Uint16Array(data);
    const n = { VEC3: 3, SCALAR: 1 }[type];
    const acc = { bufferView: this.view(typed, target), componentType, count: data.length / n, type };
    if (minmax) {
      acc.min = [0, 1, 2].map((k) => Math.min(...data.filter((_, i) => i % 3 === k)));
      acc.max = [0, 1, 2].map((k) => Math.max(...data.filter((_, i) => i % 3 === k)));
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  mesh(name, parts) {
    const primitives = parts.map(({ geo, mat }) => ({
      attributes: {
        POSITION: this.accessor(geo.pos, 'VEC3', 5126, 34962, true),
        NORMAL: this.accessor(geo.nor, 'VEC3', 5126, 34962),
      },
      indices: this.accessor(geo.idx, 'SCALAR', 5123, 34963),
      material: mat,
    }));
    this.json.meshes.push({ name, primitives });
    return this.json.meshes.length - 1;
  }
  node(spec, isRoot = true) {
    const n = { name: spec.name };
    if (spec.t) n.translation = spec.t;
    if (spec.r) n.rotation = spec.r;
    if (spec.parts) n.mesh = this.mesh(spec.name, spec.parts);
    this.json.nodes.push(n);
    const i = this.json.nodes.length - 1;
    if (spec.children) n.children = spec.children.map((c) => this.node(c, false));
    if (isRoot) this.json.scenes[0].nodes.push(i);
    return i;
  }
  toGlb() {
    const bin = Buffer.concat(this.chunks);
    this.json.buffers.push({ byteLength: bin.length });
    let json = Buffer.from(JSON.stringify(this.json));
    json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
    const jh = Buffer.alloc(8);
    jh.writeUInt32LE(json.length, 0);
    jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(bin.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jh, json, bh, bin]);
  }
}

// ------------------------------------------------------------------ the models

function kart() {
  const g = new Gltf();
  const paint = g.material('paint', '#3fae5a');
  const dark = g.material('tyre', '#2a2730');
  const suit = g.material('suit', '#2e7dd7');
  const skin = g.material('skin', '#f2c08f');
  const visor = g.material('visor', '#63d2ff');
  const trim = g.material('trim', '#fff1d6');
  const tyre = (name, t, r) => ({ name, t, parts: [{ geo: wheel(r, 0.42), mat: dark }, { geo: box(0.44, r * 0.6, r * 0.6), mat: trim }] });
  g.node({
    name: 'kart',
    children: [
      {
        name: 'body',
        t: [0, 0.55, 0],
        parts: [
          { geo: box(1.6, 0.4, 2.6), mat: paint },
          { geo: box(2.0, 0.16, 0.3, [0, -0.1, 1.4]), mat: trim },
          { geo: box(1.9, 0.12, 0.45, [0, 0.95, -1.3]), mat: paint },
          { geo: box(0.12, 0.7, 0.2, [0.6, 0.55, -1.3]), mat: dark },
          { geo: box(0.12, 0.7, 0.2, [-0.6, 0.55, -1.3]), mat: dark },
        ],
        children: [
          {
            name: 'driver',
            t: [0, 0.5, -0.2],
            parts: [{ geo: box(0.75, 0.7, 0.6, [0, 0.3, 0]), mat: suit }],
            children: [
              {
                name: 'head',
                t: [0, 0.95, 0],
                parts: [
                  { geo: box(0.85, 0.8, 0.8), mat: skin },
                  { geo: box(0.7, 0.22, 0.1, [0, 0.12, 0.42]), mat: visor },
                  { geo: box(0.95, 0.25, 0.9, [0, 0.45, 0]), mat: suit },
                ],
              },
            ],
          },
          { name: 'exhaust_l', t: [-0.32, 0.2, -1.45] },
          { name: 'exhaust_r', t: [0.32, 0.2, -1.45] },
        ],
      },
      tyre('wheel_fl', [0.98, 0.4, 1.0], 0.4),
      tyre('wheel_fr', [-0.98, 0.4, 1.0], 0.4),
      tyre('wheel_rl', [1.02, 0.5, -0.95], 0.5),
      tyre('wheel_rr', [-1.02, 0.5, -0.95], 0.5),
    ],
  });
  return g.toGlb();
}

function palm() {
  const g = new Gltf();
  const bark = g.material('bark', '#7a5233');
  const leaf = g.material('leaf', '#2fae5a');
  const parts = [];
  for (let i = 0; i < 6; i++) parts.push({ geo: box(0.55 - i * 0.04, 1.1, 0.55 - i * 0.04, [i * 0.08, 0.55 + i * 1.05, 0]), mat: bark });
  const top = [0.5, 6.6, 0];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    parts.push({ geo: box(dx ? 2.6 : 0.7, 0.14, dz ? 2.6 : 0.7, [top[0] + dx * 1.3, top[1] - 0.2, top[2] + dz * 1.3]), mat: leaf });
  }
  parts.push({ geo: box(1.2, 0.5, 1.2, top), mat: leaf });
  g.node({ name: 'palm', parts });
  return g.toGlb();
}

function crate() {
  const g = new Gltf();
  const wood = g.material('wood', '#4f7fbf');
  const band = g.material('band', '#ffc23d', true);
  g.node({
    name: 'crate',
    parts: [
      { geo: box(1, 1, 1), mat: wood },
      { geo: box(1.04, 0.16, 1.04, [0, 0.3, 0]), mat: band },
      { geo: box(1.04, 0.16, 1.04, [0, -0.3, 0]), mat: band },
    ],
  });
  return g.toGlb();
}

function wall() {
  // made long along X; with fit: 'footprint' it is stretched and turned to each ruin box
  const g = new Gltf();
  const stone = g.material('stone', '#c96a4a');
  const cap = g.material('cap', '#f0d9a8');
  const parts = [{ geo: box(4, 2.4, 1, [0, 1.2, 0]), mat: stone }];
  for (let i = 0; i < 4; i++) parts.push({ geo: box(0.7, 0.5, 1.1, [-1.5 + i, 2.65, 0]), mat: cap });
  g.node({ name: 'wall', parts });
  return g.toGlb();
}

await mkdir(OUT, { recursive: true });
const files = { 'blocky-kart.glb': kart(), 'blocky-palm.glb': palm(), 'blocky-crate.glb': crate(), 'blocky-wall.glb': wall() };
for (const [name, buf] of Object.entries(files)) {
  await writeFile(path.join(OUT, name), buf);
  console.log(name, buf.length, 'bytes');
}
