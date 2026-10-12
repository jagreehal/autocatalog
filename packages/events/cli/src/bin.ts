import fs from 'node:fs';
import { buildProgramWithAdapters } from './index';

/**
 * `autocatalog .` and `ac .` mean "scan this repository".
 *
 * The first thing anyone runs should point at their own code rather than
 * scaffold somebody else's sample, and a bare directory cannot mean anything
 * else here. Only an existing directory qualifies, so a mistyped command still
 * gets commander's "unknown command" instead of a surprise scan.
 */
export function withImpliedScan(argv: string[], commands: string[]): string[] {
  const [node, entry, first, ...rest] = argv;

  if (!first || first.startsWith('-') || commands.includes(first)) return argv;

  try {
    if (!fs.statSync(first).isDirectory()) return argv;
  } catch {
    return argv;
  }

  return [node!, entry!, 'scan', first, ...rest];
}

(async () => {
  const program = await buildProgramWithAdapters(process.cwd());
  const names = program.commands.flatMap((command) => [command.name(), ...command.aliases()]);
  await program.parseAsync(withImpliedScan(process.argv, names));
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
