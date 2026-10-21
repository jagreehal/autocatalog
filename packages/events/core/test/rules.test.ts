import { describe, expect, it } from 'vitest';
import { renderDriftMarkdown, summariseDrift } from '../src/drift';
import { ruleFindings } from '../src/rules';

const event = (id: string) => ({ kind: 'event', namespace: 'payments', id });

describe('ruleFindings', () => {
  const outcome = {
    file: 'contracts/rules/owners.rule.ts',
    result: {
      id: 'owners',
      name: 'Every event has an owner',
      severity: 'suspicious' as const,
      violations: [
        { message: 'no owner', resource: event('payment.completed') },
        { message: 'no owner', resource: event('legacy.charged') },
      ],
    },
  };

  it('takes the rule’s severity unless rules.json overrides it, and skips its exceptions', () => {
    expect(ruleFindings([outcome]).map((f) => `${f.severity} ${f.eventId}`)).toEqual([
      'suspicious event/payment.completed',
      'suspicious event/legacy.charged',
    ]);

    const configured = ruleFindings([outcome], {
      severity: { owners: 'breaking' },
      except: { owners: ['event:payments/legacy.*'] },
    });

    expect(configured.map((f) => `${f.severity} ${f.eventId}`)).toEqual([
      'breaking event/payment.completed',
    ]);
    expect(ruleFindings([outcome], { severity: { owners: 'off' } })).toEqual([]);
  });

  it('prints nothing from a rule that could break out of the report', () => {
    const md = renderDriftMarkdown(
      summariseDrift(
        ruleFindings([
          {
            file: 'contracts/rules/x.rule.ts',
            result: {
              id: 'x',
              name: 'X',
              violations: [
                {
                  message: 'see ![](https://evil/p.png) @org/admins `code`',
                  resource: event('![](https://evil/e.png)'),
                },
              ],
            },
          },
          { file: 'contracts/rules/y.rule.ts', error: 'boom\n![](https://evil/y.png)' },
        ]),
      ),
    );

    expect(md).not.toMatch(/!\[|@org|`code`/);
    expect(md).toContain('## catalog');
    expect(md).toContain('the rule in contracts/rules/y.rule.ts did not run: boom');
  });
});
