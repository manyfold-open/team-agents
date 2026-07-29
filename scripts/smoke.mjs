import assert from "node:assert/strict";

const baseUrl = process.argv[2]?.replace(/\/+$/, "");
if (!baseUrl || !baseUrl.startsWith("https://")) {
  throw new Error("Usage: npm run smoke -- https://your-worker.workers.dev");
}

async function eventually(label, check, attempts = 12) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 5_000));
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

await eventually("Authentication error contract", async () => {
  for (const action of ["register", "login"]) {
    const response = await fetch(`${baseUrl}/api/auth/${action}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: new URL(baseUrl).origin,
      },
      body: JSON.stringify({
        username: "x",
        password: "diagnostic-only-password",
      }),
    });
    assert.equal(response.status, 400, `${action} returned ${response.status}`);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
    const body = await response.json();
    assert.equal(body.error?.code, "invalid_username");
  }
});

/**
 * The shell is re-fetched on every attempt so it is checked against the assets
 * of the same build. Reading it once lets a shell captured mid-propagation
 * pin asset hashes the new deployment has already replaced, and the retry
 * loop then re-requests those dead paths until it gives up.
 */
await eventually("Application shell and browser client assets", async () => {
  const response = await fetch(baseUrl, {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const shellHtml = await response.text();
  assert.match(shellHtml, /Team Agents/i);

  const clientAssetPaths = [
    ...new Set(
      [...shellHtml.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)]
        .map((match) => match[1])
        .filter((path) => /^\/assets\/.+\.(?:css|js)$/i.test(path)),
    ),
  ];

  assert.ok(
    clientAssetPaths.some((path) => path.endsWith(".js")),
    "Application shell must reference at least one JavaScript asset",
  );
  assert.ok(
    clientAssetPaths.some((path) => path.endsWith(".css")),
    "Application shell must reference at least one CSS asset",
  );

  await Promise.all(
    clientAssetPaths.map(async (path) => {
      const asset = await fetch(new URL(path, baseUrl));
      assert.equal(asset.status, 200, `${path} returned ${asset.status}`);

      const contentType = asset.headers.get("content-type") ?? "";
      if (path.endsWith(".js")) {
        assert.match(contentType, /javascript/i, `${path} has content-type ${contentType}`);
      } else {
        assert.match(contentType, /^text\/css\b/i, `${path} has content-type ${contentType}`);
      }

      assert.ok(
        Number(asset.headers.get("content-length") ?? 0) > 0
          || (await asset.arrayBuffer()).byteLength > 0,
        `${path} is empty`,
      );
    }),
  );
}, 24);

console.log(`Team Agents smoke test passed: ${baseUrl}`);
