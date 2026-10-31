import { describe, expect, it } from 'vitest';
import { githubDirectoryEnrichment, withDirectoryEnrichment } from '../src/directory';

describe('githubDirectoryEnrichment', () => {
  it('maps a user and a team handle to public GitHub URLs', () => {
    expect(githubDirectoryEnrichment('@ada')).toEqual({
      avatarUrl: 'https://github.com/ada.png',
      profileUrl: 'https://github.com/ada',
    });
    expect(githubDirectoryEnrichment('acme/payments')).toEqual({
      avatarUrl: 'https://github.com/acme.png',
      profileUrl: 'https://github.com/orgs/acme/teams/payments',
    });
    expect(githubDirectoryEnrichment('not a handle')).toBeUndefined();
  });
});

describe('withDirectoryEnrichment', () => {
  it('fills gaps without overwriting a declared avatar', () => {
    expect(
      withDirectoryEnrichment({ avatarUrl: 'https://cdn.example/a.png' }, 'ada'),
    ).toMatchObject({ avatarUrl: 'https://cdn.example/a.png' });

    expect(withDirectoryEnrichment({}, '@ada')).toMatchObject({
      avatarUrl: 'https://github.com/ada.png',
      profileUrl: 'https://github.com/ada',
    });
  });
});
