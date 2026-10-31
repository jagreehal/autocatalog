import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export { publishedLine, readCompanyIndex, readEventSchema } from 'autocatalog-core';

const execFileAsync = promisify(execFile);

/**
 * The name the company site gives this repository: the last part of its
 * `origin` URL, as `ac site --topic` clones it. Nothing when there is no remote.
 */
export async function repositoryName(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });

    const name = stdout
      .trim()
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .at(-1);

    return name || undefined;
  } catch {
    return undefined;
  }
}
