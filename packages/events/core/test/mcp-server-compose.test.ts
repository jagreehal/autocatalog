import { describe, expect, it } from 'vitest';
import {
  AUTOCATALOG_GRAPH_SPEC,
  composeResourceGraphs,
  ResourceGraphConflictError,
  type AgentSystemCatalogResource,
  type ResourceGraph,
} from '../src/resource-graph';

const server = (
  owner: string,
  file: string,
  attributes: AgentSystemCatalogResource['attributes'],
): ResourceGraph => ({
  spec: AUTOCATALOG_GRAPH_SPEC,
  resources: [
    {
      ref: { kind: 'mcp-server', id: 'github' },
      title: 'GitHub',
      owner: { team: owner },
      tags: [],
      provenance: { default: 'inferred', fields: {} },
      needsReview: owner === 'review-needed',
      source: { file },
      attributes: { transport: 'http', ...attributes },
    },
  ],
  relationships: [],
});

const url = 'https://api.githubcopilot.com/mcp';

describe('one MCP server across repositories', () => {
  it('merges into one entry with every owner, instead of failing the second repository', () => {
    const { resources } = composeResourceGraphs(
      server('payments', 'a/.mcp.json', { origin: 'unknown', url }),
      server('review-needed', 'b/.mcp.json', { origin: 'third-party', url }),
      server('ledger', 'c/.mcp.json', { origin: 'unknown', url }),
    );

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      owner: { team: 'ledger' },
      needsReview: true,
      attributes: { owners: ['payments'], origin: 'third-party', url },
    });
  });

  it('lists the versions repositories disagree on', () => {
    const pkg = (version: string) => ({ package: { registry: 'npm', name: 'gh', version } });

    const { resources } = composeResourceGraphs(
      server('a', 'a/.mcp.json', pkg('1.0.0')),
      server('a', 'b/.mcp.json', pkg('2.0.0')),
    );

    expect(resources[0]!.attributes).toMatchObject({
      package: { registry: 'npm', name: 'gh' },
      versions: ['1.0.0', '2.0.0'],
    });
    expect(resources[0]!.attributes).not.toHaveProperty('package.version');
  });

  it('refuses one id on two addresses', () => {
    expect(() =>
      composeResourceGraphs(
        server('a', 'a/.mcp.json', { url }),
        server('a', 'b/.mcp.json', { url: 'https://other.dev/mcp' }),
      ),
    ).toThrow(ResourceGraphConflictError);
  });
});
