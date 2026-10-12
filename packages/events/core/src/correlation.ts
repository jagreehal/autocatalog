import { fieldPaths } from './fields';
import type { LoadedEvent } from './load';

// The names correlation travels under, compared without case or separators.
const CORRELATION_NAMES = new Set([
  'correlationid',
  'causationid',
  'conversationid',
  'traceid',
  'traceparent',
]);

/**
 * The payload field that ties this event to the journey it belongs to: the
 * declared `delivery.correlationKey`, or else a field under a common name, the
 * shallowest first. Nothing inside an array, since there would be several.
 */
export function correlationPath(event: Pick<LoadedEvent, 'frontmatter' | 'schema'>) {
  const declared = event.frontmatter.delivery?.correlationKey;

  if (declared) return declared;

  const depth = (path: string) => path.split('.').length;

  return [...fieldPaths(event.schema)]
    .filter(
      (path) =>
        !path.includes('[]') &&
        CORRELATION_NAMES.has(
          path
            .slice(path.lastIndexOf('.') + 1)
            .toLowerCase()
            .replace(/[_-]/g, ''),
        ),
    )
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0];
}
