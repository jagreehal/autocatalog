// Re-export the docs collection: Starlight's own `docs` collection, loaded from
// every enrolled repository instead of src/content/docs.
// AUTOCATALOG_DOCS_ROOT is set by the autocatalogDocs() plugin in config:setup,
// which fires before this file's loader runs.
export { collections } from 'autocatalog-docs-astro/content.config';
