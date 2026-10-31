/**
 * Plays each finale start to finish with guards, cameras and lasers on, using only real inputs.
 *
 *   npx tsx tools/heist-playthrough.ts [--difficulty=relaxed|standard|pro] [--runs=N]
 *
 * The stealth bot follows the objective route, stays crouched, waits rather than step into a guard's or
 * camera's view, backs away when spotted, takes down unaware guards it ends up behind, and bluffs with the
 * real needle when stopped. It is a floor, not a skilled player: if it can win, a person can.
 */
import { MAPS, createHeistState, setHeistLevel, startHeist, startSetup, stepHeist, guardVisibility, sectorTiming, takedownTarget, confrontationFor, talkNeedle, type HeistState, type HeistInput, type Difficulty, type Role } from '../shared/heist';
import { RouteDriver } from '../server/tests/heist-route';
import { Navigator } from '../client/heist/navigation';
import { HEISTS } from '../shared/heist-campaign';

export class StealthDriver {
  route: RouteDriver;
  nav = new Navigator();
  /** Where to go next: the finale's objective route, or a setup's targets then the exit. */
  base: () => HeistInput;
  private pulse = false;
  private wait = 0;
  constructor(public state: HeistState) {
    this.route = new RouteDriver(state);
    this.base = () => this.route.inputs()[state.players[0].id];
    if (state.mission.kind === 'setup') this.base = () => this.setupStep();
  }

  private setupStep(): HeistInput {
    const s = this.state, p = s.players[0];
    if (s.mission.kind !== 'setup') return { x: 0, z: 0, interact: false };
    const target = s.mission.targets.find((t) => !t.done) ?? s.mission.exit;
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    let move = d < 1.2 ? { x: 0, z: 0 } : this.nav.steer(s, { ...p, crouching: true }, target, s.elapsed * 1000);
    // Wait out live laser sweeps, as the finale route does.
    if (MAPS[s.level].sectors.some((h) => sectorTiming(s, h).active && !(h.high) && Math.abs(p.x + move.x * 0.7 - h.x) < h.w / 2 + 0.15 && Math.abs(p.z + move.z * 0.7 - h.z) < h.d / 2 + 0.15)) move = { x: 0, z: 0 };
    return { ...move, crouch: true, interact: d < 1.4 };
  }

  input(dt: number): HeistInput {
    const s = this.state, p = s.players[0], base = this.base();
    this.pulse = !this.pulse;
    const c = confrontationFor(s, p.id);
    if (c) return { x: 0, z: 0, interact: false, crouch: base.crouch, talk: Math.abs(talkNeedle(c.t + dt) - c.center) < c.width * 0.5, talkAt: c.t + dt };
    const me = { ...p, crouching: !!base.crouch };
    if (takedownTarget(s, me)) return { ...base, x: 0, z: 0, interact: false, takedown: this.pulse };
    const watchers = s.guards.filter((g) => g.mode !== 'stunned' && g.mode !== 'confront');
    const seenAt = (x: number, z: number) => watchers.filter((g) => guardVisibility(s, g, { ...me, x, z }) > 0);
    const seen = seenAt(p.x, p.z);
    if (seen.length) {
      // Spotted: back off from whoever is looking, unless the job in hand is nearly done.
      const g = seen.sort((a, b) => b.suspicion - a.suspicion)[0];
      if (g.suspicion > 0.2) {
        const d = Math.hypot(p.x - g.x, p.z - g.z) || 1;
        const away = { x: p.x + ((p.x - g.x) / d) * 5, z: p.z + ((p.z - g.z) / d) * 5 };
        const move = this.nav.steer(s, me, away, s.elapsed * 1000);
        if (move.x || move.z) return { ...move, crouch: base.crouch, interact: false };
      }
      return base;
    }
    const speed = base.crouch ? 1.6 : 3;
    if ((base.x || base.z) && seenAt(p.x + base.x * speed * 0.7, p.z + base.z * speed * 0.7).length) { this.wait += dt; return { ...base, x: 0, z: 0, interact: false }; }
    return base;
  }
}

export function playFinale(level: number, difficulty: Difficulty, role: Role, maxSeconds = 900) {
  const s = createHeistState('PLAY', 'p', [{ id: 'p', name: 'Bot', role }]);
  s.level = level; s.difficulty = difficulty; startHeist(s);
  const bot = new StealthDriver(s), dt = 1 / 30;
  const stops: string[] = [];
  for (let i = 0; i < maxSeconds * 30 && s.phase === 'playing'; i++) {
    const before = s.confrontations.length;
    stepHeist(s, { p: bot.input(dt) }, dt);
    if (s.confrontations.length > before || ((s.phase as string) === 'lost' && s.busted)) { const c = s.confrontations[0]; const g = s.guards.find((x) => x.id === c?.guard) ?? s.guards.find((x) => x.mode === 'confront' || x.wary); stops.push(`${g?.id ?? '?'}@${s.players[0].x.toFixed(0)},${s.players[0].z.toFixed(0)}`); }
  }
  return { stops, phase: s.phase, seconds: Math.round(s.elapsed), left: Math.round(s.remaining), alarms: s.alarms, bluffs: s.talkouts, takedowns: s.takedowns, notice: s.notice, stage: bot.route.stage };
}

/** Play one setup mission with guards on. */
export function playSetup(level: number, setupId: string, difficulty: Difficulty, maxSeconds = 300) {
  const s = createHeistState('PLAY', 'p', [{ id: 'p', name: 'Bot', role: 'infiltrator' }]);
  setHeistLevel(s, level); s.difficulty = difficulty; startHeist(s);
  startSetup(s, HEISTS[level].setups.find((x) => x.id === setupId)!);
  const bot = new StealthDriver(s), dt = 1 / 30;
  for (let i = 0; i < maxSeconds * 30 && s.phase === 'playing'; i++) stepHeist(s, { p: bot.input(dt) }, dt);
  return { phase: s.phase, seconds: Math.round(s.elapsed), notice: s.notice, bluffs: s.talkouts, alarms: s.alarms };
}

if (process.argv[1]?.endsWith('heist-playthrough.ts')) {
  const setupsOnly = process.argv.includes('--setups');
  const difficulty = (process.argv.find((a) => a.startsWith('--difficulty='))?.split('=')[1] ?? 'standard') as Difficulty;
  const roles: Role[] = ['infiltrator', 'hacker', 'carrier', 'lookout'];
  let wins = 0, total = 0;
  if (setupsOnly) {
    for (const heist of HEISTS) for (const setup of heist.setups) {
      const r = playSetup(heist.level, setup.id, difficulty);
      total++; if (r.phase === 'won') wins++;
      console.log(`${setup.name.padEnd(22)} ${r.phase.padEnd(5)} ${String(r.seconds).padStart(4)}s · alarms ${r.alarms} · bluffs ${r.bluffs}${r.phase === 'won' ? '' : ' · ' + r.notice}`);
    }
    console.log(`\n${difficulty}: ${wins}/${total} setups won`);
    process.exit(0);
  }
  for (let level = 0; level < MAPS.length; level++) for (const role of roles) {
    const r = playFinale(level, difficulty, role);
    total++; if (r.phase === 'won') wins++;
    console.log(`${MAPS[level].name.padEnd(22)} ${role.padEnd(12)} ${r.phase.padEnd(5)} ${String(r.seconds).padStart(4)}s used, ${String(r.left).padStart(4)}s left · alarms ${r.alarms} · bluffs ${r.bluffs} · takedowns ${r.takedowns}${r.phase === 'won' ? '' : ` · stage ${r.stage} · ${r.notice}`} · stops ${r.stops.join(' ')}`);
  }
  console.log(`\n${difficulty}: ${wins}/${total} finales won`);
}
