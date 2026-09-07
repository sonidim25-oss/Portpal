// @ts-expect-error Vitest runs this source-contract test in Node; the app tsconfig omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("src/features/port-map/port-map.css", "utf8");

describe("Port Map responsive layout contracts", () => {
  it("keeps the map canvas open and free of decorative gradients", () => {
    expect(styles).not.toMatch(/linear-gradient|radial-gradient|background-image/i);
    expect(styles).toMatch(/\.port-map__canvas\s*\{[^}]*background:\s*var\(--surface-app\)/s);
  });

  it("uses a full shared inspector width on desktop and overlays it below 980px", () => {
    expect(styles).toMatch(/\.port-map__workspace\s*>\s*\.port-inspector\s*\{[^}]*width:\s*320px/s);
    const compact = styles.match(/@media\s*\(max-width:\s*979px\)\s*\{([\s\S]*)$/)?.[1] ?? "";
    expect(compact).toMatch(/\.port-map__workspace\s*>\s*\.port-inspector\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*width:\s*min\(320px,\s*calc\(100%\s*-\s*24px\)\)/s);
  });

  it("allows the topology to contract inside a 480px-tall window", () => {
    expect(styles).toMatch(/\.port-map__canvas\s*\{[^}]*min-height:\s*0/s);
    expect(styles).toMatch(/\.port-map__topology\s*\{[^}]*min-height:\s*0/s);
  });
});
