import { describe, expect, it } from "vitest";
import {
  createMentionPlugin,
  formatElapsed,
  mentionPosition,
  type HastNode,
} from "../app/mentions";

const KNOWN = new Set(["researcher", "mira", "code-review"]);

/** Minimal hast fragment: one paragraph holding the given text. */
function paragraph(text: string): HastNode {
  return {
    type: "root",
    children: [{ type: "element", tagName: "p", children: [{ type: "text", value: text }] }],
  };
}

function run(tree: HastNode, self = "mira"): HastNode {
  createMentionPlugin(KNOWN, self)()(tree);
  return tree;
}

function chips(tree: HastNode): Array<{ text: string; className: unknown }> {
  const found: Array<{ text: string; className: unknown }> = [];
  const walk = (node: HastNode) => {
    if (node.tagName === "span" && node.properties?.className) {
      found.push({
        text: node.children?.[0]?.value ?? "",
        className: node.properties.className,
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return found;
}

function text(tree: HastNode): string {
  let out = "";
  const walk = (node: HastNode) => {
    if (node.type === "text") out += node.value ?? "";
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

describe("mention decoration", () => {
  it("wraps a known handle and leaves the text intact", () => {
    const tree = run(paragraph("@researcher please summarise this."));

    expect(chips(tree)).toEqual([{ text: "@researcher", className: ["mention"] }]);
    expect(text(tree)).toBe("@researcher please summarise this.");
  });

  it("marks the reader's own handle differently", () => {
    const tree = run(paragraph("thanks @mira and @researcher"));

    expect(chips(tree)).toEqual([
      { text: "@mira", className: ["mention", "mention-self"] },
      { text: "@researcher", className: ["mention"] },
    ]);
  });

  it("leaves handles nobody in the channel answers to alone", () => {
    const tree = run(paragraph("@nobody are you there"));

    expect(chips(tree)).toEqual([]);
    expect(text(tree)).toBe("@nobody are you there");
  });

  it("does not touch an email address or a URL path", () => {
    const tree = run(paragraph("mail mira@researcher.com or see example.com/@mira"));

    expect(chips(tree)).toEqual([]);
  });

  it("skips code spans, preformatted blocks and links", () => {
    const tree: HastNode = {
      type: "root",
      children: [
        { type: "element", tagName: "code", children: [{ type: "text", value: "@researcher" }] },
        { type: "element", tagName: "pre", children: [{ type: "text", value: "@mira" }] },
        { type: "element", tagName: "a", children: [{ type: "text", value: "@mira" }] },
      ],
    };

    run(tree);

    expect(chips(tree)).toEqual([]);
  });

  it("decorates mentions nested inside emphasis", () => {
    const tree: HastNode = {
      type: "root",
      children: [{
        type: "element",
        tagName: "p",
        children: [{
          type: "element",
          tagName: "strong",
          children: [{ type: "text", value: "ping @researcher" }],
        }],
      }],
    };

    run(tree);

    expect(chips(tree)).toEqual([{ text: "@researcher", className: ["mention"] }]);
  });

  it("handles several mentions in one run of text", () => {
    const tree = run(paragraph("@mira @researcher @code-review — over to you"));

    expect(chips(tree).map((chip) => chip.text)).toEqual(["@mira", "@researcher", "@code-review"]);
    expect(text(tree)).toBe("@mira @researcher @code-review — over to you");
  });

  it("matches a handle written straight after CJK text", () => {
    const tree = run(paragraph("请 @researcher 看一下"));

    expect(chips(tree).map((chip) => chip.text)).toEqual(["@researcher"]);
    expect(text(tree)).toBe("请 @researcher 看一下");
  });

  it("is a no-op on a tree with no mentions", () => {
    const tree = paragraph("nothing to see here");
    const before = JSON.stringify(tree);

    run(tree);

    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe("elapsed formatting", () => {
  it("floors below zero rather than showing a negative clock", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });

  it("pads seconds and drops the hour until it is needed", () => {
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(125_000)).toBe("2:05");
    expect(formatElapsed(3_852_000)).toBe("1:04:12");
  });
});

describe("mention ordering", () => {
  it("reports where each handle first appears so a relay keeps its order", () => {
    const draft = "@researcher then @mira".toLowerCase();

    expect(mentionPosition(draft, "researcher")).toBe(0);
    expect(mentionPosition(draft, "mira")).toBe(17);
    expect(mentionPosition(draft, "absent")).toBe(-1);
  });

  it("does not match a handle that is only a prefix of a longer one", () => {
    // `\b` sits between `r` and `-`, so this used to fire a run for @researcher
    // as well as for @researcher-2.
    expect(mentionPosition("@researcher-2 hi", "researcher")).toBe(-1);
    expect(mentionPosition("@code-review please", "code")).toBe(-1);
    expect(mentionPosition("@code-review please", "code-review")).toBe(0);
  });

  it("still ends a mention at sentence punctuation", () => {
    expect(mentionPosition("thanks @mira.", "mira")).toBe(7);
    expect(mentionPosition("ask @mira, then wait", "mira")).toBe(4);
  });
});
