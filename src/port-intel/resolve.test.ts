import { describe, it, expect } from 'vitest';
import {
  categoryBlurb,
  categoryLabel,
  explainPort,
  formatHeadline,
  matchesPortQuery,
} from './resolve';
import { CATALOG_PORTS } from './catalog';
import type { PortLike } from './types';

const port = (over: Partial<PortLike> & { port: number }): PortLike => ({
  process_name: null,
  project_name: null,
  project_path: null,
  ...over,
});

describe('formatHeadline', () => {
  it('produces the label from the feature request', () => {
    expect(explainPort(port({ port: 80 })).headline).toBe('Port 80 (Web Traffic / HTTP)');
  });

  it('collapses the protocol when it only repeats the plain name', () => {
    expect(explainPort(port({ port: 5432 })).headline).toBe('Port 5432 (PostgreSQL Database)');
  });

  it('keeps the protocol when it adds information', () => {
    const facts = {
      plainName: 'Development Server',
      protocol: 'Vite',
      category: 'dev-server' as const,
      description: 'x',
    };
    expect(formatHeadline(5173, facts)).toBe('Port 5173 (Development Server / Vite)');
  });
});

describe('explainPort — catalog hits', () => {
  it('resolves a known port with high confidence', () => {
    const result = explainPort(port({ port: 6379 }));
    expect(result.confidence).toBe('known');
    expect(result.plainName).toBe('Redis Cache');
    expect(result.category).toBe('database');
  });

  it('carries the neutral context line through', () => {
    expect(explainPort(port({ port: 3389 })).context).toMatch(/remote desktop/i);
  });
});

describe('explainPort — detected projects', () => {
  it('names your project ahead of the generic framework label', () => {
    const result = explainPort(port({ port: 3000, project_name: 'my-app', process_name: 'node' }));
    expect(result.confidence).toBe('project');
    expect(result.plainName).toBe('my-app (Dev Server)');
    expect(result.description).toContain('my-app');
  });

  it('still explains the framework alongside the project name', () => {
    const result = explainPort(port({ port: 5173, project_name: 'shop' }));
    expect(result.description).toContain('Vite');
  });

  it('handles a project on a port the catalog does not know', () => {
    const result = explainPort(port({ port: 41234, project_name: 'weird-app' }));
    expect(result.confidence).toBe('project');
    expect(result.category).toBe('dev-server');
    expect(result.plainName).toBe('weird-app (Dev Server)');
  });

  it('does not let a project name override a well-known non-dev port', () => {
    const result = explainPort(port({ port: 443, project_name: 'my-app' }));
    expect(result.confidence).toBe('known');
    expect(result.plainName).toBe('Secure Web Traffic');
  });

  it('ignores a blank project name', () => {
    const result = explainPort(port({ port: 3000, project_name: '   ' }));
    expect(result.confidence).toBe('known');
  });
});

describe('explainPort — process hints', () => {
  it('recognises a database moved to an unusual port', () => {
    const result = explainPort(port({ port: 54320, process_name: 'postgres' }));
    expect(result.confidence).toBe('process');
    expect(result.category).toBe('database');
    expect(result.plainName).toBe('PostgreSQL Database');
  });

  it('strips a .exe suffix before matching', () => {
    const result = explainPort(port({ port: 33333, process_name: 'mysqld.exe' }));
    expect(result.confidence).toBe('process');
    expect(result.plainName).toBe('MySQL Database');
  });

  it('prefers the specific runtime over the generic one', () => {
    // "mongod" must not fall through to a generic match.
    expect(explainPort(port({ port: 40001, process_name: 'mongod' })).plainName).toBe(
      'MongoDB Database',
    );
    expect(explainPort(port({ port: 40002, process_name: 'node.exe' })).plainName).toBe(
      'Node.js Application',
    );
  });

  it('explains a container-forwarded port', () => {
    const result = explainPort(port({ port: 32768, process_name: 'com.docker.backend' }));
    expect(result.category).toBe('infrastructure');
    expect(result.plainName).toBe('Container Port');
  });

  it('recognises Windows system processes', () => {
    const result = explainPort(port({ port: 49669, process_name: 'lsass.exe' }));
    expect(result.confidence).toBe('process');
    expect(result.category).toBe('system');
  });

  it('does not use a process hint when the port itself is known', () => {
    const result = explainPort(port({ port: 443, process_name: 'nginx' }));
    expect(result.confidence).toBe('known');
  });
});

describe('explainPort — range fallback', () => {
  it('explains an ephemeral port instead of leaving it blank', () => {
    const result = explainPort(port({ port: 49664, process_name: 'unknown-thing.exe' }));
    expect(result.confidence).toBe('range');
    expect(result.plainName).toBe('Temporary Port');
  });

  it('marks an unrecognised low port as a system service', () => {
    expect(explainPort(port({ port: 999 })).plainName).toBe('System Service');
  });

  it('marks an unrecognised mid-range port as an application port', () => {
    expect(explainPort(port({ port: 40404 })).plainName).toBe('Application Port');
  });
});

describe('explainPort — always answers', () => {
  it('returns a complete explanation for every port number', () => {
    // Sweep the whole space in steps, plus every catalogued port and the
    // boundaries of each range.
    const samples = new Set<number>([1, 1023, 1024, 49151, 49152, 65535, ...CATALOG_PORTS]);
    for (let p = 1; p <= 65535; p += 331) samples.add(p);

    for (const p of samples) {
      const result = explainPort(port({ port: p }));
      expect(result.plainName.trim(), `port ${p}`).not.toBe('');
      expect(result.description.trim(), `port ${p}`).not.toBe('');
      expect(result.headline, `port ${p}`).toContain(`Port ${p}`);
      expect(categoryLabel(result.category), `port ${p}`).toBeTruthy();
      expect(categoryBlurb(result.category), `port ${p}`).toBeTruthy();
    }
  });
});

describe('matchesPortQuery', () => {
  it('matches an empty query', () => {
    expect(matchesPortQuery(port({ port: 5432 }), '  ')).toBe(true);
  });

  it('finds a port by its number', () => {
    expect(matchesPortQuery(port({ port: 5432 }), '543')).toBe(true);
  });

  it('finds databases by the plain-English word', () => {
    expect(matchesPortQuery(port({ port: 5432 }), 'database')).toBe(true);
    expect(matchesPortQuery(port({ port: 27017 }), 'database')).toBe(true);
  });

  it('finds a port through its aliases', () => {
    expect(matchesPortQuery(port({ port: 2375 }), 'docker')).toBe(true);
    expect(matchesPortQuery(port({ port: 5173 }), 'svelte')).toBe(true);
  });

  it('finds a port by its category label', () => {
    expect(matchesPortQuery(port({ port: 3389 }), 'remote access')).toBe(true);
  });

  it('rejects a query that matches nothing', () => {
    expect(matchesPortQuery(port({ port: 5432 }), 'zzzz')).toBe(false);
  });
});
