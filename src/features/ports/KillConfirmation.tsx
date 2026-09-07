import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PortInfo } from '../../app/types';
import { Button } from '../../components/ui/controls';

export function KillConfirmation({ count, protectedPorts, onCancel, onConfirm }: {
  count: number;
  protectedPorts: PortInfo[];
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
          <p>{count} unique process{count === 1 ? '' : 'es'} selected. Termination can lose unsaved data and interrupt services.</p>
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
