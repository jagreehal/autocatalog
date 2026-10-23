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

export interface SpecificationsPageProps {
  specifications: Array<{
    title: string;
    format: string;
    repository: string;
    file: string;
    href: string;
  }>;
}

export function SpecificationsPage({ specifications }: SpecificationsPageProps) {
  return (
    <div className="not-content" data-wide>
      {specifications.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="braces" />
            </EmptyMedia>
            <EmptyTitle>No specifications yet</EmptyTitle>
            <EmptyDescription>
              Commit a WSDL, XML Schema, GraphQL or AsyncAPI document under a repository&apos;s{' '}
              <code>contracts/</code>, and it appears here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Specifications">
              <TableHeader>
                <TableHead isRowHeader>Specification</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>File</TableHead>
              </TableHeader>
              <TableBody>
                {specifications.map((spec) => (
                  <TableRow key={spec.href} id={spec.href}>
                    <TableCell>
                      <a
                        href={spec.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                      >
                        {spec.title}
                      </a>
                    </TableCell>
                    <TableCell>{spec.format}</TableCell>
                    <TableCell>{spec.repository}</TableCell>
                    <TableCell>
                      <code>{spec.file}</code>
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

export default SpecificationsPage;
