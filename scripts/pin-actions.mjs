// The Actions run the autocatalog release they ship with, not whatever is
// newest: a workflow pinned to @v1 should not change behaviour under it.
// `changeset version` bumps the package; this writes that version into each
// action.yml. With --check it writes nothing and fails on a stale pin.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const { version } = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/events/autocatalog/package.json'), 'utf8'),
);

const check = process.argv.includes('--check');

const pin = /(\n  version:\n    description: [^\n]*\n    default: )'[^']*'/;

let stale = 0;

for (const action of fs.readdirSync(path.join(root, 'actions'))) {
  const file = path.join(root, 'actions', action, 'action.yml');
  const text = fs.readFileSync(file, 'utf8');

  if (!pin.test(text)) {
    console.error(`${path.relative(root, file)}: no version input to pin`);
    stale++;
    continue;
  }

  const pinned = text.replace(pin, `$1'${version}'`);

  if (pinned === text) {
    continue;
  }

  if (check) {
    console.error(
      `${path.relative(root, file)}: version is not ${version}; run node scripts/pin-actions.mjs`,
    );
    stale++;
  } else {
    fs.writeFileSync(file, pinned);
    console.log(`${path.relative(root, file)}: autocatalog@${version}`);
  }
}

process.exit(stale > 0 ? 1 : 0);
