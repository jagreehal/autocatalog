/** @jsxImportSource react */
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import type { ChannelRow } from '../../channels';

export interface ChannelPageProps {
  channel: ChannelRow;
}

export function ChannelPage({ channel }: ChannelPageProps) {
  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Bindings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {channel.bindings.length === 0 ? (
            <p className="m-0 text-muted-foreground">No services are bound to this channel yet.</p>
          ) : (
            <ul className="m-0 list-disc pl-5">
              {channel.bindings.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <dl className="m-0 grid gap-2 text-sm">
        <div className="flex gap-4">
          <dt className="w-24 text-muted-foreground">Source</dt>
          <dd className="m-0">{channel.source}</dd>
        </div>
        {channel.system && (
          <div className="flex gap-4">
            <dt className="w-24 text-muted-foreground">System</dt>
            <dd className="m-0">{channel.system}</dd>
          </div>
        )}
        {channel.designHref && (
          <div className="flex gap-4">
            <dt className="w-24 text-muted-foreground">Design</dt>
            <dd className="m-0">
              <a href={channel.designHref} className="underline underline-offset-4">
                Open design
              </a>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default ChannelPage;
