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
import type { ChannelRow } from '../../channels';

export interface ChannelsPageProps {
  channels: ChannelRow[];
}

export function ChannelsPage({ channels }: ChannelsPageProps) {
  return (
    <div className="not-content" data-wide>
      {channels.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="channel" />
            </EmptyMedia>
            <EmptyTitle>No channels yet</EmptyTitle>
            <EmptyDescription>
              Queues seen at runtime and channels drawn in designs appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Channels">
              <TableHeader>
                <TableHead isRowHeader>Channel</TableHead>
                <TableHead>System</TableHead>
                <TableHead>Bindings</TableHead>
                <TableHead>Source</TableHead>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell>
                      <a
                        href={channel.href}
                        className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                        data-kind="channel"
                      >
                        {channel.id}
                      </a>
                    </TableCell>
                    <TableCell>{channel.system ?? '—'}</TableCell>
                    <TableCell>{channel.bindings.join(', ') || '—'}</TableCell>
                    <TableCell>
                      {channel.designHref ? (
                        <a href={channel.designHref} className="underline underline-offset-4">
                          {channel.source}
                        </a>
                      ) : (
                        channel.source
                      )}
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

export default ChannelsPage;
