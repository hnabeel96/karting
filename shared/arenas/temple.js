// Temple Courtyard: the first arena.
// Pure data, shared by the client (to draw it) and the server (to simulate it).
// Coordinates are metres on the ground plane: +x is east, +z is north.
// Shapes: circle {x, z, r} or axis-aligned box {x, z, hw, hd} (half-width / half-depth).

export default {
  id: 'temple',
  name: 'Temple Courtyard',
  half: 46, // outer walls sit at x = ±46 and z = ±46

  // Spawn points on the outer lane, all facing the same way round the courtyard.
  spawns: [Math.PI, 0, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, -Math.PI / 4, Math.PI / 4, (-3 * Math.PI) / 4].map(
    (a) => ({
      x: +(39 * Math.sin(a)).toFixed(3),
      z: +(39 * Math.cos(a)).toFixed(3),
      yaw: Math.atan2(-Math.cos(a), Math.sin(a)),
    }),
  ),

  obstacles: [
    // The stepped temple in the middle
    { kind: 'temple', shape: 'box', x: 0, z: 0, hw: 6, hd: 6 },

    // Broken ruin walls that turn the ring around the temple into a track
    { kind: 'ruin', shape: 'box', x: 0, z: 25, hw: 5, hd: 1.2 },
    { kind: 'ruin', shape: 'box', x: 0, z: -25, hw: 5, hd: 1.2 },
    { kind: 'ruin', shape: 'box', x: 25, z: 0, hw: 1.2, hd: 5 },
    { kind: 'ruin', shape: 'box', x: -25, z: 0, hw: 1.2, hd: 5 },

    // Stone pillars on the diagonals
    { kind: 'pillar', shape: 'circle', x: 20, z: 20, r: 1.4 },
    { kind: 'pillar', shape: 'circle', x: -20, z: 20, r: 1.4 },
    { kind: 'pillar', shape: 'circle', x: 20, z: -20, r: 1.4 },
    { kind: 'pillar', shape: 'circle', x: -20, z: -20, r: 1.4 },

    // Palms near the walls
    { kind: 'palm', shape: 'circle', x: -37, z: -37, r: 0.7 },
    { kind: 'palm', shape: 'circle', x: 37, z: -37, r: 0.7 },
    { kind: 'palm', shape: 'circle', x: -37, z: 37, r: 0.7 },
    { kind: 'palm', shape: 'circle', x: 37, z: 37, r: 0.7 },
    { kind: 'palm', shape: 'circle', x: -39, z: 10, r: 0.7 },
    { kind: 'palm', shape: 'circle', x: 39, z: -10, r: 0.7 },
    { kind: 'palm', shape: 'circle', x: 10, z: 39, r: 0.7 },
    { kind: 'palm', shape: 'circle', x: -10, z: -39, r: 0.7 },

    // Boulders
    { kind: 'rock', shape: 'circle', x: 31, z: 21, r: 1.7 },
    { kind: 'rock', shape: 'circle', x: -31, z: -21, r: 1.7 },
    { kind: 'rock', shape: 'circle', x: -21, z: 33, r: 1.5 },
    { kind: 'rock', shape: 'circle', x: 21, z: -33, r: 1.5 },
  ],

  // Breakable crates. Later these hand out weapons.
  crates: [
    [-2.6, -33], [0, -33], [2.6, -33],
    [-2.6, 33], [0, 33], [2.6, 33],
    [33, -2.6], [33, 0], [33, 2.6],
    [-33, -2.6], [-33, 0], [-33, 2.6],
    [12, 12], [-12, -12],
  ],

  // Mango pickups, laid out as straight lines. Ten of them power you up.
  fruitLines: [
    { from: [-12, 15], to: [12, 15], count: 7 },
    { from: [-12, -15], to: [12, -15], count: 7 },
    { from: [15, -12], to: [15, 12], count: 7 },
    { from: [-15, -12], to: [-15, 12], count: 7 },
    { from: [-41, -29], to: [-29, -41], count: 5 },
    { from: [41, -29], to: [29, -41], count: 5 },
    { from: [-41, 29], to: [-29, 41], count: 5 },
    { from: [41, 29], to: [29, 41], count: 5 },
  ],
};
