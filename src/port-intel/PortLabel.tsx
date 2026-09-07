import { explainPort } from './resolve';
import type { PortLike } from './types';

export interface PortLabelProps {
  port: PortLike;
  /**
   * `full`    → `Port 80 (Web Traffic / HTTP)`
   * `compact` → `80` with the plain name beside it, for dense table rows
   * `name`    → just the plain-English name
   */
  variant?: 'full' | 'compact' | 'name';
  className?: string;
}

/**
 * The plain-English rendering of a port number.
 *
 * This is the "Port 80 (Web Traffic / HTTP)" translation from the feature
 * request. `compact` is the variant meant for a table row, where the number
 * needs to stay scannable.
 */
export function PortLabel({ port, variant = 'full', className }: PortLabelProps) {
  const explanation = explainPort(port);
  const classes = ['pi-label', `pi-label--${variant}`, className].filter(Boolean).join(' ');

  if (variant === 'name') {
    return <span className={classes}>{explanation.plainName}</span>;
  }

  if (variant === 'compact') {
    return (
      <span className={classes}>
        <span className="pi-label__port">{port.port}</span>
        <span className="pi-label__name">{explanation.plainName}</span>
      </span>
    );
  }

  return <span className={classes}>{explanation.headline}</span>;
}
