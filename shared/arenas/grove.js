// Mango Grove: a twisty run through a mango orchard in the late-afternoon sun.
// Red-earth road, clipped hedges, lawns and heavy mango trees.
// A short sprint off the line, an S through the middle of the grove, a looping
// right-hander at the top, and a fast sweep home. Shorter than the circuit, so 4 laps.

import { defineTrack } from '../defineTrack.js';

export default defineTrack({
  id: 'grove',
  name: 'Mango Grove',
  theme: 'grove',
  laps: 4,
  width: 15,

  control: [
    [-24, -63], // start, heading east
    [20, -62],
    [52, -48],
    [58, -20],
    [40, -2], // the S starts
    [14, 2],
    [4, 20],
    [18, 40],
    [48, 44],
    [62, 64], // top loop
    [44, 84],
    [0, 82],
    [-30, 70],
    [-42, 44],
    [-40, 18],
    [-60, -2],
    [-68, -30],
    [-60, -56],
  ],

  crates: [0.2, 0.45, 0.7],
  mangoes: [
    { from: 0.04, to: 0.12, count: 7, lateral: 3 },
    { from: 0.3, to: 0.38, count: 6, lateral: -3 },
    { from: 0.55, to: 0.62, count: 6, lateral: 0 },
    { from: 0.82, to: 0.9, count: 7, lateral: 4 },
  ],
  hazards: [
    { kind: 'rock', at: 0.25, lateral: -3 },
    { kind: 'rock', at: 0.5, lateral: 3 },
    { kind: 'pillar', at: 0.78, lateral: 0 },
  ],
  landmarks: [
    // the old orchard keeper's patch in the middle
    { kind: 'mangotree', x: -18, z: 26, r: 2.4 },
    { kind: 'bush', x: -24, z: 18, r: 1.4 },
    { kind: 'bush', x: -11, z: 19, r: 1.2 },
    { kind: 'mangotree', x: -18, z: -28, r: 2.2 },
  ],
  scenery: [
    { kind: 'mangotree', count: 44, seed: 21, gap: 8 },
    { kind: 'bush', count: 40, seed: 8, gap: 4, r: 1.3 },
    { kind: 'palm', count: 8, seed: 4, gap: 6 },
    { kind: 'rock', count: 6, seed: 5, gap: 5, r: 1.2 },
  ],
  keepClear: [{ x: -18, z: 24, r: 10 }],
});
