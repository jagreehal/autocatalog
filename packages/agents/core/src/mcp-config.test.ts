import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditCatalog } from './audit.js';
import { computeImpact } from './impact.js';
import { loadCatalog } from './loader.js';
import { discoverMcpServers, isPinned, mcpServerDraft, refreshMcpServer } from './mcp-config.js';
import { mcpSnapshotPath } from './mcp-snapshot.js';
import { createAgentsResourceGraph } from './resource-graph.js';
import { McpServerSchema, type McpPackage } from './schemas.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-mcp-config-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const writeText = async (file: string, content: string) => {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
};

const write = (file: string, content: Parameters<typeof JSON.stringify>[0]) =>
  writeText(file, JSON.stringify(content, null, 2));

beforeEach(async () => {
  await fs.mkdir(path.join(root, 'empty-repo'), { recursive: true });
});

describe('discoverMcpServers', () => {
  it('reads every client format into one inventory', async () => {
    await write('.mcp.json', {
      mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } },
    });
    await writeText(
      '.vscode/mcp.json',
      `{
        // VS Code allows comments
        "servers": { "fs": { "command": "npx", "args": ["-y", "@acme/fs-mcp@1.2.3"] } },
      }`,
    );
    await write('.cursor/mcp.json', {
      mcpServers: {
        linear: { command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/sse'] },
      },
    });
    await write('.gemini/settings.json', {
      mcpServers: { docs: { httpUrl: 'https://docs.acme.dev/mcp' } },
    });
    await writeText(
      '.codex/config.toml',
      '[mcp_servers.time]\ncommand = "uvx"\nargs = ["mcp-server-time==2.0.0"]\n',
    );
    await write('opencode.json', {
      mcp: { sentry: { type: 'remote', url: 'https://mcp.sentry.dev/mcp' } },
    });
    await write('executor.jsonc', {
      integrations: [
        {
          kind: 'mcp',
          transport: 'remote',
          name: 'notion',
          endpoint: 'https://mcp.notion.com/mcp',
        },
        { kind: 'openapi', spec: 'https://acme.dev/openapi.json' },
      ],
    });

    const { servers, warnings } = await discoverMcpServers(root);

    expect(warnings).toEqual([]);
    expect(servers.map(({ id }) => id)).toEqual([
      'acme-fs-mcp',
      'api-githubcopilot-com',
      'docs-acme-dev',
      'linear-app',
      'mcp-server-time',
      'notion-com',
      'sentry-dev',
    ]);
    expect(servers.find(({ id }) => id === 'acme-fs-mcp')?.package).toEqual({
      registry: 'npm',
      name: '@acme/fs-mcp',
      version: '1.2.3',
    });
    expect(servers.find(({ id }) => id === 'mcp-server-time')?.package).toEqual({
      registry: 'pypi',
      name: 'mcp-server-time',
      version: '2.0.0',
    });
    expect(servers.find(({ id }) => id === 'linear-app')).toMatchObject({
      transport: 'http',
      url: 'https://mcp.linear.app/sse',
    });
  });

  it('treats one endpoint under two names as one server, keeping both sightings', async () => {
    await write('.mcp.json', { mcpServers: { gh: { url: 'https://api.githubcopilot.com/mcp/' } } });
    await write('apps/web/.cursor/mcp.json', {
      mcpServers: { github: { url: 'https://api.githubcopilot.com/mcp' } },
    });

    const { servers } = await discoverMcpServers(root);

    expect(servers).toHaveLength(1);
    expect(servers[0]!.url).toBe('https://api.githubcopilot.com/mcp');
    expect(servers[0]!.sources.map(({ file, symbol }) => [file, symbol])).toEqual([
      ['.mcp.json', 'gh'],
      ['apps/web/.cursor/mcp.json', 'github'],
    ]);
  });

  it('keeps no credential a config holds', async () => {
    const secrets = [
      'sk-live-abc123def456',
      'hunter2',
      'ghp_0123456789abcdefABCDEF',
      'a1b2c3d4e5f6a7b8c9d0',
      's3cretpass',
      'tok_987654321',
    ];

    await write('.mcp.json', {
      mcpServers: {
        env: {
          command: 'npx',
          args: ['-y', 'some-mcp', '--api-key', secrets[0]],
          env: { API_KEY: secrets[1] },
        },
        headers: {
          url: 'https://mcp.acme.dev/mcp',
          headers: { Authorization: `Bearer ${secrets[2]}` },
        },
        path: { url: `https://hooks.acme.dev/api/${secrets[3]}/mcp` },
        userinfo: { url: `https://admin:${secrets[4]}@db.acme.dev/mcp?token=${secrets[5]}` },
        database: { command: 'node', args: ['./server.js', `postgres://u:${secrets[4]}@db/app`] },
        flagged: { command: 'npx', args: ['--token', secrets[3], 'real-package'] },
      },
    });

    const { servers } = await discoverMcpServers(root);
    const written = JSON.stringify(servers.map(mcpServerDraft));

    expect(servers.length).toBeGreaterThan(4);

    for (const secret of secrets) expect(written).not.toContain(secret);

    expect(servers.find(({ url }) => url?.startsWith('https://hooks'))?.url).toBe(
      'https://hooks.acme.dev/api/{redacted}/mcp',
    );
  });

  it('drops an address it cannot read rather than guessing, and says so', async () => {
    await write('.mcp.json', { mcpServers: { internal: { url: 'https://${MCP_HOST}/mcp' } } });

    const { servers, warnings } = await discoverMcpServers(root);

    expect(servers[0]).toMatchObject({ id: 'internal', transport: 'http' });
    expect(servers[0]!.url).toBeUndefined();
    expect(warnings).toEqual([
      '.mcp.json: "internal" has an address that cannot be kept as written',
    ]);
  });

  it('infers origin from how a server runs', async () => {
    await write('.mcp.json', {
      mcpServers: {
        ours: { command: 'node', args: ['./dist/server.js'] },
        theirs: { command: 'docker', args: ['run', '-i', '-e', 'TOKEN', 'ghcr.io/acme/mcp:1.4.0'] },
        cli: { command: '/usr/local/bin/executor', args: ['mcp'] },
      },
    });

    const { servers } = await discoverMcpServers(root);

    expect(servers.find(({ id }) => id === 'ours')).toMatchObject({
      origin: 'built',
      command: 'node',
    });
    expect(servers.find(({ id }) => id === 'ghcr-io-acme-mcp')).toMatchObject({
      origin: 'third-party',
      package: { registry: 'oci', name: 'ghcr.io/acme/mcp', version: undefined },
    });
    expect(servers.find(({ id }) => id === 'cli')).toMatchObject({
      origin: 'unknown',
      command: 'executor',
    });
  });

  it('reports a config it cannot parse and reads the rest', async () => {
    await writeText('.mcp.json', '{ not json');
    await write('.cursor/mcp.json', { mcpServers: { a: { url: 'https://a.acme.dev/mcp' } } });

    const { servers, warnings } = await discoverMcpServers(root);

    expect(servers).toHaveLength(1);
    expect(warnings[0]).toContain('.mcp.json');
  });

  it('flags two versions of one package across configs', async () => {
    await write('.mcp.json', { mcpServers: { a: { command: 'npx', args: ['pkg@1.0.0'] } } });
    await write('.cursor/mcp.json', { mcpServers: { a: { command: 'npx', args: ['pkg@2.0.0'] } } });

    const { servers, warnings } = await discoverMcpServers(root);

    expect(servers).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('pkg');
    expect(servers[0]!.versions).toEqual(['1.0.0', '2.0.0']);
  });
});

describe('reading further than a repository', () => {
  it('redacts any path segment that is not plainly a word', async () => {
    await write('.mcp.json', {
      mcpServers: {
        short: { url: 'https://a.acme.dev/s/x7Kq2/mcp' },
        letters: { url: 'https://b.acme.dev/s/abcdefghijklmnopqrstuvwx/mcp' },
        versioned: { url: 'https://c.acme.dev/api/v2/2026-07-28/mcp' },
      },
    });

    const { servers } = await discoverMcpServers(root);
    const urls = servers.map(({ url }) => url);

    expect(urls).toContain('https://a.acme.dev/s/{redacted}/mcp');
    expect(urls).toContain('https://b.acme.dev/s/{redacted}/mcp');
    expect(urls).toContain('https://c.acme.dev/api/v2/2026-07-28/mcp');
  });

  it('reads private hosts and internal names as built', async () => {
    await write('.mcp.json', {
      mcpServers: {
        local: { url: 'http://localhost:3000/mcp' },
        vpc: { url: 'https://tools.corp/mcp' },
        ours: { url: 'https://mcp.acme.dev/mcp' },
        scoped: { command: 'npx', args: ['@acme/mcp@1.0.0'] },
        vendor: { url: 'https://mcp.vendor.com/mcp' },
      },
    });

    const { servers } = await discoverMcpServers(root, { internal: ['acme.dev', '@acme'] });
    const origin = (id: string) => servers.find((server) => server.id === id)?.origin;

    expect(origin('localhost-3000')).toBe('built');
    expect(origin('tools-corp')).toBe('built');
    expect(origin('acme-dev')).toBe('built');
    expect(origin('acme-mcp')).toBe('built');
    expect(origin('vendor-com')).toBe('unknown');
  });

  it('keeps two local servers on different ports apart', async () => {
    await write('.mcp.json', {
      mcpServers: {
        a: { url: 'http://localhost:3000/mcp' },
        b: { url: 'http://localhost:4000/mcp' },
      },
    });

    expect((await discoverMcpServers(root)).servers).toHaveLength(2);
  });

  it('reads personal configs only when asked, and labels them without a path', async () => {
    const home = path.join(root, 'home');

    await write('home/.claude.json', {
      mcpServers: { top: { url: 'https://top.acme.dev/mcp' } },
      projects: {
        '/Users/someone/secret-project': {
          mcpServers: { nested: { url: 'https://nested.acme.dev/mcp' } },
        },
      },
      oauthAccount: { emailAddress: 'someone@acme.dev' },
    });
    await writeText(
      'home/.codex/config.toml',
      '[mcp_servers.fs]\ncommand = "uvx"\nargs = ["fs-mcp==1"]\n',
    );

    expect((await discoverMcpServers(path.join(root, 'empty-repo'))).servers).toEqual([]);

    const { servers } = await discoverMcpServers(path.join(root, 'empty-repo'), { home });
    const written = JSON.stringify(servers.map(mcpServerDraft));

    expect(servers.map(({ id }) => id)).toEqual(['fs-mcp', 'nested-acme-dev', 'top-acme-dev']);
    expect(servers[1]!.sources[0]!.file).toBe('~/.claude.json');
    expect(written).not.toContain('secret-project');
    expect(written).not.toContain('someone');
  });
});

describe('isPinned', () => {
  const digest = `sha256:${'a'.repeat(64)}`;

  const pinned = (registry: McpPackage['registry'], version?: string) =>
    isPinned({ registry, name: 'pkg', version });

  it.each(['1.2.3', '1.2.3-rc.1', '1.2.3+build.5'])('takes npm %s', (version) => {
    expect(pinned('npm', version)).toBe(true);
  });

  it.each(['^1.0.0', '~1.0.0', '>=1.0.0', 'next', 'latest', '1', '1.2', '1.x', '*'])(
    'refuses npm %s',
    (version) => {
      expect(pinned('npm', version)).toBe(false);
    },
  );

  it.each(['1.0', '2024.1', '1.0rc1', '1.0.post2', '1!2.0'])('takes pypi %s', (version) => {
    expect(pinned('pypi', version)).toBe(true);
  });

  it.each(['1.*', '1.0,<2', 'latest'])('refuses pypi %s', (version) => {
    expect(pinned('pypi', version)).toBe(false);
  });

  it('takes a digest-pinned OCI image', () => {
    expect(pinned('oci', digest)).toBe(true);
  });

  it.each(['latest', 'stable', '1', '1.4', '1.4.0', 'v1.4.0', '1.4.0-rc.1', 'sha256:abc'])(
    'refuses oci %s',
    (version) => {
      expect(pinned('oci', version)).toBe(false);
    },
  );

  it('refuses a package with no version', () => {
    expect(pinned('npm')).toBe(false);
  });
});

describe('isPinned on hostile input', () => {
  it('answers at once on a version built to backtrack', () => {
    const started = performance.now();

    expect(isPinned({ registry: 'pypi', name: 'pkg', version: `1${'a'.repeat(5000)}!` })).toBe(
      false,
    );
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('a package spec in a client config', () => {
  const digest = `sha256:${'b'.repeat(64)}`;

  const discovered = async (args: string[]) => {
    await write('.mcp.json', { mcpServers: { it: { command: args[0], args: args.slice(1) } } });

    const { servers } = await discoverMcpServers(root);

    return servers[0]?.package;
  };

  it('drops a range, so it reads as unpinned', async () => {
    expect((await discovered(['npx', '-y', 'some-mcp@^1.0.0']))?.version).toBeUndefined();
  });

  it('counts a package as pinned only when every config pins it', async () => {
    const digest2 = `sha256:${'c'.repeat(64)}`;

    await write('.mcp.json', {
      mcpServers: { it: { command: 'docker', args: ['run', '-i', `ghcr.io/acme/mcp@${digest2}`] } },
    });
    await write('.cursor/mcp.json', {
      mcpServers: { it: { command: 'docker', args: ['run', '-i', 'ghcr.io/acme/mcp:moving'] } },
    });

    const { servers, warnings } = await discoverMcpServers(root);

    expect(servers[0]?.package?.version).toBeUndefined();
    expect(warnings.join()).toContain('ghcr-io-acme-mcp');
  });

  it('keeps the digest of an image that also names a tag', async () => {
    await expect(
      discovered(['docker', 'run', '-i', `ghcr.io/acme/mcp:1.4@${digest}`]),
    ).resolves.toMatchObject({ name: 'ghcr.io/acme/mcp', version: digest });
  });
});

describe('mcpSnapshotPath', () => {
  const file = (connection: string) => path.basename(mcpSnapshotPath('/c', 'it', connection));

  it('leaves a plain connection readable', () => {
    expect(file('default')).toBe('default.json');
  });

  it('gives identities that slug alike their own file', () => {
    const names = [
      'alice@example.com',
      'alice-example-com',
      'alice.example.com',
      'Alice@example.com',
      'alice_example_com',
      'alice%40example.com',
    ].map(file);

    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
  });

  it('keeps a connection inside its folder', () => {
    expect(file('../../secrets')).not.toContain('/');
    expect(path.dirname(mcpSnapshotPath('/c', 'it', '../../x'))).toBe(
      '/c/mcp-servers/it/snapshots',
    );
  });
});

describe('refreshMcpServer', () => {
  const server = {
    id: 'acme',
    name: 'Acme',
    origin: 'unknown' as const,
    transport: 'http' as const,
    url: 'https://new.acme.dev/mcp',
    sources: [{ file: '.mcp.json', line: 3, symbol: 'acme' }],
  };

  it('updates what the scan owns and keeps what a person decided', () => {
    const reviewed = {
      ...mcpServerDraft({ ...server, url: 'https://old.acme.dev/mcp', sources: [] }),
      owner: 'platform',
      origin: 'third-party',
      status: 'deprecated',
      discovery: { confidence: 'reviewed', adapter: 'mcp', sources: [], needs_review: [] },
    };

    expect(refreshMcpServer(reviewed, server)).toMatchObject({
      owner: 'platform',
      origin: 'third-party',
      status: 'deprecated',
      url: 'https://new.acme.dev/mcp',
      discovery: { confidence: 'reviewed', needs_review: [], sources: server.sources },
    });
  });

  it('leaves a hand-written entry alone', () => {
    const written = { name: 'Acme', owner: 'platform', transport: 'stdio' };

    expect(refreshMcpServer(written, server)).toBe(written);
  });
});

describe('an MCP server in the catalog', () => {
  const entry = (dir: string, data: Parameters<typeof write>[1]) =>
    write(`${dir}/autocatalog.json`, data);

  beforeEach(async () => {
    await writeText(
      'models/fast.yaml',
      'id: fast\nname: Fast\nowner: ai\nprovider: x\nmodel_id: fast\n',
    );
    await entry('mcp-servers/github', {
      name: 'GitHub',
      owner: 'platform',
      origin: 'third-party',
      transport: 'stdio',
      package: { registry: 'npm', name: 'github-mcp' },
    });
    await entry('tools/create-issue', {
      name: 'Create issue',
      owner: 'platform',
      server: 'github',
    });
    await entry('agents/triage', {
      name: 'Triage',
      owner: 'support',
      model: 'fast',
      tools: ['create-issue'],
    });
  });

  it('reaches the agents behind its tools in impact', async () => {
    const catalog = await loadCatalog(root);

    expect(computeImpact(catalog, { kind: 'mcp-server', id: 'github' }).dependents).toEqual([
      { kind: 'tool', id: 'create-issue' },
      { kind: 'agent', id: 'triage' },
    ]);
    expect(computeImpact(catalog, { kind: 'tool', id: 'create-issue' }).dependencies).toEqual([
      { kind: 'mcp-server', id: 'github' },
    ]);
  });

  it('draws the tool and repository edges', async () => {
    const graph = createAgentsResourceGraph(await loadCatalog(root), { repository: 'support' });
    const edges = graph.relationships.map(({ type, from, to }) => `${from.id} ${type} ${to.id}`);

    expect(edges).toContain('create-issue exposedBy github');
    expect(edges).toContain('support usesServer github');
    expect(edges).not.toContain('support defines github');
  });

  it('fails validation on a tool naming a server that is not there', async () => {
    await entry('tools/create-issue', { name: 'Create', owner: 'platform', server: 'gitlab' });

    await expect(
      loadCatalog(root).then((catalog) => createAgentsResourceGraph(catalog)),
    ).rejects.toThrow('unknown MCP server "gitlab"');
  });

  it('audits a package that runs without a pinned version', async () => {
    const findings = auditCatalog(await loadCatalog(root));

    expect(findings.map(({ rule }) => rule)).toContain('mcp-server-unpinned');
  });

  it('tells an image to pin its digest', async () => {
    await entry('mcp-servers/image', {
      name: 'Image',
      owner: 'platform',
      transport: 'stdio',
      origin: 'third-party',
      package: { registry: 'oci', name: 'ghcr.io/acme/mcp', version: '1.4.0' },
    });

    const findings = auditCatalog(await loadCatalog(root));

    expect(findings.find(({ ref }) => ref?.id === 'image')?.message).toContain('Pin its digest');
  });

  it.each([
    { registry: 'npm', name: 'some-mcp', version: '^1.0.0' },
    { registry: 'oci', name: 'ghcr.io/acme/mcp', version: '1.4.0' },
    { registry: 'oci', name: 'ghcr.io/acme/mcp', version: 'v1.4.0' },
  ])('audits a package on a floating version: $registry $version', async (pkg) => {
    await entry('mcp-servers/floating', {
      name: 'Floating',
      owner: 'platform',
      transport: 'stdio',
      origin: 'third-party',
      package: pkg,
    });

    const findings = auditCatalog(await loadCatalog(root));

    expect(
      findings.filter(({ rule }) => rule === 'mcp-server-unpinned').map(({ ref }) => ref?.id),
    ).toContain('floating');
  });

  it('parses the manifest a draft writes', () => {
    const draft = mcpServerDraft({
      id: 'a',
      name: 'A',
      origin: 'unknown',
      transport: 'stdio',
      command: 'a',
      sources: [],
    });

    expect(McpServerSchema.safeParse({ id: 'a', ...draft }).success).toBe(true);
  });
});

describe('servers a repository builds', () => {
  it('finds a TypeScript server and names it after its package', async () => {
    await write('services/tools/package.json', { name: '@acme/tools-mcp' });
    await writeText(
      'services/tools/src/server.ts',
      `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

       const server = new McpServer({ name: 'acme-tools', version: '1.0.0' });`,
    );

    const { servers } = await discoverMcpServers(root);

    expect(servers).toEqual([
      expect.objectContaining({
        id: 'acme-tools-mcp',
        name: 'Acme Tools',
        origin: 'built',
        transport: 'stdio',
        package: { registry: 'npm', name: '@acme/tools-mcp' },
        sources: [{ file: 'services/tools/src/server.ts', line: 3, symbol: 'acme-tools' }],
      }),
    ]);
  });

  it('reads a private package as having no package at all', async () => {
    await write('package.json', { name: 'internal-tools', private: true });
    await writeText(
      'server.ts',
      `import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
       createMcpHandler(() => new McpServer({ name: 'ops', version: '1' }));`,
    );

    const { servers } = await discoverMcpServers(root);

    expect(servers[0]).toMatchObject({ id: 'ops', transport: 'http' });
    expect(servers[0]!.package).toBeUndefined();
  });

  it('names a server from its package when the code passes a variable', async () => {
    await write('package.json', { name: 'named-by-package' });
    await writeText(
      'server.js',
      `const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
       new Server({ name: NAME, version: '1' });`,
    );

    expect((await discoverMcpServers(root)).servers[0]?.id).toBe('named-by-package');
  });

  it('finds Python and Go servers', async () => {
    await writeText('py/pyproject.toml', '[project]\nname = "acme-py-mcp"\n');
    await writeText('py/app.py', 'from mcp.server.fastmcp import FastMCP\nmcp = FastMCP("py")\n');
    await writeText(
      'go/main.go',
      `import "github.com/modelcontextprotocol/go-sdk/mcp"
       var s = mcp.NewServer(&mcp.Implementation{Name: "go-server", Version: "1"}, nil)`,
    );

    const { servers } = await discoverMcpServers(root);

    expect(servers.map(({ id }) => id)).toEqual(['acme-py-mcp', 'go-server']);
    expect(servers[0]!.package).toEqual({ registry: 'pypi', name: 'acme-py-mcp' });
  });

  it('reads a registry server.json and leaves any other one alone', async () => {
    await write('server.json', {
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
      name: 'io.github.acme/weather',
      description: 'Weather for agents',
      remotes: [{ type: 'streamable-http', url: 'https://mcp.weather.acme.dev/mcp' }],
    });
    await write('other/server.json', { name: 'not-mcp', port: 3000 });

    const { servers } = await discoverMcpServers(root);

    expect(servers).toEqual([
      expect.objectContaining({
        id: 'weather-acme-dev',
        name: 'Weather',
        origin: 'built',
        transport: 'http',
        description: 'Weather for agents',
      }),
    ]);
  });

  it('ignores tests, samples, and files that merely mention a server', async () => {
    const code = `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
                  new McpServer({ name: 'double', version: '1' });`;

    await writeText('src/server.test.ts', code);
    await writeText('test/helpers.ts', code);
    await writeText('examples/demo/server.ts', code);
    await writeText('packages/test-servers/src/worker.ts', code);
    await writeText('src/stdio-negotiation-test-server.ts', code);
    await writeText('src/testing/server.ts', code);
    await writeText('src/http.ts', `new Server({ name: 'express' });`);

    expect((await discoverMcpServers(root)).servers).toEqual([]);
  });

  it('joins a repository’s code to the configs that use the same package', async () => {
    await write('tools/package.json', { name: 'tools-mcp' });
    await writeText(
      'tools/src/index.ts',
      `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
       new McpServer({ name: 'tools', version: '1' });`,
    );
    await write('payments/.mcp.json', {
      mcpServers: { tools: { command: 'npx', args: ['tools-mcp@2.0.0'] } },
    });

    const { servers } = await discoverMcpServers(root, { perRepository: true });

    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      origin: 'built',
      built_in: 'tools',
      used_by: ['payments'],
      package: { name: 'tools-mcp', version: '2.0.0' },
    });
  });

  it('treats a built package with no version as nothing to pin', async () => {
    await write('package.json', { name: 'ours-mcp' });
    await writeText(
      'server.ts',
      `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
       new McpServer({ name: 'ours', version: '1' });`,
    );

    const [server] = (await discoverMcpServers(root)).servers;

    await write('catalog/mcp-servers/ours-mcp/autocatalog.json', mcpServerDraft(server!));

    const findings = auditCatalog(await loadCatalog(path.join(root, 'catalog')));

    expect(findings.map(({ rule }) => rule)).not.toContain('mcp-server-unpinned');
  });

  it('does not credit a gathering catalog with building what it lists', async () => {
    await write('mcp-servers/ours/autocatalog.json', {
      name: 'Ours',
      owner: 'platform',
      origin: 'built',
      transport: 'http',
      url: 'https://ours.acme.dev/mcp',
      used_by: ['payments'],
      repository: { id: 'tools' },
    });

    const graph = createAgentsResourceGraph(await loadCatalog(root), { repository: 'catalog' });
    const edges = graph.relationships.map(({ type, from, to }) => `${from.id} ${type} ${to.id}`);

    expect(edges).toEqual(['payments usesServer ours', 'tools defines ours']);
  });
});
