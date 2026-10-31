import { isRecord, type ClientMessage } from "../shared/protocol";

export const MAX_MESSAGE_BYTES = 8 * 1024;
export const MAX_NAME_LENGTH = 18;
export const MAX_CODE_LENGTH = 8;

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function safeName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 1 || [...normalized].length > MAX_NAME_LENGTH) return false;
  // Keep names readable in the HUD and out of HTML-like/control syntax.
  if (/[[\]{}<>]/u.test(normalized)) return false;
  for (const character of normalized) {
    if (/\p{C}/u.test(character)) return false;
  }
  return true;
}

function safeCode(value: unknown): value is string {
  return typeof value === "string" && value.length >= 4 && value.length <= MAX_CODE_LENGTH && /^[A-Z0-9]+$/.test(value);
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return safeCode(code) ? code : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

export function validateName(value: unknown): string | null {
  if (!safeName(value)) return null;
  return value.normalize("NFKC").trim();
}

export function parseClientMessage(raw: string | Uint8Array): { message?: ClientMessage; error?: string } {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) {
    return { error: "Message is too large" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "Message must be valid JSON" };
  }
  if (!isRecord(value) || typeof value.type !== "string") return { error: "Invalid message" };

  switch (value.type) {
    case "create": {
      if (!hasOnlyKeys(value, ["type", "name"]) || !safeName(value.name)) return { error: "Invalid create message" };
      return { message: { type: "create", name: value.name.normalize("NFKC").trim() } };
    }
    case "join": {
      const code = normalizeCode(value.code);
      if (!hasOnlyKeys(value, ["type", "code", "name"]) || !code || !safeName(value.name)) {
        return { error: "Invalid join message" };
      }
      return {
        message: {
          type: "join",
          code,
          name: value.name.normalize("NFKC").trim(),
        },
      };
    }
    case "ready":
      if (!hasOnlyKeys(value, ["type", "ready"]) || typeof value.ready !== "boolean") return { error: "Invalid ready message" };
      return { message: { type: "ready", ready: value.ready } };
    case "start":
      if (!hasOnlyKeys(value, ["type"])) return { error: "Invalid start message" };
      return { message: { type: "start" } };
    case "input":
      if (
        !hasOnlyKeys(value, ["type", "x", "z", "dash", "charge"]) ||
        !finiteNumber(value.x) ||
        !finiteNumber(value.z) ||
        typeof value.dash !== "boolean" ||
        typeof value.charge !== "boolean"
      ) {
        return { error: "Invalid input message" };
      }
      return { message: { type: "input", x: value.x, z: value.z, dash: value.dash, charge: value.charge } };
    case "rematch":
      if (!hasOnlyKeys(value, ["type"])) return { error: "Invalid rematch message" };
      return { message: { type: "rematch" } };
    case "lobby":
      if (!hasOnlyKeys(value, ["type"])) return { error: "Invalid lobby message" };
      return { message: { type: "lobby" } };
    case "leave":
      if (!hasOnlyKeys(value, ["type"])) return { error: "Invalid leave message" };
      return { message: { type: "leave" } };
    default:
      return { error: "Unknown message type" };
  }
}

