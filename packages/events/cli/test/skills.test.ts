import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import matter from 'gray-matter';
import { buildProgram } from '../src/index';
import { describe, expect, it } from 'vitest';

// A skill is a prompt an agent follows without checking. When it names a command
// that no longer exists, nothing errors — the agent improvises, and the failure
// surfaces as a confidently wrong catalog. These tests hold every command and
// flag in every skill against the CLI that is actually shipped.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills');

const skills = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('autocatalog-'))
  .map((entry) => entry.name)
  .sort();

function skillFile(name: string): string {
  return fs.readFileSync(path.join(root, name, 'SKILL.md'), 'utf8');
}

/**
 * Command invocations, taken only from fenced blocks and inline code spans.
 * Scanning prose would treat "ac docs check and the site" as a three-word
 * command.
 */
function invocations(markdown: string): string[] {
  const lines: string[] = [];

  for (const [, block] of markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    lines.push(...block!.split('\n'));
  }

  for (const [, span] of markdown.matchAll(/`([^`\n]+)`/g)) lines.push(span!);

  return lines.flatMap((line) => {
    const trimmed = line.trim();

    return /^ac(\s|$)/.test(trimmed) ? [trimmed] : [];
  });
}

/** Walk a command path (`docs check`) down the real program. */
function resolveCommand(program: Command, tokens: string[]) {
  let current: Command | undefined;
  let used = 0;

  for (const token of tokens) {
    const next: Command | undefined = (current ?? program).commands.find(
      (candidate) => candidate.name() === token,
    );

    if (!next) break;
    current = next;
    used += 1;
  }

  return { command: current, used };
}

function optionFlags(command: Command): Set<string> {
  const flags = new Set<string>(['--help', '-h']);

  for (const option of command.options) {
    for (const flag of option.flags.split(/[ ,|]+/)) {
      if (flag.startsWith('-')) flags.add(flag);
    }
  }

  return flags;
}

describe('every skill is well formed', () => {
  it('ships at least the documented set', () => {
    expect(skills).toEqual([
      'autocatalog-agents-add',
      'autocatalog-agents-audit',
      'autocatalog-bootstrap',
      'autocatalog-docs',
      'autocatalog-docs-enroll',
      'autocatalog-drift',
      'autocatalog-impact',
      'autocatalog-investigate',
      'autocatalog-scan',
    ]);
  });

  it.each(skills)('%s declares a name matching its directory', (skill) => {
    const { data } = matter(skillFile(skill));
    expect(data.name).toBe(skill);
  });

  it.each(skills)('%s says when to use it, in one line', (skill) => {
    const { data } = matter(skillFile(skill));
    const description = String(data.description ?? '');
    // The description is the only thing an agent reads when deciding whether
    // this skill applies, so a vague one is a skill that never fires.
    expect(description.length).toBeGreaterThan(80);
    expect(description).toMatch(/Use (when|before)/);
    expect(description).not.toContain('\n');
  });

  it.each(skills)('%s tells the agent what to refuse', (skill) => {
    // Every one of these workflows has a plausible-looking shortcut that
    // quietly breaks the guarantee. Naming them is the point of the skill.
    expect(skillFile(skill)).toContain('Anti-patterns');
  });

  it('lists every skill in the README, and lists nothing that does not exist', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

    const names = [...readme.matchAll(/\.\/(autocatalog-[a-z-]+)\/SKILL\.md/g)].map(
      (match) => match[1]!,
    );

    const linked = [...new Set(names)].sort();

    expect(linked).toEqual(skills);
  });
});

describe('every command a skill teaches exists in the shipped CLI', () => {
  const program = buildProgram();

  // The agent skills drive `ac-agents`, which exposes no commander program to walk.
  const acSkills = skills.filter((skill) => !skill.startsWith('autocatalog-agents-'));

  it.each(acSkills)('%s names only real commands and flags', (skill) => {
    const lines = invocations(skillFile(skill));
    // A skill that never touches the tool is documentation, not a skill.
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      const tokens = line.split(/\s+/).slice(1);
      const words = tokens.filter((token) => !token.startsWith('-'));
      const { command, used } = resolveCommand(program, words);

      expect(command, `${skill}: "${line}" is not a command this CLI has`).toBeDefined();
      // Anything after the resolved path is an argument (a path, a ref); flags
      // are what get renamed and silently break a skill.
      const flags = optionFlags(command!);

      for (const token of tokens.filter((token) => token.startsWith('-'))) {
        const flag = token.split('=')[0]!;
        expect(
          flags.has(flag),
          `${skill}: "${line}" passes ${flag}, which "ac ${words.slice(0, used).join(' ')}" does not accept`,
        ).toBe(true);
      }
    }
  });
});
