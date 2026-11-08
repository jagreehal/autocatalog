// A message for a person, with the conversation attached. A real site sends it
// to its help desk; this one logs it.
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const message = await request.json();

  console.log('support request', JSON.stringify(message));

  return new Response(null, { status: 204 });
};
