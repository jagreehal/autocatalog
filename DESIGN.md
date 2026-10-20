# DESIGN.md: autocatalog

## 1. Visual theme and atmosphere

autocatalog is compiled from code, not written by hand, and every fact in it
says where it came from. The site should read like an annotated reference: a
claim, and beside it, its source. Calm, exact, unhurried. It is not a product
dashboard and not a copy of EventCatalog; nothing here should look like a
hand-maintained portal.

The one idea a reader should take away: **you can see how sure the catalog is.**

## 2. Colour

The neutrals are blueprint-tinted: paper, ink and rules share one cool hue, so
light mode reads like a crisp drawing and dark mode like deep slate rather
than black. Primary is the ink colour, so buttons and links are ink and
nothing competes with provenance. Colour is spent on one thing only:
provenance. The focus ring is the `extracted` teal.

| Token         | Light                    | Dark                     | Means                                               |
| ------------- | ------------------------ | ------------------------ | --------------------------------------------------- |
| `background`  | `oklch(0.982 0.005 225)` | `oklch(0.205 0.032 250)` | Paper                                               |
| `foreground`  | `oklch(0.235 0.028 248)` | `oklch(0.945 0.012 230)` | Ink: text, and the primary button                   |
| `card`        | `oklch(0.996 0.003 225)` | `oklch(0.235 0.034 250)` | Surfaces that sit on the paper                      |
| `border`      | `oklch(0.875 0.013 240)` | `oklch(0.34 0.032 248)`  | Rules                                               |
| `extracted`   | `oklch(0.51 0.095 185)`  | `oklch(0.79 0.11 185)`   | Read out of code. The thing the tool exists to do.  |
| `declared`    | `oklch(0.5 0.16 264)`    | `oklch(0.77 0.12 264)`   | A person wrote it down (frontmatter, `defineEvent`) |
| `inferred`    | `oklch(0.55 0.12 62)`    | `oklch(0.81 0.12 72)`    | A guess the catalog wants a person to confirm       |
| `destructive` | `oklch(0.53 0.19 27)`    | `oklch(0.73 0.16 25)`    | A break: a failing check, a consumer it breaks      |

Every text colour meets WCAG 2.1 AA (4.5:1) on the background in its theme;
the measured ratios sit beside the tokens in `src/ui/styles/tailwind.css`.

Resource kinds (event, service, document, agent…) have **no colour**. The kind
is in the key (`event:payments/payment.captured`) and in the icon.

## 3. Components

- **shadcn/ui, stock.** React Aria base, stock variants only; `@shadcn/lint`
  enforces it in `src/ui`. No look-alikes, no custom variants.
- **The evidence rule** is the signature element: a 2px rule on the leading edge
  of a fact, coloured by provenance. Extracted and declared are solid; inferred
  is **dashed**, so certainty reads without colour.
- **Cards** are for objects a reader works inside (the schema). Sections are
  headed regions, not a stack of cards.
- **Counts** are said in a sentence ("Consumed by LedgerService and
  EmailService"), not shown as stat tiles.
- **Badges** only for states (deprecated, needs review, current version), never
  for a resource's kind.

## 4. Typography

- **JetBrains Mono for everything**: headings, interface, prose and code,
  self-hosted from `@fontsource-variable/jetbrains-mono`, so a page makes no
  request to a font CDN. The catalog is compiled from code, and setting it in
  one monospace face says so; weight and size do the hierarchy instead of a
  second family.
- Body text is 15px with a line height of 1.7 (1.76 in dark mode, where light
  text on a dark page needs more air). Prose keeps a measure of about 64ch.
- Headings are heavy (750 to 800) with tight tracking (-0.04em to -0.05em).
- Ligatures are off in prose, so `->` and `!=` read as typed, and on in code,
  with a slashed zero.
- Sentence case everywhere. No all-caps labels, no eyebrow text above headings.

## 5. Layout

- Starlight's own navigation and "On this page"; no icon rail, no per-resource
  sidebar.
- A resource page opens with: title, key (mono), summary, then the evidence rule
  saying where the definition was read and how sure the catalog is.
- Wide pages use a two-column grid on large screens: the contract on the left
  (schema), what was observed on the right (runtime evidence, examples).
- Spacing in multiples of 4px (Tailwind's scale).
- The shadcn preset is `b5claD7KK` (Vega, default radius, Lucide, Teal charts):
  https://ui.shadcn.com/create?preset=b5claD7KK. Its colours and font are
  replaced by the palette in section 2 and the type in section 4.
  Vega, not Lyra: 24px card padding, `text-sm` body and rounded cards carry the
  weight a reference site needs; Lyra's `text-xs`, square cards read unfinished.
  Change the look by applying another preset with the shadcn CLI, then fold its
  dark values into `[data-theme='dark']` in `src/ui/styles/tailwind.css`.

### The home page

The project's own site opens on a living map: an example company's
repositories drawn as regions on a blueprint grid, with their services, events,
documents, API and data model as nodes. Each kind has its own outline (a box,
a pill, a folded page, chamfered corners, a table), so kinds read without
colour; edges carry provenance, dashed where inferred. Selecting a node, by
pointer or by keyboard, shows its fact sheet beside the map: every fact with
the evidence rule and where it came from. "Preview a pull request" turns on
the drift check's view of a change that renames a field: the breaking edges
animate (and hold still under reduced motion), the consumers it breaks are
flagged, and the fact sheet shows the diff. On a phone the map scrolls sideways inside its
frame and the fact sheet sits below it. Every name and number on the map is
example data and is labelled as such.

Below the map, in order: what lands on the site, with an example service
page; how the site reads `contracts/`, `docs/` and CODEOWNERS; contracts as
the spine, with a failing drift check; where to start, by schema language;
and a closing band with the two commands. Only the map runs in the browser;
the rest is static.

### The catalog map

The map is EventCatalog's visualiser. Its node backgrounds follow the theme, but
it draws each kind's border and tag in its own colours, which this design does
not control.

## 6. Do and don't

- ✅ Put the source (path and line) next to every claim that has one.
- ✅ Make uncertainty visible: inferred is dashed, and says so in words too.
- ✅ Link every name that has a page.
- ❌ Don't colour by resource kind.
- ❌ Don't use stat tiles, eyebrow labels, all-caps labels or middot-joined meta.
- ❌ Don't style a shadcn component's colour or type with `className`.

## 7. Polish: the bar every component meets

The reference for care is EventCatalog's own front page: not its
chrome, its craft. Every story in Storybook, in both themes, meets these.

- **Hierarchy in three steps, no more.** A block has a title (CardTitle or a
  heading), body text (`text-sm`, foreground) and secondary text (`text-xs` or
  `text-sm`, `muted-foreground`). Nothing below `text-xs`; nothing decorative.
- **One rhythm.** Rows in a list: `gap-2`/`gap-3`. Blocks inside a section:
  `gap-4`. Sections on a page: `gap-8` to `gap-10`. Card padding is the
  card's own. No element floats in an oversized box.
- **One icon treatment.** A row that has an icon shows it as
  `ItemMedia variant="icon"` (the tile), the same everywhere: lists, flows,
  sidebars, empty states.
- **A row that goes somewhere is the link**, the whole row, with a hover state
  and, for navigation to another page, the corner arrow (`ArrowUpRight`,
  muted, foreground on hover). A link inside running text is underlined.
- **Say a kind once.** A row's kind is its icon (and its key where shown),
  never an extra badge beside a name that the icon already says.
- **A section heading carries its count** on the right, muted: "Consumers"
  … "2 services".
- **Empty is an instruction.** `Empty` with an icon, a title saying what is
  missing, and a description saying how to add it ("Declare a producer in the
  event's `producers` frontmatter"). Never a bare "None".
- **Aligned to a left edge.** Text is left-aligned; centring is for `Empty`
  only. Columns line up across rows.
- **Accessible in both themes.** axe-core (WCAG 2.1 AA) reports nothing on any
  story in light or dark; every interactive element has a visible focus ring;
  colour is never the only signal.
