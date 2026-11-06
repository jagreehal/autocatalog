/** @jsxImportSource react */
import type { ReactNode } from 'react';
import { LinkButton } from '#ui/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { Code } from '../components/Code';
import type { ComponentRow } from '../../components';

export interface ComponentPageProps {
  component: ComponentRow;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">{children}</div>
      </CardContent>
    </Card>
  );
}

export function ComponentPage({ component }: ComponentPageProps) {
  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      <p className="m-0 text-sm text-muted-foreground">
        {'Owned by '}
        {component.owner?.href ? (
          <a
            href={component.owner.href}
            className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
          >
            {component.owner.team}
          </a>
        ) : (
          (component.owner?.team ?? 'nobody yet')
        )}
      </p>
      {component.alsoIn.length > 0 && (
        <p className="m-0 text-sm text-muted-foreground">
          {`A component of this name is also in ${component.alsoIn.join(', ')}.`}
        </p>
      )}
      {component.import && <Code code={component.import} language="typescript" label="Import" />}
      {component.props.length > 0 && (
        <Section title="Props">
          <Table aria-label="Props">
            <TableHeader>
              <TableHead isRowHeader>Prop</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Required</TableHead>
            </TableHeader>
            <TableBody>
              {component.props.map((prop) => (
                <TableRow key={prop.name}>
                  <TableCell>
                    <code>{prop.name}</code>
                    {prop.description && (
                      <div className="text-xs text-muted-foreground">{prop.description}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="wrap-anywhere">{prop.type ?? 'unknown'}</code>
                  </TableCell>
                  <TableCell>{prop.required ? 'Yes' : 'No'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
      <Section title="Stories">
        {component.stories.map((story) => (
          <div className="flex flex-col gap-2" key={story.id}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">{story.name}</div>
                {story.description && (
                  <div className="text-sm text-muted-foreground">{story.description}</div>
                )}
              </div>
              {story.href && (
                <LinkButton variant="outline" size="sm" href={story.href}>
                  {`Open in ${component.viewer ?? 'viewer'}`}
                </LinkButton>
              )}
            </div>
            {story.snippet && (
              <Code code={story.snippet} language="typescript" label={`${story.name} usage`} />
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}

export default ComponentPage;
