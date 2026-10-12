import { describe, expect, it } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from '../src/frontmatter';

describe('parseFrontmatter', () => {
  it('splits the block from the body', () => {
    const { data, content } = parseFrontmatter(
      '---\ntitle: Runbook\nowner: payments\n---\nBody.\n',
    );

    expect(data).toEqual({ title: 'Runbook', owner: 'payments' });
    expect(content).toBe('Body.\n');
  });

  it('keeps a document that has no frontmatter whole', () => {
    expect(parseFrontmatter('# Runbook\n')).toEqual({ data: {}, content: '# Runbook\n' });
  });

  it('reads a block written on Windows, behind a BOM', () => {
    const { data, content } = parseFrontmatter('﻿---\r\ntitle: Runbook\r\n---\r\nBody.\r\n');

    expect(data).toEqual({ title: 'Runbook' });
    expect(content).toBe('Body.\r\n');
  });

  it('leaves an unquoted date the string the contract asked for', () => {
    expect(parseFrontmatter('---\nupdated: 2024-01-02\n---\n').data).toEqual({
      updated: '2024-01-02',
    });
  });

  it('treats an empty block, and one that is not a mapping, as no frontmatter', () => {
    expect(parseFrontmatter('---\n---\nBody.\n')).toEqual({ data: {}, content: 'Body.\n' });
    expect(parseFrontmatter('---\njust a string\n---\nBody.\n').data).toEqual({});
  });

  it('keeps every other key when one value is not JSON', () => {
    const { data } = parseFrontmatter(
      '---\nid: payment.completed\nx-autocatalog:\n  managed: true\nlimit: .inf\n---\n',
    );

    expect(data).toEqual({
      id: 'payment.completed',
      'x-autocatalog': { managed: true },
      limit: null,
    });
  });

  it('needs the closing fence on its own line', () => {
    const raw = '---\ntitle: a---\nBody.\n';

    expect(parseFrontmatter(raw)).toEqual({ data: {}, content: raw });
  });
});

describe('stringifyFrontmatter', () => {
  it('round-trips a value the fence would otherwise eat', () => {
    const data = { title: 'Runbook: payments', related: ['a/b'] };

    expect(parseFrontmatter(stringifyFrontmatter(data, 'Body.\n'))).toEqual({
      data,
      content: 'Body.\n',
    });
  });
});
