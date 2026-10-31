/** @jsxImportSource react */
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
import { Badge } from '#ui/components/ui/badge.tsx';
import { Icon } from '../components/Icon';
import type { SystemRow } from '../../systems';

export interface SystemsPageProps {
  systems: SystemRow[];
}

export function SystemsPage({ systems }: SystemsPageProps) {
  return (
    <div className="not-content" data-wide>
      {systems.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="architecture" />
            </EmptyMedia>
            <EmptyTitle>No systems yet</EmptyTitle>
            <EmptyDescription>
              Name a system or external system in a design, and it appears here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Systems">
              <TableHeader>
                <TableHead isRowHeader>System</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Design</TableHead>
              </TableHeader>
              <TableBody>
                {systems.map((system) => (
                  <TableRow key={system.id}>
                    <TableCell>
                      <a
                        href={system.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                        data-kind="system"
                      >
                        {system.name}
                      </a>
                      {system.summary && (
                        <p className="m-0 mt-1 text-sm text-muted-foreground">{system.summary}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{system.external ? 'external' : 'system'}</Badge>
                    </TableCell>
                    <TableCell>{system.members.join(', ') || '—'}</TableCell>
                    <TableCell>
                      <a href={system.designHref} className="underline underline-offset-4">
                        {system.designTitle}
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default SystemsPage;
