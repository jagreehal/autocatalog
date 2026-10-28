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

export interface DesignsPageProps {
  designs: Array<{
    title: string;
    summary?: string | undefined;
    repository: string;
    status: string;
    /** What it adds to the catalog, in a line. */
    changes: string;
    href: string;
  }>;
}

export function DesignsPage({ designs }: DesignsPageProps) {
  return (
    <div className="not-content" data-wide>
      {designs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="design" />
            </EmptyMedia>
            <EmptyTitle>No designs yet</EmptyTitle>
            <EmptyDescription>
              Propose architecture as Markdown under a repository&apos;s <code>designs/</code>, its
              resources and relations in the frontmatter, and it appears here beside the catalog.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Designs">
              <TableHeader>
                <TableHead isRowHeader>Design</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Adds</TableHead>
              </TableHeader>
              <TableBody>
                {designs.map((design) => (
                  <TableRow key={design.href} id={design.href}>
                    <TableCell>
                      <a
                        href={design.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                      >
                        {design.title}
                      </a>
                      {design.summary && (
                        <p className="m-0 mt-1 text-muted-foreground">{design.summary}</p>
                      )}
                    </TableCell>
                    <TableCell>{design.repository}</TableCell>
                    <TableCell>{design.status}</TableCell>
                    <TableCell>{design.changes}</TableCell>
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

export default DesignsPage;
