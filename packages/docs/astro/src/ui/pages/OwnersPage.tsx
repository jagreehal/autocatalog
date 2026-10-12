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

export interface OwnersPageProps {
  /** One column per kind any team owns, in the order owners list them. */
  columns: Array<{ kind: string; heading: string }>;
  owners: Array<{
    name: string;
    href: string;
    /** How many resources of each kind the team owns; a kind it owns none of is absent. */
    counts: Record<string, number>;
  }>;
}

export function OwnersPage({ columns, owners }: OwnersPageProps) {
  return (
    <div className="not-content" data-wide>
      {owners.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="owners" />
            </EmptyMedia>
            <EmptyTitle>No resource declares an owner yet</EmptyTitle>
            <EmptyDescription>
              Add an <code>owner</code> to a document&apos;s or event&apos;s frontmatter, or a
              CODEOWNERS file to its repository, and the team appears here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Owners">
              <TableHeader>
                <TableHead isRowHeader>Team</TableHead>
                {columns.map(({ kind, heading }) => (
                  <TableHead key={kind}>{heading}</TableHead>
                ))}
              </TableHeader>
              <TableBody>
                {owners.map((owner) => (
                  <TableRow key={owner.href} id={owner.href}>
                    <TableCell>
                      <a
                        href={owner.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                        data-kind="owner"
                      >
                        {owner.name}
                      </a>
                    </TableCell>
                    {columns.map(({ kind }) => (
                      <TableCell key={kind}>
                        {owner.counts[kind] ?? (
                          <span className="text-muted-foreground">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">None</span>
                          </span>
                        )}
                      </TableCell>
                    ))}
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

export default OwnersPage;
