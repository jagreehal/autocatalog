/** @jsxImportSource react */
import {
  ArrowUpIcon,
  BookOpenIcon,
  CircleCheckIcon,
  FileTextIcon,
  LifeBuoyIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { z } from 'zod';
import type { ChatIconName } from '../text';

/**
 * An icon as a React node, or as a string: an SVG's URL or its markup, drawn
 * in the text colour so it follows the theme.
 */
export type ChatIcon = ReactNode | string;

export const DEFAULT_CHAT_ICONS: Record<ChatIconName, ReactNode> = {
  launcher: <SparklesIcon />,
  empty: <MessageCircleQuestionIcon />,
  send: <ArrowUpIcon />,
  close: <XIcon />,
  support: <LifeBuoyIcon />,
  search: <SearchIcon />,
  read: <FileTextIcon />,
  sources: <BookOpenIcon />,
  thinking: <LoaderCircleIcon className="animate-spin" />,
  thought: <CircleCheckIcon />,
  sent: <CircleCheckIcon />,
};

const svgUrl = (icon: string) =>
  icon.trimStart().startsWith('<svg')
    ? `url("data:image/svg+xml,${encodeURIComponent(icon)}")`
    : `url(${JSON.stringify(icon)})`;

/** One icon, ready to render: a string becomes a mask filled with the text colour. */
export function renderIcon(icon: ChatIcon): ReactNode {
  const svg = z.string().safeParse(icon);

  if (!svg.success) return icon;

  const mask = svgUrl(svg.data);

  // SAFETY: a custom property is a string-valued style React accepts; its type omits them.
  const style = { '--chat-icon': mask } as CSSProperties;

  return (
    <span
      aria-hidden
      data-slot="chat-icon"
      className="inline-block size-4 shrink-0 bg-current"
      style={style}
    />
  );
}
