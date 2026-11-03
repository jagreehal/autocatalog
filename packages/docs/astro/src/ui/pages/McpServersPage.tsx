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
import type { McpServerRow } from '../../mcp-servers';

export interface McpServersPageProps {
  servers: McpServerRow[];
}

const count = (items: string[], one: string, many: string): string =>
  `${items.length} ${items.length === 1 ? one : many}`;

const usedBy = ({ repositories, agents }: McpServerRow): string => {
  const parts = [
    repositories.length > 0 && count(repositories, 'repository', 'repositories'),
    agents.length > 0 && count(agents, 'agent', 'agents'),
  ].filter(Boolean);

  return parts.join(', ') || '—';
};

export function McpServersPage({ servers }: McpServersPageProps) {
  return (
    <div className="not-content" data-wide>
      {servers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="mcp-server" />
            </EmptyMedia>
            <EmptyTitle>No MCP servers yet</EmptyTitle>
            <EmptyDescription>
              Run ac agents discover --from mcp in a repository, or ac mcp-sweep across an
              organisation.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="MCP servers">
              <TableHeader>
                <TableHead isRowHeader>Server</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Used by</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Last change</TableHead>
              </TableHeader>
              <TableBody>
                {servers.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell>
                      <a
                        href={server.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                        data-kind="mcp-server"
                      >
                        {server.title}
                      </a>
                      {server.endpoint && (
                        <div className="text-xs text-muted-foreground">{server.endpoint}</div>
                      )}
                    </TableCell>
                    <TableCell>{server.origin}</TableCell>
                    <TableCell>
                      {server.owners.join(', ') || '—'}{' '}
                      {server.needsReview && <Badge variant="outline">Needs review</Badge>}
                    </TableCell>
                    <TableCell>{usedBy(server)}</TableCell>
                    <TableCell>{server.snapshotted ? server.tools.length : '—'}</TableCell>
                    <TableCell>{server.changes[0]?.at.slice(0, 10) ?? '—'}</TableCell>
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

export default McpServersPage;
