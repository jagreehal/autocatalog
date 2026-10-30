---
name: autocatalog-docs
description: Write or update documentation from source, in the repository that owns the code, against the company's committed frontmatter contract. Use when the user asks to document a service, write a runbook, record how something works, fix a failing `ac docs check`, or when a change to code leaves its documentation wrong.
---

# /autocatalog-docs

Documentation lives in the repository it describes, under `docs/`, and is reviewed in the pull request that changes the behaviour. The company index is built from those files — nothing is authored in the index.

Your job is to write what the code actually does, in a file that satisfies a contract this organisation owns.

## 1. Read the contract before writing a single line of frontmatter

The frontmatter rules are **not** in this skill. They are a committed JSON Schema, and every organisation's is different.

```bash
ac docs check
```

Its last line names the contract in force:

- `contract: contracts/docs-frontmatter.json` — read that file. Its `required` array is what you must write; its `properties` is what you may write. Where a property has an `enum`, use one of those values exactly and never invent a new one.
- `contract: built-in default` — only `title` and `owner` are required. Mention to the user that `ac docs init-schema` writes a contract they own, but do not run it unprompted: the contract is a company-wide decision, not a side effect of writing one document.

If `additionalProperties` is `false`, a field the contract does not declare will fail the check. Ask before proposing a contract change.

## 2. Put the file in the repository that owns the code

`<owning-repo>/docs/<path>.md`. The id readers and links use is derived from that path — `payments-service/docs/ops/replay.md` is `payments-service/ops/replay` — so the path is the URL and the permanent name. Choose it once, deliberately.

In a monorepo the owning folder is the package: `services/orders/docs/runbook.md` publishes as `orders/runbook`.

Never write documentation into the aggregating site's repository. A document there has no owning team and no code to stay true to.

## 3. Write from the source, not from the summary

Read the code, the tests, the ADRs, and any incident notes before writing. Prefer what you can verify:

- The actual failure modes in the error paths, not the ones a reader would assume.
- The real commands, with the real flags, from the scripts or CLI that define them.
- The ordering constraints that make an operation safe, and what happens when they are violated.

State what you could not verify as unknown. A confident sentence nobody checked is the thing that gets read at 02:40 and believed.

Structure a runbook as symptom → check → action. Put the check that most often ends the investigation first.

Draw a flow or sequence as a ` ```mermaid ` fence. The site renders it as a diagram, and the Markdown twin keeps the source for agents.

### Decisions, runbooks and incidents

These are kinds of document, and the folder sets the kind. `ac docs check` prints `kinds:` beside the contract: the conventions file in force, or the built-in kinds. Read the file when there is one, because the organisation may have renamed a folder, changed a schema or added a kind of its own; its `schema` lists the fields each kind requires.

With the built-in kinds:

- **ADR**: `docs/adr/NNNN-short-title.md`. Write `status` (proposed, accepted, rejected, deprecated, superseded) and `date` (the day it was decided, `YYYY-MM-DD`). Body: Context, Decision, Consequences. When it replaces an earlier decision, write `supersedes: [<repo>/adr/<id>]` here and set the old one's `status: superseded` and `supersededBy: [<this id>]`. Never edit an accepted decision to say something new; write a new one that supersedes it.
- **Runbook**: `docs/runbooks/<what-it-fixes>.md`. Optional `severity` (sev1 to sev4) and `lastTested`, the day someone last followed it end to end. Leave `lastTested` out rather than guess it.
- **Incident**: `docs/incidents/YYYY-MM-DD-<what-broke>.md`. Write `date`, `severity` and `status` (open, mitigated, resolved). Once resolved, write `rootCause` and `solution` as one sentence each: the index shows them, so the next team finds the fix from there. The body holds the timeline and the full write-up.

Name what each one applies to in `about:` (`service/<name>`, `event/<domain>/<id>`), so it is listed on that service's or event's page.

### Business processes

A process that crosses services, such as checkout to dispatch, goes in `flows/<id>.md` beside `docs/`, in the repository that owns the process. Its frontmatter lists `title` and `steps`. Each step has an `id`, names one thing (`event: <domain>/<id>`, `service:`, `agent:`, `actor: { name }`, `externalSystem: { name, url }` or `custom: { title }`), and leads on with `next_step` or `next_steps`, each with an optional `label` for the branch. `compensated_by` names the step that undoes it when a later step fails, such as a refund for a charge. A flow's page shows the runs of the saga named as the flow is; `workflow: <name>` names another. The Markdown body explains the process. `lanes: team` (or `{ by: domain|system|team, style: lanes|boxes }`) sets how its map opens, and a step's `lane: { team: … }` puts it in a lane the catalog does not.

Put architecture you have not built yet in `designs/<id>.md`: `title`, `status` (draft, proposed, accepted, rejected), `resources` (each `{ ref: service/PaymentService }` for one the catalog has, or `{ id, type, name?, summary?, parent? }`), `relations` (`{ from, to, kind: sends|receives|routes-through|reads|writes|connects }`, with `sends` and `receives` going from the service to the message) and `notes`. The site marks the parts the catalog lacks as new. An agent with the MCP server can draw a draft first with `show_map({ design })` and save the frontmatter it returns.

Write the steps from the code and the event declarations. A hop you write that no producer or consumer declaration backs shows as a warning on the site; fix the declaration or the flow, whichever is wrong.

### The domain model

These sit beside `docs/`, in the repository that owns the domain, and `ac docs check` checks each one.

- **Glossary**: `glossary/<domain>.md` with `dictionary: [{ id, name, summary?, description? }]`. Add a term when the code, an event or a document uses a word with a meaning specific to the domain. One term has one definition per domain.
- **Entity**: `entities/<id>.md` with `name`, `summary`, `domains`, `services`, `aggregateRoot`, `identifier`, and either `properties` (`{ name, type, required?, description?, references?: <entity id> }`) or `schema:` pointing at a JSON Schema in the repository. Prefer `schema:` when one exists, so the entity cannot drift from it. One repository defines each entity id.
- **Data product**: `data-products/<id>.md` with `name`, `domain`, `inputs` and `outputs`, each named as `about:` names a resource or as `data-product/<id>`; an output may carry `contract: <file>`. One repository defines each data product id.
- **Teams and users**: `teams/<id>.md` (`name`, `summary`, `email`, `slackDirectMessageUrl`, `members`) and `users/<id>.md` (`name`, `role`, `email`). Write them in one repository, usually the handbook, and name the file after the owner as CODEOWNERS writes it. A repository with only these folders still joins the site.

### MDX

Write `docs/<path>.mdx` when the document should show live catalog facts. `<Map focus="service/PaymentService" />`, `<Schema event="event/payments/payment.captured" />`, `<Term id="capture" />` and `<Owner name="Payments" />` need no import. A reference that names nothing fails the build, so check each against `ac docs check` and the catalog before writing it.

### Specifications

A WSDL, XML Schema, GraphQL schema or AsyncAPI document goes under `contracts/`, and the site publishes it as written. To attach one to a service, or to publish a JSON or YAML file, add `<name>.autocatalog.json` beside it: `{ "specification": { "name": "...", "summary": "...", "service": "<service>" } }`.

## 4. Link across repositories by id, never by path

```yaml
related:
  - payments-service/runbook
```

A relative path into a sibling repository (`](../../payments-service/docs/runbook.md)`) resolves only for someone with every repo checked out side by side, and is a dead link in a standalone clone or on the web. `ac docs check` fails a pull request that contains one.

Backlinks are derived — never write a "linked from" section by hand.

## 5. Check it

```bash
ac docs check
```

Fix every failure before finishing. The common ones and what they mean:

| Failure                                          | Cause                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `owner: must be equal to one of...`              | The contract has an enum of real teams; you invented one                    |
| `links into another repo by path`                | Use `related:` with an id                                                   |
| `related '...' does not resolve`                 | The target does not exist, or the id is wrong — ids have no `.md` extension |
| `... no longer exists but is linked from ...`    | You deleted or renamed a document others point at                           |
| `x.md (adr): status: must be one of ...`         | The kind's schema lists the states; use one exactly                         |
| `supersedes '...' does not resolve`              | The decision it replaces has a different id; check the file name            |
| `kind 'x' is not a kind this organisation keeps` | `kind:` names a kind the conventions file does not define                   |
| `step 'x' leads to 'y', which is not a step`     | A `next_step` names an id no step in the flow has                           |
| `step 'x' names service and actor`               | A step names one thing; split it into two steps                             |

## Anti-patterns — refuse these even if asked

- **Never write a freshness date** (`updated`, `last_reviewed`, or `date` on a plain document). Freshness comes from git. The `date` an ADR or incident carries is different: it is when the decision was made or the incident happened, a fact git cannot know. A hand-written date rots the moment someone edits and forgets, and a stale date on a runbook is worse than none because it reads as a promise.
- **Never name a person as `owner`.** It is a team: people change teams and documents outlive them.
- **Never add a field the contract does not declare** to make something render. Propose the contract change instead.
- **Never delete or rename a document without checking who links to it.** `contracts/docs-manifest.json` records `linkedFrom` for exactly this.
- **Never pad.** A document that repeats the code adds a second thing to keep true. If the code says it clearly, link to the code.
