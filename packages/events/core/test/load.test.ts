import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadEventFolder } from '../src/load';

const here = path.dirname(fileURLToPath(import.meta.url));

const folder = path.join(here, 'fixtures/basic-catalog/events/payments/PaymentCompleted');

describe('loadEventFolder', () => {
  it('parses frontmatter, body, schema, and auto-discovers examples', async () => {
    const loaded = await loadEventFolder({
      path: folder,
      defaultDomain: 'payments',
      isVersioned: false,
      parentEventPath: null,
    });

    expect(loaded.frontmatter.id).toBe('payment.completed');
    expect(loaded.frontmatter.version).toBe('1.0.0');
    expect(loaded.frontmatter.domain).toBe('payments'); // filled from default
    expect(loaded.body.trim()).toBe('A payment completed.');
    expect(loaded.schema.type).toBe('object');
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.examples[0]?.data).toEqual({ id: 'pay_1', amount: 4999 });
    expect(loaded.examples[0]?.name).toBe('success');
  });

  it('preserves an explicit domain in frontmatter over the default', async () => {
    // Reuse the kyc fixture; tweak via reading
    const kyc = path.join(here, 'fixtures/basic-catalog/events/kyc/KycSubmitted');

    const loaded = await loadEventFolder({
      path: kyc,
      defaultDomain: 'kyc',
      isVersioned: false,
      parentEventPath: null,
    });

    expect(loaded.frontmatter.domain).toBe('kyc');
  });

  it('loads a manifest-only event folder without requiring MDX', async () => {
    const orders = path.join(here, 'fixtures/basic-catalog/events/orders/OrderPlaced');

    const loaded = await loadEventFolder({
      path: orders,
      defaultDomain: 'orders',
      isVersioned: false,
      parentEventPath: null,
    });

    expect(loaded.frontmatter.id).toBe('order.placed');
    expect(loaded.frontmatter.domain).toBe('orders');
    expect(loaded.body).toBe('');
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.examples[0]?.data).toEqual({ id: 'ord_1', total: 149.99 });
  });

  it('throws a useful error on an invalid manifest', async () => {
    const tmp = path.join(here, 'fixtures/_bad-tmp');
    await import('node:fs/promises').then(async (fs) => {
      await fs.mkdir(tmp, { recursive: true });
      await fs.writeFile(path.join(tmp, 'autocatalog.json'), '{ "id": 1 }');
    });
    await expect(
      loadEventFolder({
        path: tmp,
        defaultDomain: 'x',
        isVersioned: false,
        parentEventPath: null,
      }),
    ).rejects.toThrow(/event metadata/i);
  });

  it('rejects an MDX-only folder — frontmatter is not read', async () => {
    const tmp = path.join(here, 'fixtures/_bad-mdxonly-tmp');
    await import('node:fs/promises').then(async (fs) => {
      await fs.mkdir(tmp, { recursive: true });
      await fs.writeFile(
        path.join(tmp, 'index.mdx'),
        '---\nid: legacy\nversion: 1.0.0\nname: L\nsummary: s\n---\n',
      );
    });
    await expect(
      loadEventFolder({
        path: tmp,
        defaultDomain: 'x',
        isVersioned: false,
        parentEventPath: null,
      }),
    ).rejects.toThrow(/Missing autocatalog\.json/);
  });
});
