// A chunky toy kart with an original big-headed driver ("Pip").
// The model only draws; it never decides anything. Feed it the kart's state each frame.

import * as THREE from 'three';
import { TUNING } from '@shared/sim.js';
import { Spring, canvasTexture, clamp, damp, toon } from './util.js';

export const KART_COLORS = [
  { body: '#ff7a1a', trim: '#fff1d6', helmet: '#2e7dd7' },
  { body: '#2e7dd7', trim: '#fff1d6', helmet: '#ff7a1a' },
  { body: '#e8425a', trim: '#ffe28a', helmet: '#3fae5a' },
  { body: '#3fae5a', trim: '#fff1d6', helmet: '#e8425a' },
  { body: '#9b5de5', trim: '#ffe28a', helmet: '#ffc23d' },
  { body: '#ffc23d', trim: '#4a2c14', helmet: '#9b5de5' },
  { body: '#16b6b0', trim: '#fff1d6', helmet: '#ff5d8f' },
  { body: '#ff5d8f', trim: '#fff1d6', helmet: '#16b6b0' },
];

export const BOOST_COLORS = ['#ffffff', '#ffb02e', '#ff4f6d', '#a66bff'];

function numberTexture(n, bg, fg) {
  return canvasTexture(128, 128, (g, w) => {
    g.fillStyle = bg;
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = fg;
    g.font = '900 86px "Lilita One", "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), w / 2, w / 2 + 6);
  });
}

export class KartModel {
  constructor(scene, { colorIndex = 0, number = 1, model = null } = {}) {
    const col = KART_COLORS[colorIndex % KART_COLORS.length];

    this.root = new THREE.Group(); // position + heading
    this.lift = new THREE.Group(); // hop height
    this.chassis = new THREE.Group(); // squash, roll, drift angle
    this.root.add(this.lift);
    this.lift.add(this.chassis);
    scene.add(this.root);

    this.wheels = [];
    this.eyes = [];
    this.scarf = [];
    this.flames = [];
    this.flameMat = new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.95, depthWrite: false });
    this.flameGeo = new THREE.ConeGeometry(0.17, 1, 7);
    this.flameGeo.translate(0, 0.5, 0);
    this.flameGeo.rotateX(-Math.PI / 2); // points backward (-z)
    this.driverBase = new THREE.Euler();
    this.headBase = new THREE.Euler();
    if (model) this.buildFromModel(model, col);
    else this.buildBuiltIn(col, number);

    // soft round shadow that always sits on the ground
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 20),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(64, 64, (g, w) => {
          const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
          r.addColorStop(0, 'rgba(40,30,20,0.55)');
          r.addColorStop(1, 'rgba(40,30,20,0)');
          g.fillStyle = r;
          g.fillRect(0, 0, w, w);
        }),
        transparent: true,
        depthWrite: false,
      }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.scale.set(1, 1.35, 1);
    this.root.add(blob);
    this.blob = blob;

    // juice state
    this.squash = new Spring(260, 13, 1);
    this.roll = 0;
    this.pitch = new Spring(160, 10, 0);
    this.driftYaw = 0;
    this.wheelAngle = 0;
    this.steerVis = 0;
    this.blink = 0;
    this.nextBlink = 2;
    this.flameLen = 0;
    this.juicedGlow = 0;
    this.lean = 0;
    this.driverPitch = 0;
    this.headTurn = 0;
    this.time = 0;
  }

  // ---------------------------------------------------------------- built-in kart and Pip

  buildBuiltIn(col, number) {
    const body = toon(col.body);
    const trim = toon(col.trim);
    const dark = toon('#2a2730');
    const metal = toon('#9aa3ad');
    const skin = toon('#ffcf9e');
    const helmet = toon(col.helmet);

    const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // --- chassis (the kart faces +z)
    const c = this.chassis;
    add(c, new THREE.BoxGeometry(1.5, 0.42, 2.5), body, 0, 0.55, 0);
    add(c, new THREE.BoxGeometry(1.3, 0.3, 0.9), body, 0, 0.62, 1.55, -0.32); // nose wedge
    add(c, new THREE.BoxGeometry(1.9, 0.18, 0.35), trim, 0, 0.42, 1.95); // front bumper
    add(c, new THREE.BoxGeometry(0.35, 0.34, 1.6), trim, 0.9, 0.5, -0.05); // side pods
    add(c, new THREE.BoxGeometry(0.35, 0.34, 1.6), trim, -0.9, 0.5, -0.05);
    add(c, new THREE.BoxGeometry(1.1, 0.5, 0.7), dark, 0, 0.85, -1.05); // engine
    add(c, new THREE.BoxGeometry(1.9, 0.12, 0.5), body, 0, 1.55, -1.35); // spoiler
    add(c, new THREE.BoxGeometry(0.1, 0.55, 0.3), dark, 0.6, 1.25, -1.3);
    add(c, new THREE.BoxGeometry(0.1, 0.55, 0.3), dark, -0.6, 1.25, -1.3);
    const plate = add(c, new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: numberTexture(number, col.trim, col.body), transparent: true }), 0, 0.82, 1.55, -0.32 - Math.PI / 2 + Math.PI / 2);
    plate.rotation.set(-1.25, 0, 0);
    plate.position.set(0, 0.79, 1.56);
    plate.castShadow = false;

    // exhaust pipes and their flames
    for (const sx of [-0.32, 0.32]) {
      add(c, new THREE.CylinderGeometry(0.11, 0.13, 0.5, 8), metal, sx, 0.88, -1.5, Math.PI / 2);
      const f = new THREE.Mesh(this.flameGeo, this.flameMat);
      f.position.set(sx, 0.88, -1.75);
      f.scale.set(1, 1, 0.01);
      c.add(f);
      this.flames.push(f);
    }
    this.exhaustLocal = [new THREE.Vector3(-0.32, 0.88, -1.8), new THREE.Vector3(0.32, 0.88, -1.8)];

    // --- driver "Pip"
    const d = new THREE.Group();
    d.position.set(0, 0.8, -0.25);
    c.add(d);
    this.driver = d;
    add(d, new THREE.SphereGeometry(0.42, 10, 8), helmet, 0, 0.35, 0).scale.set(1, 1.05, 0.9); // torso
    add(d, new THREE.CylinderGeometry(0.1, 0.1, 0.75, 6), helmet, 0.38, 0.38, 0.38, -1.1, 0, -0.35); // arms
    add(d, new THREE.CylinderGeometry(0.1, 0.1, 0.75, 6), helmet, -0.38, 0.38, 0.38, -1.1, 0, 0.35);
    this.wheelSteer = add(d, new THREE.TorusGeometry(0.28, 0.06, 6, 14), dark, 0, 0.42, 0.72, -0.9);

    const head = new THREE.Group();
    head.position.set(0, 1.12, 0.05);
    d.add(head);
    this.head = head;
    add(head, new THREE.SphereGeometry(0.62, 14, 10), skin, 0, 0, 0);
    const lid = add(head, new THREE.SphereGeometry(0.66, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), helmet, 0, 0.04, -0.02);
    lid.rotation.x = -0.25;
    add(head, new THREE.BoxGeometry(0.16, 0.5, 0.2), trim, 0, 0.5, 0.1, -0.3); // helmet stripe
    // goggles pushed up on the helmet
    for (const sx of [-0.2, 0.2]) {
      add(head, new THREE.TorusGeometry(0.15, 0.05, 6, 12), metal, sx, 0.42, 0.42, -0.6);
      add(head, new THREE.CircleGeometry(0.12, 12), toon('#63d2ff'), sx, 0.43, 0.44, -0.6);
    }
    // big eyes
    for (const sx of [-0.2, 0.2]) {
      const white = add(head, new THREE.SphereGeometry(0.17, 10, 8), toon('#ffffff'), sx, 0.08, 0.5);
      white.scale.set(1, 1.25, 0.7);
      const pupil = add(head, new THREE.SphereGeometry(0.085, 8, 6), toon('#1d1726'), sx, 0.08, 0.62);
      this.eyes.push({ white, pupil, x: sx });
    }
    // grin
    const grin = add(head, new THREE.TorusGeometry(0.17, 0.035, 6, 12, Math.PI), toon('#7a2b1d'), 0, -0.2, 0.55, 0, 0, Math.PI);
    this.grin = grin;
    // ears poke out of the helmet
    add(head, new THREE.SphereGeometry(0.14, 8, 6), skin, 0.62, 0, 0).scale.set(0.6, 1, 1);
    add(head, new THREE.SphereGeometry(0.14, 8, 6), skin, -0.62, 0, 0).scale.set(0.6, 1, 1);

    // scarf that flaps in the wind
    let parent = d;
    const scarfMat = toon('#ffe28a');
    const ring = add(d, new THREE.TorusGeometry(0.3, 0.1, 6, 12), scarfMat, 0, 0.72, 0, Math.PI / 2);
    ring.castShadow = false;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.set(i === 0 ? 0.15 : 0, i === 0 ? 0.72 : 0, i === 0 ? -0.3 : -0.36);
      parent.add(g);
      add(g, new THREE.BoxGeometry(0.22, 0.05, 0.38), scarfMat, 0, 0, -0.18);
      this.scarf.push(g);
      parent = g;
    }

    // --- wheels (not squashed with the chassis)
    const tyre = new THREE.CylinderGeometry(0.42, 0.42, 0.42, 12);
    tyre.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.44, 8);
    rim.rotateZ(Math.PI / 2);
    const rearTyre = new THREE.CylinderGeometry(0.5, 0.5, 0.55, 12);
    rearTyre.rotateZ(Math.PI / 2);
    const rearRim = new THREE.CylinderGeometry(0.24, 0.24, 0.57, 8);
    rearRim.rotateZ(Math.PI / 2);
    this.rimMat = toon(col.trim);
    for (const [x, z, front] of [[0.95, 1.05, true], [-0.95, 1.05, true], [1.0, -0.95, false], [-1.0, -0.95, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, front ? 0.42 : 0.5, z);
      this.lift.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      add(spin, front ? tyre : rearTyre, dark);
      add(spin, front ? rim : rearRim, this.rimMat);
      add(spin, new THREE.BoxGeometry(front ? 0.46 : 0.58, 0.1, 0.6), dark); // tread block so spin is visible
      this.wheels.push({ pivot, spin, front });
    }
    this.rearWheelLocal = [new THREE.Vector3(1.0, 0, -0.95), new THREE.Vector3(-1.0, 0, -0.95)];
  }

  // ---------------------------------------------------------------- kart from a model file
  //
  // Contract (see client/models/README.md):
  //   wheel_fl, wheel_fr, wheel_rl, wheel_rr  each wheel, origin at its axle centre
  //   head, driver                             optional: turn and lean into corners
  //   exhaust_l, exhaust_r                     optional empties: where boost flames come out
  //   a material named "paint"                 optional: recoloured per player

  buildFromModel({ scene: src, opts }, col) {
    const model = src.clone(true);
    const holder = new THREE.Group();
    const turn = new THREE.Group();
    turn.rotation.y = THREE.MathUtils.degToRad(opts.rotateY ?? 0);
    turn.add(model);
    holder.add(turn);
    this.chassis.add(holder);

    // size it: longest horizontal side becomes `length` metres (2.6 by default), then `scale`
    holder.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(turn);
    const dims = box.getSize(new THREE.Vector3());
    const k = ((opts.length ?? 2.6) / Math.max(dims.x, dims.z, 1e-6)) * (opts.scale ?? 1);
    holder.scale.setScalar(k);
    holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(turn);
    const centre = box.getCenter(new THREE.Vector3());
    holder.position.set(-centre.x, -box.min.y + (opts.y ?? 0), -centre.z);
    this.chassis.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(turn);

    const byName = {};
    model.traverse((o) => {
      if (o.name) byName[o.name.toLowerCase()] = o;
      if (o.isMesh) {
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const painted = mats.map((m) => {
          if (m && m.name && m.name.toLowerCase() === 'paint') {
            const c = m.clone();
            c.color.set(col.body);
            return c;
          }
          return m;
        });
        o.material = Array.isArray(o.material) ? painted : painted[0];
      }
    });
    const find = (n) => byName[n];

    // wheels move out of the body so they do not squash with it
    const tmp = new THREE.Vector3();
    for (const [name, front] of [['wheel_fl', true], ['wheel_fr', true], ['wheel_rl', false], ['wheel_rr', false]]) {
      const w = find(name);
      if (!w) {
        console.warn(`[kart model] no node named "${name}": that wheel will not spin`);
        continue;
      }
      w.getWorldPosition(tmp);
      this.root.worldToLocal(tmp);
      const pivot = new THREE.Group();
      pivot.position.copy(tmp);
      this.lift.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      pivot.updateMatrixWorld(true);
      spin.attach(w);
      this.wheels.push({ pivot, spin, front });
    }
    const rear = this.wheels.filter((w) => !w.front);
    this.rearWheelLocal = rear.length
      ? rear.map((w) => new THREE.Vector3(w.pivot.position.x, 0, w.pivot.position.z))
      : [new THREE.Vector3(box.max.x * 0.8, 0, box.min.z * 0.7), new THREE.Vector3(box.min.x * 0.8, 0, box.min.z * 0.7)];
    if (this.rearWheelLocal.length === 1) this.rearWheelLocal.push(this.rearWheelLocal[0].clone());

    this.head = find('head') || null;
    this.driver = find('driver') || null;
    if (this.head) this.headBase.copy(this.head.rotation);
    if (this.driver) this.driverBase.copy(this.driver.rotation);

    // boost flames
    const ex = ['exhaust_l', 'exhaust_r'].map(find).filter(Boolean);
    this.exhaustLocal = ex.length
      ? ex.map((e) => this.chassis.worldToLocal(e.getWorldPosition(new THREE.Vector3())))
      : [-0.3, 0.3].map((x) => new THREE.Vector3(x, box.min.y + (box.max.y - box.min.y) * 0.35, box.min.z));
    if (this.exhaustLocal.length === 1) this.exhaustLocal.push(this.exhaustLocal[0].clone());
    for (const p of this.exhaustLocal) {
      const f = new THREE.Mesh(this.flameGeo, this.flameMat);
      f.position.copy(p);
      f.scale.set(1, 1, 0.01);
      this.chassis.add(f);
      this.flames.push(f);
    }
  }

  kick(type, strength = 1) {
    if (type === 'hop') this.squash.v += 7 * strength;
    if (type === 'land') this.squash.v -= 6 * strength;
    if (type === 'bonk') {
      this.squash.v -= 9 * strength;
      this.pitch.v -= 6 * strength;
    }
    if (type === 'boost') this.pitch.v += 5 * strength;
    if (type === 'crate') this.squash.v -= 4;
  }

  /** world-space positions of the rear tyres' contact patches and the exhaust tips */
  rearContacts(out) {
    this.root.updateMatrixWorld(true);
    out[0].copy(this.rearWheelLocal[0]).applyMatrix4(this.root.matrixWorld);
    out[1].copy(this.rearWheelLocal[1]).applyMatrix4(this.root.matrixWorld);
    return out;
  }
  exhausts(out) {
    this.chassis.updateMatrixWorld(true);
    out[0].copy(this.exhaustLocal[0]).applyMatrix4(this.chassis.matrixWorld);
    out[1].copy(this.exhaustLocal[1]).applyMatrix4(this.chassis.matrixWorld);
    return out;
  }

  /**
   * @param pose interpolated {x, z, yaw}
   * @param k    the kart's sim state (speed, steer, drift, hop, boost...)
   */
  update(pose, k, dt) {
    this.time += dt;
    const speed = Math.hypot(k.vx, k.vz);
    const fwd = k.vx * Math.sin(k.yaw) + k.vz * Math.cos(k.yaw);
    const drifting = k.state === 'drift';

    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.yaw;

    // hop arc
    const hopP = k.hopT > 0 ? 1 - k.hopT / TUNING.hopTime : 0;
    this.lift.position.y = Math.sin(hopP * Math.PI) * TUNING.hopHeight;
    this.blob.scale.setScalar(1 - this.lift.position.y * 0.35);
    this.blob.scale.y *= 1.35;

    // squash and stretch, keeping volume
    const sy = clamp(this.squash.step(1, dt), 0.6, 1.5);
    const sxz = 1 / Math.sqrt(sy);

    // drift: the kart swings its tail out a bit more than the physics angle
    this.driftYaw = damp(this.driftYaw, drifting ? -k.driftDir * 0.24 : 0, 10, dt);
    this.roll = damp(this.roll, (drifting ? k.driftDir * 0.12 : k.steer * 0.07) * clamp(speed / 20, 0, 1), 8, dt);
    const pitch = this.pitch.step(0, dt);

    this.chassis.scale.set(sxz, sy, sxz);
    this.chassis.rotation.set(-pitch * 0.08, this.driftYaw, this.roll, 'YXZ');

    // wheels: spin with distance, front ones steer (counter-steer while drifting)
    this.wheelAngle += (fwd * dt) / 0.45;
    const steerTarget = drifting ? k.driftDir * 0.35 - k.steer * 0.15 : -k.steer * 0.45;
    this.steerVis = damp(this.steerVis, steerTarget, 14, dt);
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelAngle;
      w.pivot.rotation.y = w.front ? this.steerVis + this.driftYaw : this.driftYaw * 0.3;
    }
    if (this.wheelSteer) this.wheelSteer.rotation.z = -this.steerVis * 1.6;

    // driver leans into turns and back under boost
    this.lean = damp(this.lean, (drifting ? k.driftDir : k.steer) * 0.22, 7, dt);
    this.driverPitch = damp(this.driverPitch, k.boostT > 0 ? -0.22 : 0, 8, dt);
    this.headTurn = damp(this.headTurn, -(drifting ? k.driftDir : k.steer) * 0.35, 6, dt);
    if (this.driver) {
      this.driver.rotation.z = this.driverBase.z - this.lean;
      this.driver.rotation.x = this.driverBase.x + this.driverPitch;
    }
    if (this.head) this.head.rotation.y = this.headBase.y + this.headTurn;

    // blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.12;
      this.nextBlink = 1.8 + ((this.time * 7.13) % 2.5);
    }
    this.blink = Math.max(0, this.blink - dt);
    const eyeY = this.blink > 0 ? 0.15 : 1.25;
    for (const e of this.eyes) e.white.scale.y = damp(e.white.scale.y, eyeY, 30, dt);

    // scarf flutter
    this.scarf.forEach((g, i) => {
      g.rotation.x = 0.25 + Math.sin(this.time * (12 + speed * 0.4) + i * 1.3) * (0.15 + speed * 0.012);
      g.rotation.y = Math.sin(this.time * 9 + i) * 0.2 - this.lean * 0.6;
    });

    // exhaust flames
    const target = k.boostT > 0 ? 0.9 + k.boostLevel * 0.35 : 0;
    this.flameLen = damp(this.flameLen, target, k.boostT > 0 ? 25 : 10, dt);
    const flick = 0.85 + Math.sin(this.time * 60) * 0.15;
    for (const f of this.flames) {
      f.visible = this.flameLen > 0.03;
      f.scale.set(1 + this.flameLen * 0.4, 1 + this.flameLen * 0.4, this.flameLen * flick);
    }
    if (k.boostT > 0) this.flameMat.color.set(BOOST_COLORS[k.boostLevel]);

    // juiced: rims glow
    this.juicedGlow = damp(this.juicedGlow, k.fruit >= TUNING.fruitMax ? 1 : 0, 3, dt);
    const pulse = this.juicedGlow * (0.55 + Math.sin(this.time * 6) * 0.45);
    if (this.rimMat) this.rimMat.emissive.setRGB(pulse * 1.0, pulse * 0.7, pulse * 0.1);
  }
}
