import assert from "node:assert/strict";

const baseUrl = process.argv[2]?.replace(/\/+$/, "");
if (!baseUrl || !baseUrl.startsWith("https://")) {
  throw new Error("Usage: npm run smoke -- https://your-worker.workers.dev");
}

async function eventually(label, check) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw new Error(`${label} failed after deployment propagation: ${lastError}`);
}

await eventually("Health check", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { accept: "application/json" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "team-agents");
});

await eventually("Anonymous bootstrap", async () => {
  const response = await fetch(`${baseUrl}/api/bootstrap`, {
    headers: { accept: "application/json" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authenticated, false);
});

await eventually("Application shell", async () => {
  const response = await fetch(baseUrl, {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(await response.text(), /Team Agents/i);
});

console.log(`Team Agents smoke test passed: ${baseUrl}`);
