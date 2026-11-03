import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const run = promisify(execFile);

/** The fields of GitHub's repository listing that enrolment reads. */
const githubRepositories = z.array(
  z.object({
    name: z.string(),
    clone_url: z.string(),
    archived: z.boolean().optional(),
    fork: z.boolean().optional(),
    topics: z.array(z.string()).optional(),
  }),
);

/**
 * Enrolment: which repositories the company index reads. A repository opts in
 * by carrying a GitHub topic, so no central list names it and no aggregator
 * owner has to approve it. `--repo` names repositories directly instead.
 */
export interface EnrolledRepository {
  name: string;
  cloneUrl: string;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface ListRepositoriesOptions {
  owner: string;
  /** Only repositories with this topic. Without one, every repository the owner keeps. */
  topic?: string | undefined;
  /** Reads private repositories and lifts the unauthenticated rate limit. */
  token?: string;
  fetch?: FetchLike;
}

/**
 * Every non-archived repository an owner has, with the topic when one is given,
 * or leaving out forks when not: a fork is someone else's code. Lists the owner's
 * repositories rather than using search, because the search index can lag a
 * topic change by minutes and a build should see the enrolment that was made.
 */
export async function listRepositories(
  opts: ListRepositoriesOptions,
): Promise<EnrolledRepository[]> {
  const get = opts.fetch ?? fetch;

  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'autocatalog',
    ...(opts.token && { authorization: `Bearer ${opts.token}` }),
  };

  const page = async (kind: 'orgs' | 'users', n: number) => {
    const url = `https://api.github.com/${kind}/${encodeURIComponent(opts.owner)}/repos?per_page=100&page=${n}`;

    return get(url, { headers });
  };

  // An owner is an organisation or a user; the API has one listing for each.
  let kind: 'orgs' | 'users' = 'orgs';
  let response = await page(kind, 1);

  if (response.status === 404) {
    kind = 'users';
    response = await page(kind, 1);
  }

  const repositories: EnrolledRepository[] = [];

  for (let n = 1; ; n += 1) {
    if (n > 1) response = await page(kind, n);

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} listing ${opts.owner}'s repositories`);
    }

    const batch = githubRepositories.parse(await response.json());

    for (const repo of batch) {
      const wanted = opts.topic ? repo.topics?.includes(opts.topic) : !repo.fork;

      if (!repo.archived && wanted) {
        repositories.push({ name: repo.name, cloneUrl: repo.clone_url });
      }
    }

    if (batch.length < 100) break;
  }

  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}

/** `https://github.com/acme/payments.git` → payments */
export function repositoryName(url: string): string {
  return path.basename(url.replace(/\/+$/, '')).replace(/\.git$/, '');
}

export interface CloneOptions {
  into: string;
  token?: string;
  /** Just the latest commit, for a scan that has no use for history. */
  shallow?: boolean;
}

/** Enough to keep the network busy without opening hundreds of connections at once. */
const CLONES_AT_ONCE = 8;

/** A repository that could not be cloned, and what git said. */
export interface CloneFailure {
  name: string;
  reason: string;
}

export interface ClonedRepositories {
  root: string;
  /** The repositories now checked out under `root`, by name. */
  cloned: string[];
  failed: CloneFailure[];
}

/**
 * git's arguments that send the token with requests to `url`: as a header,
 * never in the URL, so it is not written into .git/config or echoed in an
 * error. Only over HTTPS to GitHub, or the host in GITHUB_SERVER_URL, so a URL
 * a lock or `--repo` names elsewhere never receives it.
 */
export function tokenHeader(url: string, token: string | undefined): string[] {
  if (!token) return [];

  const host = (value: string | undefined) => {
    try {
      return value ? new URL(value) : undefined;
    } catch {
      return undefined;
    }
  };

  const target = host(url);
  const github = new Set(['github.com', host(process.env.GITHUB_SERVER_URL)?.host]);

  if (target?.protocol !== 'https:' || !github.has(target.host.toLowerCase())) return [];

  return [
    '-c',
    `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
  ];
}

/**
 * Blobless clones: full history, so git can say when each document last
 * changed, without downloading every old version of every file. A repository
 * that cannot be cloned is left out and named, so one deleted or private
 * repository does not take the company index down with it.
 *
 * Clones afresh on every run, which suits tens of repositories; fetch and
 * reset would suit hundreds.
 */
export async function cloneRepositories(
  repositories: EnrolledRepository[],
  opts: CloneOptions,
): Promise<ClonedRepositories> {
  const distinct = distinctRepositories(repositories);

  await fs.rm(opts.into, { recursive: true, force: true });
  await ignoredDirectory(opts.into);

  const results: Array<PromiseSettledResult<unknown>> = [];

  for (let i = 0; i < distinct.length; i += CLONES_AT_ONCE) {
    results.push(
      ...(await Promise.allSettled(
        distinct
          .slice(i, i + CLONES_AT_ONCE)
          .map((repo) =>
            run('git', [
              ...tokenHeader(repo.cloneUrl, opts.token),
              'clone',
              '--quiet',
              '--filter=blob:none',
              ...(opts.shallow ? ['--depth=1'] : []),
              '--',
              repo.cloneUrl,
              path.join(opts.into, repo.name),
            ]),
          ),
      )),
    );
  }

  const cloned: string[] = [];
  const failed: CloneFailure[] = [];

  for (const [i, result] of results.entries()) {
    const repo = distinct[i];

    if (!repo) continue;

    if (result.status === 'fulfilled') {
      cloned.push(repo.name);
      continue;
    }

    await fs.rm(path.join(opts.into, repo.name), { recursive: true, force: true });
    // git's own words: the error message repeats the command line, token included.
    failed.push({ name: repo.name, reason: gitStderr(result.reason) });
  }

  return { root: opts.into, cloned, failed };
}

/** What a failed `execFile` carries besides its message. */
const failedCommand = z.object({ stderr: z.string() });

/** git's `fatal:` line, the one that names what went wrong, wherever it falls. */
export function gitStderr(error: Error): string {
  const parsed = failedCommand.safeParse(error);
  const lines = (parsed.success ? parsed.data.stderr : '').split(/\r?\n/).filter(Boolean);

  return shown(lines.find((line) => line.startsWith('fatal:')) ?? lines[0] ?? 'git clone failed');
}

/** A clone URL as it may be printed: any user and password in it left out. */
const shown = (url: string) => url.replace(/\/\/[^/@]*@/, '//');

/** One spelling of a clone URL: `…/payments`, `…/payments/` and `…/payments.git` are one repository. */
const canonicalUrl = (url: string) =>
  url
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .toLowerCase();

/**
 * Each repository once, each in one folder of its own. Two clones into one
 * folder race, and the loser's cleanup would delete the winner's checkout. A repository enrolled twice, by
 * topic and by --repo, is cloned once; two different repositories that share a
 * folder name, compared as a case-insensitive filesystem would, are refused.
 */
function distinctRepositories(repositories: EnrolledRepository[]): EnrolledRepository[] {
  const byFolder = new Map<string, EnrolledRepository>();

  for (const repo of repositories) {
    if (!/^[^/\\]+$/.test(repo.name) || /^\.\.?$/.test(repo.name)) {
      throw new Error(
        `${JSON.stringify(repo.name)} from ${shown(repo.cloneUrl)}: not a folder name`,
      );
    }

    const folder = repo.name.toLowerCase();
    const seen = byFolder.get(folder);

    if (!seen) {
      byFolder.set(folder, repo);
      continue;
    }

    if (canonicalUrl(seen.cloneUrl) !== canonicalUrl(repo.cloneUrl)) {
      throw new Error(
        `${repo.name}: ${shown(seen.cloneUrl)} and ${shown(repo.cloneUrl)} would both clone into ${repo.name}/; enrol one of them`,
      );
    }
  }

  return [...byFolder.values()];
}

/**
 * Create a working directory autocatalog owns, ignored by git from inside, the
 * way pytest's cache is: run inside a repository, it never shows up as
 * something to commit, and nobody has to edit their own .gitignore.
 */
export async function ignoredDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, '.gitignore'),
    '# Created by autocatalog: a cache, never committed.\n*\n',
  );
}
