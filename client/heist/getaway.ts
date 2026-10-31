import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOCKS, CITY, HALF, HOUSE, roadAt, roadRoute, signedSpeed, type GetawayState } from './getaway-sim';

const mat = (color: string, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const glow = (color: string, intensity = 2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

/** Window grid for one 6 m x 6 m facade tile: two storeys of three bays, some lit. */
function facadeTexture(seed: number, warm: boolean) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  let s = seed; const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  g.fillStyle = warm ? '#1d1a18' : '#141a22'; g.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
    const lit = rnd() < 0.3;
    g.fillStyle = lit ? (warm ? `hsl(38 90% ${55 + rnd() * 20}%)` : `hsl(200 70% ${60 + rnd() * 20}%)`) : '#0b0f15';
    g.fillRect(16 + k * 82, 30 + r * 128, 54, 74);
    g.fillStyle = '#0006'; g.fillRect(16 + k * 82, 30 + r * 128, 54, 9);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#1b1c1e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { const v = 20 + Math.random() * 26; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** A soft additive cone in front of a vehicle so headlights read on the road. */
function beam(length: number, color = '#fff2cf') {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, length, 20, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide }));
  cone.rotation.x = -Math.PI / 2; cone.position.set(0, 0.8, 2.4 + length / 2);
  return cone;
}

/** A vehicle split into a sprung body and four wheels, so it can roll, steer, squat, dive and lean. */
interface Rig {
  /** Ground-level pose: position and heading. */
  root: THREE.Group;
  /** Everything above the axles; pivots at axle height on the suspension. */
  body: THREE.Group;
  wheels: { pivot: THREE.Group; tire: THREE.Group; front: boolean }[];
  radius: number;
  spin: number; steer: number; accel: number; yawRate: number;
  roll: number; rollV: number; pitch: number; pitchV: number; lift: number; liftV: number;
  last: { along: number; yaw: number } | null;
}
const AXLE = 0.6;

/** Tyre with a metal rim, five spokes and a hub, so you can see it turn. Axis along x. */
function wheel(radius: number, rubber: THREE.Material, rim: THREE.Material) {
  const tire = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; tire.add(mesh); return mesh; };
  add(new THREE.CylinderGeometry(radius, radius, 0.32, 22).rotateZ(Math.PI / 2), rubber);
  // Raised tread blocks around the tyre, so the roll reads even from straight behind.
  const lug = mat('#3d4148', 0.8);
  for (let k = 0; k < 14; k++) { const a = (k * Math.PI * 2) / 14; const block = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.1), lug); block.position.set(0, Math.cos(a) * radius, Math.sin(a) * radius); block.rotation.x = -a; tire.add(block); }
  add(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, 0.335, 18).rotateZ(Math.PI / 2), rim);
  for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.35, radius * 1.12, 0.07).rotateX((k * Math.PI * 2) / 5), rubber);
  add(new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, 0.36, 10).rotateZ(Math.PI / 2), rim);
  return tire;
}

function vehicle(police: boolean): Rig {
  const root = new THREE.Group(), body = new THREE.Group(), shell = new THREE.Group();
  body.position.y = AXLE; shell.position.y = -AXLE; body.add(shell); root.add(body);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; shell.add(mesh); return mesh; };
  const dark = mat('#0d1015', 0.3, 0.2), glass = new THREE.MeshStandardMaterial({ color: '#0e1a24', roughness: 0.1, metalness: 0.6 });
  if (police) {
    const paint = mat('#0c0f14', 0.35, 0.5);
    add(new THREE.BoxGeometry(2, 0.75, 4.6), paint, 0, 0.78, 0);
    add(new THREE.BoxGeometry(2.02, 0.42, 2.0), mat('#e8ecf1', 0.4), 0, 0.8, 0.1);
    add(new THREE.BoxGeometry(1.7, 0.6, 2.3), glass, 0, 1.43, -0.2);
    add(new THREE.BoxGeometry(0.6, 0.15, 0.3), glow('#ff2340', 4), -0.4, 1.8, -0.2).name = 'red';
    add(new THREE.BoxGeometry(0.6, 0.15, 0.3), glow('#2a6bff', 4), 0.4, 1.8, -0.2).name = 'blue';
  } else {
    // A white panel van with the crew's amber stripe, lit enough to read from behind at night.
    const paint = mat('#f1ede4', 0.35, 0.15);
    add(new THREE.BoxGeometry(2.1, 2.0, 3.6), paint, 0, 1.43, -0.7);
    add(new THREE.BoxGeometry(2.1, 1.3, 1.6), paint, 0, 1.08, 1.85);
    add(new THREE.BoxGeometry(1.9, 0.6, 0.1), glass, 0, 1.53, 2.66);
    for (const x of [-1.06, 1.06]) add(new THREE.BoxGeometry(0.04, 0.5, 1.2), glass, x, 1.48, 1.8);
    add(new THREE.BoxGeometry(2.12, 0.18, 3.62), mat('#ffb547', 0.4), 0, 1.33, -0.7);
    add(new THREE.BoxGeometry(0.03, 1.8, 0.02), dark, 0, 1.43, -2.51);
    for (const x of [-1.2, 1.2]) add(new THREE.BoxGeometry(0.12, 0.2, 0.25), dark, x, 1.68, 2.4);
    // Wheel arches over the tyres.
    for (const x of [-1.07, 1.07]) for (const z of [-1.85, 1.6]) add(new THREE.BoxGeometry(0.08, 0.16, 1.15), dark, x, 0.98, z);
  }
  const front = police ? 2.31 : 2.66, rear = police ? -2.31 : -2.52;
  for (const x of [-0.7, 0.7]) {
    add(new THREE.BoxGeometry(0.4, 0.18, 0.05), glow('#fff4d6', 3), x, 0.93, front);
    add(new THREE.BoxGeometry(0.4, 0.15, 0.05), glow('#ff2a2a', 1.2), x, 0.98, rear).name = 'tail';
  }
  const b = beam(police ? 14 : 18); b.position.y -= AXLE - 0.08; body.add(b);
  const radius = 0.42, rubber = mat('#1c1f23', 0.85), rim = mat(police ? '#b8c0c8' : '#e2e5ea', 0.25, 0.85);
  const wheels: Rig['wheels'] = [];
  // Wheels sit out at the body edges and the rear axle near the bumper, where the chase camera can see them.
  for (const x of [-1, 1]) for (const z of [police ? -1.5 : -1.85, 1.6]) {
    const pivot = new THREE.Group(); pivot.position.set(x * 1.1, radius, z);
    const tire = wheel(radius, rubber, rim); pivot.add(tire); root.add(pivot);
    wheels.push({ pivot, tire, front: z > 0 });
  }
  return { root, body, wheels, radius, spin: 0, steer: 0, accel: 0, yawRate: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, lift: 0, liftV: 0, last: null };
}

const turn = (a: number, b: number) => ((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
/** Damped spring toward `target`; slightly underdamped so the body settles with a little overshoot. */
function spring(value: number, velocity: number, target: number, dt: number, stiffness = 120, damping = 11): [number, number] {
  velocity += ((target - value) * stiffness - velocity * damping) * dt;
  return [value + velocity * dt, velocity];
}

/**
 * Pose the rig for this frame: wheels roll with the distance covered and the fronts steer;
 * the body squats under power, dives under braking, leans out of corners and shudders on impacts.
 * `steer` is the driver's input (-1..1) or null to infer it from how the car is turning.
 */
function animateRig(rig: Rig, pose: { x: number; z: number; yaw: number }, vx: number, vz: number, dt: number, time: number, steer: number | null, impact = 0) {
  rig.root.position.set(pose.x, 0, pose.z);
  rig.root.rotation.y = pose.yaw;
  if (dt <= 0) return;
  const along = vx * Math.sin(pose.yaw) + vz * Math.cos(pose.yaw), dtc = Math.max(dt, 1 / 240);
  if (rig.last) {
    rig.accel += ((along - rig.last.along) / dtc - rig.accel) * (1 - Math.exp(-8 * dt));
    rig.yawRate += (turn(pose.yaw, rig.last.yaw) / dtc - rig.yawRate) * (1 - Math.exp(-12 * dt));
  }
  rig.last = { along, yaw: pose.yaw };
  rig.spin += (along * dt) / rig.radius;
  const inferred = Math.atan((rig.yawRate * 3.1) / Math.max(Math.abs(along), 1.5)) * Math.sign(along || 1);
  const want = THREE.MathUtils.clamp(steer === null ? inferred : steer * 0.5 / (1 + Math.abs(along) / 30), -0.5, 0.5);
  rig.steer += (want - rig.steer) * (1 - Math.exp(-12 * dt));
  for (const w of rig.wheels) { w.tire.rotation.x = rig.spin; w.pivot.rotation.y = w.front ? rig.steer : 0; }
  if (impact > 3) { rig.liftV += impact * 0.025; rig.pitchV += impact * 0.02 * (Math.random() < 0.5 ? -1 : 1); rig.rollV += impact * 0.02 * (Math.random() - 0.5); }
  const road = Math.min(1, Math.abs(along) / 12) * (Math.sin(time * 0.013 + pose.x) * 0.012 + Math.sin(time * 0.031) * 0.006);
  [rig.pitch, rig.pitchV] = spring(rig.pitch, rig.pitchV, THREE.MathUtils.clamp(-rig.accel * 0.007, -0.07, 0.07), dt);
  [rig.roll, rig.rollV] = spring(rig.roll, rig.rollV, THREE.MathUtils.clamp(along * rig.yawRate * 0.011, -0.1, 0.1), dt);
  [rig.lift, rig.liftV] = spring(rig.lift, rig.liftV, road, dt, 160, 13);
  rig.body.rotation.set(rig.pitch, 0, rig.roll);
  rig.body.position.y = AXLE + rig.lift;
}

/** Positions captured just before the latest physics step, for smooth in-between frames. */
export type PoseSnapshot = { van: { x: number; z: number; yaw: number }; cops: Map<number, { x: number; z: number; yaw: number }> };
export function poseSnapshot(state: GetawayState): PoseSnapshot {
  return { van: { x: state.van.x, z: state.van.z, yaw: state.van.yaw }, cops: new Map(state.cops.map((c) => [c.id, { x: c.x, z: c.z, yaw: c.yaw }])) };
}
const blend = (from: { x: number; z: number; yaw: number } | undefined, to: { x: number; z: number; yaw: number }, a: number) =>
  from ? { x: from.x + (to.x - from.x) * a, z: from.z + (to.z - from.z) * a, yaw: from.yaw + turn(to.yaw, from.yaw) * a } : { x: to.x, z: to.z, yaw: to.yaw };

/** The crew's getaway house: a brick two-storey with a garage that rolls up when the van arrives. */
function getawayHouse() {
  const house = new THREE.Group();
  const brick = mat('#5b3a2e', 0.85), trim = mat('#d9d2c3', 0.6), roof = mat('#2a2522', 0.8);
  const add = (size: [number, number, number], m: THREE.Material, x: number, y: number, z: number) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), m); mesh.position.set(x, y, z); house.add(mesh); return mesh; };
  add([16, 7, 10], brick, 0, 3.5, -5);
  add([16.6, 0.4, 10.6], trim, 0, 7.2, -5);
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 5.6, 3, 4, 1), roof); ridge.rotation.y = Math.PI / 4; ridge.scale.set(1.45, 1, 0.95); ridge.position.set(0, 8.9, -5); house.add(ridge);
  add([5.6, 3.6, 0.3], trim, -3, 1.8, 0.05);
  const door = new THREE.Group(); door.name = 'garage-door';
  for (let k = 0; k < 7; k++) { const slat = new THREE.Mesh(new THREE.BoxGeometry(5, 0.46, 0.12), mat('#7d786e', 0.55, 0.3)); slat.position.y = 0.25 + k * 0.48; door.add(slat); }
  door.position.set(-3, 0, 0.18); house.add(door);
  add([5, 3.4, 0.05], mat('#0c0c0c', 1), -3, 1.7, 0.08);
  add([1.2, 2.3, 0.15], mat('#3b2a1e', 0.6), 4, 1.15, 0.1);
  for (const [x, y] of [[2, 4.8], [5.5, 4.8], [-3, 4.8], [6.3, 1.9]] as const) { add([1.4, 1.5, 0.08], glow('#ffcc80', 1.4), x, y, 0.06); add([1.6, 0.1, 0.25], trim, x, y - 0.8, 0.12); }
  add([0.25, 0.25, 0.25], glow('#ffe0a8', 6), 4, 2.6, 0.3);
  const porch = new THREE.PointLight('#ffd08a', 10, 14, 2); porch.position.set(4, 3, 2.5); house.add(porch);
  add([16, 0.2, 7], mat('#3c3f44', 0.9), 0, 0.1, 3.5);
  return house;
}

/** Concrete barriers on the city edge so the boundary is something you can see and hit. */
function barriers() {
  const list: THREE.BufferGeometry[] = [];
  for (let along = -HALF; along < HALF; along += 4) for (const [x, z, ry] of [[along + 2, -HALF - 0.5, 0], [along + 2, HALF + 0.5, 0], [-HALF - 0.5, along + 2, Math.PI / 2], [HALF + 0.5, along + 2, Math.PI / 2]] as const) {
    if (z === -HALF - 0.5 && Math.abs(x - roadAt(7)) < 10) continue;
    const g = new THREE.BoxGeometry(3.8, 1, 0.6); g.rotateY(ry); g.translate(x, 0.5, z); list.push(g);
  }
  return new THREE.Mesh(mergeGeometries(list), mat('#8a8a86', 0.9));
}

export class GetawayView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 900);
  private composer: EffectComposer;
  private van = vehicle(false);
  private cops = new Map<number, Rig>();
  private siren = new THREE.PointLight('#ff2340', 0, 30, 2);
  private house: THREE.Object3D;
  private garageDoor: THREE.Object3D;
  /** Blender-built city (shared across runs, so never disposed here). */
  private city: THREE.Object3D | null;
  private beacon: THREE.Mesh;
  private smoke: THREE.Sprite[] = [];
  private hud: HTMLElement;
  private map: HTMLCanvasElement;
  private look = new THREE.Vector3();
  private shake = 0;
  private garage = 0;
  private disposed = false;

  constructor(private renderer: THREE.WebGLRenderer, root: HTMLElement, private onTouch: (key: string, down: boolean) => void, city: THREE.Object3D | null = null) {
    this.scene.background = new THREE.Color('#0a1020');
    this.scene.fog = new THREE.Fog('#0a1020', 80, 320);
    this.scene.add(new THREE.HemisphereLight('#7f93c9', '#151210', 0.75));
    const moon = new THREE.DirectionalLight('#a9bce6', 0.9); moon.position.set(-60, 120, -40); this.scene.add(moon);
    this.city = city;
    if (city) {
      // public/heist/getaway-city.glb from tools/build_getaway_city.py: streets, districts and the getaway house.
      this.scene.add(city);
      this.house = city;
      this.garageDoor = city.getObjectByName('GarageDoor') ?? new THREE.Object3D();
    } else {
      this.buildCity();
      this.house = getawayHouse();
      this.house.position.set(HOUSE.x, 0, HOUSE.z);
      this.scene.add(this.house);
      this.garageDoor = this.house.getObjectByName('garage-door')!;
    }
    this.garageDoor.position.y = 0;
    const head = new THREE.SpotLight('#fff1d0', 60, 60, 0.55, 0.5, 1.2); head.position.set(0, 0.6, 2.6); head.target.position.set(0, -0.6, 20); this.van.body.add(head, head.target);
    const fill = new THREE.PointLight('#c9d6ff', 14, 12, 2); fill.position.set(0, 4, -5); this.van.root.add(fill);
    this.scene.add(this.van.root, this.siren);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 2.2, 40, 1, true), new THREE.MeshBasicMaterial({ color: '#4fd18b', transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    const pad = new THREE.Mesh(new THREE.RingGeometry(5.6, 6, 48), glow('#4fd18b', 3)); pad.rotation.x = -Math.PI / 2; pad.position.y = -1.05; this.beacon.add(pad);
    this.scene.add(this.beacon);
    const puff = new THREE.SpriteMaterial({ color: '#55585e', transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 14; i++) { const s = new THREE.Sprite(puff.clone()); s.scale.setScalar(1.2); this.scene.add(s); this.smoke.push(s); }
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.4, 0.75));
    this.composer.addPass(new OutputPass());
    this.hud = document.createElement('section');
    this.hud.id = 'getaway-hud';
    this.hud.innerHTML = `<div class="gw-objective"><div class="eyebrow bad" id="gw-label">GETAWAY</div><strong id="gw-goal"></strong><small id="gw-detail"></small><div class="gw-evade" id="gw-evade"><span></span></div></div><div class="gw-stars" id="gw-stars" aria-label="Wanted level"></div><canvas id="gw-map" width="440" height="440" aria-label="Map: your van, police and the route to the getaway house"></canvas><div class="gw-dash"><div><strong id="gw-speed">0</strong><small>KM/H</small></div><div class="meter"><div class="meter-label"><span>VAN DAMAGE</span><span id="gw-dmg-pct"></span></div><div class="bar"><span id="gw-damage"></span></div></div></div><div class="gw-keys">W / S DRIVE · A / D STEER · SPACE HANDBRAKE · ESC PAUSE</div><div class="gw-banner" id="gw-banner" hidden></div><div class="gw-touch"><div><button data-drive="a" aria-label="Steer left">◀</button><button data-drive="d" aria-label="Steer right">▶</button></div><div><button data-drive="s" aria-label="Brake and reverse">BRAKE</button><button data-drive="w" aria-label="Accelerate" class="gas">GAS</button></div></div>`;
    root.append(this.hud);
    this.hud.querySelectorAll<HTMLButtonElement>('[data-drive]').forEach((b) => {
      b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.onTouch(b.dataset.drive!, true); };
      b.onpointerup = b.onpointercancel = () => this.onTouch(b.dataset.drive!, false);
    });
    this.map = this.hud.querySelector('#gw-map')!;
    window.addEventListener('resize', this.resize);
    this.resize();
    this.banner('GETAWAY', 'Lose the cops, then get to the getaway house', 'bad', 2600);
  }

  private resize = () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.composer.setSize(innerWidth, innerHeight); };

  private bannerTimer = 0;
  /** Big centre-screen title, GTA style: GETAWAY at the start, then MADE IT / BUSTED / WRECKED. */
  banner(title: string, line: string, tone: 'ok' | 'bad', ms = 0) {
    const el = this.hud.querySelector<HTMLElement>('#gw-banner')!;
    el.innerHTML = `<strong class="${tone}">${title}</strong><span>${line}</span>`;
    el.hidden = false;
    clearTimeout(this.bannerTimer);
    if (ms) this.bannerTimer = window.setTimeout(() => (el.hidden = true), ms);
  }

  /** Roll the garage door up for the arrival. */
  openGarage() { this.garage = 1; }

  private buildCity() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 400, HALF * 2 + 400), new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92 }));
    ground.rotation.x = -Math.PI / 2; this.scene.add(ground);
    let seed = 1337; const rnd = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    const facades: THREE.BufferGeometry[][] = [[], []], roofs: THREE.BufferGeometry[] = [], walks: THREE.BufferGeometry[] = [];
    const side = (w: number, h: number, x: number, y: number, z: number, ry: number, list: THREE.BufferGeometry[]) => {
      const g = new THREE.PlaneGeometry(w, h); const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 6, uv.getY(i) * h / 6);
      g.rotateY(ry); g.translate(x, y, z); list.push(g);
    };
    for (const b of BLOCKS) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, size = CITY.block;
      const walk = new THREE.BoxGeometry(size, 0.25, size); walk.translate(cx, 0.125, cz); walks.push(walk);
      const lots = rnd() < 0.5 ? [[0, 0, 1, 1]] : [[0, 0, 0.5, 1], [0.5, 0, 1, 1]];
      for (const [u0, v0, u1, v1] of lots) {
        const x0 = b.x0 + 2 + (size - 4) * u0, x1 = b.x0 + 2 + (size - 4) * u1 - (u1 < 1 ? 1.5 : 0), z0 = b.z0 + 2 + (size - 4) * v0, z1 = b.z0 + 2 + (size - 4) * v1;
        const w = x1 - x0, d = z1 - z0, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const central = 1 - Math.hypot(mx, mz) / (HALF * 1.2);
        const h = Math.round((10 + rnd() * 30 + central * 55) / 3) * 3, list = facades[rnd() < 0.55 ? 0 : 1];
        side(w, h, mx, h / 2, z1, 0, list); side(w, h, mx, h / 2, z0, Math.PI, list);
        side(d, h, x1, h / 2, mz, Math.PI / 2, list); side(d, h, x0, h / 2, mz, -Math.PI / 2, list);
        const roof = new THREE.PlaneGeometry(w, d); roof.rotateX(-Math.PI / 2); roof.translate(mx, h, mz); roofs.push(roof);
      }
    }
    this.scene.add(barriers());
    facades.forEach((list, i) => this.scene.add(new THREE.Mesh(mergeGeometries(list), new THREE.MeshStandardMaterial({ map: facadeTexture(7 + i, i === 0), emissiveMap: facadeTexture(7 + i, i === 0), emissive: '#ffffff', emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.3 }))));
    this.scene.add(new THREE.Mesh(mergeGeometries(roofs), mat('#20252c', 0.9)));
    this.scene.add(new THREE.Mesh(mergeGeometries(walks), mat('#4a4c50', 0.85)));
    // Lane dashes and corner streetlights, instanced.
    const dash = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.02, 3), glow('#d9cf9a', 0.4), 2000), m = new THREE.Matrix4(); let n = 0;
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8), glow('#ffd08a', 5), 400), poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), mat('#202429', 0.5, 0.6), 400); let l = 0;
    for (let k = 0; k <= CITY.blocks; k++) for (let along = -HALF + 6; along < HALF - 6; along += 8) {
      const nearCross = Array.from({ length: CITY.blocks + 1 }, (_, i) => roadAt(i)).some((r) => Math.abs(r - along) < 8);
      if (nearCross || n > 1990) continue;
      dash.setMatrixAt(n++, m.makeTranslation(roadAt(k), 0.02, along));
      dash.setMatrixAt(n++, m.makeRotationY(Math.PI / 2).setPosition(along, 0.02, roadAt(k)));
    }
    for (const b of BLOCKS) for (const [x, z] of [[b.x0 + 0.6, b.z0 + 0.6], [b.x1 - 0.6, b.z1 - 0.6]]) { poles.setMatrixAt(l, m.makeTranslation(x, 3.5, z)); lamps.setMatrixAt(l++, m.makeTranslation(x, 7.1, z)); }
    dash.count = n; lamps.count = poles.count = l;
    this.scene.add(dash, lamps, poles);
  }

  /**
   * `alpha` (0..1) is how far we are between the pose in `before` (captured before the latest physics step)
   * and the current state, so motion stays smooth at any frame rate. `steer` is the driver's input.
   */
  draw(state: GetawayState, dt: number, time: number, alpha = 1, before: PoseSnapshot | null = null, steer = 0) {
    if (this.disposed) return;
    const sv = state.van, v = { ...sv, ...blend(before?.van, sv, alpha) };
    animateRig(this.van, v, sv.vx, sv.vz, dt, time, steer, state.impact);
    this.van.root.traverse((o) => { if (o.name === 'tail') ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = state.braking ? 6 : 1.2; });
    const flash = Math.floor(time / 180) % 2 === 0;
    let nearest: THREE.Group | null = null, best = Infinity;
    for (const cop of state.cops) {
      let rig = this.cops.get(cop.id);
      if (!rig) { rig = vehicle(true); this.scene.add(rig.root); this.cops.set(cop.id, rig); }
      animateRig(rig, blend(before?.cops.get(cop.id), cop, alpha), cop.vx, cop.vz, dt, time, null);
      for (const [name, on] of [['red', flash], ['blue', !flash]] as const) { const lamp = rig.root.getObjectByName(name) as THREE.Mesh; (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = cop.leaving ? 0.2 : on ? 6 : 0.4; }
      const d = Math.hypot(cop.x - v.x, cop.z - v.z); if (d < best && !cop.leaving) { best = d; nearest = rig.root; }
    }
    for (const [id, rig] of this.cops) if (!state.cops.some((c) => c.id === id)) { this.scene.remove(rig.root); this.cops.delete(id); }
    this.siren.intensity = nearest && best < 60 ? 40 : 0;
    if (nearest) { this.siren.position.copy(nearest.position).setY(3); this.siren.color.set(flash ? '#ff2340' : '#2a6bff'); }
    // The beacon only lights up once it's safe to go home.
    this.beacon.position.set(state.dropoff.x, 1.1, state.dropoff.z);
    (this.beacon.material as THREE.MeshBasicMaterial).opacity = state.wanted ? 0.04 : 0.14 + Math.sin(time * 0.005) * 0.06;
    this.garageDoor.position.y = THREE.MathUtils.lerp(this.garageDoor.position.y, this.garage * 3.3, 1 - Math.exp(-3 * dt));
    // Smoke pours from the bonnet once the van is badly hurt.
    const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    this.smoke.forEach((s, i) => {
      const age = ((time / 1000 + i / this.smoke.length) % 1);
      const m = s.material as THREE.SpriteMaterial;
      m.opacity = v.damage > 55 ? (1 - age) * Math.min(0.55, (v.damage - 55) / 60) : 0;
      if (age < 0.08) s.position.set(v.x + fwd.x * 2.2, 1.8, v.z + fwd.z * 2.2);
      s.position.y += dt * 2.2; s.scale.setScalar(1 + age * 3);
    });
    // Chase camera sits behind the direction of travel, pulls back with speed and kicks on impacts.
    if (state.impact > 3) this.shake = Math.min(1, this.shake + state.impact * 0.05);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const speed = Math.hypot(v.vx, v.vz), back = 9 + speed * 0.12;
    const heading = speed > 3 ? Math.atan2(v.vx, v.vz) : v.yaw;
    const want = new THREE.Vector3(v.x - Math.sin(heading) * back, 3.5 + speed * 0.05, v.z - Math.cos(heading) * back);
    this.camera.position.lerp(want, 1 - Math.exp(-5 * dt));
    this.look.lerp(new THREE.Vector3(v.x + Math.sin(heading) * 6, 1.4, v.z + Math.cos(heading) * 6), 1 - Math.exp(-8 * dt));
    this.camera.lookAt(this.look);
    if (this.shake > 0) { const k = this.shake * this.shake * 0.6; this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k)); }
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 62 + Math.min(14, speed * 0.4), 0.1); this.camera.updateProjectionMatrix();
    this.composer.render();
    this.drawHud(state);
  }

  /** Nearest police distance (m) for the siren mix, or Infinity. */
  nearestCop(state: GetawayState) {
    return state.cops.filter((c) => !c.leaving).reduce((best, c) => Math.min(best, Math.hypot(c.x - state.van.x, c.z - state.van.z)), Infinity);
  }

  private drawHud(state: GetawayState) {
    const $ = (id: string) => this.hud.querySelector<HTMLElement>('#' + id)!;
    const seen = state.cops.some((c) => c.sees), v = state.van;
    const route = roadRoute(v, state.dropoff);
    const distance = route.reduce((sum, p, i) => sum + Math.hypot(p.x - (i ? route[i - 1].x : v.x), p.z - (i ? route[i - 1].z : v.z)), 0);
    $('gw-label').textContent = state.wanted ? (seen ? 'WANTED · THEY CAN SEE YOU' : 'WANTED · OUT OF SIGHT') : 'CLEAR';
    $('gw-label').className = 'eyebrow ' + (state.wanted ? 'bad' : 'ok');
    $('gw-goal').textContent = state.wanted ? 'Lose the cops' : 'Get to the getaway house';
    $('gw-detail').textContent = state.wanted ? (seen ? 'Break their line of sight — duck round a corner.' : `Stay hidden — ${Math.ceil(state.evadeNeeded - state.unseen)}s and they lose you.`) : `${Math.round(distance)} m · follow the green route`;
    $('gw-evade').hidden = !state.wanted;
    ($('gw-evade').firstElementChild as HTMLElement).style.width = `${Math.min(1, state.unseen / state.evadeNeeded) * 100}%`;
    $('gw-stars').innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${state.wanted && i < state.stars ? 'on' : ''} ${seen ? 'flash' : ''}">★</i>`).join('');
    $('gw-speed').textContent = String(Math.round(Math.abs(signedSpeed(v)) * 3.6));
    $('gw-damage').style.width = `${v.damage}%`; $('gw-damage').classList.toggle('winded', v.damage > 60); $('gw-dmg-pct').textContent = `${Math.round(v.damage)}%`;
    // Minimap turns with the van (forward is up) and shows ~170 m around it.
    const c = this.map.getContext('2d')!, W = this.map.width, s = W / 340;
    c.save(); c.fillStyle = '#2a313b'; c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2); c.rotate(Math.PI + v.yaw); c.scale(s, s); c.translate(-v.x, -v.z);
    c.fillStyle = '#0d1218'; for (const b of BLOCKS) c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    c.strokeStyle = '#0d1218'; c.lineWidth = 6; c.strokeRect(-HALF, -HALF, HALF * 2, HALF * 2);
    c.strokeStyle = state.wanted ? '#4fd18b44' : '#4fd18b'; c.lineWidth = 5; c.lineJoin = 'round'; c.beginPath(); c.moveTo(v.x, v.z); for (const p of route) c.lineTo(p.x, p.z); c.stroke();
    c.fillStyle = '#4fd18b'; c.fillRect(state.dropoff.x - 7, state.dropoff.z - 9, 14, 12);
    for (const cop of state.cops) {
      if (cop.sees) { c.fillStyle = '#ff3b4e33'; c.beginPath(); c.moveTo(cop.x, cop.z); c.arc(cop.x, cop.z, 40, Math.PI / 2 - cop.yaw - 0.5, Math.PI / 2 - cop.yaw + 0.5); c.closePath(); c.fill(); }
      c.fillStyle = cop.leaving ? '#56606c' : cop.sees ? '#ff3b4e' : '#2a6bff'; c.beginPath(); c.arc(cop.x, cop.z, 4, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    c.fillStyle = '#ffb547'; c.beginPath(); c.moveTo(W / 2, W / 2 - 14); c.lineTo(W / 2 + 9, W / 2 + 10); c.lineTo(W / 2 - 9, W / 2 + 10); c.closePath(); c.fill();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.bannerTimer);
    window.removeEventListener('resize', this.resize);
    this.hud.remove();
    if (this.city) this.scene.remove(this.city);
    this.scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); } } });
    this.composer.dispose();
  }
}
