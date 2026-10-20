import {
  assessRetirement,
  consumersFromGraph,
  deprecatedFields,
  type DeclaredConsumers,
} from 'autocatalog-core';
import type { DocsCatalog } from './catalog';
import { serviceLinks } from './data-models';
import { eventPath } from './event-path';
import type { RetirementsPageProps } from './ui/pages';

/**
 * Every retirement under way across the company: each deprecated event, and
 * each field a schema marks `deprecated`, with where its consumers stand. The
 * evidence is what each repository's default branch declares and what its
 * snapshot saw, as of this build.
 */
export function retirementsPageProps(catalog: DocsCatalog, base: string): RetirementsPageProps {
  const byRepository = new Map<string, ReturnType<typeof consumersFromGraph>['consumers']>();

  const consumersOf = (repository: string) => {
    const known = byRepository.get(repository);

    if (known) return known;

    const found = consumersFromGraph(catalog.graph, { repository }).consumers;

    byRepository.set(repository, found);

    return found;
  };

  const serviceLink = serviceLinks(catalog.events, base);

  return {
    retirements: catalog.events.flatMap((entry) => {
      const fm = entry.event.frontmatter;
      const key = `${fm.domain}/${fm.id}`;
      const fields = deprecatedFields(entry.event.schema);
      const deprecated = fm.status === 'deprecated' || fm.deprecation !== undefined;

      if (!deprecated && fields.length === 0) return [];

      const elsewhere = consumersOf(entry.repository).get(key);

      // Each consumer's own word counts beside the producer's.
      const declared: DeclaredConsumers[] = [
        { source: entry.repository, consumers: fm.consumers, fields: fm.consumerFields ?? {} },
        ...(elsewhere
          ? [
              {
                source: 'the company graph',
                consumers: elsewhere.consumers,
                fields: { ...elsewhere.fields, ...elsewhere.own },
              },
            ]
          : []),
      ];

      const runtime = fm.observed && {
        source: `snapshot, last seen ${fm.observed.lastSeen.slice(0, 10)}`,
        consumers: fm.observed.consumers,
      };

      const href = `${base}${eventPath(entry)}`;

      return [...(deprecated ? [undefined] : []), ...fields].map((field) => {
        const retirement = assessRetirement({
          event: key,
          ...(field !== undefined && { field }),
          declared,
          ...(runtime && { runtime }),
        });

        return {
          ...retirement,
          name: fm.name,
          repository: entry.repository,
          href,
          ...(field === undefined && fm.deprecation && { since: fm.deprecation.since }),
          consumers: retirement.consumers.map((consumer) => ({
            ...consumer,
            href: serviceLink(consumer.consumer).href,
          })),
        };
      });
    }),
  };
}
