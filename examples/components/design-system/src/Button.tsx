export interface ButtonProps {
  /** What the button says. */
  label: string;
  /** How much attention it asks for. */
  variant?: 'primary' | 'secondary';
}

/** The one button every product uses. */
export function Button({ label, variant = 'primary' }: ButtonProps) {
  return <button data-variant={variant}>{label}</button>;
}
