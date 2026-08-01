/**
 * Pure text helpers shared by the composer and the transcript. They live apart
 * from the component so they can be exercised directly — the mention pass in
 * particular walks a parsed tree and has more edge cases than a UI test would
 * ever reach.
 */

export type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** Mentions inside these keep their literal text. */
export const MENTION_SKIP_TAGS = new Set(["code", "pre", "a"]);

/**
 * A handle must open a word: preceded by nothing, or by something that is not
 * a word character, `@`, `/` or `-`. That rules out `you@example.com`,
 * `github.com/handle` and `re-handle` while still matching after punctuation
 * and CJK text.
 */
export const MENTION_PATTERN = /(^|[^\w@/-])@([A-Za-z0-9_-]{2,31})/g;

/**
 * Turns `@handle` into a chip when the handle answers in this channel, and
 * marks the reader's own. A rehype pass rather than a string replace on the raw
 * Markdown: a handle inside a code span or a URL is not a mention, and only the
 * parsed tree knows the difference.
 */
export function createMentionPlugin(known: Set<string>, self: string) {
  const split = (value: string): HastNode[] | null => {
    const parts: HastNode[] = [];
    let lastIndex = 0;
    for (const match of value.matchAll(MENTION_PATTERN)) {
      const handle = match[2];
      if (!known.has(handle.toLowerCase())) continue;
      const start = (match.index ?? 0) + match[1].length;
      if (start > lastIndex) parts.push({ type: "text", value: value.slice(lastIndex, start) });
      parts.push({
        type: "element",
        tagName: "span",
        properties: {
          className: handle.toLowerCase() === self ? ["mention", "mention-self"] : ["mention"],
        },
        children: [{ type: "text", value: `@${handle}` }],
      });
      lastIndex = start + handle.length + 1;
    }
    if (!parts.length) return null;
    if (lastIndex < value.length) parts.push({ type: "text", value: value.slice(lastIndex) });
    return parts;
  };
  const walk = (node: HastNode): void => {
    if (!node.children?.length) return;
    if (node.tagName && MENTION_SKIP_TAGS.has(node.tagName)) return;
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string") {
        const replaced = split(child.value);
        if (replaced) {
          next.push(...replaced);
          continue;
        }
      } else {
        walk(child);
      }
      next.push(child);
    }
    node.children = next;
  };
  return () => (tree: unknown) => walk(tree as HastNode);
}

/** `2:05` under an hour, `1:04:12` past it. */
export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1_000));
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Index of the first `@handle` in an already-lowercased draft, or -1.
 *
 * The tail guard is `(?![\w-])`, not `\b`: a word boundary sits between `r` and
 * `-`, so `@code-review` used to register as a mention of `@code` as well and
 * would start a run nobody asked for. A following `.` still ends the mention so
 * that `@mira.` at the end of a sentence keeps working.
 */
export function mentionPosition(lowerValue: string, handle: string): number {
  const match = lowerValue.match(
    new RegExp(`(^|\\s)@${escapeRegExp(handle.toLowerCase())}(?![\\w-])`),
  );
  return match?.index === undefined ? -1 : match.index + match[1].length;
}
