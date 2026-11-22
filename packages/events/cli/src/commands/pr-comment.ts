import fs from 'node:fs/promises';
import { z } from 'zod';

/** The first line of the one comment `ac check` keeps on a pull request. */
export const COMMENT_MARKER = '<!-- autocatalog-check -->';

/** A pull request a workflow runs for, and how to write to it. */
export interface PullRequest {
  api: string;
  repository: string;
  number: number;
  token: string;
}

const eventSchema = z.object({ pull_request: z.object({ number: z.number().int() }).optional() });

const commentsSchema = z.array(
  z.object({
    id: z.number(),
    body: z.string().nullable().catch(''),
    user: z.object({ type: z.string() }).nullable().catch(null),
  }),
);

/**
 * The pull request this GitHub Actions run is for, from the files and
 * variables Actions sets. None outside a pull request or without a token.
 */
export async function pullRequestFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PullRequest | undefined> {
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;

  if (!token || !env.GITHUB_REPOSITORY || !env.GITHUB_EVENT_PATH) {
    return undefined;
  }

  const text = await fs.readFile(env.GITHUB_EVENT_PATH, 'utf8').catch(() => null);

  if (text === null) {
    return undefined;
  }

  const number = pullRequestNumber(text);

  return number === undefined
    ? undefined
    : {
        api: env.GITHUB_API_URL ?? 'https://api.github.com',
        repository: env.GITHUB_REPOSITORY,
        number,
        token,
      };
}

/** The pull request number in an Actions event payload, when it is a pull request's. */
function pullRequestNumber(text: string): number | undefined {
  try {
    return eventSchema.safeParse(JSON.parse(text)).data?.pull_request?.number;
  } catch {
    return undefined;
  }
}

/**
 * Keep one comment on the pull request: update it when it is there, create it
 * when there is something to say. A clean run with no earlier comment says
 * nothing, so a quiet pull request stays quiet.
 */
export async function upsertComment(
  pr: PullRequest,
  body: string,
  { worthSaying }: { worthSaying: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<'created' | 'updated' | 'skipped'> {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${pr.token}`,
    'content-type': 'application/json',
  };

  const base = `${pr.api}/repos/${pr.repository}/issues`;

  const call = async (url: string, init: RequestInit = {}) => {
    const response = await fetchImpl(url, { ...init, headers, redirect: 'error' });

    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} for ${url}`);
    }

    return response;
  };

  let existing: number | undefined;

  for (let page = 1; existing === undefined; page++) {
    const listed = await call(`${base}/${pr.number}/comments?per_page=100&page=${page}`);
    const comments = commentsSchema.parse(await listed.json());

    // Only a bot's comment is ours: anyone can paste the marker into their own.
    existing = comments.find(
      (comment) => comment.user?.type === 'Bot' && comment.body?.startsWith(COMMENT_MARKER),
    )?.id;

    if (comments.length < 100) {
      break;
    }
  }

  const text = `${COMMENT_MARKER}\n${body}`;

  if (existing !== undefined) {
    await call(`${base}/comments/${existing}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: text }),
    });

    return 'updated';
  }

  if (!worthSaying) {
    return 'skipped';
  }

  await call(`${base}/${pr.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: text }),
  });

  return 'created';
}
