/** @jsxImportSource react */
import type { IconName } from 'autocatalog-docs-astro/icons';
import { Code } from 'autocatalog-docs-astro/ui/components/Code.tsx';
import { Icon } from 'autocatalog-docs-astro/ui/components/Icon.tsx';
import { IconTile } from 'autocatalog-docs-astro/ui/components/IconTile.tsx';
import { ProvenanceStrip } from 'autocatalog-docs-astro/ui/components/ProvenanceStrip.tsx';
import { SectionHeading } from 'autocatalog-docs-astro/ui/components/SectionHeading.tsx';
import { LinkButton } from 'autocatalog-docs-astro/ui/components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'autocatalog-docs-astro/ui/components/ui/card.tsx';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from 'autocatalog-docs-astro/ui/components/ui/item.tsx';

/** The three things autocatalog promises, each the reason for one design choice. */
const promises: Array<{ icon: IconName; title: string; claim: string; detail: string }> = [
  {
    icon: 'repository',
    title: 'By convention',
    claim: 'Discovery, not configuration.',
    detail:
      'Schemas in the repository, prose in docs/. There is no pipeline to assemble and no generator list to keep current, so enrolling a repository means following a convention rather than editing config somewhere else.',
  },
  {
    icon: 'layers',
    title: 'No second model',
    claim: 'Nothing to keep in step.',
    detail:
      'The catalog is generated state, not a copy of your contract that someone updates in a pull request. Narrative sits on top as an override and survives regeneration; it is never the foundation.',
  },
  {
    icon: 'fields',
    title: 'Inspectable',
    claim: 'Every field says where it came from.',
    detail:
      'Declared, extracted, or inferred, linked to the source that produced it. What cannot be established is marked for review rather than filled in with something plausible.',
  },
];

/** What one event definition becomes, with no further writing. */
const derived: Array<{ icon: IconName; title: string; detail: string }> = [
  {
    icon: 'event',
    title: 'Event page',
    detail: 'Schema tree, examples, version diff and snippets.',
  },
  {
    icon: 'service',
    title: 'Service pages',
    detail: 'Built from the producers and consumers on your events.',
  },
  {
    icon: 'architecture',
    title: 'Architecture graph',
    detail: 'Producer to event to consumer, filterable by domain.',
  },
  { icon: 'catalog', title: 'Search', detail: 'Full text, plus find-by-attribute.' },
  {
    icon: 'agent',
    title: 'MCP tools',
    detail: 'Seven of them, so coding agents query the catalog directly.',
  },
  {
    icon: 'tool',
    title: 'A CI gate',
    detail: 'ac drift fails the pull request that breaks a consumer.',
  },
];

/** Where a team's contracts already live, and the guide for each. */
const starts: Array<{ title: string; slug: string }> = [
  { title: 'TypeScript, with Zod', slug: 'docs/events/zod' },
  { title: 'Python, with Pydantic', slug: 'docs/events/pydantic' },
  { title: 'JSON Schema files in a repository', slug: 'docs/events/json-schema' },
  { title: 'An AsyncAPI spec or an EventCatalog project', slug: 'docs/events/importing' },
];

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

export interface HomeProps {
  /** The site's base path, without a trailing slash. */
  base: string;
}

/**
 * The project's front door. The plugin's generated home page is an index of
 * documents; this one says what the tool does, then shows provenance, the one
 * thing that makes it different.
 */
export function Home({ base }: HomeProps) {
  const href = (slug: string) => `${base}/${slug}`;

  return (
    <div className="not-content flex flex-col gap-16 py-6" data-home>
      <header className="flex max-w-3xl flex-col gap-6">
        <h2 className="m-0 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
          Event documentation, generated from the code that runs.
        </h2>
        <p className="m-0 max-w-2xl text-lg text-muted-foreground">
          Point it at a repository, not a docs folder. Autocatalog reads the schemas you already
          wrote, in Zod, Pydantic or plain JSON Schema, and every field it publishes says where it
          came from, down to the line it was read out of.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton href={href('docs/quick-start')} size="lg">
            Quick start
            <Icon name="arrow" />
          </LinkButton>
          <LinkButton href={href('docs/introduction')} variant="outline" size="lg">
            What it does and does not do
          </LinkButton>
        </div>
        <div className="flex max-w-xl flex-col gap-2">
          <Code code="npm create autocatalog@latest my-events" language="bash" label="Install" />
          <p className="m-0 text-sm text-muted-foreground">
            MIT licensed. No licence key and no telemetry.
          </p>
        </div>
      </header>

      <ProvenanceStrip />

      <section className="flex flex-col gap-4" aria-labelledby="promises">
        <SectionHeading id="promises" count="3 promises">
          What it promises
        </SectionHeading>
        <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">
          {promises.map((promise) => (
            <li key={promise.title} className="flex">
              <Card className="w-full">
                <CardHeader>
                  <IconTile name={promise.icon} size="md" />
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-2">
                    <CardTitle role="heading" aria-level={3}>
                      {promise.title}
                    </CardTitle>
                    <p className="m-0 text-sm font-medium">{promise.claim}</p>
                    <CardDescription>{promise.detail}</CardDescription>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="derived">
        <SectionHeading id="derived" count={`${derived.length} outputs`}>
          Derived from one definition
        </SectionHeading>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {derived.map((item) => (
            <li key={item.title} className="flex">
              <Item variant="outline">
                <ItemMedia>
                  <IconTile name={item.icon} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{item.title}</ItemTitle>
                  <ItemDescription>{item.detail}</ItemDescription>
                </ItemContent>
              </Item>
            </li>
          ))}
        </ul>
        <p className="m-0 max-w-2xl text-sm text-muted-foreground">
          You never write a service definition. When two events name the same producer, the service
          page is the union of both.
        </p>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="gate">
        <SectionHeading id="gate">The gate</SectionHeading>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h3 className="m-0 text-xl font-semibold tracking-tight">
              A catalog nobody checks drifts.
            </h3>
            <p className="m-0 text-muted-foreground">
              <code className="font-mono">ac drift</code> scans your default branch and the pull
              request through the same adapters, then compares the two. A removed field, a narrowed
              enum or a newly required field fails the build, and the failure names the consumers it
              breaks, not just the schema that changed.
            </p>
            <p className="m-0 text-sm">
              <a className={link} href={href('docs/drift-ci')}>
                The severity model and the GitHub Actions job
              </a>
            </p>
          </div>
          <Code
            code={
              'git fetch origin main\nac drift --base-ref origin/main --root . --format markdown'
            }
            language="bash"
            label="Run the drift gate"
          />
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="start">
        <SectionHeading id="start" count={`${starts.length} guides`}>
          Start where your contracts already are
        </SectionHeading>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {starts.map((start) => (
            <li key={start.slug} className="flex">
              <Item variant="outline" href={href(start.slug)}>
                <ItemMedia>
                  <IconTile name="braces" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{start.title}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Icon
                    name="external"
                    className="size-4 text-muted-foreground group-hover/item:text-foreground"
                  />
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
        <p className="m-0 max-w-2xl text-sm text-muted-foreground">
          Already using EventCatalog, or deciding?{' '}
          <a className={link} href={href('docs/comparison')}>
            An honest account of what each tool bets on
          </a>
          , including where the other one is the better answer.
        </p>
      </section>
    </div>
  );
}

export default Home;
