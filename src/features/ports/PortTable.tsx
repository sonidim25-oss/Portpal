import type { KeyboardEvent, MouseEvent } from "react";
import type { PortInfo, TrafficByPort } from "../../app/types";
import { IconButton } from "../../components/ui/controls";
import { latestConnectionCount, timeAgo } from "../../utils/helpers";

export type PortSelection = { port: number; pid: number };

type PortTableProps = {
  killedPorts: Map<number, PortInfo>;
  killing: ReadonlySet<number>;
  observedAt: Record<number, number>;
  onKill: (port: PortInfo) => Promise<void>;
  onRestart: (port: PortInfo) => Promise<void>;
  onSelect: (port: PortInfo) => void;
  ports: PortInfo[];
  restarting: ReadonlySet<number>;
  selected: PortSelection | null;
  traffic: TrafficByPort;
};

function isSelected(port: PortInfo, selected: PortSelection | null): boolean {
  return selected?.port === port.port && selected.pid === port.pid;
}

function stopRowSelection(event: MouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

function RestartButton({
  busy,
  disabled,
  onRestart,
  port,
}: {
  busy: boolean;
  disabled: boolean;
  onRestart: (port: PortInfo) => Promise<void>;
  port: PortInfo;
}) {
  return (
    <IconButton
      label={`${busy ? "Restarting" : "Restart"} port ${port.port}`}
      className="ports-table__action"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={(event) => {
        stopRowSelection(event);
        void onRestart(port);
      }}
    >
      {busy ? (
        <span className="ports-table__spinner" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13 5V2m0 0h-3M13 2l-2.1 2.1A5 5 0 1 0 13 9" />
        </svg>
      )}
    </IconButton>
  );
}

function KillButton({
  busy,
  disabled,
  onKill,
  port,
}: {
  busy: boolean;
  disabled: boolean;
  onKill: (port: PortInfo) => Promise<void>;
  port: PortInfo;
}) {
  return (
    <IconButton
      label={`${busy ? "Killing" : "Kill"} port ${port.port}`}
      className="ports-table__action ports-table__action--danger"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={(event) => {
        stopRowSelection(event);
        void onKill(port);
      }}
    >
      {busy ? (
        <span className="ports-table__spinner" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" />
          <path d="m6 6 4 4m0-4-4 4" />
        </svg>
      )}
    </IconButton>
  );
}

function PortRow({
  killed,
  killing,
  observedAt,
  onKill,
  onRestart,
  onSelect,
  port,
  restarting,
  selected,
  traffic,
}: {
  killed: boolean;
  killing: ReadonlySet<number>;
  observedAt?: number;
  onKill: (port: PortInfo) => Promise<void>;
  onRestart: (port: PortInfo) => Promise<void>;
  onSelect: (port: PortInfo) => void;
  port: PortInfo;
  restarting: ReadonlySet<number>;
  selected: boolean;
  traffic: TrafficByPort;
}) {
  const isKilling = killing.has(port.pid);
  const isRestarting = restarting.has(port.pid);
  const pending = isKilling || isRestarting;
  const restartable = Boolean(port.start_cmd && port.project_path);
  const activate = () => onSelect(port);
  const activateFromKeyboard = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };

  return (
    <tr
      className={killed ? "ports-table__row ports-table__row--stopped" : "ports-table__row"}
      aria-selected={selected}
      tabIndex={0}
      onClick={activate}
      onKeyDown={activateFromKeyboard}
    >
      <td className="ports-table__port">
        <span className={killed ? "ports-table__dot ports-table__dot--stopped" : "ports-table__dot"} />
        <span className="ports-table__value-stack">
          <span className="ports-table__mono ports-table__port-number">{port.port}</span>
          <span className="ports-table__secondary ports-table__mono">{port.protocol}</span>
        </span>
        {killed
          ? <span className="ports-table__stopped-label">STOPPED</span>
          : <span className="ui-visually-hidden">Listening</span>}
      </td>
      <td className="ports-table__project">
        <span className="ports-table__value-stack">
          <span>{port.process_name}</span>
          {port.start_cmd && (
            <span className="ports-table__secondary ports-table__mono" title={port.start_cmd}>{port.start_cmd}</span>
          )}
        </span>
      </td>
      <td>
        <span className="ports-table__value-stack">
          <span>{port.project_name ?? "—"}</span>
          {port.project_path && (
            <span className="ports-table__secondary ports-table__mono" title={port.project_path}>{port.project_path}</span>
          )}
        </span>
      </td>
      <td className="ports-table__mono">{port.pid}</td>
      <td className="ports-table__mono ports-table__connections">{killed ? "—" : latestConnectionCount(traffic, port)}</td>
      <td>{observedAt === undefined ? "—" : timeAgo(observedAt)}</td>
      <td className="ports-table__actions">
        {restartable && (
          <RestartButton port={port} busy={isRestarting} disabled={pending} onRestart={onRestart} />
        )}
        {!killed && <KillButton port={port} busy={isKilling} disabled={pending} onKill={onKill} />}
      </td>
    </tr>
  );
}

export function PortTable({
  killedPorts,
  killing,
  observedAt,
  onKill,
  onRestart,
  onSelect,
  ports,
  restarting,
  selected,
  traffic,
}: PortTableProps) {
  return (
    <div className="ports-table-wrap">
      <table className="ports-table">
        <thead>
          <tr>
            <th scope="col">PORT</th>
            <th scope="col">PROCESS</th>
            <th scope="col" className="ports-table__project">PROJECT</th>
            <th scope="col">PID</th>
            <th scope="col" className="ports-table__connections">CONNECTIONS</th>
            <th scope="col">STARTED</th>
            <th scope="col" className="ports-table__actions-heading">ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {ports.map((port) => (
            <PortRow
              key={`${port.pid}-${port.port}`}
              port={port}
              traffic={traffic}
              observedAt={observedAt[port.port]}
              killed={false}
              selected={isSelected(port, selected)}
              killing={killing}
              restarting={restarting}
              onSelect={onSelect}
              onKill={onKill}
              onRestart={onRestart}
            />
          ))}
          {[...killedPorts.values()].map((port) => (
            <PortRow
              key={`stopped-${port.pid}-${port.port}`}
              port={port}
              traffic={traffic}
              observedAt={observedAt[port.port]}
              killed
              selected={isSelected(port, selected)}
              killing={killing}
              restarting={restarting}
              onSelect={onSelect}
              onKill={onKill}
              onRestart={onRestart}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
