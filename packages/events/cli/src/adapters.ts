import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { Command } from 'commander';
import {
  jsonValueSchema,
  validateDiscoveryResult,
  type JsonValue,
  type DiscoverResult,
  type DiscoveryAdapter,
  type DiscoveryContext,
} from 'autocatalog-core';
import { z } from 'zod';

const DISCOVERY_PROTOCOL = 'autocatalog/discovery-v1';

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const ADAPTER_HOST = String.raw`
const fs = await import('node:fs');
try {
  const moduleUrl = process.argv[1];
  const exportName = process.argv[2];
  const context = JSON.parse(Buffer.from(process.argv[3], 'base64url').toString('utf8'));
  const loaded = await import(moduleUrl);
  const adapter = loaded[exportName];
  if (!adapter || typeof adapter.discover !== 'function') {
    throw new Error('export does not implement DiscoveryAdapter');
  }
  const result = await adapter.discover(context);
  fs.writeFileSync(3, JSON.stringify({ protocol: '${DISCOVERY_PROTOCOL}', result }));
} catch (error) {
  fs.writeFileSync(2, error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
`;

export class AdapterExecutionError extends Error {
  constructor(
    public readonly code:
      | 'code_execution_consent_required'
      | 'adapter_timeout'
      | 'adapter_crashed'
      | 'adapter_output_limit'
      | 'adapter_protocol_invalid',
    message: string,
    /** The adapter packages involved, by name. */
    public readonly packages: string[] = [],
  ) {
    super(`[${code}] ${message}`);
    this.name = 'AdapterExecutionError';
  }
}

export interface AdapterManifest {
  packageName: string;
  command?: string;
  description: string;
  entryAbs?: string;
  discoveryEntryAbs?: string;
  discoveryExport?: string;
}

/** A package.json field the adapter contract reads; anything but a string counts as absent. */
const field = z.string().optional().catch(undefined);

/** The parts of an adapter's package.json that declare it. */
const adapterPackage = z.object({
  name: field,
  autocatalog: z
    .object({
      adapter: z
        .object({
          command: field,
          description: field,
          entry: field,
          discovery: z.object({ entry: field, export: field }).optional().catch(undefined),
        })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

async function readAdapterPackage(p: string): Promise<z.infer<typeof adapterPackage> | null> {
  try {
    return adapterPackage.parse(JSON.parse(await fs.readFile(p, 'utf8')));
  } catch {
    return null;
  }
}

/** `autocatalog-adapter-<x>`, or the same under a scope: `@acme/autocatalog-adapter-<x>`. */
const ADAPTER_NAME = /^(@[^/]+\/)?autocatalog-adapter-[^/]+$/;

async function loadAdapterManifest(packageDir: string): Promise<AdapterManifest | null> {
  const pkg = await readAdapterPackage(path.join(packageDir, 'package.json'));

  if (!pkg) return null;

  const meta = pkg.autocatalog?.adapter;
  const packageName = pkg.name ?? null;

  if (!packageName || !ADAPTER_NAME.test(packageName)) return null;

  if (!meta) return null;
  const commandValid = Boolean(meta.command && meta.entry);
  const discoveryValid = Boolean(meta.discovery?.entry && meta.discovery.export);

  if (!commandValid && !discoveryValid) return null;

  return {
    packageName,
    command: meta.command,
    description: meta.description ?? `Adapter command from ${packageName}`,
    entryAbs: meta.entry ? path.join(packageDir, meta.entry) : undefined,
    discoveryEntryAbs: meta.discovery?.entry
      ? path.join(packageDir, meta.discovery.entry)
      : undefined,
    discoveryExport: meta.discovery?.export,
  };
}

export async function discoverAdapters(cwd: string): Promise<AdapterManifest[]> {
  const nm = path.join(cwd, 'node_modules');
  const entries = await fs.readdir(nm).catch(() => []);

  const scoped = await Promise.all(
    entries
      .filter((entry) => entry.startsWith('@'))
      .map(async (scope) =>
        (await fs.readdir(path.join(nm, scope)).catch(() => [])).map((name) => `${scope}/${name}`),
      ),
  );

  const candidates = [...entries, ...scoped.flat()].filter((name) => ADAPTER_NAME.test(name));
  const results: AdapterManifest[] = [];

  for (const name of candidates) {
    const m = await loadAdapterManifest(path.join(nm, name));

    if (m) results.push(m);
  }

  return results;
}

export function registerAdapterCommand(program: Command, manifest: AdapterManifest): void {
  const entry = manifest.entryAbs;

  if (!manifest.command || !entry) return;
  program
    .command(manifest.command)
    .description(`${manifest.description} (via ${manifest.packageName})`)
    .argument('[args...]')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (args: string[] = []) => {
      const code: number = await new Promise((resolve) => {
        const child = spawn(process.execPath, [entry, ...(args ?? [])], {
          stdio: 'inherit',
        });

        child.on('exit', (c) => resolve(c ?? 1));
      });

      process.exit(code);
    });
}

async function dependencyRoots(entry: string, sourceRoot: string): Promise<string[]> {
  const roots = new Set([sourceRoot, path.dirname(await fs.realpath(entry))]);

  for (const start of [entry, sourceRoot]) {
    let directory = path.dirname(start);

    while (directory !== path.dirname(directory)) {
      try {
        await fs.access(path.join(directory, 'pnpm-workspace.yaml'));
        roots.add(directory);
        break;
      } catch {
        // keep walking toward the dependency root
      }

      const nodeModules = path.join(directory, 'node_modules');

      try {
        await fs.access(nodeModules);
        roots.add(nodeModules);
      } catch {
        // keep walking
      }

      directory = path.dirname(directory);
    }
  }

  return [...roots];
}

/** What an isolated host writes to fd 3: its protocol, and a result to check. */
const hostMessage = z.object({ protocol: z.string(), result: jsonValueSchema.optional() });

/**
 * Run repository code in a child Node process under the permission model: it
 * reads only its own dependency roots, gets no environment beyond PATH, and is
 * killed past its time or output limit. The host script writes
 * `{ protocol, result }` to fd 3.
 */
export async function runIsolated(input: {
  name: string;
  entry: string;
  root: string;
  /** Exactly what the code may read, in place of its own dependency roots. */
  readOnly?: string[];
  host: string;
  protocol: string;
  args: string[];
  /** Sent on stdin, for input too large for an argument. */
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<JsonValue | undefined> {
  const major = Number(process.versions.node.split('.')[0]);

  if (major < 24) {
    throw new AdapterExecutionError(
      'adapter_crashed',
      'isolated execution requires Node.js 24 or newer',
    );
  }

  const entry = await fs.realpath(input.entry);

  // The permission model compares real paths, and a temporary folder is often a symlink.
  const allowRead = input.readOnly
    ? await Promise.all(input.readOnly.map((root) => fs.realpath(root)))
    : await dependencyRoots(entry, input.root);

  const args = [
    '--permission',
    '--max-old-space-size=512',
    ...allowRead.map((root) => `--allow-fs-read=${root}`),
    '--input-type=module',
    '--eval',
    input.host,
    pathToFileURL(entry).href,
    ...input.args,
  ];

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: input.root,
      env: { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' },
      stdio: [input.stdin === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const protocol: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const finish = (error?: Error, result?: JsonValue) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);

      if (error) reject(error);
      else resolve(result);
    };

    const abort = () => {
      child.kill('SIGKILL');
      finish(new AdapterExecutionError('adapter_crashed', `${input.name} was aborted`));
    };

    input.signal?.addEventListener('abort', abort, { once: true });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new AdapterExecutionError('adapter_timeout', `${input.name} exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    if (input.stdin !== undefined) {
      // A host that exits before reading its input is reported by its exit code.
      child.stdin?.on('error', () => {});
      child.stdin?.end(input.stdin);
    }

    child.stdio[3]?.on('data', (chunk: Buffer) => {
      bytes += chunk.length;

      if (bytes > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(
          new AdapterExecutionError(
            'adapter_output_limit',
            `${input.name} exceeded ${maxOutputBytes} output bytes`,
          ),
        );
      } else protocol.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (Buffer.concat(stderr).length < 64 * 1024) stderr.push(chunk);
    });
    child.on('error', (error) =>
      finish(new AdapterExecutionError('adapter_crashed', `${input.name}: ${error.message}`)),
    );
    child.on('exit', (code) => {
      if (settled) return;

      if (code !== 0) {
        finish(
          new AdapterExecutionError(
            'adapter_crashed',
            `${input.name} exited ${code}: ${Buffer.concat(stderr).toString('utf8').trim()}`,
          ),
        );

        return;
      }

      try {
        const message = hostMessage.safeParse(JSON.parse(Buffer.concat(protocol).toString('utf8')));

        if (!message.success || message.data.protocol !== input.protocol) {
          throw new Error(`expected ${input.protocol}`);
        }

        finish(undefined, message.data.result);
      } catch (error) {
        finish(
          new AdapterExecutionError(
            'adapter_protocol_invalid',
            `${input.name}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  });
}

async function executeDiscoveryAdapter(input: {
  name: string;
  entry: string;
  exportName: string;
  context: DiscoveryContext;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<DiscoverResult> {
  const { signal, ...serializableContext } = input.context;

  const result = await runIsolated({
    name: input.name,
    entry: input.entry,
    root: input.context.root,
    host: ADAPTER_HOST,
    protocol: DISCOVERY_PROTOCOL,
    args: [
      input.exportName,
      Buffer.from(JSON.stringify(serializableContext)).toString('base64url'),
    ],
    signal,
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes,
  });

  try {
    return validateDiscoveryResult(input.name, result);
  } catch (error) {
    throw new AdapterExecutionError(
      'adapter_protocol_invalid',
      `${input.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Create an Adapter whose executable Implementation runs outside the CLI process. */
export function createIsolatedDiscoveryAdapter(
  manifest: AdapterManifest,
  limits: { timeoutMs?: number; maxOutputBytes?: number } = {},
): DiscoveryAdapter {
  if (!manifest.discoveryEntryAbs || !manifest.discoveryExport) {
    throw new AdapterExecutionError(
      'adapter_protocol_invalid',
      `${manifest.packageName} has no discovery entry`,
    );
  }

  return {
    name: manifest.packageName.replace('autocatalog-adapter-', ''),
    discover: (context) =>
      executeDiscoveryAdapter({
        name: manifest.packageName,
        entry: manifest.discoveryEntryAbs!,
        exportName: manifest.discoveryExport!,
        context,
        timeoutMs: limits.timeoutMs,
        maxOutputBytes: limits.maxOutputBytes,
      }),
  };
}

/** Resolve scanner Implementations without importing Adapter code into the CLI. */
export async function discoverDiscoveryAdapters(
  cwd: string,
  options: { allowCodeExecution?: boolean } = {},
): Promise<DiscoveryAdapter[]> {
  const manifests = await discoverAdapters(cwd);

  const discovery = manifests.filter(
    (manifest) => manifest.discoveryEntryAbs && manifest.discoveryExport,
  );

  if (discovery.length > 0 && !options.allowCodeExecution) {
    throw new AdapterExecutionError(
      'code_execution_consent_required',
      `runtime discovery is installed (${discovery.map((item) => item.packageName).join(', ')}); rerun with --allow-code-execution only for a repository you trust`,
      discovery.map((item) => item.packageName),
    );
  }

  return discovery
    .map((manifest) => createIsolatedDiscoveryAdapter(manifest))
    .sort((a, b) => a.name.localeCompare(b.name));
}
