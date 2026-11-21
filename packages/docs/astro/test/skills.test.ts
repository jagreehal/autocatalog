import { AUTOCATALOG_GRAPH_SPEC, type AgentSystemCatalogResource } from 'autocatalog-core';
import { expect, it } from 'vitest';
import { buildSkills } from '../src/skills';

const resource = (
  ref: AgentSystemCatalogResource['ref'],
  title: string,
  attributes: AgentSystemCatalogResource['attributes'],
): AgentSystemCatalogResource => ({
  ref,
  title,
  owner: { team: 'review-needed' },
  tags: [],
  provenance: { default: 'inferred', fields: {} },
  needsReview: true,
  attributes,
});

it('lists plugins with what they ship and who turns them on, and skills with where they come from', () => {
  const plugin = resource({ kind: 'agent-plugin', id: 'review' }, 'review', {
    hooks: ['PreToolUse'],
    servers: ['linear-app', 'unlisted'],
    agents: ['reviewer'],
  });

  const shipped = resource({ kind: 'skill', id: 'review-checklist' }, 'checklist', {});

  const own = resource({ kind: 'skill', namespace: 'payments', id: 'release' }, 'release', {
    format: 'command',
    allowed_tools: ['Bash(git:*)'],
  });

  const server = resource({ kind: 'mcp-server', id: 'linear-app' }, 'Linear', {});

  const evidence = { provenance: 'inferred' as const, needsReview: true };

  const { plugins, skills } = buildSkills(
    {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [plugin, shipped, own, server],
      relationships: [
        { type: 'defines', from: plugin.ref, to: shipped.ref, ...evidence },
        { type: 'defines', from: { kind: 'repository', id: 'tools' }, to: plugin.ref, ...evidence },
        {
          type: 'usesPlugin',
          from: { kind: 'repository', id: 'payments' },
          to: plugin.ref,
          ...evidence,
        },
      ],
    },
    '/docs/',
  );

  expect(plugins).toEqual([
    expect.objectContaining({
      title: 'review',
      hooks: ['PreToolUse'],
      agents: ['reviewer'],
      skills: [{ label: 'checklist', href: '/docs/skills/#resource-skill%3Areview-checklist' }],
      servers: [
        { label: 'Linear', href: '/docs/mcp-servers/linear-app/' },
        { label: 'unlisted', href: undefined },
      ],
      builtIn: ['tools'],
      usedBy: ['payments'],
      owners: [],
    }),
  ]);

  expect(
    skills.map(({ title, format, plugin: from, repository, allowedTools }) => ({
      title,
      format,
      from: from?.label ?? repository,
      allowedTools,
    })),
  ).toEqual([
    { title: 'checklist', format: 'skill', from: 'review', allowedTools: [] },
    { title: 'release', format: 'command', from: 'payments', allowedTools: ['Bash(git:*)'] },
  ]);
});
