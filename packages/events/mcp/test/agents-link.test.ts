import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assessImpact, checkChange, describeEvent, loadCatalog } from '../src/tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const starter = path.resolve(here, '../../../../starters/agent-default');

// "Who breaks if I change this?" has to include the agents that react to the
// event, even though they declare it in their own catalog and the event does not.
describe('MCP over an event catalog with an agent catalog beside it', () => {
  const load = () => loadCatalog(path.join(starter, 'events'), starter);

  it('names the agent among the consumers a change reaches', async () => {
    const report = assessImpact(await load(), 'support/ticket.opened');

    expect(report.consumers).toEqual(['agent/triage-agent']);
    expect(report.notify).toEqual(['agent/triage-agent']);
  });

  it('tells check_change to notify the agent before the edit is made', async () => {
    const result = checkChange(await load(), 'ticket.opened', {
      type: 'object',
      required: ['ticketId', 'customerId'],
      properties: { ticketId: { type: 'string' }, customerId: { type: 'string' } },
    });

    expect(result.breaking).toBeGreaterThan(0);
    expect(result.notify).toEqual(['agent/triage-agent']);
  });

  it('lists a tool that produces the event beside the service that does', async () => {
    const event = describeEvent(await load(), 'payments/refund.issued');

    expect(event.producers).toEqual(['PaymentService', 'tool/issue-refund']);
  });
});
