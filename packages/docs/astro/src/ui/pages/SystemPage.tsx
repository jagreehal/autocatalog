/** @jsxImportSource react */
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import { Badge } from '#ui/components/ui/badge.tsx';
import type { SystemRow } from '../../systems';

export interface SystemPageProps {
  system: SystemRow;
}

export function SystemPage({ system }: SystemPageProps) {
  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">{system.external ? 'external system' : 'system'}</Badge>
        {system.summary && <p className="m-0 max-w-prose">{system.summary}</p>}
      </div>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {system.members.length === 0 ? (
            <p className="m-0 text-muted-foreground">
              No members are nested under this system yet.
            </p>
          ) : (
            <ul className="m-0 list-disc pl-5">
              {system.members.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="m-0 text-sm">
        Declared in{' '}
        <a href={system.designHref} className="underline underline-offset-4">
          {system.designTitle}
        </a>
        .
      </p>
    </div>
  );
}

export default SystemPage;
