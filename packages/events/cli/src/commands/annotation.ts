import fs from 'node:fs';
import path from 'node:path';

/** A failure as GitHub shows it on the file it names: `<file>: <message>`. */
export function githubAnnotation(failure: string, root?: string): string {
  const escape = (text: string) =>
    text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

  const named = /^([^\s:]+\.[\w.]+)(?: \([^)]*\))?: ([\s\S]*)$/.exec(failure);

  // Some failures lead with the repository's name, which is no path to mark.
  return named && (!root || fs.existsSync(path.join(root, named[1]!)))
    ? `::error file=${named[1]}::${escape(named[2]!)}`
    : `::error::${escape(failure)}`;
}
