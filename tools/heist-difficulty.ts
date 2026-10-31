/**
 * Measures how exposed each spot of each contract is to guards and cameras.
 *
 *   npx tsx tools/heist-difficulty.ts [--difficulty=relaxed|standard|pro] [--json]
 *
 * For every spawn, objective and extraction point, a motionless player (crouched or standing)
 * is dropped in at 30 evenly spaced moments of the patrol cycle. We record how long until a guard
 * or camera raises the alarm. "Window" is the share of moments where the player survives the time
 * that job needs plus 1.5 s to get in position — i.e. how often a patient player finds an opening.
 */
import { MAPS, createHeistState, setHeistLevel, startHeist, stepHeist, type HeistState, type Difficulty } from '../shared/heist';

const difficulty = (process.argv.find((a) => a.startsWith('--difficulty='))?.split('=')[1] ?? 'standard') as Difficulty;
const asJson = process.argv.includes('--json');
const PHASES = 30, PHASE_STEP = 3, CAP = 20, DT = 1 / 30;
const still = { x: 0, z: 0, interact: false };

type Probe = { label: string; x: number; z: number; need: number; required: boolean };
type Result = Probe & { crouched: { window: number; median: number }; standing: { window: number; median: number } };

function fresh(level: number): HeistState {
  const s = createHeistState('TUNE', 'p', [{ id: 'p', name: 'P', role: 'hacker' }]);
  setHeistLevel(s, level);
  s.difficulty = difficulty;
  startHeist(s);
  // Open every gate the route opens, so sight lines match the mid-heist building.
  s.completed = MAPS[level].objectives.filter((o) => o.kind !== 'loot').map((o) => o.id);
  return s;
}

/** Seconds a motionless player at the probe survives before security raises the alarm (capped). */
function timeToAlarm(level: number, probe: Probe, crouch: boolean, phase: number): number {
  const s = fresh(level), p = s.players[0];
  p.x = 200; p.z = 200;
  for (let t = 0; t < phase; t += DT) stepHeist(s, { p: { ...still, crouch } }, DT);
  p.x = probe.x; p.z = probe.z; p.vx = 0; p.vz = 0;
  const alarms = s.alarms;
  for (let t = 0; t < CAP; t += DT) {
    stepHeist(s, { p: { ...still, crouch } }, DT);
    if (s.guards.some((g) => g.mode === 'alert' || g.mode === 'confront') || s.phase !== 'playing' || s.alarms > alarms) return t;
  }
  return CAP;
}

function probes(level: number): Probe[] {
  const m = MAPS[level], list: Probe[] = [];
  m.spawns.forEach((sp, i) => list.push({ label: `spawn ${i + 1}`, ...sp, need: 8, required: true }));
  for (const o of m.objectives) {
    if (o.kind === 'security') continue;
    // Stand just off the console on the side facing the room centre, where a player actually works.
    const len = Math.hypot(o.x, o.z) || 1;
    const need = o.kind === 'hold' ? 6 : o.seconds;
    list.push({ label: o.label, x: o.x - (o.x / len) * 0.7, z: o.z - (o.z / len) * 0.7, need: need + 1.5, required: !o.optional });
  }
  list.push({ label: 'extraction', ...m.exit, need: 3, required: true });
  // Chokepoints a player has to walk through: every door and each leg of the escape route.
  for (const g of m.gates) list.push({ label: `pass: ${g.label}`, x: g.x, z: g.z, need: 2, required: true });
  m.escape.slice(1).forEach((pt, i) => list.push({ label: `escape leg ${i + 1}`, ...pt, need: 2, required: true }));
  return list;
}

function measure(level: number): Result[] {
  return probes(level).map((probe) => {
    const stance = (crouch: boolean) => {
      const times = Array.from({ length: PHASES }, (_, i) => timeToAlarm(level, probe, crouch, i * PHASE_STEP)).sort((a, b) => a - b);
      return { window: times.filter((t) => t >= probe.need).length / PHASES, median: times[PHASES >> 1] };
    };
    return { ...probe, crouched: stance(true), standing: stance(false) };
  });
}

const report = MAPS.map((m, level) => ({ map: m.name, results: measure(level) }));
if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(5);
  const sec = (v: number) => (v >= CAP ? ' safe' : `${v.toFixed(1)}s`.padStart(5));
  console.log(`difficulty=${difficulty}   window = chance a motionless player finishes the job unseen; median = time until the alarm\n`);
  for (const { map, results } of report) {
    console.log(`${map}`);
    console.log('  spot                                  need   crouch win/median   stand win/median');
    for (const r of results) console.log(`  ${(r.required ? '' : '(opt) ') + r.label}`.padEnd(40) + `${r.need.toFixed(1)}s`.padStart(5) + `     ${pct(r.crouched.window)} ${sec(r.crouched.median)}      ${pct(r.standing.window)} ${sec(r.standing.median)}`);
    const req = results.filter((r) => r.required && !r.label.startsWith('spawn') && !r.label.startsWith('pass') && !r.label.startsWith('escape'));
    const transit = results.filter((r) => r.label.startsWith('pass') || r.label.startsWith('escape'));
    const blocked = transit.filter((r) => r.crouched.window < 0.35).map((r) => r.label);
    console.log(`  → chokepoints: crouched window avg ${pct(transit.reduce((a, r) => a + r.crouched.window, 0) / transit.length)}${blocked.length ? `; nearly always watched: ${blocked.join(', ')}` : ''}`);
    const avg = (k: 'crouched' | 'standing') => req.reduce((a, r) => a + r[k].window, 0) / req.length;
    const worst = req.reduce((a, r) => (r.crouched.window < a.crouched.window ? r : a));
    console.log(`  → required jobs: crouched window avg ${pct(avg('crouched'))}, standing ${pct(avg('standing'))}; tightest: ${worst.label} (${pct(worst.crouched.window)})\n`);
  }
}
