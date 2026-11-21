import { lookupTerm, readDomainModel } from 'autocatalog-docs-core';
import { checkouts } from './knowledge.js';
import type { CatalogSnapshot } from './tools.js';

/** The domain model this checkout keeps: glossary, entities, data products, teams and users. */
export function domainModel(catalog: CatalogSnapshot, company?: string, graph = catalog.mapGraph) {
  return readDomainModel(checkouts(catalog, company), graph, {
    deferMissing: company !== undefined,
    // Company mode reads every checkout: drop a product whose pinned input no one
    // publishes, so an input resolves to the provider the site and consumer CI pick.
    deferUnpublished: false,
    schemaOf: (event) =>
      catalog.events.find(
        ({ frontmatter }) =>
          frontmatter.id === event.ref.id &&
          event.ref.namespace?.split('/').at(-1) === frontmatter.domain,
      )?.schema,
  });
}

/**
 * What a word means here: the glossary terms that match it, and the entities
 * named for it with their properties and the events that carry them.
 */
export function define(catalog: CatalogSnapshot, query: string, company?: string) {
  const model = domainModel(catalog, company);
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

/**
 * What a data product promises through its ODCS contracts, as an agent needs
 * it before using the data: each output's schema, service levels with their
 * track record, terms of use, and the AI context (instructions, constraints,
 * and the verified statements with the queries the provider vouches for);
 * and what the product itself expects of its inputs. Without an id, the
 * data products that have contracts.
 */
export function dataContract(catalog: CatalogSnapshot, id: string | undefined, company?: string) {
  const { dataProducts, failures } = domainModel(catalog, company);

  const withContracts = dataProducts.filter((p) =>
    [...p.inputs, ...p.outputs].some((port) => port.odcs),
  );

  if (id === undefined) {
    return {
      dataProducts: withContracts.map((p) => ({
        id: p.id,
        name: p.name,
        repository: p.repository,
        contracts: p.outputs.flatMap((port) =>
          port.odcs
            ? [
                `${port.odcs.id} ${port.odcs.version}${port.odcs.status ? ` (${port.odcs.status})` : ''}`,
              ]
            : [],
        ),
      })),
    };
  }

  const product = dataProducts.find((p) => p.id === id);

  if (!product) {
    const failure = failures.find((line) => line.includes(`/data-products/${id}.md:`));

    throw new Error(
      failure ??
        `No data product '${id}' under data-products/. With contracts: ${withContracts.map((p) => p.id).join(', ') || 'none'}`,
    );
  }

  return {
    id: product.id,
    name: product.name,
    repository: product.repository,
    file: product.file,
    promises: product.outputs.flatMap(({ reference, contract, odcs, trackRecord }) =>
      odcs ? [{ output: reference, contract, ...odcs, ...(trackRecord && { trackRecord }) }] : [],
    ),
    expects: product.inputs.flatMap(({ reference, contract, odcs }) =>
      odcs
        ? [
            {
              input: reference,
              contract,
              objects: odcs.objects,
              serviceLevels: odcs.slas,
              document: odcs.document,
            },
          ]
        : [],
    ),
  };
}
