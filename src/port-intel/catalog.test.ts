import { describe, it, expect } from 'vitest';
import { CATALOG_PORTS, CATEGORY_META, PORT_CATALOG } from './catalog';
import type { PortCategory } from './types';

const entries = Object.entries(PORT_CATALOG).map(([port, facts]) => ({
  port: Number(port),
  facts,
}));

describe('PORT_CATALOG shape', () => {
  it('is a substantial catalog', () => {
    expect(entries.length).toBeGreaterThanOrEqual(100);
  });

  it('uses valid port numbers', () => {
    for (const { port } of entries) {
      expect(Number.isInteger(port)).toBe(true);
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThanOrEqual(65535);
    }
  });

  it('gives every entry a plain name, protocol and description', () => {
    for (const { port, facts } of entries) {
      expect(facts.plainName.trim(), `port ${port} plainName`).not.toBe('');
      expect(facts.protocol.trim(), `port ${port} protocol`).not.toBe('');
      expect(facts.description.trim(), `port ${port} description`).not.toBe('');
    }
  });

  it('gives every entry the neutral "is this normal" context line', () => {
    for (const { port, facts } of entries) {
      expect(facts.context, `port ${port} context`).toBeTruthy();
      expect(facts.context!.trim(), `port ${port} context`).not.toBe('');
    }
  });

  it('keeps descriptions short enough to read in a tooltip', () => {
    for (const { port, facts } of entries) {
      expect(facts.description.length, `port ${port} description length`).toBeLessThanOrEqual(220);
      expect(facts.context!.length, `port ${port} context length`).toBeLessThanOrEqual(180);
    }
  });

  it('only uses categories that have presentation metadata', () => {
    for (const { port, facts } of entries) {
      expect(CATEGORY_META[facts.category], `port ${port} category ${facts.category}`).toBeDefined();
    }
  });

  it('exercises every declared category at least once', () => {
    const used = new Set(entries.map((entry) => entry.facts.category));
    for (const category of Object.keys(CATEGORY_META) as PortCategory[]) {
      expect(used.has(category), `category ${category} has no entries`).toBe(true);
    }
  });

  it('lower-cases every alias so search comparisons stay simple', () => {
    for (const { port, facts } of entries) {
      for (const alias of facts.aliases ?? []) {
        expect(alias, `port ${port} alias`).toBe(alias.toLowerCase());
      }
    }
  });
});

describe('CATALOG_PORTS', () => {
  it('lists every catalogued port in ascending order', () => {
    expect(CATALOG_PORTS).toHaveLength(entries.length);
    expect([...CATALOG_PORTS].sort((a, b) => a - b)).toEqual(CATALOG_PORTS);
  });
});

describe('catalog coverage', () => {
  it('covers the ports PortPal already advertises support for', () => {
    // From README "Supported Frameworks" — these must never regress.
    for (const port of [3000, 4200, 5173, 4000, 8000, 8080, 5432, 6379, 3306, 27017, 1420]) {
      expect(PORT_CATALOG[port], `missing port ${port}`).toBeDefined();
    }
  });

  it('covers the everyday ports a non-technical user is likely to ask about', () => {
    for (const port of [80, 443, 22, 3389, 445, 53, 5353]) {
      expect(PORT_CATALOG[port], `missing port ${port}`).toBeDefined();
    }
  });

  it('translates port 80 the way the feature request specifies', () => {
    expect(PORT_CATALOG[80].plainName).toBe('Web Traffic');
    expect(PORT_CATALOG[80].protocol).toBe('HTTP');
  });
});
