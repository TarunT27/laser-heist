import {
  COLLAPSE_INTERVAL_MS,
  COLLAPSE_WARNING_MS,
  COUNTDOWN_MS,
  INITIAL_RADIUS,
  MATCH_SCORE_TO_WIN,
  RADIUS_STEPS,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  ROUND_END_MS,
  type GameEvent,
  type PlayerState,
  type RoomPhase,
  type RoomState,
} from "../shared/protocol";

export interface SimulationInput {
  x: number;
  z: number;
  dash: boolean;
  charge: boolean;
}

export interface SimulationPlayer {
  state: PlayerState;
  input: SimulationInput;
  previousDash: boolean;
  previousCharge: boolean;
  lastInputAt: number;
  dashTime: number;
  spectator: boolean;
  disconnectedAt: number | null;
}

export interface CommandResult {
  ok: boolean;
  message?: string;
}

const PLAYER_RADIUS = 0.45;
const MOVE_SPEED = 5.5;
const MOVE_RESPONSE = 14;
const DASH_SPEED = 15;
const DASH_DURATION = 0.22;
const DASH_COOLDOWN = 2;
const WAVE_COOLDOWN = 1;
const CHARGE_TIME = 1.4;
const STALE_INPUT_MS = 450;
const EVENT_RETENTION_MS = 1_000;
const DISCONNECTED_RETENTION_MS = 30_000;

const COLORS = [
  "#ff5470",
  "#4ecdc4",
  "#ffd166",
  "#7b61ff",
  "#ff9f43",
  "#5dade2",
] as const;

const ZERO_INPUT: SimulationInput = { x: 0, z: 0, dash: false, charge: false };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalize(x: number, z: number): { x: number; z: number; length: number } {
  const safeX = clamp(finite(x), -1, 1);
  const safeZ = clamp(finite(z), -1, 1);
  const length = Math.hypot(safeX, safeZ);
  if (length <= 1) return { x: safeX, z: safeZ, length };
  return { x: safeX / length, z: safeZ / length, length: 1 };
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Authoritative fixed-step arena simulation.
 *
 * This class intentionally has no WebSocket or timer dependencies.  A server
 * drives it with a fixed `dt` (normally 1/30 second), while tests can exercise
 * the exact same rules without opening a socket.
 */
export class ArenaSimulation {
  readonly code: string;
  readonly players = new Map<string, SimulationPlayer>();

  hostId: string;
  phase: RoomPhase = "lobby";
  round = 0;
  radius = INITIAL_RADIUS;
  phaseEndsAt = 0;
  nextCollapseAt = 0;
  winnerId: string | null = null;
  roundWinnerId: string | null = null;
  message = "Waiting for players";

  private readonly events: GameEvent[] = [];
  private eventSequence = 0;
  private collapseIndex = 0;

  constructor(code: string, hostId: string, _now = Date.now()) {
    this.code = code;
    this.hostId = hostId;
  }

  get connectedCount(): number {
    let count = 0;
    for (const player of this.players.values()) if (player.state.connected) count += 1;
    return count;
  }

  get activeConnectedCount(): number {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.state.connected && !player.spectator) count += 1;
    }
    return count;
  }

  get allActivePlayersReady(): boolean {
    let activePlayers = 0;
    for (const player of this.players.values()) {
      if (!player.state.connected || player.spectator) continue;
      activePlayers += 1;
      if (!player.state.ready) return false;
    }
    return activePlayers >= ROOM_MIN_PLAYERS;
  }

  get aliveCount(): number {
    let count = 0;
    for (const player of this.players.values()) if (player.state.connected && player.state.alive) count += 1;
    return count;
  }

  addPlayer(id: string, name: string, now = Date.now()): CommandResult {
    if (this.players.has(id)) return { ok: false, message: "That player is already in the room" };
    if (this.connectedCount >= ROOM_MAX_PLAYERS) return { ok: false, message: "Room is full" };

    const connectedPlayers = [...this.players.values()].filter((player) => player.state.connected);
    const color = COLORS[connectedPlayers.length % COLORS.length];
    const spectator = this.phase !== "lobby";
    const spawn = this.spawnPosition(connectedPlayers.length);
    const state: PlayerState = {
      id,
      name,
      color,
      x: spawn.x,
      z: spawn.z,
      vx: 0,
      vz: 0,
      alive: false,
      ready: false,
      score: 0,
      charge: 0,
      dashCooldown: 0,
      waveCooldown: 0,
      connected: true,
    };
    this.players.set(id, {
      state,
      input: { ...ZERO_INPUT },
      previousDash: false,
      previousCharge: false,
      lastInputAt: now,
      dashTime: 0,
      spectator,
      disconnectedAt: null,
    });
    if (!this.players.get(this.hostId)?.state.connected) this.hostId = id;
    if (spectator) this.message = `${name} joined as a spectator`;
    else this.message = `${name} joined`;
    return { ok: true };
  }

  /** Mark a socket as gone, immediately eliminating an in-round player. */
  disconnect(id: string, now = Date.now()): CommandResult {
    const player = this.players.get(id);
    if (!player || !player.state.connected) return { ok: false, message: "Player is not connected" };

    player.state.connected = false;
    player.disconnectedAt = now;
    player.input = { ...ZERO_INPUT };
    player.previousDash = false;
    player.previousCharge = false;
    if (this.phase === "playing" && player.state.alive) {
      this.eliminate(player, now);
    } else {
      player.state.alive = false;
      player.state.vx = 0;
      player.state.vz = 0;
      player.state.charge = 0;
    }

    if (id === this.hostId) {
      const replacement = [...this.players.values()].find((candidate) => candidate.state.connected);
      if (replacement) this.hostId = replacement.state.id;
    }

    // A lobby is a live participant list, so do not leave a disconnected
    // record for the client to render as a phantom crew member.
    if (this.phase === "lobby") this.dropDisconnected();

    if (this.phase === "countdown" || this.phase === "playing" || this.phase === "roundEnd") {
      if (this.activeConnectedCount < ROOM_MIN_PLAYERS) {
        this.abortToLobby(now, "Round aborted: fewer than two connected players");
      } else if (this.phase === "playing") {
        this.resolveRoundIfFinished(now);
      }
    }
    return { ok: true };
  }

  setReady(id: string, ready: boolean, _now = Date.now()): CommandResult {
    if (this.phase !== "lobby") return { ok: false, message: "Ready status can only change in the lobby" };
    const player = this.players.get(id);
    if (!player || !player.state.connected) return { ok: false, message: "Player is not connected" };
    player.state.ready = Boolean(ready);
    return { ok: true };
  }

  requestStart(id: string, now = Date.now()): CommandResult {
    if (id !== this.hostId) return { ok: false, message: "Only the host can start the match" };
    if (this.phase !== "lobby") return { ok: false, message: "The match has already started" };
    if (this.activeConnectedCount < ROOM_MIN_PLAYERS) {
      return { ok: false, message: "At least two connected players are required" };
    }
    if (!this.allActivePlayersReady) {
      return { ok: false, message: "All connected players must be ready" };
    }
    this.beginCountdown(now);
    return { ok: true };
  }

  requestRematch(id: string, now = Date.now()): CommandResult {
    if (id !== this.hostId) return { ok: false, message: "Only the host can start a rematch" };
    if (this.phase !== "results") return { ok: false, message: "A rematch is only available from results" };
    if (this.connectedCount < ROOM_MIN_PLAYERS) {
      return { ok: false, message: "At least two connected players are required" };
    }
    this.resetScores();
    this.activateSpectators();
    this.beginCountdown(now);
    return { ok: true };
  }

  requestLobby(id: string, now = Date.now()): CommandResult {
    if (id !== this.hostId) return { ok: false, message: "Only the host can return to the lobby" };
    if (this.phase !== "results") return { ok: false, message: "The match is not in results" };
    this.resetScores();
    this.enterLobby(now, "Back in lobby");
    return { ok: true };
  }

  setInput(id: string, raw: SimulationInput, now = Date.now()): CommandResult {
    const player = this.players.get(id);
    if (!player || !player.state.connected) return { ok: false, message: "Player is not connected" };
    // Inputs are treated as hints, never as authoritative positions or speeds.
    const direction = normalize(raw.x, raw.z);
    player.input = {
      x: direction.x,
      z: direction.z,
      dash: Boolean(raw.dash),
      charge: Boolean(raw.charge),
    };
    player.lastInputAt = now;
    return { ok: true };
  }

  /** Advance the simulation by one fixed step. `dt` is clamped for safety. */
  step(now = Date.now(), dt = 1 / 30): void {
    const safeDt = clamp(finite(dt, 1 / 30), 0, 0.1);
    this.pruneEvents(now);
    this.pruneDisconnected(now);

    if (this.phase === "countdown") {
      if (this.activeConnectedCount < ROOM_MIN_PLAYERS) {
        this.abortToLobby(now, "Round aborted: fewer than two connected players");
      } else if (now >= this.phaseEndsAt) {
        const roundStartedAt = this.phaseEndsAt;
        this.phase = "playing";
        this.phaseEndsAt = 0;
        this.nextCollapseAt = roundStartedAt + COLLAPSE_INTERVAL_MS;
        this.message = "Fight!";
      }
      return;
    }

    if (this.phase === "playing") {
      this.processCollapses(now);
      this.simulatePlayers(now, safeDt);
      this.resolveRoundIfFinished(now);
      if (this.phase === "playing") this.updatePlayingMessage(now);
      return;
    }

    if (this.phase === "roundEnd" && now >= this.phaseEndsAt) {
      if (this.winnerId) {
        this.phase = "results";
        this.phaseEndsAt = 0;
        this.nextCollapseAt = 0;
        this.message = `${this.playerName(this.winnerId)} wins the match`;
      } else if (this.activeConnectedCount >= ROOM_MIN_PLAYERS) {
        this.beginCountdown(now);
      } else {
        this.abortToLobby(now, "Round aborted: fewer than two connected players");
      }
    }
  }

  getState(now = Date.now()): RoomState {
    this.pruneEvents(now);
    const players = [...this.players.values()].map((player) => ({
      ...player.state,
      x: roundNumber(player.state.x),
      z: roundNumber(player.state.z),
      vx: roundNumber(player.state.vx),
      vz: roundNumber(player.state.vz),
      charge: roundNumber(clamp(player.state.charge, 0, 1)),
      dashCooldown: roundNumber(Math.max(0, player.state.dashCooldown)),
      waveCooldown: roundNumber(Math.max(0, player.state.waveCooldown)),
    }));
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      radius: roundNumber(this.radius),
      phaseEndsAt: this.phaseEndsAt,
      nextCollapseAt: this.nextCollapseAt,
      serverTime: now,
      winnerId: this.winnerId,
      roundWinnerId: this.roundWinnerId,
      message: this.message,
      players,
      events: this.events.filter((event) => now - event.time <= EVENT_RETENTION_MS),
    };
  }

  /** Remove disconnected records after a grace period, preserving immediate state visibility. */
  private pruneDisconnected(now: number): void {
    for (const [id, player] of this.players) {
      if (player.state.connected || player.disconnectedAt === null) continue;
      if (now - player.disconnectedAt < DISCONNECTED_RETENTION_MS) continue;
      this.players.delete(id);
    }
    this.ensureHost();
  }

  private dropDisconnected(): void {
    for (const [id, player] of this.players) {
      if (!player.state.connected) this.players.delete(id);
    }
    this.ensureHost();
  }

  private ensureHost(): void {
    const currentHost = this.players.get(this.hostId);
    if (currentHost?.state.connected) return;
    const replacement = [...this.players.values()].find((candidate) => candidate.state.connected);
    if (replacement) this.hostId = replacement.state.id;
  }

  private spawnPosition(index: number): { x: number; z: number } {
    // Keep all initial spawns comfortably inside radius 9 and deterministic.
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(ROOM_MAX_PLAYERS, 4);
    const distance = index === 0 ? 0 : 2.45;
    return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
  }

  private beginCountdown(now: number): void {
    this.dropDisconnected();
    this.phase = "countdown";
    this.round += 1;
    this.radius = INITIAL_RADIUS;
    this.collapseIndex = 0;
    this.phaseEndsAt = now + COUNTDOWN_MS;
    this.nextCollapseAt = 0;
    this.winnerId = null;
    this.roundWinnerId = null;
    this.message = `Round ${this.round} starts soon`;

    let spawnIndex = 0;
    for (const player of this.players.values()) {
      if (player.state.connected) player.spectator = false;
      if (!player.state.connected) {
        player.state.alive = false;
        continue;
      }
      const spawn = this.spawnPosition(spawnIndex++);
      player.state.x = spawn.x;
      player.state.z = spawn.z;
      player.state.vx = 0;
      player.state.vz = 0;
      player.state.alive = true;
      player.state.charge = 0;
      player.state.dashCooldown = 0;
      player.state.waveCooldown = 0;
      player.input = { ...ZERO_INPUT };
      player.previousDash = false;
      player.previousCharge = false;
      player.dashTime = 0;
    }
  }

  private enterLobby(_now: number, message: string): void {
    this.dropDisconnected();
    this.phase = "lobby";
    this.round = 0;
    this.radius = INITIAL_RADIUS;
    this.phaseEndsAt = 0;
    this.nextCollapseAt = 0;
    this.winnerId = null;
    this.roundWinnerId = null;
    this.collapseIndex = 0;
    this.message = message;
    for (const player of this.players.values()) {
      player.spectator = false;
      player.state.alive = false;
      player.state.ready = false;
      player.state.charge = 0;
      player.state.vx = 0;
      player.state.vz = 0;
      player.input = { ...ZERO_INPUT };
      player.previousDash = false;
      player.previousCharge = false;
      player.dashTime = 0;
    }
  }

  private abortToLobby(now: number, message: string): void {
    // Scores earned in previous completed rounds remain visible, but this
    // incomplete round never awards a point.
    this.enterLobby(now, message);
  }

  private activateSpectators(): void {
    for (const player of this.players.values()) {
      if (player.state.connected) player.spectator = false;
    }
  }

  private resetScores(): void {
    for (const player of this.players.values()) player.state.score = 0;
  }

  private processCollapses(now: number): void {
    if (this.nextCollapseAt <= 0) return;
    while (this.collapseIndex < RADIUS_STEPS.length && now >= this.nextCollapseAt) {
      this.radius = RADIUS_STEPS[this.collapseIndex];
      this.collapseIndex += 1;
      this.pushEvent({ type: "collapse", x: 0, z: 0, radius: this.radius, time: now });
      for (const player of this.players.values()) {
        if (!player.state.connected || !player.state.alive) continue;
        if (this.radius <= 0 || Math.hypot(player.state.x, player.state.z) > this.radius) {
          this.eliminate(player, now);
        }
      }
      if (this.radius <= 0 || this.collapseIndex >= RADIUS_STEPS.length) {
        this.nextCollapseAt = 0;
        break;
      }
      this.nextCollapseAt += COLLAPSE_INTERVAL_MS;
    }
  }

  private simulatePlayers(now: number, dt: number): void {
    const alive = [...this.players.values()].filter((player) => player.state.connected && player.state.alive);

    for (const player of alive) {
      if (!player.state.alive) continue;
      const state = player.state;
      state.dashCooldown = Math.max(0, state.dashCooldown - dt);
      state.waveCooldown = Math.max(0, state.waveCooldown - dt);
      const stale = now - player.lastInputAt > STALE_INPUT_MS;
      const input = stale ? ZERO_INPUT : player.input;
      if (stale) {
        // A lost hold is cancelled rather than silently firing a partial wave
        // on behalf of a lagging client. Movement and dash momentum still
        // decay authoritatively, but no stale ability input is replayed.
        state.charge = 0;
        player.previousCharge = false;
      }

      if (input.dash && !player.previousDash && state.dashCooldown <= 0) {
        const direction = normalize(input.x, input.z);
        let dx = direction.x;
        let dz = direction.z;
        if (direction.length === 0) {
          const velocityLength = Math.hypot(state.vx, state.vz);
          if (velocityLength > 0.001) {
            dx = state.vx / velocityLength;
            dz = state.vz / velocityLength;
          } else {
            dx = 1;
            dz = 0;
          }
        }
        state.vx = dx * DASH_SPEED;
        state.vz = dz * DASH_SPEED;
        state.dashCooldown = DASH_COOLDOWN;
        player.dashTime = DASH_DURATION;
        this.pushEvent({ type: "dash", x: state.x, z: state.z, playerId: state.id, time: now });
      }

      const wasCharging = player.previousCharge;
      if (input.charge) {
        state.charge = clamp(state.charge + dt / CHARGE_TIME, 0, 1);
        if (state.charge >= 1) {
          this.fireWave(player, 1, now);
        }
      } else if (wasCharging) {
        const power = state.charge;
        state.charge = 0;
        if (power >= 0.05) this.fireWave(player, power, now);
      }

      player.previousDash = input.dash;
      player.previousCharge = input.charge;
      player.dashTime = Math.max(0, player.dashTime - dt);

      if (player.dashTime <= 0) {
        const direction = normalize(input.x, input.z);
        const targetX = direction.x * MOVE_SPEED;
        const targetZ = direction.z * MOVE_SPEED;
        const response = clamp(MOVE_RESPONSE * dt, 0, 1);
        state.vx += (targetX - state.vx) * response;
        state.vz += (targetZ - state.vz) * response;
      } else {
        // Dash friction makes it powerful but bounded and deterministic.
        state.vx *= Math.pow(0.985, dt * 60);
        state.vz *= Math.pow(0.985, dt * 60);
      }
      state.x += state.vx * dt;
      state.z += state.vz * dt;
    }

    this.resolvePlayerCollisions(alive);
    for (const player of alive) {
      if (!player.state.alive) continue;
      const distance = Math.hypot(player.state.x, player.state.z);
      if (this.radius <= 0 || distance > this.radius) {
        this.eliminate(player, now);
      }
    }
  }

  private resolvePlayerCollisions(players: SimulationPlayer[]): void {
    const minimumDistance = PLAYER_RADIUS * 2;
    for (let i = 0; i < players.length; i += 1) {
      const first = players[i];
      if (!first.state.alive) continue;
      for (let j = i + 1; j < players.length; j += 1) {
        const second = players[j];
        if (!second.state.alive) continue;
        let dx = second.state.x - first.state.x;
        let dz = second.state.z - first.state.z;
        let distance = Math.hypot(dx, dz);
        if (distance >= minimumDistance) continue;
        if (distance <= 0.00001) {
          // Stable fallback normal avoids NaNs if two players share a spawn.
          dx = i % 2 === 0 ? 1 : 0;
          dz = i % 2 === 0 ? 0 : 1;
          distance = 1;
        }
        const nx = dx / distance;
        const nz = dz / distance;
        const penetration = minimumDistance - distance;
        first.state.x -= (nx * penetration) / 2;
        first.state.z -= (nz * penetration) / 2;
        second.state.x += (nx * penetration) / 2;
        second.state.z += (nz * penetration) / 2;

        const relativeNormal = (second.state.vx - first.state.vx) * nx + (second.state.vz - first.state.vz) * nz;
        if (relativeNormal < 0) {
          const impulse = -relativeNormal * 0.85;
          first.state.vx -= impulse * nx;
          first.state.vz -= impulse * nz;
          second.state.vx += impulse * nx;
          second.state.vz += impulse * nz;
        }

        // A dash is also a close-range shove.  The dash event itself remains
        // the only public event, keeping the protocol compact.
        if (first.dashTime > 0 && second.dashTime <= 0) {
          second.state.vx += nx * 5;
          second.state.vz += nz * 5;
        } else if (second.dashTime > 0 && first.dashTime <= 0) {
          first.state.vx -= nx * 5;
          first.state.vz -= nz * 5;
        }
      }
    }
  }

  private fireWave(player: SimulationPlayer, power: number, now: number): void {
    const state = player.state;
    const safePower = clamp(finite(power), 0, 1);
    state.charge = 0;
    if (state.waveCooldown > 0 || !state.alive || !player.state.connected) return;
    state.waveCooldown = WAVE_COOLDOWN;
    const radius = 1.8 + safePower * 3;
    const force = 5 + safePower * 11;
    this.pushEvent({ type: "wave", x: state.x, z: state.z, radius, playerId: state.id, time: now });

    for (const target of this.players.values()) {
      if (target === player || !target.state.connected || !target.state.alive) continue;
      let dx = target.state.x - state.x;
      let dz = target.state.z - state.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      if (distance <= 0.00001) {
        dx = 1;
        dz = 0;
      }
      const length = Math.max(distance, 1);
      const falloff = 1 - clamp(distance / radius, 0, 1);
      target.state.vx += (dx / length) * force * falloff;
      target.state.vz += (dz / length) * force * falloff;
    }
  }

  private eliminate(player: SimulationPlayer, now: number): void {
    if (!player.state.alive) return;
    player.state.alive = false;
    player.state.vx = 0;
    player.state.vz = 0;
    player.state.charge = 0;
    player.input = { ...ZERO_INPUT };
    player.previousDash = false;
    player.previousCharge = false;
    player.dashTime = 0;
    this.pushEvent({
      type: "elimination",
      x: player.state.x,
      z: player.state.z,
      playerId: player.state.id,
      time: now,
    });
  }

  private resolveRoundIfFinished(now: number): void {
    if (this.phase !== "playing") return;
    const alive = [...this.players.values()].filter((player) => player.state.connected && player.state.alive);
    if (alive.length > 1) return;

    this.roundWinnerId = alive.length === 1 ? alive[0].state.id : null;
    if (this.roundWinnerId) {
      const winner = this.players.get(this.roundWinnerId);
      if (winner) winner.state.score += 1;
      this.winnerId = winner && winner.state.score >= MATCH_SCORE_TO_WIN ? winner.state.id : null;
    } else {
      this.winnerId = null;
    }
    this.phase = "roundEnd";
    this.phaseEndsAt = now + ROUND_END_MS;
    this.nextCollapseAt = 0;
    this.message = this.roundWinnerId
      ? `${this.playerName(this.roundWinnerId)} wins the round`
      : "Round draw";
  }

  private updatePlayingMessage(now: number): void {
    if (this.nextCollapseAt > 0) {
      const remaining = this.nextCollapseAt - now;
      if (remaining <= COLLAPSE_WARNING_MS) {
        this.message = `Arena collapses in ${Math.max(1, Math.ceil(remaining / 1_000))}s`;
        return;
      }
    }
    this.message = "Fight!";
  }

  private playerName(id: string | null): string {
    if (!id) return "Nobody";
    return this.players.get(id)?.state.name ?? "Player";
  }

  private pushEvent(event: Omit<GameEvent, "id">): void {
    this.events.push({ ...event, id: `event-${++this.eventSequence}` });
  }

  private pruneEvents(now: number): void {
    const cutoff = now - EVENT_RETENTION_MS;
    while (this.events.length > 0 && this.events[0].time < cutoff) this.events.shift();
  }
}

export const SIMULATION_CONSTANTS = {
  PLAYER_RADIUS,
  MOVE_SPEED,
  DASH_SPEED,
  DASH_DURATION,
  DASH_COOLDOWN,
  WAVE_COOLDOWN,
  CHARGE_TIME,
  STALE_INPUT_MS,
  EVENT_RETENTION_MS,
};

// A short alias keeps the pure simulation convenient to import in downstream
// tests without changing the descriptive class name used by the server.
export { ArenaSimulation as Simulation };

