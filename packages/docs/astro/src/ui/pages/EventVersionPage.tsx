/** @jsxImportSource react */
import { InfoIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert.tsx';
import type { PropNode } from '../lib/schema-tree';
import { EventVersions, type EventVersionsProps } from '../components/EventVersions';
import { Examples, type ExampleView } from '../components/Examples';
import { SchemaSection } from '../components/SchemaTree';

export interface EventVersionPageProps {
  /** The version this page shows, as the folder names it. */
  version: string;
  /** The version the event is at now, when it has one to point to. */
  current?: { href: string; version: string } | undefined;
  /** The schema's properties, built by `schemaTree`. */
  schema: PropNode[];
  schemaHref: string;
  examples: ExampleView[];
  versions: EventVersionsProps['versions'];
  changesHtml?: string | null | undefined;
}

export function EventVersionPage({
  version,
  current,
  schema,
  schemaHref,
  examples,
  versions,
  changesHtml,
}: EventVersionPageProps) {
  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      {current && (
        <Alert>
          <InfoIcon />
          <AlertTitle>Earlier version</AlertTitle>
          <AlertDescription>
            This is version {version}. The current version is{' '}
            <a className="text-foreground" href={current.href}>
              {current.version}
            </a>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SchemaSection
          nodes={schema}
          href={schemaHref}
          note="schema.json is the contract at this version."
        />

        <div className="flex flex-col gap-6">
          <Examples examples={examples} />
          <EventVersions versions={versions} changesHtml={changesHtml} />
        </div>
      </div>
    </div>
  );
}

export default EventVersionPage;
