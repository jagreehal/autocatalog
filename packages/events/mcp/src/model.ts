import path from 'node:path';
import { lookupTerm, readDomainModel } from 'autocatalog-docs-core';
import type { CatalogSnapshot } from './tools.js';

/** The domain model this checkout keeps: glossary, entities, data products, teams and users. */
export function domainModel(catalog: CatalogSnapshot) {
  return readDomainModel(
    [{ repository: path.basename(catalog.repoRoot), dir: catalog.repoRoot }],
    catalog.mapGraph,
    {
      schemaOf: (event) =>
        catalog.events.find(
          ({ frontmatter }) =>
            frontmatter.id === event.ref.id &&
            event.ref.namespace?.split('/').at(-1) === frontmatter.domain,
        )?.schema,
    },
  );
}

/**
 * What a word means here: the glossary terms that match it, and the entities
 * named for it with their properties and the events that carry them.
 */
export function define(catalog: CatalogSnapshot, query: string) {
  const model = domainModel(catalog);
  const wanted = query.trim().toLowerCase();

  const terms = lookupTerm(model.glossaries, query);

  const entities = model.entities
    .filter(
      (entity) => entity.id.toLowerCase() === wanted || entity.name.toLowerCase().includes(wanted),
    )
    .map(({ body, ...entity }) => ({ ...entity, ...(body && { description: body }) }));

  if (terms.length === 0 && entities.length === 0) {
    const known = [
      ...model.glossaries.flatMap((glossary) => glossary.terms.map((term) => term.name)),
      ...model.entities.map((entity) => entity.name),
    ];

    throw new Error(
      `Nothing here defines '${query}'. ${known.length > 0 ? `Defined: ${known.join(', ')}` : 'This checkout keeps no glossary/ or entities/.'}${model.failures.length > 0 ? `\nLeft out: ${model.failures.join('; ')}` : ''}`,
    );
  }

  return { terms, entities };
}
