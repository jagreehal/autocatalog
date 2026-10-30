/** @jsxImportSource react */
import '@eventcatalog/visualiser/styles-core.css';
import '@eventcatalog/visualiser/studio.css';
import {
  canvasToModel,
  getNodeDefinition,
  modelToCanvas,
  type ModelCanvasContent,
} from '@eventcatalog/visualiser/studio';
import type { Model } from '@eventcatalog/visualiser/model';
import type { Edge } from '@xyflow/react';
import type { DesignReview } from 'autocatalog-docs-core';
import { AlertCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '#ui/components/ui/alert.tsx';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Button, LinkButton } from '#ui/components/ui/button.tsx';
import { Kbd } from '#ui/components/ui/kbd.tsx';
import {
  DESIGN_CHANGED,
  designCheck,
  openedDesign,
  type CanvasModel,
  type DesignCheck,
} from '../lib/canvas-model';
import { edgeWeight, type EdgeEvidence } from '../lib/visualiser';
import {
  StudioCanvas,
  type CanvasSnapshot,
} from '../vendor/eventcatalog-studio/studio/StudioCanvas';

export interface DesignStudioProps {
  title: string;
  /** The file it saves to, from the repository's name: `payments/designs/refunds.md`. */
  file: string;
  /** The design's page, to go back to. */
  designHref: string;
  /** Where the canvas is checked against the catalog and saved, and the file read again. */
  checkUrl: string;
  /** The file on disk: the dev server names it when it changes. */
  watchFile: string;
  model: CanvasModel;
  review: DesignReview;
}

type Status = 'saved' | 'unsaved' | 'saving' | 'failed';

const STATUS: Record<Status, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  failed: 'Not saved',
};

// This tab, so a save it made is not news to it when the dev server tells every page.
const tab = crypto.randomUUID();

// How long the canvas rests before it is checked against the catalog again.
const CHECK_AFTER_MS = 400;

// What Studio puts on a node it makes: its resource under a key (`service`), with a summary.
const madeWith = z.record(z.string(), z.unknown());

const placeholderOf = z.object({ summary: z.string() });

/**
 * Studio gives what it makes a summary to write over ("Describe what this
 * service does."). One left as it was is not the design's, so it is not saved.
 */
const withoutPlaceholder =
  ({ nodes }: CanvasSnapshot) =>
  (resource: Model['resources'][number]) => {
    const node = nodes.find(({ id }) => id === resource.id);
    const definition = getNodeDefinition(node?.type);
    const made = madeWith.safeParse(definition?.createData?.()).data;

    const placeholder =
      definition?.resourceKey &&
      placeholderOf.safeParse(made?.[definition.resourceKey]).data?.summary;

    if (!placeholder || resource.summary !== placeholder) return resource;

    const { summary: _, ...rest } = resource;

    return rest;
  };

// What a canvas edge stands for: Studio keeps the relations it draws on it.
const drawnRelations = z.object({
  relations: z.array(z.object({ from: z.string(), to: z.string(), kind: z.string() })),
});

const node = (id: string) => `[data-testid="rf__node-${CSS.escape(id)}"]`;

const edge = (id: string) => `[data-testid="rf__edge-${CSS.escape(id)}"]`;

/**
 * Mark the canvas as the maps draw a design and its evidence (components.css):
 * what is new outlined, each edge with what the snapshot saw of it and how
 * often. Studio renders its own nodes and edges, so the marks go on their
 * elements by id, and again whenever it draws them anew.
 */
function markCanvas(root: HTMLElement, review: DesignReview | undefined, edges: Edge[]) {
  for (const marked of root.querySelectorAll<HTMLElement>('[data-ac-proposed]')) {
    delete marked.dataset.acProposed;
  }

  for (const marked of root.querySelectorAll<SVGElement>('[data-ac-evidence]')) {
    delete marked.dataset.acEvidence;
  }

  if (!review) return;

  for (const { id } of review.added) {
    const element = root.querySelector<HTMLElement>(node(id));

    if (element) element.dataset.acProposed = '';
  }

  const evidence = new Map(
    (review.runtime?.relations ?? []).map((relation) => [
      `${relation.from}|${relation.kind}|${relation.to}`,
      relation.evidence,
    ]),
  );

  for (const { id, data } of edges) {
    const seen = drawnRelations
      .safeParse(data)
      .data?.relations.map(({ from, kind, to }) => evidence.get(`${from}|${kind}|${to}`))
      .find(Boolean);

    const element = root.querySelector<SVGElement>(edge(id));

    if (!seen || !element) continue;

    element.dataset.acEvidence = seen.state;
    element.style.setProperty('--ac-edge-weight', String(edgeWeight(seen)));
  }
}

const RAN: Record<EdgeEvidence['state'], (count: number) => string> = {
  observed: (count) => `ran ${count} ${count === 1 ? 'time' : 'times'}`,
  unseen: () => 'declared, never seen',
  undocumented: (count) =>
    `ran ${count} ${count === 1 ? 'time' : 'times'}, though nobody declared it`,
};

const sentence = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * A design on EventCatalog Studio's canvas, checked against the catalog as it
 * changes: what it adds, and whose resources it touches. Saving writes the
 * design's file, so the change goes to review as a pull request like code.
 */
export function DesignStudio({
  title,
  file,
  designHref,
  checkUrl,
  watchFile,
  model: opened,
  review: openedReview,
}: DesignStudioProps) {
  const [content, setContent] = useState<ModelCanvasContent | null>(null);

  // The model the canvas opened with: what it changes are changes to.
  const [model, setModel] = useState<Model>(opened);
  const [edges, setEdges] = useState<Edge[]>([]);

  // The file changed on disk while the canvas had changes of its own.
  const [changedOnDisk, setChangedOnDisk] = useState(false);

  const [check, setCheck] = useState<DesignCheck>({
    ok: true,
    review: openedReview,
    warnings: [],
    saved: true,
  });

  const [status, setStatus] = useState<Status>('saved');
  const statusNow = useRef(status);

  statusNow.current = status;

  const current = useRef<Model>(opened);
  const canvas = useRef<HTMLDivElement>(null);

  // Each change to the canvas is a revision; an answer about an older one
  // neither replaces the checks of a newer one nor calls it saved.
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Laid out once as the page opens, before there is a canvas to change.
  useEffect(() => {
    void modelToCanvas(opened).then((laid) => {
      setContent(laid);
      setEdges(laid.edges);
    });
  }, [opened]);

  /**
   * The design as its file says it now, onto the canvas: what the canvas had is
   * let go. A file that does not hold stays off it, with why. Reading and laying
   * it out both take a moment; a change on the canvas meanwhile wins, and the
   * file waits behind "Load it".
   */
  const load = useCallback(async () => {
    const asked = revision.current;
    const response = await fetch(checkUrl);
    const body: unknown = await response.json();
    const fresh = openedDesign.safeParse(body);
    const laid = fresh.success ? await modelToCanvas(fresh.data.model) : undefined;

    // Changed on the canvas while the file was read or laid out: those changes are not let go unasked.
    if (asked !== revision.current) {
      setChangedOnDisk(true);

      return;
    }

    setChangedOnDisk(false);

    if (!fresh.success || !laid) {
      setCheck(designCheck.parse(body));

      return;
    }

    revision.current += 1;
    current.current = fresh.data.model;
    setModel(fresh.data.model);
    setContent(laid);
    setEdges(laid.edges);
    setCheck({ ok: true, review: fresh.data.review, warnings: [], saved: true });
    setStatus('saved');
  }, [checkUrl]);

  // Someone else wrote the file (an agent, an editor, a pull): it comes onto the
  // canvas, unless the canvas has changes of its own, which are not dropped unasked.
  useEffect(() => {
    const hot = import.meta.hot;

    if (!hot) return;

    const onChanged = ({ file, by }: { file: string; by?: string }) => {
      // This tab's own save is on its canvas already; another tab's is news here.
      if (file !== watchFile || by === tab) return;

      if (statusNow.current === 'saved') void load();
      else setChangedOnDisk(true);
    };

    hot.on(DESIGN_CHANGED, onChanged);

    return () => hot.off(DESIGN_CHANGED, onChanged);
  }, [load, watchFile]);

  /** Check (or save) the canvas as it is now; true when the answer is still about the canvas as it is. */
  const send = useCallback(
    async (save: boolean) => {
      const sent = revision.current;

      const response = await fetch(checkUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: current.current, save, tab }),
      });

      const result = designCheck.parse(await response.json());

      if (sent !== revision.current) return { result, current: false };

      setCheck(result);

      return { result, current: true };
    },
    [checkUrl],
  );

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    setStatus('saving');

    const answer = await send(true).catch(() => undefined);

    // Changed while saving: what was written is not what is on the canvas now.
    if (answer && !answer.current) return;

    setStatus(answer?.result.ok ? 'saved' : 'failed');
  }, [send]);

  const onChange = useCallback(
    (snapshot: CanvasSnapshot) => {
      const next = canvasToModel(
        snapshot.nodes,
        snapshot.edges,
        snapshot.levelLayouts,
        model,
        snapshot.threads,
        snapshot.hotspots,
      );

      current.current = { ...next, resources: next.resources.map(withoutPlaceholder(snapshot)) };
      revision.current += 1;
      setEdges(snapshot.edges);
      setStatus('unsaved');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void send(false).catch(() => undefined), CHECK_AFTER_MS);
    },
    [model, send],
  );

  // ⌘S / Ctrl+S saves, as in an editor, rather than saving the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (status !== 'unsaved' && status !== 'failed') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [status]);

  const review = check.ok ? check.review : undefined;

  // Marked now, and again as Studio draws nodes and edges anew (a level, a layout, a node added).
  useEffect(() => {
    const root = canvas.current;

    if (!root) return;

    markCanvas(root, review, edges);

    const observer = new MutationObserver(() => markCanvas(root, review, edges));

    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [review, edges]);

  const names = new Map(current.current.resources.map(({ id, name }) => [id, name]));
  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <div className="not-content flex h-dvh min-h-128 gap-4" data-canvas>
      <div
        ref={canvas}
        className="eventcatalog-visualizer relative min-w-0 flex-1 overflow-hidden rounded-xl border"
      >
        {content ? (
          <StudioCanvas content={content} onChange={onChange} />
        ) : (
          <p className="p-6 text-muted-foreground">Laying out {title}…</p>
        )}
      </div>

      <aside
        aria-label="Review"
        className="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto text-sm"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge variant={status === 'failed' ? 'destructive' : 'secondary'} role="status">
              {STATUS[status]}
            </Badge>
          </div>
          <p className="m-0 text-muted-foreground">
            Saves to <code>{file}</code>. Commit it to propose the change.
          </p>
          <div className="flex gap-2">
            <Button onPress={() => void save()} isDisabled={status === 'saving' || !check.ok}>
              Save <Kbd>⌘S</Kbd>
            </Button>
            <LinkButton variant="outline" href={designHref}>
              Back to design
            </LinkButton>
          </div>
        </div>

        {changedOnDisk && (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>The file changed on disk</AlertTitle>
            <AlertDescription>
              Someone else wrote {file} while the canvas had changes. Load it to see theirs, or save
              to write yours over it.
            </AlertDescription>
            <AlertAction>
              <Button size="sm" variant="outline" onPress={() => void load()}>
                Load it
              </Button>
            </AlertAction>
          </Alert>
        )}

        {!check.ok && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>The design does not hold</AlertTitle>
            <AlertDescription>
              <ul className="m-0 list-disc pl-4">
                {[...new Set(check.errors)].map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {review && (
          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-base font-semibold">What it adds</h2>
            <p className="m-0">{review.changes}.</p>
            {review.added.length > 0 && (
              <p className="m-0 text-muted-foreground">
                New: {sentence(review.added.map(({ name }) => name))}.
              </p>
            )}
          </section>
        )}

        {review && (
          <section className="flex flex-col gap-3">
            <h2 className="m-0 text-base font-semibold">Who to ask</h2>
            {review.impact.length === 0 ? (
              <p className="m-0 text-muted-foreground">
                It changes nothing the catalog already has, so it needs no other team.
              </p>
            ) : (
              review.impact.map((touched) => (
                <div key={`${touched.kind}:${touched.name}`} className="flex flex-col gap-1">
                  <p className="m-0 font-medium">
                    {touched.name}{' '}
                    <span className="font-normal text-muted-foreground">
                      ({touched.kind}
                      {touched.owner ? `, owned by ${touched.owner}` : ', no owner'})
                    </span>
                  </p>
                  <p className="m-0">{sentence(touched.changes)}.</p>
                  {touched.dependents.length > 0 && (
                    <p className="m-0 text-muted-foreground">
                      Depends on it today: {sentence(touched.dependents)}.
                    </p>
                  )}
                </div>
              ))
            )}
          </section>
        )}

        {review?.runtime && (
          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-base font-semibold">At runtime</h2>
            <p className="m-0 text-muted-foreground">
              From the snapshot: on the canvas, solid ran (thicker, more often), dashed was declared
              and never seen, and the inferred colour ran though nobody declared it.
            </p>
            <ul className="m-0 flex flex-col gap-1 pl-4">
              {review.runtime.relations.map(({ from, kind, to, evidence }) => (
                <li key={`${from}|${kind}|${to}`}>
                  {nameOf(from)} {kind} {nameOf(to)}: {RAN[evidence.state](evidence.count)}.
                </li>
              ))}
              {review.runtime.undrawn.map(({ service, role, event, count }) => (
                <li key={`${service}|${role}|${event}`}>
                  {service} {role === 'produces' ? 'sends' : 'receives'} {event} too ({count}{' '}
                  {count === 1 ? 'time' : 'times'}), and the design does not draw it.
                </li>
              ))}
            </ul>
          </section>
        )}

        {check.warnings.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-base font-semibold">Worth a look</h2>
            <ul className="m-0 list-disc pl-4 text-muted-foreground">
              {[...new Set(check.warnings)].map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

export default DesignStudio;
