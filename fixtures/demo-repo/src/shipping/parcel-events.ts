import { z } from 'zod';

// Wart: convention-only export — no defineEvent metadata. The scanner should
// find this by naming convention, mark it inferred, and flag it for review.
export const ParcelShippedEvent = z.object({
  parcelId: z.string(),
  carrier: z.enum(['ups', 'dhl', 'royal-mail']),
  shippedAt: z.string(),
});

// Not an event: same file, but the name does not match the convention.
export const parcelLabelFormat = z.object({ width: z.number(), height: z.number() });
