import { CategoryIcon } from './icons';
import { categoryLabel, explainPort } from './resolve';
import type { PortLike } from './types';

export interface PortBadgeProps {
  port: PortLike;
  /** Show the port number inside the badge. Off by default — the table already has a number column. */
  showPort?: boolean;
  /** `name` shows the plain-English service name, `category` shows the bucket it belongs to. */
  label?: 'name' | 'category' | 'none';
  size?: number;
  className?: string;
}

/**
 * The at-a-glance identifier for a port: a category glyph plus a plain-English
 * name, sized to sit inside a table row without crowding it.
 *
 * With `label="none"` it collapses to the icon alone, which is what the
 * narrow layouts want; the accessible name is kept either way.
 */
export function PortBadge({
  port,
  showPort = false,
  label = 'name',
  size = 16,
  className,
}: PortBadgeProps) {
  const explanation = explainPort(port);
  const text = label === 'category' ? categoryLabel(explanation.category) : explanation.plainName;
  const classes = ['pi-badge', `pi-badge--${explanation.category}`, className].filter(Boolean).join(' ');

  return (
    <span className={classes} data-category={explanation.category} data-confidence={explanation.confidence}>
      <CategoryIcon
        category={explanation.category}
        size={size}
        className="pi-badge__icon"
        title={label === 'none' ? explanation.plainName : undefined}
      />
      {showPort ? <span className="pi-badge__port">{port.port}</span> : null}
      {label === 'none' ? null : <span className="pi-badge__text">{text}</span>}
    </span>
  );
}
