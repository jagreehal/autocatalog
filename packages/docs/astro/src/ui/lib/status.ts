/** The stock Badge variants a document's state is shown with. */
export type StatusVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/**
 * The built-in kinds' states. Settled is the accent, in progress is quiet,
 * what a reader must act on is destructive, and anything replaced or unknown
 * is an outline: the word always says the state, so colour is never alone.
 */
export function statusVariant(status: string): StatusVariant {
  switch (status.toLowerCase()) {
    case 'accepted':
    case 'resolved':
      return 'default';
    case 'proposed':
    case 'mitigated':
      return 'secondary';
    case 'open':
    case 'rejected':
      return 'destructive';
    default:
      return 'outline';
  }
}

/** `supersededBy` as "Superseded by", for a field with no title of its own. */
export function fieldHeading(field: string): string {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}
