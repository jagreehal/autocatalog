import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildLlmsTxt, loadCatalog } from 'autocatalog-agents-core';

export const runLlmsTxt = async (args: string[]): Promise<number> => {
  let root = '.';
  let out: string | null = null;
  let title: string | null = null;
  let description: string | null = null;
  let baseUrl: string | null = null;
  let includeBodies = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;

    if (a === '--root') root = args[++i] ?? '.';
    else if (a === '-o' || a === '--out') out = args[++i] ?? null;
    else if (a === '--title') title = args[++i] ?? null;
    else if (a === '--description') description = args[++i] ?? null;
    else if (a === '--base-url') baseUrl = args[++i] ?? null;
    else if (a === '--no-bodies') includeBodies = false;
    else if (!root || root === '.') root = a;
  }

  const cat = await loadCatalog(resolve(root));

  const text = buildLlmsTxt(cat, {
    title: title ?? undefined,
    description: description ?? undefined,
    baseUrl: baseUrl ?? undefined,
    includeBodies,
  });

  if (out) {
    await writeFile(resolve(out), text, 'utf8');
    process.stderr.write(`wrote ${text.length} bytes to ${resolve(out)}\n`);
  } else {
    process.stdout.write(text);
  }

  return 0;
};
