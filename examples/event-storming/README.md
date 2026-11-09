# event-storming

A process stormed from its code. `src/import.ts` is a catalogue import written
in Effect v4. `ac flows draft` read it with effect-analyzer and drafted
`flows/catalogue-import.md`; the team then named each fact, added the policies
it agreed, and wrote a finding for each question nobody had decided.
`flows/ingest-product.md` is the loop inside it, which the board zooms into.

```bash
pnpm draft            # the draft, straight from the code
pnpm check            # warns about each failure nothing handles
pnpm build            # the site, with the board on each flow's page
```

Open `/flows/event-storming/catalogue-import/` for the board, its hotspots, how a
run can end and the scenarios to test; `/flows/` for the big picture; and
`/event-storming/storming/` for boards in an MDX page.

Its Playwright stories drive the built site:

```bash
pnpm --filter @autocatalog-example/event-storming test:e2e
```
