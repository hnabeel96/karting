// Which 3D model files replace the built-in, code-drawn art.
//
// Leave an entry as null to keep the built-in version. To swap one in, drop a .glb
// file into this folder and point the entry at it. See README.md in this folder for
// how models must be made (size, facing direction, part names for the kart).
//
// Options for every entry:
//   file      path relative to this folder (required)
//   scale     size multiplier, default 1. Props are used at their modelled size in metres;
//             the kart, crate and mango are first resized to fit the game, then multiplied
//   rotateY   extra turn in degrees, to fix a model that faces the wrong way
//   y         lift or sink the model, in metres
//   fit       'footprint' stretches the model sideways to exactly cover its collision shape
//             (height stays as modelled, times scale)
//   randomYaw true to give each copy a random turn (default for palm, pillar, rock)
//
// Try the example models: add #examples to the game's address.

export default {
  kart: null,
  // kart: { file: 'my-kart.glb', scale: 1 },

  props: {
    temple: null,
    ruin: null,
    pillar: null,
    palm: null,
    rock: null,
    crate: null,
    mango: null,
    // palm: { file: 'palm.glb', scale: 1.2 },
    // ruin: { file: 'wall.glb', fit: 'footprint' },
  },
};
