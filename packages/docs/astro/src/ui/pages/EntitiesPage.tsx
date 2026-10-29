/** @jsxImportSource react */
import { Badge } from '#ui/components/ui/badge.tsx';
import { Card, CardContent } from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { Icon } from '../components/Icon';

export interface EntitiesPageProps {
  /** How the entities reference each other, as Mermaid, when any do. */
  diagram: string | null;
  entities: Array<{
    name: string;
    summary?: string | undefined;
    repository: string;
    domains: string[];
    aggregateRoot: boolean;
    properties: number;
    href: string;
  }>;
}

export function EntitiesPage({ diagram, entities }: EntitiesPageProps) {
  if (entities.length === 0) {
    return (
      <div className="not-content">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="entity" />
            </EmptyMedia>
            <EmptyTitle>No entities yet</EmptyTitle>
            <EmptyDescription>
              Describe a thing your domain talks about in <code>entities/&lt;id&gt;.md</code>, with
              its properties or the JSON Schema they come from, and it appears here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-wide>
      {diagram && <pre className="mermaid not-content">{diagram}</pre>}
      <div className="not-content">
        <Card>
          <CardContent>
            <Table aria-label="Entities">
              <TableHeader>
                <TableHead isRowHeader>Entity</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Properties</TableHead>
              </TableHeader>
              <TableBody>
                {entities.map((entity) => (
                  <TableRow key={entity.href} id={entity.href}>
                    <TableCell>
                      <a
                        href={entity.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                      >
                        {entity.name}
                      </a>{' '}
                      {entity.aggregateRoot && <Badge variant="secondary">Aggregate root</Badge>}
                      {entity.summary && (
                        <p className="m-0 mt-1 text-muted-foreground">{entity.summary}</p>
                      )}
                    </TableCell>
                    <TableCell>{entity.domains.join(', ')}</TableCell>
                    <TableCell>{entity.repository}</TableCell>
                    <TableCell>{entity.properties}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default EntitiesPage;
