/** @jsxImportSource react */
import { useFieldValue } from '#ui/lib/field.ts';
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
import { Icon } from '../components/Icon';
import { IconTile } from '../components/IconTile';

export interface ServiceLink {
  label: string;
  href: string;
}

export interface ServicesPageRow {
  name: string;
  href: string;
  summary?: string | undefined;
  owner?: { team: string; href?: string | undefined } | undefined;
  domains: string[];
  /** The OpenAPI specs it serves. */
  apis: ServiceLink[];
  endpoints: number;
  /** Events it consumes. */
  receives: ServiceLink[];
  /** Events it produces. */
  sends: ServiceLink[];
  /** Other services it calls. */
  calls: ServiceLink[];
  /** Other services that call it. */
  calledBy?: ServiceLink[] | undefined;
}

export interface ServicesPageProps {
  services: ServicesPageRow[];
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

// A cell lists a few, and says how many more: the service's page has them all.
const SHOWN = 3;

function Links({ items, href, none }: { items: ServiceLink[]; href: string; none: string }) {
  if (items.length === 0) return <span className="text-muted-foreground">{none}</span>;

  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.slice(0, SHOWN).map((item) => (
        <li key={item.href}>
          <a className={link} href={item.href}>
            {item.label}
          </a>
        </li>
      ))}
      {items.length > SHOWN && (
        <li>
          <a className="text-muted-foreground" href={href}>
            {items.length - SHOWN} more
          </a>
        </li>
      )}
    </ul>
  );
}

const matches = (row: ServicesPageRow, query: string) =>
  [
    row.name,
    row.summary,
    row.owner?.team,
    ...row.domains,
    ...row.apis.map(({ label }) => label),
    ...row.receives.map(({ label }) => label),
    ...row.sends.map(({ label }) => label),
    ...row.calls.map(({ label }) => label),
    ...(row.calledBy ?? []).map(({ label }) => label),
  ].some((value) => value?.toLowerCase().includes(query));

/**
 * Every service, one row each: who owns it, the APIs it serves, the events it
 * receives, and what it sends or calls. Read from events and OpenAPI specs
 * alike, so a catalog with either has a full list.
 */
export function ServicesPage({ services }: ServicesPageProps) {
  const { value: query, field: queryField } = useFieldValue();

  const shown = query.trim()
    ? services.filter((row) => matches(row, query.trim().toLowerCase()))
    : services;

  if (services.length === 0) {
    return (
      <div className="not-content">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="service" />
            </EmptyMedia>
            <EmptyTitle>No services yet</EmptyTitle>
            <EmptyDescription>
              A service appears here once an event names it as a producer or consumer, or an OpenAPI
              spec under <code>contracts/</code> serves it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const unowned = services.filter((row) => !row.owner).length;

  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      <p className="m-0 max-w-prose">
        {plural(services.length, 'service', 'services')}
        {unowned > 0
          ? `, ${plural(unowned, 'with no owner', 'with no owner')} yet.`
          : ', each with an owner.'}
      </p>

      <InputGroup className="max-w-md">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Filter services"
          placeholder="Filter by service, owner, domain, API or event"
          autoComplete="off"
          {...queryField}
        />
      </InputGroup>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <p className="m-0 text-muted-foreground">No service matches “{query}”.</p>
          ) : (
            <Table aria-label="Services">
              <TableHeader>
                <TableHead id="service" isRowHeader>
                  Service
                </TableHead>
                <TableHead id="owner">Owner</TableHead>
                <TableHead id="serves">Serves</TableHead>
                <TableHead id="receives">Receives and is called by</TableHead>
                <TableHead id="sends">Sends and calls</TableHead>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow key={row.href} id={row.href}>
                    <TableCell id={`${row.href}:service`} className="align-top whitespace-normal">
                      <span className="flex items-start gap-3">
                        <IconTile name="service" />
                        <span className="flex min-w-0 flex-col gap-1">
                          <a className={`${link} font-medium`} href={row.href}>
                            {row.name}
                          </a>
                          {row.summary && (
                            <span className="text-muted-foreground">{row.summary}</span>
                          )}
                          {row.domains.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              In {row.domains.join(', ')}
                            </span>
                          )}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell id={`${row.href}:owner`} className="align-top whitespace-normal">
                      {row.owner ? (
                        row.owner.href ? (
                          <a className={link} href={row.owner.href}>
                            {row.owner.team}
                          </a>
                        ) : (
                          row.owner.team
                        )
                      ) : (
                        <span className="text-muted-foreground">Unowned</span>
                      )}
                    </TableCell>
                    <TableCell id={`${row.href}:serves`} className="align-top whitespace-normal">
                      <span className="flex flex-col gap-1">
                        <Links items={row.apis} href={row.href} none="No API" />
                        {row.endpoints > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {plural(row.endpoints, 'endpoint', 'endpoints')}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell id={`${row.href}:receives`} className="align-top whitespace-normal">
                      <Links
                        items={[
                          ...row.receives,
                          ...(row.calledBy ?? []).map((caller) => ({
                            ...caller,
                            label: `Called by ${caller.label}`,
                          })),
                        ]}
                        href={row.href}
                        none="Nothing"
                      />
                    </TableCell>
                    <TableCell id={`${row.href}:sends`} className="align-top whitespace-normal">
                      <Links
                        items={[
                          ...row.sends,
                          ...row.calls.map((call) => ({ ...call, label: `Calls ${call.label}` })),
                        ]}
                        href={row.href}
                        none="Nothing"
                      />
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

export default ServicesPage;
