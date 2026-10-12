import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  BotIcon,
  BoxesIcon,
  BracesIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  CpuIcon,
  FileTextIcon,
  GitBranchIcon,
  HouseIcon,
  LayersIcon,
  ListIcon,
  type LucideIcon,
  MoonIcon,
  NetworkIcon,
  ServerIcon,
  SunIcon,
  TableIcon,
  UsersIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';

/** Every icon the site draws, by what it stands for: Lucide, shadcn/ui's icon library. */
export const icons = {
  home: HouseIcon,
  catalog: TableIcon,
  fields: ListIcon,
  owners: UsersIcon,
  architecture: NetworkIcon,
  event: ZapIcon,
  service: ServerIcon,
  agent: BotIcon,
  tool: WrenchIcon,
  doc: FileTextIcon,
  domain: BoxesIcon,
  model: CpuIcon,
  repository: GitBranchIcon,
  channel: ArrowLeftRightIcon,
  book: BookOpenIcon,
  layers: LayersIcon,
  braces: BracesIcon,
  copy: CopyIcon,
  external: ArrowUpRightIcon,
  arrow: ArrowRightIcon,
  'chevron-right': ChevronRightIcon,
  'chevron-down': ChevronDownIcon,
  'chevron-left': ChevronLeftIcon,
  sun: SunIcon,
  moon: MoonIcon,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

/** The icon a resource kind is drawn with; any kind without one is a document. */
export function kindIcon(kind: string): IconName {
  if (kind === 'document') return 'doc';

  if (kind === 'owner') return 'owners';

  return isIcon(kind) ? kind : 'doc';
}

function isIcon(name: string): name is IconName {
  return Object.hasOwn(icons, name);
}
