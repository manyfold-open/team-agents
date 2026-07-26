import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../app/team-agents.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("modal stacking", () => {
  it("keeps the modal scrim below the interactive card", () => {
    expect(appSource).toContain('className="modal-scrim"');
    expect(styles).toMatch(/\.modal-layer\s*>\s*\.modal-scrim\s*\{[\s\S]*?z-index:\s*0;/);
    expect(styles).toMatch(/\.modal-card\s*\{[\s\S]*?z-index:\s*1;/);
  });
});
