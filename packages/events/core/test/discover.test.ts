import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { discoverEventFolders } from '../src/discover';

const here = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(here, 'fixtures/basic-catalog/events');

describe('discoverEventFolders', () => {
  it('finds every folder containing event metadata', async () => {
    const found = await discoverEventFolders(root);
    // Normalised the way catalog-artifact does, so the expectations below read
    // the same on Windows, where path.relative yields "kyc\KycSubmitted".
    const rels = found.map((f) => path.relative(root, f.path).split(path.sep).join('/')).sort();
    expect(rels).toEqual([
      'kyc/KycSubmitted',
      'orders/OrderPlaced',
      'payments/PaymentCompleted',
      'payments/PaymentCompleted/versioned/0.9.0',
    ]);
  });

  it('marks versioned folders with their parent event path', async () => {
    const found = await discoverEventFolders(root);
    const current = found.find((f) => f.path.endsWith('PaymentCompleted'));
    const old = found.find((f) => f.path.endsWith('0.9.0'));
    expect(current?.isVersioned).toBe(false);
    expect(old?.isVersioned).toBe(true);
    expect(old?.parentEventPath).toBe(current?.path);
  });

  it('derives default domain from first folder under events/', async () => {
    const found = await discoverEventFolders(root);
    const kyc = found.find((f) => f.path.endsWith('KycSubmitted'));
    expect(kyc?.defaultDomain).toBe('kyc');
  });
});
