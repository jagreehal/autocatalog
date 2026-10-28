/** @jsxImportSource react */
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
import { Graph } from '../components/Graph';
import type { VisualiserGraph } from '../lib/visualiser';

export interface DesignPageProps {
  repository: string;
  /** Where the repository keeps it. */
  file: string;
  status: 'draft' | 'proposed' | 'accepted' | 'rejected';
  /** What it adds to the catalog, in a line. */
  changes: string;
  visualiser: VisualiserGraph;
  resources: Array<{
    id: string;
    name: string;
    type: string;
    summary?: string | undefined;
    state: 'catalog' | 'new';
    href?: string | undefined;
  }>;
  relations: Array<{ from: string; to: string; kind: string; state: 'catalog' | 'new' }>;
  notes: Array<{ text: string; on?: string | undefined }>;
  /** The Markdown below the frontmatter, rendered to HTML. */
  narrativeHtml?: string | null | undefined;
}

const State = ({ state }: { state: 'catalog' | 'new' }) =>
  state === 'new' ? (
    <Badge variant="outline">New</Badge>
  ) : (
    <Badge variant="secondary">In catalog</Badge>
  );

function Parts({ resources }: Pick<DesignPageProps, 'resources'>) {
  return (
    <Table aria-label="Resources">
      <TableHeader>
        <TableHead isRowHeader>Resource</TableHead>
        <TableHead>Kind</TableHead>
        <TableHead>State</TableHead>
      </TableHeader>
      <TableBody>
        {resources.map((part) => (
          <TableRow key={part.id} id={part.id}>
            <TableCell>
              {part.href ? (
                <a
                  href={part.href}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {part.name}
                </a>
              ) : (
                <span className="font-medium">{part.name}</span>
              )}
              {part.summary && <p className="m-0 mt-1 text-muted-foreground">{part.summary}</p>}
            </TableCell>
            <TableCell>{part.type}</TableCell>
            <TableCell>
              <State state={part.state} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Architecture a team proposes: the map at three levels with what is new
 * drawn in outline, then each part and relation against the catalog.
 */
export function DesignPage({
  repository,
  file,
  status,
  changes,
  visualiser,
  resources,
  relations,
  notes,
  narrativeHtml,
}: DesignPageProps) {
  return (
    <div className="flex flex-col gap-8" data-wide>
      <div className="not-content flex flex-wrap items-center gap-3">
        <Badge>{status}</Badge>
        <p className="m-0 max-w-prose">
          {changes}. Declared in <code>{file}</code> in the {repository} repository.
        </p>
      </div>

      <Graph
        id="design"
        label="Design"
        visualiser={visualiser}
        height="30rem"
        fallback={<Parts resources={resources} />}
      />

      <div className="not-content flex flex-col gap-4">
        <Card id="resources">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Resources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Parts resources={resources} />
          </CardContent>
        </Card>

        {relations.length > 0 && (
          <Card id="relations">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Relations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table aria-label="Relations">
                <TableHeader>
                  <TableHead isRowHeader>Relation</TableHead>
                  <TableHead>State</TableHead>
                </TableHeader>
                <TableBody>
                  {relations.map((relation) => (
                    <TableRow key={`${relation.from} ${relation.kind} ${relation.to}`}>
                      <TableCell>
                        {relation.from} {relation.kind} {relation.to}
                      </TableCell>
                      <TableCell>
                        <State state={relation.state} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {notes.length > 0 && (
          <Card id="notes">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="m-0 flex flex-col gap-2 pl-4">
                {notes.map((note) => (
                  <li key={`${note.on ?? ''}${note.text}`}>
                    {note.on && <span className="font-medium">{note.on}: </span>}
                    {note.text}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {narrativeHtml && <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />}
    </div>
  );
}

export default DesignPage;
