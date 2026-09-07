/**
 * Port Intel — plain-English explanations for the ports PortPal detects.
 *
 * This module is deliberately self-contained: it imports nothing from the rest
 * of the app so it can be developed and merged independently of the UI shell.
 * See INTEGRATION.md for how it gets wired into the port table / inspector.
 */

/** Broad buckets a port falls into. Drives the icon and the category chip. */
export type PortCategory =
  | 'web'
  | 'dev-server'
  | 'database'
  | 'mail'
  | 'remote-access'
  | 'file-transfer'
  | 'directory'
  | 'messaging'
  | 'infrastructure'
  | 'system';

/**
 * How sure we are about an explanation, in descending order of confidence.
 * - `known`   exact match in the curated catalog
 * - `project` PortPal detected a project on disk for this port
 * - `process` inferred from the owning process name
 * - `range`   nothing but the port number itself to go on
 */
export type PortConfidence = 'known' | 'project' | 'process' | 'range';

/** A curated catalog entry: what this port is, in words a non-developer reads. */
export interface PortFacts {
  /** Plain-English name shown to the user, e.g. "Web Traffic". */
  plainName: string;
  /** The technical protocol or product name, e.g. "HTTP". */
  protocol: string;
  category: PortCategory;
  /** One or two sentences explaining what the port is for. No jargon. */
  description: string;
  /**
   * Neutral "is this normal to see?" context. Never an alarm and never a
   * threat score — just what it usually means when this port is open here.
   */
  context?: string;
  /** Extra search terms so "database" finds Postgres, "docker" finds 2375. */
  aliases?: string[];
}

/** A resolved explanation for one observed port. Always fully populated. */
export interface PortExplanation extends PortFacts {
  port: number;
  confidence: PortConfidence;
  /** Preformatted label: `Port 80 (Web Traffic / HTTP)`. */
  headline: string;
}

/**
 * The shape Port Intel needs from a detected port.
 *
 * Structurally compatible with the app's own `PortInfo` but declared here on
 * purpose, so a rename or signature change elsewhere in the app cannot break
 * this module. Callers pass their `PortInfo` straight in.
 */
export interface PortLike {
  port: number;
  process_name?: string | null;
  project_name?: string | null;
  project_path?: string | null;
}

/** Presentation metadata for each category. */
export interface CategoryMeta {
  /** Short human label for the chip, e.g. "Database". */
  label: string;
  /** One line describing the whole category, used in the info card. */
  blurb: string;
}
