import { useCallback, useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { PortInfoCard } from './PortInfoCard';
import { explainPort } from './resolve';
import type { PortLike } from './types';

export interface PortTooltipProps {
  port: PortLike;
  /** The thing being explained — a port number, a badge, a table cell. */
  children: ReactNode;
  /** Which side the card opens on. Defaults to below the trigger. */
  placement?: 'top' | 'bottom';
  className?: string;
}

/**
 * Wraps any element so that hovering or focusing it reveals the port's
 * explanation card.
 *
 * Deliberately built on plain hover, focus, and Escape rather than a
 * positioning library: it adds no dependency, and a tooltip anchored to a
 * table row does not need collision detection. The trigger is focusable and
 * described by the card, so the explanation is reachable by keyboard and
 * announced by screen readers.
 */
export function PortTooltip({ port, children, placement = 'bottom', className }: PortTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const explanation = explainPort(port);

  const close = useCallback(() => setOpen(false), []);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        setOpen(false);
      }
    },
    [open],
  );

  return (
    <span
      className={['pi-tooltip', className].filter(Boolean).join(' ')}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
    >
      <span
        className="pi-tooltip__trigger"
        tabIndex={0}
        aria-describedby={open ? tooltipId : undefined}
        aria-label={explanation.headline}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
      >
        {children}
      </span>
      {open ? (
        <span
          className={`pi-tooltip__panel pi-tooltip__panel--${placement}`}
          role="tooltip"
          id={tooltipId}
        >
          <PortInfoCard port={port} headingLevel="h4" />
        </span>
      ) : null}
    </span>
  );
}
