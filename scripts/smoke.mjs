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

const shellHtml = await eventually("Application shell", async () => {
  const response = await fetch(baseUrl, {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const html = await response.text();
  assert.match(html, /Team Agents/i);
  return html;
});

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

await eventually("Browser client assets", async () => {
  await Promise.all(
    clientAssetPaths.map(async (path) => {
      const response = await fetch(new URL(path, baseUrl));
      assert.equal(response.status, 200, `${path} returned ${response.status}`);

      const contentType = response.headers.get("content-type") ?? "";
      if (path.endsWith(".js")) {
        assert.match(contentType, /javascript/i, `${path} has content-type ${contentType}`);
      } else {
        assert.match(contentType, /^text\/css\b/i, `${path} has content-type ${contentType}`);
      }

      assert.ok(
        Number(response.headers.get("content-length") ?? 0) > 0
          || (await response.arrayBuffer()).byteLength > 0,
        `${path} is empty`,
      );
    }),
  );
});

console.log(`Team Agents smoke test passed: ${baseUrl}`);
