import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import kleur from 'kleur';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runImpact } from './impact.js';
import { runValidate } from './validate.js';

const starter = path.resolve(import.meta.dirname, '../../../../../starters/agent-default');

let work: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-agents-events-'));
  await fs.cp(starter, work, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(work, { recursive: true, force: true });
});

// Assertions read the words, not the colour codes around them.
kleur.enabled = false;

/** Run a command and keep what it printed. */
const run = async (command: (args: string[]) => Promise<number>, args: string[]) => {
  let out = '';
  let err = '';

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);

    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    err += String(chunk);

    return true;
  });

  const exit = await command(args);
  vi.restoreAllMocks();

  return { exit, out, err };
};

const setConsumes = async (consumes: string[]) => {
  const file = path.join(work, 'agents/triage-agent/autocatalog.json');
  const agent = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(
    file,
    JSON.stringify({ ...agent, consumes: consumes.map((event) => ({ event })) }),
  );
};

describe('ac agents validate, with an event catalog beside it', () => {
  it('passes, and says the references were checked against which catalog', async () => {
    const { exit, out } = await run(runValidate, [work]);

    expect(exit).toBe(0);
    expect(out).toContain(`events: 2 references resolved against ${path.join(work, 'events')}`);
  });

  it('fails on a misspelt event, and names the one it probably meant', async () => {
    await setConsumes(['support/ticket.open']);

    const { exit, out } = await run(runValidate, [work]);

    expect(exit).toBe(1);
    expect(out).toContain(
      '✗ Agent "triage-agent" consumes unknown event "support/ticket.open" — did you mean "support/ticket.opened"?',
    );
  });

  it('says the references went unchecked when there is no event catalog, rather than passing them', async () => {
    await fs.rm(path.join(work, 'events'), { recursive: true });

    const { exit, out } = await run(runValidate, [work]);

    expect(exit).toBe(0);
    expect(out).toContain('events: 2 references not checked — no event catalog at');
    expect(out).toContain('(pass --events <dir>)');
  });

  it('checks against the catalog --events names, and fails when there is none', async () => {
    const elsewhere = path.join(work, 'elsewhere');
    await fs.rename(path.join(work, 'events'), elsewhere);

    expect((await run(runValidate, [work, '--events', elsewhere])).exit).toBe(0);

    const missing = await run(runValidate, [work, '--events', path.join(work, 'nope')]);
    expect(missing.exit).toBe(1);
    expect(missing.err).toContain('no event catalog at');
  });
});

describe('ac agents impact event/…', () => {
  it('lists producers, consumers, and the agents a tool brings in', async () => {
    const { exit, out } = await run(runImpact, ['event/payments/refund.issued', '--root', work]);

    expect(exit).toBe(0);
    expect(out).toContain('↑ tool/issue-refund');
    expect(out).toContain('~ agent/refund-agent via tool/issue-refund (produces)');
  });

  it('accepts a bare id, and corrects a near miss', async () => {
    expect((await run(runImpact, ['event/ticket.opened', '--root', work])).out).toContain(
      '↓ agent/triage-agent',
    );

    const typo = await run(runImpact, ['event/ticket.opend', '--root', work]);
    expect(typo.exit).toBe(1);
    expect(typo.err).toContain('did you mean "ticket.opened"?');
  });

  it('shows the events an agent consumes in its own impact', async () => {
    const { out } = await run(runImpact, ['agent/triage-agent', '--root', work]);

    expect(out).toContain('↓ consumes support/ticket.opened');
  });
});
