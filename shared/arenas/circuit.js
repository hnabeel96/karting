// Temple Circuit: the courtyard's big brother, shaped as a race track.
// A long start straight, a fast sweeper, a chicane, a tight hairpin at the top,
// and a twisty run home past the old ruins. Three laps.

import { defineTrack } from '../defineTrack.js';

export default defineTrack({
  id: 'circuit',
  name: 'Temple Circuit',
  laps: 3,
  width: 16,
  half: 96,

  // the road, in driving order; the first point is the start/finish line
  control: [
    [-10, -71], // start, heading east
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
  ],

  // rows of crates across the road, at these fractions of a lap
  crates: [0.22, 0.47, 0.76],

  // mango trails: from/to are fractions of a lap, lateral is metres left (+) or right (-)
  mangoes: [
    { from: 0.03, to: 0.1, count: 6, lateral: -4 },
    { from: 0.27, to: 0.35, count: 7, lateral: 4 },
    { from: 0.52, to: 0.57, count: 5, lateral: 0 },
    { from: 0.66, to: 0.72, count: 6, lateral: -4 },
    { from: 0.9, to: 0.96, count: 6, lateral: 3 },
  ],

  // things on the road you have to steer round
  hazards: [
    { kind: 'pillar', at: 0.12, lateral: 0 },
    { kind: 'rock', at: 0.6, lateral: 3.5 },
    { kind: 'pillar', at: 0.87, lateral: -3.5 },
  ],

  // hand-placed scenery (never collides)
  landmarks: [
    { kind: 'temple', x: 0, z: -10, scale: 2.2 },
    { kind: 'ruin', x: -24, z: -10, hw: 1.2, hd: 8 },
    { kind: 'ruin', x: 24, z: -10, hw: 1.2, hd: 8 },
    { kind: 'ruin', x: 0, z: 14, hw: 8, hd: 1.2 },
    { kind: 'pillar', x: -20, z: -32, r: 1.6 },
    { kind: 'pillar', x: 20, z: -32, r: 1.6 },
    { kind: 'pillar', x: -20, z: 12, r: 1.6 },
    { kind: 'pillar', x: 20, z: 12, r: 1.6 },
  ],

  // scattered scenery, kept off the road; change seed for a different arrangement
  scenery: [
    { kind: 'palm', count: 46, seed: 3 },
    { kind: 'rock', count: 16, seed: 9, gap: 5, r: 1.6 },
    { kind: 'pillar', count: 10, seed: 17, r: 1.4 },
  ],
  keepClear: [{ x: 0, z: -10, r: 22 }], // the temple plaza
});
