import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * When a document last changed, according to git.
 *
 * Freshness is never a frontmatter field. A hand-written date rots the moment
 * someone edits the file and forgets to touch it, and a stale date on a runbook
 * is worse than no date because it reads as a promise.
 *
 * Returns null when git cannot answer: no repository, an uncommitted file, or a
 * shallow checkout. Callers render that as unknown rather than inventing a date.
 */
export function lastChanged(root: string, file: string): string | null {
  const [first, ...rest] = file.split('/');
  // Each publishing repo may be its own checkout when aggregated as siblings,
  // in which case git must be asked inside that repo about its own path.
  const nested = first ? path.join(root, first) : root;
  const isNestedCheckout = first !== undefined && fs.existsSync(path.join(nested, '.git'));
  const cwd = isNestedCheckout ? nested : root;
  const target = isNestedCheckout ? rest.join('/') : file;

  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', target], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return out || null;
  } catch {
    return null;
  }
}

/** Per checkout: its web origin, and where the root sits below the checkout's top. */
const remotes = new Map<string, { web: string; prefix: string; branch: string } | null>();

/** `git@github.com:acme/payments.git` or `https://…/payments.git` → https://…/acme/payments */
export function webUrl(remote: string): string | null {
  const ssh = /^git@([^:]+):(.+?)(\.git)?$/.exec(remote);

  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = /^https:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(\.git)?\/?$/.exec(remote);

  return https ? `https://${https[1]}/${https[2]}` : null;
}

/**
 * Where a reader can see the file itself: the repository's origin on the web,
 * at the file's path. What an agent cites, and where a reader goes to fix it.
 * `edit` opens the host's editor on the file instead, `tree` lists a directory.
 * Null when the checkout has no web-hosted origin.
 */
export function sourceUrl(
  root: string,
  file: string,
  view: 'blob' | 'edit' | 'tree' = 'blob',
): string | null {
  const [first, ...rest] = file.split('/');
  const nested = first ? path.join(root, first) : root;
  const isNestedCheckout = first !== undefined && fs.existsSync(path.join(nested, '.git'));
  const cwd = isNestedCheckout ? nested : root;
  const target = isNestedCheckout ? rest.join('/') : file;

  if (!remotes.has(cwd)) {
    let remote: { web: string; prefix: string; branch: string } | null = null;

    try {
      const run = (args: string[]) =>
        execFileSync('git', args, {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

      const web = webUrl(run(['remote', 'get-url', 'origin']));
      // The root may sit below the top of its checkout, as an example site
      // inside a monorepo does; the web path starts at the top.
      const prefix = run(['rev-parse', '--show-prefix']);

      // The default branch reads like the link a person would share, and it
      // exists on the host even when the build checked out a local branch.
      const attempt = (args: string[]) => {
        try {
          return run(args);
        } catch {
          return '';
        }
      };

      const branch =
        attempt(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') ||
        attempt(['symbolic-ref', '--short', 'HEAD']) ||
        'HEAD';

      remote = web ? { web, prefix, branch } : null;
    } catch {
      remote = null;
    }

    remotes.set(cwd, remote);
  }

  const origin = remotes.get(cwd);

  return origin ? `${origin.web}/${view}/${origin.branch}/${origin.prefix}${target}` : null;
}

/**
 * The commit a checkout is at: which version of a repository the site was
 * built from. Null when the directory is not inside a git checkout.
 */
export function headCommit(dir: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return out || null;
  } catch {
    return null;
  }
}
