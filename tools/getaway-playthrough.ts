/**
 * Drives the getaway start to finish with a simple bot: flee through the grid away from the nearest
 * cruiser (turning often to break line of sight), then follow the GPS route to the getaway house.
 *
 *   npx tsx tools/getaway-playthrough.ts
 */
import { createGetaway, stepGetaway, roadAt, roadRoute, signedSpeed, CITY, type GetawayState, type DriveInput } from '../client/heist/getaway-sim';
import { CREW } from '../shared/heist-campaign';

const turn = (a: number, b: number) => ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

export class DriveBot {
  private goal: { x: number; z: number } | null = null;
  private seed = 1;
  private stuck = 0;
  private reverse = 0;
  input(s: GetawayState): DriveInput {
    const v = s.van;
    if (s.wanted) {
      // Pick a junction two blocks away, on the side away from the nearest police car.
      const near = s.cops.filter((c) => !c.leaving).sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z))[0];
      if (!this.goal || Math.hypot(this.goal.x - v.x, this.goal.z - v.z) < 10) {
        const i = Math.round((v.x - roadAt(0)) / (CITY.block + CITY.road)), j = Math.round((v.z - roadAt(0)) / (CITY.block + CITY.road));
        this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
        const options = [[2, 1], [1, 2], [-2, 1], [1, -2], [2, -1], [-1, 2], [-2, -1], [-1, -2]].map(([di, dj]) => ({ x: roadAt(Math.max(0, Math.min(CITY.blocks, i + di))), z: roadAt(Math.max(0, Math.min(CITY.blocks, j + dj))) }));
        const score = (p: { x: number; z: number }) => (near ? Math.hypot(p.x - near.x, p.z - near.z) : 0) + (this.seed % 7);
        this.goal = options.sort((a, b) => score(b) - score(a))[0];
      }
    } else this.goal = s.dropoff;
    const route = roadRoute(v, this.goal);
    // Skip junctions already reached or passed, so the van never doubles back.
    const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
    while (route.length > 1 && (dist(v, route[0]) < 7 || dist(v, route[1]) < dist(route[0], route[1]))) route.shift();
    const next = route[0] ?? this.goal;
    // Wedged against a wall: reverse out with the wheel turned the other way.
    const moving = Math.abs(signedSpeed(v));
    this.stuck = moving < 1 ? this.stuck + 1 / 60 : 0;
    if (this.stuck > 0.5) { this.reverse = 0.9; this.stuck = 0; }
    if (this.reverse > 0) { this.reverse -= 1 / 60; const d = turn(Math.atan2(next.x - v.x, next.z - v.z), v.yaw); return { up: false, down: true, left: d < 0, right: d > 0, brake: false }; }
    const diff = turn(Math.atan2(next.x - v.x, next.z - v.z), v.yaw), speed = signedSpeed(v);
    const home = !s.wanted && Math.hypot(s.dropoff.x - v.x, s.dropoff.z - v.z) < 22;
    const sharp = Math.abs(diff) > 0.5;
    // Brake into junctions where the route turns, like a driver would.
    const after = route[1];
    const bend = after ? Math.abs(turn(Math.atan2(after.x - next.x, after.z - next.z), Math.atan2(next.x - v.x, next.z - v.z))) > 0.6 : false;
    const corner = bend && dist(v, next) < speed * 1.3 + 6 && speed > 13;
    return { up: (!home || speed < 4) && !corner, down: (sharp && speed > 13) || corner || (home && speed > 5), left: diff > 0.06, right: diff < -0.06, brake: false };
  }
}

export function playGetaway(stars: number, driver: string, maxSeconds = 240) {
  const d = CREW.find((c) => c.id === driver)!;
  const s = createGetaway({ top: d.top!, grip: d.grip!, stars });
  const bot = new DriveBot();
  for (let i = 0; i < maxSeconds * 60 && s.phase === 'escape'; i++) stepGetaway(s, bot.input(s), 1 / 60);
  return { phase: s.phase, seconds: Math.round(s.t), damage: Math.round(s.van.damage), lost: !s.wanted };
}

if (process.argv[1]?.endsWith('getaway-playthrough.ts')) {
  let wins = 0, total = 0;
  for (const driver of ['rosa', 'teo', 'kip']) for (const stars of [1, 2, 3, 4]) {
    const r = playGetaway(stars, driver);
    total++; if (r.phase === 'won') wins++;
    console.log(`${driver.padEnd(5)} ${stars}★  ${r.phase.padEnd(8)} ${String(r.seconds).padStart(3)}s  damage ${r.damage}%  ${r.lost ? 'lost the cops' : 'still wanted'}`);
  }
  console.log(`\ngetaways won: ${wins}/${total}`);
}
