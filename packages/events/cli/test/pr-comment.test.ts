import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { summariseDrift } from 'autocatalog-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentBody } from '../src/commands/check';
import { COMMENT_MARKER, pullRequestFromEnv, upsertComment } from '../src/commands/pr-comment';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-pr-comment-'));
});

afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const pr = { api: 'https://api.github.test', repository: 'acme/orders', number: 7, token: 't' };

/** A GitHub that holds these comments and records each call made to it. */
function github(
  comments: Array<{ id: number; body: string; user?: { type: string } }>,
  status = 200,
) {
  const calls: Array<{ method: string; url: string; body: string }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    calls.push({ method, url, body: String(init?.body ?? '') });

    if (status !== 200) {
      return new Response('{}', { status });
    }

    const listed = comments.map((c) => ({ user: { type: 'Bot' }, ...c }));

    return new Response(JSON.stringify(method === 'GET' ? listed : {}), { status: 200 });
  };

  return { calls, fetchImpl };
}

describe('the pull request comment', () => {
  it('finds the pull request an Actions run is for', async () => {
    const event = path.join(dir, 'event.json');

    await fs.writeFile(event, JSON.stringify({ pull_request: { number: 7 } }));

    expect(
      await pullRequestFromEnv({
        GITHUB_TOKEN: 't',
        GITHUB_REPOSITORY: 'acme/orders',
        GITHUB_EVENT_PATH: event,
      }),
    ).toEqual({ api: 'https://api.github.com', repository: 'acme/orders', number: 7, token: 't' });

    await fs.writeFile(event, JSON.stringify({ push: {} }));

    expect(
      await pullRequestFromEnv({
        GITHUB_TOKEN: 't',
        GITHUB_REPOSITORY: 'acme/orders',
        GITHUB_EVENT_PATH: event,
      }),
    ).toBeUndefined();
  });

  it('creates one comment, then updates that one on the next run', async () => {
    const empty = github([{ id: 1, body: 'LGTM' }]);

    expect(await upsertComment(pr, 'failed', { worthSaying: true }, empty.fetchImpl)).toBe(
      'created',
    );
    expect(empty.calls.at(-1)).toMatchObject({
      method: 'POST',
      url: 'https://api.github.test/repos/acme/orders/issues/7/comments',
    });
    expect(JSON.parse(empty.calls.at(-1)?.body ?? '{}').body).toBe(`${COMMENT_MARKER}\nfailed`);

    const kept = github([{ id: 42, body: `${COMMENT_MARKER}\nfailed` }]);

    expect(await upsertComment(pr, 'passed', { worthSaying: false }, kept.fetchImpl)).toBe(
      'updated',
    );
    expect(kept.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      url: 'https://api.github.test/repos/acme/orders/issues/comments/42',
    });
  });

  it("leaves a person's comment that carries the marker alone", async () => {
    const pasted = github([{ id: 9, body: `${COMMENT_MARKER}\nfake`, user: { type: 'User' } }]);

    expect(await upsertComment(pr, 'failed', { worthSaying: true }, pasted.fetchImpl)).toBe(
      'created',
    );
    expect(pasted.calls.at(-1)).toMatchObject({ method: 'POST' });
  });

  it('stays quiet on a clean pull request it never commented on', async () => {
    const quiet = github([]);

    expect(await upsertComment(pr, 'passed', { worthSaying: false }, quiet.fetchImpl)).toBe(
      'skipped',
    );
    expect(quiet.calls.map(({ method }) => method)).toEqual(['GET']);
  });

  it('throws when GitHub refuses, so the caller can say why', async () => {
    const forbidden = github([], 403);

    await expect(
      upsertComment(pr, 'failed', { worthSaying: true }, forbidden.fetchImpl),
    ).rejects.toThrow(/403/);
  });

  it('says what failed, then the drift with who it breaks', () => {
    const report = summariseDrift([
      {
        kind: 'field_renamed',
        severity: 'breaking',
        domain: 'order',
        eventId: 'order',
        message: 'field `total` looks renamed to `totalMinor`',
        consumers: ['InvoiceService'],
      },
    ]);

    const body = commentBody(['Drift from origin/main'], [report]);

    expect(body).toContain('### autocatalog check failed');
    expect(body).toContain('- Drift from origin/main');
    expect(body).toContain('InvoiceService');
    expect(commentBody([], [])).toBe('### autocatalog check passed');
  });
});
