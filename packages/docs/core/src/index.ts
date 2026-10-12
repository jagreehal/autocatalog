export {
  type Doc,
  docToMarkdown,
  type DocsLayout,
  readDocs,
  type ReadDocsOptions,
  resolveDocsLayout,
} from './read-docs';

export {
  declaredFrontmatterFields,
  DEFAULT_FRONTMATTER_SCHEMA,
  DOCS_SCHEMA_PATH,
  type Frontmatter,
  frontmatterSchema,
  type FrontmatterContract,
  type FrontmatterIssue,
  type FrontmatterValidator,
  frontmatterValidator,
  resolveFrontmatterContract,
} from './frontmatter';

export { headCommit, lastChanged, sourceUrl, webUrl } from './git';

export {
  type BuildDocsManifestOptions,
  buildDocsManifest,
  type DocsManifest,
  type DocsManifestEntry,
  DocsManifestError,
  DOCS_MANIFEST_PATH,
} from './manifest';

export { type CheckDocsOptions, type CheckDocsResult, checkDocs } from './check';

export {
  describeContractChanges,
  type SyncContractOptions,
  type SyncContractResult,
  type SyncContractStatus,
  syncFrontmatterContract,
} from './sync';

export {
  createDocsResourceGraph,
  type CreateDocsResourceGraphOptions,
  DocsResourceGraphError,
} from './resource-graph';

export {
  aboutReference,
  type AboutResolution,
  createDescribesRelationships,
  type DescribesRelationships,
  resolveAbout,
} from './about';
