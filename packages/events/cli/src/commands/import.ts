import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import kleur from 'kleur';
import {
  jsonObjectSchema,
  loadCatalog,
  loadedEventToAdapterEvent,
  pascalCase,
  publishCatalog,
  type AdapterEvent,
} from 'autocatalog-core';
import { z } from 'zod';
import { runValidate } from './validate';

export interface ImportEventFromManifest {
  id: string;
  domain: string;
  version: string;
  name?: string;
  summary?: string;
  schemaPath?: string;
  examplePaths?: string[];
  schemaUrl?: string;
  exampleUrls?: string[];
}

export interface ImportManifest {
  events: ImportEventFromManifest[];
}

const paths = z.array(z.string()).optional();

const importEvent = z.object({
  id: z.string(),
  domain: z.string(),
  version: z.string(),
  name: z.string().optional(),
  summary: z.string().optional(),
  schemaPath: z.string().optional(),
  examplePaths: paths,
  schemaUrl: z.string().optional(),
  exampleUrls: paths,
}) satisfies z.ZodType<ImportEventFromManifest>;

/** Parse a manifest's JSON text at the boundary; `source` names it in errors. */
function parseManifest(text: string, source: string): ImportManifest {
  const listed = z.object({ events: z.array(z.unknown()).min(1) }).safeParse(JSON.parse(text));

  if (!listed.success) throw new Error(`manifest has no events: ${source}`);

  return {
    events: listed.data.events.map((entry, i) => {
      const evt = importEvent.safeParse(entry);

      if (!evt.success) {
        throw new Error(
          `manifest event ${i + 1} is invalid (${source}): ${z.prettifyError(evt.error)}`,
        );
      }

      return evt.data;
    }),
  };
}

export type CloneStrategy = 'gh' | 'git';

export interface RunImportOptions {
  cwd: string;
  githubRepo?: string;
  ref?: string;
  overwrite?: boolean;
  strictWarnings?: boolean;
  manifestPath?: string;
  manifestUrl?: string;
  id?: string;
  domain?: string;
  version?: string;
  name?: string;
  summary?: string;
  schemaPath?: string;
  examplePaths?: string[];
  schemaUrl?: string;
  exampleUrls?: string[];
  dryRun?: boolean;
  githubTokenEnv?: string;
  cloneWith?: CloneStrategy;
  timeoutMs?: number;
  maxBytes?: number;
  allowedHosts?: string[];
}

interface RemoteFile {
  source: string;
  bytes: Uint8Array;
}

/** Enough hops for a normal CDN or shortener chain, few enough to end. */
const MAX_REDIRECTS = 5;

function isHttpUrl(v: string): boolean {
  return /^https?:\/\//.test(v);
}

function toRawGithubUrl(input: string): string {
  if (!input.startsWith('https://github.com/')) return input;
  const m = input.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);

  if (!m) return input;

  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
}

function ensureAllowedRemoteUrl(url: string, allowedHosts: Set<string>): void {
  const u = new URL(url);

  const isLocalHttp =
    u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');

  if (u.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(`Only https URLs are allowed: ${url}`);
  }

  if (!allowedHosts.has(u.hostname)) {
    throw new Error(`URL host not allowed: ${u.hostname}`);
  }
}

export async function fetchRemoteJson(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  allowedHosts: Set<string>,
): Promise<RemoteFile> {
  let target = toRawGithubUrl(url);
  ensureAllowedRemoteUrl(target, allowedHosts);

  // Redirects are followed by hand so every hop is checked before it is
  // requested. Letting fetch follow them and inspecting `response.url`
  // afterwards is too late: the request to the unapproved host has already
  // been made, which is the whole of an SSRF against an internal address.
  let res: Response | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    res = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status < 300 || res.status >= 400) break;

    const location = res.headers.get('location');

    if (!location) throw new Error(`Redirect without a location: ${target}`);

    if (hop === MAX_REDIRECTS) throw new Error(`Too many redirects: ${url}`);
    // Relative locations resolve against the hop they came from.
    target = new URL(location, target).toString();
    ensureAllowedRemoteUrl(target, allowedHosts);
  }

  if (!res) throw new Error(`Failed to fetch ${target}`);

  if (!res.ok) {
    throw new Error(`Failed to fetch ${target}: ${res.status} ${res.statusText}`);
  }

  const buf = new Uint8Array(await res.arrayBuffer());

  if (buf.byteLength > maxBytes) {
    throw new Error(`Remote file too large (${buf.byteLength} bytes): ${target}`);
  }

  return { source: target, bytes: buf };
}

async function ensureCmdAvailable(cmd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, ['--version'], { stdio: 'ignore' });
    child.on('error', () => reject(new Error(`${cmd} not found in PATH`)));
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} is not available`)),
    );
  });
}

async function cloneRepo(input: {
  strategy: CloneStrategy;
  repo: string;
  dest: string;
  ref?: string;
  githubTokenEnv?: string;
}): Promise<void> {
  if (input.strategy === 'gh') {
    await ensureCmdAvailable('gh');
    const args = ['repo', 'clone', input.repo, input.dest, '--', '--depth', '1'];

    if (input.ref) args.push('--branch', input.ref, '--single-branch');
    await new Promise<void>((resolve, reject) => {
      const env = { ...process.env };

      if (input.githubTokenEnv) {
        const token = process.env[input.githubTokenEnv];

        if (!token) {
          reject(new Error(`env var ${input.githubTokenEnv} is not set`));

          return;
        }

        env.GH_TOKEN = token;
      }

      const child = spawn('gh', args, { stdio: 'inherit', env });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`gh clone failed with exit code ${code ?? 1}`));
      });
    });

    return;
  }

  await ensureCmdAvailable('git');
  const args = ['clone', '--depth', '1'];

  if (input.ref) args.push('--branch', input.ref, '--single-branch');
  args.push(input.repo, input.dest);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git clone failed with exit code ${code ?? 1}`));
    });
  });
}

/**
 * Resolve a path supplied by an imported manifest, refusing to leave the clone.
 *
 * Everything here comes from a repository someone else wrote: a manifest can
 * ask for `../../private.json`, an absolute path (which would discard the root
 * entirely), or a symlink committed inside the clone that points anywhere on
 * the machine. The lexical check catches the first two; resolving the real path
 * catches the third.
 */
export async function resolveInsideClone(root: string, relative: string): Promise<string> {
  // Both sides are resolved from the same base. Comparing a real path against
  // a non-real root reports every file as an escape wherever the temp
  // directory is itself a symlink, which is the default on macOS.
  const realRoot = await fs.realpath(root);
  const abs = path.resolve(realRoot, relative);
  const lexical = path.relative(realRoot, abs);

  if (lexical === '' || lexical.startsWith('..') || path.isAbsolute(lexical)) {
    throw new Error(`path escapes the imported repository: ${relative}`);
  }

  const real = await fs.realpath(abs).catch((error: NodeJS.ErrnoException) => {
    // Missing files are the caller's problem to report, not a containment
    // failure; the read that follows produces the better message.
    if (error.code === 'ENOENT') return abs;
    throw error;
  });

  const resolved = path.relative(realRoot, real);

  if (resolved === '' || resolved.startsWith('..') || path.isAbsolute(resolved)) {
    throw new Error(`path escapes the imported repository via a link: ${relative}`);
  }

  return abs;
}

async function loadSourceFile(spec: {
  cloneDir?: string;
  path?: string;
  url?: string;
  timeoutMs: number;
  maxBytes: number;
  allowedHosts: Set<string>;
}): Promise<RemoteFile> {
  if (spec.url) {
    return fetchRemoteJson(spec.url, spec.timeoutMs, spec.maxBytes, spec.allowedHosts);
  }

  if (!spec.cloneDir || !spec.path) {
    throw new Error('missing source path');
  }

  const abs = await resolveInsideClone(spec.cloneDir, spec.path);
  const data = await fs.readFile(abs);

  return { source: spec.path, bytes: new Uint8Array(data) };
}

interface PreparedImport {
  event: AdapterEvent;
  narrative: { domain: string; folderName: string; body: string };
}

async function prepareImportedEvent(input: {
  id: string;
  domain: string;
  version: string;
  name?: string;
  summary?: string;
  schema: RemoteFile;
  examples: RemoteFile[];
  sourceType: 'github_clone' | 'url';
  githubRepo?: string;
  ref?: string;
}): Promise<PreparedImport> {
  const folderName = pascalCase(input.id);

  const parsedSchema = jsonObjectSchema.safeParse(
    JSON.parse(Buffer.from(input.schema.bytes).toString('utf8')),
  );

  if (!parsedSchema.success) throw new Error(`Schema for ${input.id} is not a JSON object`);
  const schema = parsedSchema.data;

  const examples: AdapterEvent['examples'] = [];

  for (let i = 0; i < input.examples.length; i++) {
    const ex = JSON.parse(Buffer.from(input.examples[i]!.bytes).toString('utf8'));

    const srcName = isHttpUrl(input.examples[i]!.source)
      ? path.basename(new URL(input.examples[i]!.source).pathname)
      : path.basename(input.examples[i]!.source);

    const base = srcName ? path.basename(srcName, path.extname(srcName)) : `example-${i + 1}`;
    examples.push({ name: base, data: ex });
  }

  const displayName = input.name ?? pascalCase(input.id).replace(/([a-z])([A-Z])/g, '$1 $2');
  const summary = input.summary ?? `Imported ${input.id}`;

  return {
    event: {
      id: input.id,
      version: input.version,
      name: displayName,
      summary,
      domain: input.domain,
      folderName,
      schema,
      examples,
      meta: { status: 'draft' },
      source: {
        type: input.sourceType,
        repo: input.githubRepo,
        ref: input.ref,
        schema: input.schema.source,
      },
      provenance: { default: 'declared', fields: {} },
    },
    narrative: { domain: input.domain, folderName, body: 'Imported by Autocatalog.\n' },
  };
}

function validateInputs(opts: RunImportOptions): string | null {
  if (!opts.githubRepo && !opts.manifestUrl && !opts.schemaUrl) {
    return 'one source is required: --github-repo or --manifest-url or --schema-url';
  }

  if (opts.manifestPath || opts.manifestUrl) return null;

  if (!opts.id || !opts.domain || !opts.version || (!opts.schemaPath && !opts.schemaUrl)) {
    return 'single-event import requires --id --domain --version and one of --schema-path/--schema-url (or use manifest)';
  }

  return null;
}

export async function runImport(opts: RunImportOptions): Promise<number> {
  const inputError = validateInputs(opts);

  if (inputError) {
    console.error(kleur.red(`✗ ${inputError}`));

    return 1;
  }

  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const allowedHosts = new Set(opts.allowedHosts ?? ['raw.githubusercontent.com', 'github.com']);
  const dryRun = Boolean(opts.dryRun);
  const ref = opts.ref ?? 'HEAD';
  const strategy = opts.cloneWith ?? 'gh';
  const overwrite = Boolean(opts.overwrite);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-import-'));
  const cloneDir = path.join(tempRoot, 'repo');
  let imported = 0;
  const prepared: PreparedImport[] = [];

  try {
    if (opts.githubRepo) {
      console.log(
        kleur.blue(
          `→ cloning ${opts.githubRepo}${opts.ref ? `#${opts.ref}` : ''} with ${strategy}`,
        ),
      );
      await cloneRepo({
        strategy,
        repo: opts.githubRepo,
        dest: cloneDir,
        ref: opts.ref,
        githubTokenEnv: opts.githubTokenEnv,
      });
    }

    if (opts.manifestUrl) {
      const remote = await fetchRemoteJson(opts.manifestUrl, timeoutMs, maxBytes, allowedHosts);
      const manifest = parseManifest(Buffer.from(remote.bytes).toString('utf8'), remote.source);

      for (const evt of manifest.events) {
        const schema = await loadSourceFile({
          path: evt.schemaPath,
          url: evt.schemaUrl,
          timeoutMs,
          maxBytes,
          allowedHosts,
        });

        const examples: RemoteFile[] = [];

        for (const p of evt.exampleUrls ?? [])
          examples.push(await fetchRemoteJson(p, timeoutMs, maxBytes, allowedHosts));

        for (const p of evt.examplePaths ?? []) {
          throw new Error(
            `manifest-url mode does not support examplePaths (${p}); use exampleUrls`,
          );
        }

        prepared.push(
          await prepareImportedEvent({
            id: evt.id,
            domain: evt.domain,
            version: evt.version,
            name: evt.name,
            summary: evt.summary,
            schema,
            examples,
            sourceType: 'url',
          }),
        );
        imported += 1;
      }
    } else if (opts.manifestPath) {
      const manifestAbs = await resolveInsideClone(cloneDir, opts.manifestPath);
      const manifest = parseManifest(await fs.readFile(manifestAbs, 'utf8'), opts.manifestPath);

      for (const evt of manifest.events) {
        const schema = await loadSourceFile({
          cloneDir,
          path: evt.schemaPath,
          url: evt.schemaUrl,
          timeoutMs,
          maxBytes,
          allowedHosts,
        });

        const examples: RemoteFile[] = [];

        for (const p of evt.examplePaths ?? []) {
          examples.push(
            await loadSourceFile({ cloneDir, path: p, timeoutMs, maxBytes, allowedHosts }),
          );
        }

        for (const p of evt.exampleUrls ?? [])
          examples.push(await fetchRemoteJson(p, timeoutMs, maxBytes, allowedHosts));
        prepared.push(
          await prepareImportedEvent({
            id: evt.id,
            domain: evt.domain,
            version: evt.version,
            name: evt.name,
            summary: evt.summary,
            schema,
            examples,
            sourceType: evt.schemaUrl ? 'url' : 'github_clone',
            githubRepo: opts.githubRepo,
            ref,
          }),
        );
        imported += 1;
      }
    } else {
      const schema = await loadSourceFile({
        cloneDir: opts.schemaPath ? cloneDir : undefined,
        path: opts.schemaPath,
        url: opts.schemaUrl,
        timeoutMs,
        maxBytes,
        allowedHosts,
      });

      const examples: RemoteFile[] = [];

      for (const p of opts.examplePaths ?? []) {
        examples.push(
          await loadSourceFile({ cloneDir, path: p, timeoutMs, maxBytes, allowedHosts }),
        );
      }

      for (const p of opts.exampleUrls ?? [])
        examples.push(await fetchRemoteJson(p, timeoutMs, maxBytes, allowedHosts));
      prepared.push(
        await prepareImportedEvent({
          id: opts.id!,
          domain: opts.domain!,
          version: opts.version!,
          name: opts.name,
          summary: opts.summary,
          schema,
          examples,
          sourceType: opts.schemaUrl ? 'url' : 'github_clone',
          githubRepo: opts.githubRepo,
          ref,
        }),
      );
      imported = 1;
    }

    const eventsRoot = path.join(opts.cwd, 'events');

    const existing = await fs
      .access(eventsRoot)
      .then(() => loadCatalog(eventsRoot, { skipVersioned: true }))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });

    const desired = new Map<string, ReturnType<typeof loadedEventToAdapterEvent>>(
      existing.map((loaded) => {
        const event = loadedEventToAdapterEvent(loaded);

        return [`${event.domain}/${event.folderName}`, event] as const;
      }),
    );

    for (const item of prepared) {
      const key = `${item.event.domain}/${item.event.folderName}`;

      if (desired.has(key) && !overwrite) {
        throw new Error(`events/${key} already exists (use --overwrite)`);
      }

      desired.set(key, item.event);
    }

    if (dryRun) {
      console.log(kleur.green(`✓ dry-run: ${imported} event(s) ready to import`));

      return 0;
    }

    await publishCatalog({
      outRoot: eventsRoot,
      events: [...desired.values()],
      narratives: prepared.map((item) => item.narrative),
    });
    console.log(kleur.green(`✓ imported ${imported} event(s) to ${eventsRoot}`));
    console.log(
      kleur.dim('  Commit it: these are copies, and only re-running the import updates them.'),
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return runValidate({ cwd: opts.cwd, strictWarnings: Boolean(opts.strictWarnings) });
}
