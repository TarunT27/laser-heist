import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { ArenaSimulation, SIMULATION_CONSTANTS } from "../simulation";
import { startServer } from "../index";
import type { ServerMessage } from "../../shared/protocol";

function advance(simulation: ArenaSimulation, start: number, seconds: number): number {
  let now = start;
  const steps = Math.ceil(seconds * 30);
  for (let index = 0; index < steps; index += 1) {
    now += 1_000 / 30;
    simulation.step(now, 1 / 30);
  }
  return now;
}

function messages(socket: WebSocket, predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for server message"));
    }, 2_000);
    const onMessage = (data: Buffer): void => {
      let message: ServerMessage;
      try {
        message = JSON.parse(data.toString()) as ServerMessage;
      } catch (error) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        reject(error);
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

test("simulation clamps input, supports dash and charge release, and collapses on schedule", () => {
  const start = 1_000_000;
  const simulation = new ArenaSimulation("ABCDE", "p1", start);
  assert.equal(simulation.addPlayer("p1", "One", start).ok, true);
  assert.equal(simulation.addPlayer("p2", "Two", start).ok, true);
  assert.equal(simulation.requestStart("p1", start).ok, false);
  assert.equal(simulation.setReady("p1", true, start).ok, true);
  assert.equal(simulation.setReady("p2", true, start).ok, true);
  assert.equal(simulation.requestStart("p1", start).ok, true);

  let now = advance(simulation, start, 3.01);
  assert.equal(simulation.phase, "playing");

  simulation.setInput("p1", { x: 99, z: 0, dash: true, charge: false }, now);
  simulation.step(now + 1_000 / 30, 1 / 30);
  now += 1_000 / 30;
  const dashed = simulation.players.get("p1")!;
  assert.equal(dashed.state.dashCooldown, 2);
  assert.ok(dashed.state.vx > 0);
  assert.ok(Math.abs(dashed.state.vz) < 0.01);

  simulation.setInput("p1", { x: 0, z: 0, dash: false, charge: true }, now);
  // A client sends held input continuously; refresh it while simulating the
  // charge so the stale-input safety timeout is not intentionally triggered.
  for (let index = 0; index < 21; index += 1) {
    now += 1_000 / 30;
    simulation.setInput("p1", { x: 0, z: 0, dash: false, charge: true }, now);
    simulation.step(now, 1 / 30);
  }
  assert.ok(dashed.state.charge > 0.4 && dashed.state.charge < 1);
  simulation.setInput("p1", { x: 0, z: 0, dash: false, charge: false }, now);
  simulation.step(now + 1_000 / 30, 1 / 30);
  assert.ok(simulation.getState(now + 1_000 / 30).events.some((event) => event.type === "wave"));

  now = advance(simulation, now, 14.4);
  const state = simulation.getState(now);
  assert.equal(state.radius, 7);
  assert.ok(state.events.some((event) => event.type === "collapse" && event.radius === 7));
});

test("simultaneous collapse deaths produce a draw without awarding a point", () => {
  const start = 2_000_000;
  const simulation = new ArenaSimulation("DRAW1", "p1", start);
  simulation.addPlayer("p1", "One", start);
  simulation.addPlayer("p2", "Two", start);
  simulation.setReady("p1", true, start);
  simulation.setReady("p2", true, start);
  simulation.requestStart("p1", start);
  let now = advance(simulation, start, 3.01);
  simulation.players.get("p1")!.state.x = 8;
  simulation.players.get("p2")!.state.x = -8;
  now = advance(simulation, now, 15.01);
  const state = simulation.getState(now);
  assert.equal(state.phase, "roundEnd");
  assert.equal(state.roundWinnerId, null);
  assert.equal(state.players.find((player) => player.id === "p1")?.score, 0);
  assert.equal(state.players.find((player) => player.id === "p2")?.score, 0);
});

test("readiness ignores disconnected records and lobby snapshots do not retain them", () => {
  const now = 3_000_000;
  const simulation = new ArenaSimulation("READY", "host", now);
  simulation.addPlayer("host", "Host", now);
  simulation.addPlayer("guest", "Guest", now);
  assert.equal(simulation.disconnect("guest", now).ok, true);
  assert.deepEqual(simulation.getState(now).players.map((player) => player.id), ["host"]);
  assert.equal(simulation.requestStart("host", now).ok, false);

  simulation.addPlayer("guest-2", "Guest 2", now);
  simulation.setReady("host", true, now);
  assert.equal(simulation.requestStart("host", now).ok, false);
  simulation.setReady("guest-2", true, now);
  assert.equal(simulation.requestStart("host", now).ok, true);
});

test("stale held input cancels charge without creating a ghost wave", () => {
  const start = 4_000_000;
  const simulation = new ArenaSimulation("STALE", "host", start);
  simulation.addPlayer("host", "Host", start);
  simulation.addPlayer("guest", "Guest", start);
  simulation.setReady("host", true, start);
  simulation.setReady("guest", true, start);
  simulation.requestStart("host", start);
  let now = advance(simulation, start, 3.01);
  simulation.setInput("host", { x: 0, z: 0, dash: false, charge: true }, now);
  now += 0.2 * 1_000;
  simulation.step(now, 0.2);
  assert.ok(simulation.players.get("host")!.state.charge > 0);
  now += SIMULATION_CONSTANTS.STALE_INPUT_MS + 50;
  simulation.step(now, 1 / 30);
  assert.equal(simulation.players.get("host")!.state.charge, 0);
  assert.equal(simulation.getState(now).events.some((event) => event.type === "wave"), false);
});

test("a fully charged pulse can knock a target across the rim at 30 Hz", () => {
  const start = 5_000_000;
  const simulation = new ArenaSimulation("RIM01", "source", start);
  simulation.addPlayer("source", "Source", start);
  simulation.addPlayer("target", "Target", start);
  simulation.setReady("source", true, start);
  simulation.setReady("target", true, start);
  simulation.requestStart("source", start);
  let now = advance(simulation, start, 3.01);
  const source = simulation.players.get("source")!;
  const target = simulation.players.get("target")!;
  source.state.x = 5;
  source.state.z = 0;
  target.state.x = 8.95;
  target.state.z = 0;

  for (let index = 0; index < 43; index += 1) {
    now += 1_000 / 30;
    simulation.setInput("source", { x: 0, z: 0, dash: false, charge: true }, now);
    simulation.setInput("target", { x: 0, z: 0, dash: false, charge: false }, now);
    simulation.step(now, 1 / 30);
  }

  assert.equal(target.state.alive, false);
  assert.ok(simulation.getState(now).events.some((event) => event.type === "wave"));
  assert.ok(simulation.getState(now).events.some((event) => event.type === "elimination" && event.playerId === "target"));
});

test("HTTP/WebSocket integration creates and joins a room, sends snapshots, and rejects non-host start", async () => {
  const server = await startServer({ port: 0, logger: { log: () => undefined, error: () => undefined } });
  const first = await openSocket(`ws://127.0.0.1:${server.port}/ws`);
  const second = await openSocket(`ws://127.0.0.1:${server.port}/ws`);
  try {
    first.send(JSON.stringify({ type: "create", name: "Host" }));
    const welcome = await messages(first, (message) => message.type === "welcome");
    assert.equal(welcome.type, "welcome");
    if (welcome.type !== "welcome") throw new Error("Expected welcome");
    assert.match(welcome.code, /^[A-Z0-9]{5}$/);

    second.send(JSON.stringify({ type: "join", code: welcome.code, name: "Guest" }));
    const joined = await messages(second, (message) => message.type === "welcome");
    assert.equal(joined.type, "welcome");
    if (joined.type !== "welcome") throw new Error("Expected join welcome");
    const joinedState = await messages(first, (message) => message.type === "state" && message.state.players.length === 2);
    assert.equal(joinedState.type, "state");
    assert.equal(joinedState.state.hostId, welcome.id);

    second.send(JSON.stringify({ type: "start" }));
    const denied = await messages(second, (message) => message.type === "error");
    if (denied.type !== "error") throw new Error("Expected error");
    assert.match(denied.message, /host/i);

    first.send(JSON.stringify({ type: "start" }));
    const notReady = await messages(first, (message) => message.type === "error");
    if (notReady.type !== "error") throw new Error("Expected readiness error");
    assert.match(notReady.message, /ready/i);

    first.send(JSON.stringify({ type: "ready", ready: true }));
    await messages(first, (message) => message.type === "state" && message.state.players.find((player) => player.id === welcome.id)?.ready === true);
    second.send(JSON.stringify({ type: "ready", ready: true }));
    await messages(first, (message) => message.type === "state" && message.state.players.length === 2 && message.state.players.every((player) => player.ready));

    first.send(JSON.stringify({ type: "start" }));
    const countdown = await messages(first, (message) => message.type === "state" && message.state.phase === "countdown");
    assert.equal(countdown.type, "state");
    if (countdown.type !== "state") throw new Error("Expected countdown");
    assert.equal(countdown.state.players.filter((player) => player.connected).length, 2);
    first.send(JSON.stringify({ type: "input", x: 1, z: 0, dash: false, charge: false }));
    const snapshot = await messages(first, (message) => message.type === "state" && message.state.serverTime >= countdown.state.serverTime);
    assert.equal(snapshot.type, "state");
  } finally {
    first.close();
    second.close();
    await server.close();
  }
});

