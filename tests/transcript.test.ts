import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MESSAGE_PAGE_SIZE, splitMessagePage } from "../worker/data";

const appSource = readFileSync(new URL("../app/team-agents.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const page = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => ({ id: from + index }));

describe("message page boundary", () => {
  it("reports no older page when the query came back short", () => {
    expect(splitMessagePage(page(10), 50)).toEqual({ messages: page(10), hasMore: false });
  });

  it("reports no older page on an exactly full page", () => {
    const rows = page(50);
    expect(splitMessagePage(rows, 50)).toEqual({ messages: rows, hasMore: false });
  });

  it("trims the over-fetched oldest row and flags an older page", () => {
    const result = splitMessagePage(page(51), 50);
    expect(result.hasMore).toBe(true);
    expect(result.messages).toHaveLength(50);
    // Rows are oldest-first, so the surplus row is the oldest one.
    expect(result.messages[0]).toEqual({ id: 2 });
    expect(result.messages.at(-1)).toEqual({ id: 51 });
  });

  it("keeps the newest rows if the caller over-fetches by more than one", () => {
    const result = splitMessagePage(page(55), 50);
    expect(result.messages[0]).toEqual({ id: 6 });
    expect(result.messages.at(-1)).toEqual({ id: 55 });
  });

  it("defaults to the shared page size", () => {
    expect(MESSAGE_PAGE_SIZE).toBe(50);
    expect(splitMessagePage(page(MESSAGE_PAGE_SIZE + 1)).hasMore).toBe(true);
  });
});

describe("transcript reading behaviour", () => {
  it("follows new output only while the reader sits at the bottom", () => {
    expect(appSource).toContain("stickToBottom.current = atBottom");
    expect(appSource).toMatch(/if \(stickToBottom\.current\) \{\s*pinToBottom\(node\);/);
  });

  it("restores the anchor instead of following when an older page is prepended", () => {
    expect(appSource).toMatch(/restoreAnchor\.current = \{ top: node\.scrollTop, height: node\.scrollHeight \}/);
    // Assignment, not `+=`: CSS scroll anchoring already applies this delta, so
    // incrementing would double-count it and fling the reader to the bottom.
    expect(appSource).toMatch(/node\.scrollTop = anchor\.top \+ \(node\.scrollHeight - anchor\.height\)/);
    expect(appSource).not.toMatch(/node\.scrollTop \+= /);
  });

  it("only counts a message as read when it could have been seen", () => {
    expect(appSource).toContain('document.visibilityState !== "visible" || !stickToBottom.current');
  });

  it("floats the jump-to-latest pill over the scrollport", () => {
    expect(appSource).toContain('className="jump-latest"');
    expect(styles).toMatch(/\.transcript\s*\{[\s\S]*?position:\s*relative;/);
    expect(styles).toMatch(/\.jump-latest\s*\{[\s\S]*?position:\s*absolute;/);
  });

  it("keeps the placeholder controls out of the chrome", () => {
    // These three rendered as inert affordances: an overflow menu, an
    // attachment button and an emoji button with nothing behind them.
    expect(appSource).not.toContain("MoreHorizontal");
    expect(appSource).not.toContain("CirclePlus");
    expect(appSource).not.toContain("SmilePlus");
  });

  it("tells the reader when a typed handle will not reach anyone", () => {
    expect(appSource).toContain('className="composer-hint"');
    expect(appSource).toContain("unknownMention");
  });

  it("offers a way out of an input-required run", () => {
    expect(appSource).toContain("inputRequiredHint");
    expect(appSource).toMatch(/onMention\(message\.sender\.handle!\)/);
  });
});
