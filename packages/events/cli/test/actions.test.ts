import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repository = path.resolve(import.meta.dirname, '../../../..');

const steps = (name: string): Array<{ uses?: string; run?: string }> => {
  const file = path.join(repository, 'actions', name, 'action.yml');

  const action: { runs: { steps: Array<{ uses?: string; run?: string }> } } = parse(
    fs.readFileSync(file, 'utf8'),
  );

  return action.runs.steps;
};

describe.each(['check', 'site'])('the %s action', (name) => {
  it('pins every action it uses to a commit', () => {
    for (const { uses } of steps(name)) {
      if (uses) expect(uses).toMatch(/@[a-f0-9]{40}$/);
    }
  });

  it('passes each value as one argument, so a value with a space survives', () => {
    for (const { run } of steps(name)) expect(run ?? '').not.toMatch(/\$[A-Z_]*ARGS\b(?!\[)/);
  });

  it('hands inputs to its scripts through the environment, never into the script', () => {
    for (const { run } of steps(name)) expect(run ?? '').not.toContain('${{');
  });
});
