// Draws a track as a picture and prints its vital numbers, so you can shape a new
// track without starting the game.
//   npm run track            -> every track
//   npm run track grove      -> just one
// Writes track-<id>.svg next to package.json. Open it in any browser.

import { writeFile } from 'node:fs/promises';
import { TRACKS, getTrack } from '../shared/arenas/index.js';

const wanted = process.argv[2];
const list = wanted ? [getTrack(wanted)] : TRACKS;
if (wanted && list[0].id !== wanted) {
  console.error(`No track "${wanted}". Tracks: ${TRACKS.map((t) => t.id).join(', ')}`);
  process.exit(1);
}

for (const a of list) {
  const t = a.track;
  const n = t.center.length;

  // tightest corner (radius through three nearby points)
  let tight = { r: Infinity, at: 0 };
  for (let i = 0; i < n; i++) {
    const p = t.center[(i - 2 + n) % n];
    const q = t.center[i];
    const r = t.center[(i + 2) % n];
    const area = Math.abs((q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z)) / 2;
    if (!area) continue;
    const R = (Math.hypot(q.x - p.x, q.z - p.z) * Math.hypot(r.x - q.x, r.z - q.z) * Math.hypot(p.x - r.x, p.z - r.z)) / (4 * area);
    if (R < tight.r) tight = { r: R, at: i / n, x: q.x, z: q.z };
  }
  // closest approach of two separate parts of the road
  let near = { d: Infinity };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.min(j - i, n - (j - i)) * (t.length / n) < 40) continue;
      const d = Math.hypot(t.center[i].x - t.center[j].x, t.center[i].z - t.center[j].z);
      if (d < near.d) near = { d, i, j };
    }
  }

  const ok = (b) => (b ? 'ok' : 'PROBLEM');
  console.log(`\n${a.name} (${a.id})`);
  console.log(`  length         ${Math.round(t.length)} m, ${a.laps} laps, about ${Math.round(t.length / 19)} s a lap`);
  console.log(`  tightest corner ${tight.r.toFixed(1)} m radius at ${tight.at.toFixed(2)} of a lap  ${ok(tight.r > 12)} (needs > 12)`);
  console.log(`  closest pass    ${near.d.toFixed(1)} m between road sections  ${ok(near.d > t.width + 4)} (needs > ${t.width + 4})`);
  console.log(`  pickups         ${a.crates.length} crates, ${a.fruitPoints.length} mangoes, ${a.obstacles.length - t.walls.length} hazards`);

  // ---- picture (x right, z down, like looking at the minimap)
  const H = a.half;
  const S = 4; // pixels per metre
  const X = (x) => ((x + H) * S).toFixed(1);
  const Z = (z) => ((z + H) * S).toFixed(1);
  const path = (pts) => 'M' + pts.map((p) => `${X(p.x)},${Z(p.z)}`).join('L') + 'Z';
  const parts = [];
  parts.push(`<rect width="${2 * H * S}" height="${2 * H * S}" fill="#4f8f4a"/>`);
  parts.push(`<path d="${path(t.center)}" fill="none" stroke="#c9a46a" stroke-width="${t.width * S}" stroke-linejoin="round"/>`);
  parts.push(`<path d="${path(t.left)}" fill="none" stroke="#e9e2cf" stroke-width="${S}"/>`);
  parts.push(`<path d="${path(t.right)}" fill="none" stroke="#e9e2cf" stroke-width="${S}"/>`);
  parts.push(`<path d="${path(t.center)}" fill="none" stroke="#8a6a3a" stroke-width="1" stroke-dasharray="6 8"/>`);
  for (let k = 0; k < 10; k++) {
    const c = t.center[Math.round((k / 10) * n) % n];
    parts.push(`<text x="${X(c.x + c.nx * (t.width / 2 + 5))}" y="${Z(c.z + c.nz * (t.width / 2 + 5))}" font-size="16" font-family="sans-serif" fill="#fff" text-anchor="middle" dominant-baseline="middle">${(k / 10).toFixed(1)}</text>`);
  }
  for (const d of a.decor) {
    const col = { palm: '#2f6b2a', rock: '#8a8478', pillar: '#b9ad95', temple: '#d9c7a0', ruin: '#a99a7c' }[d.kind] || '#777';
    if (d.hw) parts.push(`<rect x="${X(d.x - d.hw)}" y="${Z(d.z - d.hd)}" width="${2 * d.hw * S}" height="${2 * d.hd * S}" fill="${col}"/>`);
    else parts.push(`<circle cx="${X(d.x)}" cy="${Z(d.z)}" r="${(d.kind === 'temple' ? 8 * (d.scale || 1) : d.r || 1.5) * S}" fill="${col}"/>`);
  }
  for (const o of a.obstacles) if (o.shape === 'circle') parts.push(`<circle cx="${X(o.x)}" cy="${Z(o.z)}" r="${o.r * S}" fill="#5b3b2a" stroke="#fff" stroke-width="2"/>`);
  for (const [x, z] of a.crates) parts.push(`<rect x="${X(x - 0.7)}" y="${Z(z - 0.7)}" width="${1.4 * S}" height="${1.4 * S}" fill="#b5762f"/>`);
  for (const p of a.fruitPoints) parts.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${0.7 * S}" fill="#ffb627"/>`);
  for (const s of a.spawns) parts.push(`<circle cx="${X(s.x)}" cy="${Z(s.z)}" r="${S}" fill="#fff" stroke="#000"/>`);
  const g = t.gates[0];
  parts.push(`<line x1="${X(g.x1)}" y1="${Z(g.z1)}" x2="${X(g.x2)}" y2="${Z(g.z2)}" stroke="#fff" stroke-width="5"/>`);
  if (tight.r < 12) parts.push(`<circle cx="${X(tight.x)}" cy="${Z(tight.z)}" r="${12 * S}" fill="none" stroke="#e33" stroke-width="4"/>`);
  if (near.d < t.width + 4) {
    const p = t.center[near.i];
    const q = t.center[near.j];
    parts.push(`<line x1="${X(p.x)}" y1="${Z(p.z)}" x2="${X(q.x)}" y2="${Z(q.z)}" stroke="#e33" stroke-width="4"/>`);
  }
  parts.push(`<text x="12" y="28" font-size="22" font-family="sans-serif" font-weight="bold" fill="#fff">${a.name}: ${Math.round(t.length)} m · white line = start · numbers = fraction of a lap</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${2 * H * S} ${2 * H * S}" width="${2 * H * S}" height="${2 * H * S}">${parts.join('')}</svg>\n`;
  await writeFile(`track-${a.id}.svg`, svg);
  console.log(`  picture         track-${a.id}.svg`);
}
