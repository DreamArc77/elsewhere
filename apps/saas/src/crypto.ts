import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { TelegramLoginProfile } from "./types.js";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const TELEGRAM_LOGIN_MAX_AGE_SECONDS = 60 * 60 * 24;

export function encryptSecret(plainText: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [ivRaw, tagRaw, encryptedRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Encrypted secret payload is malformed.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function verifyTelegramLogin(
  raw: Record<string, string | undefined>,
  botToken: string,
  now = Math.floor(Date.now() / 1000),
): TelegramLoginProfile {
  const hash = raw.hash;
  if (!hash) {
    throw new Error("Telegram login hash is missing.");
  }

  const data = Object.entries(raw)
    .filter(([key, value]) => key !== "hash" && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(data).digest("hex");
  if (!safeEqualHex(hash, expected)) {
    throw new Error("Telegram login hash is invalid.");
  }

  const id = Number.parseInt(raw.id ?? "", 10);
  const authDate = Number.parseInt(raw.auth_date ?? "", 10);
  if (!Number.isFinite(id) || !Number.isFinite(authDate)) {
    throw new Error("Telegram login payload is missing id or auth_date.");
  }
  if (now - authDate > TELEGRAM_LOGIN_MAX_AGE_SECONDS) {
    throw new Error("Telegram login payload has expired.");
  }

  return {
    id,
    first_name: raw.first_name,
    last_name: raw.last_name,
    username: raw.username,
    photo_url: raw.photo_url,
    auth_date: authDate,
  };
}

export function createSessionToken(input: {
  userId: string;
  secret: string;
  now?: number;
}): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: input.userId,
      iat: now,
      exp: now + SESSION_MAX_AGE_SECONDS,
    }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", input.secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function readSessionToken(
  token: string | undefined,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): { userId: string } | null {
  if (!token) {
    return null;
  }
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (!safeEqual(signature, expected)) {
    return null;
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub?: string;
    exp?: number;
  };
  if (!parsed.sub || !parsed.exp || parsed.exp < now) {
    return null;
  }
  return { userId: parsed.sub };
}

export function signStartState(input: {
  botId: string;
  userId: string;
  secret: string;
}): string {
  const payload = Buffer.from(
    JSON.stringify({ b: input.botId, u: input.userId }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", input.secret)
    .update(payload)
    .digest("base64url")
    .slice(0, 24);
  return `${payload}.${signature}`;
}

export function verifyStartState(
  state: string | undefined,
  secret: string,
): { botId: string; userId: string } | null {
  if (!state) {
    return null;
  }
  const [payload, signature] = state.split(".");
  if (!payload || !signature) {
    return null;
  }
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url")
    .slice(0, 24);
  if (!safeEqual(signature, expected)) {
    return null;
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    b?: string;
    u?: string;
  };
  return parsed.b && parsed.u ? { botId: parsed.b, userId: parsed.u } : null;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeEqualHex(left: string, right: string): boolean {
  return /^[a-f0-9]+$/iu.test(left) && safeEqual(left.toLowerCase(), right);
}

