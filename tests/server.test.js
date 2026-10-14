import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { unpackKart, unpackEntrant } from '../shared/net.js';
import { getTrack } from '../shared/arenas/index.js';

const PORT = 3000 + Math.floor(Math.random() * 2000) + 4000;
let server;

before(async () => {
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => d.toString().includes('running') && resolve());
    server.on('exit', (c) => reject(new Error('server exited ' + c)));
    setTimeout(() => reject(new Error('server did not start')), 5000);
  });
});

after(() => server.kill());

function client(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const c = { ws, name, id: null, lobby: null, snaps: [], seq: 0 };
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') c.id = m.id;
    if (m.t === 'lobby') c.lobby = m;
    if (m.t === 's') c.snaps.push(m);
  });
  c.ready = new Promise((r) => ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ t: 'hello', name }));
    r();
  }));
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(20);
  }
  throw new Error('timed out');
}

test('serves the game and a health check', async () => {
  const page = await fetch(`http://127.0.0.1:${PORT}/client/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Karting<\/title>/);
  const sim = await fetch(`http://127.0.0.1:${PORT}/shared/sim.js`);
  assert.equal(sim.status, 200);
  const secret = await fetch(`http://127.0.0.1:${PORT}/package.json`);
  assert.equal(secret.status, 404);
  const h = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  assert.equal(h.ok, true);
});

test('two players and two bots race: lobby, countdown, go, moving karts, acks', async () => {
  const a = client('Eko');
  const b = client('Bro');
  await a.ready;
  await b.ready;
  await until(() => a.id && b.id && a.lobby?.players.length === 2);
  a.send({ t: 'addBot' });
  a.send({ t: 'addBot' });
  await until(() => b.lobby?.players.length === 4);
  assert.deepEqual(b.lobby.players.map((p) => p.name).slice(0, 2), ['Eko', 'Bro']);
  assert.equal(new Set(b.lobby.players.map((p) => p.color)).size, 4, 'every kart gets its own colour');

  b.send({ t: 'start' });
  await until(() => a.snaps.some((s) => s.ph === 'countdown'));
  // both phones drive: full throttle is automatic, steer a little, hold no drift
  const drive = setInterval(() => {
    for (const c of [a, b]) c.send({ t: 'input', s: ++c.seq, x: 0, d: false });
  }, 1000 / 60);
  await until(() => a.snaps.some((s) => s.ph === 'race'), 6000);
  await wait(1500);
  clearInterval(drive);

  const last = a.snaps[a.snaps.length - 1];
  assert.equal(last.k.length, 4);
  const mine = {};
  const ack = unpackKart(last.k.find((k) => k[0] === a.id), mine);
  assert.ok(ack > 30, `inputs acknowledged: ${ack}`);
  assert.ok(Math.hypot(mine.vx, mine.vz) > 10, 'my kart is moving');
  const entrants = last.e.map(unpackEntrant);
  assert.equal(entrants.length, 4);
  assert.deepEqual(entrants.map((e) => e.place).sort(), [1, 2, 3, 4]);
  assert.ok(entrants.every((e) => e.lap >= 1), 'everyone crossed the start line');
  assert.ok(a.snaps.some((s) => s.ev.some((e) => e.type === 'go')));
  // snapshots arrive about 30 times a second
  const raceSnaps = a.snaps.filter((s) => s.ph === 'race');
  const span = (raceSnaps[raceSnaps.length - 1].n - raceSnaps[0].n) / 60;
  assert.ok(raceSnaps.length / span > 20, `${(raceSnaps.length / span).toFixed(1)} snapshots/s`);

  // a player leaving takes their kart out of the race
  b.ws.close();
  await until(() => {
    const s = a.snaps[a.snaps.length - 1];
    return s.k.length === 3 && a.lobby.players.length === 3;
  });
  a.ws.close();
});

test('players pick the track in the lobby; the race and the bots use it', async () => {
  const a = client('Eko');
  await a.ready;
  await until(() => a.id && a.lobby);
  assert.equal(a.lobby.arena, 'circuit');
  a.send({ t: 'addBot' });
  a.send({ t: 'track', id: 'no-such-track' });
  a.send({ t: 'track', id: 'grove' });
  await until(() => a.lobby.arena === 'grove' && a.lobby.players.length === 2);
  const grove = getTrack('grove');
  assert.equal(a.lobby.laps, grove.laps);
  assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).track, 'grove');

  a.send({ t: 'start' });
  await until(() => a.snaps.some((s) => s.ph === 'race' && s.k.length === 2), 8000);
  // the grid is the grove's grid
  const s = a.snaps.find((s) => s.ph === 'countdown');
  for (const k of s.k.map((arr) => { const k = {}; unpackKart(arr, k); return k; })) assert.ok(grove.spawns.some((p) => Math.hypot(p.x - k.x, p.z - k.z) < 0.5), `kart at ${k.x},${k.z}`);
  // no switching tracks mid-race
  a.send({ t: 'track', id: 'circuit' });
  await wait(200);
  assert.equal(a.lobby.arena, 'grove');
  // the bot is driving the grove's line
  await wait(1500);
  const last = a.snaps[a.snaps.length - 1];
  const bot = last.k.map((arr) => { const k = {}; unpackKart(arr, k); return k; }).find((k) => k.id !== a.id);
  assert.ok(grove.track.center.some((c) => Math.hypot(c.x - bot.x, c.z - bot.z) < grove.track.width / 2 + 1), 'bot is on the grove road');
  a.ws.close();
});
