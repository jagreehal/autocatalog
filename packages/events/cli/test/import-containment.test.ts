import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveInsideClone } from '../src/commands/import';

// An imported manifest is written by whoever owns the repository being cloned.
// Every path in it is untrusted input, and the clone directory is the boundary.
describe('resolveInsideClone', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ac-contain-')));
    root = path.join(tmp, 'repo');
    outside = path.join(tmp, 'private.json');
    await fs.mkdir(path.join(root, 'nested'), { recursive: true });
    await fs.writeFile(outside, '{"secret":true}');
    await fs.writeFile(path.join(root, 'schema.json'), '{}');
    await fs.writeFile(path.join(root, 'nested', 'schema.json'), '{}');
  });

  afterEach(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it('allows paths inside the clone', async () => {
    await expect(resolveInsideClone(root, 'schema.json')).resolves.toBe(
      path.join(root, 'schema.json'),
    );
    await expect(resolveInsideClone(root, 'nested/schema.json')).resolves.toBe(
      path.join(root, 'nested', 'schema.json'),
    );
    // Traversal that comes back inside is fine; it is where you land that counts.
    await expect(resolveInsideClone(root, 'nested/../schema.json')).resolves.toBe(
      path.join(root, 'schema.json'),
    );
  });

  it('refuses to climb out of the clone', async () => {
    await expect(resolveInsideClone(root, '../private.json')).rejects.toThrow(/escapes/);
    await expect(resolveInsideClone(root, '../../../../etc/passwd')).rejects.toThrow(/escapes/);
    await expect(resolveInsideClone(root, 'nested/../../private.json')).rejects.toThrow(/escapes/);
  });

  it('refuses an absolute path, which would discard the clone root entirely', async () => {
    await expect(resolveInsideClone(root, outside)).rejects.toThrow(/escapes/);
    await expect(resolveInsideClone(root, '/etc/passwd')).rejects.toThrow(/escapes/);
  });

  it('refuses the clone root itself', async () => {
    await expect(resolveInsideClone(root, '.')).rejects.toThrow(/escapes/);
  });

  it('refuses a symlink committed inside the clone that points out of it', async () => {
    // A lexical check passes this one: the path never says `..`.
    await fs.symlink(outside, path.join(root, 'link.json'));
    await expect(resolveInsideClone(root, 'link.json')).rejects.toThrow(/via a link/);
  });

  it('leaves a missing file to the reader to report', async () => {
    await expect(resolveInsideClone(root, 'absent.json')).resolves.toBe(
      path.join(root, 'absent.json'),
    );
  });
});
