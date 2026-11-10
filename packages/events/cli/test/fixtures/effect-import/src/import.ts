import { Context, Data, Effect } from 'effect';

export class ImportNotFound extends Data.TaggedError('ImportNotFound')<{ importId: string }> {}

export class SupplierNotFound extends Data.TaggedError('SupplierNotFound')<{
  supplierId: string;
}> {}

export class FileMissing extends Data.TaggedError('FileMissing')<{ key: string }> {}

export class FileUnreadable extends Data.TaggedError('FileUnreadable')<{ reason: string }> {}

export class OutsideSalesRegion extends Data.TaggedError('OutsideSalesRegion')<{ sku: string }> {}

export class ProductIngestFailed extends Data.TaggedError('ProductIngestFailed')<{
  sku: string;
  reason: string;
}> {}

export interface Import {
  id: string;
  supplierId: string;
  fileKey: string;
  region?: string;
  email: string;
}

export interface Product {
  sku: string;
  title: string;
  region: string;
}

export class Imports extends Context.Service<
  Imports,
  {
    readonly find: (importId: string) => Effect.Effect<Import, ImportNotFound>;
    readonly finish: (importId: string, errors: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()('Imports') {}

export class Suppliers extends Context.Service<
  Suppliers,
  { readonly find: (supplierId: string) => Effect.Effect<string, SupplierNotFound> }
>()('Suppliers') {}

export class ObjectStorage extends Context.Service<
  ObjectStorage,
  { readonly get: (key: string) => Effect.Effect<string, FileMissing> }
>()('ObjectStorage') {}

export class FeedParser extends Context.Service<
  FeedParser,
  { readonly parse: (file: string) => Effect.Effect<ReadonlyArray<Product>, FileUnreadable> }
>()('FeedParser') {}

export class Products extends Context.Service<
  Products,
  { readonly save: (product: Product) => Effect.Effect<void, ProductIngestFailed> }
>()('Products') {}

export class Notifications extends Context.Service<
  Notifications,
  { readonly send: (email: string, message: string) => Effect.Effect<void> }
>()('Notifications') {}

export const loadImport = Effect.fn('loadImport')(function* (importId: string) {
  const imports = yield* Imports;

  return yield* imports.find(importId);
});

export const resolveSupplier = Effect.fn('resolveSupplier')(function* (supplierId: string) {
  const suppliers = yield* Suppliers;

  return yield* suppliers.find(supplierId);
});

export const downloadFile = Effect.fn('downloadFile')(function* (key: string) {
  const storage = yield* ObjectStorage;

  return yield* storage.get(key);
});

export const parseFile = Effect.fn('parseFile')(function* (file: string) {
  const parser = yield* FeedParser;

  return yield* parser.parse(file);
});

export const checkRegion = (job: Import, product: Product) =>
  job.region === undefined || job.region === product.region
    ? Effect.void
    : Effect.fail(new OutsideSalesRegion({ sku: product.sku }));

export const ingestProduct = Effect.fn('ingestProduct')(function* (job: Import, product: Product) {
  yield* checkRegion(job, product);

  const products = yield* Products;

  yield* products.save(product);
});

export const finishImport = Effect.fn('finishImport')(function* (
  job: Import,
  errors: ReadonlyArray<string>,
) {
  const imports = yield* Imports;
  const notifications = yield* Notifications;

  yield* imports.finish(job.id, errors);
  yield* notifications.send(job.email, errors.length === 0 ? 'completed' : 'partially completed');
});

/** A supplier's catalogue file, into products. */
export const runImport = Effect.fn('runImport')(function* (importId: string) {
  const job = yield* loadImport(importId);

  yield* resolveSupplier(job.supplierId);

  const file = yield* downloadFile(job.fileKey);
  const parsed = yield* parseFile(file);

  const errors = yield* Effect.forEach(parsed, (product) =>
    ingestProduct(job, product).pipe(
      Effect.as(undefined),
      Effect.catchTags({
        ProductIngestFailed: (error) => Effect.succeed(`${error.sku}: ${error.reason}`),
        OutsideSalesRegion: (error) => Effect.succeed(`${error.sku}: outside the sales region`),
      }),
    ),
  );

  yield* finishImport(
    job,
    errors.filter((error) => error !== undefined),
  );
});
