/**
 * An Open Data Product Standard (ODPS) v1 data product: `<id>.odps.yaml` at
 * the repository's root or in `data-products/`.
 * Its ports name the ODCS contract they carry by `contractId` and `version`,
 * so one product can publish v1 and v2 of a contract side by side.
 */
import { parse } from 'yaml';
import { z } from 'zod';

export const ODPS_FILE = /\.odps\.ya?ml$/;

// ODPS v1.1 lets a port name only itself; version and contractId are optional.
const port = z.object({
  name: z.string().min(1),
  version: z.string().min(1).optional(),
  contractId: z.string().min(1).optional(),
  description: z.string().optional(),
});

const odpsSchema = z.object({
  apiVersion: z.string().regex(/^v1\./, 'is not an ODPS v1 version'),
  kind: z.literal('DataProduct'),
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  domain: z.string().optional(),
  description: z.object({ purpose: z.string().optional() }).optional(),
  inputPorts: z.array(port).default([]),
  outputPorts: z.array(port).default([]),
});

export type OdpsProduct = z.output<typeof odpsSchema>;

/** Read an ODPS data product. Throws, naming the field, when it is not one. */
export function readOdps(source: string): OdpsProduct {
  const read = odpsSchema.safeParse(parse(source));

  if (!read.success) {
    const issue = read.error.issues[0];
    throw new Error(
      `not an ODPS data product: ${issue?.path.join('.') || 'the file'} ${issue?.message ?? ''}`.trim(),
    );
  }

  return read.data;
}
