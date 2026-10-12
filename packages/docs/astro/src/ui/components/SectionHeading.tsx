/** @jsxImportSource react */
import type { ReactNode } from 'react';
import { Separator } from '#ui/components/ui/separator.tsx';

/** A section's heading, a quiet rule, and its count on the right. */
export function SectionHeading({
  id,
  count,
  children,
}: {
  id: string;
  count?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <h2 id={id} className="m-0 text-base font-semibold">
        {children}
      </h2>
      <Separator className="w-auto flex-1" />
      {count && <span className="text-xs text-muted-foreground">{count}</span>}
    </div>
  );
}

export default SectionHeading;
