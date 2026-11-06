export interface ErrorBannerProps {
  /** What went wrong, in words the customer can act on. */
  message: string;
  /** Called when the customer asks to try the payment again. */
  onRetry?: () => void;
}

/** Shown when a payment is declined. The basket keeps its contents so it can be retried. */
export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div role="alert">
      {message}
      {onRetry && <button onClick={onRetry}>Try again</button>}
    </div>
  );
}
