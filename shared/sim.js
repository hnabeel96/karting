// The rulebook. Runs identically on the phone (today, and later for prediction)
// and on the server (later, as the referee). No DOM, no three.js, no randomness:
// the same inputs always produce the same world.
//
// Conventions
//   yaw = 0 faces +z. Forward vector = (sin yaw, cos yaw).
//   steer: -1 = full left, +1 = full right. Turning right lowers yaw.
//   One step = TICK seconds. Call stepWorld() at a fixed rate, never with a variable dt.

export const TICK = 1 / 60;

export const TUNING = {
  radius: 1.1,

  // Driving (auto-accelerate: there is no gas pedal)
  topSpeed: 21,
  accel: 15,
  coastDecel: 7,
  turnRate: 2.3, // rad/s at full steer and full speed
  minTurnSpeed: 9, // below this speed steering is scaled down...
  slowTurn: 0.5, // ...but never below this fraction
  grip: 9, // how fast sideways sliding dies out when driving normally
  hopGrip: 3,
  driftGrip: 4.5,

  // Hop and drift
  hopTime: 0.24,
  hopHeight: 0.7,
  driftMinSteer: 0.25,
  driftMinSpeed: 7,
  driftBase: 1.45, // yaw rate while drifting with neutral steer
  driftRange: 0.95, // steering into the drift tightens it by this much, away widens it
  driftDrag: 0.96, // drifting target speed multiplier

  // Pump-boost: while drifting, a charge fills. Let go and press again (a "pump")
  // while the charge sits in the window to fire a boost. Up to 3 per drift.
  chargeTime: 0.8, // seconds for charge to go 0 -> 1
  windowLo: 0.7,
  windowHi: 1.0,
  chargeMax: 1.35, // past windowHi the kart overheats until you pump or let go
  pumpGrace: 0.16, // a release shorter than this keeps the drift alive
  maxPumps: 3,
  boostSpeed: [0, 27, 30, 34],
  boostTime: [0, 0.7, 0.85, 1.15],
  boostAccel: 70,

  // Walls
  wallBounce: 0.45,
  wallKeep: 0.85, // speed kept after a hit
  bonkMin: 4, // impact speed that counts as a "bonk" event
  bonkBreaksDrift: 6,

  // Pickups
  crateR: 0.95,
  crateRespawn: 6,
  crateSlow: 0.9,
  fruitR: 1.3,
  fruitRespawn: 10,
  fruitMax: 10,
  fruitSpeed: 0.12, // each mango adds this much top speed (m/s), like wumpa fruit
  fruitLossImpact: 9, // a wall hit this hard knocks a mango loose

  // Karts bumping each other
  bumpBounce: 0.6,
};

export const NEUTRAL_INPUT = Object.freeze({ steer: 0, drift: false });

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const T = TUNING;

export function inWindow(charge) {
  return charge >= T.windowLo && charge <= T.windowHi;
}

// ---------------------------------------------------------------- world setup

export function expandFruit(arena) {
  const out = (arena.fruitPoints || []).map((p) => ({ x: p.x, z: p.z }));
  for (const line of arena.fruitLines || []) {
    const [x0, z0] = line.from;
    const [x1, z1] = line.to;
    for (let i = 0; i < line.count; i++) {
      const t = line.count === 1 ? 0.5 : i / (line.count - 1);
      out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t });
    }
  }
  return out;
}

export function createKart(id, spawn) {
  return {
    id,
    x: spawn.x,
    z: spawn.z,
    yaw: spawn.yaw,
    vx: 0,
    vz: 0,
    steer: 0,
    held: false, // drift button state last tick
    hopT: 0, // >0 while in the air
    state: 'drive', // 'drive' | 'drift'
    driftDir: 0, // -1 left, +1 right
    charge: 0,
    pumps: 0,
    releaseT: 0, // time since the drift button was let go during a drift
    relCharge: 0, // charge at the moment of letting go
    boostT: 0,
    boostLevel: 0,
    fruit: 0,
    crates: 0,
  };
}

export function createWorld(arena) {
  return {
    tick: 0,
    arena,
    karts: [],
    crates: arena.crates.map(([x, z]) => ({ x, z, alive: true, t: 0 })),
    fruit: expandFruit(arena).map((p) => ({ ...p, alive: true, t: 0 })),
  };
}

export function addKart(world, id, spawnIndex = world.karts.length) {
  const spawns = world.arena.spawns;
  const k = createKart(id, spawns[spawnIndex % spawns.length]);
  world.karts.push(k);
  return k;
}

export function speedOf(k) {
  return Math.hypot(k.vx, k.vz);
}

// ---------------------------------------------------------------- stepping

/**
 * Advance the world by one TICK.
 * @param inputs  map of kart id -> { steer, drift }
 * @returns events that happened this tick (for sounds, particles, scoring)
 */
export function stepWorld(world, inputs = {}) {
  const events = [];
  for (const k of world.karts) {
    stepKart(k, inputs[k.id] || NEUTRAL_INPUT, events);
    collideArena(k, world.arena, events);
  }
  collideKarts(world.karts, events);
  for (const k of world.karts) collectPickups(k, world, events);
  respawnPickups(world, events);
  world.tick++;
  return events;
}

function giveBoost(k, level, events) {
  k.boostLevel = Math.max(level, k.boostT > 0 ? k.boostLevel : 0);
  k.boostT = Math.max(k.boostT, T.boostTime[level]);
  events.push({ type: 'boost', kart: k.id, level });
}

function endDrift(k, events, allowBoost) {
  if (allowBoost && inWindow(k.relCharge) && k.pumps < T.maxPumps) {
    k.pumps++;
    giveBoost(k, k.pumps, events);
  }
  events.push({ type: 'driftEnd', kart: k.id });
  k.state = 'drive';
  k.driftDir = 0;
  k.charge = 0;
  k.pumps = 0;
  k.releaseT = 0;
  k.relCharge = 0;
}

export function stepKart(k, input, events) {
  const dt = TICK;
  const steer = clamp(Number(input.steer) || 0, -1, 1);
  const held = !!input.drift;
  const press = held && !k.held;
  const release = !held && k.held;
  k.held = held;
  k.steer = steer;

  let fx = Math.sin(k.yaw);
  let fz = Math.cos(k.yaw);
  const vfNow = k.vx * fx + k.vz * fz;

  // --- hop and drift state machine
  if (k.state === 'drive') {
    if (press && k.hopT <= 0) {
      k.hopT = T.hopTime;
      events.push({ type: 'hop', kart: k.id });
    }
  } else {
    // drifting
    if (press) {
      if (k.releaseT > 0) {
        // a pump: judge the charge at the moment of letting go
        if (k.pumps < T.maxPumps && inWindow(k.relCharge)) {
          k.pumps++;
          giveBoost(k, k.pumps, events);
        } else if (k.pumps < T.maxPumps) {
          events.push({ type: 'fizzle', kart: k.id, late: k.relCharge > T.windowHi });
        }
        k.charge = 0;
      }
      k.releaseT = 0;
    }
    if (release) {
      k.relCharge = k.charge;
      k.releaseT = 0;
    }
    if (!held) {
      k.releaseT += dt;
      if (k.releaseT > T.pumpGrace) endDrift(k, events, true);
    } else if (k.pumps < T.maxPumps) {
      k.charge = Math.min(T.chargeMax, k.charge + dt / T.chargeTime);
    }
    if (k.state === 'drift' && vfNow < T.driftMinSpeed * 0.7) endDrift(k, events, false);
  }

  if (k.hopT > 0) {
    k.hopT -= dt;
    if (k.hopT <= 0) {
      k.hopT = 0;
      events.push({ type: 'land', kart: k.id });
      if (
        k.state === 'drive' &&
        held &&
        Math.abs(steer) >= T.driftMinSteer &&
        vfNow >= T.driftMinSpeed
      ) {
        k.state = 'drift';
        k.driftDir = Math.sign(steer);
        k.charge = 0;
        k.pumps = 0;
        k.releaseT = 0;
        events.push({ type: 'driftStart', kart: k.id, dir: k.driftDir });
      }
    }
  }

  if (k.boostT > 0) {
    k.boostT = Math.max(0, k.boostT - dt);
    if (k.boostT === 0) k.boostLevel = 0;
  }

  // --- turning
  // steering still works when nearly stopped, so a head-on crash never pins you to a wall
  const speedF = vfNow >= 0 ? Math.min(1, T.slowTurn + (1 - T.slowTurn) * (vfNow / T.minTurnSpeed)) : -1;
  let yawRate;
  if (k.state === 'drift') {
    const d = k.driftDir;
    yawRate = -d * (T.driftBase + steer * d * T.driftRange) * Math.max(0, speedF);
  } else {
    yawRate = -steer * T.turnRate * speedF;
  }
  k.yaw += yawRate * dt;
  // keep yaw in (-PI, PI] so it never grows without bound
  if (k.yaw > Math.PI) k.yaw -= 2 * Math.PI;
  else if (k.yaw <= -Math.PI) k.yaw += 2 * Math.PI;

  // --- velocity in the kart's new frame
  fx = Math.sin(k.yaw);
  fz = Math.cos(k.yaw);
  const sx = Math.cos(k.yaw);
  const sz = -Math.sin(k.yaw);
  let vf = k.vx * fx + k.vz * fz;
  let vs = k.vx * sx + k.vz * sz;

  const boosting = k.boostT > 0;
  let target = boosting ? T.boostSpeed[k.boostLevel] : T.topSpeed + k.fruit * T.fruitSpeed;
  if (k.state === 'drift' && !boosting) target *= T.driftDrag;

  if (vf < target) vf = Math.min(target, vf + (boosting ? T.boostAccel : T.accel) * dt);
  else vf = Math.max(target, vf - T.coastDecel * dt);

  const grip = k.state === 'drift' ? T.driftGrip : k.hopT > 0 ? T.hopGrip : T.grip;
  vs *= Math.exp(-grip * dt);

  k.vx = fx * vf + sx * vs;
  k.vz = fz * vf + sz * vs;

  const sp = Math.hypot(k.vx, k.vz);
  const cap = target * 1.04;
  if (sp > cap && !boosting) {
    // bleed excess speed gently (after a boost ends, or from sliding)
    const s = Math.max(cap, sp - T.coastDecel * 2 * dt) / sp;
    k.vx *= s;
    k.vz *= s;
  }

  k.x += k.vx * dt;
  k.z += k.vz * dt;
}

// ---------------------------------------------------------------- collisions

function resolve(k, nx, nz, depth, events) {
  k.x += nx * depth;
  k.z += nz * depth;
  const vn = k.vx * nx + k.vz * nz;
  if (vn < 0) {
    k.vx -= (1 + T.wallBounce) * vn * nx;
    k.vz -= (1 + T.wallBounce) * vn * nz;
    k.vx *= T.wallKeep;
    k.vz *= T.wallKeep;
    const impact = -vn;
    if (impact >= T.bonkMin) {
      events.push({ type: 'bonk', kart: k.id, impact, x: k.x - nx * T.radius, z: k.z - nz * T.radius });
    }
    if (impact >= T.fruitLossImpact && k.fruit > 0) {
      k.fruit--;
      events.push({ type: 'fruitLost', kart: k.id, count: k.fruit });
    }
    if (impact >= T.bonkBreaksDrift && k.state === 'drift') endDrift(k, events, false);
  }
}

export function collideArena(k, arena, events) {
  const R = T.radius;
  for (const o of arena.obstacles) {
    if (o.shape === 'circle') {
      const dx = k.x - o.x;
      const dz = k.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + R;
      if (d < min && d > 1e-6) resolve(k, dx / d, dz / d, min - d, events);
    } else if (o.shape === 'seg') {
      // a thick line: wall pieces that follow a curving track
      const ex = o.x2 - o.x1;
      const ez = o.z2 - o.z1;
      const len2 = ex * ex + ez * ez;
      let t = len2 > 0 ? ((k.x - o.x1) * ex + (k.z - o.z1) * ez) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = k.x - (o.x1 + ex * t);
      const dz = k.z - (o.z1 + ez * t);
      const min = o.r + R;
      if (Math.abs(dx) < min && Math.abs(dz) < min) {
        const d = Math.hypot(dx, dz);
        if (d < min && d > 1e-6) resolve(k, dx / d, dz / d, min - d, events);
      }
    } else {
      const cx = clamp(k.x, o.x - o.hw, o.x + o.hw);
      const cz = clamp(k.z, o.z - o.hd, o.z + o.hd);
      const dx = k.x - cx;
      const dz = k.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < R) {
        if (d > 1e-6) {
          resolve(k, dx / d, dz / d, R - d, events);
        } else {
          // centre is inside the box: push out along the shallowest side
          const px = o.hw - Math.abs(k.x - o.x);
          const pz = o.hd - Math.abs(k.z - o.z);
          if (px < pz) resolve(k, Math.sign(k.x - o.x) || 1, 0, px + R, events);
          else resolve(k, 0, Math.sign(k.z - o.z) || 1, pz + R, events);
        }
      }
    }
  }
  const lim = arena.half - R;
  if (k.x > lim) resolve(k, -1, 0, k.x - lim, events);
  if (k.x < -lim) resolve(k, 1, 0, -lim - k.x, events);
  if (k.z > lim) resolve(k, 0, -1, k.z - lim, events);
  if (k.z < -lim) resolve(k, 0, 1, -lim - k.z, events);
}

/** Karts bounce off each other: equal mass, the push is shared. */
export function collideKarts(karts, events) {
  const min = T.radius * 2;
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i];
      const b = karts[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const j2 = (-(1 + T.bumpBounce) * rel) / 2;
        a.vx -= j2 * nx;
        a.vz -= j2 * nz;
        b.vx += j2 * nx;
        b.vz += j2 * nz;
        if (-rel > 2) events.push({ type: 'bump', a: a.id, b: b.id, impact: -rel, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      }
    }
  }
}

// ---------------------------------------------------------------- pickups

function collectPickups(k, world, events) {
  const rc = T.radius + T.crateR;
  world.crates.forEach((c, i) => {
    if (!c.alive) return;
    const dx = k.x - c.x;
    const dz = k.z - c.z;
    if (dx * dx + dz * dz < rc * rc) {
      c.alive = false;
      c.t = T.crateRespawn;
      k.crates++;
      k.vx *= T.crateSlow;
      k.vz *= T.crateSlow;
      events.push({ type: 'crate', kart: k.id, index: i, x: c.x, z: c.z, vx: k.vx, vz: k.vz });
    }
  });
  const rf = T.radius + T.fruitR;
  world.fruit.forEach((f, i) => {
    if (!f.alive) return;
    const dx = k.x - f.x;
    const dz = k.z - f.z;
    if (dx * dx + dz * dz < rf * rf) {
      f.alive = false;
      f.t = T.fruitRespawn;
      const before = k.fruit;
      k.fruit = Math.min(T.fruitMax, k.fruit + 1);
      events.push({ type: 'fruit', kart: k.id, index: i, x: f.x, z: f.z, count: k.fruit });
      if (before < T.fruitMax && k.fruit === T.fruitMax) events.push({ type: 'juiced', kart: k.id });
    }
  });
}

function respawnPickups(world, events) {
  for (const list of [world.crates, world.fruit]) {
    const type = list === world.crates ? 'crateBack' : 'fruitBack';
    list.forEach((p, i) => {
      if (p.alive) return;
      p.t -= TICK;
      if (p.t <= 0) {
        p.alive = true;
        p.t = 0;
        events.push({ type, index: i });
      }
    });
  }
}
