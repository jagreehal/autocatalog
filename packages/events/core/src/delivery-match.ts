import { z } from 'zod';
import { isJsonObject, type JsonObject, type JsonValue } from './json';

/**
 * The matchers delivery routing evaluates. Each answers true, false, or
 * undefined when the rule uses something it does not evaluate: an unknown
 * keeps a route from being reported as working or broken.
 */

/** A header or attribute value a broker compares. */
export const headerValue = z.union([z.string(), z.number(), z.boolean()]);

export type HeaderValue = z.infer<typeof headerValue>;

type Comparable = JsonValue | HeaderValue | null | undefined;

const isText = (value: Comparable): value is string => z.string().safeParse(value).success;

const isNumber = (value: Comparable): value is number => z.number().safeParse(value).success;

const isFlag = (value: Comparable): value is boolean => z.boolean().safeParse(value).success;

/** RabbitMQ's limit on a name, and so on anything a pattern is matched against. */
const MAX_NAME = 255;

/**
 * A regular expression from broker configuration, run only when it cannot
 * backtrack badly: letters, digits, `.`, `*` after a single character, anchors,
 * escapes and alternation, with no quantified group. Anything else, more than
 * two stars, or more than 255 characters is not evaluated; a pattern in an
 * untrusted pull request must not stall the scan.
 */
export function safePattern(pattern: string): RegExp | undefined {
  if (pattern.length > MAX_NAME || !/^[\w\-.*^$|()\\/:@]*$/.test(pattern)) return undefined;

  if (/\)[*]/.test(pattern) || /\*\*/.test(pattern)) return undefined;

  // RabbitMQ reads patterns as PCRE: only escapes that mean the same in
  // JavaScript are evaluated (`\A` and `\Z` are anchors there, letters here).
  if (/\\[^.\-/\\dws$^|()*]/.test(pattern.replace(/\\\\/g, ''))) return undefined;

  if ((pattern.match(/\*/g) ?? []).length > 2) return undefined;

  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/** A RabbitMQ permission or policy pattern against a name. `''` grants nothing, as in RabbitMQ. */
export function rabbitPatternMatches(pattern: string, name: string): boolean | undefined {
  if (pattern === '') return false;

  if (name.length > MAX_NAME) return undefined;

  return safePattern(pattern)?.test(name);
}

/** `*` is one word and `#` is zero or more, between dots. */
export function topicMatches(pattern: string, key: string): boolean {
  const words = key === '' ? [] : key.split('.');
  const parts = pattern === '' ? [] : pattern.split('.');

  // Each (part, word) pair is decided once, so a run of `#` stays linear in each.
  const seen = new Map<number, boolean>();

  const match = (p: number, w: number): boolean => {
    const key = p * (words.length + 1) + w;
    const known = seen.get(key);

    if (known !== undefined) return known;

    const result =
      p === parts.length
        ? w === words.length
        : parts[p] === '#'
          ? match(p + 1, w) || (w < words.length && match(p, w + 1))
          : w < words.length && (parts[p] === '*' || parts[p] === words[w]) && match(p + 1, w + 1);

    seen.set(key, result);

    return result;
  };

  return match(0, 0);
}

// ---------------------------------------------------------------------------
// AWS content filtering: SNS filter policies and EventBridge event patterns

const all = (results: Array<boolean | undefined>): boolean | undefined =>
  results.includes(false) ? false : results.includes(undefined) ? undefined : true;

const any = (results: Array<boolean | undefined>): boolean | undefined =>
  results.includes(true) ? true : results.includes(undefined) ? undefined : false;

const numericRule = z.array(z.union([z.string(), z.number()]));

function numericMatches(rule: JsonValue, value: JsonValue | undefined): boolean | undefined {
  const parsed = numericRule.safeParse(rule);

  if (!parsed.success || !isNumber(value)) return parsed.success ? false : undefined;

  const parts = parsed.data;
  const checks: Array<boolean | undefined> = [];

  for (let i = 0; i < parts.length; i += 2) {
    const op = parts[i];
    const bound = parts[i + 1];

    if (!isNumber(bound)) return undefined;

    checks.push(
      op === '='
        ? value === bound
        : op === '<'
          ? value < bound
          : op === '<='
            ? value <= bound
            : op === '>'
              ? value > bound
              : op === '>='
                ? value >= bound
                : undefined,
    );
  }

  return all(checks);
}

/** One entry of a filter's value list against one field value. */
function conditionMatches(condition: JsonValue, value: JsonValue | undefined): boolean | undefined {
  if (!isJsonObject(condition)) {
    if (value === undefined) return false;

    return condition === value;
  }

  const [operator, ...rest] = Object.keys(condition);

  if (!operator || rest.length > 0) return undefined;

  const operand = condition[operator]!;
  const text = isText(value) ? value : undefined;

  switch (operator) {
    case 'exists':
      return isFlag(operand) ? (value !== undefined) === operand : undefined;
    case 'prefix':
      if (isJsonObject(operand)) return undefined;

      return value === undefined ? false : text !== undefined && text.startsWith(String(operand));
    case 'suffix':
      return value === undefined ? false : text !== undefined && text.endsWith(String(operand));
    case 'equals-ignore-case':
      return (
        value !== undefined &&
        text !== undefined &&
        text.toLowerCase() === String(operand).toLowerCase()
      );
    case 'numeric':
      return value === undefined ? false : numericMatches(operand, value);
    case 'anything-but': {
      if (value === undefined) return false;

      if (Array.isArray(operand)) return !operand.includes(value);

      if (isJsonObject(operand)) {
        const inner = conditionMatches(operand, value);

        return inner === undefined ? undefined : !inner;
      }

      return operand !== value;
    }

    default:
      return undefined;
  }
}

/**
 * Whether a filter policy or event pattern accepts a message: every key must
 * match, and a key's list matches when any of its entries does. A nested
 * object descends into the payload. `$or` takes any of its alternatives.
 */
export function contentMatches(
  pattern: JsonObject,
  target: JsonValue | undefined,
): boolean | undefined {
  const checks: Array<boolean | undefined> = [];

  for (const [key, rule] of Object.entries(pattern)) {
    if (key === '$or') {
      checks.push(
        Array.isArray(rule)
          ? any(rule.map((alt) => (isJsonObject(alt) ? contentMatches(alt, target) : undefined)))
          : undefined,
      );
      continue;
    }

    const field = isJsonObject(target) ? target[key] : undefined;

    if (isJsonObject(rule)) {
      checks.push(field === undefined ? false : contentMatches(rule, field));
      continue;
    }

    if (!Array.isArray(rule)) {
      checks.push(undefined);
      continue;
    }

    // A field holding a list matches when any element does.
    const values: Array<JsonValue | undefined> = Array.isArray(field) ? field : [field];

    checks.push(
      any(rule.map((condition) => any(values.map((v) => conditionMatches(condition, v))))),
    );
  }

  return all(checks);
}

// ---------------------------------------------------------------------------
// Azure Service Bus SQL filters, a subset: comparisons, IN, IS [NOT] NULL,
// AND, OR, NOT and parentheses over properties. Anything else is not evaluated.

type Token = { kind: 'word' | 'string' | 'number' | 'op' | 'paren' | 'comma'; text: string };

function tokenize(sql: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);
    const space = /^\s+/.exec(rest);

    if (space) {
      i += space[0].length;
      continue;
    }

    const string = /^'((?:[^']|'')*)'/.exec(rest);
    const number = /^-?\d+(?:\.\d+)?/.exec(rest);
    const word = /^[A-Za-z_$][\w.$]*/.exec(rest);
    const op = /^(<>|!=|<=|>=|=|<|>)/.exec(rest);

    if (string) tokens.push({ kind: 'string', text: string[1]!.replaceAll("''", "'") });
    else if (number) tokens.push({ kind: 'number', text: number[0] });
    else if (word) tokens.push({ kind: 'word', text: word[0] });
    else if (op) tokens.push({ kind: 'op', text: op[0] });
    else if (rest[0] === '(' || rest[0] === ')') tokens.push({ kind: 'paren', text: rest[0] });
    else if (rest[0] === ',') tokens.push({ kind: 'comma', text: ',' });
    else return undefined;

    i += (string ?? number ?? word ?? op)?.[0].length ?? 1;
  }

  return tokens;
}

/** A property reference as the message carries it: `user.currency`, `sys.Label` or `currency`. */
function property(name: string, properties: Record<string, HeaderValue>): HeaderValue | null {
  const bare = name.replace(/^(user|sys)\./i, '');
  const value = properties[name] ?? properties[bare];

  return value ?? null;
}

/** Evaluate a Service Bus SQL filter against a message's properties. */
export function sqlFilterMatches(
  sql: string,
  properties: Record<string, HeaderValue>,
): boolean | undefined {
  const tokens = tokenize(sql);

  if (!tokens) return undefined;

  let at = 0;
  const peek = () => tokens[at];
  const keyword = (word: string) => peek()?.kind === 'word' && peek()!.text.toUpperCase() === word;
  const fail = Symbol('unsupported');

  const value = (): HeaderValue | null | typeof fail => {
    const token = tokens[at++];

    if (!token) return fail;

    if (token.kind === 'string') return token.text;

    if (token.kind === 'number') return Number(token.text);

    if (token.kind === 'word') {
      const upper = token.text.toUpperCase();

      if (upper === 'TRUE') return true;

      if (upper === 'FALSE') return false;

      if (upper === 'NULL') return null;

      return property(token.text, properties);
    }

    return fail;
  };

  const comparison = (): boolean | null | typeof fail => {
    if (peek()?.kind === 'paren' && peek()!.text === '(') {
      at++;
      const inner = or();

      if (tokens[at++]?.text !== ')') return fail;

      return inner;
    }

    if (keyword('NOT')) {
      at++;
      const inner = comparison();

      return inner === fail || inner === null ? inner : !inner;
    }

    const left = value();

    if (left === fail) return fail;

    if (keyword('IS')) {
      at++;
      const negate = keyword('NOT');

      if (negate) at++;

      if (!keyword('NULL')) return fail;
      at++;

      return negate ? left !== null : left === null;
    }

    const negated = keyword('NOT');

    if (negated) at++;

    if (keyword('IN')) {
      at++;

      if (tokens[at++]?.text !== '(') return fail;
      const options: Array<HeaderValue | null> = [];

      for (;;) {
        const option = value();

        if (option === fail) return fail;
        options.push(option);
        const next = tokens[at++];

        if (next?.text === ')') break;

        if (next?.kind !== 'comma') return fail;
      }

      // A missing property is SQL's unknown: neither IN nor NOT IN holds for it.
      if (left === null) return null;

      const found = options.includes(left);

      return negated ? !found : found;
    }

    if (negated) return fail;

    const op = tokens[at];

    // A bare TRUE or `1=1` style literal comparison.
    if (op?.kind !== 'op') return isFlag(left) ? left : fail;
    at++;
    const right = value();

    if (right === fail) return fail;

    // SQL's unknown: a missing property compares as neither true nor false, and fails the filter.
    if (left === null || right === null) return null;

    switch (op.text) {
      case '=':
        return left === right;
      case '<>':
      case '!=':
        return left !== right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      default:
        return fail;
    }
  };

  const and = (): boolean | null | typeof fail => {
    let result = comparison();

    while (keyword('AND')) {
      at++;
      const next = comparison();

      if (result === fail || next === fail) return fail;

      result =
        result === false || next === false ? false : result === null || next === null ? null : true;
    }

    return result;
  };

  const or = (): boolean | null | typeof fail => {
    let result = and();

    while (keyword('OR')) {
      at++;
      const next = and();

      if (result === fail || next === fail) return fail;

      result =
        result === true || next === true ? true : result === null || next === null ? null : false;
    }

    return result;
  };

  const result = or();

  if (result === fail || at !== tokens.length) return undefined;

  return result === true;
}
