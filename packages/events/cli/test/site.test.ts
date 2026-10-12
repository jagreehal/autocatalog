import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSite } from '../src/commands/site';

const base = { root: '.', cache: '.autocatalog/repos', out: 'dist', dev: false };

describe('ac site arguments', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a topic without an owner, and says why', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, topic: 'catalog' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/--topic and --owner go together/);
  });

  it('refuses EventCatalog diagrams in dev mode, which only a build draws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, dev: true, eventcatalog: true })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/--eventcatalog/);
  });

  it('refuses a docs contract that is not there, before building anything', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, docsSchema: 'nowhere/docs-frontmatter.json' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/--docs-schema.*nowhere\/docs-frontmatter\.json/);
  });

  it('refuses an owner without a topic', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, owner: 'acme' })).toBe(1);
  });
});
