/** Starlight's default path: a file in the site's `public/` directory. */
export const DEFAULT_FAVICON = '/favicon.svg';

/**
 * Favicon href for the site. A Starlight `favicon` config wins, then
 * `AUTOCATALOG_SITE_FAVICON`, then the shipped default. Put a file at that
 * path under `public/` to change the artwork without touching config.
 */
export function resolveFavicon(
  configured?: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.AUTOCATALOG_SITE_FAVICON?.trim();

  return configured?.trim() || fromEnv || DEFAULT_FAVICON;
}
