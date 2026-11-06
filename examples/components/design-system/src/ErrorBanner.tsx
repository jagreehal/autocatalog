export interface ErrorBannerProps {
  /** What went wrong. */
  title: string;
  /** How to put it right. */
  detail?: string;
}

/** The shared banner for a failed action. */
export function ErrorBanner({ title, detail }: ErrorBannerProps) {
  return (
    <div role="alert">
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
