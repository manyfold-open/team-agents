import { scrypt } from "node:crypto";
import type { AuthUser, Env } from "./types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SESSION_COOKIE = "team_agents_session";
const SESSION_DAYS = 30;
const SCRYPT_PREFIX = "scrypt-v1";
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
export const PASSWORD_SCRYPT_N = 1 << 15;
export const PASSWORD_SCRYPT_R = 8;
export const PASSWORD_SCRYPT_P = 3;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const message = redactSecret(error instanceof Error ? error.message : String(error));
  console.error("Team Agents request failed:", message);
  return json(
    { error: { code: "internal_error", message: "The request could not be completed." } },
    500,
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "json_required", "Expected an application/json request.");
  }
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}

export async function sha256(value: string): Promise<string> {
  return bytesToBase64Url(await sha256Bytes(value));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value))),
  );
}

export function normalizeUsername(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function validateUsername(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_username", "Username is required.");
  }
  const username = value.trim().normalize("NFKC");
  if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(username)) {
    throw new HttpError(
      400,
      "invalid_username",
      "Username must be 3–32 letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return username;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpError(400, "invalid_password", "Password must be 8–128 characters.");
  }
  return value;
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array<ArrayBufferLike>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bufferSource(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function deriveScrypt(
  password: string,
  salt: Uint8Array<ArrayBufferLike>,
  n: number,
  r: number,
  p: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: n, r, p, maxmem: SCRYPT_MAX_MEMORY },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(new Uint8Array(derivedKey));
      },
    );
  });
}

export async function hashPassword(
  password: string,
  salt: Uint8Array<ArrayBufferLike> = crypto.getRandomValues(new Uint8Array(16)),
): Promise<{ hash: string; salt: string; iterations: number }> {
  const derived = await deriveScrypt(
    password,
    salt,
    PASSWORD_SCRYPT_N,
    PASSWORD_SCRYPT_R,
    PASSWORD_SCRYPT_P,
  );
  return {
    hash: [
      SCRYPT_PREFIX,
      PASSWORD_SCRYPT_N,
      PASSWORD_SCRYPT_R,
      PASSWORD_SCRYPT_P,
      bytesToBase64Url(derived),
    ].join("$"),
    salt: bytesToBase64Url(salt),
    iterations: PASSWORD_SCRYPT_N,
  };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
  iterations: number,
): Promise<boolean> {
  let derivedHash: string;
  const scryptMatch = expectedHash.match(/^scrypt-v1\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)$/);
  if (scryptMatch) {
    const [, nText, rText, pText, encodedHash] = scryptMatch;
    const n = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    const cost = n * r * p;
    if (
      !Number.isSafeInteger(n)
      || !Number.isSafeInteger(r)
      || !Number.isSafeInteger(p)
      || n < 2
      || (n & (n - 1)) !== 0
      || r < 1
      || p < 1
      || cost > 1 << 20
    ) {
      return false;
    }
    const derived = await deriveScrypt(password, base64UrlToBytes(salt), n, r, p);
    derivedHash = bytesToBase64Url(derived);
    expectedHash = encodedHash;
  } else {
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100_000) {
      return false;
    }
    const derived = await derivePbkdf2(password, base64UrlToBytes(salt), iterations);
    derivedHash = bytesToBase64Url(derived);
  }
  const [left, right] = await Promise.all([
    sha256Bytes(derivedHash),
    sha256Bytes(expectedHash),
  ]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [candidate, ...rest] = part.trim().split("=");
    if (candidate === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(request: Request, token: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function createSession(
  request: Request,
  env: Env,
  userId: string,
): Promise<string> {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
  ).bind(await sha256(token), userId, now.toISOString(), expiresAt.toISOString()).run();
  return sessionCookie(request, token, SESSION_DAYS * 24 * 60 * 60);
}

export async function deleteSession(request: Request, env: Env): Promise<string> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
  }
  return sessionCookie(request, "", 0);
}

export async function getAuthUser(request: Request, env: Env): Promise<AuthUser | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id,u.username,wm.role
     FROM sessions s
     JOIN users u ON u.id=s.user_id
     JOIN workspace_members wm ON wm.user_id=u.id AND wm.workspace_id='main'
     WHERE s.token_hash=? AND s.expires_at>? AND u.disabled_at IS NULL`,
  ).bind(await sha256(token), new Date().toISOString()).first<{
    id: string;
    username: string;
    role: "owner" | "member";
  }>();
  return row ?? null;
}

export async function requireAuth(request: Request, env: Env): Promise<AuthUser> {
  const user = await getAuthUser(request, env);
  if (!user) throw new HttpError(401, "authentication_required", "Please sign in.");
  return user;
}

export function assertMutationOrigin(request: Request): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new HttpError(403, "origin_required", "Mutation requests must include a same-origin Origin header.");
  }
  const expected = new URL(request.url).origin;
  if (origin !== expected) {
    throw new HttpError(403, "invalid_origin", "Cross-origin mutation requests are not allowed.");
  }
}

export async function enforceRateLimit(
  request: Request,
  env: Env,
  action: "login" | "register",
  subject: string,
): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const secret = env.AUTH_HMAC_KEY
    ?? (env.ENVIRONMENT === "production" ? "" : "team-agents-local-auth-key-only");
  if (!secret) throw new HttpError(503, "auth_not_configured", "Authentication is not configured.");
  const key = await hmac(secret, `${action}:${ip}:${normalizeUsername(subject)}`);
  const now = Date.now();
  const windowMs = action === "login" ? 15 * 60_000 : 60 * 60_000;
  const limit = action === "login" ? 10 : 8;
  const row = await env.DB.prepare(
    "SELECT window_started_at,count,blocked_until FROM auth_rate_limits WHERE key=?",
  ).bind(key).first<{ window_started_at: string; count: number; blocked_until: string | null }>();

  if (row?.blocked_until && Date.parse(row.blocked_until) > now) {
    throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.");
  }
  const windowStarted = row ? Date.parse(row.window_started_at) : 0;
  if (!row || !Number.isFinite(windowStarted) || now - windowStarted >= windowMs) {
    await env.DB.prepare(
      `INSERT INTO auth_rate_limits(key,window_started_at,count,blocked_until)
       VALUES(?,?,1,NULL)
       ON CONFLICT(key) DO UPDATE SET window_started_at=excluded.window_started_at,count=1,blocked_until=NULL`,
    ).bind(key, new Date(now).toISOString()).run();
    return;
  }
  const nextCount = row.count + 1;
  const blockedUntil = nextCount > limit ? new Date(now + windowMs).toISOString() : null;
  await env.DB.prepare(
    "UPDATE auth_rate_limits SET count=?,blocked_until=? WHERE key=?",
  ).bind(nextCount, blockedUntil, key).run();
  if (blockedUntil) {
    throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.");
  }
}

function credentialKey(env: Env): string {
  const value = env.CREDENTIALS_ENCRYPTION_KEY
    ?? (env.ENVIRONMENT === "production" ? "" : "team-agents-local-development-key-only");
  if (!value || (env.ENVIRONMENT === "production" && value.length < 32)) {
    throw new HttpError(503, "credential_key_missing", "Agent credential encryption is not configured.");
  }
  return value;
}

async function aesKey(env: Env): Promise<CryptoKey> {
  const raw = await sha256Bytes(credentialKey(env));
  return crypto.subtle.importKey("raw", bufferSource(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(
  env: Env,
  value: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    await aesKey(env),
    textEncoder.encode(value),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv),
  };
}

export async function decryptCredential(env: Env, ciphertext: string, iv: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(base64UrlToBytes(iv)) },
    await aesKey(env),
    bufferSource(base64UrlToBytes(ciphertext)),
  );
  return textDecoder.decode(decrypted);
}

export function validateAgentRpcUrl(raw: unknown, production: boolean): string {
  if (typeof raw !== "string") {
    throw new HttpError(400, "invalid_agent_url", "A2A RPC URL is required.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_agent_url", "A2A RPC URL is invalid.");
  }
  if (url.username || url.password || url.hash) {
    throw new HttpError(400, "invalid_agent_url", "Credentials and fragments are not allowed in the URL.");
  }
  const hostname = url.hostname.toLowerCase();
  const localHost = hostname === "localhost" || hostname.endsWith(".localhost");
  const ipV4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const first = Number(ipV4?.[1]);
  const second = Number(ipV4?.[2]);
  const privateIp = Boolean(ipV4) && (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224
  );
  const privateV6 = hostname === "[::1]"
    || hostname.startsWith("[fc")
    || hostname.startsWith("[fd")
    || hostname.startsWith("[fe8")
    || hostname.startsWith("[fe9")
    || hostname.startsWith("[fea")
    || hostname.startsWith("[feb");
  if (production && (
    url.protocol !== "https:"
    || localHost
    || privateIp
    || privateV6
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
  )) {
    throw new HttpError(400, "unsafe_agent_url", "Production Agent URLs must use public HTTPS hosts.");
  }
  if (!production && !["https:", "http:"].includes(url.protocol)) {
    throw new HttpError(400, "invalid_agent_url", "A2A RPC URL must use HTTP or HTTPS.");
  }
  return url.toString();
}

export function redactSecret(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-token]")
    .replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 1_500);
}
