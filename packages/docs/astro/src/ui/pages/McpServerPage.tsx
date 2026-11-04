/** @jsxImportSource react */
import type { ReactNode } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import type { McpChangeRow, McpServerRow } from '../../mcp-servers';

export interface McpServerPageProps {
  server: McpServerRow;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function Severity({ severity }: Pick<McpChangeRow, 'severity'>) {
  return <Badge variant={severity === 'breaking' ? 'destructive' : 'outline'}>{severity}</Badge>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const None = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-muted-foreground">{children}</p>
);

export function McpServerPage({ server }: McpServerPageProps) {
  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      {server.summary && <p className="m-0">{server.summary}</p>}
      <dl className="m-0 grid gap-2 text-sm">
        <Fact label="Origin">{server.origin}</Fact>
        <Fact label="Transport">{server.transport}</Fact>
        {server.endpoint && <Fact label="Endpoint">{server.endpoint}</Fact>}
        {server.versions.length > 0 && (
          <Fact label={server.versions.length > 1 ? 'Versions' : 'Version'}>
            {server.versions.join(', ')}
          </Fact>
        )}
        <Fact label="Owner">
          {server.owners.join(', ') || 'Not set'}{' '}
          {server.needsReview && <Badge variant="outline">Needs review</Badge>}
        </Fact>
        {server.builtIn.length > 0 && <Fact label="Built in">{server.builtIn.join(', ')}</Fact>}
      </dl>
      <Section title="Used by">
        {server.repositories.length + server.agents.length === 0 ? (
          <None>Nothing in the catalog says it uses this server.</None>
        ) : (
          <dl className="m-0 grid gap-2 text-sm">
            {server.repositories.length > 0 && (
              <Fact label="Repositories">{server.repositories.join(', ')}</Fact>
            )}
            {server.agents.length > 0 && <Fact label="Agents">{server.agents.join(', ')}</Fact>}
          </dl>
        )}
      </Section>
      <Section title="Tools">
        {server.tools.length === 0 ? (
          <None>
            {server.snapshotted
              ? 'This server offered no tools when last asked.'
              : 'Not known yet. Run ac agents snapshot to record what it offers.'}
          </None>
        ) : (
          <Table aria-label="Tools">
            <TableHeader>
              <TableHead isRowHeader>Tool</TableHead>
              <TableHead>Behaviour, as the server claims</TableHead>
            </TableHeader>
            <TableBody>
              {server.tools.map((tool) => (
                <TableRow key={tool.name}>
                  <TableCell>
                    <code>{tool.name}</code>
                  </TableCell>
                  <TableCell>{tool.behaviour ?? 'says nothing'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section title="Recent changes">
        {server.changes.length === 0 ? (
          <None>No changes recorded.</None>
        ) : (
          <Table aria-label="Recent changes">
            <TableHeader>
              <TableHead isRowHeader>Date</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Connection</TableHead>
            </TableHeader>
            <TableBody>
              {server.changes.map((change, index) => (
                <TableRow key={`${change.at}-${change.tool}-${change.summary}-${index}`}>
                  <TableCell>{change.at.slice(0, 10)}</TableCell>
                  <TableCell>
                    <code>{change.tool}</code>
                  </TableCell>
                  <TableCell>{change.summary}</TableCell>
                  <TableCell>
                    <Severity severity={change.severity} />
                  </TableCell>
                  <TableCell>{change.connection}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}

export default McpServerPage;
