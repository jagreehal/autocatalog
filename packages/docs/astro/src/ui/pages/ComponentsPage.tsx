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
import type { ComponentRow } from '../../components';

export interface ComponentsPageProps {
  components: ComponentRow[];
}

export function ComponentsPage({ components }: ComponentsPageProps) {
  return (
    <div className="not-content" data-wide>
      {components.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="component" />
            </EmptyMedia>
            <EmptyTitle>No components yet</EmptyTitle>
            <EmptyDescription>
              Commit an autocatalog.components.json in a repository. A plugin can write it for you.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Components">
              <TableHeader>
                <TableHead isRowHeader>Component</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Stories</TableHead>
              </TableHeader>
              <TableBody>
                {components.map((component) => (
                  <TableRow key={component.href}>
                    <TableCell>
                      <a
                        href={component.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                      >
                        {component.name}
                      </a>
                      {component.description && (
                        <div className="max-w-xl text-xs whitespace-normal text-muted-foreground">
                          {component.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {component.repository}{' '}
                      {component.alsoIn.length > 0 && (
                        <Badge variant="outline">{`Also in ${component.alsoIn.join(', ')}`}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{component.owner?.team ?? 'Not set'}</TableCell>
                    <TableCell>{component.stories.length}</TableCell>
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

export default ComponentsPage;
