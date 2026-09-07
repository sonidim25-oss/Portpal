// @ts-expect-error Vitest runs this source-contract test in Node; the app tsconfig omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entryStyles = readFileSync("src/index.css", "utf8");
const tokenStyles = readFileSync("src/styles/tokens.css", "utf8");

describe("global style foundation", () => {
  it("keeps the entry stylesheet free of legacy palette and glow rules", () => {
    expect(entryStyles).not.toMatch(/Inter|#0d1117|@keyframes\s+pulse|box-shadow/i);
  });

  it("loads the Geist and JetBrains Mono families with the token layer", () => {
    expect(tokenStyles).toContain("family=Geist");
    expect(tokenStyles).toContain("family=JetBrains+Mono");
  });
});
