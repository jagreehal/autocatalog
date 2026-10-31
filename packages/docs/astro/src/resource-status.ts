import type { PillTone } from './shell';
import { versionLabel } from './shell';

/** One banner a resource page shows above its body. */
export interface StatusBanner {
  tone: 'warn' | 'quiet' | 'info';
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
}

export interface ResourceStatusInput {
  status?: string | undefined;
  version?: string | undefined;
  /** Plain-language deprecation notice, when the resource is deprecated. */
  deprecation?: string | null | undefined;
  needsReview?: boolean | undefined;
  /** A newer published version the reader should prefer. */
  newer?: { version: string; href: string } | undefined;
}

/** Pills for the title row: version, status, needs-review. */
export function statusPills(input: ResourceStatusInput): Array<{ text: string; tone?: PillTone }> {
  const pills: Array<{ text: string; tone?: PillTone }> = [];

  if (input.version) pills.push({ text: versionLabel(input.version) });

  if (input.status && input.status !== 'active') {
    pills.push({
      text: input.status,
      tone: input.status === 'draft' ? 'quiet' : 'warn',
    });
  }

  if (input.needsReview) pills.push({ text: 'needs review', tone: 'warn' });

  if (input.newer) pills.push({ text: 'new version available', tone: 'warn' });

  return pills;
}

/** Banners a reader cannot miss: draft, deprecated, review, newer version. */
export function statusBanners(input: ResourceStatusInput): StatusBanner[] {
  const banners: StatusBanner[] = [];

  if (input.newer) {
    banners.push({
      tone: 'info',
      title: 'New version available',
      body: `Version ${input.newer.version} is current.`,
      href: input.newer.href,
      linkLabel: versionLabel(input.newer.version),
    });
  }

  if (input.status === 'deprecated' || input.deprecation) {
    banners.push({
      tone: 'warn',
      title: 'Deprecated',
      body: input.deprecation?.trim() || 'This resource is deprecated.',
    });
  }

  if (input.status === 'draft') {
    banners.push({
      tone: 'quiet',
      title: 'Draft',
      body: 'This contract may still change. Agree it with the owner before depending on it.',
    });
  }

  if (input.needsReview) {
    banners.push({
      tone: 'warn',
      title: 'Needs review',
      body: 'Something on this page could not be established from the repositories. Check the provenance marks.',
    });
  }

  return banners;
}
