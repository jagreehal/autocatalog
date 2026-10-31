/** @jsxImportSource react */
import { InfoIcon, PencilLineIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert.tsx';
import type { StatusBanner } from '../../resource-status';

const ICONS = {
  warn: TriangleAlertIcon,
  quiet: PencilLineIcon,
  info: InfoIcon,
} as const;

/** Resource state a reader must not miss: draft, deprecated, review, newer version. */
export function StatusBanners({ banners }: { banners: StatusBanner[] }) {
  if (banners.length === 0) return null;

  return (
    <div className="not-content flex flex-col gap-3" data-status-banners="">
      {banners.map((banner) => {
        const Icon = ICONS[banner.tone];

        return (
          <Alert key={banner.title} data-status-banner={banner.title}>
            <Icon />
            <AlertTitle>{banner.title}</AlertTitle>
            <AlertDescription>
              {banner.body}
              {banner.href && banner.linkLabel && (
                <>
                  {' '}
                  <a className="text-foreground underline underline-offset-4" href={banner.href}>
                    {banner.linkLabel}
                  </a>
                </>
              )}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
