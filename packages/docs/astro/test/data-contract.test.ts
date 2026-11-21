import { expect, it } from 'vitest';
import { contractAnchor } from '../src/ui/components/DataContract';

it('gives each contract version its own anchor, apart from an expectation', () => {
  const v1 = contractAnchor({ id: 'customers', version: '1.0.0' });
  const v2 = contractAnchor({ id: 'customers', version: '2.0.0' });
  expect(v1).toBe('contract-customers-v1-0-0');
  expect(v2).not.toBe(v1);
  expect(contractAnchor({ id: 'customers', version: '1.0.0' }, true)).not.toBe(v1);
});
