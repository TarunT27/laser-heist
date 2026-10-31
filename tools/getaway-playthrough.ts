/**
 * Drives the getaway start to finish with a simple bot: flee through the grid away from the nearest
 * cruiser (turning often to break line of sight), then follow the GPS route to the getaway house.
 *
 *   npx tsx tools/getaway-playthrough.ts
 */
import { createGetaway, stepGetaway, roadAt, roadRoute, signedSpeed, lineOfSight, CITY, type GetawayState, type DriveInput } from '../client/heist/getaway-sim';
import { CREW } from '../shared/heist-campaign';

const turn = (a: number, b: number) => ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

export class DriveBot {
  private goal: { x: number; z: number } | null = null;
  constructor(private seed = 1) {}
  /** 32-bit LCG: exact integer maths, identical on every machine. */
  private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  private stuck = 0;
  private reverse = 0;
  input(s: GetawayState): DriveInput {
    const v = s.van;
    if (s.wanted) {
      // Pick a junction one to three blocks away that the police can't see, reached without driving past them.
      const cops = s.cops.filter((c) => !c.leaving);
      const copDist = (p: { x: number; z: number }) => Math.min(999, ...cops.map((c) => Math.hypot(p.x - c.x, p.z - c.z)));
      if (!this.goal || Math.hypot(this.goal.x - v.x, this.goal.z - v.z) < 10) {
        const i = Math.round((v.x - roadAt(0)) / (CITY.block + CITY.road)), j = Math.round((v.z - roadAt(0)) / (CITY.block + CITY.road));
        const options: { p: { x: number; z: number }; score: number }[] = [];
        for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) {
          const ni = i + di, nj = j + dj;
          if ((!di && !dj) || ni < 0 || nj < 0 || ni > CITY.blocks || nj > CITY.blocks) continue;
          const p = { x: roadAt(ni), z: roadAt(nj) }, route = roadRoute(v, p);
          const first = route.find((q) => Math.hypot(q.x - v.x, q.z - v.z) > 7) ?? p;
          const uTurn = Math.abs(turn(Math.atan2(first.x - v.x, first.z - v.z), v.yaw)) > 2.2;
          const pastCop = route.some((q) => copDist(q) < 30);
          const seen = cops.some((c) => lineOfSight(c, p));
          // Each candidate gets its own seeded jitter, so different seeds really take different routes.
          options.push({ p, score: copDist(p) - (pastCop ? 80 : 0) - (uTurn ? 40 : 0) - (seen ? 30 : 0) + this.random() * 15 });
        }
        this.goal = options.sort((a, b) => b.score - a.score)[0].p;
      }
    } else this.goal = s.dropoff;
    const route = roadRoute(v, this.goal);
    // Skip junctions already reached, or passed while driving down the road to the next one, so the van
    // never doubles back and never cuts a corner through a block.
    const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
    const passed = (a: { x: number; z: number }, b: { x: number; z: number }) => {
      const len = dist(a, b) || 1, along = ((v.x - a.x) * (b.x - a.x) + (v.z - a.z) * (b.z - a.z)) / len;
      return along > 0 && Math.abs((v.x - a.x) * (b.z - a.z) - (v.z - a.z) * (b.x - a.x)) / len < CITY.road / 2;
    };
    while (route.length > 1 && (dist(v, route[0]) < 7 || passed(route[0], route[1]))) route.shift();
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

/** `seed` varies the bot's route choices, so several attempts sample different chases. */
export function playGetaway(stars: number, driver: string, maxSeconds = 240, seed = 1) {
  const d = CREW.find((c) => c.id === driver)!;
  const s = createGetaway({ top: d.top!, grip: d.grip!, stars });
  const bot = new DriveBot(seed);
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
