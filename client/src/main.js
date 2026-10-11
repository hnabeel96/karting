// Boots the game: fixed-step simulation from /shared, drawn with three.js.
// Step 1 is solo: one kart, one arena. The loop is already shaped for multiplayer:
// inputs go into stepWorld() at a fixed tick, and rendering interpolates between ticks.

import * as THREE from 'three';
import { TICK, TUNING, createWorld, addKart, stepWorld, inWindow } from '@shared/sim.js';
import { createBot, botInput } from '@shared/bot.js';
import temple from '@shared/arenas/temple.js';
import { buildSky, buildLights, buildArena, PALETTE } from './arena3d.js';
import { KartModel, BOOST_COLORS } from './kartModel.js';
import { Particles, SkidMarks, Debris, Rings } from './fx.js';
import { Controls } from './input.js';
import { Sound } from './audio.js';
import { damp, dampAngle, lerp, lerpAngle } from './util.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 600);

buildSky(scene);
const lights = buildLights(scene);

// ---------------------------------------------------------------- game state

let world;
let kart;
let arena3d;
const model = new KartModel(scene, { colorIndex: 0, number: 1 });
const sparks = new Particles(scene, 500, { additive: true, soft: 0.2 });
const puffs = new Particles(scene, 420, { additive: false, soft: 0.55 });
const skids = new SkidMarks(scene);
const debris = new Debris(scene);
const rings = new Rings(scene);
const sound = new Sound();
const controls = new Controls({
  steerZone: $('steer-zone'),
  driftZone: $('drift-zone'),
  pill: $('steer-pill'),
  knob: $('steer-knob'),
  driftBtn: $('drift-btn'),
});

let mode = 'attract'; // 'attract' | 'play'
let bot = createBot();
const prev = { x: 0, z: 0, yaw: 0 };
const pose = { x: 0, z: 0, yaw: 0 };

function newWorld(attract = false) {
  world = createWorld(temple);
  kart = addKart(world, 'me', 0);
  bot = createBot();
  if (attract) {
    // the demo driver starts on the ring around the temple, already rolling
    Object.assign(kart, { x: 0, z: -16, yaw: Math.PI / 2, vx: 18, vz: 0 });
  }
  Object.assign(prev, { x: kart.x, z: kart.z, yaw: kart.yaw });
}
newWorld(true);
arena3d = buildArena(scene, temple, world);

// ---------------------------------------------------------------- camera

const cam = {
  yaw: kart.yaw,
  fov: 62,
  trauma: 0,
  pos: new THREE.Vector3(),
  look: new THREE.Vector3(),
  orbit: 0,
  punch: 0,
};

function baseFov() {
  return camera.aspect > 1.9 ? 54 : camera.aspect < 1 ? 74 : 62;
}

function snapCamera() {
  cam.yaw = kart.yaw;
  cam.fov = baseFov();
  cam.trauma = 0;
  cam.pos.set(kart.x - Math.sin(kart.yaw) * 7.5, 3.4, kart.z - Math.cos(kart.yaw) * 7.5);
  cam.look.set(kart.x, 1, kart.z);
}
snapCamera();

const shakeVec = new THREE.Vector3();
function updateCamera(dt, t) {
  const speed = Math.hypot(kart.vx, kart.vz);
  if (mode === 'attract') {
    cam.orbit += dt * 0.16;
    const r = 12.5;
    const tx = pose.x + Math.sin(cam.orbit) * r;
    const tz = pose.z + Math.cos(cam.orbit) * r;
    cam.pos.x = damp(cam.pos.x, tx, 2.2, dt);
    cam.pos.y = damp(cam.pos.y, 5.2, 2.2, dt);
    cam.pos.z = damp(cam.pos.z, tz, 2.2, dt);
    cam.look.set(pose.x, 1.1, pose.z);
    cam.fov = damp(cam.fov, baseFov() + 4, 2, dt);
  } else {
    // follow the direction of travel while sliding, the nose otherwise
    const velYaw = Math.atan2(kart.vx, kart.vz);
    const target = kart.state === 'drift' && speed > 3 ? lerpAngle(pose.yaw, velYaw, 0.6) : pose.yaw;
    cam.yaw = dampAngle(cam.yaw, target, kart.state === 'drift' ? 3.2 : 4.5, dt);
    const boosting = kart.boostT > 0;
    const dist = 6.6 + speed * 0.05 + (boosting ? 0.9 : 0);
    cam.pos.x = pose.x - Math.sin(cam.yaw) * dist;
    cam.pos.z = pose.z - Math.cos(cam.yaw) * dist;
    cam.pos.y = damp(cam.pos.y, 3.1 + model.lift.position.y * 0.5, 6, dt);
    cam.look.set(pose.x + Math.sin(cam.yaw) * 4, 1.0 + model.lift.position.y * 0.4, pose.z + Math.cos(cam.yaw) * 4);
    const fovT = baseFov() + speed * 0.12 + (boosting ? 8 + kart.boostLevel * 2 : 0) + cam.punch;
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

function addTrauma(v) {
  cam.trauma = Math.min(1, cam.trauma + v);
}

// ---------------------------------------------------------------- HUD

const hud = {
  fruit: $('fruit-count'),
  fruitBox: $('fruit-box'),
  crates: $('crate-count'),
  crateBox: $('crate-box'),
  juiced: $('juiced'),
  callout: $('callout'),
  ring: $('charge-ring'),
  btn: $('drift-btn'),
  pips: [...document.querySelectorAll('#pips i')],
  speedlines: $('speedlines'),
  flyers: $('flyers'),
};
const RING_LEN = 2 * Math.PI * 44;

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('bump');
}

let calloutTimer = 0;
function callout(text, cls = '') {
  const el = hud.callout;
  el.textContent = text;
  el.className = '';
  void el.offsetWidth;
  el.className = 'show ' + cls;
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => (el.className = ''), 900);
}

const projV = new THREE.Vector3();
function flyMango(x, z) {
  if (mode !== 'play') return;
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

function updateHud() {
  hud.fruit.textContent = kart.fruit;
  hud.crates.textContent = kart.crates;
  hud.juiced.hidden = kart.fruit < TUNING.fruitMax;

  const drifting = kart.state === 'drift';
  const c = drifting ? Math.min(kart.charge, 1) : 0;
  hud.ring.style.strokeDashoffset = String(RING_LEN * (1 - c));
  const hot = drifting && kart.pumps < TUNING.maxPumps && inWindow(kart.charge);
  const late = drifting && kart.charge > TUNING.windowHi;
  hud.btn.classList.toggle('hot', hot);
  hud.btn.classList.toggle('late', late);
  hud.btn.classList.toggle('drifting', drifting);
  hud.pips.forEach((p, i) => p.classList.toggle('on', drifting && i < kart.pumps));
  hud.btn.style.setProperty('--next', BOOST_COLORS[Math.min(kart.pumps + 1, 3)]);

  const lines = kart.boostT > 0 ? 0.35 + kart.boostLevel * 0.2 : 0;
  hud.speedlines.style.opacity = String(lines);
}

// ---------------------------------------------------------------- effects

const contacts = [new THREE.Vector3(), new THREE.Vector3()];
const lastContacts = [new THREE.Vector3(), new THREE.Vector3()];
let hadContacts = false;
const exhausts = [new THREE.Vector3(), new THREE.Vector3()];
let sparkAcc = 0;
let dustAcc = 0;
let flameAcc = 0;
let glitterAcc = 0;
let prevCharge = 0;
const rnd = Math.random;

function dustBurst(x, z, n, color = PALETTE.sand, spread = 4) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const s = spread * (0.4 + rnd() * 0.6);
    puffs.emit({
      x: x + Math.sin(a) * 0.4, y: 0.3, z: z + Math.cos(a) * 0.4,
      vx: Math.sin(a) * s, vy: 1 + rnd() * 2, vz: Math.cos(a) * s,
      life: 0.5 + rnd() * 0.4, size: 0.9, size1: 2.2, color, alpha: 0.7, drag: 3,
    });
  }
}

function onEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'hop':
        model.kick('hop');
        sound.hop();
        dustBurst(kart.x, kart.z, 5, PALETTE.sand, 2.5);
        break;
      case 'land':
        model.kick('land');
        sound.land();
        break;
      case 'boost':
        model.kick('boost', 0.6 + e.level * 0.3);
        sound.boost(e.level);
        rings.spawn(kart.x, 0.15, kart.z, BOOST_COLORS[e.level], { r0: 1, r1: 5 + e.level, life: 0.4 });
        cam.punch = 4 + e.level * 2;
        addTrauma(0.12 + e.level * 0.05);
        if (mode === 'play') callout(['', 'Boost!', 'Double!', 'Triple!'][e.level], 'lv' + e.level);
        break;
      case 'fizzle':
        sound.fizzle();
        model.exhausts(exhausts);
        for (let i = 0; i < 10; i++) {
          const p = exhausts[i % 2];
          puffs.emit({ x: p.x, y: p.y, z: p.z, vx: (rnd() - 0.5) * 2, vy: 1.5 + rnd(), vz: (rnd() - 0.5) * 2, life: 0.7, size: 0.6, size1: 1.8, color: '#3b3433', alpha: 0.75, drag: 2, floor: false });
        }
        if (mode === 'play') callout(e.late ? 'Too late' : 'Too early', 'miss');
        break;
      case 'bonk':
        model.kick('bonk', Math.min(1.4, e.impact / 12));
        sound.bonk(e.impact);
        addTrauma(Math.min(0.6, e.impact / 30));
        dustBurst(e.x, e.z, 8, PALETTE.stoneLight, 5);
        for (let i = 0; i < 10; i++) {
          sparks.emit({ x: e.x, y: 0.8, z: e.z, vx: (rnd() - 0.5) * 12, vy: 2 + rnd() * 5, vz: (rnd() - 0.5) * 12, life: 0.3 + rnd() * 0.2, size: 0.35, size1: 0.05, color: '#fff3c4', gravity: 18, drag: 2 });
        }
        break;
      case 'crate':
        arena3d.crates.smash(e.index);
        model.kick('crate');
        sound.crate();
        addTrauma(0.28);
        cam.punch = 3;
        debris.burst(e.x, 0.8, e.z, e.vx, e.vz, [PALETTE.wood, PALETTE.woodDark, '#d9934f', '#ffd36b'], 16, rnd);
        dustBurst(e.x, e.z, 10, '#d8b27a', 6);
        rings.spawn(e.x, 0.15, e.z, '#ffd36b', { r0: 0.5, r1: 4, life: 0.35, alpha: 0.7 });
        break;
      case 'crateBack': {
        const c = world.crates[e.index];
        arena3d.crates.respawn(e.index);
        dustBurst(c.x, c.z, 6, '#ffffff', 3);
        break;
      }
      case 'fruit':
        arena3d.mangoes.take(e.index);
        sound.fruit();
        flyMango(e.x, e.z);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          sparks.emit({ x: e.x, y: 1.1, z: e.z, vx: Math.sin(a) * 4, vy: 2 + rnd() * 2, vz: Math.cos(a) * 4, life: 0.35, size: 0.4, size1: 0.05, color: '#ffc23d', gravity: 6, drag: 3 });
        }
        break;
      case 'fruitBack':
        arena3d.mangoes.respawn(e.index);
        break;
      case 'juiced':
        sound.juiced();
        if (mode === 'play') callout('Juiced!', 'juiced');
        rings.spawn(kart.x, 0.2, kart.z, '#ffc23d', { r0: 1, r1: 8, life: 0.6 });
        break;
      default:
    }
  }
}

function frameEffects(dt) {
  const drifting = kart.state === 'drift';
  const speed = Math.hypot(kart.vx, kart.vz);
  model.rearContacts(contacts);
  const grounded = kart.hopT <= 0;

  // skid marks + sparks while drifting
  if (drifting && grounded) {
    if (hadContacts) {
      skids.add(lastContacts[0], contacts[0]);
      skids.add(lastContacts[1], contacts[1]);
    }
    const hot = inWindow(kart.charge) && kart.pumps < TUNING.maxPumps;
    const late = kart.charge > TUNING.windowHi && kart.pumps < TUNING.maxPumps;
    sparkAcc += dt * (hot ? 70 : 34);
    while (sparkAcc >= 1) {
      sparkAcc -= 1;
      const p = contacts[(Math.random() * 2) | 0];
      if (late) {
        puffs.emit({ x: p.x, y: 0.35, z: p.z, vx: (rnd() - 0.5) * 2, vy: 1 + rnd(), vz: (rnd() - 0.5) * 2, life: 0.5, size: 0.6, size1: 1.6, color: '#5a5350', alpha: 0.6, drag: 2 });
      } else {
        const color = hot ? BOOST_COLORS[Math.min(kart.pumps + 1, 3)] : '#fff1c9';
        sparks.emit({
          x: p.x, y: 0.2, z: p.z,
          vx: -kart.vx * 0.15 + (rnd() - 0.5) * 5, vy: 2 + rnd() * 3, vz: -kart.vz * 0.15 + (rnd() - 0.5) * 5,
          life: 0.25 + rnd() * 0.2, size: hot ? 0.55 : 0.32, size1: 0.05, color, gravity: 14, drag: 1.5,
        });
      }
    }
    // a soft tyre-smoke haze
    if (Math.random() < dt * 14) {
      const p = contacts[(Math.random() * 2) | 0];
      puffs.emit({ x: p.x, y: 0.3, z: p.z, vy: 0.8, life: 0.7, size: 0.8, size1: 2.4, color: '#f2e6d0', alpha: 0.45, drag: 2 });
    }
  }
  hadContacts = drifting && grounded;
  lastContacts[0].copy(contacts[0]);
  lastContacts[1].copy(contacts[1]);

  // entering the boost window: a "ting" and a flash so you can feel the timing
  if (drifting && kart.held && kart.pumps < TUNING.maxPumps && prevCharge < TUNING.windowLo && kart.charge >= TUNING.windowLo) {
    sound.window();
  }
  prevCharge = drifting ? kart.charge : 0;

  // sand kicked up at speed
  if (grounded && speed > 12 && !drifting) {
    dustAcc += dt * speed * 0.35;
    while (dustAcc >= 1) {
      dustAcc -= 1;
      const p = contacts[(Math.random() * 2) | 0];
      puffs.emit({ x: p.x, y: 0.25, z: p.z, vx: (rnd() - 0.5), vy: 0.6, vz: (rnd() - 0.5), life: 0.45, size: 0.5, size1: 1.3, color: '#e9d2a6', alpha: 0.35, drag: 2 });
    }
  }

  // boost fire
  if (kart.boostT > 0) {
    model.exhausts(exhausts);
    flameAcc += dt * 60;
    const col = BOOST_COLORS[kart.boostLevel];
    while (flameAcc >= 1) {
      flameAcc -= 1;
      const p = exhausts[(Math.random() * 2) | 0];
      sparks.emit({
        x: p.x, y: p.y, z: p.z,
        vx: -Math.sin(kart.yaw) * 6 + (rnd() - 0.5) * 1.5, vy: 0.5 + rnd(), vz: -Math.cos(kart.yaw) * 6 + (rnd() - 0.5) * 1.5,
        life: 0.22, size: 0.7, size1: 0.1, color: col, drag: 4, floor: false,
      });
    }
  }

  // juiced: a golden glitter trail
  if (kart.fruit >= TUNING.fruitMax) {
    glitterAcc += dt * 18;
    while (glitterAcc >= 1) {
      glitterAcc -= 1;
      sparks.emit({ x: pose.x + (rnd() - 0.5) * 2, y: 0.5 + rnd() * 1.5, z: pose.z + (rnd() - 0.5) * 2, vy: 1.2, life: 0.6, size: 0.28, size1: 0.02, color: '#ffd84a', drag: 1, floor: false });
    }
  }
}

// ---------------------------------------------------------------- modes

function startPlay() {
  sound.start();
  sound.click();
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

  newWorld();
  resetVisuals();
  mode = 'play';
  controls.enabled = true;
  controls.reset();
  document.body.classList.add('playing');
  snapCamera();
}

function toTitle() {
  mode = 'attract';
  controls.enabled = false;
  controls.reset();
  document.body.classList.remove('playing');
  newWorld(true);
  resetVisuals();
  snapCamera();
}

function resetVisuals() {
  world.crates.forEach((_, i) => arena3d.crates.respawn(i));
  world.fruit.forEach((_, i) => arena3d.mangoes.respawn(i));
  hadContacts = false;
  prevCharge = 0;
}

$('play').addEventListener('click', startPlay);
$('home').addEventListener('click', () => {
  sound.click();
  toTitle();
});
let muted = false;
try {
  muted = localStorage.getItem('karting.muted') === '1';
} catch {}
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
  try {
    localStorage.setItem('karting.muted', muted ? '1' : '0');
  } catch {}
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

// drop resolution, then shadows, if the phone cannot keep up
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
      scene.traverse((o) => o.material && (o.material.needsUpdate = true));
    }
    renderer.setPixelRatio(pixelRatio);
    resize();
  }
}

// ---------------------------------------------------------------- main loop

// type `karting.autopilot = true` in the console to let the bot drive
const debug = { autopilot: false };

let acc = 0;
let last = performance.now();
let time = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  acc += dt;

  let steps = 0;
  while (acc >= TICK && steps < 8) {
    prev.x = kart.x;
    prev.z = kart.z;
    prev.yaw = kart.yaw;
    const input = mode === 'play' && !debug.autopilot ? controls.read(TICK) : botInput(bot, kart, TICK);
    onEvents(stepWorld(world, { me: input }));
    acc -= TICK;
    steps++;
  }
  if (steps === 8) acc = 0;

  const a = acc / TICK;
  pose.x = lerp(prev.x, kart.x, a);
  pose.z = lerp(prev.z, kart.z, a);
  pose.yaw = lerpAngle(prev.yaw, kart.yaw, a);

  model.update(pose, kart, dt);
  arena3d.update(dt, time);
  frameEffects(dt);
  sparks.update(dt);
  puffs.update(dt);
  debris.update(dt);
  rings.update(dt);
  lights.follow(pose.x, pose.z);
  updateCamera(dt, time);

  const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  sparks.setScale(scale);
  puffs.setScale(scale);

  sound.update(dt, kart, kart.state === 'drift');
  if (mode === 'play') updateHud();
  adaptQuality(dt);
  renderer.render(scene, camera);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) controls.reset();
  last = performance.now();
});

document.body.classList.add('ready');
requestAnimationFrame(frame);

// handy for debugging from the console
window.karting = {
  get world() { return world; },
  get kart() { return kart; },
  get autopilot() { return debug.autopilot; },
  set autopilot(v) { debug.autopilot = !!v; if (v) { bot = createBot(); } },
  renderer,
};
