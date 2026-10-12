/** @jsxImportSource react */
import type { ReactNode } from 'react';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert.tsx';

export interface AsideProps {
  type?: 'note' | 'caution';
  title: string;
  children?: ReactNode;
}

/** A callout for pages that are React all the way down: a note, or a caution. */
export function Aside({ type = 'note', title, children }: AsideProps) {
  const Glyph = type === 'caution' ? TriangleAlertIcon : InfoIcon;

  return (
    // The wrapper opts the callout out of Starlight's prose styles, which also
    // leaves its links unstyled: they take the callout's colour, underlined,
    // as shadcn's preflight would have them.
    <div className="not-content my-6 [&_a]:text-inherit">
      {/* A note is read in place, not announced the moment the page loads. */}
      <Alert role="note" variant={type === 'caution' ? 'destructive' : 'default'}>
        <Glyph aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        {children && <AlertDescription>{children}</AlertDescription>}
      </Alert>
    </div>
  );
}

export default Aside;
