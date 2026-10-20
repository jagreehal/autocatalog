/** @jsxImportSource react */
import type { IconName } from 'autocatalog-docs-astro/icons';
import { rule, tone } from 'autocatalog-docs-astro/ui/components/Evidence.tsx';
import { Icon } from 'autocatalog-docs-astro/ui/components/Icon.tsx';
import { Badge } from 'autocatalog-docs-astro/ui/components/ui/badge.tsx';
import { LinkButton, buttonVariants } from 'autocatalog-docs-astro/ui/components/ui/button.tsx';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from 'autocatalog-docs-astro/ui/components/ui/item.tsx';
import { cn } from 'cn';
import type { ReactNode } from 'react';

export interface HomeProps {
  /** The site's base path, without a trailing slash. */
  base: string;
}

const c = (text: string) => <code>{text}</code>;

/** What lands on the site, and where each part is read from. */
const lands: Array<{ title: string; from: string; what: ReactNode }> = [
  {
    title: 'Docs',
    from: 'docs/**/*.md',
    what: 'With the owner, the date git last saw each page change, and backlinks from every other repository.',
  },
  {
    title: 'Decisions, runbooks, incidents',
    from: 'docs/adr, runbooks, incidents',
    what: (
      <>
        The folder sets the kind. Each kind gets one index across every repository, newest first,
        filtered by status. Add or rename kinds in {c('contracts/autocatalog.conventions.json')}.
      </>
    ),
  },
  {
    title: 'Events',
    from: 'contracts/',
    what: 'Schema, examples, version history and the file that defines each one.',
  },
  {
    title: 'Services',
    from: 'built, not written',
    what: (
      <>Made from the events that name them, with every document whose {c('about:')} lists them.</>
    ),
  },
  {
    title: 'Domains',
    from: 'from each event',
    what: 'The events in a domain, the services around them and their owners, with a map.',
  },
  {
    title: 'APIs',
    from: 'contracts/*.openapi.*',
    what: 'An API reference for each OpenAPI 3 spec, linked to the service it names.',
  },
  {
    title: 'Data models',
    from: 'Prisma, Drizzle, Mongoose',
    what: 'Each table and collection, its fields, and the services that read and write it.',
  },
  {
    title: 'Owners',
    from: 'CODEOWNERS',
    what: <>Each team's contact and everything it owns, also from {c('catalog-info.yaml')}.</>,
  },
];

/** The rows of the example service page. */
const pageBlocks: Array<{
  title: string;
  count: string;
  rows: Array<{ icon: IconName; name: string; note: string; badge?: string }>;
}> = [
  {
    title: 'Produces',
    count: '2 events',
    rows: [
      {
        icon: 'event',
        name: 'payment.completed',
        note: 'read by ledger and notifications',
        badge: '1.0.0',
      },
      { icon: 'event', name: 'payment.refunded', note: 'read by notifications', badge: '2.1.0' },
    ],
  },
  {
    title: 'API',
    count: 'OpenAPI 3.1',
    rows: [{ icon: 'api', name: 'Payments API', note: 'operations under /payments' }],
  },
  {
    title: 'Data',
    count: 'reads',
    rows: [{ icon: 'data', name: 'payments', note: 'collection, Mongoose' }],
  },
  {
    title: 'Decisions',
    count: '2',
    rows: [
      {
        icon: 'decision',
        name: '0003 Kafka for payment events',
        note: '2026-03-14',
        badge: 'accepted',
      },
      {
        icon: 'decision',
        name: '0001 RabbitMQ for payment events',
        note: '2025-06-02',
        badge: 'superseded',
      },
    ],
  },
  {
    title: 'Runbooks',
    count: '1',
    rows: [
      {
        icon: 'runbook',
        name: 'Replay payment events',
        note: 'tested 2026-09-02',
        badge: 'sev2',
      },
    ],
  },
  {
    title: 'Docs',
    count: '1',
    rows: [{ icon: 'doc', name: 'Settlement flow', note: 'changed 2026-10-07' }],
  },
];

/** The three conventions the site reads, in the order a repository usually has them. */
const steps: Array<{
  title: string;
  body: ReactNode;
  tree: ReactNode[];
  treeLabel: string;
  yields: Array<{ provenance: 'extracted' | 'declared'; what: string; how: ReactNode }>;
}> = [
  {
    title: 'contracts/',
    body: 'Schema files in JSON Schema, OpenAPI, Avro or protobuf, read where they are. Events defined in Zod or Pydantic are scanned into events/ alongside them.',
    treeLabel: 'Example contracts folder',
    tree: [
      'acme/payments-service\n└─ ',
      <b key="d">contracts/</b>,
      '\n   ├─ payment-completed.json\n   ├─ payment-refunded.json\n   └─ payments.openapi.yaml',
    ],
    yields: [
      {
        provenance: 'extracted',
        what: 'Events, fields, examples, APIs',
        how: 'from the schema itself',
      },
      {
        provenance: 'declared',
        what: 'Producers and consumers',
        how: (
          <>
            in {c('defineEvent()')} or {c('x-autocatalog')}
          </>
        ),
      },
    ],
  },
  {
    title: 'docs/',
    body: (
      <>
        Markdown your team already commits. The folder sets the kind: {c('adr/')}, {c('runbooks/')}{' '}
        and {c('incidents/')} become decisions, runbooks and incidents.
      </>
    ),
    treeLabel: 'Example docs folder',
    tree: [
      'acme/payments-service\n└─ ',
      <b key="d">docs/</b>,
      '\n   ├─ settlement.md\n   ├─ ',
      <b key="a">adr/</b>,
      '0003-kafka-for-payment-events.md\n   └─ ',
      <b key="r">runbooks/</b>,
      'replay-payment-events.md',
    ],
    yields: [
      {
        provenance: 'declared',
        what: 'Owner, status, what it is about',
        how: (
          <>
            in {c('owner:')}, {c('status:')}, {c('about:')}
          </>
        ),
      },
      {
        provenance: 'extracted',
        what: 'Kind and freshness',
        how: 'from the folder and from git',
      },
    ],
  },
  {
    title: 'CODEOWNERS',
    body: (
      <>
        Ownership comes from the file that already gates your reviews, and from{' '}
        {c('catalog-info.yaml')} if you use Backstage.
      </>
    ),
    treeLabel: 'Example CODEOWNERS file',
    tree: [
      '.github/',
      <b key="c">CODEOWNERS</b>,
      '\n/contracts/  @acme/billing\n/docs/       @acme/billing\n/src/models/ @acme/billing',
    ],
    yields: [
      { provenance: 'extracted', what: 'Owners and contacts', how: 'from CODEOWNERS' },
      {
        provenance: 'extracted',
        what: 'Who reads which tables',
        how: 'from Mongoose, Prisma and Drizzle models',
      },
    ],
  },
];

const failures = [
  'Removed and renamed fields',
  'Type changes',
  'Fields that become required',
  'Narrowed enums',
  'Changed delivery guarantees',
];

/** Where a team's contracts already live, and the guide for each. */
const starts: Array<{ mark: string; title: string; detail: ReactNode; slug: string }> = [
  {
    mark: 'TS',
    title: 'TypeScript, with Zod',
    detail: <>{c('defineEvent()')} from autocatalog-adapter-zod</>,
    slug: 'docs/events/zod',
  },
  {
    mark: 'Py',
    title: 'Python, with Pydantic',
    detail: c('autocatalog-py extract'),
    slug: 'docs/events/pydantic',
  },
  {
    mark: '{}',
    title: 'JSON Schema files',
    detail: <>{c('autocatalog scan .')} reads them where they are</>,
    slug: 'docs/events/json-schema',
  },
  {
    mark: 'OA',
    title: 'OpenAPI specs',
    detail: <>an API reference for each spec under {c('contracts/')}</>,
    slug: 'docs/events/openapi',
  },
  {
    mark: 'AA',
    title: 'AsyncAPI 2.x or 3.x',
    detail: c('autocatalog from-asyncapi spec.yaml'),
    slug: 'docs/events/importing',
  },
  {
    mark: 'Av',
    title: 'Avro and protobuf',
    detail: (
      <>
        {c('.avsc')} and {c('.proto')} files under {c('contracts/')}
      </>
    ),
    slug: 'docs/events/avro-protobuf',
  },
  {
    mark: 'EC',
    title: 'An EventCatalog project',
    detail: c('autocatalog from-eventcatalog ./catalog'),
    slug: 'docs/events/importing',
  },
  {
    mark: 'DB',
    title: 'Mongoose, Prisma and Drizzle models',
    detail: "which team's service reads which team's tables",
    slug: 'docs/brownfield-resources',
  },
];

const commands = [
  { label: 'Build the company site', command: 'npx autocatalog site --topic catalog --owner acme' },
  { label: 'Preview one repository', command: 'npx autocatalog site . --dev' },
];

const wrap = 'mx-auto w-full max-w-7xl';

const heading =
  'm-0 text-2xl leading-tight font-extrabold tracking-tighter text-balance lg:text-3xl';

const band = 'pt-18 lg:pt-28';

const intro = 'mb-12 grid items-start gap-x-12 gap-y-6 lg:grid-cols-2';

const lead = 'm-0 max-w-prose text-muted-foreground lg:mt-1.5';

const textLink =
  'font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const panel = 'm-0 overflow-hidden rounded-xl border bg-card';

const chrome = 'flex items-center gap-3 border-b bg-muted px-3.5 py-2.5';

const said = { extracted: 'Extracted', declared: 'Declared' } as const;

/** The opening statement, above the map. */
export function HomeHero({ base }: HomeProps) {
  const href = (slug: string) => `${base}/${slug}`;

  return (
    <div className={cn(wrap, 'grid items-end gap-x-12 gap-y-8 lg:grid-cols-2')}>
      <h2 className="m-0 text-4xl leading-none font-extrabold tracking-tighter text-balance lg:text-5xl">
        All your docs, events and services{' '}
        <span className="block font-light text-muted-foreground">
          in one place, from every repository.
        </span>
      </h2>
      <div className="flex flex-col gap-6">
        <p className="m-0 max-w-prose text-muted-foreground">
          autocatalog builds one site for every team's{' '}
          <strong className="font-semibold text-foreground">
            docs, decisions, runbooks, incidents, events, services, APIs and data models
          </strong>
          , each with its owner. It reads the code and Markdown your teams already commit, so the
          site stays current without anyone keeping it up to date.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton href={href('docs/quick-start')} size="lg">
            Quick start
            <Icon name="arrow" />
          </LinkButton>
          <LinkButton href="#site" variant="outline" size="lg">
            What lands on the site
          </LinkButton>
        </div>
      </div>
    </div>
  );
}

/** The example service page, drawn in a browser window. */
function ServicePage() {
  return (
    <figure
      className={cn(panel, 'shadow-xl lg:sticky lg:top-24')}
      aria-label="An example generated service page"
    >
      <div className={chrome}>
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="size-2.5 rounded-full border bg-background" />
          <i className="size-2.5 rounded-full border bg-background" />
          <i className="size-2.5 rounded-full border bg-background" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-full border bg-card px-3 py-0.5 text-xs text-muted-foreground">
          catalog.acme.dev/services/PaymentService/
        </span>
      </div>
      <div className="grid sm:grid-cols-4">
        <div
          className="hidden flex-col gap-0.5 border-r px-2.5 py-4 text-xs text-muted-foreground sm:flex"
          aria-hidden="true"
        >
          <span className="px-2 font-bold text-foreground">Catalog</span>
          {['Docs', 'Decisions', 'Runbooks', 'Incidents', 'Events', 'Services'].map((n) => (
            <span className="truncate px-2 py-0.5" key={n}>
              {n}
            </span>
          ))}
          <span className="truncate rounded-md bg-muted px-2 py-0.5 text-foreground ring-1 ring-border">
            PaymentService
          </span>
          {['Domains', 'APIs', 'Data', 'Owners'].map((n) => (
            <span className="truncate px-2 py-0.5" key={n}>
              {n}
            </span>
          ))}
          <span className="mt-2.5 px-2 font-bold text-foreground">Repositories</span>
          {['payments-service', 'ledger', 'notifications', 'reporter'].map((n) => (
            <span className="truncate px-2 py-0.5" key={n}>
              {n}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5 p-4 sm:col-span-3 sm:p-5">
          <div>
            <div className="text-xs text-muted-foreground">Services / payments</div>
            <p className="m-0 mt-0.5 mb-1.5 text-xl font-extrabold tracking-tighter">
              PaymentService
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Owner <b className="font-semibold text-foreground">Billing</b>
              </span>
              <span>acme/payments-service</span>
            </div>
          </div>
          <div className="border-0 border-l-2 border-extracted pl-2.5 text-xs text-muted-foreground italic">
            <b className="font-semibold text-extracted">Built</b> from the events that name it and
            the documents whose {c('about:')} lists it. Nobody wrote this page.
          </div>
          <div className="grid gap-3.5 md:grid-cols-2">
            {[pageBlocks.slice(0, 3), pageBlocks.slice(3)].map((column) => (
              <div className="flex flex-col gap-3" key={column[0]!.title}>
                {column.map((block) => (
                  <div className="overflow-hidden rounded-lg border" key={block.title}>
                    <div className="flex justify-between gap-2 border-b bg-muted px-3 py-1.5 text-xs font-bold">
                      {block.title}
                      <span className="font-normal text-muted-foreground">{block.count}</span>
                    </div>
                    {block.rows.map((row) => (
                      <div
                        className="flex items-start gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
                        key={row.name}
                      >
                        <Icon name={row.icon} className="mt-0.5 size-3.5 flex-none" />
                        <span className="min-w-0 flex-1 font-semibold wrap-break-word">
                          {row.name}
                          <small className="block text-xs font-normal text-muted-foreground">
                            {row.note}
                          </small>
                        </span>
                        {row.badge && <Badge variant="outline">{row.badge}</Badge>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Everything below the map. Static: the only script is the copy buttons. */
export function HomeSections({ base }: HomeProps) {
  const href = (slug: string) => `${base}/${slug}`;

  return (
    <>
      <section className={band} id="site" aria-labelledby="site-h">
        <div className={cn(wrap, 'grid items-start gap-12 lg:grid-cols-12')}>
          <div className="lg:col-span-5">
            <h2 id="site-h" className={cn(heading, 'mb-4')}>
              Everything a team commits, in one place
            </h2>
            <p className="m-0 mb-6 max-w-prose text-muted-foreground">
              Each repository keeps its own docs and contracts. The site reads all of them and links
              them, so a service page shows its events, its API, its decisions and its runbooks
              together, whichever repository each one lives in.
            </p>
            <ul className="m-0 mb-6 list-none border-t border-foreground p-0">
              {lands.map((land) => (
                <li
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b py-3"
                  key={land.title}
                >
                  <b className="font-bold tracking-tight">{land.title}</b>
                  <span className="text-xs text-muted-foreground">{land.from}</span>
                  <span className="w-full text-sm text-muted-foreground">{land.what}</span>
                </li>
              ))}
            </ul>
            <a className={textLink} href={href('docs/site#what-each-page-shows')}>
              What each page shows
            </a>
          </div>
          <div className="lg:col-span-7">
            <ServicePage />
          </div>
        </div>
      </section>

      <section className={band} id="how" aria-labelledby="how-h">
        <div className={wrap}>
          <div className={intro}>
            <h2 id="how-h" className={heading}>
              How it gets the map
            </h2>
            <p className={lead}>
              It reads conventions your teams probably follow already. No config file, and nothing
              written back to the repository. A team joins by adding the {c('catalog')} topic to its
              GitHub repository, and the next build picks it up.
            </p>
          </div>
          <ol className="relative m-0 grid list-none gap-12 p-0 lg:grid-cols-3 lg:gap-0">
            <span
              className="absolute top-3 bottom-3 left-3 w-px bg-border lg:right-3 lg:bottom-auto lg:h-px lg:w-auto"
              aria-hidden="true"
            />
            {steps.map((step, i) => (
              <li className="relative min-w-0 pl-11 lg:pr-8 lg:pl-0" key={step.title}>
                <span
                  className="absolute top-0 left-0 grid size-6 place-items-center rounded-full border border-foreground bg-background text-xs font-bold lg:relative"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <h3 className="m-0 mb-2 text-xl font-bold tracking-tighter lg:mt-6">
                  {step.title}
                </h3>
                <p className="m-0 mb-4 max-w-prose text-sm text-muted-foreground">{step.body}</p>
                <pre
                  className="m-0 mb-4 overflow-x-auto rounded-lg border bg-muted px-3.5 py-3 text-xs leading-relaxed text-muted-foreground"
                  aria-label={step.treeLabel}
                >
                  {step.tree}
                </pre>
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {step.yields.map((y) => (
                    <li
                      className={cn(
                        'border-0 border-l-2 pl-2.5 text-sm leading-snug font-semibold',
                        rule[y.provenance],
                      )}
                      key={y.what}
                    >
                      {y.what}
                      <span className="block text-xs font-normal text-muted-foreground italic">
                        <b className={cn('font-semibold', tone[y.provenance])}>
                          {said[y.provenance]}
                        </b>{' '}
                        {y.how}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-12 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-4 border-t pt-4 text-sm text-muted-foreground">
            <span className="max-w-prose">
              Your company decides the kinds. {c('contracts/autocatalog.conventions.json')} renames
              a folder, turns a kind off or adds one, such as RFCs, with its own fields and index
              page.
            </span>
            <a className={textLink} href={href('docs/docs-convention')}>
              The docs convention
            </a>
          </p>
        </div>
      </section>

      <section className={band} id="contracts" aria-labelledby="contracts-h">
        <div className={wrap}>
          <div className={intro}>
            <h2 id="contracts-h" className={heading}>
              Contracts are the spine
            </h2>
            <p className={lead}>
              Events are what connect one team's service to another's, and each event's schema is
              the contract they build against. {c('autocatalog drift')} compares the contracts on{' '}
              {c('main')} with those on your branch and names every consumer a change would break,
              including teams in other repositories that declared what they read.
            </p>
          </div>
          <div className="grid items-start gap-12 lg:grid-cols-3">
            <figure
              className={cn(panel, 'lg:col-span-2')}
              aria-label="An example failing drift check"
            >
              <div
                className={cn(
                  chrome,
                  'justify-between text-xs whitespace-nowrap text-muted-foreground',
                )}
              >
                <span className="truncate">
                  <b className="font-semibold text-foreground">pull request #482</b> autocatalog
                  drift
                </span>
                <span className="font-bold text-destructive">check failed</span>
              </div>
              <pre
                tabIndex={0}
                className="m-0 overflow-x-auto rounded-none border-0 bg-transparent px-4.5 py-4 text-xs leading-relaxed text-foreground"
              >
                <span className="font-bold text-destructive">breaking</span>
                {
                  '   payments/payment.completed: field `amount` (number) looks renamed to `amountMinor`\n           '
                }
                <b>→ breaks LedgerService, NotificationService.</b>
                {'\n           '}
                <span className="text-muted-foreground">
                  {
                    'Next: keep `amount` alongside `amountMinor` until consumers move off it,\n           or bump to 2.0.0 to mark it intentional and notify LedgerService, NotificationService'
                  }
                </span>
                {'\n'}
                <span className="font-bold text-inferred">suspicious</span>
                {
                  ' payments/payment.completed: schema changed but version stayed at 1.0.0\n\n1 breaking · 1 suspicious · 0 additive'
                }
              </pre>
              <pre
                tabIndex={0}
                className="m-0 overflow-x-auto rounded-none border-0 border-t bg-muted px-4.5 py-4 text-xs leading-relaxed text-muted-foreground"
              >
                <span className="italic"># .github/workflows/ci.yml</span>
                {
                  '\n- run: git fetch origin main\n- run: npx autocatalog drift --base-ref origin/main --root . --format github'
                }
              </pre>
            </figure>
            <div>
              <h3 className="m-0 mb-3 text-lg font-bold tracking-tight">What fails the check</h3>
              <ul className="m-0 mb-6 list-none border-t p-0">
                {failures.map((f) => (
                  <li className="flex gap-3 border-b py-2 text-sm" key={f}>
                    <span className="font-bold text-muted-foreground" aria-hidden="true">
                      ×
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mb-6 text-sm text-muted-foreground">
                The same run guards team boundaries. A pull request that has one team's service read
                another team's data fails too:
                <pre className="m-0 mt-2 rounded-lg border bg-muted px-3 py-2.5 text-xs whitespace-pre-wrap text-foreground">
                  checkout (payments) reads collection acme/finance/statements, which ledger owns
                </pre>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <button
                  type="button"
                  className={buttonVariants({ variant: 'outline', size: 'lg' })}
                  data-preview-pr
                >
                  Preview it on the map
                  <Icon name="arrow" className="-rotate-90" />
                </button>
                <a className={textLink} href={href('docs/drift-ci')}>
                  Every rule and its severity
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={band} id="start" aria-labelledby="start-h">
        <div className={wrap}>
          <div className={intro}>
            <h2 id="start-h" className={heading}>
              Start where your contracts are
            </h2>
            <p className={lead}>
              Teams with schema files change nothing in their code. Teams with Zod or Pydantic add
              one wrapper, and the schema it returns is unchanged.
            </p>
          </div>
          <ul className="m-0 grid list-none gap-x-12 border-t border-foreground p-0 lg:grid-cols-2">
            {starts.map((start) => (
              <li className="border-b py-1" key={start.title}>
                <Item href={href(start.slug)}>
                  <ItemMedia>
                    <span
                      className="grid size-11 place-items-center rounded-lg border bg-card text-sm font-extrabold tracking-tighter"
                      aria-hidden="true"
                    >
                      {start.mark}
                    </span>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{start.title}</ItemTitle>
                    <ItemDescription>{start.detail}</ItemDescription>
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
          <p className="m-0 mt-6 max-w-prose text-sm text-muted-foreground">
            Already using EventCatalog?{' '}
            <a className={textLink} href={href('docs/comparison')}>
              How the two tools relate
            </a>
            , and how to run them together.
          </p>
        </div>
      </section>

      <section
        data-bleed
        data-blueprint
        className="mt-20 border-y bg-background px-4 lg:mt-36"
        aria-labelledby="close-h"
      >
        <div
          className={cn(wrap, 'grid items-center gap-x-12 gap-y-8 py-14 lg:grid-cols-2 lg:py-24')}
        >
          <div>
            <h2 id="close-h" className={cn(heading, 'lg:text-4xl')}>
              Build the site from the repositories you already have.
            </h2>
            <p className="m-0 mt-4 mb-6 max-w-prose text-muted-foreground">
              Add the {c('catalog')} topic to each repository you want on it, then build. With
              schemas in {c('contracts/')} and Markdown in {c('docs/')}, no repository needs a
              config file. MIT licensed.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <LinkButton href={href('docs/quick-start')} size="lg">
                Quick start
                <Icon name="arrow" />
              </LinkButton>
              <LinkButton href={href('docs/drift-ci')} variant="outline" size="lg">
                Drift gating in CI
              </LinkButton>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border bg-card">
            {commands.map(({ label, command }) => (
              <div
                className="flex items-center gap-2 border-b py-3.5 pr-2.5 pl-4 last:border-b-0"
                key={command}
              >
                <div className="min-w-0 flex-1">
                  <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
                  <code className="block overflow-x-auto pb-0.5 text-sm max-sm:whitespace-normal sm:whitespace-nowrap">
                    <span className="text-muted-foreground" aria-hidden="true">
                      ${' '}
                    </span>
                    {command}
                  </code>
                </div>
                <button
                  type="button"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  data-copy={command}
                  aria-label={`Copy: ${command}`}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
