/**
 * The wire protocol is deliberately kept in one place.  Both the browser and
 * server can import these types without importing any server implementation.
 */

export type ClientMessage =
  | { type: "create"; name: string }
  | { type: "join"; code: string; name: string }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "input"; x: number; z: number; dash: boolean; charge: boolean }
  | { type: "rematch" }
  | { type: "lobby" }
  | { type: "leave" };

export type ServerMessage =
  | { type: "welcome"; id: string; code: string }
  | { type: "error"; message: string }
  | { type: "state"; state: RoomState };

export type RoomPhase = "lobby" | "countdown" | "playing" | "roundEnd" | "results";

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  alive: boolean;
  ready: boolean;
  score: number;
  charge: number;
  dashCooldown: number;
  waveCooldown: number;
  connected: boolean;
}

export type GameEventType = "wave" | "dash" | "collapse" | "elimination";

export interface GameEvent {
  id: string;
  type: GameEventType;
  x: number;
  z: number;
  radius?: number;
  playerId?: string;
  time: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  phase: RoomPhase;
  round: number;
  radius: number;
  phaseEndsAt: number;
  nextCollapseAt: number;
  serverTime: number;
  winnerId: string | null;
  roundWinnerId: string | null;
  message: string;
  players: PlayerState[];
  events: GameEvent[];
}

export const ROOM_MIN_PLAYERS = 2;
export const ROOM_MAX_PLAYERS = 6;
export const MATCH_SCORE_TO_WIN = 3;
export const COUNTDOWN_MS = 3_000;
export const ROUND_END_MS = 4_000;
export const COLLAPSE_INTERVAL_MS = 15_000;
export const COLLAPSE_WARNING_MS = 3_000;
export const INITIAL_RADIUS = 9;
export const RADIUS_STEPS = [7, 5, 3, 0] as const;

/** Return true for the exact top-level message shape needed by the server. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

