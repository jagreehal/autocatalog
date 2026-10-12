export interface CodeownersRule {
  pattern: string;
  owners: string[];
}

/** Parse a CODEOWNERS file. Later rules win, per GitHub semantics. */
export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();

    if (!line || line.startsWith('#')) continue;
    const [pattern, ...owners] = line.split(/\s+/);

    if (!pattern || owners.length === 0) continue;
    rules.push({ pattern, owners });
  }

  return rules;
}

function patternToRegex(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith('/');

  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith('/');

  if (dirOnly) p = p.slice(0, -1);

  let regex = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*')
    .replace(/\?/g, '[^/]');

  if (dirOnly) regex = `${regex}(/.*)?`;

  return anchored ? new RegExp(`^${regex}$`) : new RegExp(`(^|/)${regex}$`);
}

/**
 * Resolve the owning team for a repo-relative path. Returns the last matching
 * rule's first owner (GitHub's precedence), without the leading @.
 */
export function ownerForPath(rules: CodeownersRule[], relPath: string): string | undefined {
  let match: CodeownersRule | undefined;

  for (const rule of rules) {
    if (patternToRegex(rule.pattern).test(relPath)) match = rule;
  }

  return match?.owners[0]?.replace(/^@/, '');
}
