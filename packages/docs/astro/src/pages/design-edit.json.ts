import { Model, validateModel } from '@eventcatalog/visualiser/model';
import type { APIRoute } from 'astro';
import { studioModelSchema } from 'autocatalog-docs-core';
import { z } from 'zod';
import { docsCatalog } from '../catalog';
import {
  checkDesign,
  editableDesign,
  fromThisSite,
  openDesign,
  unreadable,
} from '../design-editor';
import type { DesignCheck } from '../ui/lib/canvas-model';

// Served by `ac site` dev only (see routes.ts): it writes the design's file.
export const prerender = false;

const json = (body: DesignCheck | ReturnType<typeof openDesign>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * Check the canvas against the catalog, and save it as the design's file when
 * the body says `save`. Only this site's own page may ask (`fromThisSite`).
 */
export const POST: APIRoute = async ({ params, request, url }) => {
  if (!fromThisSite(request, url)) {
    return json({ ok: false, errors: ['Only this site can change a design.'], warnings: [] }, 403);
  }

  const catalog = await docsCatalog();
  const editable = editableDesign(catalog, params.repository ?? '', params.id ?? '');

  if (!editable)
    return json({ ok: false, errors: ['There is no such design.'], warnings: [] }, 404);

  const body = z
    .object({ model: z.unknown(), save: z.boolean().default(false), tab: z.string().default('') })
    .safeParse(await request.json().catch(() => undefined));

  // Studio's own schema for its checks, the design's cut of it for the file.
  const studio = Model.safeParse(body.data?.model);
  const model = studioModelSchema.safeParse(body.data?.model);

  if (!body.success || !studio.success || !model.success) {
    return json(
      { ok: false, errors: ['The canvas sent something that is not a design.'], warnings: [] },
      400,
    );
  }

  const result = checkDesign(
    catalog,
    editable,
    model.data,
    validateModel(studio.data),
    body.data.save ? body.data.tab : undefined,
  );

  return json(result, result.ok ? 200 : 422);
};

/** The design as its file says it now: the editor asks again when the file changes on disk. */
export const GET: APIRoute = async ({ params }) => {
  const catalog = await docsCatalog();
  const [repository, id] = [params.repository ?? '', params.id ?? ''];
  const editable = editableDesign(catalog, repository, id);

  if (editable) return json(openDesign(catalog, editable));

  // Written by someone else so that it does not hold: say why, rather than that it is gone.
  const problem = unreadable(catalog, repository, id);

  return json(
    { ok: false, errors: [problem ?? 'There is no such design.'], warnings: [] },
    problem ? 422 : 404,
  );
};
