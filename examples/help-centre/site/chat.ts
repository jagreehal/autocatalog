// The assistant: any AI SDK model. It answers from the pages this reader may
// open, as site/access.ts decides.
// A model id like this one goes through the Vercel AI Gateway, which needs
// AI_GATEWAY_API_KEY wherever the site runs.
import type { SiteChatOptions } from 'autocatalog-docs-astro';

export default {
  model: process.env.CHAT_MODEL ?? 'anthropic/claude-haiku-5.5',
  subject: 'Acme, the invoicing app',
  context: ({ locals: { reader } }) =>
    reader
      ? `The reader is signed in as ${reader.name}, with ${reader.access.join(' and ')}.`
      : 'The reader is not signed in, so only the general guides are open to them.',
} satisfies SiteChatOptions;
