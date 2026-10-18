/** @jsxImportSource react */
import { BracesIcon, ChevronRightIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Button, LinkButton } from '#ui/components/ui/button.tsx';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
import { Collapsible, CollapsibleContent } from '#ui/components/ui/collapsible.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/components/ui/input-group.tsx';
import type { PropNode } from '../lib/schema-tree';

/**
 * A JSON Schema as a readable tree: every property with its type, whether it
 * is required, its description, and the constraints a consumer has to honour.
 * A property search and expand or collapse all sit above it.
 */
export interface SchemaTreeProps {
  /** The schema's properties, from `schemaTree`, which runs where the page is built. */
  nodes: PropNode[];
}

function flatten(nodes: PropNode[]): PropNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/** Whether `id` is a descendant of `ancestor`: `0.2.1` is inside `0.2`, and inside `0`. */
const isInside = (id: string, ancestor: string) => id.startsWith(`${ancestor}.`);

/** Every ancestor of `id`, outermost first and not including itself: `0.2.1` has `0` and `0.2`. */
function ancestorsOf(id: string): string[] {
  const parts = id.split('.');

  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('.'));
}

const noSubscription = () => () => {};

const noun = (count: number) => (count === 1 ? 'property' : 'properties');

export function SchemaTree({ nodes }: SchemaTreeProps) {
  const flat = useMemo(() => flatten(nodes), [nodes]);

  const [query, setQuery] = useState('');

  // Search and expand all do nothing until React runs, so they wait for it;
  // the tree itself is all in the served page.
  const ready = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  // Disclosure is state rather than the browser's, so expand and collapse all,
  // and a search that opens its matches' ancestors, are plain updates.
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(flat.flatMap((node) => (node.children && node.depth < 2 ? [node.id] : []))),
  );

  const needle = query.trim().toLocaleLowerCase();

  const matches = useMemo(
    () => (needle ? flat.filter((node) => node.name.toLocaleLowerCase().includes(needle)) : []),
    [flat, needle],
  );

  // A match keeps its ancestors and descendants visible, so it is seen in place.
  const visible = useMemo(
    () =>
      needle
        ? new Set(
            flat.flatMap((node) =>
              matches.some(
                (match) =>
                  match.id === node.id ||
                  isInside(node.id, match.id) ||
                  isInside(match.id, node.id),
              )
                ? [node.id]
                : [],
            ),
          )
        : null,
    [flat, matches, needle],
  );

  const total = flat.length;

  const search = (value: string) => {
    setQuery(value);

    const next = value.trim().toLocaleLowerCase();

    if (!next) return;

    const opened = flat.flatMap((node) =>
      node.name.toLocaleLowerCase().includes(next) ? ancestorsOf(node.id) : [],
    );

    setOpen((current) => new Set([...current, ...opened]));
  };

  const toggle = (id: string, isOpen: boolean) =>
    setOpen((current) => {
      if (current.has(id) === isOpen) return current;

      const next = new Set(current);

      if (isOpen) next.add(id);
      else next.delete(id);

      return next;
    });

  const tree = (
    <ul className="m-0 flex list-none flex-col p-0" role="tree">
      {nodes.map((node) => (
        <Prop key={node.id} node={node} open={open} visible={visible} onToggle={toggle} />
      ))}
    </ul>
  );

  if (total === 0) {
    return (
      <div className="not-content flex border border-dashed" data-schema>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BracesIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No properties</EmptyTitle>
            <EmptyDescription>
              The schema accepts an object but names none of its fields. Describe them in the
              event&apos;s schema to show them here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="not-content flex flex-col gap-3" data-schema>
      <div className="flex flex-wrap items-center gap-2" hidden={!ready} data-schema-bar>
        <InputGroup className="flex-1 basis-40">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Search properties…"
            aria-label="Search properties"
            value={query}
            onChange={(event) => search(event.target.value)}
          />
        </InputGroup>
        <Button
          variant="outline"
          size="sm"
          onPress={() => setOpen(new Set(flat.flatMap((node) => (node.children ? [node.id] : []))))}
        >
          Expand all
        </Button>
        <Button variant="outline" size="sm" onPress={() => setOpen(new Set())}>
          Collapse all
        </Button>
        <span
          className="ml-auto text-xs whitespace-nowrap text-muted-foreground"
          aria-live="polite"
          data-total={total}
        >
          {needle ? `${matches.length} of ${total} ${noun(total)}` : `${total} ${noun(total)}`}
        </span>
      </div>
      {tree}
    </div>
  );
}

interface PropProps {
  node: PropNode;
  open: ReadonlySet<string>;
  /** The ids a search leaves showing, or null when nothing is being searched for. */
  visible: ReadonlySet<string> | null;
  onToggle: (id: string, open: boolean) => void;
}

function Prop({ node, open, visible, onToggle }: PropProps) {
  if (visible && !visible.has(node.id)) return null;

  const row = (
    <>
      <code className="font-mono text-sm font-medium text-foreground">{node.name}</code>
      <span className="font-mono text-xs text-muted-foreground">{node.type}</span>
      {node.required && (
        <Badge variant="outline" className="ml-auto self-center">
          required
        </Badge>
      )}
    </>
  );

  const details = (
    <>
      {node.description && <p className="m-0 text-xs text-muted-foreground">{node.description}</p>}
      {node.facts.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Constraints">
          {node.facts.map((fact) => (
            <li key={fact}>
              <code className="bg-muted px-1.5 py-0.5 font-mono text-xs wrap-anywhere">{fact}</code>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const heading = <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">{row}</div>;

  return (
    <li className="m-0" role="treeitem" data-name={node.name.toLocaleLowerCase()}>
      {node.children ? (
        <Collapsible
          isExpanded={open.has(node.id)}
          onExpandedChange={(isOpen) => onToggle(node.id, isOpen)}
        >
          <div className="flex items-center gap-1 py-1.5 pr-2.5">
            <Button slot="trigger" variant="ghost" size="icon-xs" aria-label={node.name}>
              <ChevronRightIcon className="transition-transform group-aria-expanded/button:rotate-90" />
            </Button>
            {heading}
          </div>
          <CollapsibleContent>
            {(node.description || node.facts.length > 0) && (
              <div className="flex flex-col gap-1 pr-2.5 pb-1.5 pl-7">{details}</div>
            )}
            {/* The rail runs down from the chevron, so a child sits under its parent's name. */}
            <ul className="m-0 ml-3 flex list-none flex-col border-l p-0 pl-1" role="group">
              {node.children.map((child) => (
                <Prop
                  key={child.id}
                  node={child}
                  open={open}
                  visible={visible}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        // A leaf lines up with a branch's name: the chevron's width, held empty.
        <div className="flex flex-col gap-1 py-1.5 pr-2.5 pl-7">
          {heading}
          {details}
        </div>
      )}
    </li>
  );
}

/** The schema card on an event's pages: the tree, a link to the file, and what the file is for. */
export function SchemaSection({
  nodes,
  href,
  note,
}: {
  nodes: PropNode[];
  href: string;
  note: ReactNode;
}) {
  return (
    <div className="not-content">
      <Card id="schema">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Schema
          </CardTitle>
          <CardAction>
            <LinkButton variant="link" size="sm" href={href}>
              schema.json
            </LinkButton>
          </CardAction>
        </CardHeader>
        <CardContent>
          <SchemaTree nodes={nodes} />
        </CardContent>
        <CardFooter>
          <p className="m-0 text-xs text-muted-foreground">{note}</p>
        </CardFooter>
      </Card>
    </div>
  );
}

export default SchemaTree;
