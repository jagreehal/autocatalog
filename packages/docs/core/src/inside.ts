import fs from 'node:fs';
import path from 'node:path';

/**
 * A file a resource names inside its own repository, refused when it would
 * leave it. Symlinks are resolved first: a repository could commit one that
 * points anywhere on the build machine.
 */
export function inside(dir: string, file: string): string {
  const full = path.resolve(dir, file);

  if (!fs.existsSync(full)) throw new Error(`'${file}' does not exist`);

  const relative = path.relative(fs.realpathSync(dir), fs.realpathSync(full));

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`'${file}' is outside the repository`);
  }

  return full;
}
