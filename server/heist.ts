import { randomInt, randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  HEIST_CONSTANTS,
  MAPS,
  pingHeist,
  claimHeistJob,
  addHeistPlayer,
  canStartHeist,
  createHeistState,
  isValidHeistCuts,
  nextHeist,
  resetHeist,
  setHeistCuts,
  setHeistLevel,
  setHeistDifficulty,
  DIFFICULTY,
  setHeistPlayerConnected,
  setHeistReady,
  setHeistRole,
  startHeist,
  stepHeist,
  type HeistClientMessage,
  type HeistInput,
  type HeistPlayer,
  type HeistState,
  type HeistWireMessage,
  type Role,
} from "../shared/heist";

export const HEIST_SERVER_CONSTANTS = {
  MAX_MESSAGE_BYTES: 8 * 1024,
  MAX_NAME_LENGTH: 18,
  MAX_CODE_LENGTH: 8,
  ROOM_CODE_LENGTH: 5,
  ROOM_MAX_PLAYERS: 4,
  ROOM_MAX_COUNT: 100,
  INITIAL_MESSAGE_TIMEOUT_MS: 5_000,
  STALE_INPUT_MS: 500,
  TICK_MS: 1_000 / 30,
  SNAPSHOT_MS: 50,
  HEARTBEAT_MS: 15_000,
  MESSAGE_RATE_PER_SECOND: 60,
  MESSAGE_BURST: 100,
  MAX_PROTOCOL_STRIKES: 5,
  EMPTY_ROOM_GRACE_MS: 60_000,
  MAX_BUFFERED_BYTES: 1_048_576,
} as const;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROLES: readonly Role[] = ["hacker", "infiltrator", "carrier", "lookout"];

export interface HeistEndpoint {
  send(payload: string): void;
}

export interface HeistRoom {
  readonly code: string;
  state: HeistState;
  readonly endpoints: Map<string, HeistEndpoint>;
  readonly inputs: Map<string, HeistInput>;
  readonly inputAt: Map<string, number>;
  emptySince: number | null;
}

export interface HeistServerHandle {
  readonly wsServer: WebSocketServer;
  readonly rooms: Map<string, HeistRoom>;
  close(): Promise<void>;
  tick(now?: number, dt?: number): void;
  broadcast(now?: number): void;
}

interface HeistSession extends HeistEndpoint {
  readonly id: string;
  readonly ws: WebSocket;
  room: HeistRoom | null;
  joined: boolean;
  protocolStrikes: number;
  tokens: number;
  tokenUpdatedAt: number;
  isAlive: boolean;
  initialMessageTimer: NodeJS.Timeout;
}

function parseUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? "/", "http://localhost");
  } catch {
    return null;
  }
}

function rawToText(data: RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}

function sendSocket(ws: WebSocket, message: HeistWireMessage): boolean {
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > HEIST_SERVER_CONSTANTS.MAX_BUFFERED_BYTES) {
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
    return false;
  }
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    ws.terminate();
    return false;
  }
}

function safeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").trim();
  if (name.length < 1 || [...name].length > HEIST_SERVER_CONSTANTS.MAX_NAME_LENGTH) return null;
  for (const character of name) if (/\p{C}/u.test(character) || /[\[\]{}<>]/u.test(character)) return null;
  return name;
}

function safeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return code.length >= 4 && code.length <= HEIST_SERVER_CONSTANTS.MAX_CODE_LENGTH && /^[A-Z0-9]+$/.test(code) ? code : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

function ownKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const accepted = new Set(allowed);
  return Object.keys(record).every((key) => accepted.has(key));
}

function parseClientMessage(raw: string): { message?: HeistClientMessage; error?: string } {
  if (Buffer.byteLength(raw, "utf8") > HEIST_SERVER_CONSTANTS.MAX_MESSAGE_BYTES) return { error: "Message is too large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Message must be valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { error: "Invalid message" };
  const record = parsed as Record<string, unknown>;
  if (typeof record.type !== "string") return { error: "Invalid message" };
  switch (record.type) {
    case "create": {
      const name = safeName(record.name);
      if (!ownKeys(record, ["type", "name"]) || !name) return { error: "Invalid create message" };
      return { message: { type: "create", name } };
    }
    case "join": {
      const name = safeName(record.name);
      const code = safeCode(record.code);
      if (!ownKeys(record, ["type", "name", "code"]) || !name || !code) return { error: "Invalid join message" };
      return { message: { type: "join", name, code } };
    }
    case "start":
    case "ping":
    case "restart":
    case "next":
      if (!ownKeys(record, ["type"])) return { error: `Invalid ${record.type} message` };
      return { message: { type: record.type } };
    case "level": {
      const level = record.level;
      if (!ownKeys(record, ["type", "level"]) || typeof level !== "number" || !Number.isInteger(level) || !Number.isFinite(level) || level < 0 || level >= MAPS.length) {
        return { error: "Invalid level message" };
      }
      return { message: { type: "level", level } };
    }
    case "difficulty":
      if (!ownKeys(record, ["type", "difficulty"]) || typeof record.difficulty !== "string" || !Object.hasOwn(DIFFICULTY, record.difficulty)) {
        return { error: "Invalid difficulty message" };
      }
      return { message: { type: "difficulty", difficulty: record.difficulty as keyof typeof DIFFICULTY } };
    case "job":
      if(!ownKeys(record,['type','job'])||typeof record.job!=='string'||record.job.length>40)return {error:'Invalid job'};
      return {message:{type:'job',job:record.job}};
    case "role":
      if (!ownKeys(record, ["type", "role"]) || !ROLES.includes(record.role as Role)) return { error: "Invalid role message" };
      return { message: { type: "role", role: record.role as Role } };
    case "ready":
      if (!ownKeys(record, ["type", "ready"]) || typeof record.ready !== "boolean") return { error: "Invalid ready message" };
      return { message: { type: "ready", ready: record.ready } };
    case "cuts": {
      if (!ownKeys(record, ["type", "cuts"]) || typeof record.cuts !== "object" || record.cuts === null || Array.isArray(record.cuts)) {
        return { error: "Invalid cuts message" };
      }
      const cuts: Record<string, number> = {};
      for (const [id, value] of Object.entries(record.cuts as Record<string, unknown>)) {
        if (!Number.isInteger(value) || !Number.isFinite(value)) return { error: "Invalid cuts message" };
        cuts[id] = value as number;
      }
      return { message: { type: "cuts", cuts } };
    }
    case "input":
      if (
        !ownKeys(record, ["type", "x", "z", "interact", "crouch", "sprint", "yaw", "takedown", "talk", "talkAt"]) ||
        !finite(record.x) || !finite(record.z) || typeof record.interact !== "boolean" ||
        (record.crouch !== undefined && typeof record.crouch !== "boolean") ||
        (record.sprint !== undefined && typeof record.sprint !== "boolean") ||
        (record.takedown !== undefined && typeof record.takedown !== "boolean") ||
        (record.talk !== undefined && typeof record.talk !== "boolean") ||
        (record.talkAt !== undefined && !finite(record.talkAt)) ||
        (record.yaw !== undefined && !finite(record.yaw))
      ) return { error: "Invalid input message" };
      return {
        message: {
          type: "input",
          x: record.x,
          z: record.z,
          interact: record.interact,
          ...(record.crouch === undefined ? {} : { crouch: record.crouch }),
          ...(record.sprint === undefined ? {} : { sprint: record.sprint }),
          ...(record.yaw === undefined ? {} : { yaw: record.yaw }),
          ...(record.takedown === undefined ? {} : { takedown: record.takedown }),
          ...(record.talk === undefined ? {} : { talk: record.talk }),
          ...(record.talkAt === undefined ? {} : { talkAt: record.talkAt }),
        },
      };
    default:
      return { error: "Unknown message type" };
  }
}

function consumeToken(session: HeistSession, now: number): boolean {
  const elapsed = Math.max(0, now - session.tokenUpdatedAt) / 1_000;
  session.tokens = Math.min(HEIST_SERVER_CONSTANTS.MESSAGE_BURST, session.tokens + elapsed * HEIST_SERVER_CONSTANTS.MESSAGE_RATE_PER_SECOND);
  session.tokenUpdatedAt = now;
  if (session.tokens < 1) return false;
  session.tokens -= 1;
  return true;
}

function makeCode(rooms: Map<string, HeistRoom>): string {
  for (;;) {
    let code = "";
    for (let index = 0; index < HEIST_SERVER_CONSTANTS.ROOM_CODE_LENGTH; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

function activePlayers(state: HeistState): HeistPlayer[] {
  return state.players.filter((player) => player.connected);
}

function sendError(session: HeistSession, message: string): void {
  sendSocket(session.ws, { type: "error", message });
}

function broadcastRoom(room: HeistRoom): void {
  const payload = JSON.stringify({ type: "state", state: room.state });
  for (const [id, endpoint] of room.endpoints) {
    try {
      endpoint.send(payload);
    } catch {
      room.endpoints.delete(id);
    }
  }
}

/** Attach the heist protocol without touching any other HTTP upgrade path. */
export function attachHeistServer(httpServer: HttpServer): HeistServerHandle {
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: HEIST_SERVER_CONSTANTS.MAX_MESSAGE_BYTES });
  const rooms = new Map<string, HeistRoom>();
  const sessions = new Map<string, HeistSession>();
  let lastTick = Date.now();
  let closed = false;

  const leave = (session: HeistSession, now = Date.now()): void => {
    clearTimeout(session.initialMessageTimer);
    sessions.delete(session.id);
    const room = session.room;
    if (!room) return;
    const departed = room.state.players.find((player) => player.id === session.id);
    room.endpoints.delete(session.id);
    room.inputs.delete(session.id);
    room.inputAt.delete(session.id);
    session.room = null;
    setHeistPlayerConnected(room.state, session.id, false);
    const replacement = activePlayers(room.state)[0];
    if (room.state.hostId === session.id && replacement) room.state.hostId = replacement.id;
    if (activePlayers(room.state).length === 0) room.emptySince ??= now;
    else room.emptySince = null;
    if (room.state.phase === "playing" && activePlayers(room.state).length < HEIST_CONSTANTS.MIN_PLAYERS) {
      room.state.phase = "lost";
      room.state.notice = `${departed?.name ?? "A crew member"} disconnected — the run failed`;
    } else if (room.state.phase === "playing") {
      room.state.notice = `${departed?.name ?? "A crew member"} disconnected; stale input stopped`;
    } else if (room.state.phase === "lobby") {
      room.state.notice = `${departed?.name ?? "A crew member"} disconnected; waiting for crew`;
    }
    broadcastRoom(room);
  };

  const createRoom = (session: HeistSession, name: string): HeistRoom | null => {
    if (rooms.size >= HEIST_SERVER_CONSTANTS.ROOM_MAX_COUNT) return null;
    const code = makeCode(rooms);
    const state = createHeistState(code, session.id, [{ id: session.id, name, connected: true }]);
    const room: HeistRoom = { code, state, endpoints: new Map([[session.id, session]]), inputs: new Map(), inputAt: new Map(), emptySince: null };
    rooms.set(code, room);
    session.room = room;
    session.joined = true;
    sendSocket(session.ws, { type: "welcome", id: session.id, code });
    sendSocket(session.ws, { type: "state", state });
    return room;
  };

  const joinRoom = (session: HeistSession, code: string, name: string): HeistRoom | null => {
    const room = rooms.get(code);
    if (!room) {
      sendError(session, "Room not found");
      return null;
    }
    if (room.state.phase !== "lobby") {
      sendError(session, "That heist has already started");
      return null;
    }
    if (activePlayers(room.state).length >= HEIST_SERVER_CONSTANTS.ROOM_MAX_PLAYERS) {
      sendError(session, "Room is full");
      return null;
    }
    if (!addHeistPlayer(room.state, { id: session.id, name, connected: true })) {
      sendError(session, "Could not join room");
      return null;
    }
    room.endpoints.set(session.id, session);
    room.emptySince = null;
    session.room = room;
    session.joined = true;
    sendSocket(session.ws, { type: "welcome", id: session.id, code: room.code });
    sendSocket(session.ws, { type: "state", state: room.state });
    return room;
  };

  const command = (session: HeistSession, message: HeistClientMessage, now: number): void => {
    if (!session.joined || !session.room) {
      if (message.type === "create") {
        const room = createRoom(session, message.name);
        if (!room) sendError(session, "Server room capacity reached; try again later");
      } else if (message.type === "join") {
        joinRoom(session, message.code, message.name);
      } else {
        sendError(session, "Create or join a room first");
      }
      if (session.room) broadcastRoom(session.room);
      return;
    }
    const room = session.room;
    switch (message.type) {
      case "create":
      case "join":
        sendError(session, "Create or join is only allowed as the first message");
        return;
      case "role":
        if (!setHeistRole(room.state, session.id, message.role)) sendError(session, "Roles can only change in the lobby");
        else broadcastRoom(room);
        return;
      case "level":
        if (room.state.hostId !== session.id) sendError(session, "Only the host can choose the map");
        else if (!setHeistLevel(room.state, message.level)) sendError(session, "Map selection is only available in the lobby");
        else broadcastRoom(room);
        return;
      case "difficulty":
        if (room.state.hostId !== session.id) sendError(session, "Only the host can choose the difficulty");
        else if (!setHeistDifficulty(room.state, message.difficulty)) sendError(session, "Difficulty can only change in the lobby");
        else broadcastRoom(room);
        return;
      case "ready":
        if (!setHeistReady(room.state, session.id, message.ready)) sendError(session, "Ready status can only change in the lobby");
        else broadcastRoom(room);
        return;
      case "cuts":
        if (room.state.hostId !== session.id) sendError(session, "Only the host can change the loot split");
        else if (!setHeistCuts(room.state, message.cuts)) sendError(session, "Cuts must be integer percentages totaling 100");
        else broadcastRoom(room);
        return;
      case "start":
        if (room.state.hostId !== session.id) sendError(session, "Only the host can start the heist");
        else if (activePlayers(room.state).length < HEIST_CONSTANTS.MIN_PLAYERS) sendError(session, "At least one connected player is required");
        else if (!canStartHeist(room.state)) sendError(session, "Every connected crew member must be ready with cuts totaling 100");
        else {
          startHeist(room.state);
          broadcastRoom(room);
        }
        return;
      case "job":
        claimHeistJob(room.state,session.id,message.job);broadcastRoom(room);return;
      case "ping":
        pingHeist(room.state,session.id);broadcastRoom(room);return;
      case "input":
        room.inputs.set(session.id, message);
        room.inputAt.set(session.id, now);
        return;
      case "restart":
        if (room.state.hostId !== session.id) sendError(session, "Only the host can restart the heist");
        else if (room.state.phase !== "won" && room.state.phase !== "lost") sendError(session, "Restart is available after the heist ends");
        else {
          resetHeist(room.state);
          room.inputs.clear();
          room.inputAt.clear();
          broadcastRoom(room);
        }
        return;
      case "next":
        if (room.state.hostId !== session.id) sendError(session, "Only the host can choose the next map");
        else if (room.state.phase !== "won") sendError(session, "Finish the current map before advancing");
        else if (room.state.level >= MAPS.length - 1) sendError(session, "The campaign is complete");
        else {
          nextHeist(room.state);
          room.inputs.clear();
          room.inputAt.clear();
          broadcastRoom(room);
        }
        return;
    }
  };

  wsServer.on("connection", (ws: WebSocket) => {
    const now = Date.now();
    const id = randomUUID();
    const session = {
      id,
      ws,
      room: null,
      joined: false,
      protocolStrikes: 0,
      tokens: HEIST_SERVER_CONSTANTS.MESSAGE_BURST,
      tokenUpdatedAt: now,
      isAlive: true,
      initialMessageTimer: setTimeout(() => {
        if (!session.joined && ws.readyState === WebSocket.OPEN) {
          sendError(session, "Create or join a room first");
          ws.close(1008, "initial message timeout");
        }
      }, HEIST_SERVER_CONSTANTS.INITIAL_MESSAGE_TIMEOUT_MS),
      send(payload: string): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > HEIST_SERVER_CONSTANTS.MAX_BUFFERED_BYTES) {
          ws.terminate();
          return;
        }
        ws.send(payload);
      },
    } satisfies HeistSession;
    sessions.set(id, session);
    ws.on("pong", () => {
      session.isAlive = true;
    });
    ws.on("message", (data: RawData) => {
      const receivedAt = Date.now();
      if (!consumeToken(session, receivedAt)) {
        session.protocolStrikes += 1;
        sendError(session, "Too many messages");
        if (session.protocolStrikes >= HEIST_SERVER_CONSTANTS.MAX_PROTOCOL_STRIKES) ws.close(1008, "rate limit");
        return;
      }
      const parsed = parseClientMessage(rawToText(data));
      if (!parsed.message) {
        session.protocolStrikes += 1;
        sendError(session, parsed.error ?? "Invalid message");
        if (session.protocolStrikes >= HEIST_SERVER_CONSTANTS.MAX_PROTOCOL_STRIKES) ws.close(1008, "invalid protocol");
        return;
      }
      command(session, parsed.message, receivedAt);
    });
    ws.on("error", () => {
      // close is the single cleanup path
    });
    ws.on("close", () => leave(session));
  });

  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    const requestUrl = parseUrl(request);
    // Do not destroy or claim another websocket endpoint owned by server/index.
    if (!requestUrl || requestUrl.pathname !== "/heist/ws") return;
    if (closed || sessions.size >= HEIST_SERVER_CONSTANTS.ROOM_MAX_COUNT * HEIST_SERVER_CONSTANTS.ROOM_MAX_PLAYERS) {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => wsServer.emit("connection", ws, request));
  };
  httpServer.on("upgrade", onUpgrade);

  const tick = (now = Date.now(), dt = Math.min(0.25, Math.max(0, (now - lastTick) / 1_000))): void => {
    if (closed) return;
    lastTick = now;
    for (const [code, room] of rooms) {
      if (room.state.phase === "playing") {
        const inputs = new Map<string, HeistInput>();
        for (const player of room.state.players) {
          if (!player.connected) continue;
          const input = room.inputs.get(player.id);
          const sentAt = room.inputAt.get(player.id) ?? -Infinity;
          if (input && now - sentAt <= HEIST_SERVER_CONSTANTS.STALE_INPUT_MS) inputs.set(player.id, input);
        }
        stepHeist(room.state, inputs, dt);
      }
      if (activePlayers(room.state).length === 0) {
        room.emptySince ??= now;
        if (now - room.emptySince >= HEIST_SERVER_CONSTANTS.EMPTY_ROOM_GRACE_MS) rooms.delete(code);
      } else room.emptySince = null;
    }
  };

  const broadcast = (): void => {
    if (closed) return;
    for (const room of rooms.values()) broadcastRoom(room);
  };

  const tickTimer = setInterval(() => tick(Date.now()), HEIST_SERVER_CONSTANTS.TICK_MS);
  const snapshotTimer = setInterval(broadcast, HEIST_SERVER_CONSTANTS.SNAPSHOT_MS);
  const heartbeatTimer = setInterval(() => {
    for (const session of sessions.values()) {
      if (session.ws.readyState !== WebSocket.OPEN || !session.isAlive) {
        session.ws.terminate();
        continue;
      }
      session.isAlive = false;
      session.ws.ping();
    }
  }, HEIST_SERVER_CONSTANTS.HEARTBEAT_MS);
  tickTimer.unref?.();
  snapshotTimer.unref?.();
  heartbeatTimer.unref?.();

  let wsClosePromise: Promise<void> | null = null;
  const closeWs = (): Promise<void> => {
    if (wsClosePromise) return wsClosePromise;
    wsClosePromise = new Promise<void>((resolve) => {
      try {
        wsServer.close(() => resolve());
      } catch {
        resolve();
      }
    });
    return wsClosePromise;
  };
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(tickTimer);
    clearInterval(snapshotTimer);
    clearInterval(heartbeatTimer);
    httpServer.off("upgrade", onUpgrade);
    for (const session of sessions.values()) {
      clearTimeout(session.initialMessageTimer);
      if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) session.ws.close(1001, "server shutdown");
    }
    sessions.clear();
    rooms.clear();
    void closeWs();
  };
  httpServer.once("close", cleanup);

  return {
    wsServer,
    rooms,
    tick,
    broadcast,
    async close(): Promise<void> {
      cleanup();
      await closeWs();
    },
  };
}

export { parseClientMessage as parseHeistClientMessage };
export { ROLES as HEIST_ROLES };
export { isValidHeistCuts };

