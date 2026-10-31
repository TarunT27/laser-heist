import assert from "node:assert/strict";
import { test } from "node:test";
import { ArenaSimulation } from "../simulation";
import { RoomManager, type RoomEndpoint } from "../room";
import { MAX_NAME_LENGTH, parseClientMessage, validateName } from "../validation";
import {
  COLLAPSE_INTERVAL_MS,
  COUNTDOWN_MS,
  MATCH_SCORE_TO_WIN,
  ROOM_MAX_PLAYERS,
  ROUND_END_MS,
  type RoomState,
} from "../../shared/protocol";

interface TestEndpoint extends RoomEndpoint {
  payloads: string[];
}

function endpoint(): TestEndpoint {
  const payloads: string[] = [];
  return {
    payloads,
    send(payload: string): void {
      payloads.push(payload);
    },
  };
}

function createRoom(manager: RoomManager, id: string, name: string, now: number): { code: string; room: ReturnType<RoomManager["roomFor"]>; endpoint: TestEndpoint } {
  const playerEndpoint = endpoint();
  const result = manager.create(id, name, playerEndpoint, now);
  assert.equal(result.ok, true, result.message);
  assert.ok(result.code);
  return { code: result.code, room: manager.roomFor(id), endpoint: playerEndpoint };
}

function addPlayer(manager: RoomManager, code: string, id: string, name: string, now: number): TestEndpoint {
  const playerEndpoint = endpoint();
  const result = manager.join(code, id, name, playerEndpoint, now);
  assert.equal(result.ok, true, result.message);
  return playerEndpoint;
}

function ready(manager: RoomManager, id: string, now: number): void {
  const result = manager.handle(id, { type: "ready", ready: true }, now);
  assert.equal(result.ok, true, result.message);
}

function startTwoPlayerSimulation(simulation: ArenaSimulation, now: number): number {
  assert.equal(simulation.addPlayer("p1", "One", now).ok, true);
  assert.equal(simulation.addPlayer("p2", "Two", now).ok, true);
  assert.equal(simulation.setReady("p1", true, now).ok, true);
  assert.equal(simulation.setReady("p2", true, now).ok, true);
  assert.equal(simulation.requestStart("p1", now).ok, true);
  const playingAt = now + COUNTDOWN_MS;
  simulation.step(playingAt, 0);
  assert.equal(simulation.phase, "playing");
  return playingAt;
}

function stateOf(simulation: ArenaSimulation, now: number): RoomState {
  return simulation.getState(now);
}

test("a player can score three rounds, reach results, and start a zeroed rematch", () => {
  const start = 10_000_000;
  const simulation = new ArenaSimulation("SCORE", "p1", start);
  let now = startTwoPlayerSimulation(simulation, start);

  for (let round = 1; round <= MATCH_SCORE_TO_WIN; round += 1) {
    // Put p2 outside the next collapse ring. The authoritative collapse, not a
    // test-only elimination call, awards the round to the remaining player.
    simulation.players.get("p2")!.state.x = 8;
    simulation.players.get("p2")!.state.z = 0;
    now += COLLAPSE_INTERVAL_MS;
    simulation.step(now, 1 / 30);

    assert.equal(simulation.phase, "roundEnd");
    assert.equal(simulation.roundWinnerId, "p1");
    assert.equal(simulation.players.get("p1")!.state.score, round);

    if (round < MATCH_SCORE_TO_WIN) {
      now = simulation.phaseEndsAt + 1;
      simulation.step(now, 0);
      assert.equal(simulation.phase, "countdown");
      now = simulation.phaseEndsAt;
      simulation.step(now, 0);
      assert.equal(simulation.phase, "playing");
    } else {
      now = simulation.phaseEndsAt + ROUND_END_MS + 1;
      simulation.step(now, 0);
      assert.equal(simulation.phase, "results");
      assert.equal(simulation.winnerId, "p1");
    }
  }

  const resultState = stateOf(simulation, now);
  assert.equal(resultState.winnerId, "p1");
  assert.equal(resultState.players.find((player) => player.id === "p1")?.score, MATCH_SCORE_TO_WIN);

  assert.equal(simulation.requestRematch("p1", now).ok, true);
  assert.equal(simulation.phase, "countdown");
  assert.equal(simulation.winnerId, null);
  assert.equal(simulation.roundWinnerId, null);
  assert.deepEqual(
    [...simulation.players.values()].map((player) => player.state.score),
    [0, 0],
  );
  simulation.step(simulation.phaseEndsAt, 0);
  assert.equal(simulation.phase, "playing");
  assert.equal(simulation.aliveCount, 2);
});

test("a late join at round end is a spectator until the next round boundary", () => {
  const now = 11_000_000;
  const manager = new RoomManager();
  const created = createRoom(manager, "host", "Host", now);
  const room = manager.roomFor("host");
  assert.ok(room);
  addPlayer(manager, created.code, "guest", "Guest", now);
  ready(manager, "host", now);
  ready(manager, "guest", now);
  assert.equal(manager.handle("host", { type: "start" }, now).ok, true);

  room.simulation.step(room.simulation.phaseEndsAt, 0);
  assert.equal(room.simulation.phase, "playing");
  room.simulation.players.get("guest")!.state.x = 8;
  const collapseAt = room.simulation.nextCollapseAt;
  room.simulation.step(collapseAt, 1 / 30);
  assert.equal(room.simulation.phase, "roundEnd");

  addPlayer(manager, created.code, "late", "Late", collapseAt + 1);
  const late = room.simulation.players.get("late");
  assert.ok(late);
  assert.equal(late.spectator, true);
  assert.equal(late.state.connected, true);
  assert.equal(late.state.alive, false);
  assert.equal(room.simulation.activeConnectedCount, 2);

  room.simulation.step(room.simulation.phaseEndsAt + 1, 0);
  assert.equal(room.simulation.phase, "countdown");
  assert.equal(late.spectator, false);
  assert.equal(late.state.alive, true);
  assert.equal(room.simulation.activeConnectedCount, 3);
});

test("room commands and state remain isolated, while invalid and full rooms are rejected", () => {
  const now = 12_000_000;
  const manager = new RoomManager();
  const first = createRoom(manager, "a-host", "A Host", now);
  const second = createRoom(manager, "b-host", "B Host", now);
  assert.notEqual(first.code, second.code);
  addPlayer(manager, first.code, "a-guest", "A Guest", now);
  addPlayer(manager, second.code, "b-guest", "B Guest", now);

  assert.equal(manager.handle("a-host", { type: "ready", ready: true }, now).ok, true);
  assert.equal(manager.roomFor("a-host")?.simulation.players.get("a-host")?.state.ready, true);
  assert.equal(manager.roomFor("b-host")?.simulation.players.get("b-host")?.state.ready, false);
  assert.notEqual(manager.roomFor("a-host"), manager.roomFor("b-host"));

  const missing = manager.join("ZZZZZ", "missing", "Missing", endpoint(), now);
  assert.equal(missing.ok, false);
  assert.match(missing.message ?? "", /not found/i);
  const orphan = manager.handle("orphan", { type: "ready", ready: true }, now);
  assert.equal(orphan.ok, false);
  assert.match(orphan.message ?? "", /join or create/i);

  for (let index = 2; index < ROOM_MAX_PLAYERS; index += 1) {
    addPlayer(manager, first.code, `a-${index}`, `A${index}`, now);
  }
  assert.equal(manager.roomFor("a-host")?.simulation.connectedCount, ROOM_MAX_PLAYERS);
  const full = manager.join(first.code, "a-overflow", "Overflow", endpoint(), now);
  assert.equal(full.ok, false);
  assert.match(full.message ?? "", /full/i);
});

test("host departure replaces the host, then fewer than two players resets the round to lobby", () => {
  const now = 13_000_000;
  const manager = new RoomManager();
  const created = createRoom(manager, "host", "Host", now);
  const room = manager.roomFor("host");
  assert.ok(room);
  addPlayer(manager, created.code, "guest-1", "Guest 1", now);
  addPlayer(manager, created.code, "guest-2", "Guest 2", now);
  ready(manager, "host", now);
  ready(manager, "guest-1", now);
  ready(manager, "guest-2", now);
  assert.equal(manager.handle("host", { type: "start" }, now).ok, true);
  room.simulation.step(room.simulation.phaseEndsAt, 0);
  assert.equal(room.simulation.phase, "playing");

  manager.disconnect("host", now + 1);
  assert.equal(room.simulation.hostId, "guest-1");
  assert.equal(room.simulation.phase, "playing");
  assert.equal(room.simulation.connectedCount, 2);

  manager.disconnect("guest-1", now + 2);
  assert.equal(room.simulation.phase, "lobby");
  assert.equal(room.simulation.hostId, "guest-2");
  assert.equal(room.simulation.round, 0);
  assert.equal(room.simulation.winnerId, null);
  assert.deepEqual(room.simulation.getState(now + 2).players.map((player) => player.id), ["guest-2"]);
  assert.equal(room.simulation.players.get("guest-2")?.state.ready, false);
  assert.equal(room.simulation.players.get("guest-2")?.state.alive, false);
  assert.equal(manager.roomFor("host"), null);
  assert.equal(manager.roomFor("guest-1"), null);
  assert.equal(manager.roomFor("guest-2"), room);
});

test("validation rejects malformed, extra-key, unsafe-name, and non-finite input messages", () => {
  assert.match(parseClientMessage("{").error ?? "", /valid JSON/i);
  assert.match(parseClientMessage('{"type":"input","x":1e400,"z":0,"dash":false,"charge":false}').error ?? "", /invalid input/i);
  assert.match(parseClientMessage('{"type":"input","x":null,"z":0,"dash":false,"charge":false}').error ?? "", /invalid input/i);
  assert.match(parseClientMessage('{"type":"input","x":0,"z":0,"dash":false,"charge":false,"extra":true}').error ?? "", /invalid input/i);
  assert.match(parseClientMessage(JSON.stringify({ type: "join", code: "BAD!", name: "Pilot" })).error ?? "", /invalid join/i);
  assert.match(parseClientMessage(JSON.stringify({ type: "create", name: "<pilot>" })).error ?? "", /invalid create/i);
  assert.match(parseClientMessage('{"type":"create","name":"Pilot\\u0000"}').error ?? "", /invalid create/i);
  assert.match(parseClientMessage(JSON.stringify({ type: "create", name: "x".repeat(MAX_NAME_LENGTH + 1) })).error ?? "", /invalid create/i);

  const normalized = parseClientMessage(JSON.stringify({ type: "join", code: " abcde ", name: "  Pilot  " }));
  assert.deepEqual(normalized.message, { type: "join", code: "ABCDE", name: "Pilot" });
  assert.equal(validateName("  e\u0301  "), "é");
  assert.equal(validateName(""), null);

  const simulation = new ArenaSimulation("INPUT", "p1", 14_000_000);
  assert.equal(simulation.addPlayer("p1", "One", 14_000_000).ok, true);
  assert.equal(
    simulation.setInput("p1", { x: Number.NaN, z: Number.POSITIVE_INFINITY, dash: false, charge: false }, 14_000_000).ok,
    true,
  );
  assert.deepEqual(simulation.players.get("p1")?.input, { x: 0, z: 0, dash: false, charge: false });
});
