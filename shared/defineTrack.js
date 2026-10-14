// Turns a short track description into everything the game needs: the road, walls,
// timing gates, starting grid, crates, mangoes, hazards and scenery.
//
// A track file is just:
//
//   import { defineTrack } from '../defineTrack.js';
//   export default defineTrack({ id: 'mytrack', name: 'My Track', control: [[x, z], ...] });
//
// Everything other than id, name and control has a sensible default. Positions along
// the track are given as fractions of a lap (0 = start line, 0.5 = halfway), and
// "lateral" is metres left (+) or right (-) of the centre line. See shared/arenas/README.md.

import { buildTrack, gridSpawns, alongTrack, acrossTrack } from './track.js';

const SCENERY_KINDS = ['palm', 'rock', 'pillar', 'mangotree', 'bush'];
const LANDMARK_KINDS = ['temple', 'ruin', ...SCENERY_KINDS];
const HAZARD_KINDS = { pillar: 1.3, rock: 1.5 };

/** deterministic random numbers (no Math.random in shared code: phones and server must agree) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function defineTrack(cfg) {
  const where = `track "${cfg && cfg.id}"`;
  if (!cfg || typeof cfg.id !== 'string' || !/^[a-z0-9-]+$/.test(cfg.id)) throw new Error('track id must be lowercase letters, digits or dashes');
  if (!cfg.name) throw new Error(`${where}: needs a name`);
  if (!Array.isArray(cfg.control) || cfg.control.length < 4) throw new Error(`${where}: needs at least 4 control points`);
  for (const p of cfg.control) if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new Error(`${where}: control points are [x, z] pairs, got ${JSON.stringify(p)}`);

  const {
    id,
    name,
    control,
    laps = 3,
    width = 16,
    gates = 16,
    crates = [0.25, 0.5, 0.75],
    cratesPerRow = 4,
    mangoes = [],
    hazards = [],
    landmarks = [],
    scenery = [],
    keepClear = [],
    theme = 'temple',
  } = cfg;
  if (typeof theme !== 'string' && (typeof theme !== 'object' || !theme)) throw new Error(`${where}: theme is a preset name like 'grove', or { preset: 'grove', ...colours }`);

  const track = buildTrack({ control, width, spacing: 4, gateCount: gates });

  // the world is a square; size it to the track unless told otherwise
  const reach = Math.max(...track.center.map((c) => Math.max(Math.abs(c.x), Math.abs(c.z))));
  const half = cfg.half || Math.ceil(reach + width / 2 + 10);

  const onRoad = (x, z, gap) => track.center.some((c) => Math.hypot(c.x - x, c.z - z) <= track.width / 2 + gap);
  const inClear = (x, z) => keepClear.some((k) => Math.hypot(x - k.x, z - k.z) < k.r);

  function scatter({ kind, count, seed = 1, gap = 6, r }) {
    if (!SCENERY_KINDS.includes(kind)) throw new Error(`${where}: scenery kind "${kind}" isn't one of ${SCENERY_KINDS.join(', ')}`);
    const rand = rng(seed);
    const out = [];
    let tries = 0;
    while (out.length < count && tries++ < count * 60) {
      const x = (rand() * 2 - 1) * (half - 6);
      const z = (rand() * 2 - 1) * (half - 6);
      if (inClear(x, z) || onRoad(x, z, gap)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 7)) continue;
      out.push({ kind, x: +x.toFixed(2), z: +z.toFixed(2), ...(r ? { r } : {}) });
    }
    return out;
  }

  const roadside = hazards.map((h) => {
    if (!(h.kind in HAZARD_KINDS)) throw new Error(`${where}: hazard kind "${h.kind}" isn't one of ${Object.keys(HAZARD_KINDS).join(', ')}`);
    const [p] = alongTrack(track, h.at, h.at, 1, h.lateral || 0);
    return { kind: h.kind, shape: 'circle', x: p.x, z: p.z, r: h.r || HAZARD_KINDS[h.kind] };
  });

  for (const l of landmarks) {
    if (!LANDMARK_KINDS.includes(l.kind)) throw new Error(`${where}: landmark kind "${l.kind}" isn't one of ${LANDMARK_KINDS.join(', ')}`);
  }

  return {
    id,
    name,
    theme, // how it looks: see client/src/themes.js
    half,
    laps,
    track,
    spawns: gridSpawns(track, 8),
    obstacles: [...track.walls, ...roadside],
    // scenery only: drawn, never collided with (the track walls keep karts away)
    decor: [...landmarks, ...scenery.flatMap(scatter)],
    crates: crates.flatMap((f) => acrossTrack(track, f, cratesPerRow, 0.75)).map((p) => [p.x, p.z]),
    fruitLines: [],
    fruitPoints: mangoes.flatMap((m) => alongTrack(track, m.from, m.to, m.count, m.lateral || 0)),
  };
}
