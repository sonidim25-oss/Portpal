interface ErrorNoticeProps {
  message: string;
  retryLabel: string;
  onRetry(): void;
}

/// The one banner every secondary page uses to report a failed backend call.
/// Shared so a failure reads the same wherever the user happens to be, and so
/// the retry is always announced with its own accessible name.
export function ErrorNotice({ message, retryLabel, onRetry }: ErrorNoticeProps) {
  return (
    <div className="secondary-error" role="alert">
      <span>{message}</span>
      <button onClick={onRetry} aria-label={retryLabel}>Retry</button>
    </div>
  );
}
