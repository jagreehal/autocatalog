// The assistant's endpoint: it answers per request, from the pages the build
// published, with the model the site's own module chose. The module can narrow
// the pages to what this reader may open, and say who they are.
import type { APIRoute } from 'astro';
import { createChat, pagesSource } from 'autocatalog-chatbot';
import { options, pages } from 'virtual:autocatalog-chat';

export const prerender = false;

// Told per request below, with the request: see SiteChatOptions.
const chat = createChat({ ...options, onAsked: undefined, onAnswered: undefined });

const everyPage = pagesSource(pages);

export const POST: APIRoute = async ({ request, locals }) => {
  // On a site with `access`, only what this reader may open.
  const { canRead } = locals;

  const readable = canRead
    ? pages.filter((page) => page.id === undefined || canRead({ id: page.id }))
    : pages;

  const asked = { request, locals, pages: readable };

  return chat.respond(request, {
    source: options.source
      ? await options.source(asked)
      : canRead
        ? pagesSource(readable)
        : everyPage,
    context: options.context?.(asked),
    onAsked: (question) => options.onAsked?.(question, asked),
    onAnswered: (turn) => options.onAnswered?.(turn, asked),
  });
};
