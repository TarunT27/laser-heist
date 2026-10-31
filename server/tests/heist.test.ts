import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, test } from "node:test";
import { WebSocket } from "ws";
import {
  EXIT,
  HEIST_CONSTANTS,
  MAPS,
  ROLE_BONUSES,
  addHeistPlayer,
  canOccupyHeist,
  createHeistState,
  laserAt,
  nextHeist,
  setHeistCuts,
  setHeistPlayerConnected,
  startHeist,
  stepHeist,
  type HeistServerMessage,
  type HeistState,
} from "../../shared/heist";
import { attachHeistServer, type HeistServerHandle } from "../heist";

const running: Array<{ http: Server; handle: HeistServerHandle; sockets: WebSocket[] }> = [];

function waitFor(socket: WebSocket, predicate: (message: HeistServerMessage) => boolean): Promise<HeistServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for heist message"));
    }, 2_000);
    const onMessage = (data: Buffer): void => {
      let message: HeistServerMessage;
      try {
        message = JSON.parse(data.toString()) as HeistServerMessage;
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

function open(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/heist/ws`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function server(): Promise<{ http: Server; handle: HeistServerHandle; port: number }> {
  const http = createServer();
  const handle = attachHeistServer(http);
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address();
  assert.ok(address && typeof address === "object");
  running.push({ http, handle, sockets: [] });
  return { http, handle, port: address.port };
}

afterEach(async () => {
  for (const entry of running.splice(0)) {
    for (const socket of entry.sockets) socket.close();
    // Calling HTTP close exercises the required attach-on-close cleanup path.
    await new Promise<void>((resolve) => {
      if (!entry.http.listening) resolve();
      else entry.http.close(() => resolve());
    });
    await entry.handle.close();
  }
});

function playing(): HeistState {
  const state = createHeistState("TEST", "p1", [
    { id: "p1", name: "One", role: "hacker" },
    { id: "p2", name: "Two", role: "infiltrator" },
  ]);
  startHeist(state);
  return state;
}

test("disconnected lobby slots do not consume cuts for a new crew member", () => {
  const state = createHeistState("CUTS", "p1", [
    { id: "p1", name: "One" },
    { id: "p2", name: "Two" },
    { id: "p3", name: "Three" },
  ]);
  setHeistPlayerConnected(state, "p3", false);
  assert.deepEqual(state.players.map((player) => player.cut), [50, 50, 0]);
  assert.ok(addHeistPlayer(state, { id: "p4", name: "Four" }));
  assert.deepEqual(state.players.map((player) => player.cut), [34, 33, 0, 33]);
});

test("server enforces ready/cut/role/level flow and transfers host on departure", async () => {
  const live = await server();
  const host = await open(live.port);
  const guest = await open(live.port);
  running.at(-1)!.sockets.push(host, guest);
  host.send(JSON.stringify({ type: "create", name: "Host" }));
  const welcome = await waitFor(host, (message) => message.type === "welcome");
  assert.equal(welcome.type, "welcome");
  guest.send(JSON.stringify({ type: "join", name: "Guest", code: welcome.code }));
  await waitFor(guest, (message) => message.type === "welcome");

  guest.send(JSON.stringify({ type: "cuts", cuts: { [welcome.id]: 50 } }));
  const forbiddenCuts = await waitFor(guest, (message) => message.type === "error");
  assert.equal(forbiddenCuts.type, "error");
  assert.match(forbiddenCuts.message, /host/i);

  host.send(JSON.stringify({ type: "start" }));
  const notReady = await waitFor(host, (message) => message.type === "error");
  assert.equal(notReady.type, "error");
  host.send(JSON.stringify({ type: "cuts", cuts: {} }));
  const invalidCuts = await waitFor(host, (message) => message.type === "error");
  assert.equal(invalidCuts.type, "error");
  host.send(JSON.stringify({ type: "level", level: 1 }));
  const selected = await waitFor(host, (message) => message.type === "state" && message.state.level === 1);
  assert.equal(selected.type, "state");

  host.send(JSON.stringify({ type: "role", role: "hacker" }));
  guest.send(JSON.stringify({ type: "role", role: "infiltrator" }));
  host.send(JSON.stringify({ type: "ready", ready: true }));
  guest.send(JSON.stringify({ type: "ready", ready: true }));
  await waitFor(host, (message) => message.type === "state" && message.state.phase === "lobby" && message.state.players.filter((player) => player.connected).every((player) => player.ready));
  host.send(JSON.stringify({ type: "start" }));
  const started = await waitFor(host, (message) => message.type === "state" && message.state.phase === "playing");
  assert.equal(started.type, "state");
  assert.equal(started.state.level, 1);

  guest.close();
  const transferred = await waitFor(host, (message) => message.type === "state" && message.state.hostId === started.state.hostId);
  assert.equal(transferred.type, "state");
  assert.equal(transferred.state.phase, "playing");
});

