import { correlationPath } from './correlation';
import { isJsonObject } from './json';
import type { LoadedEvent } from './load';

export interface HealthCheck {
  name: string;
  points: number;
  earned: boolean;
  hint: string;
}

export interface HealthScore {
  domain: string;
  eventId: string;
  score: number; // 0–100
  checks: HealthCheck[];
}

// EventCatalog also accepts a bare integer version, conventionally "V1".
const SEMVER_RE = /^[vV]?(\d+\.\d+\.\d+(-[\w.]+)?|\d+)$/;

/**
 * Contract health: how trustworthy and complete is this event's entry?
 * The score exists to give teams a reason to close the gaps the automatic
 * pipeline can't fill (ownership, consumers, real examples).
 */
export function scoreEvent(event: LoadedEvent): HealthScore {
  const fm = event.frontmatter;
  const cases = new Set(event.examples.flatMap((example) => example.case ?? []));
  // At-least-once means consumers will see repeats, so the repeat is the case to show.
  const needsDuplicate = fm.delivery?.guarantee === 'at-least-once';

  const checks: HealthCheck[] = [
    {
      name: 'summary',
      points: 10,
      earned: fm.summary.length >= 20 && !fm.summary.includes('review before trusting'),
      hint: 'write a real one-line summary',
    },
    {
      name: 'examples',
      points: 10,
      earned: event.examples.length > 0,
      hint: 'add at least one example payload',
    },
    {
      name: 'owner',
      points: 15,
      earned: fm.owner !== undefined,
      hint: 'declare an owning team (or add a CODEOWNERS rule)',
    },
    {
      name: 'semver',
      points: 10,
      earned: SEMVER_RE.test(fm.version),
      hint: 'use semver so diffs and ordering are deterministic',
    },
    {
      name: 'consumers',
      points: 10,
      earned: fm.consumers.length > 0,
      hint: 'declare consumers — drift gating needs the blast radius',
    },
    {
      name: 'producers',
      points: 10,
      earned: fm.producers.length > 0,
      hint: 'declare producers',
    },
    {
      name: 'schema-constraints',
      points: 10,
      earned:
        isJsonObject(event.schema.properties) &&
        Object.keys(event.schema.properties).length > 0 &&
        Array.isArray(event.schema.required),
      hint: 'give the schema properties and required fields',
    },
    {
      name: 'reviewed',
      points: 5,
      earned: !fm.needsReview,
      hint: 'confirm scanner-inferred metadata and clear needsReview',
    },
    {
      name: 'example-cases',
      points: 10,
      earned: needsDuplicate ? cases.has('duplicate') : cases.size > 0,
      hint: needsDuplicate
        ? 'add a repeat under examples/duplicate/ — at-least-once delivery means consumers will see one'
        : 'add an edge case under examples/<case>/: empty, partial, duplicate, late or invalid',
    },
    {
      name: 'correlation',
      points: 10,
      earned: correlationPath(event) !== undefined || fm.envelope !== undefined,
      hint: 'add a correlation id field, or name one with delivery.correlationKey, so a journey can be traced',
    },
  ];

  const score = checks.reduce((sum, c) => sum + (c.earned ? c.points : 0), 0);

  return { domain: fm.domain, eventId: fm.id, score, checks };
}
