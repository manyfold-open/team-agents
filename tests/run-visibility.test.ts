import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADDED_COLUMNS, SCHEMA_STATEMENTS } from "../worker/schema-sql";

const appSource = readFileSync(new URL("../app/team-agents.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../worker/api.ts", import.meta.url), "utf8");
const a2aSource = readFileSync(new URL("../worker/a2a.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../worker/schema-sql.ts", import.meta.url), "utf8");

describe("run state reaches an already-deployed database", () => {
  it("creates the run columns for a fresh database", () => {
    const agentRuns = SCHEMA_STATEMENTS.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS agent_runs"));
    expect(agentRuns).toBeDefined();
    for (const column of ["progress_text", "relay_group_id", "relay_index", "relay_total"]) {
      expect(agentRuns).toContain(column);
    }
  });

  it("also backfills them onto a database that already has the table", () => {
    // `CREATE TABLE IF NOT EXISTS` is a no-op on an existing database, so
    // without this list a new column would never reach production.
    expect(ADDED_COLUMNS.map((entry) => entry.column)).toEqual([
      "progress_text",
      "relay_group_id",
      "relay_index",
      "relay_total",
    ]);
    expect(ADDED_COLUMNS.every((entry) => entry.table === "agent_runs")).toBe(true);
  });

  it("indexes the relay columns only after they exist", () => {
    // A CREATE INDEX over a missing column is a hard error, so the relay index
    // must not sit in the batch that runs before the backfill.
    const relayIndex = SCHEMA_STATEMENTS.find((sql) => sql.includes("agent_runs_relay_idx"));
    expect(relayIndex).toBeUndefined();
    expect(schemaSource).toMatch(/POST_COLUMN_STATEMENTS[\s\S]*?agent_runs_relay_idx/);
    expect(schemaSource).toMatch(/await addMissingColumns\(db\);\s*await db\.batch\(POST_COLUMN_STATEMENTS/);
  });
});

describe("the wait for an agent is legible", () => {
  it("separates queued from running instead of one word for both", () => {
    expect(appSource).toContain('message.status === "queued" ? t.runQueued : t.runRunning');
  });

  it("puts a live clock on a run in flight", () => {
    expect(appSource).toContain("function useElapsed");
    expect(appSource).toContain('className="run-clock"');
    // Tabular figures: a ticking second must not reflow the status row.
    expect(styles).toMatch(/\.run-clock\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
  });

  it("shows the agent's own progress narration", () => {
    expect(appSource).toContain("run?.progressText");
    expect(a2aSource).toContain("progress_text=?");
  });

  it("clears progress narration once the run is over", () => {
    for (const pattern of [
      /status=\?,remote_task_id=COALESCE[\s\S]*?progress_text=NULL/,
      /status='failed',last_error=\?,progress_text=NULL/,
      /status='canceled',progress_text=NULL/,
    ]) {
      expect(a2aSource).toMatch(pattern);
    }
  });

  it("keeps the placeholder body out of a run that has not started", () => {
    expect(appSource).toContain("const showBody = !(running && message.status === \"queued\"");
  });
});

describe("finished runs find the reader", () => {
  it("reports the reader's own runs across every channel", () => {
    expect(apiSource).toContain("async function listUserRuns");
    // Private channels the reader has since left must not leak their name.
    expect(apiSource).toMatch(/c\.is_private=0 OR EXISTS\([\s\S]*?channel_members cm/);
  });

  it("announces a terminal run exactly once", () => {
    expect(appSource).toContain("announcedRuns");
    expect(appSource).toContain("runsPrimed");
    expect(appSource).toMatch(/if \(seen\.has\(key\)\) continue;/);
  });

  it("treats the first load as history rather than news", () => {
    expect(appSource).toMatch(/runsPrimed\.current = true;[\s\S]*?seen\.add\(`\$\{run\.id\}:\$\{run\.status\}`\)/);
  });

  it("polls faster while one of the reader's runs is in flight", () => {
    expect(appSource).toContain("activeRuns.length ? 5_000 : 20_000");
  });

  it("only raises a desktop notification for a tab nobody is watching", () => {
    expect(appSource).toMatch(/desktopNotificationsOn\(\) \|\| document\.visibilityState === "visible"/);
  });
});

describe("mentions carry a signal", () => {
  it("counts unread messages that name the reader", () => {
    expect(apiSource).toContain("mm.kind='user' AND mm.target_id=?");
    expect(apiSource).toContain("AS mention_count");
  });

  it("shows a mention badge instead of a plain unread count", () => {
    expect(appSource).toContain('className="mention-count"');
    expect(appSource).toContain("{unread > 0 && !mentions && (");
  });

  it("highlights a mention through the parsed tree, not the raw Markdown", () => {
    // Behaviour is covered in mentions.test.ts; this only pins the wiring.
    expect(appSource).toContain("rehypePlugins={[mentionPlugin]}");
    expect(appSource).toContain("createMentionPlugin(");
  });
});

describe("an agent can be brought in from the composer", () => {
  it("offers the reader's other agents in the mention menu", () => {
    expect(appSource).toContain('kind: "add-agent" as const');
    expect(appSource).toContain("ownAgentsOutsideChannel");
  });

  it("inserts the handle before waiting on the join request", () => {
    expect(appSource).toMatch(/setValue\(\(current\) => current\.replace\([\s\S]*?if \(option\.kind !== "add-agent"/);
  });
});

describe("several agents on one message", () => {
  it("sends them in the order they were written", () => {
    expect(appSource).toContain("mentionPosition(lower, agent.handle)");
    expect(appSource).toMatch(/\.sort\(\(left, right\) => left\.at - right\.at\)/);
    expect(apiSource).toContain("return agentIds.filter((id) => valid.has(id));");
  });

  it("starts only the first leg of a relay", () => {
    expect(apiSource).toContain("for (const run of relay ? runs.slice(0, 1) : runs)");
  });

  it("does not turn a single agent into a one-leg relay", () => {
    expect(apiSource).toContain('body.agentMode === "relay" && validAgentIds.length > 1');
  });

  it("hands a relay leg the answers that came before it", () => {
    expect(a2aSource).toContain("async function relayHandoff");
    expect(a2aSource).toContain("WHERE r.relay_group_id=? AND r.relay_index<?");
  });

  it("hands off after a failure but stops after a cancel", () => {
    expect(a2aSource).toContain('runStatus === "completed" || runStatus === "failed" ? "handoff" : "stop"');
    expect(a2aSource).toMatch(/cancelRemoteRun[\s\S]*?advanceRelay\(env, run, "stop"\)/);
  });

  it("fails the whole chain when the relay head never reaches the queue", () => {
    expect(apiSource).toContain("await failUnstartedRuns(env, relay ? runs : [run]);");
  });
});
