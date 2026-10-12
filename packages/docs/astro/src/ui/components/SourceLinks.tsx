/** @jsxImportSource react */
import { FileCodeIcon, PencilIcon } from 'lucide-react';

export interface SourceLinksProps {
  source?: string | null;
  edit?: string | null;
}

const link =
  'inline-flex items-center gap-1.5 text-primary no-underline underline-offset-4 hover:underline';

/**
 * Where a page's content lives, and where to change it. Either may be missing:
 * a checkout with no web-hosted origin has nowhere to point. The caller lays
 * the links out, beside whatever else its row says.
 */
export function SourceLinks({ source, edit }: SourceLinksProps) {
  return (
    <>
      {source && (
        <a href={source} className={link}>
          <FileCodeIcon aria-hidden="true" className="size-3.5 shrink-0" />
          Source
        </a>
      )}
      {edit && (
        <a href={edit} className={link}>
          <PencilIcon aria-hidden="true" className="size-3.5 shrink-0" />
          Edit this page
        </a>
      )}
    </>
  );
}

export default SourceLinks;
