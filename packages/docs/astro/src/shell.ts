/**
 * What a page tells the title block above it: which resource it is about, what
 * a reader can do with the page, and any state worth flagging.
 */

import type { IconName } from './icons';

/** The kinds a page can be about. */
export type ResourceKind = 'event' | 'service' | 'agent' | 'doc';

export interface ShellLink {
  label: string;
  /** Absent for something with nothing to link to. */
  href?: string;
  kind?: ResourceKind;
}

/**
 * Something the reader can do with the page itself, shown under its title.
 * Only for what really exists: a Markdown twin, a raw schema.
 */
export interface PageAction {
  label: string;
  href: string;
  icon: IconName;
  /** Copies what `href` serves to the clipboard instead of opening it. */
  copy?: boolean;
}

/** What the title block shows above and below the page's title. */
export interface PageHeader {
  actions?: PageAction[];
  /** A call to action level with the title, such as "Explore catalog". */
  primary?: { label: string; href: string };
}

/** What a resource page tells the title block about itself. */
export interface ResourceContext extends PageHeader {
  kind: ResourceKind;
  name: string;
  /** Its key in the catalog graph, such as `event:payments/payment.captured`. */
  key: string;
  /** States worth flagging: a version, deprecated, an earlier version. Never the kind. */
  pills: Array<{ text: string; tone?: 'warn' }>;
}

// Keyed by the request's locals: a page sets its context in its frontmatter,
// which runs before Starlight renders the title and sidebar for the same request.
const contexts = new WeakMap<App.Locals, ResourceContext>();

const headers = new WeakMap<App.Locals, PageHeader>();

export function setResourceContext(locals: App.Locals, context: ResourceContext): void {
  contexts.set(locals, context);
}

export function resourceContext(locals: App.Locals): ResourceContext | undefined {
  return contexts.get(locals);
}

/** For a page that is not about one resource: an index, the front door. */
export function setPageHeader(locals: App.Locals, header: PageHeader): void {
  headers.set(locals, header);
}

export function pageHeader(locals: App.Locals): PageHeader | undefined {
  return contexts.get(locals) ?? headers.get(locals);
}

/** `v1.2.0` for a numeric version; any other scheme is shown as written. */
export function versionLabel(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}
