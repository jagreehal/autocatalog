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
  type PublishedFile,
  resolvePublishedFile,
} from './frontmatter';

export {
  DEFAULT_DOC_KINDS,
  defaultConventionsFile,
  type DocKind,
  docKind,
  type DocKindResolution,
  docKinds,
  DOCS_CONVENTIONS_PATH,
  type DocsConventions,
  docsConventionsSchema,
  type KindCheck,
  kindContract,
  kindFailure,
  kindValidator,
  type ResolvedDocKinds,
  resolveDocKinds,
  SUPERSEDE_FIELDS,
  type Supersession,
  supersession,
  textField,
} from './kinds';

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

export {
  type Flow,
  type FlowGroupBy,
  FLOWS_DIR,
  type FlowStep,
  type FlowStepKind,
  flowStepRuns,
  flowWorkflow,
  readFlows,
  type ReadFlowsOptions,
  type ReadFlowsResult,
  type StepLane,
  type WorkflowRuns,
} from './flows';

export {
  catalogDiagram,
  type CatalogDiagramOptions,
  type Diagram,
  type DiagramEdge,
  type DiagramEdgeType,
  type DiagramNode,
  type DiagramNodeMetadata,
  type DiagramNodeType,
  DIAGRAM_NODE_TYPES,
  domainNeighbourhood,
  edgeEvidence,
  type EdgeEvidence,
  type EventRuntime,
  flowDiagram,
  type FlowStepData,
  runtimeByEvent,
  serviceNeighbourhood,
  type StepLanes,
} from './diagram';

export {
  type Design,
  designChanges,
  designDiagram,
  type DesignRelation,
  type DesignInput,
  type DesignResource,
  designSchema,
  DESIGNS_DIR,
  type DesignState,
  type DesignStatus,
  readDesigns,
  type ReadDesignsResult,
  resolveDesign,
} from './designs';

export {
  type Authored,
  dataProductDiagram,
  type DataProduct,
  type DataProductPort,
  type DomainModel,
  type Entity,
  entityDiagram,
  entityReferences,
  type EntityProperty,
  type Glossary,
  lookupTerm,
  MODEL_DIRS,
  type Person,
  portName,
  readDomainModel,
  type ReadDomainModelOptions,
  type ReadDomainModelResult,
  type Term,
} from './model';
