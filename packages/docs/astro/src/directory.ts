/**
 * Optional directory enrichment from a GitHub handle. No API call: avatars and
 * profile URLs follow GitHub's stable public URL shapes, so a CODEOWNERS
 * `@org/team` or `@user` can show a face without becoming an IdP product.
 */

export interface DirectoryEnrichment {
  avatarUrl?: string;
  profileUrl?: string;
}

/** GitHub user or org/team handle → avatar and profile link. */
export function githubDirectoryEnrichment(
  handle: string | undefined,
): DirectoryEnrichment | undefined {
  if (!handle) return undefined;

  const trimmed = handle.trim().replace(/^@/, '');

  if (!trimmed) return undefined;

  const team = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(trimmed);

  if (team) {
    return {
      // Org avatar; teams have no public avatar URL of their own.
      avatarUrl: `https://github.com/${team[1]}.png`,
      profileUrl: `https://github.com/orgs/${team[1]}/teams/${team[2]}`,
    };
  }

  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(trimmed)) return undefined;

  return {
    avatarUrl: `https://github.com/${trimmed}.png`,
    profileUrl: `https://github.com/${trimmed}`,
  };
}

/**
 * Fill avatar / contact gaps on an owner profile from a GitHub-shaped name,
 * without overwriting what `teams/` or `users/` already declared.
 */
export function withDirectoryEnrichment<T extends { avatarUrl?: string | undefined }>(
  profile: T | undefined,
  ownerName: string,
  contact?: string | undefined,
): (T & DirectoryEnrichment) | undefined {
  const enrichment = githubDirectoryEnrichment(ownerName);

  if (!profile && !enrichment) return undefined;

  if (!profile) {
    // SAFETY: an owner with no directory file has only what GitHub's URLs give, and
    // callers read those optional fields alone.
    return enrichment
      ? ({ avatarUrl: enrichment.avatarUrl, profileUrl: enrichment.profileUrl } as T &
          DirectoryEnrichment)
      : undefined;
  }

  return {
    ...profile,
    avatarUrl: profile.avatarUrl ?? enrichment?.avatarUrl,
    profileUrl: contact ?? enrichment?.profileUrl,
  };
}
