import {
  AgentSchema,
  McpServerSchema,
  ToolSchema,
  type Catalog,
  type Entity,
  type EntityKind,
} from 'autocatalog-agents-core';
import { describe, expect, it } from 'vitest';
import { computeDrift, GATEWAY_CALLER } from './diff.js';
import { parseOtlpJson } from './parse.js';

const text = (key: string, stringValue: string) => ({ key, value: { stringValue } });

const trace = (service: string, ...spans: Array<ReturnType<typeof text>[]>) =>
  JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes: [text('service.name', service)] },
        scopeSpans: [{ spans: spans.map((attributes) => ({ name: 'tool call', attributes })) }],
      },
    ],
  });

const catalog = (): Catalog => ({
  root: '/repo',
  entities: new Map<EntityKind, Map<string, Entity>>([
    [
      'agent',
      new Map<string, Entity>([
        [
          'triage',
          AgentSchema.parse({
            id: 'triage',
            name: 'Triage',
            owner: 'support',
            model: 'fast',
            tools: ['github.create-issue'],
          }),
        ],
        [
          'broad',
          AgentSchema.parse({
            id: 'broad',
            name: 'Broad',
            owner: 'support',
            model: 'fast',
            servers: ['github'],
          }),
        ],
      ]),
    ],
    [
      'tool',
      new Map<string, Entity>([
        [
          'github.create-issue',
          ToolSchema.parse({
            id: 'github.create-issue',
            name: 'Create issue',
            owner: 'platform',
            server: 'github',
            mcp_name: 'create_issue',
          }),
        ],
      ]),
    ],
    [
      'mcp-server',
      new Map<string, Entity>([
        [
          'github',
          McpServerSchema.parse({
            id: 'github',
            name: 'GitHub',
            owner: 'platform',
            transport: 'http',
            url: 'https://api.githubcopilot.com/mcp',
            snapshot: { integration: 'gh' },
          }),
        ],
        [
          'gitlab',
          McpServerSchema.parse({
            id: 'gitlab',
            name: 'GitLab',
            owner: 'platform',
            transport: 'http',
            url: 'https://gitlab.example.com/mcp',
          }),
        ],
      ]),
    ],
  ]),
  meta: new Map(),
  snapshots: new Map([
    [
      'github',
      [
        {
          spec: 'autocatalog/mcp-snapshot-v1',
          server: 'github',
          connection: 'default',
          source: 'live',
          tools: [{ name: 'create_issue' }, { name: 'search' }],
        },
      ],
    ],
  ]),
  changes: new Map(),
  issues: [],
});

const kinds = (raw: string) =>
  computeDrift(catalog(), parseOtlpJson(raw)).drifts.map(({ kind, agentId, toolId }) =>
    [kind, agentId, toolId].filter(Boolean).join(' '),
  );

describe('MCP calls in traces', () => {
  it('matches a call by the server’s tool name to the catalog entry', () => {
    const raw = trace('triage', [
      text('gen_ai.tool.name', 'create_issue'),
      text('server.address', 'api.githubcopilot.com'),
    ]);

    expect(kinds(raw)).toEqual([]);
  });

  it('accepts any tool on a server the agent declares whole', () => {
    const raw = trace('broad', [
      text('gen_ai.tool.name', 'search'),
      text('server.address', 'api.githubcopilot.com'),
    ]);

    expect(kinds(raw)).toEqual([]);
  });

  it('still catches a tool outside what the agent declares', () => {
    const raw = trace('triage', [
      text('gen_ai.tool.name', 'search'),
      text('server.address', 'api.githubcopilot.com'),
    ]);

    expect(kinds(raw)).toContain('undeclared-tool triage search');
  });

  it('finds a server nobody declared, such as one in a personal config', () => {
    const raw = trace('triage', [
      text('gen_ai.tool.name', 'create_issue'),
      text('server.address', 'mcp.shadow.dev'),
    ]);

    expect(kinds(raw)).toContain('unknown-mcp-server triage');
    expect(kinds(raw)).toContain('undeclared-tool triage create_issue');
  });

  it('checks each server on its own when two offer a tool of the same name', () => {
    const raw = trace(
      'broad',
      [text('gen_ai.tool.name', 'search'), text('server.address', 'api.githubcopilot.com')],
      [text('gen_ai.tool.name', 'search'), text('server.address', 'gitlab.example.com')],
    );

    const report = computeDrift(catalog(), parseOtlpJson(raw));

    expect(kinds(raw)).toContain('undeclared-tool broad search');
    expect(report.drifts.find(({ kind }) => kind === 'undeclared-tool')?.message).toContain(
      'MCP server "gitlab"',
    );
  });

  it('reports a tool an agent reached on two undeclared servers once for each', () => {
    const raw = trace(
      'triage',
      [text('gen_ai.tool.name', 'search'), text('server.address', 'api.githubcopilot.com')],
      [text('gen_ai.tool.name', 'search'), text('server.address', 'gitlab.example.com')],
    );

    expect(kinds(raw).filter((line) => line === 'undeclared-tool triage search')).toHaveLength(2);
  });

  it('does not let a declared tool cover the same name on another server', () => {
    const raw = trace('triage', [
      text('gen_ai.tool.name', 'create_issue'),
      text('server.address', 'gitlab.example.com'),
    ]);

    expect(kinds(raw)).toContain('undeclared-tool triage create_issue');
  });

  it('does not let a declared tool id cover a call on another server', () => {
    const raw = trace('triage', [
      text('gen_ai.tool.name', 'github.create-issue'),
      text('server.address', 'gitlab.example.com'),
    ]);

    expect(kinds(raw)).toContain('undeclared-tool triage github.create-issue');
    expect(kinds(raw)).toContain('unknown-tool triage github.create-issue');
  });

  it('notices a tool the snapshot does not hold', () => {
    const raw = trace('broad', [
      text('gen_ai.tool.name', 'delete_repo'),
      text('server.address', 'api.githubcopilot.com'),
    ]);

    expect(kinds(raw)).toContain('tool-not-in-snapshot broad delete_repo');
  });

  it('reads a gateway’s address, and does not take the gateway for an agent', () => {
    const raw = trace('executor', [
      text('mcp.tool.name', 'tools.gh.org.work.search'),
      text('executor.tenant', 'acme'),
    ]);

    const obs = parseOtlpJson(raw);

    expect(obs.agents.size).toBe(0);
    expect(obs.mcpCalls).toEqual([{ agent: undefined, server: 'gh', tool: 'search' }]);
    expect(kinds(raw)).toEqual([]);
  });

  it('reports a gateway calling an unknown server without naming an agent', () => {
    const raw = trace('executor', [
      text('mcp.tool.name', 'tools.shadow.org.work.exfiltrate'),
      text('executor.tenant', 'acme'),
    ]);

    expect(kinds(raw)).toEqual([`unknown-mcp-server ${GATEWAY_CALLER}`]);
  });

  it('keeps the agent when a gateway span carries one', () => {
    const raw = trace('executor', [
      text('mcp.tool.name', 'tools.gh.org.work.search'),
      text('executor.tenant', 'acme'),
      text('gen_ai.agent.id', 'broad'),
    ]);

    expect(parseOtlpJson(raw).mcpCalls[0]?.agent).toBe('broad');
    expect(kinds(raw)).toEqual([]);
  });
});
