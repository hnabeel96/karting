// Turns a handful of control points into a race track: a smooth centre line,
// wall segments on both sides, timing gates and a starting grid.
// Pure maths, shared by the server (collisions, laps) and the client (drawing).

/** Smooth closed loop through the control points, resampled every `spacing` metres. */
export function smoothLoop(control, spacing = 4) {
  const n = control.length;
  const raw = [];
  const SUB = 24;
  for (let i = 0; i < n; i++) {
    const p0 = control[(i - 1 + n) % n];
    const p1 = control[i];
    const p2 = control[(i + 1) % n];
    const p3 = control[(i + 2) % n];
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  // resample by arc length so points are evenly spaced
  const cum = [0];
  for (let i = 1; i <= raw.length; i++) {
    const a = raw[i - 1];
    const b = raw[i % raw.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const count = Math.max(8, Math.round(total / spacing));
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const d = (k / count) * total;
    while (cum[j + 1] < d) j++;
    const a = raw[j];
    const b = raw[(j + 1) % raw.length];
    const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t });
  }
  return { points: out, length: total };
}

/**
 * @param control   [[x, z], ...] closed loop, in driving order
 * @param width     drivable width in metres
 * @param gateCount timing gates (gate 0 is the start/finish line, at control[0])
 */
export function buildTrack({ control, width = 16, spacing = 4, wallThick = 0.6, gateCount = 12 }) {
  const { points, length } = smoothLoop(control, spacing);
  const n = points.length;
  const center = points.map((p, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / tl;
    const tz = (b.z - a.z) / tl;
    // left of the driving direction (with yaw = atan2(tx, tz), screen-left is +normal)
    return { x: p.x, z: p.z, tx, tz, nx: tz, nz: -tx, yaw: Math.atan2(tx, tz) };
  });

  const off = width / 2 + wallThick;
  const side = (sign) => center.map((c) => ({ x: c.x + c.nx * off * sign, z: c.z + c.nz * off * sign }));
  const left = side(1);
  const right = side(-1);
  const walls = [];
  for (const [edge, name] of [[left, 'left'], [right, 'right']]) {
    for (let i = 0; i < n; i++) {
      const a = edge[i];
      const b = edge[(i + 1) % n];
      walls.push({ kind: 'trackwall', side: name, shape: 'seg', x1: a.x, z1: a.z, x2: b.x, z2: b.z, r: wallThick });
    }
  }

  const gates = [];
  const half = width / 2 + 1.5;
  for (let g = 0; g < gateCount; g++) {
    const i = Math.round((g * n) / gateCount) % n;
    const c = center[i];
    gates.push({
      index: i,
      x1: c.x + c.nx * half,
      z1: c.z + c.nz * half,
      x2: c.x - c.nx * half,
      z2: c.z - c.nz * half,
      mx: c.x,
      mz: c.z,
      tx: c.tx,
      tz: c.tz,
    });
  }

  return { center, left, right, walls, gates, width, length };
}

/** Starting grid: pairs of slots behind the start line, staggered left and right. */
export function gridSpawns(track, slots = 8, { first = 7, rowGap = 6, lane = 0.22 } = {}) {
  const { center, width } = track;
  const n = center.length;
  const step = track.length / n;
  const out = [];
  for (let s = 0; s < slots; s++) {
    const back = first + Math.floor(s / 2) * rowGap + (s % 2) * rowGap * 0.5;
    const i = (n - Math.round(back / step)) % n;
    const c = center[i];
    const lat = (s % 2 ? -1 : 1) * width * lane;
    out.push({ x: c.x + c.nx * lat, z: c.z + c.nz * lat, yaw: c.yaw });
  }
  return out;
}

/** Points along the centre line between two fractions of a lap (0..1), for laying out pickups. */
export function alongTrack(track, from, to, count, lateral = 0) {
  const n = track.center.length;
  const out = [];
  for (let k = 0; k < count; k++) {
    const f = count === 1 ? from : from + ((to - from) * k) / (count - 1);
    const c = track.center[Math.round(f * n) % n];
    out.push({ x: c.x + c.nx * lateral, z: c.z + c.nz * lateral });
  }
  return out;
}

/** A row of points straight across the track at fraction f of a lap. */
export function acrossTrack(track, f, count, spread = 0.7) {
  const n = track.center.length;
  const c = track.center[Math.round(f * n) % n];
  const out = [];
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0 : (k / (count - 1) - 0.5) * 2;
    const lat = t * (track.width / 2) * spread;
    out.push({ x: c.x + c.nx * lat, z: c.z + c.nz * lat });
  }
  return out;
}
