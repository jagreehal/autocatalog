import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Console, Context, Effect, Layer, Schema } from 'effect';
import type { StaticEffectIR, StaticFlowNode } from 'effect-analyzer/analysis';
import { stringify } from 'yaml';

/** A step as `flows/<id>.md` writes it, in the order a reader expects the keys. */
interface DraftStep {
  id: string;
  stage?: string;
  title: string;
  summary?: string;
  track?: 'failure';
  repeats?: string;
  systems?: string[];
  policy?: string;
  code: Array<{ file: string; contains: string }>;
  next_step?: string;
  next_steps?: Array<string | { id: string; label: string }>;
}

export interface DraftedFlow {
  title: string;
  summary?: string;
  steps: DraftStep[];
}

const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/);

const sentence = (parts: string[]) => {
  const text = parts.join(' ');

  return text.charAt(0).toUpperCase() + text.slice(1);
};

const kebab = (name: string) => words(name).join('-');

const IRREGULAR = new Map([
  ['build', 'built'],
  ['find', 'found'],
  ['get', 'fetched'],
  ['make', 'made'],
  ['pay', 'paid'],
  ['read', 'read'],
  ['run', 'run'],
  ['send', 'sent'],
  ['set', 'set'],
  ['ship', 'shipped'],
  ['stop', 'stopped'],
  ['take', 'taken'],
  ['write', 'written'],
]);

function pastTense(verb: string): string {
  const irregular = IRREGULAR.get(verb);

  if (irregular) return irregular;

  if (verb.endsWith('e')) return `${verb}d`;

  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ied`;

  return `${verb}ed`;
}

/** `loadImport` as the fact it records: "Import loaded". */
export function factOf(name: string): string {
  const [verb, ...object] = words(name);

  return object.length > 0
    ? sentence([...object, pastTense(verb!)])
    : sentence([verb!, 'completed']);
}

/** The first generator in a program: the body whose yields are its steps. */
function bodyOf(nodes: readonly StaticFlowNode[]): StaticFlowNode | undefined {
  for (const node of nodes) {
    if (node.type === 'generator') return node;

    const inner = 'children' in node && Array.isArray(node.children) ? node.children : [];
    const found = bodyOf(inner);

    if (found) return found;
  }

  return undefined;
}

interface Named {
  name: string;
  errors: string[];
  systems: string[];
  repeats?: string | undefined;
  /** What the call's own handlers do with an error; nothing when they do not catch it. */
  recovery: (error: string) => Recovery | undefined;
}

/**
 * What a handler does with the error it catches: the run carries on when the
 * handler can succeed, and fails again with each error it raises. A handler
 * the draft cannot read is `known: false`, and claims neither.
 */
interface Recovery {
  known: boolean;
  continues: boolean;
  raises: string[];
}

const UNREAD: Recovery = { known: false, continues: false, raises: [] };

const tagsOf = (union: string | undefined) =>
  (union ?? '')
    .split('|')
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== 'never');

/** How the analyzer walks its own tree: a node's children, whatever kind it is. */
type ChildrenOf = (node: StaticFlowNode) => ReadonlyArray<StaticFlowNode>;

const nodesUnder = (node: StaticFlowNode, childrenOf: ChildrenOf): StaticFlowNode[] => [
  node,
  ...childrenOf(node).flatMap((child) => nodesUnder(child, childrenOf)),
];

/** A handler's outcome, from the types of the effects it can end with. */
function outcomeOf(handler: StaticFlowNode | undefined, childrenOf: ChildrenOf): Recovery {
  if (!handler) return UNREAD;

  const typed = nodesUnder(handler, childrenOf).flatMap((node) =>
    node.type === 'effect' && node.typeSignature ? [node.typeSignature] : [],
  );

  if (typed.length === 0) return UNREAD;

  return {
    known: true,
    continues: typed.some((signature) => signature.successType !== 'never'),
    raises: [
      ...new Set(
        typed.flatMap((signature) =>
          signature.errorTags ? [...signature.errorTags] : tagsOf(signature.errorType),
        ),
      ),
    ],
  };
}

const services = (ir: StaticEffectIR | undefined) =>
  ir?.root.typeSignature?.requirementsType
    ?.split('|')
    .map((service) => service.trim())
    .filter((service) => service && service !== 'never') ?? [];

// Handlers after which the run carries on, whatever failed. A handler that only
// maps an error to another, or turns it into a defect, does not count.
const CATCH_ALL = new Set([
  'catch',
  'catchCause',
  'catchEager',
  'orElse',
  'orElseSucceed',
  'ignore',
  'ignoreLogged',
  'match',
  'matchCause',
  'matchEffect',
  'matchCauseEffect',
  'firstSuccessOf',
  'eventually',
]);

/**
 * A handler's outcome once the handlers after it have had their turn: each
 * error it raises goes through the rest, so one a later handler recovers from
 * carries on, and only those nothing later catches are raised.
 */
function chain(recovery: Recovery, rest: (error: string) => Recovery | undefined): Recovery {
  let { known, continues } = recovery;
  const raises: string[] = [];

  for (const raised of recovery.raises) {
    const next = rest(raised);

    if (!next) {
      raises.push(raised);
      continue;
    }

    known &&= next.known;
    continues ||= next.continues;
    raises.push(...next.raises);
  }

  return { known, continues, raises: [...new Set(raises)] };
}

/** What a pipe's handlers do with an error, in the order they run. */
function catches(
  handlers: readonly StaticFlowNode[],
  childrenOf: ChildrenOf,
): (error: string) => Recovery | undefined {
  const ordered = handlers.flatMap((node) => (node.type === 'error-handler' ? [node] : []));

  const outcome = (node: (typeof ordered)[number], error: string) => {
    const tagged = node.tagHandlers?.find(({ tag }) => tag === error);

    if (tagged) return outcomeOf(tagged.handler, childrenOf);

    return node.errorTag === error ||
      node.errorTags?.includes(error) ||
      CATCH_ALL.has(node.handlerType)
      ? outcomeOf(node.handler, childrenOf)
      : undefined;
  };

  const resolve = (error: string, from: number): Recovery | undefined => {
    for (const [index, node] of ordered.entries()) {
      if (index < from) continue;

      const found = outcome(node, error);

      if (found) return chain(found, (raised) => resolve(raised, index + 1));
    }

    return undefined;
  };

  return (error) => resolve(error, 0);
}

// What follows a handler in a loop body's source: its own text, up to the next handler.
const handlerText = (text: string, from: number) => {
  const rest = text.slice(from);
  const end = rest.slice(1).search(/catchTags?\(|Effect\.catch\(|\b[A-Z]\w*\s*:/);

  return end === -1 ? rest : rest.slice(0, end + 1);
};

/**
 * What a handler's source says it ends with. Logging is a side effect, so a
 * handler that logs and fails, fails. One that can both recover and fail is
 * read as both only behind a condition the draft can see; otherwise, and when
 * it fails with an error the draft cannot name, it is unread.
 */
function handlerOutcome(handler: string, known: ReadonlySet<string>): Recovery {
  const raises = [...known].filter((tag) => new RegExp(`new\\s+${tag}\\s*\\(`).test(handler));
  const fails = raises.length > 0 || /Effect\.fail\w*\(/.test(handler);
  const recovers = /Effect\.(succeed|void|as|asVoid|ignore\w*)\b/.test(handler);
  const logs = /Effect\.log\w*\(/.test(handler);
  const conditional = /\?[^?.]|\bif\s*\(|Effect\.(if|when|unless)\b|Match\./.test(handler);

  if (!fails) return recovers || logs ? { known: true, continues: true, raises: [] } : UNREAD;

  if (raises.length === 0) return UNREAD;

  if (!recovers) return { known: true, continues: false, raises };

  return conditional ? { known: true, continues: true, raises } : UNREAD;
}

/**
 * The same, read from a loop body's source, which the analyzer leaves opaque:
 * handlers in the order written, each carrying on when it succeeds in so many
 * words and raising each error it constructs, which the handlers after it get.
 */
const recoveryInSource =
  (text: string, known: ReadonlySet<string>) =>
  (error: string): Recovery | undefined => {
    // The first handler written that catches it, by tag or catching anything.
    let at: RegExpExecArray | undefined;

    for (const pattern of [
      new RegExp(`catchTag\\(\\s*['"\`]${error}['"\`]`),
      new RegExp(`catchTags\\([\\s\\S]*?\\b${error}\\s*:`),
      /Effect\.(catch|catchCause|orElse|orElseSucceed|ignore|match)\(/,
    ]) {
      const match = pattern.exec(text);

      if (match && (!at || match.index < at.index)) at = match;
    }

    if (!at) return undefined;

    const start = at.index + at[0].length;
    const handler = handlerText(text, start);

    const outcome = handlerOutcome(handler, known);

    return outcome.known
      ? chain(outcome, recoveryInSource(text.slice(start + handler.length), known))
      : outcome;
  };

/**
 * Each yield of the program's body as a named step: the call it makes, the
 * errors that call can fail with, the services the called program needs, and
 * which of those errors its own handlers catch. A call piped through handlers
 * is the call; a loop's body is the program it names in its source.
 */
function namedSteps(
  ir: StaticEffectIR,
  programs: StaticEffectIR[],
  source: string,
  childrenOf: ChildrenOf,
): Named[] {
  const body = bodyOf(ir.root.children);

  if (body?.type !== 'generator') return [];

  const byName = new Map(programs.map((program) => [program.root.programName, program]));
  const knownErrors = new Set(programs.flatMap((program) => program.root.errorTypes ?? []));

  return body.yields.flatMap(({ effect: yielded }): Named[] => {
    if (yielded.type === 'loop') {
      const text = source.slice(yielded.location?.offset ?? 0, yielded.location?.endOffset ?? 0);

      const called = programs.find(
        (program) => program !== ir && new RegExp(`\\b${program.root.programName}\\b`).test(text),
      );

      if (!called) return [];

      return [
        {
          name: called.root.programName,
          errors: [...(called.root.errorTypes ?? [])],
          systems: services(called),
          repeats: yielded.iterSource ? `once per item in ${yielded.iterSource}` : 'once per item',
          recovery: recoveryInSource(text, knownErrors),
        },
      ];
    }

    const effect = yielded.type === 'pipe' ? yielded.initial : yielded;

    if (effect.type !== 'effect' || effect.callee.includes('.')) return [];

    const called = byName.get(effect.callee);

    return [
      {
        name: effect.callee,
        errors: [...(effect.typeSignature?.errorTags ?? called?.root.errorTypes ?? [])],
        systems: services(called),
        recovery: catches(yielded.type === 'pipe' ? yielded.transformations : [], childrenOf),
      },
    ];
  });
}

/**
 * A process-level board drafted from an Effect program: a stage per call, the
 * fact each records, a failure for each error it can fail with, and the
 * services it calls as systems. Each call is its own step, so a program that
 * calls the same thing twice has two. What happens after a failure depends on
 * where it is caught: by the call's own handlers, the run carries on; by a
 * handler around the whole program, the run stops there; by neither, it
 * escapes with no policy, which the board shows as a hotspot to decide.
 */
export function draftFromEffect(
  ir: StaticEffectIR,
  programs: StaticEffectIR[],
  options: { file: string; source: string; childrenOf: ChildrenOf },
): DraftedFlow {
  const named = namedSteps(ir, programs, options.source, options.childrenOf);

  // Handlers around the whole program stop the run. Some are in the tree; those
  // passed to `Effect.fn` show only as an error the program no longer fails
  // with, which counts only when the analyzer resolved the program's type.
  const around = catches(ir.root.children, options.childrenOf);
  const escaping = ir.root.typeSignature ? new Set(ir.root.errorTypes) : undefined;

  const stops = (error: string) =>
    around(error) !== undefined || (escaping !== undefined && !escaping.has(error));

  // Every id in the flow is unique: a second use of a name gets a count.
  const used = new Set<string>();

  const allocate = (base: string) => {
    let id = base;

    for (let count = 2; used.has(id); count += 1) id = `${base}-${count}`;

    used.add(id);

    return id;
  };

  // One id per call: the first is named for what it calls, the next get a count.
  const ids = named.map(({ name }) => allocate(kebab(name)));

  // An error one call alone fails with is named for the error; one several
  // calls share is named for the call as well.
  const shared = new Set(
    named
      .flatMap((step) => step.errors)
      .filter((error, index, all) => all.indexOf(error) !== index),
  );

  // When the last call can fail, the run's success is a fact of its own, so
  // "How it can end" keeps it.
  const last = named.at(-1);

  const completed =
    last && last.errors.length > 0 ? `${kebab(ir.root.programName)}-completed` : undefined;

  const steps: DraftStep[] = [];
  const failures: DraftStep[] = [];

  for (const [index, step] of named.entries()) {
    const id = ids[index]!;

    // Only the last call has none after it, and it leads to the success ending.
    const next = ids[index + 1] ?? completed;

    // Inside a loop, a caught failure goes back for the next item.
    const after = step.repeats ? id : next;

    const branches = step.errors.map((error) => {
      const failure = allocate(shared.has(error) ? `${id}-${kebab(error)}` : kebab(error));
      const recovery = step.recovery(error);

      // A failure its handler raises in turn is a fact of its own, which the
      // program may stop on or let escape.
      const replacements: DraftStep[] = [];

      const raised = (recovery?.raises ?? []).map((replacement) => {
        const raisedId = allocate(`${failure}-${kebab(replacement)}`);

        replacements.push({
          id: raisedId,
          title: sentence(words(replacement)),
          track: 'failure',
          ...(stops(replacement) && {
            policy: `Whenever ${replacement} is caught, stop the run`,
          }),
          code: [{ file: options.file, contains: replacement }],
        });

        return { id: raisedId, label: `fails with ${replacement}` };
      });

      const carriesOn = recovery?.continues === true && after !== undefined;

      const outcomes = [
        ...(recovery?.continues ? [step.repeats ? 'carry on with the next one' : 'carry on'] : []),
        ...(recovery?.raises.length ? [`fail with ${recovery.raises.join(' or ')}`] : []),
      ];

      const policy =
        outcomes.length > 0
          ? `Whenever ${error} is caught, ${outcomes.join(', or ')}`
          : !recovery && stops(error)
            ? `Whenever ${error} is caught, stop the run`
            : undefined;

      const onward = [...(carriesOn ? [after] : []), ...raised];

      failures.push({
        id: failure,
        title: sentence(words(error)),
        track: 'failure',
        ...(recovery?.known === false && {
          summary: 'Caught by a handler the draft cannot read: say what happens next.',
        }),
        ...(policy && { policy }),
        code: [{ file: options.file, contains: error }],
        ...(carriesOn && raised.length === 0
          ? { next_step: after }
          : onward.length > 0 && { next_steps: onward }),
      });

      failures.push(...replacements);

      return { id: failure, label: `fails with ${error}` };
    });

    const leadsTo = [...(next ? [next] : []), ...branches];

    // A single plain next step reads as `next_step`; a branch needs its label.
    const single = branches.length === 0 && next !== undefined;

    steps.push({
      id,
      stage: sentence(words(step.name)),
      title: factOf(step.name),
      ...(step.repeats && { repeats: step.repeats }),
      ...(step.systems.length > 0 && { systems: step.systems }),
      code: [{ file: options.file, contains: step.name }],
      ...(single ? { next_step: next } : leadsTo.length > 0 && { next_steps: leadsTo }),
    });
  }

  if (completed && last) {
    steps.push({
      id: completed,
      stage: sentence(words(last.name)),
      title: `${sentence(words(ir.root.programName))} completed`,
      code: [{ file: options.file, contains: ir.root.programName }],
    });
  }

  return {
    title: sentence(words(ir.root.programName)),
    ...(ir.root.jsdocDescription && { summary: ir.root.jsdocDescription.trim() }),
    steps: [...steps, ...failures],
  };
}

/** The flow as `flows/<id>.md` holds it, with a note to say it is a draft. */
export function draftMarkdown(flow: DraftedFlow, from: string): string {
  const yaml = stringify(flow, { lineWidth: 100 });

  return [
    '---',
    `# Drafted by \`ac flows draft\` from ${from}. Name each fact in the business's`,
    '# words, give every failure a policy, then delete these two lines.',
    yaml.trimEnd(),
    '---',
    '',
  ].join('\n');
}

export class SourceMissing extends Schema.TaggedError<SourceMissing>()('SourceMissing', {
  file: Schema.String,
}) {}

export class AnalyzerMissing extends Schema.TaggedError<AnalyzerMissing>()('AnalyzerMissing', {
  specifier: Schema.String,
}) {}

export class AnalysisFailed extends Schema.TaggedError<AnalysisFailed>()('AnalysisFailed', {
  file: Schema.String,
  reason: Schema.String,
}) {}

export class ProgramNotFound extends Schema.TaggedError<ProgramNotFound>()('ProgramNotFound', {
  program: Schema.String,
  file: Schema.String,
  available: Schema.Array(Schema.String),
}) {}

export class NothingToDraft extends Schema.TaggedError<NothingToDraft>()('NothingToDraft', {
  program: Schema.String,
}) {}

export class FlowExists extends Schema.TaggedError<FlowExists>()('FlowExists', {
  target: Schema.String,
}) {}

export class WriteFailed extends Schema.TaggedError<WriteFailed>()('WriteFailed', {
  target: Schema.String,
  reason: Schema.String,
}) {}

/** The Effect programs a source file holds, as effect-analyzer reads them. */
export class EffectAnalyzer extends Context.Service<
  EffectAnalyzer,
  {
    readonly programs: (
      file: string,
      tsconfig: string,
    ) => Effect.Effect<ReadonlyArray<StaticEffectIR>, AnalysisFailed>;
    readonly childrenOf: ChildrenOf;
  }
>()('EffectAnalyzer') {}

const resolveFrom = (specifier: string, from: string) =>
  Effect.try({
    try: () => createRequire(from).resolve(specifier),
    catch: () => new AnalyzerMissing({ specifier }),
  });

const importFile = (file: string, specifier: string) =>
  Effect.tryPromise({
    try: () => import(pathToFileURL(file).href),
    catch: () => new AnalyzerMissing({ specifier }),
  });

/**
 * effect-analyzer as the project being drafted installs it, or as this CLI
 * does, run on the `effect` it resolves itself: its programs are values of
 * that copy, so that copy runs them.
 */
export const effectAnalyzerLayer = (root: string) =>
  Layer.effect(
    EffectAnalyzer,
    Effect.gen(function* () {
      const entry = yield* resolveFrom(
        'effect-analyzer/analysis',
        path.join(root, 'package.json'),
      ).pipe(Effect.catch(() => resolveFrom('effect-analyzer/analysis', import.meta.url)));

      const runtime = yield* resolveFrom('effect', entry);

      // SAFETY: each file is the module its specifier names, resolved just above.
      const analysis = (yield* importFile(
        entry,
        'effect-analyzer',
      )) as typeof import('effect-analyzer/analysis');

      // SAFETY: as above, the `effect` effect-analyzer itself resolves.
      const own = (yield* importFile(runtime, 'effect')) as typeof import('effect');

      return {
        childrenOf: analysis.childrenOf,
        programs: Effect.fn('EffectAnalyzer.programs')(function* (file: string, tsconfig: string) {
          return yield* Effect.tryPromise({
            // The analyzer's programs belong to its own copy of `effect`, so that copy runs them.
            try: () =>
              // @effect-diagnostics-next-line runEffectInsideEffect:off
              own.Effect.runPromise(analysis.analyze(file, { tsConfigPath: tsconfig }).all),
            catch: (cause) =>
              new AnalysisFailed({
                file,
                reason: cause instanceof Error ? cause.message : String(cause),
              }),
          });
        }),
      };
    }),
  );

export interface FlowsDraftOptions {
  file: string;
  program: string;
  id?: string | undefined;
  tsconfig?: string | undefined;
  root: string;
  write: boolean;
  force: boolean;
}

const readSource = (file: string, shown: string) =>
  Effect.try({
    try: () => fs.readFileSync(file, 'utf8'),
    catch: () => new SourceMissing({ file: shown }),
  });

const writeFlow = (target: string, markdown: string) =>
  Effect.try({
    try: () => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, markdown);
    },
    catch: (cause) =>
      new WriteFailed({ target, reason: cause instanceof Error ? cause.message : String(cause) }),
  });

/** Draft the flow, then print it or write it under `flows/`. */
export const draftFlow = Effect.fn('flows.draft')(function* (opts: FlowsDraftOptions) {
  const root = path.resolve(opts.root);
  const file = path.resolve(root, opts.file);
  const tsconfig = path.resolve(root, opts.tsconfig ?? 'tsconfig.json');
  const source = yield* readSource(file, opts.file);

  const analyzer = yield* EffectAnalyzer;
  const programs = yield* analyzer.programs(file, tsconfig);
  const ir = programs.find((program) => program.root.programName === opts.program);

  if (!ir) {
    return yield* new ProgramNotFound({
      program: opts.program,
      file: opts.file,
      available: programs.map((program) => program.root.programName),
    });
  }

  const relative = path.relative(root, file).split(path.sep).join('/');

  const flow = draftFromEffect(ir, [...programs], {
    file: relative,
    source,
    childrenOf: analyzer.childrenOf,
  });

  if (flow.steps.length === 0) return yield* new NothingToDraft({ program: opts.program });

  const markdown = draftMarkdown(flow, `${relative} (${opts.program})`);

  if (!opts.write) {
    yield* Effect.sync(() => process.stdout.write(markdown));

    return;
  }

  const target = path.join(root, 'flows', `${opts.id ?? kebab(opts.program)}.md`);
  const shown = path.relative(root, target);

  if (fs.existsSync(target) && !opts.force) return yield* new FlowExists({ target: shown });

  yield* writeFlow(target, markdown);
  yield* Console.log(`Wrote ${shown}. Open it, name the facts, and run ac docs check.`);
});

/** What the reader is told when a draft cannot be made. */
const refusal = (message: string) => Console.error(message).pipe(Effect.as(1));

/** The command's boundary: the draft as an exit code, each refusal said once. */
export function runFlowsDraft(opts: FlowsDraftOptions): Promise<number> {
  return Effect.runPromise(
    draftFlow(opts).pipe(
      Effect.as(0),
      Effect.provide(effectAnalyzerLayer(path.resolve(opts.root))),
      Effect.catchTags({
        SourceMissing: ({ file }) => refusal(`${file} does not exist`),
        AnalyzerMissing: ({ specifier }) =>
          refusal(
            `${specifier} is not installed. Add it to this project: npm install -D effect-analyzer effect`,
          ),
        AnalysisFailed: ({ file, reason }) =>
          refusal(`effect-analyzer could not read ${file}: ${reason}`),
        ProgramNotFound: ({ program, file, available }) =>
          refusal(`No program ${program} in ${file}. It has: ${available.join(', ') || 'none'}.`),
        NothingToDraft: ({ program }) =>
          refusal(`${program} has no steps to draft: it yields nothing effect-analyzer names.`),
        FlowExists: ({ target }) => refusal(`${target} exists. Pass --force to replace it.`),
        WriteFailed: ({ target, reason }) => refusal(`${target} was not written: ${reason}`),
      }),
    ),
  );
}
