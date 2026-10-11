// The wire format between phones and the server, shared so both ends agree.
// Snapshots pack each kart into a flat array to keep messages small.

export const SNAPSHOT_EVERY = 2; // server ticks per snapshot (60 Hz sim -> 30 Hz snapshots)

const KART_FIELDS = [
  'x', 'z', 'yaw', 'vx', 'vz', 'steer', 'hopT', 'driftDir', 'charge', 'pumps',
  'releaseT', 'relCharge', 'boostT', 'boostLevel', 'fruit', 'crates',
];

const r4 = (v) => Math.round(v * 1e4) / 1e4;

export function packKart(k, ack = 0) {
  const out = [k.id];
  for (const f of KART_FIELDS) out.push(r4(k[f]));
  out.push(k.held ? 1 : 0, k.state === 'drift' ? 1 : 0, ack);
  return out;
}

/** Writes a packed kart into `k` (creating fields as needed). Returns the input ack. */
export function unpackKart(arr, k) {
  k.id = arr[0];
  KART_FIELDS.forEach((f, i) => (k[f] = arr[i + 1]));
  const n = KART_FIELDS.length + 1;
  k.held = arr[n] === 1;
  k.state = arr[n + 1] === 1 ? 'drift' : 'drive';
  return arr[n + 2];
}

export function packEntrant(id, e) {
  return [id, e.lap, e.next, e.place, e.finished ? 1 : 0, e.finishTime === null ? -1 : r4(e.finishTime), e.bestLap === null ? -1 : r4(e.bestLap), e.wrongWay ? 1 : 0, r4(e.progress)];
}

export function unpackEntrant(a) {
  return {
    id: a[0], lap: a[1], next: a[2], place: a[3], finished: a[4] === 1,
    finishTime: a[5] < 0 ? null : a[5], bestLap: a[6] < 0 ? null : a[6], wrongWay: a[7] === 1, progress: a[8],
  };
}

export const bits = (list) => list.map((p) => (p.alive ? '1' : '0')).join('');

/** Strip bulky or circular fields from events before sending. */
export function packEvents(events) {
  return events.map((e) => {
    const o = {};
    for (const [k, v] of Object.entries(e)) o[k] = typeof v === 'number' ? r4(v) : v;
    return o;
  });
}
