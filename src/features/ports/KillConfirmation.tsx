import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PortInfo } from '../../app/types';
import { Button } from '../../components/ui/controls';

export function KillConfirmation({ count, protectedPorts, hiddenPorts, onCancel, onConfirm }: {
  count: number;
  protectedPorts: PortInfo[];
  /** Ports sharing a PID with the selection that are hidden by the current filter. */
  hiddenPorts: PortInfo[];
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const keepFocus = (event: FocusEvent) => {
      if (!dialog.current?.contains(event.target as Node)) cancel.current?.focus();
    };
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('focusin', keepFocus);
      previous?.focus();
    };
  }, []);

  // Total ports affected = selected endpoints + hidden siblings
  const totalPorts = count + hiddenPorts.length;

  return createPortal(
    <div className="kill-confirmation-overlay">
      <div ref={dialog} className="kill-confirmation" role="alertdialog" aria-modal="true"
        aria-labelledby="kill-confirmation-title" aria-describedby="kill-confirmation-description"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
          if (event.key === 'Tab') {
            const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button');
            if (!buttons?.length) return;
            const next = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
            if (document.activeElement === next) {
              event.preventDefault();
              (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus();
            }
          }
        }}>
        <h2 id="kill-confirmation-title">Confirm process termination</h2>
        <div id="kill-confirmation-description">
          <p>{count} unique process{count === 1 ? '' : 'es'} selected
            {totalPorts > count && <>, affecting <strong>{totalPorts} port{totalPorts === 1 ? '' : 's'}</strong> total</>}.
            {totalPorts <= count && '.'} Termination can lose unsaved data and interrupt services.</p>
          {hiddenPorts.length > 0 && <>
            <p><strong>Also affected (hidden by current filter):</strong></p>
            <ul>{hiddenPorts.map((port) => <li key={`${port.pid}-${port.port}`}>:{port.port} — <strong>{port.process_name}</strong> (PID {port.pid})</li>)}</ul>
          </>}
          {protectedPorts.length > 0 && <>
            <p><strong>Protected services will be skipped:</strong></p>
            <ul>{protectedPorts.map((port) => <li key={port.pid}><strong>{port.process_name}</strong> — :{port.port} (PID {port.pid})</li>)}</ul>
          </>}
        </div>
        <div className="kill-confirmation__actions">
          <button ref={cancel} type="button" className="ui-button ui-button--secondary" onClick={onCancel}>Cancel</button>
          <Button variant="danger" onClick={onConfirm}>Confirm</Button>
        </div>
      </div>
    </div>, document.body,
  );
}
