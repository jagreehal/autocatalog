/** @jsxImportSource react */
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import type { PropNode } from '../lib/schema-tree';
import { EventVersions, type EventVersionsProps } from '../components/EventVersions';
import { Examples, type ExampleView } from '../components/Examples';
import { SchemaSection } from '../components/SchemaTree';
import { StatusBanners } from '../components/StatusBanners';
import type { StatusBanner } from '../../resource-status';

export interface EventVersionPageProps {
  /** The version this page shows, as the folder names it. */
  version: string;
  /** The version the event is at now, when it has one to point to. */
  current?: { href: string; version: string } | undefined;
  /** What changed since the previous version, as HTML from the changelog. */
  changesHtml?: string | null | undefined;
  /** Banners for earlier version / newer available. */
  banners?: StatusBanner[] | undefined;
  /** The schema's properties, built by `schemaTree`. */
  schema: PropNode[];
  schemaHref: string;
  examples: ExampleView[];
  versions: EventVersionsProps['versions'];
}

export function EventVersionPage({
  version,
  current,
  changesHtml,
  banners = [],
  schema,
  schemaHref,
  examples,
  versions,
}: EventVersionPageProps) {
  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      <StatusBanners
        banners={
          banners.length > 0
            ? banners
            : current
              ? [
                  {
                    tone: 'info',
                    title: 'Earlier version',
                    body: `This is version ${version}. The current version is`,
                    href: current.href,
                    linkLabel: current.version,
                  },
                ]
              : []
        }
      />

      {changesHtml && (
        <Card id="changes" data-schema-diff="">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              What changed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div dangerouslySetInnerHTML={{ __html: changesHtml }} />
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SchemaSection
          nodes={schema}
          href={schemaHref}
          note="schema.json is the contract at this version."
        />

        <div className="flex flex-col gap-6">
          <Examples examples={examples} />
          <EventVersions versions={versions} />
        </div>
      </div>
    </div>
  );
}

export default EventVersionPage;
