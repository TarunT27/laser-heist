import { randomInt } from "node:crypto";
import type { ClientMessage, RoomState } from "../shared/protocol";
import { ROOM_MAX_PLAYERS } from "../shared/protocol";
import { ArenaSimulation, type CommandResult, type SimulationInput } from "./simulation";

export interface RoomEndpoint {
  send(payload: string): void;
}

export interface ManagerResult extends CommandResult {
  code?: string;
  close?: boolean;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_EMPTY_GRACE_MS = 60_000;

function makeCode(): string {
  let result = "";
  for (let index = 0; index < 5; index += 1) result += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return result;
}

export class Room {
  readonly simulation: ArenaSimulation;
  readonly endpoints = new Map<string, RoomEndpoint>();
  emptySince: number | null = null;

  constructor(readonly code: string, hostId: string, now = Date.now()) {
    this.simulation = new ArenaSimulation(code, hostId, now);
  }

  get connectedCount(): number {
    return this.simulation.connectedCount;
  }

  add(id: string, name: string, endpoint: RoomEndpoint, now = Date.now()): CommandResult {
    const result = this.simulation.addPlayer(id, name, now);
    if (!result.ok) return result;
    this.endpoints.set(id, endpoint);
    this.emptySince = null;
    return result;
  }

  disconnect(id: string, now = Date.now()): CommandResult {
    this.endpoints.delete(id);
    const result = this.simulation.disconnect(id, now);
    if (this.simulation.connectedCount === 0 && this.emptySince === null) this.emptySince = now;
    return result;
  }

  handle(id: string, message: Exclude<ClientMessage, { type: "create" } | { type: "join" }>, now = Date.now()): ManagerResult {
    switch (message.type) {
      case "ready":
        return this.simulation.setReady(id, message.ready, now);
      case "start":
        return this.simulation.requestStart(id, now);
      case "input":
        return this.simulation.setInput(id, message as SimulationInput & { type: "input" }, now);
      case "rematch":
        return this.simulation.requestRematch(id, now);
      case "lobby":
        return this.simulation.requestLobby(id, now);
      case "leave":
        this.disconnect(id, now);
        return { ok: true, close: true };
      default:
        return { ok: false, message: "Unsupported message" };
    }
  }

  step(now: number, dt: number): void {
    this.simulation.step(now, dt);
  }

  state(now = Date.now()): RoomState {
    return this.simulation.getState(now);
  }

  broadcastState(now = Date.now()): void {
    const payload = JSON.stringify({ type: "state", state: this.state(now) });
    for (const [id, endpoint] of this.endpoints) {
      try {
        endpoint.send(payload);
      } catch {
        // The HTTP/ws layer will call disconnect on a failed endpoint later;
        // never allow one socket to interrupt the authoritative tick.
        this.endpoints.delete(id);
      }
    }
  }

  sendState(id: string, now = Date.now()): void {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) return;
    endpoint.send(JSON.stringify({ type: "state", state: this.state(now) }));
  }

  shouldCleanup(now: number, graceMs = ROOM_EMPTY_GRACE_MS): boolean {
    if (this.simulation.connectedCount > 0) return false;
    if (this.emptySince === null) this.emptySince = now;
    return now - this.emptySince >= graceMs;
  }
}

/** Owns room codes and routes validated client messages to authoritative rooms. */
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly playerRooms = new Map<string, Room>();

  create(id: string, name: string, endpoint: RoomEndpoint, now = Date.now()): ManagerResult {
    if (this.playerRooms.has(id)) return { ok: false, message: "You are already in a room" };
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = new Room(code, id, now);
    const result = room.add(id, name, endpoint, now);
    if (!result.ok) return result;
    this.rooms.set(code, room);
    this.playerRooms.set(id, room);
    return { ok: true, code };
  }

  join(code: string, id: string, name: string, endpoint: RoomEndpoint, now = Date.now()): ManagerResult {
    if (this.playerRooms.has(id)) return { ok: false, message: "You are already in a room" };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, message: "Room not found" };
    if (room.connectedCount >= ROOM_MAX_PLAYERS) return { ok: false, message: "Room is full" };
    const result = room.add(id, name, endpoint, now);
    if (!result.ok) return result;
    this.playerRooms.set(id, room);
    return { ok: true, code: room.code };
  }

  handle(id: string, message: ClientMessage, now = Date.now()): ManagerResult {
    if (message.type === "create" || message.type === "join") {
      return { ok: false, message: "Create or join is only allowed as the first message" };
    }
    const room = this.playerRooms.get(id);
    if (!room) return { ok: false, message: "Join or create a room first" };
    const result = room.handle(id, message, now);
    if (result.close) this.playerRooms.delete(id);
    return result;
  }

  disconnect(id: string, now = Date.now()): Room | null {
    const room = this.playerRooms.get(id);
    this.playerRooms.delete(id);
    if (!room) return null;
    room.disconnect(id, now);
    return room;
  }

  roomFor(id: string): Room | null {
    return this.playerRooms.get(id) ?? null;
  }

  tick(now: number, dt: number): void {
    for (const [code, room] of this.rooms) {
      room.step(now, dt);
      if (room.shouldCleanup(now)) this.rooms.delete(code);
    }
  }

  broadcast(now: number): void {
    for (const room of this.rooms.values()) room.broadcastState(now);
  }

  cleanup(now = Date.now(), graceMs = ROOM_EMPTY_GRACE_MS): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.shouldCleanup(now, graceMs)) {
        this.rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }
}

export const ROOM_CONSTANTS = { ROOM_EMPTY_GRACE_MS };

