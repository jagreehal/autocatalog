import { readFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';
import type { DiscoveredSource, ScanFile } from './discovery.js';
import { lineAt } from './discovery.js';
import type { McpPackage, McpServer } from './schemas.js';

/** A server a repository publishes, read from its code or its `server.json`. */
export type BuiltMcpServer = {
  name: string;
  transport: McpServer['transport'];
  url?: string | undefined;
  package?: McpPackage | undefined;
  description?: string | undefined;
  source: DiscoveredSource;
};

const CODE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs|py|go)$/;

/** Servers in these are test doubles and samples, not something the company runs. */
const NOT_SHIPPED =
  /(^|\/)(tests?|testing|__tests__|__mocks__|fixtures?|examples?|samples?|e2e|dist|build|vendor|target)\/|(^|\/|[-_.])(test|fake|mock|stub)[-_]?(servers?|helpers?|fixtures?|doubles?)\b|[._](test|spec|stories)\.[^/]+$|_test\.(py|go)$|(^|\/)test_[^/]+\.py$/i;

/**
 * How each SDK starts a server. A file counts only with the SDK's import in it,
 * because `new Server(...)` alone could be anything. `name` is absent where the
 * code passes a variable, and the package or folder names the server instead.
 */
const SDKS: Array<{ file: RegExp; imports: RegExp; creates: RegExp[] }> = [
  {
    file: /\.(ts|tsx|mts|cts|js|mjs|cjs)$/,
    imports: /['"](@modelcontextprotocol\/(sdk|server)[^'"]*|fastmcp)['"]/,
    creates: [
      /new\s+(?:Mcp|FastMCP|Fast)?(?:Server|MCP)\s*\(\s*(?:\{[^{}]*?\bname\s*:\s*['"`](?<name>[^'"`$]+)['"`])?/g,
    ],
  },
  {
    file: /\.py$/,
    imports: /^\s*(from|import)\s+(mcp|fastmcp)\b/m,
    creates: [
      /\bFastMCP\(\s*(?:name\s*=\s*)?(?:['"](?<name>[^'"]+)['"])?/g,
      /\bServer\(\s*['"](?<name>[^'"]+)['"]/g,
    ],
  },
  {
    file: /\.go$/,
    imports: /"github\.com\/(modelcontextprotocol\/go-sdk|mark3labs\/mcp-go)/,
    creates: [
      /mcp\.NewServer\(\s*&mcp\.Implementation\{[^}]*?Name:\s*"(?<name>[^"]+)"/g,
      /server\.NewMCPServer\(\s*"(?<name>[^"]+)"/g,
    ],
  },
];

const OVER_HTTP =
  /StreamableHTTP|createMcpHandler|streamable-http|SSEServerTransport|transport\s*=\s*['"](sse|http)/;

export const isMcpCodeFile = (file: string): boolean =>
  CODE_FILE.test(file) && !NOT_SHIPPED.test(file);

const NodeManifest = z.object({
  name: z.string().min(1).optional().catch(undefined),
  private: z.boolean().optional().catch(undefined),
});

const PythonManifest = z.object({
  project: z
    .object({ name: z.string().min(1) })
    .optional()
    .catch(undefined),
});

type Published = { name: string; package: McpPackage | undefined };

/** The package a file ships in, from the nearest manifest up to the repository's root. */
const publishedAs = async (root: string, file: string): Promise<Published | undefined> => {
  for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    const at = (name: string) => join(root, dir, name);
    const node = await readFile(at('package.json'), 'utf8').catch(() => null);

    if (node !== null) {
      const parsed = NodeManifest.safeParse(JSON.parse(node));

      if (parsed.success && parsed.data.name) {
        const { name } = parsed.data;

        return {
          name,
          package: parsed.data.private ? undefined : { registry: 'npm', name },
        };
      }
    }

    const python = await readFile(at('pyproject.toml'), 'utf8').catch(() => null);

    if (python !== null) {
      const name = PythonManifest.parse(parseToml(python)).project?.name;

      if (name) return { name, package: { registry: 'pypi', name } };
    }

    if (dir === '.' || dir === dirname(dir)) return undefined;
  }
};

/** The servers one source file starts. A malformed manifest beside it costs only the package. */
export const findMcpServersInCode = async (
  root: string,
  { relPath, text }: Pick<ScanFile, 'relPath' | 'text'>,
): Promise<BuiltMcpServer[]> => {
  const file = relPath.split('\\').join('/');
  const sdk = SDKS.find(({ file: pattern }) => pattern.test(file));

  if (!sdk || !sdk.imports.test(text)) return [];

  const found = sdk.creates.flatMap((pattern) => [...text.matchAll(pattern)]);

  if (found.length === 0) return [];

  const published = await publishedAs(root, file).catch(() => undefined);

  return found.map((match) => {
    const name = match.groups?.name ?? published?.name ?? posix.basename(posix.dirname(file));

    return {
      name,
      transport: OVER_HTTP.test(text) ? 'http' : 'stdio',
      package: published?.package,
      source: { file, line: lineAt(text, match.index), symbol: name },
    };
  });
};

const Remote = z.object({ url: z.string().min(1) });

const Package = z.looseObject({
  registryType: z.string().optional(),
  registry_type: z.string().optional(),
  identifier: z.string().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
});

/** The MCP Registry's format. `$schema` tells it from any other `server.json`. */
const ServerJson = z.looseObject({
  $schema: z.string().regex(/modelcontextprotocol|server\.schema\.json/),
  name: z.string().min(1),
  description: z.string().optional(),
  remotes: z.array(Remote).optional().catch(undefined),
  packages: z.array(Package).optional().catch(undefined),
});

const REGISTRIES = new Set<string>(['npm', 'pypi', 'oci']);

const isRegistry = (value: string | undefined): value is McpPackage['registry'] =>
  value !== undefined && REGISTRIES.has(value);

export const isMcpServerJson = (file: string): boolean =>
  /(^|[/\\])server\.json$/.test(file) && !NOT_SHIPPED.test(file.split('\\').join('/'));

/** The server a `server.json` publishes: its remote when it has one, or its package. */
export const readMcpServerJson = ({
  relPath,
  text,
}: Pick<ScanFile, 'relPath' | 'text'>): BuiltMcpServer | undefined => {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  const parsed = ServerJson.safeParse(json);

  if (!parsed.success) return undefined;

  const { name, description, remotes, packages } = parsed.data;
  const [listed] = packages ?? [];
  const registry = listed?.registryType ?? listed?.registry_type;
  const identifier = listed?.identifier ?? listed?.name;
  const url = remotes?.[0]?.url;

  return {
    name: posix.basename(name),
    transport: url ? 'http' : 'stdio',
    url,
    package:
      isRegistry(registry) && identifier
        ? { registry, name: identifier, version: listed?.version }
        : undefined,
    description,
    source: { file: relPath.split('\\').join('/'), line: 1, symbol: name },
  };
};
