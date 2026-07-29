import { describe, expect, it } from "vitest";
import { handleApiRequest } from "../worker/api";
import type { Env } from "../worker/types";

type MockStatement = {
  bind: (...values: unknown[]) => MockStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ success: true }>;
};

function createMockEnv(): Env {
  const db = {
    prepare: () => {
      const statement: MockStatement = {
        bind: () => statement,
        first: async <T>() => null as T | null,
        run: async () => ({ success: true }),
      };
      return statement;
    },
    batch: async () => [],
  } as unknown as D1Database;

  return {
    DB: db,
    ASSETS: {} as Fetcher,
    CHANNEL_ROOMS: {} as Env["CHANNEL_ROOMS"],
    AGENT_TASKS: {} as Env["AGENT_TASKS"],
    ENVIRONMENT: "test",
    AUTH_HMAC_KEY: "test-auth-hmac-key-with-at-least-32-characters",
    CREDENTIALS_ENCRYPTION_KEY: "test-credential-key-with-at-least-32-characters",
  };
}

function authRequest(action: "register" | "login", username: string): Request {
  return new Request(`https://team-agents.test/api/auth/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://team-agents.test",
    },
    body: JSON.stringify({
      username,
      password: "diagnostic-only-password",
    }),
  });
}

describe("API error boundary", () => {
  it.each(["register", "login"] as const)(
    "returns a structured validation error for %s",
    async (action) => {
      const response = await handleApiRequest(authRequest(action, "x"), createMockEnv());

      expect(response?.status).toBe(400);
      await expect(response?.json()).resolves.toEqual({
        error: {
          code: "invalid_username",
          message: "Username must be 3–32 letters, numbers, dots, underscores, or hyphens.",
        },
      });
    },
  );

  it("returns a structured invalid-credentials response", async () => {
    const response = await handleApiRequest(
      authRequest("login", "missing-user"),
      createMockEnv(),
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "invalid_credentials",
        message: "Username or password is incorrect.",
      },
    });
  });

  it("requires a session for Agent Card discovery", async () => {
    const response = await handleApiRequest(
      new Request("https://team-agents.test/api/agents/discover", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://team-agents.test",
        },
        body: JSON.stringify({ cardUrl: "https://agents.example.com/a2a/agents/x" }),
      }),
      createMockEnv(),
    );

    // Route is wired (not a 404) and rejects before any outbound card fetch.
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Please sign in.",
      },
    });
  });

  it("captures asynchronous authorization failures outside auth routes", async () => {
    const response = await handleApiRequest(
      new Request("https://team-agents.test/api/channels", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://team-agents.test",
        },
        body: JSON.stringify({ name: "test" }),
      }),
      createMockEnv(),
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Please sign in.",
      },
    });
  });
});
