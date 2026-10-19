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

export interface DomainsPageProps {
  domains: Array<{ name: string; href: string; events: number; services: number; owners: number }>;
}

export function DomainsPage({ domains }: DomainsPageProps) {
  return (
    <div className="not-content" data-wide>
      {domains.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="domain" />
            </EmptyMedia>
            <EmptyTitle>No event names a domain yet</EmptyTitle>
            <EmptyDescription>
              Publish an event with a <code>domain</code> in its manifest, and the domain appears
              here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Domains">
              <TableHeader>
                <TableHead isRowHeader>Domain</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Owners</TableHead>
              </TableHeader>
              <TableBody>
                {domains.map((domain) => (
                  <TableRow key={domain.href} id={domain.href}>
                    <TableCell>
                      <a
                        href={domain.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                        data-kind="domain"
                      >
                        {domain.name}
                      </a>
                    </TableCell>
                    <TableCell>{domain.events}</TableCell>
                    <TableCell>{domain.services}</TableCell>
                    <TableCell>{domain.owners}</TableCell>
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

export default DomainsPage;
