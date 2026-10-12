import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDrift } from '../src/commands/drift';

const here = path.dirname(fileURLToPath(import.meta.url));

const starter = path.resolve(here, '../../../../starters/agent-default');

// An agent that reacts to an event is a consumer the producer never listed.
// It declares that in its own catalog, and the drift gate still names it.
describe('ac drift names agents that consume the event it breaks', () => {
  let work: string;
  let repo: string;
  let baseline: string;

  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-drift-agents-'));
    repo = path.join(work, 'repo');
    baseline = path.join(work, 'baseline-events');

    await fs.cp(starter, repo, { recursive: true });
    await fs.cp(path.join(repo, 'events'), baseline, { recursive: true });

    // Break ticket.opened: remove the `subject` field.
    const schemaFile = path.join(repo, 'events/support/TicketOpened/schema.json');
    const schema = JSON.parse(await fs.readFile(schemaFile, 'utf8'));
    schema.required = ['ticketId', 'customerId'];
    delete schema.properties.subject;
    await fs.writeFile(schemaFile, JSON.stringify(schema));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(work, { recursive: true, force: true });
  });

  const drift = async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const exit = await runDrift({
      base: baseline,
      current: path.join(repo, 'events'),
      format: 'json',
    });

    return { exit, report: JSON.parse(String(log.mock.calls[0]![0])) };
  };

  it('fails the gate and lists the agent as a broken consumer', async () => {
    const { exit, report } = await drift();

    expect(exit).toBe(1);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        eventId: 'ticket.opened',
        severity: 'breaking',
        consumers: ['agent/triage-agent'],
      }),
    );
  });

  it('breaks nobody extra when the agent stops declaring it', async () => {
    const agentFile = path.join(repo, 'agents/triage-agent/autocatalog.json');
    const agent = JSON.parse(await fs.readFile(agentFile, 'utf8'));
    delete agent.consumes;
    await fs.writeFile(agentFile, JSON.stringify(agent));

    const { report } = await drift();

    const broken = report.findings.filter(
      (f: { eventId: string; severity: string }) =>
        f.eventId === 'ticket.opened' && f.severity === 'breaking',
    );

    expect(broken.length).toBeGreaterThan(0);

    for (const finding of broken) expect(finding.consumers).toEqual([]);
  });

  it.each([
    ['subject', ['agent/triage-agent']],
    ['ticketId', []],
    ['subjet', ['agent/triage-agent']],
  ])('reports impact conservatively for the declared field %s', async (field, consumers) => {
    const agentFile = path.join(repo, 'agents/triage-agent/autocatalog.json');
    const agent = JSON.parse(await fs.readFile(agentFile, 'utf8'));
    agent.consumes = [{ event: 'support/ticket.opened', fields: [field] }];
    await fs.writeFile(agentFile, JSON.stringify(agent));

    const { exit, report } = await drift();

    expect(exit).toBe(1);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        eventId: 'ticket.opened',
        kind: 'field_removed',
        consumers,
      }),
    );
  });
});
