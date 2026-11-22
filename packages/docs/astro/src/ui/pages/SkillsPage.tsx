/** @jsxImportSource react */
import { Badge } from '#ui/components/ui/badge.tsx';
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
import type { PluginRow, SkillLink, SkillRow, SkillsView } from '../../skills';

export type SkillsPageProps = SkillsView;

const FORMAT: Record<SkillRow['format'], string> = {
  skill: 'Skill',
  command: 'Command',
  'cursor-rule': 'Cursor rule',
};

const link = 'text-foreground underline-offset-4 hover:underline';

const Links = ({ items }: { items: SkillLink[] }) =>
  items.length === 0 ? (
    '—'
  ) : (
    <span className="flex flex-wrap gap-x-2">
      {items.map((item) =>
        item.href ? (
          <a key={item.label} href={item.href} className={link}>
            {item.label}
          </a>
        ) : (
          <span key={item.label}>{item.label}</span>
        ),
      )}
    </span>
  );

const Codes = ({ items }: { items: string[] }) =>
  items.length === 0 ? (
    '—'
  ) : (
    <span className="flex flex-wrap gap-1">
      {items.map((item) => (
        <code key={item} className="text-xs">
          {item}
        </code>
      ))}
    </span>
  );

const Title = ({
  anchor,
  title,
  summary,
}: {
  anchor: string;
  title: string;
  summary?: string | undefined;
}) => (
  <>
    <span id={anchor} className="scroll-mt-20 font-medium text-foreground">
      {title}
    </span>
    {summary && <p className="m-0 mt-1 line-clamp-2 text-muted-foreground">{summary}</p>}
  </>
);

const Owners = ({ owners, needsReview }: { owners: string[]; needsReview: boolean }) => (
  <>
    {owners.join(', ') || '—'} {needsReview && <Badge variant="outline">Needs review</Badge>}
  </>
);

const ships = ({ skills, agents, commands }: PluginRow): string =>
  [
    skills.length > 0 && `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`,
    agents.length > 0 && `${agents.length} ${agents.length === 1 ? 'subagent' : 'subagents'}`,
    commands.length > 0 && `${commands.length} ${commands.length === 1 ? 'command' : 'commands'}`,
  ]
    .filter(Boolean)
    .join(', ') || '—';

/**
 * The skills, commands, rules and coding-agent plugins teams commit. What a
 * reviewer looks for is what each may do unasked: allowed tools, hooks, servers.
 */
export function SkillsPage({ plugins, skills }: SkillsPageProps) {
  if (plugins.length === 0 && skills.length === 0) {
    return (
      <div className="not-content">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="skill" />
            </EmptyMedia>
            <EmptyTitle>No skills or plugins yet</EmptyTitle>
            <EmptyDescription>
              Run ac agents discover --from skills in a repository, or ac mcp-sweep across an
              organisation.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      {plugins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle id="plugins" role="heading" aria-level={2}>
              Plugins
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table aria-label="Plugins">
              <TableHeader>
                <TableHead isRowHeader>Plugin</TableHead>
                <TableHead>Ships</TableHead>
                <TableHead>Hooks</TableHead>
                <TableHead>MCP servers</TableHead>
                <TableHead>Turned on in</TableHead>
                <TableHead>Owner</TableHead>
              </TableHeader>
              <TableBody>
                {plugins.map((plugin) => (
                  <TableRow key={plugin.anchor}>
                    <TableCell className="min-w-64 whitespace-normal">
                      <Title {...plugin} />
                      <div className="text-xs text-muted-foreground">
                        {[
                          plugin.version && `v${plugin.version}`,
                          plugin.marketplace && `in ${plugin.marketplace}`,
                          plugin.source ??
                            (plugin.builtIn.length > 0 && `built in ${plugin.builtIn.join(', ')}`),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </TableCell>
                    <TableCell>
                      {ships(plugin)}
                      {plugin.skills.length > 0 && (
                        <div className="text-xs">
                          <Links items={plugin.skills} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Codes items={plugin.hooks} />
                    </TableCell>
                    <TableCell>
                      <Links items={plugin.servers} />
                    </TableCell>
                    <TableCell>{plugin.usedBy.join(', ') || '—'}</TableCell>
                    <TableCell>
                      <Owners {...plugin} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {skills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle id="skills" role="heading" aria-level={2}>
              Skills, commands and rules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table aria-label="Skills">
              <TableHeader>
                <TableHead isRowHeader>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Allowed tools</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Owner</TableHead>
              </TableHeader>
              <TableBody>
                {skills.map((skill) => (
                  <TableRow key={skill.anchor}>
                    <TableCell className="min-w-64 whitespace-normal">
                      <Title {...skill} />
                    </TableCell>
                    <TableCell>{FORMAT[skill.format]}</TableCell>
                    <TableCell>
                      <Codes items={skill.allowedTools} />
                    </TableCell>
                    <TableCell>
                      {skill.plugin ? <Links items={[skill.plugin]} /> : (skill.repository ?? '—')}
                    </TableCell>
                    <TableCell>
                      <Owners {...skill} />
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

export default SkillsPage;
