import { afterEach, expect, it, vi } from 'vitest';
import { catalogId, docPage, entryId } from '../src/ui/lib/docs';

afterEach(() => vi.unstubAllEnvs());

it('publishes one repository at the root, keeping its name in ids', () => {
  vi.stubEnv('AUTOCATALOG_DOCS_ROOT_REPO', 'help');

  expect(docPage('help/labels/start')).toBe('labels/start');
  expect(docPage('help/labels/index')).toBe('labels');
  expect(docPage('help/index')).toBe('');
  expect(entryId('help/labels/start')).toBe('labels/start');
  expect(catalogId('labels/start')).toBe('help/labels/start');
});

it('keeps the repository in every address otherwise', () => {
  expect(docPage('help/labels/index')).toBe('help/labels');
  expect(entryId('help/labels/start')).toBe('help/labels/start');
  expect(catalogId('help/labels/start')).toBe('help/labels/start');
});
