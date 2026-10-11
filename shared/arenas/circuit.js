// Temple Circuit: the courtyard's big brother, shaped as a race track.
// A long start straight, a fast sweeper, a chicane, a tight hairpin at the top,
// and a twisty run home past the old ruins. Three laps.
//
// The track is described by control points in driving order; shared/track.js turns
// them into a smooth road with walls, timing gates and a starting grid.

import { buildTrack, gridSpawns, alongTrack, acrossTrack } from '../track.js';

const control = [
  [-10, -71], // start / finish line, heading east
  [40, -72],
  [68, -58],
  [77, -30],
  [64, -6], // chicane in
  [72, 18],
  [70, 52],
  [46, 74],
  [14, 70],
  [4, 52], // hairpin
  [-10, 41],
  [-27, 46],
  [-36, 66],
  [-62, 74],
  [-80, 52],
  [-66, 22],
  [-80, -8],
  [-78, -44],
  [-56, -68],
];

const track = buildTrack({ control, width: 16, spacing: 4, gateCount: 16 });

// deterministic scatter for scenery (no Math.random in shared code)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HALF = 96;
const clearOfTrack = (x, z, gap) => track.center.every((c) => Math.hypot(c.x - x, c.z - z) > track.width / 2 + gap);

function scatter(kind, count, seed, gap, extra = {}) {
  const r = rng(seed);
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 60) {
    const x = (r() * 2 - 1) * (HALF - 6);
    const z = (r() * 2 - 1) * (HALF - 6);
    if (Math.hypot(x, z + 10) < 22) continue; // keep the temple plaza clear
    if (!clearOfTrack(x, z, gap)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 7)) continue;
    out.push({ kind, x: +x.toFixed(2), z: +z.toFixed(2), ...extra });
  }
  return out;
}

// things on the road that you have to steer round
const roadside = [
  ...alongTrack(track, 0.12, 0.12, 1, 0).map((p) => ({ kind: 'pillar', shape: 'circle', x: p.x, z: p.z, r: 1.3 })),
  ...alongTrack(track, 0.6, 0.6, 1, 3.5).map((p) => ({ kind: 'rock', shape: 'circle', x: p.x, z: p.z, r: 1.5 })),
  ...alongTrack(track, 0.87, 0.87, 1, -3.5).map((p) => ({ kind: 'pillar', shape: 'circle', x: p.x, z: p.z, r: 1.3 })),
];

export default {
  id: 'circuit',
  name: 'Temple Circuit',
  half: HALF,
  laps: 3,
  track,
  spawns: gridSpawns(track, 8),

  obstacles: [...track.walls, ...roadside],

  // scenery only: drawn, never collided with (the track walls keep karts away)
  decor: [
    { kind: 'temple', x: 0, z: -10, scale: 2.2 },
    { kind: 'ruin', x: -24, z: -10, hw: 1.2, hd: 8 },
    { kind: 'ruin', x: 24, z: -10, hw: 1.2, hd: 8 },
    { kind: 'ruin', x: 0, z: 14, hw: 8, hd: 1.2 },
    { kind: 'pillar', x: -20, z: -32, r: 1.6 },
    { kind: 'pillar', x: 20, z: -32, r: 1.6 },
    { kind: 'pillar', x: -20, z: 12, r: 1.6 },
    { kind: 'pillar', x: 20, z: 12, r: 1.6 },
    ...scatter('palm', 46, 3, 6),
    ...scatter('rock', 16, 9, 5, { r: 1.6 }),
    ...scatter('pillar', 10, 17, 6, { r: 1.4 }),
  ],

  // rows of crates across the road (they will hold weapons later)
  crates: [0.22, 0.47, 0.76].flatMap((f) => acrossTrack(track, f, 4, 0.75)).map((p) => [p.x, p.z]),

  // mango trails along good lines
  fruitLines: [],
  fruitPoints: [
    ...alongTrack(track, 0.03, 0.1, 6, -4),
    ...alongTrack(track, 0.27, 0.35, 7, 4),
    ...alongTrack(track, 0.52, 0.57, 5, 0),
    ...alongTrack(track, 0.66, 0.72, 6, -4),
    ...alongTrack(track, 0.9, 0.96, 6, 3),
  ],
};
