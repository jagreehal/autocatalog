import type { APIRoute } from 'astro';
import { z } from 'zod';
import { docsCatalog } from '../catalog';
import { fromThisSite, startDesign } from '../design-editor';

// Served by `ac site` dev only (see routes.ts): it writes a design's file.
export const prerender = false;

const request = z.object({ repository: z.string(), title: z.string() });

/** Start a design in a repository; answers with where to edit it. */
export const POST: APIRoute = async ({ request: incoming, url }) => {
  if (!fromThisSite(incoming, url)) {
    return Response.json(
      { ok: false, error: 'Only this site can start a design.' },
      { status: 403 },
    );
  }

  const body = request.safeParse(await incoming.json().catch(() => undefined));

  if (!body.success) {
    return Response.json({ ok: false, error: 'Give a repository and a title.' }, { status: 400 });
  }

  const started = startDesign(await docsCatalog(), body.data.repository, body.data.title);

  if (!started.ok) return Response.json(started, { status: 422 });

  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  return Response.json({
    ok: true,
    href: `${base}designs/${body.data.repository}/${started.id}/edit/`,
  });
};
