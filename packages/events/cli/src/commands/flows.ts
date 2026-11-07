import fs from 'node:fs/promises';
import { findCatalogRoots } from 'autocatalog-core';
import {
  checkLifecycles,
  type FlowEvidence,
  headCommit,
  parseTransitionObservations,
  readDomainModel,
  readFlows,
  type TransitionEvidence,
  type TransitionObservations,
  verifyFlows,
  writeFlowEvidence,
} from 'autocatalog-docs-core';
import kleur from 'kleur';
import { checkoutResources } from './docs';

export interface FlowsVerifyOptions {
  root: string;
  observed?: string;
  repo?: string;
  write: boolean;
  json: boolean;
}

const refuted = (row: TransitionEvidence) =>
  row.declared === 'no' || row.schema === 'no' || row.code === 'no';

const countOf = (row: TransitionEvidence) =>
  row.count === undefined ? '' : ` (${row.count.toLocaleString('en-GB')})`;

function report(repository: string, evidence: FlowEvidence): void {
  console.log(kleur.bold(repository));

  for (const row of evidence.transitions) {
    const mark = refuted(row) ? kleur.red('✗') : ' ';

    console.log(`${mark} ${row.flow}/${row.step}: ${row.from.join(' | ')} → ${row.to}`);
    console.log(
      kleur.dim(
        `    declared ${row.declared}, schema ${row.schema}, code ${row.code}, observed ${row.observed}${countOf(row)}, rules ${row.rules}`,
      ),
    );
  }

  for (const { entity, field, from, to, count, via } of evidence.undeclared) {
    console.log(
      `${kleur.yellow('!')} ${entity}.${field}: ${from} → ${to} recorded ${count} ${count === 1 ? 'time' : 'times'} via ${via}, and no flow declares it`,
    );
  }
}

/**
 * The deterministic comparison. Exit 1 when a declared claim is contradicted;
 * something unobserved or unchecked is reported as a gap in evidence.
 */
export async function runFlowsVerify(opts: FlowsVerifyOptions): Promise<number> {
  let observations: TransitionObservations | undefined;

  if (opts.observed) {
    try {
      observations = parseTransitionObservations(await fs.readFile(opts.observed, 'utf8'));
    } catch (error) {
      console.error(
        kleur.red(`--observed ${opts.observed}: ${error instanceof Error ? error.message : error}`),
      );

      return 1;
    }
  }

  const resources = await checkoutResources(opts.root, opts.repo);

  const checkouts = findCatalogRoots(opts.root, { name: opts.repo }).flatMap(
    ({ repository, dir, duplicateOf }) => (duplicateOf === undefined ? [{ repository, dir }] : []),
  );

  const { flows, failures } = readFlows(
    checkouts,
    { resources, relationships: [] },
    { deferMissing: true },
  );

  const model = readDomainModel(checkouts, { resources }, { deferMissing: true });
  const lifecycles = checkLifecycles(flows, model.entities, { deferMissing: true });
  const problems = [...failures, ...model.failures, ...lifecycles.failures];

  const checkedAt = new Date().toISOString().slice(0, 10);

  const records = checkouts.flatMap(({ repository, dir }) => {
    const own = flows.filter((flow) => flow.repository === repository);

    return own.some((flow) => flow.steps.some((step) => step.transition))
      ? [
          {
            repository,
            dir,
            evidence: verifyFlows({
              flows: own,
              allFlows: flows,
              entities: model.entities,
              dir,
              checkedAt,
              commit: headCommit(dir) ?? undefined,
              observations,
            }),
          },
        ]
      : [];
  });

  if (opts.write) {
    for (const { repository, dir, evidence } of records) {
      try {
        writeFlowEvidence(dir, evidence);
      } catch (error) {
        problems.push(
          `${repository}: evidence not written: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        Object.fromEntries(records.map(({ repository, evidence }) => [repository, evidence])),
        null,
        2,
      ),
    );
  } else {
    for (const { repository, evidence } of records) report(repository, evidence);

    if (records.length === 0) console.log('No flow here declares a transition.');
  }

  for (const problem of problems) console.error(`${kleur.red('✗')} ${problem}`);

  const contradicted = records.some(({ evidence }) => evidence.transitions.some(refuted));

  return problems.length > 0 || contradicted ? 1 : 0;
}
