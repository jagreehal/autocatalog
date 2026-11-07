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
import { Icon } from '../components/Icon';

export interface ApisPageProps {
  apis: Array<{
    title: string;
    version?: string | undefined;
    repository: string;
    file: string;
    href: string;
    operations: number;
  }>;
  /** Read outside the company, where the repository and file mean nothing. */
  outside?: boolean | undefined;
}

export function ApisPage({ apis, outside = false }: ApisPageProps) {
  return (
    <div className="not-content" data-wide>
      {apis.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="api" />
            </EmptyMedia>
            <EmptyTitle>No API specs yet</EmptyTitle>
            <EmptyDescription>
              Commit an OpenAPI 3 document under a repository&apos;s <code>contracts/</code>, and
              its reference appears here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="APIs">
              <TableHeader>
                <TableHead isRowHeader>API</TableHead>
                <TableHead>Version</TableHead>
                {!outside && <TableHead>Repository</TableHead>}
                {!outside && <TableHead>Spec</TableHead>}
                <TableHead>Operations</TableHead>
              </TableHeader>
              <TableBody>
                {apis.map((api) => (
                  <TableRow key={api.href} id={api.href}>
                    <TableCell>
                      <a
                        href={api.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                      >
                        {api.title}
                      </a>
                    </TableCell>
                    <TableCell>{api.version && <code>{api.version}</code>}</TableCell>
                    {!outside && <TableCell>{api.repository}</TableCell>}
                    {!outside && (
                      <TableCell>
                        <code>{api.file}</code>
                      </TableCell>
                    )}
                    <TableCell>{api.operations}</TableCell>
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

export default ApisPage;
