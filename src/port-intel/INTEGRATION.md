# Wiring Port Intel into the UI

This module was built alongside an in-flight redesign of the frontend, so it
deliberately stops at the point where it would have to edit shared files.
Everything below is the remaining work: small, mechanical, and done **after**
the redesign branch has landed on `main`.

Nothing here is required for the module to be correct — `src/port-intel` is
fully tested on its own. This is only about putting it on screen.

---

## 0. Before you start

Check the file paths below still exist. They were read from the redesign
branch while it was in progress, and components may have moved.

```bash
ls src/features/ports/PortTable.tsx src/features/inspector/PortInspector.tsx
```

## 1. Load the stylesheet — 1 line

The components ship their own CSS. Import it once, wherever the app pulls in
its other global styles (`src/main.tsx` or `src/styles/global.css`):

```ts
import './port-intel/port-intel.css';
```

## 2. Point the colour tokens at the design system — 3 lines

`port-intel.css` reads the app's tokens and falls back to a standalone
palette. After the redesign, `--text-primary`, `--text-secondary`,
`--font-mono`, and the whole `--fs-*` scale already resolve on their own —
**no change needed for those.** Only the three surface tokens were renamed.
Add to `src/styles/tokens.css`:

```css
:root {
  --pi-surface: var(--surface-hover);
  --pi-surface-raised: var(--surface-selected);
  --pi-border: var(--border-default);
}
```

Do this rather than editing `port-intel.css`, so the module keeps working
standalone in tests.

## 3. Explain the port in the table row

In `src/features/ports/PortTable.tsx`, the port cell currently stacks the
number over the protocol. Wrap the number so hovering it explains the port,
and swap the protocol line for the plain-English name:

```tsx
import { PortTooltip, PortLabel } from '../../port-intel';
```

```tsx
<span className="ports-table__value-stack">
  <PortTooltip port={port}>
    <span className="ports-table__mono ports-table__port-number">{port.port}</span>
  </PortTooltip>
  <PortLabel port={port} variant="name" className="ports-table__secondary" />
</span>
```

If you would rather keep the protocol visible, put the badge in the process
column instead:

```tsx
<PortBadge port={port} />
```

> **Note on the row:** `<tr>` already has `tabIndex={0}` and an Enter/Space
> handler. The tooltip trigger is focusable too, so the row's
> `activateFromKeyboard` guard (`event.target !== event.currentTarget`) is what
> stops a keypress on the tooltip from also selecting the row. Keep that guard.

## 4. Explain the selected port in the inspector

In `src/features/inspector/PortInspector.tsx`, drop the full card in above the
existing detail sections:

```tsx
import { PortInfoCard } from '../../port-intel';
```

```tsx
<PortInfoCard port={port} headingLevel="h3" />
```

This is the "info card explaining the purpose of the selected port" from the
backlog. It renders its own heading, category, description, and the neutral
"is this normal here?" line.

## 5. Optional — let search find ports by what they do

`matchesPortQuery` lets a user type "database" and find Postgres, or "docker"
and find 2375. To use it, replace the free-text branch of `filterPorts` in
`src/utils/helpers.ts`:

```ts
import { matchesPortQuery } from '../port-intel';

// ...at the end of filterPorts, instead of the manual field join:
return list.filter((port) => matchesPortQuery(port, search));
```

Left out on purpose: `filterPorts` is covered by the redesign's own tests, and
changing it is a behaviour change rather than an addition.

---

## Two things to know before you merge

### `PortCategory` is declared in two places

`src/app/types.ts` exports `PortCategory = 'dev' | 'system' | 'other'` — the
filter buckets. `src/port-intel/types.ts` exports a different `PortCategory`
— `'web' | 'database' | 'dev-server' | …` — the explanation buckets.

They do not collide (different modules, no shared file), but if one file ever
imports both, alias one:

```ts
import type { PortCategory as PortIntelCategory } from '../port-intel';
```

Renaming mine to `PortIntelCategory` throughout is also fine; it is used in
four files.

### `DEV_PORTS` and the catalog overlap

`src/utils/helpers.ts` has `DEV_PORTS` (19 ports, label + colour + emoji) and
this module has `PORT_CATALOG` (117 ports, plain names + descriptions). The
duplication is deliberate — importing `helpers.ts` would have coupled this
module to a file being rewritten.

Once merged, the cleanup is to have `getServiceName` delegate:

```ts
import { explainPort } from '../port-intel';

export function getServiceName(port: PortInfo): string {
  if (port.project_name) return port.project_name;
  return explainPort(port).plainName;
}
```

`DEV_PORTS` would still be needed for its `color` field if the redesign keeps
per-framework colours; if it has gone fully monochrome, `DEV_PORTS` can go.

Do this as its own commit, after the merge, with the existing
`helpers.test.ts` green.
