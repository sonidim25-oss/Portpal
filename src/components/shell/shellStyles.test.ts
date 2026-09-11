// @ts-expect-error Vitest runs this source-contract test in Node; the app tsconfig omits Node types.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shellStyles = readFileSync('src/components/shell/shell.css', 'utf8');

describe('application shell layout contracts', () => {
  it('keeps the sidebar spanning both rows while titlebar stays in the workspace column', () => {
    expect(shellStyles).toMatch(
      /\.app-shell\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*var\(--sidebar-width\)\s+minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*var\(--titlebar-height\)\s+minmax\(0,\s*1fr\);/s,
    );
    expect(shellStyles).toMatch(
      /\.shell-sidebar\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1\s*\/\s*-1;/s,
    );
    expect(shellStyles).toMatch(/\.shell-titlebar\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/s);
    expect(shellStyles).toMatch(
      /\.app-shell__content\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;/s,
    );
  });

  it('reduces monitoring to its status dot at max-width 820px', () => {
    const compactStyles =
      shellStyles.match(/@media\s*\(max-width:\s*820px\)\s*\{([\s\S]*)$/)?.[1] ?? '';

    expect(compactStyles).toMatch(
      /\.shell-monitoring-status\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s,
    );
    expect(compactStyles).toMatch(
      /\.shell-monitoring-status__heading-copy,\s*\.shell-monitoring-status p\s*\{[^}]*position:\s*absolute;[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\);/s,
    );
  });
});
