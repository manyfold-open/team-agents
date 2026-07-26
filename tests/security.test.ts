import { describe, expect, it } from "vitest";
import {
  PASSWORD_ITERATIONS,
  hashPassword,
  normalizeUsername,
  redactSecret,
  validateAgentRpcUrl,
  verifyPassword,
} from "../worker/security";

describe("authentication primitives", () => {
  it("normalizes usernames case-insensitively", () => {
    expect(normalizeUsername("  Alice.Example ")).toBe("alice.example");
  });

  it("uses the configured PBKDF2 work factor and a unique salt", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first.iterations).toBe(PASSWORD_ITERATIONS);
    expect(first.iterations).toBe(600_000);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    await expect(
      verifyPassword("correct horse battery staple", first.hash, first.salt, first.iterations),
    ).resolves.toBe(true);
    await expect(
      verifyPassword("wrong password", first.hash, first.salt, first.iterations),
    ).resolves.toBe(false);
  });
});

describe("Agent endpoint safety", () => {
  it("allows public HTTPS endpoints", () => {
    expect(validateAgentRpcUrl("https://agents.example.com/a2a/rpc", true))
      .toBe("https://agents.example.com/a2a/rpc");
  });

  it.each([
    "http://agents.example.com/rpc",
    "https://localhost/rpc",
    "https://127.0.0.1/rpc",
    "https://10.1.2.3/rpc",
    "https://192.168.1.2/rpc",
    "https://[::1]/rpc",
    "https://agent.internal/rpc",
    "https://token@example.com/rpc",
  ])("rejects unsafe production URL %s", (url) => {
    expect(() => validateAgentRpcUrl(url, true)).toThrow();
  });

  it("redacts bearer and query-string secrets from errors", () => {
    const redacted = redactSecret(
      "Authorization: Bearer super-secret-token https://x.test/?token=also-secret",
    );
    expect(redacted).not.toContain("super-secret-token");
    expect(redacted).not.toContain("also-secret");
    expect(redacted).toContain("[redacted]");
  });
});
