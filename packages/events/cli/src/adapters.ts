import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { Command } from 'commander';
import {
  jsonValueSchema,
  validateDiscoveryResult,
  type DiscoverResult,
  type DiscoveryAdapter,
  type DiscoveryContext,
} from 'autocatalog-core';
import { z } from 'zod';

const DISCOVERY_PROTOCOL = 'autocatalog/discovery-v1';

/** What the adapter host writes to fd 3; `result` is checked by validateDiscoveryResult. */
const discoveryMessage = z.object({
  protocol: z.literal(DISCOVERY_PROTOCOL),
  result: jsonValueSchema.optional(),
});

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

async function loadAdapterManifest(packageDir: string): Promise<AdapterManifest | null> {
  const pkg = await readAdapterPackage(path.join(packageDir, 'package.json'));

  if (!pkg) return null;

  const meta = pkg.autocatalog?.adapter;
  const packageName = pkg.name ?? null;

  if (!packageName || !packageName.startsWith('autocatalog-adapter-')) return null;

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
  const candidates = entries.filter((e) => e.startsWith('autocatalog-adapter-'));
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

async function executeDiscoveryAdapter(input: {
  name: string;
  entry: string;
  exportName: string;
  context: DiscoveryContext;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<DiscoverResult> {
  const major = Number(process.versions.node.split('.')[0]);

  if (major < 24) {
    throw new AdapterExecutionError(
      'adapter_crashed',
      'isolated discovery requires Node.js 24 or newer',
    );
  }

  const entry = await fs.realpath(input.entry);
  const allowRead = await dependencyRoots(entry, input.context.root);
  const { signal: _signal, ...serializableContext } = input.context;

  const args = [
    '--permission',
    '--max-old-space-size=512',
    ...allowRead.map((root) => `--allow-fs-read=${root}`),
    '--input-type=module',
    '--eval',
    ADAPTER_HOST,
    pathToFileURL(entry).href,
    input.exportName,
    Buffer.from(JSON.stringify(serializableContext)).toString('base64url'),
  ];

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: input.context.root,
      env: { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const protocol: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const finish = (error?: Error, result?: DiscoverResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.context.signal?.removeEventListener('abort', abort);

      if (error) reject(error);
      else resolve(result!);
    };

    const abort = () => {
      child.kill('SIGKILL');
      finish(new AdapterExecutionError('adapter_crashed', `${input.name} discovery was aborted`));
    };

    input.context.signal?.addEventListener('abort', abort, { once: true });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new AdapterExecutionError('adapter_timeout', `${input.name} exceeded ${timeoutMs}ms`));
    }, timeoutMs);

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
        const message = discoveryMessage.safeParse(
          JSON.parse(Buffer.concat(protocol).toString('utf8')),
        );

        if (!message.success) throw new Error(`expected ${DISCOVERY_PROTOCOL}`);

        finish(undefined, validateDiscoveryResult(input.name, message.data.result));
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
    name: manifest.packageName.replace(/^autocatalog-adapter-/, ''),
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
    );
  }

  return discovery
    .map((manifest) => createIsolatedDiscoveryAdapter(manifest))
    .sort((a, b) => a.name.localeCompare(b.name));
}
