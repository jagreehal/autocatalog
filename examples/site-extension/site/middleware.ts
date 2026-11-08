// Staff pages need ?staff, kept in a cookie. A plain function: nothing to install.
interface Context {
  url: URL;
  cookies: {
    get(name: string): { value: string } | undefined;
    set(name: string, value: string, options: { path: string }): void;
  };
  locals: { staff?: boolean };
}

export async function onRequest(context: Context, next: () => Promise<Response>) {
  const asked = context.url.searchParams.has('staff');

  if (asked) context.cookies.set('staff', '1', { path: '/' });

  const staff = asked || context.cookies.get('staff')?.value === '1';

  context.locals.staff = staff;

  if (!staff && context.url.pathname.includes('/staff')) {
    return new Response('Staff only', { status: 403 });
  }

  const response = await next();

  response.headers.set('x-extended', '1');

  return response;
}
