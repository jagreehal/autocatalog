import { Context, Effect, Schema } from 'effect';

export class StorageError extends Schema.TaggedError<StorageError>()('StorageError', {
  reason: Schema.String,
}) {}

export class ReportRejected extends Schema.TaggedError<ReportRejected>()('ReportRejected', {
  count: Schema.Finite,
}) {}

export class Store extends Context.Service<
  Store,
  {
    readonly read: Effect.Effect<ReadonlyArray<string>, StorageError>;
    readonly write: (item: string) => Effect.Effect<void, StorageError>;
  }
>()('Store') {}

export class Reports extends Context.Service<
  Reports,
  { readonly publish: (count: number) => Effect.Effect<void, ReportRejected> }
>()('Reports') {}

export const readItems = Effect.fn('readItems')(function* () {
  const store = yield* Store;

  return yield* store.read;
});

export const writeItem = Effect.fn('writeItem')(function* (item: string) {
  const store = yield* Store;

  yield* store.write(item);
});

export const publishReport = Effect.fn('publishReport')(function* (count: number) {
  const reports = yield* Reports;

  yield* reports.publish(count);
});

/** Copies every item, then reports how many. */
export const runSync = Effect.fn('runSync')(function* () {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* Effect.forEach(items, (item) =>
    writeItem(item).pipe(Effect.catchTag('StorageError', () => Effect.void)),
  );

  yield* publishReport(items.length);
});

/** Counts the items before and after one write, and reports the change. */
export const runAudit = Effect.fn('runAudit')(function* () {
  const before = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* writeItem('audit');

  const after = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* publishReport(after.length - before.length);
});

/** Reports the item count; a rejected report ends the run quietly. */
export const runReport = Effect.fn('runReport')(
  function* () {
    const items = yield* readItems().pipe(
      Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
    );

    yield* publishReport(items.length);
  },
  Effect.catchTag('ReportRejected', () => Effect.void),
);

/** A failed read becomes a rejected report, so nothing is published. */
export const runStrict = Effect.fn('runStrict')(function* () {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.fail(new ReportRejected({ count: 0 }))),
  );

  yield* publishReport(items.length);
});

/** A failed read may be retried as empty, or rejected when strict. */
export const runMaybe = Effect.fn('runMaybe')(function* (strict: boolean) {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () =>
      strict
        ? Effect.fail(new ReportRejected({ count: 0 }))
        : Effect.succeed<ReadonlyArray<string>>([]),
    ),
  );

  yield* publishReport(items.length);
});

/** Writes every item; one failed write rejects the whole run. */
export const runPurge = Effect.fn('runPurge')(function* () {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* Effect.forEach(items, (item) =>
    writeItem(item).pipe(
      Effect.catchTag('StorageError', () => Effect.fail(new ReportRejected({ count: 0 }))),
    ),
  );

  yield* publishReport(items.length);
});

/** A failed read becomes a rejected report, which the next handler forgives. */
export const runRelay = Effect.fn('runRelay')(function* () {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.fail(new ReportRejected({ count: 0 }))),
    Effect.catchTag('ReportRejected', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* publishReport(items.length);
});

/** The same, for each write in a loop. */
export const runRelayAll = Effect.fn('runRelayAll')(function* () {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* Effect.forEach(items, (item) =>
    writeItem(item).pipe(
      Effect.catchTag('StorageError', () => Effect.fail(new ReportRejected({ count: 0 }))),
      Effect.catchTag('ReportRejected', () => Effect.void),
    ),
  );

  yield* publishReport(items.length);
});

/** Each failed write is logged, then rejects the run. */
export const runLoud = Effect.fn('runLoud')(function* () {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* Effect.forEach(items, (item) =>
    writeItem(item).pipe(
      Effect.catchTag('StorageError', () =>
        Effect.logWarning(`write failed: ${item}`).pipe(
          Effect.andThen(Effect.fail(new ReportRejected({ count: 0 }))),
        ),
      ),
    ),
  );

  yield* publishReport(items.length);
});

/** Each failed write is skipped, unless the run is strict. */
export const runChoosy = Effect.fn('runChoosy')(function* (strict: boolean) {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* Effect.forEach(items, (item) =>
    writeItem(item).pipe(
      Effect.catchTag('StorageError', () =>
        strict ? Effect.fail(new ReportRejected({ count: 0 })) : Effect.void,
      ),
    ),
  );

  yield* publishReport(items.length);
});

/** Each failed write is retried as a success, then rejected: no condition says which. */
export const runMuddled = Effect.fn('runMuddled')(function* () {
  const items = yield* readItems().pipe(
    Effect.catchTag('StorageError', () => Effect.succeed<ReadonlyArray<string>>([])),
  );

  yield* Effect.forEach(items, (item) =>
    writeItem(item).pipe(
      Effect.catchTag('StorageError', () =>
        Effect.void.pipe(Effect.andThen(Effect.fail(new ReportRejected({ count: 0 })))),
      ),
    ),
  );

  yield* publishReport(items.length);
});
