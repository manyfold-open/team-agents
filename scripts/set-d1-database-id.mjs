import { readFile, writeFile } from "node:fs/promises";

const [configPath, databaseId] = process.argv.slice(2);
const placeholder = "00000000-0000-4000-8000-000000000000";

if (!configPath || !databaseId) {
  throw new Error("Usage: node scripts/set-d1-database-id.mjs <wrangler.toml> <database-id>");
}
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId)) {
  throw new Error("The D1 database ID is not a valid UUID.");
}

const source = await readFile(configPath, "utf8");
if (!source.includes(placeholder) && !source.includes(`database_id = "${databaseId}"`)) {
  throw new Error("The Wrangler config does not contain the expected D1 placeholder.");
}

const updated = source.replaceAll(placeholder, databaseId);
await writeFile(configPath, updated);
