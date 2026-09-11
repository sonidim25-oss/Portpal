import { useEffect } from 'react';
import type { AdvancedPortFilters, PortFilter, PortCounts } from '../../app/types';
import { Button, SegmentedControl } from '../../components/ui/controls';

type PortFiltersProps = {
  advanced: AdvancedPortFilters;
  category: PortFilter;
  counts: PortCounts;
  open: boolean;
  onAdvancedChange: (filters: AdvancedPortFilters) => void;
  onCategoryChange: (filter: PortFilter) => void;
  onOpenChange: (open: boolean) => void;
};

export const DEFAULT_ADVANCED_PORT_FILTERS: AdvancedPortFilters = {
  protocol: 'all',
  project: 'all',
  restartableOnly: false,
  connectedOnly: false,
};

export function PortFilters({
  advanced,
  category,
  counts,
  open,
  onAdvancedChange,
  onCategoryChange,
  onOpenChange,
}: PortFiltersProps) {
  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onOpenChange(false);
      document.getElementById('port-filters-trigger')?.focus();
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onOpenChange, open]);

  return (
    <>
      <SegmentedControl
        ariaLabel="Port category"
        value={category}
        onChange={onCategoryChange}
        options={[
          { value: 'all', label: 'All', count: counts.all },
          { value: 'dev', label: 'Dev', count: counts.dev },
          { value: 'system', label: 'System', count: counts.system },
          { value: 'other', label: 'Other', count: counts.other },
        ]}
      />

      <div className="ports-filters__popover-wrap">
        <Button
          id="port-filters-trigger"
          aria-expanded={open}
          aria-haspopup="dialog"
          className="ports-filters__trigger"
          onClick={() => onOpenChange(!open)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 3h12L9.5 8v4.2l-3 1.3V8L2 3Z" />
          </svg>
          Filter
        </Button>

        {open && (
          <div className="ports-filters__popover" role="dialog" aria-label="Port filters">
            <label className="ports-filters__field">
              <span>Protocol</span>
              <select
                aria-label="Protocol"
                value={advanced.protocol}
                onChange={(event) =>
                  onAdvancedChange({
                    ...advanced,
                    protocol: event.target.value as AdvancedPortFilters['protocol'],
                  })
                }
              >
                <option value="all">All protocols</option>
                <option value="TCP">TCP</option>
                <option value="UDP">UDP (not scanned)</option>
              </select>
              <small className="ports-filters__note">
                PortPal scans TCP listeners only, so UDP matches nothing.
              </small>
            </label>

            <label className="ports-filters__field">
              <span>Project</span>
              <select
                aria-label="Project"
                value={advanced.project}
                onChange={(event) =>
                  onAdvancedChange({
                    ...advanced,
                    project: event.target.value as AdvancedPortFilters['project'],
                  })
                }
              >
                <option value="all">Any project state</option>
                <option value="with-project">Has project</option>
                <option value="without-project">No project</option>
              </select>
            </label>

            <label className="ports-filters__check">
              <input
                type="checkbox"
                checked={advanced.restartableOnly}
                onChange={(event) =>
                  onAdvancedChange({ ...advanced, restartableOnly: event.target.checked })
                }
              />
              <span>Restartable only</span>
            </label>

            <label className="ports-filters__check">
              <input
                type="checkbox"
                checked={advanced.connectedOnly}
                onChange={(event) =>
                  onAdvancedChange({ ...advanced, connectedOnly: event.target.checked })
                }
              />
              <span>Has active connections</span>
            </label>
          </div>
        )}
      </div>
    </>
  );
}
