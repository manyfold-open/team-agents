import { describe, expect, it } from "vitest";
import { parseA2AEventForTest, parseA2AEventsForTest } from "../worker/a2a";

describe("A2A v0.3 event parsing", () => {
  it("extracts a direct Message response", () => {
    const result = parseA2AEventForTest({}, {
      kind: "message",
      role: "agent",
      messageId: "message-1",
      contextId: "context-1",
      parts: [{ kind: "text", text: "Ready to help." }],
    });

    expect(result.text).toBe("Ready to help.");
    expect(result.contextId).toBe("context-1");
    expect(result.terminal).toBe(false);
  });

  it("merges artifact chunks using artifact id and append semantics", () => {
    const result = parseA2AEventsForTest([
      {
        kind: "artifact-update",
        taskId: "task-1",
        contextId: "context-1",
        artifact: { artifactId: "answer", parts: [{ kind: "text", text: "First" }] },
      },
      {
        kind: "artifact-update",
        taskId: "task-1",
        append: true,
        artifact: { artifactId: "answer", parts: [{ kind: "text", text: " second" }] },
      },
      {
        kind: "status-update",
        taskId: "task-1",
        final: true,
        status: { state: "completed" },
      },
    ]);

    expect(result).toMatchObject({
      taskId: "task-1",
      contextId: "context-1",
      text: "First second",
      state: "completed",
      terminal: true,
    });
  });

  it("keeps status narration as progress once an artifact exists", () => {
    const result = parseA2AEventsForTest([
      {
        kind: "status-update",
        taskId: "task-2",
        status: {
          state: "working",
          message: { kind: "message", role: "agent", parts: [{ kind: "text", text: "Reading the docs…" }] },
        },
      },
      {
        kind: "artifact-update",
        taskId: "task-2",
        artifact: { artifactId: "answer", parts: [{ kind: "text", text: "Here is the summary." }] },
      },
    ]);

    // The narration used to be dropped the moment output arrived, which left a
    // long run with no progress signal at all.
    expect(result.text).toBe("Here is the summary.");
    expect(result.progressText).toBe("Reading the docs…");
  });

  it("does not repeat the narration as progress when it is the whole answer", () => {
    const result = parseA2AEventForTest({}, {
      kind: "status-update",
      taskId: "task-3",
      status: {
        state: "working",
        message: { kind: "message", role: "agent", parts: [{ kind: "text", text: "Still thinking." }] },
      },
    });

    expect(result.text).toBe("Still thinking.");
    expect(result.progressText).toBe("");
  });

  it("preserves input-required state and the Agent question", () => {
    const result = parseA2AEventForTest({}, {
      kind: "status-update",
      taskId: "task-input",
      contextId: "context-input",
      final: true,
      status: {
        state: "input-required",
        message: {
          kind: "message",
          role: "agent",
          parts: [{ kind: "text", text: "Which market should I compare?" }],
        },
      },
    });

    expect(result.text).toBe("Which market should I compare?");
    expect(result.state).toBe("input-required");
    expect(result.terminal).toBe(true);
  });
});
