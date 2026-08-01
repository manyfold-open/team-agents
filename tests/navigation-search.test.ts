import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEARCH_MIN_INDEXED_LENGTH, searchExcerpt } from "../worker/data";
import { SEARCH_STATEMENTS } from "../worker/schema-sql";

const appSource = readFileSync(new URL("../app/team-agents.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../worker/api.ts", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../worker/data.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../worker/schema-sql.ts", import.meta.url), "utf8");

describe("a jump lands on the message, not the channel", () => {
  it("anchors the window on the target instead of skipping past it", () => {
    // `before` is exclusive, so the half that is supposed to contain the target
    // has to ask for one id higher or the target itself falls out of the page.
    expect(dataSource).toContain("before: messageId + 1");
    expect(dataSource).toContain("after: messageId");
  });

  it("pages both ways out of where the reader landed", () => {
    expect(apiSource).toContain('url.searchParams.get("around")');
    expect(apiSource).toContain('url.searchParams.get("after")');
    expect(appSource).toContain("const loadNewer = useCallback");
    expect(appSource).toContain("if (hasNewer && distanceToEnd < 320) void loadNewer();");
  });

  it("reaches a reply through its thread root", () => {
    // The main transcript renders no replies, so landing on the reply's own id
    // would load a window with nothing in it to show.
    expect(appSource).toContain("focus.threadRootId ?? focus.messageId");
    expect(appSource).toContain("pendingThreadFocus.current = focus?.threadRootId ? focus : null");
  });

  it("does not mark the unseen tail read when it lands mid-history", () => {
    expect(appSource).toContain("if (latest && !messageData.hasNewer) await markRead(channelId, latest);");
  });

  it("keeps live messages out of the gap while parked mid-history", () => {
    // Appending the newest message under a window that stops at id 40 would
    // render 40 and 900 as neighbours.
    expect(appSource).toContain("if (!known && hasNewerRef.current) return current;");
  });

  it("treats reaching the end of a partial window as not being at the tail", () => {
    expect(appSource).toContain("const atBottom = distanceToEnd < BOTTOM_THRESHOLD && !hasNewer;");
    // "Jump to latest" has to reload, because the latest is not in the DOM.
    expect(appSource).toMatch(/if \(hasNewer\) \{\s*void loadChannel\(selectedChannelId\);/);
  });

  it("applies a landing once rather than on every re-render", () => {
    expect(appSource).toContain("scrolledMain.current !== highlight.nonce");
    expect(appSource).toContain("scrolledThread.current !== highlight.nonce");
    expect(appSource).toContain("focusNonce > appliedFocus.current");
  });

  it("moves the transcript behind an opened thread onto the root", () => {
    // Otherwise the channel is left showing whatever sat at the top of the
    // window that was loaded to reach the reply.
    expect(appSource).toContain("data-message-id=\"${highlight.anchorId}\"");
    expect(appSource).toContain("highlight.anchorId !== highlight.id");
  });

  it("flashes the message it landed on", () => {
    expect(appSource).toContain('highlighted ? "is-landed" : ""');
    expect(appSource).toContain("data-message-id={message.id}");
    expect(styles).toContain("@keyframes message-landed");
    // The flash is the whole signal, so it must survive reduced motion.
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.message-card\.is-landed[\s\S]*?animation: none;/,
    );
  });
});

describe("the unread divider marks where the reader left off", () => {
  it("anchors on the cursor as it stood when the channel opened", () => {
    expect(apiSource).toContain("const lastReadId = Number(cursor?.last_message_id ?? 0);");
    expect(appSource).toContain("setUnreadFrom(Number(messageData.lastReadId ?? 0));");
  });

  it("says nothing on a first visit, when there is no place left off from", () => {
    expect(appSource).toMatch(/const firstUnreadId = unreadFrom\s*\?/);
  });

  it("skips the reader's own messages, as the unread count does", () => {
    expect(appSource).toContain("message.id > unreadFrom && message.sender.id !== boot.user!.id");
  });
});

describe("search index", () => {
  it("indexes with trigram, so a CJK sentence is not one token", () => {
    const table = SEARCH_STATEMENTS.find((sql) => sql.includes("CREATE VIRTUAL TABLE"));
    expect(table).toContain("tokenize='trigram'");
    // Standalone, not external content: an external-content delete must quote
    // the exact indexed text, which a row rewritten mid-stream cannot supply.
    expect(table).not.toContain("content='messages'");
  });

  it("keeps half-written agent output out of the index", () => {
    const triggers = SEARCH_STATEMENTS.filter((sql) => sql.includes("CREATE TRIGGER"));
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers.filter((sql) => sql.includes("INSERT INTO messages_fts"))) {
      expect(trigger).toContain("WHERE new.status NOT IN ('queued','streaming')");
    }
  });

  it("re-indexes on update, so a finished run becomes findable", () => {
    const update = SEARCH_STATEMENTS.find((sql) => sql.includes("messages_fts_update"));
    expect(update).toContain("DELETE FROM messages_fts WHERE rowid=old.id");
    expect(update).toContain("INSERT INTO messages_fts");
  });

  it("backfills only on the deployment that creates the table", () => {
    expect(schemaSource).toMatch(/sqlite_master WHERE type='table' AND name='messages_fts'/);
    expect(schemaSource).toMatch(/if \(!existing\) await db\.prepare\(SEARCH_BACKFILL\)\.run\(\)/);
    // Idempotent regardless, so a racing isolate cannot double-index a row.
    expect(schemaSource).toContain("NOT EXISTS(SELECT 1 FROM messages_fts f WHERE f.rowid=m.id)");
  });

  it("degrades to a scan rather than taking the deployment down", () => {
    expect(schemaSource).toMatch(/try \{\s*await ensureSearchIndex\(db\);\s*\} catch/);
    expect(schemaSource).toContain("searchIndexReady = false;");
    expect(apiSource).toContain("indexed: isSearchIndexReady()");
  });
});

describe("search results", () => {
  it("only reaches channels this reader could open", () => {
    // Looser than the sidebar on purpose: a public channel you have not joined
    // shows its name but returns no messages, and search must not go around it.
    expect(dataSource).toMatch(
      /EXISTS\(SELECT 1 FROM channel_members cm\s*WHERE cm\.channel_id=m\.channel_id AND cm\.user_id=\?\) OR \?='owner'/,
    );
  });

  it("hides messages that have not settled yet", () => {
    expect(dataSource).toContain("m.status NOT IN ('queued','streaming')");
  });

  it("passes the query as a literal phrase, not as FTS5 syntax", () => {
    expect(dataSource).toContain('`"${query.replace(/"/g, \'""\')}"`');
  });

  it("falls back to a scan below the trigram floor", () => {
    expect(SEARCH_MIN_INDEXED_LENGTH).toBe(3);
    expect(dataSource).toContain("query.length >= SEARCH_MIN_INDEXED_LENGTH");
    expect(dataSource).toContain("instr(lower(m.content),lower(?))>0");
  });

  it("renders only the response to the query still in the box", () => {
    expect(appSource).toContain("if (seq !== requestSeq.current) return;");
  });

  it("opens search from the keyboard", () => {
    expect(appSource).toContain(
      'if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;',
    );
    // Preventing the default matters: ⌘K is the browser's own address-bar
    // shortcut in Chrome, and search would open behind a focused omnibox.
    expect(appSource).toMatch(
      /event\.key\.toLowerCase\(\) !== "k"\) return;\s*event\.preventDefault\(\);/,
    );
  });
});

describe("search excerpt", () => {
  it("windows around a match buried deep in a long answer", () => {
    const content = `${"a".repeat(4_000)} needle ${"b".repeat(4_000)}`;
    const excerpt = searchExcerpt(content, "needle");
    expect(excerpt).toContain("needle");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThan(200);
  });

  it("does not lead with an ellipsis when the match is at the start", () => {
    expect(searchExcerpt("needle in the haystack", "needle")).toBe("needle in the haystack");
  });

  it("matches case-insensitively, as the index does", () => {
    expect(searchExcerpt("The Customer Feedback", "customer feedback"))
      .toBe("The Customer Feedback");
  });

  it("collapses the newlines of a Markdown answer into one readable line", () => {
    expect(searchExcerpt("## Heading\n\nSome   body\ttext", "body")).toBe("## Heading Some body text");
  });

  it("still returns a preview when the hit is not a literal substring", () => {
    // Trigram can match across normalisation the excerpt search will not find;
    // an empty result row would be worse than the head of the message.
    const excerpt = searchExcerpt("something else entirely", "needle");
    expect(excerpt).toBe("something else entirely");
  });
});

describe("a teammate naming you is announced too", () => {
  it("reports the newest unread mention and who wrote it", () => {
    expect(apiSource).toContain("AS latest_mention_id");
    expect(apiSource).toContain("AS latest_mention_from");
  });

  it("binds the channel query exactly as many times as it asks", () => {
    // Nothing else catches this: a miscount type-checks, lints, builds and
    // passes a Worker dry-run, then fails on the first authenticated request.
    // Adding a `?` without widening the fill has to break here instead.
    const sql = apiSource.slice(
      apiSource.indexOf("`SELECT c.id", apiSource.indexOf("async function listChannels")),
    );
    const query = sql.slice(0, sql.indexOf("`,"));
    const placeholders = (query.match(/\?/g) ?? []).length;
    const fill = Number(/Array<string>\((\d+)\)\.fill\(user\.id\), user\.role/.exec(apiSource)?.[1]);
    expect(fill).toBeGreaterThan(0);
    expect(fill + 1).toBe(placeholders);
  });

  it("treats mentions already waiting at sign-in as a backlog", () => {
    expect(appSource).toContain("mentionsPrimed");
    expect(appSource).toMatch(
      /mentionsPrimed\.current = true;[\s\S]*?seen\.set\(channel\.id, channel\.latestMentionId \?\? 0\)/,
    );
  });

  it("announces only a mention newer than the last one announced", () => {
    expect(appSource).toContain("if (latest <= previous) continue;");
  });

  it("stays quiet about the channel the reader is looking at", () => {
    expect(appSource).toMatch(
      /channel\.id === selectedChannelId && document\.visibilityState === "visible"/,
    );
  });

  it("lands on the mention rather than the channel it is in", () => {
    expect(appSource).toContain("focus: { channelId: channel.id, messageId: latest, threadRootId: null }");
    expect(appSource).toContain("onOpen={jumpToMessage}");
  });

  it("starts the next account with a clean slate", () => {
    expect(appSource).toMatch(/mentionSnapshot\.current\.clear\(\);\s*mentionsPrimed\.current = false;/);
  });
});
