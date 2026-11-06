export interface PayButtonProps {
  /** The amount shown on the button, already formatted. */
  amount: string;
  /** Disables the button while a payment is in flight. */
  busy?: boolean;
}

/** Takes the payment. Disabled while one is in flight, so a double click cannot pay twice. */
export function PayButton({ amount, busy = false }: PayButtonProps) {
  return <button disabled={busy}>{busy ? 'Paying…' : `Pay ${amount}`}</button>;
}
