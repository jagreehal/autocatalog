import { z } from 'zod';

export const SendEmailInput = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  templateId: z.string().optional(),
});

export const SendEmailOutput = z.object({
  messageId: z.string(),
  sentAt: z.string().datetime(),
});
