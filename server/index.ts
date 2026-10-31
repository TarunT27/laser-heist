import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { RoomManager, type RoomEndpoint } from "./room";
import { MAX_MESSAGE_BYTES, parseClientMessage } from "./validation";
import { attachHeistServer } from "./heist";

const DEFAULT_PORT = 3_000;
const INITIAL_MESSAGE_TIMEOUT_MS = 5_000;
const SNAPSHOT_INTERVAL_MS = 50;
const SIMULATION_INTERVAL_MS = 1_000 / 30;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MESSAGE_RATE_PER_SECOND = 60;
const MESSAGE_BURST = 100;
const MAX_PROTOCOL_STRIKES = 5;
const CREATE_LIMIT = 5;
const CREATE_WINDOW_MS = 60_000;
const MAX_SESSIONS = 300;
const MAX_ROOMS = 100;
const MAX_BUFFERED_BYTES = 1_048_576;

type RawMessage = string | Buffer | ArrayBuffer | Buffer[];

interface Session extends RoomEndpoint {
  id: string;
  ws: WebSocket;
  ip: string;
  joined: boolean;
  isAlive: boolean;
  strikes: number;
  tokens: number;
  tokenUpdatedAt: number;
  initialMessageTimer: NodeJS.Timeout;
}

export interface ServerOptions {
  /** Port 0 is supported for tests and asks the OS for an available port. */
  port?: number;
  distDir?: string;
  manager?: RoomManager;
  logger?: Pick<Console, "log" | "error">;
}

export interface RunningServer {
  httpServer: ReturnType<typeof createServer>;
  wsServer: WebSocketServer;
  manager: RoomManager;
  port: number;
  close(): Promise<void>;
}

interface CreateAttempt {
  timestamps: number[];
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
};

function resolvePort(value: number | string | undefined): number {
  const number = typeof value === "number" ? value : Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(number) || number < 0 || number > 65_535) return DEFAULT_PORT;
  return number;
}

function requestIp(request: IncomingMessage): string {
  // Do not trust a client-supplied X-Forwarded-For header for abuse limits.
  // The direct peer is the only address this process can authenticate.
  return request.socket.remoteAddress ?? "unknown";
}

function parseRequestUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? "/", "http://localhost");
  } catch {
    return null;
  }
}

function rawToText(data: RawMessage): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}

function jsonError(message: string): string {
  return JSON.stringify({ type: "error", message });
}

function sendSocketPayload(ws: WebSocket, payload: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
    ws.terminate();
    return false;
  }
  try {
    ws.send(payload);
    return true;
  } catch {
    ws.terminate();
    return false;
  }
}

function sendError(session: Session, message: string): void {
  sendSocketPayload(session.ws, jsonError(message));
}

function consumeMessageToken(session: Session, now: number): boolean {
  const elapsed = Math.max(0, now - session.tokenUpdatedAt) / 1_000;
  session.tokens = Math.min(MESSAGE_BURST, session.tokens + elapsed * MESSAGE_RATE_PER_SECOND);
  session.tokenUpdatedAt = now;
  if (session.tokens < 1) return false;
  session.tokens -= 1;
  return true;
}

function hasCreateBudget(attempts: Map<string, CreateAttempt>, ip: string, now: number): boolean {
  const attempt = attempts.get(ip) ?? { timestamps: [] };
  attempt.timestamps = attempt.timestamps.filter((timestamp) => now - timestamp < CREATE_WINDOW_MS);
  if (attempt.timestamps.length >= CREATE_LIMIT) {
    attempts.set(ip, attempt);
    return false;
  }
  attempt.timestamps.push(now);
  attempts.set(ip, attempt);
  return true;
}

function pruneCreationAttempts(attempts: Map<string, CreateAttempt>, now: number): void {
  for (const [ip, attempt] of attempts) {
    attempt.timestamps = attempt.timestamps.filter((timestamp) => now - timestamp < CREATE_WINDOW_MS);
    if (attempt.timestamps.length === 0) attempts.delete(ip);
  }
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  distDir: string,
): Promise<void> {
  const requestUrl = parseRequestUrl(request);
  if (!requestUrl) {
    response.writeHead(400).end("Bad request");
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const root = resolve(distDir);
  const candidate = resolve(root, `.${normalize(pathname)}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  let filePath = candidate;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = resolve(filePath, "index.html");
    await fs.access(filePath);
  } catch {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

/** Create and listen on the authoritative game server. */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const logger = options.logger ?? console;
  const manager = options.manager ?? new RoomManager();
  const distDir = resolve(options.distDir ?? join(process.cwd(), "dist"));
  const sessions = new Map<string, Session>();
  const creationAttempts = new Map<string, CreateAttempt>();
  const startedAt = Date.now();

  const httpServer = createServer((request, response) => {
    const requestUrl = parseRequestUrl(request);
    if (!requestUrl) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
      return;
    }
    if (requestUrl.pathname === "/health") {
      const body = JSON.stringify({ ok: true, rooms: manager.rooms.size, uptime: Math.floor((Date.now() - startedAt) / 1_000) });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(body);
      return;
    }
    if (requestUrl.pathname === "/ws") {
      response.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" }).end("Upgrade Required");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
      return;
    }
    void serveStatic(request, response, distDir);
  });

  const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const heistServer = attachHeistServer(httpServer);

  const removeSession = (session: Session, now = Date.now()): void => {
    clearTimeout(session.initialMessageTimer);
    sessions.delete(session.id);
    const room = manager.disconnect(session.id, now);
    if (room) room.broadcastState(now);
  };

  wsServer.on("connection", (ws, request) => {
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      ws,
      ip: requestIp(request),
      joined: false,
      isAlive: true,
      strikes: 0,
      tokens: MESSAGE_BURST,
      tokenUpdatedAt: now,
      initialMessageTimer: setTimeout(() => {
        if (!session.joined && ws.readyState === WebSocket.OPEN) {
          sendError(session, "Create or join a room first");
          ws.close(1008, "initial message timeout");
        }
      }, INITIAL_MESSAGE_TIMEOUT_MS),
      send(payload: string): void {
        sendSocketPayload(ws, payload);
      },
    };
    sessions.set(session.id, session);

    ws.on("pong", () => {
      session.isAlive = true;
    });
    ws.on("error", () => {
      // The close event performs the single cleanup path.
    });
    ws.on("close", () => removeSession(session));
    ws.on("message", (data: RawMessage) => {
      const receivedAt = Date.now();
      if (!consumeMessageToken(session, receivedAt)) {
        session.strikes += 1;
        sendError(session, "Too many messages");
        if (session.strikes >= MAX_PROTOCOL_STRIKES) ws.close(1008, "rate limit");
        return;
      }
      const parsed = parseClientMessage(rawToText(data));
      if (!parsed.message) {
        session.strikes += 1;
        sendError(session, parsed.error ?? "Invalid message");
        if (session.strikes >= MAX_PROTOCOL_STRIKES) ws.close(1008, "invalid protocol");
        return;
      }
      const message = parsed.message;

      if (!session.joined) {
        if (message.type !== "create" && message.type !== "join") {
          sendError(session, "Create or join a room first");
          return;
        }
        if (message.type === "create" && manager.rooms.size >= MAX_ROOMS) {
          sendError(session, "Server room capacity reached; try again later");
          return;
        }
        if (message.type === "create" && !hasCreateBudget(creationAttempts, session.ip, receivedAt)) {
          sendError(session, "Too many room creations; try again later");
          return;
        }
        const result = message.type === "create"
          ? manager.create(session.id, message.name, session, receivedAt)
          : manager.join(message.code, session.id, message.name, session, receivedAt);
        if (!result.ok || !result.code) {
          sendError(session, result.message ?? "Could not join room");
          return;
        }
        session.joined = true;
        clearTimeout(session.initialMessageTimer);
        session.send(JSON.stringify({ type: "welcome", id: session.id, code: result.code }));
        const room = manager.roomFor(session.id);
        room?.sendState(session.id, receivedAt);
        room?.broadcastState(receivedAt);
        return;
      }

      const room = manager.roomFor(session.id);
      const result = manager.handle(session.id, message, receivedAt);
      if (!result.ok) {
        sendError(session, result.message ?? "Command rejected");
        return;
      }
      if (result.close) {
        session.joined = false;
        room?.broadcastState(receivedAt);
        ws.close(1000, "left room");
        return;
      }
      // Inputs are sampled by the 30 Hz simulation; command/state changes are
      // reflected immediately so a lobby UI does not wait for the next tick.
      if (message.type !== "input") room?.broadcastState(receivedAt);
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const requestUrl = parseRequestUrl(request);
    if (!requestUrl) {
      socket.destroy();
      return;
    }
    const pathname = requestUrl.pathname;
    if (pathname === "/heist/ws") return;
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (sessions.size >= MAX_SESSIONS) {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => wsServer.emit("connection", ws, request));
  });

  const simulationTimer = setInterval(() => {
    manager.tick(Date.now(), 1 / 30);
  }, SIMULATION_INTERVAL_MS);
  const snapshotTimer = setInterval(() => {
    manager.broadcast(Date.now());
  }, SNAPSHOT_INTERVAL_MS);
  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    pruneCreationAttempts(creationAttempts, now);
    for (const session of sessions.values()) {
      if (session.ws.readyState !== WebSocket.OPEN) {
        session.ws.terminate();
        continue;
      }
      if (!session.isAlive) {
        session.ws.terminate();
        continue;
      }
      session.isAlive = false;
      session.ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error): void => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      httpServer.off("error", onError);
      resolvePromise();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(resolvePort(options.port ?? process.env.PORT));
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : resolvePort(options.port ?? process.env.PORT);
  logger.log(`HandshakeGame server listening on ${port}`);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(simulationTimer);
    clearInterval(snapshotTimer);
    clearInterval(heartbeatTimer);
    await heistServer.close();
    for (const session of sessions.values()) session.ws.close(1001, "server shutdown");
    await Promise.all([
      new Promise<void>((resolvePromise) => wsServer.close(() => resolvePromise())),
      new Promise<void>((resolvePromise, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolvePromise()));
      }),
    ]);
  };

  return { httpServer, wsServer, manager, port, close };
}

// `tsx server/index.ts` is the production/dev entrypoint; importing the module
// in tests does not open a listener.
const directEntry = Boolean(process.argv[1] && /server[\\/]index\.(?:t|j)s$/.test(resolve(process.argv[1])));
if (directEntry) {
  void startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  DEFAULT_PORT,
  HEARTBEAT_INTERVAL_MS,
  MAX_BUFFERED_BYTES,
  MAX_ROOMS,
  MAX_SESSIONS,
  SNAPSHOT_INTERVAL_MS,
  SIMULATION_INTERVAL_MS,
};

