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

export interface ListByTopicOptions {
  owner: string;
  topic: string;
  /** Reads private repositories and lifts the unauthenticated rate limit. */
  token?: string;
  fetch?: FetchLike;
}

/**
 * Every non-archived repository an owner has with the topic. Lists the owner's
 * repositories rather than using search, because the search index can lag a
 * topic change by minutes and a build should see the enrolment that was made.
 */
export async function listRepositoriesByTopic(
  opts: ListByTopicOptions,
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
      if (!repo.archived && repo.topics?.includes(opts.topic)) {
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
}

/**
 * Blobless clones: full history, so git can say when each document last
 * changed, without downloading every old version of every file.
 *
 * Clones afresh on every run, which suits tens of repositories; fetch and
 * reset would suit hundreds.
 */
export async function cloneRepositories(
  repositories: EnrolledRepository[],
  opts: CloneOptions,
): Promise<string> {
  await fs.rm(opts.into, { recursive: true, force: true });
  await ignoredDirectory(opts.into);

  // The token travels as a header, never in the URL, so it is not written
  // into .git/config or echoed in an error message.
  const auth = opts.token
    ? [
        '-c',
        `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${opts.token}`).toString('base64')}`,
      ]
    : [];

  await Promise.all(
    repositories.map((repo) =>
      run('git', [
        ...auth,
        'clone',
        '--quiet',
        '--filter=blob:none',
        repo.cloneUrl,
        path.join(opts.into, repo.name),
      ]),
    ),
  );

  return opts.into;
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
