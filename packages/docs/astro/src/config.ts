import path from 'node:path';
import {
  type SiteAccessConfig,
  type SiteChat,
  siteAccessSchema,
  siteChatSchema,
  type SiteNavigation,
  siteNavigationSchema,
} from 'autocatalog-docs-core';
import { z } from 'zod';
/**
 * What the integration decided, read back by the parts Astro loads on their own.
 *
 * `content.config.ts` is evaluated by Astro outside the integration's module
 * graph, so options cannot simply be passed to it. The environment is the seam
 * Astro itself offers, and the events site already uses it.
 */

export interface DocsSiteConfig {
  /** Absolute aggregation root. */
  root: string;
  /** Set only for the single-repo shape: the URL namespace documents sit under. */
  repo: string | undefined;
  /** Repository identity in the shared graph, when it differs from `repo`. */
  repository: string | undefined;
  /** Path to a committed JSON Schema, or undefined for the built-in contract. */
  schemaPath: string | undefined;
  /** Path to the organisation's conventions file, or undefined to find it by convention. */
  conventionsPath: string | undefined;
  /**
   * Repositories outside the root, each read as one: EventCatalog projects
   * `ac site` imported into its own cache, so nobody's checkout is written to.
   */
  sources: string[];
  /** Other sites' composed graphs (their `/catalog.json`), joined without pages. */
  indexes: string[];
  /** Repositories whose documents are left out because one breaks the contract. */
  exclude: string[];
  /** The release each catalog is locked at, as `platform v1.0.0`, by its directory. */
  releases: Record<string, string | undefined>;
  /** Each service's owning repository, from the lock, when the site is built from one. */
  serviceOwners: Map<string, string> | undefined;
  title: string;
  description: string;
  /** Who the site is for when not the company itself, such as `public`. */
  audience: string | undefined;
  /** The assistant every page offers, when the site has one. */
  chat: SiteChat | undefined;
  /** Who may open each document, decided per request. */
  access: SiteAccessConfig | undefined;
  /** Whether each page offers to copy, view and pin its Markdown. */
  pageActions: boolean;
  navigation: SiteNavigation | undefined;
  /** A server-sent events feed the maps can follow live. */
  live: { url: string; event: string } | undefined;
}

export function docsSiteConfig(): DocsSiteConfig {
  return {
    // '..' is the aggregating shape: a site in its own repository reading the
    // sibling repositories checked out beside it.
    root: process.env.AUTOCATALOG_DOCS_ROOT ?? '..',
    repo: process.env.AUTOCATALOG_DOCS_REPO || undefined,
    repository: process.env.AUTOCATALOG_DOCS_REPOSITORY || undefined,
    schemaPath: process.env.AUTOCATALOG_DOCS_SCHEMA || undefined,
    conventionsPath: process.env.AUTOCATALOG_DOCS_CONVENTIONS || undefined,
    sources: (process.env.AUTOCATALOG_DOCS_SOURCES ?? '').split(path.delimiter).filter(Boolean),
    indexes: (process.env.AUTOCATALOG_DOCS_INDEXES ?? '').split(path.delimiter).filter(Boolean),
    exclude: (process.env.AUTOCATALOG_DOCS_EXCLUDE ?? '').split(path.delimiter).filter(Boolean),
    releases: JSON.parse(process.env.AUTOCATALOG_DOCS_RELEASES ?? '{}'),
    serviceOwners: process.env.AUTOCATALOG_DOCS_SERVICE_OWNERS
      ? new Map(
          Object.entries(
            z
              .record(z.string(), z.string())
              .parse(JSON.parse(process.env.AUTOCATALOG_DOCS_SERVICE_OWNERS)),
          ),
        )
      : undefined,
    title: process.env.AUTOCATALOG_DOCS_TITLE ?? 'Documentation',
    audience: process.env.AUTOCATALOG_SITE_AUDIENCE || undefined,
    pageActions: process.env.AUTOCATALOG_SITE_PAGE_ACTIONS !== 'false',
    access: process.env.AUTOCATALOG_SITE_ACCESS
      ? siteAccessSchema.parse(JSON.parse(process.env.AUTOCATALOG_SITE_ACCESS))
      : undefined,
    chat: process.env.AUTOCATALOG_SITE_CHAT
      ? siteChatSchema.parse(JSON.parse(process.env.AUTOCATALOG_SITE_CHAT))
      : undefined,
    navigation: process.env.AUTOCATALOG_SITE_NAVIGATION
      ? siteNavigationSchema.parse(JSON.parse(process.env.AUTOCATALOG_SITE_NAVIGATION))
      : undefined,
    description:
      process.env.AUTOCATALOG_DOCS_DESCRIPTION ??
      'Documentation committed beside the code it describes, aggregated into one index.',
    live: process.env.AUTOCATALOG_DOCS_LIVE_URL
      ? {
          url: process.env.AUTOCATALOG_DOCS_LIVE_URL,
          // EventSource's default event name.
          event: process.env.AUTOCATALOG_DOCS_LIVE_EVENT || 'message',
        }
      : undefined,
  };
}
