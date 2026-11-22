import path from 'node:path';
import { apiPath, apiTitle } from './apis';
import { changedAt, eventChangedAt, repositoryFileChangedAt, type DocsCatalog } from './catalog';
import { modelPath, modelTitle } from './data-models';
import { eventPath } from './event-path';
import { dataProductPath, entityPath } from './model';
import { specificationPath } from './specifications';
import { docHref, type DocListItem } from './ui/lib/docs';
import type { RecentChange } from './ui/pages/HomeBlock';

/** Enough to see what moved lately; each page says when it changed. */
export const RECENT_SIZE = 8;

/**
 * What changed most recently across the catalog, newest first: documents and
 * every resource read from one file or folder. Git dates them; anything git
 * cannot date is left out rather than guessed.
 */
export function recentChanges(
  catalog: Pick<
    DocsCatalog,
    'events' | 'apis' | 'specifications' | 'model' | 'models' | 'graph' | 'repositoryRoots'
  >,
  documents: DocListItem[],
  base: string,
  changed: (absolute: string) => string | null = changedAt,
  limit = RECENT_SIZE,
): RecentChange[] {
  const inRepository = (repository: string, file: string) =>
    repositoryFileChangedAt(catalog, repository, file, changed);

  const all: Array<Omit<RecentChange, 'updated'> & { updated: string | null }> = [
    ...documents.map((doc) => ({
      kind: 'Document',
      icon: 'doc' as const,
      title: doc.title,
      href: docHref(doc.id),
      repository: doc.repo,
      updated: doc.updated,
    })),
    ...catalog.events.map((entry) => ({
      kind: 'Event',
      icon: 'event' as const,
      title: entry.event.frontmatter.name,
      href: `${base}${eventPath(entry)}`,
      repository: entry.repository,
      updated: eventChangedAt(catalog, entry, changed),
    })),
    ...catalog.apis.map((api) => ({
      kind: 'API',
      icon: 'api' as const,
      title: apiTitle(api),
      href: `${base}${apiPath(api)}`,
      repository: api.repository,
      updated: inRepository(api.repository, api.file),
    })),
    ...catalog.specifications.map((spec) => ({
      kind: 'Specification',
      icon: 'braces' as const,
      title: spec.title,
      href: `${base}${specificationPath(spec)}`,
      repository: spec.repository,
      updated: inRepository(spec.repository, spec.file),
    })),
    ...catalog.model.entities.map((entity) => ({
      kind: 'Entity',
      icon: 'entity' as const,
      title: entity.name,
      href: `${base}${entityPath(entity)}`,
      repository: entity.repository,
      updated: inRepository(entity.repository, entity.file),
    })),
    ...catalog.model.dataProducts.map((product) => ({
      kind: 'Data product',
      icon: 'data' as const,
      title: product.name,
      href: `${base}${dataProductPath(product)}`,
      repository: product.repository,
      updated: inRepository(product.repository, product.file),
    })),
    ...catalog.models.map((model) => {
      const file = model.resource.source?.file;

      return {
        kind: 'Data model',
        icon: 'model' as const,
        title: modelTitle(model.resource),
        href: `${base}${modelPath(model)}`,
        repository: model.repository,
        updated: file ? changed(path.join(model.repositoryRoot, file)) : null,
      };
    }),
  ];

  return all
    .filter((item): item is RecentChange => item.updated !== null)
    .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
    .slice(0, limit);
}
