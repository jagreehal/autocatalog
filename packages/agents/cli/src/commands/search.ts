import { resolve } from 'node:path';
import kleur from 'kleur';
import { ENTITY_KINDS, loadCatalog, type Entity, type EntityKind } from 'autocatalog-agents-core';

type SearchHit = {
  kind: EntityKind;
  id: string;
  name: string;
  owner: string;
  description?: string;
};

const matches = (query: string, e: Entity): boolean => {
  const q = query.toLowerCase();
  const hay = [e.id, e.name, e.description ?? '', e.owner].join(' ').toLowerCase();

  return hay.includes(q);
};

export const runSearch = async (args: string[]): Promise<number> => {
  let root = '.';
  let query: string | null = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;

    if (a === '--root') root = args[++i] ?? '.';
    else if (a === '--json') json = true;
    else if (!query) query = a;
  }

  if (!query) {
    process.stderr.write('usage: ac-agents search <query> [--root <path>] [--json]\n');

    return 2;
  }

  const cat = await loadCatalog(resolve(root));

  const hits: SearchHit[] = [];

  for (const kind of ENTITY_KINDS) {
    for (const e of cat.entities.get(kind)?.values() ?? []) {
      if (matches(query, e)) {
        const hit: SearchHit = { kind, id: e.id, name: e.name, owner: e.owner };

        if (e.description) hit.description = e.description;
        hits.push(hit);
      }
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(hits, null, 2) + '\n');

    return hits.length > 0 ? 0 : 1;
  }

  process.stdout.write(
    `${kleur.bold('search:')} ${kleur.cyan(`"${query}"`)} — ${hits.length} hit${hits.length === 1 ? '' : 's'}\n\n`,
  );

  if (hits.length === 0) {
    process.stdout.write(`${kleur.dim('(no matches)')}\n`);

    return 1;
  }

  const widest = Math.max(...hits.map((h) => h.kind.length));

  for (const h of hits) {
    const kindCol = kleur.cyan(h.kind.padEnd(widest));
    const ref = `${h.kind}/${h.id}`;
    process.stdout.write(`  ${kindCol}  ${kleur.bold(h.name)} ${kleur.dim(`(${ref})`)}\n`);

    if (h.description)
      process.stdout.write(`              ${kleur.dim(h.description.slice(0, 100))}\n`);
  }

  process.stdout.write('\n');

  return 0;
};
