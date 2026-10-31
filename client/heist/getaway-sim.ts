/**
 * Getaway drive after a van heist: lose the police in a night-time grid city, then reach the drop-off.
 * Pure simulation (no three.js) so it can be tested; getaway.ts draws it.
 *
 * Coordinates match the heist: x right, z depth; forward is (sin yaw, cos yaw).
 */
export const CITY = { blocks: 8, block: 36, road: 12 } as const;
const PITCH = CITY.block + CITY.road;
export const HALF = (CITY.blocks * PITCH + CITY.road) / 2;
/** Centre line of road k (0..blocks) on either axis. */
export const roadAt = (k: number) => -HALF + CITY.road / 2 + k * PITCH;

export type Rect = { x0: number; x1: number; z0: number; z1: number };
export const BLOCKS: Rect[] = [];
for (let i = 0; i < CITY.blocks; i++) for (let j = 0; j < CITY.blocks; j++) {
  const x0 = -HALF + CITY.road + i * PITCH, z0 = -HALF + CITY.road + j * PITCH;
  BLOCKS.push({ x0, x1: x0 + CITY.block, z0, z1: z0 + CITY.block });
}

/** Where the van parks to finish (on the road) and where the getaway house stands (just past the north edge). */
export const DROPOFF = { x: roadAt(7), z: roadAt(0) };
export const HOUSE = { x: roadAt(7) + 3, z: -HALF - 1.2 };

export interface Car { x: number; z: number; yaw: number; vx: number; vz: number }
export interface Cop extends Car { id: number; path: { x: number; z: number }[]; repath: number; sees: boolean; leaving: boolean; stuck: number; reversing: number }
export interface DriveInput { up: boolean; down: boolean; left: boolean; right: boolean; brake: boolean }
export interface GetawayConfig { top: number; grip: number; stars: number }
export interface GetawayState {
  t: number;
  van: Car & { damage: number };
  cops: Cop[];
  stars: number;
  wanted: boolean;
  /** Seconds no cop has had eyes on the van, and how long that has to last to lose them. */
  unseen: number;
  evadeNeeded: number;
  lastSeen: { x: number; z: number } | null;
  bustTimer: number;
  phase: "escape" | "won" | "busted" | "wrecked";
  /** The getaway house's garage door; pull in here once the police have lost you. */
  dropoff: { x: number; z: number };
  notice: string;
  /** Hardest hit the van took this step (m/s of impact) and whether it is braking — for sound, shake and brake lights. */
  impact: number;
  braking: boolean;
  nextSpawn: number;
  nextId: number;
  config: GetawayConfig;
}

const COP_SIGHT = 60, BUST_RADIUS = 5.5, VAN_R = 1.6, COP_R = 1.5;
/** An arrest needs the van nearly stopped beside a cruiser for this long, and never in the opening seconds. */
const BUST_SECONDS = 3, BUST_SPEED = 1.5, HEAD_START = 4;
const forward = (c: Car) => ({ x: Math.sin(c.yaw), z: Math.cos(c.yaw) });
const speedOf = (c: Car) => { const f = forward(c); return c.vx * f.x + c.vz * f.z; };
const delta = (a: number, b: number) => ((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
export const signedSpeed = speedOf;

export function insideBlock(x: number, z: number, margin = 0): Rect | null {
  for (const b of BLOCKS) if (x > b.x0 - margin && x < b.x1 + margin && z > b.z0 - margin && z < b.z1 + margin) return b;
  return null;
}

/** True when nothing solid stands between two points (sampled every 3 m). */
export function lineOfSight(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(d / 3));
  for (let i = 1; i < steps; i++) if (insideBlock(a.x + (b.x - a.x) * i / steps, a.z + (b.z - a.z) * i / steps)) return false;
  return true;
}

export function createGetaway(config: GetawayConfig): GetawayState {
  const stars = Math.max(1, Math.min(5, Math.round(config.stars)));
  const state: GetawayState = {
    t: 0,
    van: { x: roadAt(1), z: roadAt(8) - 30, yaw: Math.PI, vx: 0, vz: 0, damage: 0 },
    cops: [], stars, wanted: true, unseen: 0, evadeNeeded: 5 + stars * 1.5, lastSeen: null, bustTimer: 0,
    phase: "escape", dropoff: { ...DROPOFF }, notice: "Lose the cops!", impact: 0, braking: false, nextSpawn: 0, nextId: 1, config: { ...config, stars },
  };
  // The first cruisers are already on your tail when you pull out of the loading dock.
  spawnCop(state, roadAt(1), roadAt(8), Math.PI);
  if (stars >= 2) spawnCop(state, roadAt(0), roadAt(8), Math.PI / 2);
  return state;
}

function spawnCop(state: GetawayState, x: number, z: number, yaw: number) {
  state.cops.push({ id: state.nextId++, x, z, yaw, vx: 0, vz: 0, path: [], repath: 0, sees: false, leaving: false, stuck: 0, reversing: 0 });
}

/** Arcade car: throttle along the nose, steering scaled by speed; grip bleeds off the sideways slide. */
export function driveCar(car: Car, input: DriveInput, top: number, grip: number, dt: number) {
  const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0), before = speedOf(car);
  const turn = (1.5 + grip * 0.7) * Math.min(1, Math.abs(before) / 7) / (1 + Math.abs(before) / 45) * (input.brake ? 1.6 : 1);
  car.yaw += steer * turn * Math.sign(before || 1) * dt;
  const f = forward(car), r = { x: f.z, z: -f.x };
  let along = car.vx * f.x + car.vz * f.z, lateral = car.vx * r.x + car.vz * r.z;
  if (input.up) along += (along < 0 ? 24 : 10 + top * 0.18) * dt;
  else if (input.down) along -= (along > 0.5 ? 26 : 9) * dt;
  else along -= Math.sign(along) * Math.min(Math.abs(along), 2.2 * dt);
  along -= along * 0.12 * dt;
  along = Math.max(-9, Math.min(top, along));
  if (input.brake) along *= 1 - 1.4 * dt;
  lateral *= Math.exp(-(3 + 9 * grip) * (input.brake ? 0.25 : 1) * dt);
  car.vx = f.x * along + r.x * lateral;
  car.vz = f.z * along + r.z * lateral;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
}

/** Push a car out of buildings and the city edge; returns the impact speed. */
function collide(car: Car, r: number): number {
  let impact = 0;
  const b = insideBlock(car.x, car.z, r);
  if (b) {
    const pens = [car.x - (b.x0 - r), b.x1 + r - car.x, car.z - (b.z0 - r), b.z1 + r - car.z];
    const k = pens.indexOf(Math.min(...pens));
    if (k < 2) { car.x = k === 0 ? b.x0 - r : b.x1 + r; impact = Math.abs(car.vx); car.vx *= -0.3; car.vz *= 0.8; }
    else { car.z = k === 2 ? b.z0 - r : b.z1 + r; impact = Math.abs(car.vz); car.vz *= -0.3; car.vx *= 0.8; }
  }
  const lim = HALF - r;
  if (Math.abs(car.x) > lim) { impact = Math.max(impact, Math.abs(car.vx)); car.x = Math.sign(car.x) * lim; car.vx *= -0.3; }
  if (Math.abs(car.z) > lim) { impact = Math.max(impact, Math.abs(car.vz)); car.z = Math.sign(car.z) * lim; car.vz *= -0.3; }
  return impact;
}

const nearestNode = (p: { x: number; z: number }) => ({ i: Math.max(0, Math.min(CITY.blocks, Math.round((p.x - roadAt(0)) / PITCH))), j: Math.max(0, Math.min(CITY.blocks, Math.round((p.z - roadAt(0)) / PITCH))) });
/** Intersections to drive through from one point to another (Manhattan route along the grid). */
export function roadRoute(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
  const a = nearestNode(from), b = nearestNode(to), out: { x: number; z: number }[] = [];
  let { i, j } = a;
  out.push({ x: roadAt(i), z: roadAt(j) });
  while (i !== b.i) { i += Math.sign(b.i - i); out.push({ x: roadAt(i), z: roadAt(j) }); }
  while (j !== b.j) { j += Math.sign(b.j - j); out.push({ x: roadAt(i), z: roadAt(j) }); }
  out.push({ ...to });
  return out;
}

function steerCop(state: GetawayState, cop: Cop, dt: number) {
  const van = state.van, top = 20 + state.stars * 1.8;
  let goal: { x: number; z: number };
  if (cop.leaving) {
    goal = cop.path[0] ?? { x: roadAt(0), z: roadAt(0) };
  } else if (cop.sees) {
    // Aim a little ahead of the van so the cruiser cuts across rather than trailing.
    goal = { x: van.x + van.vx * 0.5, z: van.z + van.vz * 0.5 };
    cop.path = [];
  } else {
    cop.repath -= dt;
    if (cop.repath <= 0 || !cop.path.length) { cop.path = roadRoute(cop, state.lastSeen ?? van); cop.repath = 2; }
    // Drop waypoints already reached or already passed, so a cruiser never U-turns back to a corner.
    const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
    while (cop.path.length > 1 && (dist(cop, cop.path[0]) < 6 || dist(cop, cop.path[1]) < dist(cop.path[0], cop.path[1]))) cop.path.shift();
    goal = cop.path[0] ?? van;
  }
  const want = Math.atan2(goal.x - cop.x, goal.z - cop.z), diff = delta(want, cop.yaw);
  // Wedged against a wall: back out with the wheel turned the other way, like a real driver.
  if (cop.reversing > 0) { cop.reversing -= dt; driveCar(cop, { up: false, down: true, left: diff < 0, right: diff > 0, brake: false }, top, 0.95, dt); return; }
  const sharp = Math.abs(diff) > 1.1, gap = Math.hypot(van.x - cop.x, van.z - cop.z);
  // A cruiser that catches a slow van pulls up alongside to make the arrest instead of ramming it.
  const arresting = cop.sees && gap < 28 && Math.hypot(van.vx, van.vz) < 4;
  const speed = speedOf(cop), approach = Math.max(0, Math.min(20, (gap - 4.5) * 0.9));
  const up = arresting ? speed < approach - 1 : !sharp || speed < 6;
  const down = arresting ? speed > approach + 1 : sharp && speed > 12;
  driveCar(cop, { up, down, left: diff > 0.06, right: diff < -0.06, brake: false }, top, 0.95, dt);
  cop.stuck = !arresting && Math.abs(speedOf(cop)) < 1 ? cop.stuck + dt : 0;
  if (cop.stuck > 0.8) { cop.stuck = 0; cop.reversing = 1.2; }
}

export function stepGetaway(state: GetawayState, input: DriveInput, dt: number): GetawayState {
  if (state.phase !== "escape") return state;
  state.t += dt;
  const van = state.van, cfg = state.config;
  state.impact = 0;
  state.braking = (input.down && speedOf(van) > 1) || input.brake;
  driveCar(van, input, cfg.top, cfg.grip, dt);
  const hit = collide(van, VAN_R);
  state.impact = hit;
  // Scrapes are free; a full-speed head-on costs about a sixth of the van.
  if (hit > 8) van.damage = Math.min(100, van.damage + (hit - 8) * 0.6);
  // Police
  let seen = false;
  for (const cop of state.cops) {
    cop.sees = !cop.leaving && state.wanted && Math.hypot(cop.x - van.x, cop.z - van.z) < COP_SIGHT && lineOfSight(cop, van);
    if (cop.sees) seen = true;
  }
  for (const cop of state.cops) {
    steerCop(state, cop, dt);
    collide(cop, COP_R);
    const dx = van.x - cop.x, dz = van.z - cop.z, d = Math.hypot(dx, dz);
    if (d < VAN_R + COP_R && d > 0.001) {
      const nx = dx / d, nz = dz / d, push = (VAN_R + COP_R - d) / 2;
      van.x += nx * push; van.z += nz * push; cop.x -= nx * push; cop.z -= nz * push;
      const closing = (cop.vx - van.vx) * nx + (cop.vz - van.vz) * nz;
      if (closing > 0) {
        van.vx += nx * closing * 0.6; van.vz += nz * closing * 0.6; cop.vx -= nx * closing * 0.6; cop.vz -= nz * closing * 0.6;
        state.impact = Math.max(state.impact, closing);
        if (closing > 6) van.damage = Math.min(100, van.damage + (closing - 6) * 0.6);
      }
    }
  }
  state.cops = state.cops.filter((c) => !(c.leaving && Math.hypot(c.x - van.x, c.z - van.z) > 120));
  if (state.wanted) {
    if (seen) { state.unseen = 0; state.lastSeen = { x: van.x, z: van.z }; }
    else state.unseen += dt;
    // Keep the pressure on: reinforcements arrive from a few blocks away.
    state.nextSpawn -= dt;
    if (state.nextSpawn <= 0 && state.cops.length < Math.min(6, 1 + state.stars)) {
      state.nextSpawn = 5;
      // Reinforcements arrive from a junction at least 100 m away that can't see the van, so hiding works.
      const here = nearestNode(van), seed = Math.floor(state.t * 7.3);
      for (let tries = 0; tries < 12; tries++) {
        const i = Math.max(0, Math.min(CITY.blocks, here.i + ((seed + tries * 5) % 7) - 3)), j = Math.max(0, Math.min(CITY.blocks, here.j + ((seed * 3 + tries * 2) % 7) - 3));
        const at = { x: roadAt(i), z: roadAt(j) };
        if (Math.hypot(at.x - van.x, at.z - van.z) >= 100 && !lineOfSight(at, van)) { spawnCop(state, at.x, at.z, 0); break; }
      }
    }
    if (state.unseen >= state.evadeNeeded) {
      state.wanted = false;
      state.notice = "You lost them. Get to the getaway house.";
      for (const cop of state.cops) { cop.leaving = true; cop.path = [{ x: roadAt(cop.x < 0 ? 0 : CITY.blocks), z: cop.z }]; }
    }
    const boxedIn = state.t > HEAD_START && state.cops.some((c) => !c.leaving && Math.hypot(c.x - van.x, c.z - van.z) < BUST_RADIUS) && Math.hypot(van.vx, van.vz) < BUST_SPEED;
    state.bustTimer = boxedIn ? state.bustTimer + dt : Math.max(0, state.bustTimer - dt * 2);
    if (state.bustTimer >= BUST_SECONDS) { state.phase = "busted"; state.notice = "Boxed in. The police have you."; return state; }
  }
  if (van.damage >= 100) { state.phase = "wrecked"; state.notice = "The van is wrecked."; return state; }
  const atDrop = Math.hypot(van.x - state.dropoff.x, van.z - state.dropoff.z) < 8;
  if (atDrop && state.wanted) state.notice = "Not with cops on you — lose them before the getaway house!";
  else if (atDrop && Math.hypot(van.vx, van.vz) < 6) { state.phase = "won"; state.notice = "Made it to the getaway house."; }
  return state;
}
