// The assistant's model and what it answers about. Any AI SDK model works;
// a model id like this one goes through the Vercel AI Gateway, which needs
// AI_GATEWAY_API_KEY wherever the site runs.
import type { ChatOptions } from 'autocatalog-chatbot';

export default {
  model: process.env.CHAT_MODEL ?? 'anthropic/claude-haiku-5.5',
  subject: 'the Acme Payments API',
} satisfies ChatOptions;
