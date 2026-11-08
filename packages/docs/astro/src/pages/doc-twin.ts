// The Markdown twins on a site with `access`, rendered per request so the rule
// decides each one. See doc-twin.ts.
export const prerender = false;

export { docTwinRoute as GET } from '../doc-twin';
