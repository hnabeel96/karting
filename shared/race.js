// Race rules: starting grid, countdown, timing gates, laps, positions, results.
// Runs on the server for online races and on the phone for offline races against bots.
//
// Phases: 'lobby' -> 'countdown' -> 'race' -> 'results'

import { TICK, stepWorld, createKart, speedOf } from './sim.js';

export const RACE = {
  countdown: 3, // seconds of 3-2-1 before the lights go green
  finishGrace: 25, // after the winner crosses the line, others get this long
  stuckTime: 3, // seconds at walking pace before you are put back on the road
  stuckSpeed: 2.5,
  resultsHold: 1.0, // results phase lasts at least this long before "race again" works
};

export function createRace(world, { laps = world.arena.laps || 3 } = {}) {
  return { phase: 'lobby', laps, t: 0, countdown: 0, entrants: {}, firstFinish: null, finishOrder: [] };
}

/** Put every kart on the grid and start the countdown. `ids` in grid order. */
export function startRace(race, world, ids) {
  const spawns = world.arena.spawns;
  world.karts = ids.map((id, i) => {
    const old = world.karts.find((k) => k.id === id);
    const k = createKart(id, spawns[i % spawns.length]);
    if (old) k.fruit = 0;
    return k;
  });
  world.crates.forEach((c) => { c.alive = true; c.t = 0; });
  world.fruit.forEach((f) => { f.alive = true; f.t = 0; });
  race.entrants = {};
  for (const k of world.karts) {
    race.entrants[k.id] = {
      lap: 0, // lap you are on (1-based once you cross the start line)
      next: 0, // index of the next gate to cross
      finished: false,
      finishTime: null,
      place: 0,
      lapStart: 0,
      bestLap: null,
      lastX: k.x,
      lastZ: k.z,
      stuck: 0,
      wrongWay: false,
      progress: 0,
    };
  }
  race.phase = 'countdown';
  race.countdown = RACE.countdown;
  race.t = 0;
  race.firstFinish = null;
  race.finishOrder = [];
}

// does segment p->q cross segment a->b?
function crosses(px, pz, qx, qz, ax, az, bx, bz) {
  const d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  const d2 = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) return false;
  const d3 = (qx - px) * (az - pz) - (qz - pz) * (ax - px);
  const d4 = (qx - px) * (bz - pz) - (qz - pz) * (bx - px);
  return !((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0));
}

function updateProgress(race, world, events) {
  const gates = world.arena.track.gates;
  const n = gates.length;
  for (const k of world.karts) {
    const e = race.entrants[k.id];
    if (!e) continue;
    const mx = k.x - e.lastX;
    const mz = k.z - e.lastZ;
    if (!e.finished) {
      const g = gates[e.next];
      const prevIndex = (e.next - 1 + n) % n;
      const pg = gates[prevIndex];
      if (crosses(e.lastX, e.lastZ, k.x, k.z, g.x1, g.z1, g.x2, g.z2) && mx * g.tx + mz * g.tz > 0) {
        if (e.next === 0) {
          // crossing the start/finish line
          if (e.lap > 0) {
            const lapTime = race.t - e.lapStart;
            if (e.bestLap === null || lapTime < e.bestLap) e.bestLap = lapTime;
            events.push({ type: 'lap', kart: k.id, lap: e.lap, time: lapTime });
          }
          e.lap++;
          e.lapStart = race.t;
          if (e.lap > race.laps) {
            e.finished = true;
            e.finishTime = race.t;
            race.finishOrder.push(k.id);
            if (race.firstFinish === null) race.firstFinish = race.t;
            events.push({ type: 'finish', kart: k.id, place: race.finishOrder.length, time: race.t });
          } else if (e.lap === race.laps && race.laps > 1) {
            events.push({ type: 'finalLap', kart: k.id });
          }
        }
        e.next = (e.next + 1) % n;
      } else if (e.lap > 0 && crosses(e.lastX, e.lastZ, k.x, k.z, pg.x1, pg.z1, pg.x2, pg.z2) && mx * pg.tx + mz * pg.tz < 0) {
        // went back over the gate you last crossed
        e.next = prevIndex;
        if (prevIndex === 0) e.lap--;
      }
    }

    // progress score for ranking: gates crossed plus how far toward the next one
    const g = gates[e.next];
    const pg = gates[(e.next - 1 + n) % n];
    const span = Math.hypot(g.mx - pg.mx, g.mz - pg.mz) || 1;
    const toNext = Math.hypot(g.mx - k.x, g.mz - k.z);
    const crossed = (e.lap - 1) * n + (e.next === 0 ? n : e.next);
    e.progress = crossed + Math.max(0, Math.min(1, 1 - toNext / span));

    // heading backwards relative to the road?
    const sp = speedOf(k);
    e.wrongWay = sp > 4 && (k.vx * pg.tx + k.vz * pg.tz) / sp < -0.5 && !e.finished;

    // stuck against something: put back on the road at the last gate
    e.stuck = sp < RACE.stuckSpeed && race.phase === 'race' ? e.stuck + TICK : 0;
    if (e.stuck > RACE.stuckTime) {
      resetToGate(k, pg, world);
      e.stuck = 0;
      events.push({ type: 'rescue', kart: k.id });
    }

    e.lastX = k.x;
    e.lastZ = k.z;
  }

  // places: finishers in finish order, then by progress
  const ids = Object.keys(race.entrants);
  ids.sort((a, b) => {
    const A = race.entrants[a];
    const B = race.entrants[b];
    if (A.finished && B.finished) return A.finishTime - B.finishTime;
    if (A.finished !== B.finished) return A.finished ? -1 : 1;
    return B.progress - A.progress;
  });
  ids.forEach((id, i) => (race.entrants[id].place = i + 1));
}

function resetToGate(k, gate, world) {
  // find a free spot across the gate so two rescued karts do not stack
  const offsets = [0, -3, 3, -6, 6];
  let x = gate.mx;
  let z = gate.mz;
  for (const o of offsets) {
    const nx = gate.x1 - gate.mx;
    const nz = gate.z1 - gate.mz;
    const len = Math.hypot(nx, nz) || 1;
    const cx = gate.mx + (nx / len) * o;
    const cz = gate.mz + (nz / len) * o;
    if (world.karts.every((other) => other === k || Math.hypot(other.x - cx, other.z - cz) > 3)) {
      x = cx;
      z = cz;
      break;
    }
  }
  Object.assign(k, {
    x, z, yaw: Math.atan2(gate.tx, gate.tz), vx: gate.tx * 6, vz: gate.tz * 6,
    state: 'drive', hopT: 0, charge: 0, pumps: 0, driftDir: 0, releaseT: 0, boostT: 0, boostLevel: 0,
  });
}

/**
 * One tick of the race. Karts only move once the lights are green.
 * @returns events (sim events plus 'go', 'lap', 'finalLap', 'finish', 'rescue', 'raceEnd')
 */
export function stepRace(race, world, inputs) {
  let events = [];
  if (race.phase === 'countdown') {
    const before = Math.ceil(race.countdown);
    race.countdown -= TICK;
    const after = Math.ceil(race.countdown);
    if (after !== before && after > 0) events.push({ type: 'count', n: after });
    if (race.countdown <= 0) {
      race.phase = 'race';
      race.t = 0;
      events.push({ type: 'go' });
    }
    // remember held buttons so nobody gets a free hop on "go"
    for (const k of world.karts) k.held = !!(inputs[k.id] && inputs[k.id].drift);
    return events;
  }
  if (race.phase === 'race' || race.phase === 'results') {
    events = stepWorld(world, inputs);
    race.t += TICK;
    if (race.phase === 'race') {
      updateProgress(race, world, events);
      const all = Object.values(race.entrants);
      const allDone = all.every((e) => e.finished);
      const timeUp = race.firstFinish !== null && race.t - race.firstFinish > RACE.finishGrace;
      if (allDone || timeUp) {
        race.phase = 'results';
        race.resultsAt = race.t;
        events.push({ type: 'raceEnd' });
      }
    }
  }
  return events;
}

/** Final standings, best first. */
export function standings(race) {
  return Object.entries(race.entrants)
    .map(([id, e]) => ({ id, place: e.place, finished: e.finished, time: e.finishTime, bestLap: e.bestLap, lap: e.lap }))
    .sort((a, b) => a.place - b.place);
}
