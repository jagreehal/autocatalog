# DESIGN.md: autocatalog

## 1. Visual theme and atmosphere

autocatalog is compiled from code, not written by hand, and every fact in it
says where it came from. The site should read like an annotated reference: a
claim, and beside it, its source. Calm, exact, unhurried. It is not a product
dashboard and not a copy of EventCatalog; nothing here should look like a
hand-maintained portal.

The one idea a reader should take away: **you can see how sure the catalog is.**

## 2. Colour

The base is the shadcn/ui preset (section 5): Mist greys, and Teal as the
primary, which is also the colour of `extracted`: what the tool exists to
produce is its accent. Beyond that, colour is spent on one thing only:
provenance.

| Token        | Light     | Dark      | Means                                               |
| ------------ | --------- | --------- | --------------------------------------------------- |
| `extracted`  | `#0B7A71` | `#4CC9BD` | Read out of code. The thing the tool exists to do.  |
| `declared`   | `#2F5BD3` | `#8AA8FF` | A person wrote it down (frontmatter, `defineEvent`) |
| `inferred`   | `#A8620B` | `#E0A95C` | A guess the catalog wants a person to confirm       |
| `foreground` | preset    | preset    | Text                                                |
| `border`     | preset    | preset    | Rules                                               |

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

- **IBM Plex Sans** for prose and interface (from the preset). Titles semibold,
  tight tracking. Rounded corners from the preset's radius.
- **JetBrains Mono** only for text that is literally code: catalog keys, paths,
  field names, payloads. Never for labels or decoration.
- Sentence case everywhere. No all-caps labels, no eyebrow text above headings.

## 5. Layout

- Starlight's own navigation and "On this page"; no icon rail, no per-resource
  sidebar.
- A resource page opens with: title, key (mono), summary, then the evidence rule
  saying where the definition was read and how sure the catalog is.
- Wide pages use a two-column grid on large screens: the contract on the left
  (schema), what was observed on the right (runtime evidence, examples).
- Spacing in multiples of 4px (Tailwind's scale).
- The shadcn preset is `b5claD7KK` (Vega, Mist base, Teal theme and charts, IBM
  Plex Sans, default radius, Lucide): https://ui.shadcn.com/create?preset=b5claD7KK.
  Vega, not Lyra: 24px card padding, `text-sm` body and rounded cards carry the
  weight a reference site needs; Lyra's `text-xs`, square cards read unfinished.
  Change the look by applying another preset with the shadcn CLI, then fold its
  dark values into `[data-theme='dark']` in `src/ui/styles/tailwind.css`.

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

The reference for care is EventCatalog's own front page (cbd-catalog): not its
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
