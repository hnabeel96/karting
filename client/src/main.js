// Boots the game and runs the frame loop.
//
// What is on screen always comes from a "session":
//   LocalSession  everything simulated on this phone (title demo, free drive, race vs bots)
//   NetSession    a race refereed by the game server (race a friend)
// Both step at a fixed 60 ticks/s and hand back karts to draw plus events to react to.

import * as THREE from 'three';
import { TICK, TUNING, createWorld, inWindow } from '@shared/sim.js';
import temple from '@shared/arenas/temple.js';
import { TRACKS, DEFAULT_TRACK, getTrack } from '@shared/arenas/index.js';
import { buildSky, buildLights, buildArena, useTheme, PALETTE } from './arena3d.js';
import { KartModel, KART_COLORS, BOOST_COLORS } from './kartModel.js';
import { Particles, SkidMarks, Debris, Rings } from './fx.js';
import { Controls } from './input.js';
import { Sound } from './audio.js';
import { damp, dampAngle, lerpAngle, canvasTexture } from './util.js';
import { loadModels, colliderOverlay } from './models.js';
import { LocalSession } from './session-local.js';
import { createBot, botInput, createPathBot, pathBotInput } from '@shared/bot.js';
import { NetSession } from './session-net.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('karting.' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('karting.' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 700);

// Model files that replace the built-in art (models/manifest.js).
// Add #examples to the address to try the example models instead.
const manifestUrl = new URL(location.hash === '#examples' ? '../models/examples/manifest.js' : '../models/manifest.js', import.meta.url);
const manifest = (await import(manifestUrl.href)).default;
const models = await loadModels(manifest, manifestUrl);
window.addEventListener('hashchange', () => location.reload());

// ---------------------------------------------------------------- stages (one 3D scene per arena)

const stages = new Map();
function getStage(arena) {
  if (stages.has(arena.id)) return stages.get(arena.id);
  const scene = new THREE.Scene();
  const theme = useTheme(arena);
  buildSky(scene);
  const lights = buildLights(scene);
  const world0 = createWorld(arena);
  const stage = {
    arena,
    theme,
    scene,
    lights,
    arena3d: buildArena(scene, arena, world0, models),
    sparks: new Particles(scene, 700, { additive: true, soft: 0.2 }),
    puffs: new Particles(scene, 600, { additive: false, soft: 0.55 }),
    skids: new SkidMarks(scene, 900),
    debris: new Debris(scene),
    rings: new Rings(scene, 10),
    colliders: colliderOverlay(scene, arena, world0, TUNING),
    karts: new Map(), // id -> { model, tag, fx }
  };
  stage.colliders.visible = debug.colliders;
  stages.set(arena.id, stage);
  return stage;
}

function nameTag(name, colorIndex) {
  const col = KART_COLORS[colorIndex % KART_COLORS.length].body;
  const tex = canvasTexture(256, 64, (g, w, h) => {
    g.font = '40px "Lilita One", "Trebuchet MS", sans-serif';
    const tw = Math.min(w - 8, g.measureText(name).width + 36);
    g.fillStyle = 'rgba(52,38,24,0.7)';
    g.beginPath();
    g.roundRect((w - tw) / 2, 6, tw, h - 12, 26);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.arc((w - tw) / 2 + 20, h / 2, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff4dc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, w / 2 + 8, h / 2 + 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(3.4, 0.85, 1);
  s.position.y = 3.4;
  s.renderOrder = 5;
  return s;
}

function kartVisual(stage, id, v, index) {
  const color = v.colors[id] ?? index;
  const name = v.names[id] || '';
  let kv = stage.karts.get(id);
  if (kv && (kv.color !== color || kv.name !== name)) {
    stage.scene.remove(kv.model.root);
    kv = null;
  }
  if (!kv) {
    const model = new KartModel(stage.scene, { colorIndex: color, number: index + 1, model: models.kart });
    kv = {
      model,
      color,
      name,
      tag: null,
      fx: { contacts: [new THREE.Vector3(), new THREE.Vector3()], last: [new THREE.Vector3(), new THREE.Vector3()], had: false, spark: 0, dust: 0, flame: 0, glitter: 0 },
    };
    stage.karts.set(id, kv);
  }
  const wantTag = id !== v.localId && name && v !== attract;
  if (wantTag && !kv.tag) {
    kv.tag = nameTag(name, color);
    kv.model.root.add(kv.tag);
  } else if (!wantTag && kv.tag) {
    kv.model.root.remove(kv.tag);
    kv.tag = null;
  }
  return kv;
}

function clearKarts(stage) {
  for (const kv of stage.karts.values()) stage.scene.remove(kv.model.root);
  stage.karts.clear();
}

// ---------------------------------------------------------------- sessions and modes

const debug = { autopilot: false, colliders: false };
let mode = 'title'; // 'title' | 'drive' | 'bots' | 'online'
let session = null; // the local session being played (drive / bots)
let net = null;
let trackId = getTrack(store.get('track', DEFAULT_TRACK)).id; // the track picked on the title screen
let attract = new LocalSession(getTrack(trackId), { player: false, bots: 3 });
let shown = null; // the session drawn last frame

/** the session to draw and step this frame */
function view() {
  if (mode === 'drive' || mode === 'bots') return session;
  if (mode === 'online' && net && net.phase !== 'lobby' && net.localId) return net;
  return attract;
}

const sound = new Sound();
const controls = new Controls({
  steerZone: $('steer-zone'),
  driftZone: $('drift-zone'),
  pill: $('steer-pill'),
  knob: $('steer-knob'),
  driftBtn: $('drift-btn'),
});

let playerName = store.get('name', '');
let playerColor = store.get('color', 0);

function goFullscreen() {
  try {
    const el = document.documentElement;
    const fs = el.requestFullscreen?.({ navigationUI: 'hide' }) || el.webkitRequestFullscreen?.();
    Promise.resolve(fs)
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  } catch {}
  try {
    navigator.wakeLock?.request('screen').catch(() => {});
  } catch {}
}

function setPlaying(on) {
  document.body.classList.toggle('playing', on);
  if (!on) {
    document.body.classList.remove('racing');
    for (const id of ['wrongway', 'spectate', 'countdown', 'race-hud']) $(id).hidden = true;
  }
  controls.enabled = on;
  controls.reset();
}

function startLocal(kind) {
  sound.start();
  sound.click();
  goFullscreen();
  closeNet();
  mode = kind;
  session =
    kind === 'bots'
      ? new LocalSession(getTrack(trackId), { player: true, bots: 3, race: true, name: playerName || 'You', color: playerColor })
      : new LocalSession(temple, { player: true, name: playerName || 'You', color: playerColor });
  $('lobby').hidden = true;
  setPlaying(true);
  snapCamera = true;
}

function startOnline() {
  sound.start();
  sound.click();
  goFullscreen();
  mode = 'online';
  session = null;
  showLobby();
  if (net && net.status === 'open') return;
  closeNet();
  let first = true;
  net = new NetSession(getTrack(trackId), {
    name: playerName,
    color: playerColor,
    onLobby: (lobby) => {
      // first one into an empty room: start it on the track picked on the title screen
      if (first && lobby.players.some((p) => p.id === net.localId)) {
        first = false;
        const alone = lobby.players.filter((p) => !p.bot).length === 1;
        if (alone && lobby.phase === 'lobby' && lobby.arena !== trackId) net.chooseTrack(trackId);
      }
      renderLobby();
    },
    onStatus: () => renderLobby(),
  });
}

function closeNet() {
  if (net) net.close();
  net = null;
}

function toTitle() {
  closeNet();
  mode = 'title';
  session = null;
  $('lobby').hidden = true;
  $('results').hidden = true;
  setPlaying(false);
  renderTitleTrack();
  snapCamera = true;
}

// ---------------------------------------------------------------- lobby screen

function showLobby() {
  $('lobby').hidden = false;
  $('results').hidden = true;
  setPlaying(false);
  renderLobby();
}

function renderLobby() {
  if (mode !== 'online' || !net) return;
  const status = $('lobby-status');
  const body = $('lobby-body');
  if (net.status === 'connecting') {
    status.textContent = 'Connecting to the game server…';
    body.hidden = true;
  } else if (net.status === 'failed' || net.status === 'closed') {
    status.textContent =
      net.why === 'full'
        ? 'This race is full (8 karts).'
        : "Can't reach the game server. Racing a friend needs the game running on a computer or server: run npm start there, then open the address it prints on both phones.";
    body.hidden = true;
  } else {
    status.textContent = net.lobby && net.lobby.phase !== 'lobby' ? 'A race is on. You will be on the grid for the next one.' : '';
    body.hidden = false;
  }
  const lobby = net.lobby;
  if (!lobby) return;

  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  $('join-url').textContent = local ? 'Use this computer’s wifi address from the server window, e.g. http://192.168.x.x:' + (location.port || 80) : location.origin + '/';

  const list = $('players');
  list.replaceChildren(
    ...lobby.players.map((p) => {
      const li = document.createElement('li');
      if (p.id === net.localId) li.className = 'you';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = KART_COLORS[p.color % 8].body;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = p.bot ? 'bot' : p.id === net.localId ? 'you' : p.ping ? p.ping + ' ms' : '';
      li.append(dot, nm, tag);
      return li;
    }),
  );

  const used = new Set(lobby.players.filter((p) => p.id !== net.localId).map((p) => p.color));
  const me = lobby.players.find((p) => p.id === net.localId);
  if (me) playerColor = me.color;
  const sw = $('swatches');
  sw.replaceChildren(
    ...KART_COLORS.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c.body;
      b.setAttribute('aria-label', 'Kart colour ' + (i + 1));
      b.setAttribute('aria-pressed', String(i === playerColor));
      b.disabled = used.has(i);
      b.addEventListener('click', () => {
        playerColor = i;
        store.set('color', i);
        net.rename($('name-input').value, i);
      });
      return b;
    }),
  );
  const input = $('name-input');
  if (document.activeElement !== input && me) input.value = me.name;

  renderTrackChoices(lobby);

  const bots = lobby.players.filter((p) => p.bot).length;
  $('bot-add').disabled = lobby.players.length >= 8 || lobby.phase !== 'lobby';
  $('bot-remove').disabled = bots === 0 || lobby.phase !== 'lobby';
  $('start-race').disabled = lobby.phase !== 'lobby';
}

// ---------------------------------------------------------------- track picker (title screen)

/** show this track behind the menus (the demo race) */
function showTrack(arena) {
  if (attract.arena === arena) return;
  attract = new LocalSession(arena, { player: false, bots: 3 });
  snapCamera = true;
}

function pickTrack(step) {
  const i = TRACKS.findIndex((t) => t.id === trackId);
  trackId = TRACKS[(i + step + TRACKS.length) % TRACKS.length].id;
  store.set('track', trackId);
  sound.start();
  sound.click();
  renderTitleTrack();
}

function renderTitleTrack() {
  const t = getTrack(trackId);
  $('track-name').textContent = t.name;
  $('track-prev').hidden = $('track-next').hidden = TRACKS.length < 2;
  showTrack(t);
}

$('track-prev').addEventListener('click', () => pickTrack(-1));
$('track-next').addEventListener('click', () => pickTrack(1));

function renderTrackChoices(lobby) {
  const box = $('tracks');
  box.replaceChildren(
    ...TRACKS.map((t) => {
      const b = document.createElement('button');
      b.className = 'btn quiet small';
      b.setAttribute('aria-pressed', String(t.id === lobby.arena));
      b.disabled = lobby.phase !== 'lobby';
      b.textContent = t.name;
      if (t.id === lobby.arena) {
        const laps = document.createElement('span');
        laps.className = 'laps';
        laps.textContent = lobby.laps + ' laps';
        b.append(laps);
      }
      b.addEventListener('click', () => {
        if (t.id === lobby.arena || !net) return;
        sound.click();
        net.chooseTrack(t.id);
      });
      return b;
    }),
  );
  showTrack(getTrack(lobby.arena));
}

$('play').addEventListener('click', startOnline);
$('race-bots').addEventListener('click', () => startLocal('bots'));
$('free-drive').addEventListener('click', () => startLocal('drive'));
$('lobby-leave').addEventListener('click', () => {
  sound.click();
  toTitle();
});
$('bot-add').addEventListener('click', () => net && net.addBot());
$('bot-remove').addEventListener('click', () => net && net.removeBot());
$('start-race').addEventListener('click', () => {
  sound.click();
  if (net) net.start();
});
$('name-input').addEventListener('change', (e) => {
  playerName = e.target.value.trim().slice(0, 14);
  store.set('name', playerName);
  if (net) net.rename(playerName, playerColor);
});
$('name-input').addEventListener('keydown', (e) => e.stopPropagation());

// ---------------------------------------------------------------- results screen

const fmt = (t) => {
  if (t === null || t === undefined) return '–';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] || 'th');

function renderResults(v, info) {
  const rows = Object.entries(info.entrants).sort((a, b) => a[1].place - b[1].place);
  $('results-rows').replaceChildren(
    ...rows.map(([id, e]) => {
      const tr = document.createElement('tr');
      if (id === v.localId) tr.className = 'you';
      const pl = document.createElement('td');
      pl.className = 'pl';
      pl.textContent = ordinal(e.place);
      const nm = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = KART_COLORS[(v.colors[id] ?? 0) % 8].body;
      nm.append(dot, document.createTextNode(v.names[id] || id));
      const tm = document.createElement('td');
      tm.className = 'tm';
      tm.textContent = e.finished ? fmt(e.finishTime) : 'Did not finish';
      const bl = document.createElement('td');
      bl.className = 'bl';
      bl.textContent = e.bestLap ? 'best lap ' + fmt(e.bestLap) : '';
      tr.append(pl, nm, tm, bl);
      return tr;
    }),
  );
  const mine = info.entrants[v.localId];
  $('results-title').textContent = mine ? (mine.place === 1 ? 'You won!' : `You finished ${ordinal(mine.place)}`) : 'Results';
  $('results-note').textContent = v.online ? 'Anyone can start the next race.' : '';
  $('results-again').hidden = false;
}

$('results-again').addEventListener('click', () => {
  sound.click();
  $('results').hidden = true;
  if (mode === 'online' && net) net.start();
  else if (session) {
    session.restart();
    snapCamera = true;
  }
});
$('results-back').addEventListener('click', () => {
  sound.click();
  $('results').hidden = true;
  if (mode === 'online' && net) net.toLobby();
  else toTitle();
});

// ---------------------------------------------------------------- camera

const cam = { yaw: 0, fov: 62, trauma: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), orbit: 0, punch: 0 };
let snapCamera = true;
renderTitleTrack();

function baseFov() {
  return camera.aspect > 1.9 ? 54 : camera.aspect < 1 ? 74 : 62;
}

const shakeVec = new THREE.Vector3();
function updateCamera(dt, t, target, follow) {
  if (!target) return;
  const { pose, k } = target;
  const speed = Math.hypot(k.vx, k.vz);
  if (snapCamera) {
    cam.yaw = pose.yaw;
    cam.fov = baseFov();
    cam.trauma = 0;
    cam.pos.set(pose.x - Math.sin(pose.yaw) * 7, 3.2, pose.z - Math.cos(pose.yaw) * 7);
    snapCamera = false;
  }
  if (!follow) {
    // slow orbit for the title screen and lobby
    cam.orbit += dt * 0.16;
    const r = 13;
    cam.pos.x = damp(cam.pos.x, pose.x + Math.sin(cam.orbit) * r, 2.2, dt);
    cam.pos.y = damp(cam.pos.y, 5.4, 2.2, dt);
    cam.pos.z = damp(cam.pos.z, pose.z + Math.cos(cam.orbit) * r, 2.2, dt);
    cam.look.set(pose.x, 1.1, pose.z);
    cam.fov = damp(cam.fov, baseFov() + 4, 2, dt);
  } else {
    const velYaw = Math.atan2(k.vx, k.vz);
    const tgt = k.state === 'drift' && speed > 3 ? lerpAngle(pose.yaw, velYaw, 0.6) : pose.yaw;
    cam.yaw = dampAngle(cam.yaw, tgt, k.state === 'drift' ? 3.2 : 4.5, dt);
    const boosting = k.boostT > 0;
    const dist = 6.6 + speed * 0.05 + (boosting ? 0.9 : 0);
    cam.pos.x = pose.x - Math.sin(cam.yaw) * dist;
    cam.pos.z = pose.z - Math.cos(cam.yaw) * dist;
    const lift = target.model ? target.model.lift.position.y : 0;
    cam.pos.y = damp(cam.pos.y, 3.1 + lift * 0.5, 6, dt);
    cam.look.set(pose.x + Math.sin(cam.yaw) * 4, 1.0 + lift * 0.4, pose.z + Math.cos(cam.yaw) * 4);
    const fovT = baseFov() + speed * 0.12 + (boosting ? 8 + k.boostLevel * 2 : 0) + cam.punch;
    cam.fov = damp(cam.fov, fovT, boosting ? 7 : 4, dt);
    cam.punch = damp(cam.punch, 0, 5, dt);
  }
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);

  cam.trauma = Math.max(0, cam.trauma - dt * 1.8);
  if (!reduceMotion && cam.trauma > 0) {
    const s = cam.trauma * cam.trauma * 0.55;
    shakeVec.set(Math.sin(t * 47.3) + Math.sin(t * 81.1) * 0.5, Math.sin(t * 59.7), Math.sin(t * 71.9 + 1.3)).multiplyScalar(s);
    camera.position.add(shakeVec);
    camera.rotation.z += Math.sin(t * 37.1) * s * 0.06;
  }
  if (Math.abs(camera.fov - cam.fov) > 0.01) {
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
  }
}

const addTrauma = (v) => (cam.trauma = Math.min(1, cam.trauma + v));

// ---------------------------------------------------------------- HUD

const hud = {
  fruit: $('fruit-count'),
  fruitBox: $('fruit-box'),
  crates: $('crate-count'),
  juiced: $('juiced'),
  callout: $('callout'),
  ring: $('charge-ring'),
  btn: $('drift-btn'),
  pips: [...document.querySelectorAll('#pips i')],
  speedlines: $('speedlines'),
  flyers: $('flyers'),
  race: $('race-hud'),
  place: $('place'),
  lap: $('lap'),
  timer: $('timer'),
  wrong: $('wrongway'),
  spectate: $('spectate'),
  count: $('countdown'),
  minimap: $('minimap'),
};
const RING_LEN = 2 * Math.PI * 44;

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('bump');
}

let calloutTimer = 0;
function callout(text, cls = '', ms = 900) {
  const el = hud.callout;
  el.textContent = text;
  el.className = '';
  void el.offsetWidth;
  el.className = 'show ' + cls;
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => (el.className = ''), ms);
}

let countTimer = 0;
let lastCount = null;
function showCount(text, go = false) {
  lastCount = go ? null : Number(text);
  const el = hud.count;
  el.hidden = false;
  el.textContent = text;
  el.className = '';
  void el.offsetWidth;
  el.className = 'tick' + (go ? ' go' : '');
  clearTimeout(countTimer);
  countTimer = setTimeout(() => (el.hidden = true), 900);
}

const projV = new THREE.Vector3();
function flyMango(x, z) {
  projV.set(x, 1.1, z).project(camera);
  if (projV.z > 1) return;
  const sx = (projV.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-projV.y * 0.5 + 0.5) * window.innerHeight;
  const target = hud.fruitBox.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'flyer';
  el.innerHTML = '<svg viewBox="0 0 24 24"><use href="#mango"/></svg>';
  el.style.transform = `translate(${sx}px, ${sy}px) scale(1.4)`;
  hud.flyers.appendChild(el);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transform = `translate(${target.left + 18}px, ${target.top + 18}px) scale(0.6)`;
      el.style.opacity = '0.9';
    });
  });
  const done = () => {
    el.remove();
    bump(hud.fruitBox);
  };
  el.addEventListener('transitionend', done, { once: true });
  setTimeout(() => el.isConnected && done(), 800);
}

// minimap: the track outline drawn once, karts drawn every few frames
const mini = { ctx: hud.minimap.getContext('2d'), base: null, frame: 0 };
function miniTransform(arena) {
  const pts = arena.track.center;
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const minX = Math.min(...xs) - 10;
  const maxX = Math.max(...xs) + 10;
  const minZ = Math.min(...zs) - 10;
  const maxZ = Math.max(...zs) + 10;
  const size = hud.minimap.width;
  const sc = (size - 16) / Math.max(maxX - minX, maxZ - minZ);
  // +x east is screen-left from the start line's chase view... keep north up, east right
  return (x, z) => [size / 2 - (x - (minX + maxX) / 2) * sc, size / 2 - (z - (minZ + maxZ) / 2) * sc];
}
function drawMinimap(v, list) {
  const arena = v.arena;
  if (!arena.track) return;
  if (!mini.base || mini.base.arena !== arena) {
    const tf = miniTransform(arena);
    const c = document.createElement('canvas');
    c.width = c.height = hud.minimap.width;
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    g.beginPath();
    arena.track.center.forEach((p, i) => {
      const [x, y] = tf(p.x, p.z);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.closePath();
    g.strokeStyle = 'rgba(59,36,18,0.85)';
    g.lineWidth = 16;
    g.stroke();
    g.strokeStyle = '#e8c48a';
    g.lineWidth = 9;
    g.stroke();
    const g0 = arena.track.gates[0];
    const [ax, ay] = tf(g0.x1, g0.z1);
    const [bx, by] = tf(g0.x2, g0.z2);
    g.strokeStyle = '#fff4dc';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    mini.base = { arena, canvas: c, tf };
  }
  const g = mini.ctx;
  g.clearRect(0, 0, hud.minimap.width, hud.minimap.height);
  g.drawImage(mini.base.canvas, 0, 0);
  const sorted = [...list].sort((a, b) => (a.id === v.localId) - (b.id === v.localId));
  for (const it of sorted) {
    const [x, y] = mini.base.tf(it.pose.x, it.pose.z);
    const me = it.id === v.localId;
    g.beginPath();
    g.arc(x, y, me ? 10 : 7, 0, Math.PI * 2);
    g.fillStyle = KART_COLORS[(v.colors[it.id] ?? 0) % 8].body;
    g.fill();
    g.lineWidth = me ? 4 : 2.5;
    g.strokeStyle = me ? '#fff4dc' : '#3b2412';
    g.stroke();
  }
}

let resultsShownFor = null;
function updateHud(v, list, local) {
  const k = local ? local.k : null;
  if (k) {
    hud.fruit.textContent = k.fruit;
    hud.crates.textContent = k.crates;
    hud.juiced.hidden = k.fruit < TUNING.fruitMax;
    const drifting = k.state === 'drift';
    const c = drifting ? Math.min(k.charge, 1) : 0;
    hud.ring.style.strokeDashoffset = String(RING_LEN * (1 - c));
    const hot = drifting && k.pumps < TUNING.maxPumps && inWindow(k.charge);
    hud.btn.classList.toggle('hot', hot);
    hud.btn.classList.toggle('late', drifting && k.charge > TUNING.windowHi);
    hud.btn.classList.toggle('drifting', drifting);
    hud.pips.forEach((p, i) => p.classList.toggle('on', drifting && i < k.pumps));
    hud.btn.style.setProperty('--next', BOOST_COLORS[Math.min(k.pumps + 1, 3)]);
    hud.speedlines.style.opacity = String(k.boostT > 0 ? 0.35 + k.boostLevel * 0.2 : 0);
  } else {
    hud.speedlines.style.opacity = '0';
  }

  const info = mode === 'title' ? null : v.raceInfo();
  const racing = !!info;
  document.body.classList.toggle('racing', racing);
  hud.race.hidden = !racing;
  if (!racing) {
    hud.wrong.hidden = true;
    hud.spectate.hidden = true;
    return;
  }
  const e = info.entrants[v.localId];
  const total = Object.keys(info.entrants).length;
  if (e) {
    hud.place.innerHTML = `${e.place}<sup>${ordinal(e.place).slice(-2)}</sup><small>/${total}</small>`;
    hud.place.classList.toggle('first', e.place === 1);
    hud.lap.textContent = e.finished ? 'Finished' : `Lap ${Math.min(Math.max(e.lap, 1), info.laps)}/${info.laps}`;
    hud.timer.textContent = fmt(e.finished ? e.finishTime : info.phase === 'countdown' ? 0 : info.t);
  } else {
    hud.place.innerHTML = '';
    hud.lap.textContent = `${info.laps} laps`;
    hud.timer.textContent = fmt(info.phase === 'countdown' ? 0 : info.t);
  }
  hud.wrong.hidden = !(e && e.wrongWay && info.phase === 'race');
  hud.spectate.hidden = !(v.online && !e && info.phase !== 'results');
  if (++mini.frame % 3 === 0) drawMinimap(v, list);

  if (info.phase === 'countdown') {
    // show the number we are on if the event was missed (joining mid-countdown)
    const n = Math.ceil(info.countdown);
    if (n !== lastCount && n > 0 && n <= 3) showCount(String(n));
  }
  if (info.phase === 'results') {
    const key = v.online ? 'net' + (info.firstFinish ?? 0) : session;
    if (resultsShownFor !== key) {
      resultsShownFor = key;
      setTimeout(() => {
        if (view() !== v || !v.raceInfo() || v.raceInfo().phase !== 'results') return;
        renderResults(v, v.raceInfo());
        $('results').hidden = false;
      }, 1400);
    }
  } else {
    if (!$('results').hidden && resultsShownFor) $('results').hidden = true;
    resultsShownFor = null;
  }
}

// ---------------------------------------------------------------- effects

const rnd = Math.random;
const exhausts = [new THREE.Vector3(), new THREE.Vector3()];

function dustBurst(stage, x, z, n, color = stage.theme.sand, spread = 4) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const s = spread * (0.4 + rnd() * 0.6);
    stage.puffs.emit({
      x: x + Math.sin(a) * 0.4, y: 0.3, z: z + Math.cos(a) * 0.4,
      vx: Math.sin(a) * s, vy: 1 + rnd() * 2, vz: Math.cos(a) * s,
      life: 0.5 + rnd() * 0.4, size: 0.9, size1: 2.2, color, alpha: 0.7, drag: 3,
    });
  }
}

function onEvents(v, stage, events, byId) {
  const local = v.localId;
  const near = (x, z) => {
    const me = byId.get(local);
    return me ? Math.hypot(me.pose.x - x, me.pose.z - z) < 30 : true;
  };
  for (const e of events) {
    const it = e.kart ? byId.get(e.kart) : null;
    const kv = e.kart ? stage.karts.get(e.kart) : null;
    const mine = e.kart === local;
    const play = mode !== 'title' && (mine || (it && near(it.pose.x, it.pose.z)));
    switch (e.type) {
      case 'hop':
        kv?.model.kick('hop');
        if (mine) sound.hop();
        if (it) dustBurst(stage, it.pose.x, it.pose.z, 5, stage.theme.sand, 2.5);
        break;
      case 'land':
        kv?.model.kick('land');
        if (mine) sound.land();
        break;
      case 'boost':
        kv?.model.kick('boost', 0.6 + e.level * 0.3);
        if (it) stage.rings.spawn(it.pose.x, 0.15, it.pose.z, BOOST_COLORS[e.level], { r0: 1, r1: 5 + e.level, life: 0.4 });
        if (mine) {
          sound.boost(e.level);
          cam.punch = 4 + e.level * 2;
          addTrauma(0.12 + e.level * 0.05);
          if (mode !== 'title') callout(['', 'Boost!', 'Double!', 'Triple!'][e.level], 'lv' + e.level);
        }
        break;
      case 'fizzle':
        if (kv) {
          kv.model.exhausts(exhausts);
          for (let i = 0; i < 10; i++) {
            const p = exhausts[i % 2];
            stage.puffs.emit({ x: p.x, y: p.y, z: p.z, vx: (rnd() - 0.5) * 2, vy: 1.5 + rnd(), vz: (rnd() - 0.5) * 2, life: 0.7, size: 0.6, size1: 1.8, color: '#3b3433', alpha: 0.75, drag: 2, floor: false });
          }
        }
        if (mine) {
          sound.fizzle();
          if (mode !== 'title') callout(e.late ? 'Too late' : 'Too early', 'miss');
        }
        break;
      case 'bonk':
        kv?.model.kick('bonk', Math.min(1.4, e.impact / 12));
        if (mine) {
          sound.bonk(e.impact);
          addTrauma(Math.min(0.6, e.impact / 30));
        }
        dustBurst(stage, e.x, e.z, 8, stage.theme.stoneLight, 5);
        for (let i = 0; i < 10; i++) {
          stage.sparks.emit({ x: e.x, y: 0.8, z: e.z, vx: (rnd() - 0.5) * 12, vy: 2 + rnd() * 5, vz: (rnd() - 0.5) * 12, life: 0.3 + rnd() * 0.2, size: 0.35, size1: 0.05, color: '#fff3c4', gravity: 18, drag: 2 });
        }
        break;
      case 'bump': {
        const a = stage.karts.get(e.a);
        const b = stage.karts.get(e.b);
        a?.model.kick('bonk', Math.min(1, e.impact / 10));
        b?.model.kick('bonk', Math.min(1, e.impact / 10));
        if (e.a === local || e.b === local) {
          sound.bonk(e.impact);
          addTrauma(Math.min(0.5, e.impact / 25));
        }
        for (let i = 0; i < 12; i++) {
          stage.sparks.emit({ x: e.x, y: 0.7, z: e.z, vx: (rnd() - 0.5) * 10, vy: 2 + rnd() * 4, vz: (rnd() - 0.5) * 10, life: 0.3, size: 0.4, size1: 0.05, color: '#ffe08a', gravity: 16, drag: 2 });
        }
        break;
      }
      case 'crate':
        stage.arena3d.crates.smash(e.index);
        kv?.model.kick('crate');
        if (play) sound.crate();
        if (mine) {
          addTrauma(0.28);
          cam.punch = 3;
        }
        stage.debris.burst(e.x, 0.8, e.z, e.vx, e.vz, [PALETTE.wood, PALETTE.woodDark, '#d9934f', '#ffd36b'], 16, rnd);
        dustBurst(stage, e.x, e.z, 10, '#d8b27a', 6);
        stage.rings.spawn(e.x, 0.15, e.z, '#ffd36b', { r0: 0.5, r1: 4, life: 0.35, alpha: 0.7 });
        break;
      case 'crateBack': {
        const c = stage.arena3d.crates.items[e.index];
        stage.arena3d.crates.respawn(e.index);
        if (c) dustBurst(stage, c.x, c.z, 6, '#ffffff', 3);
        break;
      }
      case 'fruit':
        stage.arena3d.mangoes.take(e.index);
        if (mine) {
          sound.fruit();
          if (mode !== 'title') flyMango(e.x, e.z);
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          stage.sparks.emit({ x: e.x, y: 1.1, z: e.z, vx: Math.sin(a) * 4, vy: 2 + rnd() * 2, vz: Math.cos(a) * 4, life: 0.35, size: 0.4, size1: 0.05, color: '#ffc23d', gravity: 6, drag: 3 });
        }
        break;
      case 'fruitBack':
        stage.arena3d.mangoes.respawn(e.index);
        break;
      case 'fruitLost':
        if (it) {
          for (let i = 0; i < 6; i++) stage.sparks.emit({ x: it.pose.x, y: 1.2, z: it.pose.z, vx: (rnd() - 0.5) * 6, vy: 4 + rnd() * 3, vz: (rnd() - 0.5) * 6, life: 0.6, size: 0.55, size1: 0.2, color: '#ffa424', gravity: 14, drag: 1 });
        }
        break;
      case 'juiced':
        if (mine) {
          sound.juiced();
          if (mode !== 'title') callout('Juiced!', 'juiced');
        }
        if (it) stage.rings.spawn(it.pose.x, 0.2, it.pose.z, '#ffc23d', { r0: 1, r1: 8, life: 0.6 });
        break;
      // ---- race events
      case 'count':
        if (mode !== 'title') sound.tone('square', 440, 440, 0.18, 0.12);
        break;
      case 'go':
        if (mode !== 'title') {
          showCount('GO!', true);
          sound.tone('square', 880, 880, 0.35, 0.14);
        }
        break;
      case 'finalLap':
        if (mine) {
          callout('Final lap!', 'juiced', 1400);
          sound.juiced();
        }
        break;
      case 'lap':
        if (mine && mode !== 'title') sound.tone('triangle', 660, 990, 0.15, 0.1);
        break;
      case 'finish':
        if (mine) {
          callout(e.place === 1 ? 'You win!' : ordinal(e.place) + '!', e.place === 1 ? 'juiced' : 'lv1', 1800);
          sound.juiced();
        }
        break;
      case 'rescue':
        if (it) stage.rings.spawn(it.pose.x, 0.2, it.pose.z, '#9fe1ff', { r0: 0.5, r1: 4, life: 0.5 });
        if (mine) snapCamera = true;
        break;
      case 'raceStart':
        clearKarts(stage);
        snapCamera = true;
        $('results').hidden = true;
        break;
      default:
    }
  }
}

function kartEffects(stage, it, kv, dt) {
  const k = it.k;
  const f = kv.fx;
  const drifting = k.state === 'drift';
  const speed = Math.hypot(k.vx, k.vz);
  kv.model.rearContacts(f.contacts);
  const grounded = k.hopT <= 0;

  if (drifting && grounded) {
    if (f.had) {
      stage.skids.add(f.last[0], f.contacts[0]);
      stage.skids.add(f.last[1], f.contacts[1]);
    }
    const hot = inWindow(k.charge) && k.pumps < TUNING.maxPumps;
    const late = k.charge > TUNING.windowHi && k.pumps < TUNING.maxPumps;
    f.spark += dt * (hot ? 70 : 34);
    while (f.spark >= 1) {
      f.spark -= 1;
      const p = f.contacts[(rnd() * 2) | 0];
      if (late) {
        stage.puffs.emit({ x: p.x, y: 0.35, z: p.z, vx: (rnd() - 0.5) * 2, vy: 1 + rnd(), vz: (rnd() - 0.5) * 2, life: 0.5, size: 0.6, size1: 1.6, color: '#5a5350', alpha: 0.6, drag: 2 });
      } else {
        stage.sparks.emit({
          x: p.x, y: 0.2, z: p.z,
          vx: -k.vx * 0.15 + (rnd() - 0.5) * 5, vy: 2 + rnd() * 3, vz: -k.vz * 0.15 + (rnd() - 0.5) * 5,
          life: 0.25 + rnd() * 0.2, size: hot ? 0.55 : 0.32, size1: 0.05, color: hot ? BOOST_COLORS[Math.min(k.pumps + 1, 3)] : '#fff1c9', gravity: 14, drag: 1.5,
        });
      }
    }
    if (rnd() < dt * 14) {
      const p = f.contacts[(rnd() * 2) | 0];
      stage.puffs.emit({ x: p.x, y: 0.3, z: p.z, vy: 0.8, life: 0.7, size: 0.8, size1: 2.4, color: '#f2e6d0', alpha: 0.45, drag: 2 });
    }
  }
  f.had = drifting && grounded;
  f.last[0].copy(f.contacts[0]);
  f.last[1].copy(f.contacts[1]);

  if (grounded && speed > 12 && !drifting) {
    f.dust += dt * speed * 0.35;
    while (f.dust >= 1) {
      f.dust -= 1;
      const p = f.contacts[(rnd() * 2) | 0];
      stage.puffs.emit({ x: p.x, y: 0.25, z: p.z, vx: rnd() - 0.5, vy: 0.6, vz: rnd() - 0.5, life: 0.45, size: 0.5, size1: 1.3, color: '#e9d2a6', alpha: 0.35, drag: 2 });
    }
  }

  if (k.boostT > 0) {
    kv.model.exhausts(exhausts);
    f.flame += dt * 60;
    const col = BOOST_COLORS[k.boostLevel];
    while (f.flame >= 1) {
      f.flame -= 1;
      const p = exhausts[(rnd() * 2) | 0];
      stage.sparks.emit({
        x: p.x, y: p.y, z: p.z,
        vx: -Math.sin(k.yaw) * 6 + (rnd() - 0.5) * 1.5, vy: 0.5 + rnd(), vz: -Math.cos(k.yaw) * 6 + (rnd() - 0.5) * 1.5,
        life: 0.22, size: 0.7, size1: 0.1, color: col, drag: 4, floor: false,
      });
    }
  }

  if (k.fruit >= TUNING.fruitMax) {
    f.glitter += dt * 18;
    while (f.glitter >= 1) {
      f.glitter -= 1;
      stage.sparks.emit({ x: it.pose.x + (rnd() - 0.5) * 2, y: 0.5 + rnd() * 1.5, z: it.pose.z + (rnd() - 0.5) * 2, vy: 1.2, life: 0.6, size: 0.28, size1: 0.02, color: '#ffd84a', drag: 1, floor: false });
    }
  }
}

// keep crates and mangoes in step with the session (the server decides online)
function syncPickups(stage, v) {
  const p = v.pickups();
  const cr = stage.arena3d.crates.items;
  p.crates.forEach((alive, i) => {
    if (!cr[i]) return;
    if (alive && !cr[i].alive) stage.arena3d.crates.respawn(i);
    else if (!alive && cr[i].alive) stage.arena3d.crates.smash(i);
  });
  const fr = stage.arena3d.mangoes.items;
  p.fruit.forEach((alive, i) => {
    if (!fr[i]) return;
    if (alive && !fr[i].alive) stage.arena3d.mangoes.respawn(i);
    else if (!alive && fr[i].alive) stage.arena3d.mangoes.take(i);
  });
}

// ---------------------------------------------------------------- sound toggle

let muted = store.get('muted', false);
const muteBtn = $('mute');
function applyMute() {
  sound.setMuted(muted);
  muteBtn.classList.toggle('off', muted);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
}
applyMute();
muteBtn.addEventListener('click', () => {
  muted = !muted;
  sound.start();
  applyMute();
  store.set('muted', muted);
});
$('home').addEventListener('click', () => {
  sound.click();
  toTitle();
});

// ---------------------------------------------------------------- sizing + quality

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

const perf = { t: 0, frames: 0, level: 0, wait: 2.5 };
function adaptQuality(dt) {
  perf.wait -= dt;
  if (perf.wait > 0) return;
  perf.t += dt;
  perf.frames++;
  if (perf.t < 2) return;
  const avg = perf.t / perf.frames;
  perf.t = 0;
  perf.frames = 0;
  if (avg > 1 / 45 && perf.level < 3) {
    perf.level++;
    perf.wait = 1.5;
    if (perf.level === 1) pixelRatio = Math.min(pixelRatio, 1.25);
    if (perf.level === 2) pixelRatio = 1;
    if (perf.level === 3) {
      renderer.shadowMap.enabled = false;
      for (const st of stages.values()) st.scene.traverse((o) => o.material && (o.material.needsUpdate = true));
    }
    renderer.setPixelRatio(pixelRatio);
    resize();
  }
}

// ---------------------------------------------------------------- main loop

let acc = 0;
let last = performance.now();
let time = 0;
const NEUTRAL = { steer: 0, drift: false };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  acc += dt;

  const v = view();
  const stage = getStage(v.arena);
  if (v !== shown) {
    clearKarts(stage);
    snapCamera = true;
    shown = v;
    resultsShownFor = null;
  }
  if (mode === 'online' && net) {
    // online and in the lobby: the demo plays behind the lobby card
    const inRace = v === net;
    if (inRace && !$('lobby').hidden) {
      $('lobby').hidden = true;
      setPlaying(true);
    } else if (!inRace && $('lobby').hidden && net.status !== 'closed') {
      showLobby();
    }
  }

  // fixed-rate simulation
  let steps = 0;
  const collected = [];
  while (acc >= TICK && steps < 8) {
    const playing = controls.enabled && v.localId;
    const input = !playing ? NEUTRAL : debug.autopilot ? autopilotInput(v) : controls.read(TICK);
    collected.push(...v.tick(input));
    if (net && v !== net) net.tick(NEUTRAL); // drains anything that arrived while in the lobby
    acc -= TICK;
    steps++;
  }
  if (steps === 8) acc = 0;

  const alpha = acc / TICK;
  const list = v.karts(alpha);
  const byId = new Map(list.map((it) => [it.id, it]));

  // kart models: create for newcomers, drop the departed
  list.forEach((it, i) => {
    const kv = kartVisual(stage, it.id, v, i);
    it.model = kv.model;
    kv.model.update(it.pose, it.k, dt);
    // name tags only once a kart is a little way off, so they never fill the screen
    if (kv.tag) {
      const d = Math.hypot(it.pose.x - camera.position.x, it.pose.z - camera.position.z);
      kv.tag.visible = d > 10;
      kv.tag.material.opacity = Math.min(1, (d - 10) / 6);
    }
  });
  for (const [id, kv] of stage.karts) {
    if (!byId.has(id)) {
      stage.scene.remove(kv.model.root);
      stage.karts.delete(id);
    }
  }

  onEvents(v, stage, collected, byId);
  syncPickups(stage, v);
  for (const it of list) {
    const kv = stage.karts.get(it.id);
    if (kv) kartEffects(stage, it, kv, dt); // a new race may have just cleared the models
  }
  stage.arena3d.update(dt, time);
  stage.sparks.update(dt);
  stage.puffs.update(dt);
  stage.debris.update(dt);
  stage.rings.update(dt);

  const local = v.localId ? byId.get(v.localId) : null;
  let target = local;
  if (!target) {
    const info = v.raceInfo && v.raceInfo();
    const leader = info && Object.entries(info.entrants).find(([, e]) => e.place === 1);
    target = (leader && byId.get(leader[0])) || list[0];
  }
  const follow = mode !== 'title' && !(mode === 'online' && v === attract);
  updateCamera(dt, time, target, follow);
  if (target) stage.lights.follow(target.pose.x, target.pose.z);

  const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  stage.sparks.setScale(scale);
  stage.puffs.setScale(scale);

  if (local && mode !== 'title') sound.update(dt, local.k, local.k.state === 'drift');
  else if (sound.ctx) sound.update(dt, { vx: 0, vz: 0, boostT: 0, hopT: 0, charge: 0 }, false);
  if (document.body.classList.contains('playing')) updateHud(v, list, local);
  adaptQuality(dt);
  renderer.render(stage.scene, camera);
}

// autopilot: lets the bot drive your kart (debugging and demos)
let autoBot = null;
function autopilotInput(v) {
  const me = v.karts(1).find((it) => it.id === v.localId);
  if (!me) return NEUTRAL;
  if (!autoBot || autoBot.arena !== v.arena) {
    autoBot = { arena: v.arena, bot: v.arena.track ? createPathBot(v.arena.track, { obstacles: v.arena.obstacles }) : createBot() };
  }
  return v.arena.track ? pathBotInput(autoBot.bot, me.k, TICK) : botInput(autoBot.bot, me.k, TICK);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) controls.reset();
  last = performance.now();
});

// ---------------------------------------------------------------- install as an app

// Offline cache + installability. Only where a service worker can run (served by our
// own server over https or on localhost), never inside an embedded preview.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// Android Chrome offers installing; keep the offer and show our own button for it
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('install').hidden = true;
});
window.addEventListener('appinstalled', () => ($('install').hidden = true));

document.body.classList.add('ready');
requestAnimationFrame(frame);

// handy for debugging from the console
window.karting = {
  get session() { return view(); },
  get kart() { const v = view(); return v.localId ? v.karts(1).find((it) => it.id === v.localId)?.k : null; },
  get mode() { return mode; },
  get net() { return net; },
  get autopilot() { return debug.autopilot; },
  set autopilot(on) { debug.autopilot = !!on; autoBot = null; },
  // `karting.colliders = true` outlines every collision shape, to line models up with them
  get colliders() { return debug.colliders; },
  set colliders(on) { debug.colliders = !!on; for (const st of stages.values()) st.colliders.visible = debug.colliders; },
  renderer,
};
