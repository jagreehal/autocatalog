import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdapter } from '../src/runner';

const here = path.dirname(fileURLToPath(import.meta.url));

const curveFixture = path.join(here, 'fixtures/curve-export.ts');

const explicitFixture = path.join(here, 'fixtures/explicit-export.ts');

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-runner-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('runAdapter', () => {
  it('processes a curve-style module with auto-detected shape', async () => {
    const result = await runAdapter({
      module: curveFixture,
      exportName: 'jsonSchemas',
      out: tmp,
    });

    expect(result.eventsWritten).toBe(2);
    expect(result.errors).toEqual([]);

    const completedManifest = JSON.parse(
      await fs.readFile(path.join(tmp, 'payment/PaymentCompleted/autocatalog.json'), 'utf8'),
    );

    expect(completedManifest.id).toBe('payment.completed');
    expect(completedManifest.version).toBe('v1');
  });

  it('processes an explicit-IR module', async () => {
    const result = await runAdapter({
      module: explicitFixture,
      exportName: 'events',
      out: tmp,
    });

    expect(result.eventsWritten).toBe(1);

    const manifest = JSON.parse(
      await fs.readFile(path.join(tmp, 'kyc/KycSubmitted/autocatalog.json'), 'utf8'),
    );

    expect(manifest.id).toBe('kyc.submitted');
    expect(manifest.version).toBe('1.0.0');
  });

  it('returns an error if the module cannot be loaded', async () => {
    await expect(
      runAdapter({ module: '/non/existent/path.ts', exportName: 'x', out: tmp }),
    ).rejects.toThrow();
  });

  it('returns an error if the named export is missing', async () => {
    await expect(
      runAdapter({ module: curveFixture, exportName: 'nopeNope', out: tmp }),
    ).rejects.toThrow(/export/i);
  });
});
