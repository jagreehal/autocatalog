import path from 'node:path';
import { Command, Option } from 'commander';
import type { CompatibilityMode } from 'autocatalog-core';
import pkg from '../package.json' with { type: 'json' };
import { runValidate } from './commands/validate';
import { discoverAdapters, registerAdapterCommand } from './adapters';
import { registerDeliveryCommands } from './commands/delivery';
import { registerResourceCommands, withScanIdentities } from './commands/resources';

export function buildProgram(): Command {
  const program = new Command();
  program.name('ac').description('Autocatalog CLI').version(pkg.version);
  registerResourceCommands(program);
  registerDeliveryCommands(program);

  program
    .command('validate')
    .description('Validate extracted event contracts in the current project')
    .option('--cwd <dir>', 'project directory', process.cwd())
    .option('-q, --quiet', 'suppress non-error output', false)
    .option('--strict-warnings', 'treat warnings as errors', false)
    .option(
      '--catalog <url|file>',
      "the company site's /catalog.json: check the fields autocatalog.consumes.json reads",
    )
    .option(
      '--catalog-token-env <name>',
      'environment variable holding a token for a private company site',
    )
    .action(
      async (opts: {
        cwd: string;
        quiet: boolean;
        strictWarnings: boolean;
        catalog?: string;
        catalogTokenEnv?: string;
      }) => {
        const code = await runValidate({
          cwd: opts.cwd,
          quiet: opts.quiet,
          strictWarnings: opts.strictWarnings,
          catalog: opts.catalog,
          catalogTokenEnv: opts.catalogTokenEnv,
        });

        process.exit(code);
      },
    );

  withScanIdentities(
    program
      .command('scan [root]')
      .description('Discover event definitions across a repo and generate the catalog')
      .option('-o, --out <dir>', 'events output directory', './events'),
  )
    .option('--allow-code-execution', 'run installed plugins, for a repository you trust', false)
    .option(
      '--snapshot <file>',
      'runtime architecture snapshot to join onto the catalog as observed evidence',
    )
    .option('--conventions <file>', "a shared conventions file, in place of the repository's own")
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (
        root: string | undefined,
        opts: {
          out: string;
          quiet: boolean;
          allowCodeExecution: boolean;
          conventions?: string;
          snapshot?: string;
          traces?: string;
          datastore?: string;
          database?: string;
          service?: string;
          environment?: string;
        },
      ) => {
        const { runScan } = await import('./commands/scan');
        process.exit(
          await runScan({
            root: root ?? process.cwd(),
            out: opts.out,
            quiet: opts.quiet,
            allowCodeExecution: opts.allowCodeExecution,
            snapshot: opts.snapshot,
            conventions: opts.conventions,
            traces: opts.traces,
            datastore: opts.datastore,
            database: opts.database,
            service: opts.service,
            environment: opts.environment,
          }),
        );
      },
    );

  const docs = program
    .command('docs')
    .description('Aggregate and validate repository-owned docs/ roots');

  docs
    .command('check [root]')
    .description('Validate docs frontmatter and the links between repositories')
    .option(
      '--schema <file>',
      'JSON Schema for frontmatter (defaults to contracts/docs-frontmatter.json, then the built-in contract)',
    )
    .option(
      '--conventions <file>',
      'document kinds to enforce (defaults to contracts/autocatalog.conventions.json, then the built-in kinds)',
    )
    .option(
      '--manifest <file>',
      'published index to resolve links against (contracts/docs-manifest.json)',
    )
    .option('--repo <name>', 'name for a single repository publishing its own docs/')
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (
        root: string | undefined,
        opts: {
          schema?: string;
          conventions?: string;
          manifest?: string;
          repo?: string;
          quiet: boolean;
        },
      ) => {
        const { runDocsCheck } = await import('./commands/docs');
        process.exit(await runDocsCheck({ root: root ?? process.cwd(), ...opts }));
      },
    );

  docs
    .command('manifest [root]')
    .description('Publish the aggregated docs index other repositories read')
    .option(
      '--schema <file>',
      'JSON Schema for frontmatter (defaults to contracts/docs-frontmatter.json, then the built-in contract)',
    )
    .option(
      '--conventions <file>',
      'document kinds to enforce (defaults to contracts/autocatalog.conventions.json, then the built-in kinds)',
    )
    .option('--manifest <file>', 'output path (defaults to contracts/docs-manifest.json)')
    .option('--repo <name>', 'name for a single repository publishing its own docs/')
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (
        root: string | undefined,
        opts: {
          schema?: string;
          conventions?: string;
          manifest?: string;
          repo?: string;
          quiet: boolean;
        },
      ) => {
        const { runDocsManifest } = await import('./commands/docs');
        process.exit(await runDocsManifest({ root: root ?? process.cwd(), ...opts }));
      },
    );

  docs
    .command('sync-schema [root]')
    .description('Check this repository’s copy of the contract against the organisation’s')
    .option('--from <source>', 'URL or path of the canonical contract (defaults to its $id)')
    .option('--write', 'take the upstream contract instead of only reporting drift', false)
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (root: string | undefined, opts: { from?: string; write: boolean; quiet: boolean }) => {
        const { runDocsSyncSchema } = await import('./commands/docs');
        process.exit(await runDocsSyncSchema({ root: root ?? process.cwd(), ...opts }));
      },
    );

  docs
    .command('init-schema [root]')
    .description('Write the default frontmatter contract so this organisation owns it')
    .option('--schema <file>', 'output path (defaults to contracts/docs-frontmatter.json)')
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(async (root: string | undefined, opts: { schema?: string; quiet: boolean }) => {
      const { runDocsInitSchema } = await import('./commands/docs');
      process.exit(await runDocsInitSchema({ root: root ?? process.cwd(), ...opts }));
    });

  docs
    .command('import <from>')
    .description('Bring a folder of exported pages into docs/, such as a Notion or Google export')
    .requiredOption('--owner <team>', 'the team that owns these pages')
    .option('--into <dir>', 'where they go', 'docs/imported')
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(async (from: string, opts: { owner: string; into: string; quiet: boolean }) => {
      const { runDocsImport } = await import('./commands/docs');
      process.exit(await runDocsImport({ from, ...opts }));
    });

  docs
    .command('init-conventions [root]')
    .description('Write the default document kinds (ADRs, runbooks, incidents) to edit')
    .option(
      '--conventions <file>',
      'output path (defaults to contracts/autocatalog.conventions.json)',
    )
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(async (root: string | undefined, opts: { conventions?: string; quiet: boolean }) => {
      const { runDocsInitConventions } = await import('./commands/docs');
      process.exit(await runDocsInitConventions({ root: root ?? process.cwd(), ...opts }));
    });

  program
    .command('flows')
    .description('Compare declared flows with code and runtime evidence')
    .command('verify [root]')
    .description(
      'Write what each transition is backed by: lifecycle, schema, code, runtime and rules',
    )
    .option('--observed <file>', 'runtime counts, as autotel-mcp get_state_transitions returns')
    .option('--repo <name>', 'name for a single repository publishing its own flows')
    .option('--write', 'save flows/evidence.json in each repository', false)
    .option('--json', 'print the evidence as JSON', false)
    .action(
      async (
        root: string | undefined,
        opts: { observed?: string; repo?: string; write: boolean; json: boolean },
      ) => {
        const { runFlowsVerify } = await import('./commands/flows');
        process.exit(await runFlowsVerify({ root: root ?? process.cwd(), ...opts }));
      },
    );

  program
    .command('drift')
    .description('Compare the current catalog against a baseline and flag breaking changes')
    .option('--base <dir>', 'baseline events directory (e.g. generated from main)')
    .option('--base-ref <ref>', 'Git ref to scan as the baseline (for example origin/main)')
    .option('--root <dir>', 'source tree to scan with --base-ref', process.cwd())
    .option('--conventions <file>', "a shared conventions file, in place of the repository's own")
    .option('--allow-code-execution', 'run installed plugins, for Git content you trust', false)
    .option('--current <dir>', 'current events directory', './events')
    .addOption(
      new Option('--format <fmt>', 'output format')
        .choices(['text', 'markdown', 'json', 'github'])
        .default('text'),
    )
    .addOption(
      new Option('--fail-on <level>', 'exit nonzero on')
        .choices(['breaking', 'suspicious', 'never'])
        .default('breaking'),
    )
    .addOption(
      new Option(
        '--compatibility <mode>',
        'gate on a Schema Registry strategy instead of severity',
      ).choices(['backward', 'forward', 'full', 'none']),
    )
    .option(
      '--snapshot <file>',
      'runtime architecture snapshot (autotel) to check the current catalog against',
    )
    .option(
      '--base-snapshot <file>',
      "the base's snapshot, so only runtime drift this change introduced fails (default with --base-ref: the same file at that ref)",
    )
    .option(
      '--consumers <url|file>',
      "the company site's /catalog.json: consumers other repositories declare",
    )
    .option(
      '--consumers-token-env <name>',
      'environment variable holding a token for a private company site',
    )
    .option(
      '--repository <name>',
      "this repository's name on the company site (default: from the origin remote)",
    )
    .option('-q, --quiet', 'suppress output', false)
    .action(
      async (opts: {
        consumers?: string;
        consumersTokenEnv?: string;
        repository?: string;
        base?: string;
        baseRef?: string;
        root: string;
        allowCodeExecution: boolean;
        conventions?: string;
        current: string;
        format: 'text' | 'markdown' | 'json' | 'github';
        failOn: 'breaking' | 'suspicious' | 'never';
        compatibility?: CompatibilityMode;
        snapshot?: string;
        baseSnapshot?: string;
        quiet: boolean;
      }) => {
        const { runDrift } = await import('./commands/drift');
        process.exit(
          await runDrift({
            base: opts.base,
            baseRef: opts.baseRef,
            conventions: opts.conventions,
            root: opts.root,
            allowCodeExecution: opts.allowCodeExecution,
            current: opts.current,
            format: opts.format,
            failOn: opts.failOn,
            compatibility: opts.compatibility,
            snapshot: opts.snapshot,
            baseSnapshot: opts.baseSnapshot,
            consumers: opts.consumers,
            consumersTokenEnv: opts.consumersTokenEnv,
            repository: opts.repository,
            quiet: opts.quiet,
          }),
        );
      },
    );

  program
    .command('changelog')
    .description('Render plain-language version-to-version schema changelogs')
    .option('--cwd <dir>', 'project directory', process.cwd())
    .action(async (opts: { cwd: string }) => {
      const { runChangelog } = await import('./commands/changelog');
      process.exit(await runChangelog({ cwd: opts.cwd }));
    });

  program
    .command('from-eventcatalog <dir>')
    .description('Migrate an EventCatalog markdown catalog into Autocatalog manifests')
    .option('-o, --out <dir>', 'events output directory', './events')
    .option(
      '--cwd <dir>',
      'project for commands/ and .autocatalog/ (default: the folder holding --out)',
    )
    .option('--strict', 'exit non-zero if any document was skipped', false)
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (dir: string, opts: { out: string; cwd?: string; quiet: boolean; strict: boolean }) => {
        const { runFromEventCatalog } = await import('./commands/from-eventcatalog');
        process.exit(
          await runFromEventCatalog({
            source: dir,
            out: opts.out,
            cwd: opts.cwd,
            quiet: opts.quiet,
            strict: opts.strict,
          }),
        );
      },
    );

  program
    .command('to-eventcatalog <dir>')
    .description('Write the catalog into an EventCatalog project, through its SDK')
    .option('-r, --root <dir...>', 'published events roots, one per repository', ['./events'])
    .option(
      '--narrative',
      "copy each event's index.mdx narrative; EventCatalog compiles it as MDX and runs any code in it, so only for repositories you trust",
      false,
    )
    .action(async (dir: string, opts: { root: string[]; narrative: boolean }) => {
      const { exportToEventCatalog, loadEventCatalogSources } = await import('./eventcatalog');

      const result = await exportToEventCatalog({
        catalogs: await loadEventCatalogSources(opts.root.map((root) => path.resolve(root))),
        catalogDir: path.resolve(dir),
        narrative: opts.narrative,
      }).catch((error: Error) => {
        console.error(error.message);
        process.exit(1);
      });

      console.log(
        `Wrote ${result.events} event(s) in ${result.versions} version(s), ${result.commands} command(s) and queries, ${result.services} service(s), ${result.dataStores} data store(s) and ${result.teams} team(s) across ${result.domains} domain(s) to ${dir}`,
      );

      for (const reason of result.skipped) console.warn(`  ! ${reason}`);
    });

  program
    .command('to-asyncapi')
    .description('Write the catalog as an AsyncAPI 3.0 document, for mock servers and consumers')
    .option('-r, --root <dir>', 'events root', './events')
    .option('-o, --out <file>', 'output file; .json for JSON, otherwise YAML', 'asyncapi.yaml')
    .option('-s, --service <name>', "one service's view: what it sends and receives")
    .option('--commands <dir>', 'a folder whose command manifests join the document')
    .option('--title <title>', 'document title')
    .option('--doc-version <version>', 'document version', '1.0.0')
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (opts: {
        root: string;
        out: string;
        service?: string;
        commands?: string;
        title?: string;
        docVersion: string;
        quiet: boolean;
      }) => {
        const { runToAsyncApi } = await import('./commands/to-asyncapi');
        process.exit(
          await runToAsyncApi({
            root: opts.root,
            out: opts.out,
            service: opts.service,
            commands: opts.commands,
            title: opts.title,
            version: opts.docVersion,
            quiet: opts.quiet,
          }),
        );
      },
    );

  program
    .command('from-asyncapi <file>')
    .description('Import events from an AsyncAPI 2.x/3.x document')
    .option('-o, --out <dir>', 'events output directory', './events')
    .option('--strict', 'exit non-zero if any message was skipped', false)
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(async (file: string, opts: { out: string; quiet: boolean; strict: boolean }) => {
      const { runFromAsyncApi } = await import('./commands/from-asyncapi');
      process.exit(
        await runFromAsyncApi({ file, out: opts.out, quiet: opts.quiet, strict: opts.strict }),
      );
    });

  program
    .command('from-snapshot <file>')
    .description(
      'Write draft events from a runtime snapshot (autotel), for a repository with no contracts yet',
    )
    .option('-o, --out <dir>', 'events output directory', './events')
    .option(
      '--domain <name>',
      'domain for events the snapshot names without one (default: its service)',
    )
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(async (file: string, opts: { out: string; domain?: string; quiet: boolean }) => {
      const { runFromSnapshot } = await import('./commands/from-snapshot');
      process.exit(
        await runFromSnapshot({ file, out: opts.out, domain: opts.domain, quiet: opts.quiet }),
      );
    });

  program
    .command('retire <event> [field]')
    .description(
      'Say whether a field, or a whole event, can be removed yet: each consumer, where it stands, and what has to happen first',
    )
    .option('--events <dir>', 'events directory', './events')
    .option(
      '--catalog <url|file>',
      "the company site's /catalog.json: consumers other repositories declare",
    )
    .option(
      '--catalog-token-env <name>',
      'environment variable holding a bearer token for --catalog',
    )
    .option('--repository <name>', "this repository's name on the company site")
    .option(
      '--snapshot <file>',
      'runtime architecture snapshot (autotel): who was seen receiving it',
    )
    .option('--pacts <path|url>', 'a pact file, a folder of them, or a Pact Broker base URL')
    .option(
      '--pact-provider <name>',
      "the provider's name in the broker (default: the event's producer)",
    )
    .option('--pact-token-env <name>', 'environment variable holding a bearer token for the broker')
    .option('--format <format>', 'markdown | json', 'markdown')
    .option('-q, --quiet', 'only the exit code: 0 ready, 1 blocked', false)
    .action(
      async (
        event: string,
        field: string | undefined,
        opts: {
          events: string;
          catalog?: string;
          catalogTokenEnv?: string;
          repository?: string;
          snapshot?: string;
          pacts?: string;
          pactProvider?: string;
          pactTokenEnv?: string;
          format: 'markdown' | 'json';
          quiet: boolean;
        },
      ) => {
        const { runRetire } = await import('./commands/retire');
        process.exit(await runRetire({ event, ...(field !== undefined && { field }), ...opts }));
      },
    );

  program
    .command('health')
    .description('Score each event on completeness, ownership, examples, and versioning')
    .option('--cwd <dir>', 'project directory', process.cwd())
    .option('--min <score>', 'exit nonzero if any event scores below this', (v) => parseInt(v, 10))
    .action(async (opts: { cwd: string; min?: number }) => {
      const { runHealth } = await import('./commands/health');
      process.exit(await runHealth({ cwd: opts.cwd, min: opts.min }));
    });

  program
    .command('fields [query]')
    .description('Show which events carry a field, and which consumers it reaches')
    .option('--cwd <dir>', 'project directory', process.cwd())
    .option('--json', 'emit the field index as JSON', false)
    .option('--conflicts-only', 'only fields whose type or requiredness disagrees', false)
    .option('-q, --quiet', 'suppress output', false)
    .action(
      async (
        query: string | undefined,
        opts: { cwd: string; json: boolean; conflictsOnly: boolean; quiet: boolean },
      ) => {
        const { runFields } = await import('./commands/fields');
        process.exit(
          await runFields({
            cwd: opts.cwd,
            query,
            json: opts.json,
            conflictsOnly: opts.conflictsOnly,
            quiet: opts.quiet,
          }),
        );
      },
    );

  program
    .command('import')
    .description('Import event schemas/examples from a GitHub repo via gh clone')
    .option('--github-repo <owner/repo>', 'GitHub repo, e.g. acme/contracts')
    .option('--ref <ref>', 'branch, tag, or SHA to clone')
    .option('--manifest-path <path>', 'path to JSON manifest inside the repo')
    .option(
      '--manifest-url <url>',
      'HTTPS URL to a JSON manifest (raw.githubusercontent.com/github.com only)',
    )
    .option('--id <id>', 'event id (single-event mode)')
    .option('--domain <domain>', 'event domain (single-event mode)')
    .option('--version <version>', 'event version (single-event mode)')
    .option('--name <name>', 'display name (single-event mode)')
    .option('--summary <summary>', 'summary text (single-event mode)')
    .option('--schema-path <path>', 'schema.json path inside repo (single-event mode)')
    .option('--schema-url <url>', 'HTTPS URL to schema.json (single-event mode)')
    .option(
      '--example-path <path>',
      'example JSON path inside repo (repeatable)',
      (v, prev: string[]) => {
        prev.push(v);

        return prev;
      },
      [],
    )
    .option(
      '--example-url <url>',
      'example JSON URL (repeatable)',
      (v, prev: string[]) => {
        prev.push(v);

        return prev;
      },
      [],
    )
    .option('--dry-run', 'plan import without writing files', false)
    .option('--github-token-env <name>', 'env var containing a GitHub token for gh auth')
    .option('--clone-with <strategy>', 'clone strategy: gh or git', 'gh')
    .option(
      '--allow-host <host>',
      'allow additional remote host for URL import (repeatable)',
      (v, prev: string[]) => {
        prev.push(v);

        return prev;
      },
      [],
    )
    .option('--timeout-ms <ms>', 'network timeout in milliseconds', '10000')
    .option('--max-bytes <n>', 'max bytes per fetched remote file', `${2 * 1024 * 1024}`)
    .option('--overwrite', 'overwrite existing destination event folder', false)
    .option('--strict-warnings', 'treat warnings as errors after import', false)
    .option('--cwd <dir>', 'project directory', process.cwd())
    .action(
      async (opts: {
        githubRepo?: string;
        ref?: string;
        manifestPath?: string;
        manifestUrl?: string;
        id?: string;
        domain?: string;
        version?: string;
        name?: string;
        summary?: string;
        schemaPath?: string;
        schemaUrl?: string;
        examplePath: string[];
        exampleUrl: string[];
        dryRun: boolean;
        githubTokenEnv?: string;
        cloneWith: 'gh' | 'git';
        allowHost: string[];
        timeoutMs: string;
        maxBytes: string;
        overwrite: boolean;
        strictWarnings: boolean;
        cwd: string;
      }) => {
        const { runImport } = await import('./commands/import');
        process.exit(
          await runImport({
            cwd: opts.cwd,
            githubRepo: opts.githubRepo,
            ref: opts.ref,
            manifestPath: opts.manifestPath,
            manifestUrl: opts.manifestUrl,
            id: opts.id,
            domain: opts.domain,
            version: opts.version,
            name: opts.name,
            summary: opts.summary,
            schemaPath: opts.schemaPath,
            schemaUrl: opts.schemaUrl,
            examplePaths: opts.examplePath,
            exampleUrls: opts.exampleUrl,
            dryRun: opts.dryRun,
            githubTokenEnv: opts.githubTokenEnv,
            cloneWith: opts.cloneWith,
            allowedHosts: opts.allowHost.length > 0 ? opts.allowHost : undefined,
            timeoutMs: Number(opts.timeoutMs),
            maxBytes: Number(opts.maxBytes),
            overwrite: opts.overwrite,
            strictWarnings: opts.strictWarnings,
          }),
        );
      },
    );

  program
    .command('check [root]')
    .description('Check what this repository publishes, as its pull request should')
    .option('--base-ref <ref>', 'also compare contracts against this ref, e.g. origin/main')
    .option('--allow-code-execution', 'run committed rules, for a repository you trust', false)
    .addOption(
      new Option('--format <fmt>', 'output format').choices(['text', 'github']).default('text'),
    )
    .action(
      async (
        root: string | undefined,
        opts: { baseRef?: string; format: 'text' | 'github'; allowCodeExecution: boolean },
      ) => {
        const { runCheck } = await import('./commands/check');
        process.exit(await runCheck({ ...opts, root: root ?? '.' }));
      },
    );

  program
    .command('site [root]')
    .description(
      'Build the company index: docs, events, services and fields from every enrolled repository',
    )
    .option('--topic <topic>', 'clone every repository with this GitHub topic (needs --owner)')
    .option('--owner <owner>', 'GitHub user or organisation that owns the enrolled repositories')
    .option('--repo <url...>', 'clone these repositories as well')
    .option('--cache <dir>', 'where clones go', '.autocatalog/repos')
    .option('-o, --out <dir>', 'output directory', 'dist')
    .option('--site <url>', 'origin the site is deployed at, for the sitemap and llms.txt')
    .option('--base <path>', 'path the site is served under, e.g. /docs/')
    .option('--title <text>', 'site title')
    .option('--description <text>', 'one sentence for the home page and llms.txt')
    .option('--brand <dir>', 'your logo.*, logo-dark.*, favicon.svg and theme.css')
    .option('--theme <name>', 'an accent colour: teal, blue, orange, green or purple')
    .option(
      '--audience <name>',
      'build for readers outside, e.g. public: the documents naming them and the API references',
    )
    .option('--fingerprint', 'print a hash of what is enrolled, and build nothing', false)
    .option('--dev', 'serve with live reload instead of building', false)
    .option('--eventcatalog', 'install EventCatalog and embed its diagrams in the site', false)
    .option(
      '--docs-schema <file>',
      'docs frontmatter contract to enforce (defaults to <root>/contracts/docs-frontmatter.json, then the one an enrolled repository publishes)',
    )
    .option(
      '--docs-conventions <file>',
      'document kinds to publish (defaults to <root>/contracts/autocatalog.conventions.json, then the one an enrolled repository publishes)',
    )
    .option(
      '--pages <dir>',
      'your own pages and API routes, laid out as src/pages/ is (.astro, .md, .mdx, endpoint .ts)',
    )
    .option('--live-url <url>', "a server-sent events feed the maps' Live mode follows")
    .option('--live-event <name>', 'the SSE event name its frames arrive under (default: message)')
    .option(
      '--lock <file>',
      'the lock pinning each enrolled repository (default: autocatalog.lock.json, when it exists)',
    )
    .option(
      '--unlocked',
      'build enrolled repositories at their latest commits, ignoring the lock',
      false,
    )
    .option('--index <url...>', "another site's /catalog.json, joined into the graph without pages")
    .action(
      async (
        root: string | undefined,
        opts: {
          topic?: string;
          owner?: string;
          repo?: string[];
          cache: string;
          out: string;
          site?: string;
          base?: string;
          title?: string;
          dev: boolean;
          eventcatalog: boolean;
          docsSchema?: string;
          docsConventions?: string;
          pages?: string;
          brand?: string;
          theme?: string;
          audience?: string;
          fingerprint: boolean;
          description?: string;
          liveUrl?: string;
          liveEvent?: string;
          lock?: string;
          unlocked: boolean;
          index?: string[];
        },
      ) => {
        const { runSite } = await import('./commands/site');
        process.exit(
          await runSite({
            ...opts,
            root: root ?? '.',
            rootGiven: root !== undefined,
            repos: opts.repo,
            indexes: opts.index,
          }),
        );
      },
    );

  const federation = program
    .command('federation')
    .description(
      'Pin and check the repositories and EventCatalog projects a company site federates',
    );

  federation
    .command('lock')
    .description('Pin every enrolled repository to its current commit in autocatalog.lock.json')
    .option('--topic <topic>', 'every repository with this GitHub topic (needs --owner)')
    .option('--owner <owner>', 'GitHub user or organisation that owns them')
    .option('--repo <url...>', 'these repositories as well')
    .option('--only <name...>', 'move only these pins, keeping every other as it is')
    .option('--ref <ref>', 'pin this tag, branch or full commit SHA instead of the latest commit')
    .option('--latest-tag', "pin each repository's newest release tag, skipping prereleases")
    .option(
      '--service <service=repository...>',
      'who owns a service more than one repository claims, or a pin to move',
    )
    .option('--lock <file>', 'the lock file', 'autocatalog.lock.json')
    .option('--cache <dir>', 'where clones go', '.autocatalog/repos')
    .action(
      async (opts: {
        topic?: string;
        owner?: string;
        repo?: string[];
        only?: string[];
        ref?: string;
        latestTag?: boolean;
        service?: string[];
        lock: string;
        cache: string;
      }) => {
        const { runFederationLock } = await import('./federation');
        process.exit(await runFederationLock({ ...opts, repos: opts.repo }));
      },
    );

  federation
    .command('status [root]')
    .description(
      'What each federated source contributes: its pin, resources, and references that do not resolve',
    )
    .option('--topic <topic>', 'every repository with this GitHub topic (needs --owner)')
    .option('--owner <owner>', 'GitHub user or organisation that owns them')
    .option('--repo <url...>', 'these repositories as well')
    .option(
      '--lock <file>',
      'the lock pinning them (default: autocatalog.lock.json, when it exists)',
    )
    .option('--cache <dir>', 'where clones go', '.autocatalog/repos')
    .option('--format <fmt>', 'text or json', 'text')
    .action(
      async (
        root: string | undefined,
        opts: {
          topic?: string;
          owner?: string;
          repo?: string[];
          lock?: string;
          cache: string;
          format: 'text' | 'json';
        },
      ) => {
        const { runFederationStatus } = await import('./federation');
        process.exit(await runFederationStatus({ ...opts, root: root ?? '.', repos: opts.repo }));
      },
    );

  program
    .command('mcp-sweep')
    .description('List every MCP server a GitHub owner builds or uses, across its repositories')
    .option('--owner <owner>', 'GitHub user or organisation to sweep')
    .option('--topic <topic>', 'only repositories with this topic (needs --owner)')
    .option('--repo <url...>', 'these repositories as well')
    .option('--root <dir>', 'the catalog to write into', '.')
    .option('--internal <values>', 'hosts and package scopes the company owns, comma separated')
    .option('--prune', 'remove servers no repository names any more')
    .option('--dry-run', 'print the inventory without writing')
    .option('--cache <dir>', 'where clones go', '.autocatalog/mcp-sweep')
    .action(
      async (opts: {
        owner?: string;
        topic?: string;
        repo?: string[];
        root: string;
        internal?: string;
        prune?: boolean;
        dryRun?: boolean;
        cache: string;
      }) => {
        const { runMcpSweep } = await import('./commands/mcp-sweep');
        process.exit(await runMcpSweep({ ...opts, repos: opts.repo }));
      },
    );

  program
    .command('agents')
    .description('Agent catalog commands (validate, impact, cost, audit, drift, discover, mcp)')
    .allowUnknownOption()
    .helpOption(false)
    .argument('[command...]', 'run `ac agents --help` for the list')
    .action(async () => {
      process.exit(await runAgents(process.argv.slice(3)));
    });

  return program;
}

/**
 * Reach the agent commands when their package is installed, and say how to get
 * them when it is not. Deliberately not a dependency: an events-only project
 * should not install the agent model to run `ac scan`.
 */
export async function runAgents(argv: string[]): Promise<number> {
  try {
    const { runAgentsCli } = await import('autocatalog-agents-cli');

    return await runAgentsCli(argv);
  } catch (error) {
    const missing =
      error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND';

    if (!missing) throw error;
    console.error(
      'Agent commands need autocatalog-agents-cli:\n  pnpm add -D autocatalog-agents-cli',
    );

    return 1;
  }
}

export async function buildProgramWithAdapters(cwd: string): Promise<Command> {
  const program = buildProgram();
  const adapters = await discoverAdapters(cwd);

  for (const a of adapters) registerAdapterCommand(program, a);

  return program;
}
