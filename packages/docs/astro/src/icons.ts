import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BookAIcon,
  BookOpenIcon,
  BoxIcon,
  BotIcon,
  BoxesIcon,
  BracesIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  CopyIcon,
  ComponentIcon,
  CpuIcon,
  DatabaseIcon,
  FileTextIcon,
  GlobeIcon,
  GitBranchIcon,
  HouseIcon,
  LayersIcon,
  ListChecksIcon,
  ListIcon,
  Link2Icon,
  type LucideIcon,
  MessageSquareIcon,
  MoonIcon,
  NetworkIcon,
  PackageIcon,
  RouteIcon,
  ScaleIcon,
  SearchIcon,
  ServerCogIcon,
  ServerIcon,
  SirenIcon,
  SunIcon,
  TableIcon,
  UsersIcon,
  WaypointsIcon,
  WorkflowIcon,
  PencilRulerIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';

/** Every icon the site draws, by what it stands for: Lucide, shadcn/ui's icon library. */
export const icons = {
  home: HouseIcon,
  catalog: TableIcon,
  search: SearchIcon,
  chat: MessageSquareIcon,
  fields: ListIcon,
  owners: UsersIcon,
  architecture: NetworkIcon,
  api: GlobeIcon,
  endpoint: RouteIcon,
  gateway: WaypointsIcon,
  relationship: Link2Icon,
  event: ZapIcon,
  service: ServerIcon,
  agent: BotIcon,
  tool: WrenchIcon,
  'mcp-server': ServerCogIcon,
  component: ComponentIcon,
  doc: FileTextIcon,
  domain: BoxesIcon,
  data: DatabaseIcon,
  model: CpuIcon,
  repository: GitBranchIcon,
  channel: ArrowLeftRightIcon,
  book: BookOpenIcon,
  layers: LayersIcon,
  braces: BracesIcon,
  flow: WorkflowIcon,
  design: PencilRulerIcon,
  glossary: BookAIcon,
  entity: BoxIcon,
  dataProduct: PackageIcon,
  copy: CopyIcon,
  check: CheckIcon,
  external: ArrowUpRightIcon,
  arrow: ArrowRightIcon,
  'chevron-right': ChevronRightIcon,
  'chevron-down': ChevronDownIcon,
  'chevron-left': ChevronLeftIcon,
  decision: ScaleIcon,
  runbook: ListChecksIcon,
  incident: SirenIcon,
  sun: SunIcon,
  moon: MoonIcon,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

/** The icon a resource kind is drawn with; any kind without one is a document. */
// Kinds drawn with an icon named for something else, as EventCatalog draws them.
const KIND_ICONS = new Map<string, IconName>([
  ['document', 'doc'],
  ['owner', 'owners'],
  ['command', 'chat'],
  ['query', 'search'],
  ['queue', 'channel'],
  ['topic', 'channel'],
  ['term', 'glossary'],
]);

export function kindIcon(kind: string): IconName {
  const icon = KIND_ICONS.get(kind);

  if (icon) return icon;

  return isIcon(kind) ? kind : 'doc';
}

export function isIcon(name: string): name is IconName {
  return Object.hasOwn(icons, name);
}
