// Hide staff pages from the sidebar of everyone else.
type Entry = { type: string; label: string; href?: string; entries?: Entry[] };

const prune = (entries: Entry[]): Entry[] =>
  entries.flatMap((e) => {
    if (e.type === 'link' && e.href?.includes('/staff')) return [];

    return [e.entries ? { ...e, entries: prune(e.entries) } : e];
  });

export async function onRequest(context: any, next: () => Promise<void>) {
  await next();
  const route = context.locals.starlightRoute;

  if (context.locals.staff) return;

  route.sidebar = prune(route.sidebar);

  for (const side of ['prev', 'next'] as const) {
    if (route.pagination[side]?.href.includes('/staff')) route.pagination[side] = undefined;
  }
}
