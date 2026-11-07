import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runDocsImport } from '../src/commands/docs';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-'));
  await fs.mkdir(path.join(root, 'export/brand'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const run = () =>
  runDocsImport({
    from: path.join(root, 'export'),
    owner: 'Marketing',
    into: path.join(root, 'docs/imported'),
    quiet: true,
  });

it('adds a title and owner, keeps the folders, and leaves other files alone', async () => {
  await fs.writeFile(path.join(root, 'export/brand/logo-rules.md'), '# Logo rules\n\nUse it.\n');
  await fs.writeFile(path.join(root, 'export/team_notes.txt'), 'Plain notes.\n');
  await fs.writeFile(path.join(root, 'export/picture.png'), '');

  expect(await run()).toBe(0);

  expect(await fs.readFile(path.join(root, 'docs/imported/brand/logo-rules.md'), 'utf8')).toBe(
    '---\ntitle: "Logo rules"\nowner: "Marketing"\n---\n\n# Logo rules\n\nUse it.\n',
  );
  expect(await fs.readFile(path.join(root, 'docs/imported/team_notes.md'), 'utf8')).toContain(
    'title: "team notes"',
  );
  await expect(fs.access(path.join(root, 'docs/imported/picture.png'))).rejects.toThrow();
});

it('adds what frontmatter leaves out, and reads a leading rule as text', async () => {
  await fs.writeFile(path.join(root, 'export/kept.md'), '---\ntitle: Kept\n---\n\nBody.\n');
  await fs.writeFile(path.join(root, 'export/rule.md'), '---\n\nAbove.\n\n---\n\nBelow.\n');

  await run();

  expect(await fs.readFile(path.join(root, 'docs/imported/kept.md'), 'utf8')).toBe(
    '---\ntitle: "Kept"\nowner: "Marketing"\n---\n\nBody.\n',
  );
  expect(await fs.readFile(path.join(root, 'docs/imported/rule.md'), 'utf8')).toContain(
    'owner: "Marketing"\n---\n\n---\n\nAbove.',
  );
});

it('never overwrites a page someone has edited', async () => {
  await fs.writeFile(path.join(root, 'export/page.md'), '# Page\n');
  await run();
  await fs.writeFile(path.join(root, 'docs/imported/page.md'), 'edited');
  await run();

  expect(await fs.readFile(path.join(root, 'docs/imported/page.md'), 'utf8')).toBe('edited');
});

it('does not follow a link in the export', async () => {
  await fs.writeFile(path.join(root, 'secret.md'), 'secret');
  await fs.symlink(path.join(root, 'secret.md'), path.join(root, 'export/link.md'));
  await run();

  await expect(fs.access(path.join(root, 'docs/imported/link.md'))).rejects.toThrow();
});

it('refuses a folder that is not there', async () => {
  await fs.rm(path.join(root, 'export'), { recursive: true });

  expect(await run()).toBe(1);
});
