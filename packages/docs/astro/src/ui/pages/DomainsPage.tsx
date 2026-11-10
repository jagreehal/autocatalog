/** @jsxImportSource react */
import { SearchIcon } from 'lucide-react';
import { Card, CardContent } from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/components/ui/input-group.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { useFieldValue } from '#ui/lib/field.ts';
import { Icon } from '../components/Icon';
import { SectionHeading } from '../components/SectionHeading';

export interface DomainsPageProps {
  domains: Array<{ name: string; href: string; events: number; services: number; owners: number }>;
}

export function DomainsPage({ domains }: DomainsPageProps) {
  const { value: query, field } = useFieldValue();

  const shown = query.trim()
    ? domains.filter((domain) => domain.name.toLowerCase().includes(query.trim().toLowerCase()))
    : domains;

  if (domains.length === 0) {
    return (
      <div className="not-content">
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
      </div>
    );
  }

  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      <SectionHeading
        id="domains-list"
        count={`${domains.length.toLocaleString('en-GB')} ${domains.length === 1 ? 'domain' : 'domains'}`}
      >
        Domains
      </SectionHeading>

      <InputGroup className="max-w-md">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Filter domains"
          placeholder="Filter by domain"
          autoComplete="off"
          {...field}
        />
      </InputGroup>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <p className="m-0 text-muted-foreground">No domain matches “{query}”.</p>
          ) : (
            <Table aria-label="Domains">
              <TableHeader>
                <TableHead id="domain" isRowHeader>
                  Domain
                </TableHead>
                <TableHead id="events">Events</TableHead>
                <TableHead id="services">Services</TableHead>
                <TableHead id="owners">Owners</TableHead>
              </TableHeader>
              <TableBody>
                {shown.map((domain) => (
                  <TableRow key={domain.href} id={domain.href}>
                    <TableCell id={`${domain.href}:domain`}>
                      <a
                        href={domain.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                        data-kind="domain"
                      >
                        {domain.name}
                      </a>
                    </TableCell>
                    <TableCell id={`${domain.href}:events`}>
                      {domain.events.toLocaleString('en-GB')}
                    </TableCell>
                    <TableCell id={`${domain.href}:services`}>
                      {domain.services.toLocaleString('en-GB')}
                    </TableCell>
                    <TableCell id={`${domain.href}:owners`}>
                      {domain.owners.toLocaleString('en-GB')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default DomainsPage;
