/** @jsxImportSource react */
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
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
import { BigPicture, type BigPictureLaneView } from '../components/Storm';

export interface FlowsPageProps {
  /** Every flow as a lane of facts, so the processes read side by side. */
  bigPicture?: BigPictureLaneView[] | undefined;
  flows: Array<{
    title: string;
    summary?: string | undefined;
    repository: string;
    steps: number;
    href: string;
  }>;
}

export function FlowsPage({ flows, bigPicture = [] }: FlowsPageProps) {
  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      {flows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="flow" />
            </EmptyMedia>
            <EmptyTitle>No flows yet</EmptyTitle>
            <EmptyDescription>
              Write a business process as Markdown under a repository&apos;s <code>flows/</code>,
              its steps in the frontmatter, and it appears here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Flows">
              <TableHeader>
                <TableHead isRowHeader>Flow</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Steps</TableHead>
              </TableHeader>
              <TableBody>
                {flows.map((flow) => (
                  <TableRow key={flow.href} id={flow.href}>
                    <TableCell>
                      <a
                        href={flow.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                      >
                        {flow.title}
                      </a>
                      {flow.summary && (
                        <p className="m-0 mt-1 text-muted-foreground">{flow.summary}</p>
                      )}
                    </TableCell>
                    <TableCell>{flow.repository}</TableCell>
                    <TableCell>{flow.steps}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {bigPicture.length > 0 && (
        <Card id="big-picture">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Big picture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BigPicture lanes={bigPicture} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default FlowsPage;
