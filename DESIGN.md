# DESIGN.md: autocatalog

## 1. Visual theme and atmosphere

autocatalog is compiled from code, not written by hand, and every fact in it
says where it came from. The site should read like an annotated reference: a
claim, and beside it, its source. Calm, exact, unhurried. It has a tool's
chrome, a rail and a search-led header, and still reads as a reference: not a
hand-maintained portal, and not a copy of EventCatalog.

The one idea a reader should take away: **you can see how sure the catalog is.**

## 2. Colour

The neutrals are pure greys with no hue, so the only colour on a page is
provenance. Light mode is near-white paper and black ink; dark mode is
near-black rather than black, which is easier on the eye over a long page.
Primary is the ink colour, so buttons and links are ink and nothing competes
with provenance. Colour is spent on one thing only: provenance. The focus ring
is the `extracted` teal.

| Token         | Light                   | Dark                   | Means                                               |
| ------------- | ----------------------- | ---------------------- | --------------------------------------------------- |
| `background`  | `oklch(0.99 0 0)`       | `oklch(0.145 0 0)`     | Paper                                               |
| `foreground`  | `oklch(0 0 0)`          | `oklch(0.985 0 0)`     | Ink: text, and the primary button                   |
| `card`        | `oklch(1 0 0)`          | `oklch(0.185 0 0)`     | Surfaces that sit on the paper                      |
| `border`      | `oklch(0.92 0 0)`       | `oklch(0.27 0 0)`      | Rules                                               |
| `extracted`   | `oklch(0.51 0.095 185)` | `oklch(0.79 0.11 185)` | Read out of code. The thing the tool exists to do.  |
| `declared`    | `oklch(0.5 0.16 264)`   | `oklch(0.77 0.12 264)` | A person wrote it down (frontmatter, `defineEvent`) |
| `inferred`    | `oklch(0.55 0.12 62)`   | `oklch(0.81 0.12 72)`  | A guess the catalog wants a person to confirm       |
| `destructive` | `oklch(0.53 0.19 27)`   | `oklch(0.73 0.16 25)`  | A break: a failing check, a consumer it breaks      |

Every text colour meets WCAG 2.1 AA (4.5:1) on the background in its theme;
the measured ratios sit beside the tokens in `src/ui/styles/tailwind.css`.

Resource kinds (event, service, document, agent…) have **no colour**. The kind
is in the key (`event:payments/payment.captured`) and in the icon.

The one exception is an EventStorming board. Its stickies keep the method's
colours (orange facts, blue commands, lilac policies, red hotspots), because a
reader who knows the method reads a board by them at a glance. They are paper
colours with dark ink in both themes (`--ac-storm-*` in `theme.css`), and every
sticky also names its kind in words, so the board reads without colour.

## 3. Components

- **shadcn/ui, stock.** React Aria base, stock variants only; `@shadcn/lint`
  enforces it in `src/ui`. No look-alikes, no custom variants.
- **The evidence rule** is the signature element: a 2px rule on the leading edge
  of a fact, coloured by provenance. Extracted and declared are solid; inferred
  is **dashed**, so certainty reads without colour.
- **Cards** are for objects a reader works inside (the schema). Sections are
  headed regions, not a stack of cards.
- **Counts** of what a page lists are said in a sentence ("Consumed by
  LedgerService and EmailService"). The home page opens with six count cards
  (`CountCards`), services, events, domains and documents first, each leading
  to that kind's list; a site picks its own with `homeCounts`. The row is two,
  three or six across by the room it has, so six always fill whole rows, and a
  count past six digits reads 1.3M with the exact number on hover.
- **Callouts** are shadcn's Alert (`Aside`): a hairline all round, colour on
  the icon and title only. Never a rounded tinted box with a thick stripe down
  one side.
- **Badges** only for states (deprecated, needs review, current version), never
  for a resource's kind.

## 4. Typography

- **Inter for the interface and prose**, self-hosted from
  `@fontsource-variable/inter`, so a page makes no request to a font CDN. A
  proportional face reads faster and keeps titles and sidebar entries on one
  line.
- **JetBrains Mono for what is literally code**: code blocks, inline code, keys
  (`event:payments/payment.captured`), ids and paths, from
  `@fontsource-variable/jetbrains-mono`. That the catalog is compiled from code
  shows where the code is.
- Body text is 15px with a line height of 1.6 (1.65 in dark mode, where light
  text on a dark page needs more air). Prose keeps a measure of about 64ch.
- Headings are semibold to bold (650 to 700) with slight negative tracking
  (-0.02em to -0.025em).
- Code keeps its ligatures and a slashed zero.
- Sentence case everywhere. No all-caps labels, no eyebrow text above headings.

## 5. Layout

- **Rail and sidebar.** The rail on the left is 3rem wide and holds the site's
  sections (its `nav`, or Home, Catalog and Docs): a 16px icon each in a square
  button, named in a tooltip, the current one in the soft highlight. Beside
  it, Starlight's own navigation, styled as shadcn's sidebar, is headed with
  the section's name and holds that section's groups, each level with its own
  look: a top-level group is a small spaced uppercase label, a heading rather
  than a row; a folder is a row with a folder icon and a chevron; a page is a
  muted row with its kind's icon (page, service, event, domain, API); the
  current page is in the soft highlight. A first group named like the section
  gives up its label, so the name is not said twice. The build picks the groups, so nothing moves once the page draws.
  The rail stays when the sidebar collapses, and "On this page" stays on the
  right. A page with no sidebar has its sections beside the title.
- **Moving between pages.** The header and rail hold still and the content
  fades across in 160ms. Within a section the sidebar swaps at once, so only
  the highlight moves; into another section it slides across, as a menu does
  when it opens a level. Reduced motion turns all of it off.
- The header is the title on the left, search in the middle, and the theme and
  social links on the right. Each control appears once: search in the header,
  the assistant in its own launcher, sections in the rail.
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

### The product site home

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
example data and is labelled as such. The splash page is full-bleed without
the rail; below-fold sections and the in-page catalog mock share the product
chrome language.

Below the map, in order: what lands on the site, with an example service
page; how the site reads `contracts/`, `docs/` and CODEOWNERS; contracts as
the spine, with a failing drift check; where to start, by schema language;
and a closing band with the two commands. Only the map runs in the browser;
the rest is static.

### The catalog home

A generated catalog opens with `CountCards` (what it holds) and an Architecture
canvas (the catalog map), then documents and attention. Architecture is the
primary surface after the counts, not a link buried in explore cards.

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

The reference for care is EventCatalog's craft: its hierarchy, spacing,
prominent search and calm navigation. Its green accent and kind-coloured chrome
stay out. Every story in Storybook, in both themes, meets these.

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
