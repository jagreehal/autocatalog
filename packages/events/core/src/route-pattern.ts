/**
 * The regular expressions gateways write for paths, matched without a
 * backtracking engine: a repository writes the pattern and the site build runs
 * it, so no pattern may take more than time proportional to the path. Supports
 * literals, `.`, `\d`, `\w`, character classes, `?`, `*` and `+` on one of
 * those, and a final `$`. Anything else, groups and alternation included, is not
 * compiled, and the caller says so.
 */

type Atom = (char: string) => boolean;

interface Token {
  atom: Atom;
  min: 0 | 1;
  many: boolean;
}

export interface RoutePattern {
  tokens: Token[];
  /** Whether the whole path must be consumed. */
  anchored: boolean;
}

const literal =
  (expected: string): Atom =>
  (char) =>
    char === expected;

const isDigit: Atom = (char) => char >= '0' && char <= '9';

const isWord: Atom = (char) => /^[A-Za-z0-9_]$/.test(char);

/**
 * What `\\d` and `\\w` stand for, and an escaped punctuation character itself.
 * Any other letter or digit means something this does not match, such as `\\s`,
 * so the caller reports the pattern as not compared.
 */
const escaped = (char: string): Atom | undefined =>
  char === 'd'
    ? isDigit
    : char === 'w'
      ? isWord
      : /^[A-Za-z0-9]$/.test(char) || char === ''
        ? undefined
        : literal(char);

/** A `[...]` class from `start`, past its `[`, and where it ends. */
function readClass(pattern: string, start: number): { atom: Atom; end: number } | undefined {
  let at = start;
  const negated = pattern[at] === '^';

  if (negated) at += 1;

  const tests: Atom[] = [];

  while (at < pattern.length && pattern[at] !== ']') {
    const char = pattern[at] ?? '';

    if (char === '\\') {
      const atom = escaped(pattern[at + 1] ?? '');

      if (!atom) return undefined;

      tests.push(atom);
      at += 2;
      continue;
    }

    if (pattern[at + 1] === '-' && pattern[at + 2] && pattern[at + 2] !== ']') {
      const low = char;
      const high = pattern[at + 2] ?? '';

      tests.push((c) => c >= low && c <= high);
      at += 3;
      continue;
    }

    tests.push(literal(char));
    at += 1;
  }

  if (pattern[at] !== ']') return undefined;

  const inClass: Atom = (char) => tests.some((test) => test(char));

  return { atom: negated ? (char) => !inClass(char) : inClass, end: at + 1 };
}

/** The pattern as tokens, or nothing when it uses what this does not match. */
export function compileRoutePattern(pattern: string): RoutePattern | undefined {
  const tokens: Token[] = [];
  let anchored = false;
  let at = 0;

  while (at < pattern.length) {
    const char = pattern[at] ?? '';
    let atom: Atom;

    if (char === '$' && at === pattern.length - 1) {
      anchored = true;
      break;
    }

    if ('()|{}^$*+?'.includes(char)) return undefined;

    if (char === '[') {
      const read = readClass(pattern, at + 1);

      if (!read) return undefined;

      atom = read.atom;
      at = read.end;
    } else if (char === '\\') {
      const read = escaped(pattern[at + 1] ?? '');

      if (!read) return undefined;

      atom = read;
      at += 2;
    } else {
      atom = char === '.' ? () => true : literal(char);
      at += 1;
    }

    const quantifier = pattern[at];

    if (quantifier === '?' || quantifier === '*' || quantifier === '+') {
      tokens.push({ atom, min: quantifier === '+' ? 1 : 0, many: quantifier !== '?' });
      at += 1;
    } else tokens.push({ atom, min: 1, many: false });
  }

  return { tokens, anchored };
}

/**
 * Whether the pattern matches the start of `path`, and all of it when anchored.
 * The states reachable after each character are kept as a set, so the work is
 * the path's length times the pattern's.
 */
export function matchesRoutePattern({ tokens, anchored }: RoutePattern, path: string): boolean {
  // State i: the first i tokens are matched; a repeating token may match again.
  const close = (states: Set<number>) => {
    for (const state of [...states].sort((a, b) => a - b)) {
      let next = state;

      while (next < tokens.length && tokens[next]?.min === 0) {
        next += 1;
        states.add(next);
      }
    }

    return states;
  };

  let states = close(new Set([0]));

  for (const char of path) {
    if (!anchored && states.has(tokens.length)) return true;

    const after = new Set<number>();

    for (const state of states) {
      const token = tokens[state];

      if (!token?.atom(char)) continue;

      after.add(state + 1);

      if (token.many) after.add(state);
    }

    // A repeating token that matched once stays satisfied with more.
    states = close(after);

    if (states.size === 0) return false;
  }

  return states.has(tokens.length);
}
