export const AUTOCATALOG_SPEC_VERSION = 'autocatalog/v2' as const;

export {
  AUTOCATALOG_EVENT_FILE,
  CLASSIFICATION_VALUES,
  PROVENANCE_VALUES,
  durationSeconds,
  eventFrontmatter,
  type Classification,
  type EventFrontmatter,
  type ProvenanceValue,
} from './schema';

export { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './frontmatter';

export { discoverEventFolders, type DiscoveredEventFolder } from './discover';

export {
  loadEventFolder,
  loadCatalog,
  loadCatalogSnapshot,
  CatalogLoadError,
  type LoadedEvent,
  type LoadedExample,
  EXAMPLE_CASES,
  EXAMPLE_CASE_MEANING,
  exampleCaseSummary,
  exampleCaseOf,
  isExamplePayload,
  type ExampleCase,
  type CatalogSnapshot,
  type CatalogDiagnostic,
  type CatalogDiagnosticCode,
  type LoadCatalogOptions,
} from './load';

export {
  EVENT_MANIFEST_CONTRACT_PATH,
  validateCatalog,
  type ValidateCatalogOptions,
  type ValidationError,
  type ValidationResult,
  type ValidationCode,
  type ValidationWarning,
  type ValidationWarningCode,
} from './validate';

export {
  diffSchemas,
  typeLabel,
  type DiffResult,
  type DiffKind,
  type SchemaNode,
  type SchemaValue,
} from './diff';

export { derefLocal, rewriteObjectRefs, rewriteRefs } from './json-ref';

export {
  discoverOpenApi,
  findOpenApiDocuments,
  openApiDiscoveryAdapter,
  eventsFromOpenApiDocument,
  looksLikeOpenApi,
  METHODS,
  idFromOperationName,
  type ScanOpenApiOptions,
  type OpenApiScanFinding,
} from './scan-openapi';

export {
  indexFields,
  searchFields,
  queryFields,
  hasFieldConflict,
  describeFieldConflict,
  type FieldSummary,
  type FieldOccurrence,
} from './fields';

export {
  assessEventChange,
  summariseDrift,
  driftCatalogs,
  driftEventLabel,
  renderDriftMarkdown,
  renderDriftGitHub,
  renderVersionChangelog,
  compareSemverish,
  compatibilityBreaks,
  compatibilityViolations,
  type CompatibilityMode,
  type DriftFinding,
  type DriftReport,
  type DriftSeverity,
} from './drift';

export { driftOpenApi } from './openapi-drift';

export { readCatalogFreshness, type CatalogFreshness } from './catalog-artifact';

export {
  readSnapshot,
  applySnapshot,
  SNAPSHOT_SPEC_PREFIX,
  type ArchitectureSnapshot,
  type SnapshotObservation,
  type SnapshotMergeResult,
} from './snapshot';

export { toLlmInput, catalogSnapshotToLlmText } from './projection';

export { generateSnippets, type Snippets, type SnippetInput } from './snippets';

export { eventToLlmText, catalogToLlmText, type LlmEventInput } from './llm';

export { assertPathSegment, closestMatch, isRealFileInside, pascalCase } from './utils';

export {
  jsonValueSchema,
  jsonObjectSchema,
  isJsonObject,
  type JsonPrimitive,
  type JsonValue,
  type JsonObject,
} from './json';

export { generateExampleFromSchema } from './example-gen';

export { parseCodeowners, ownerForPath, type CodeownersRule } from './codeowners';

export { scoreEvent, type HealthScore, type HealthCheck } from './health';

export { correlationPath } from './correlation';

export {
  type AdapterEvent,
  type AdapterEventMeta,
  type AdapterEventDeprecation,
  type SourceLocation,
  eventConfidenceScore,
  provenanceRank,
  loadedEventToAdapterEvent,
  readVendorMeta,
} from './adapter-event';

// ProvenanceValue already exported from ./schema
export {
  writeEventFolder,
  adapterEventToFrontmatter,
  type WriteEventFolderOptions,
} from './write-event-folder';

export {
  publishCatalog,
  type PublishCatalogOptions,
  type PublishCatalogResult,
} from './publish-catalog';

export {
  AUTOCATALOG_ARTIFACT_FILE,
  AUTOCATALOG_ARTIFACT_SPEC,
  verifyCatalogArtifact,
  type ArtifactRepository,
  type CatalogArtifact,
  type CatalogArtifactEntry,
  type ArtifactIntegrityDiagnostic,
} from './catalog-artifact';

export {
  CatalogPublicationLockedError,
  catalogPublicationLockPath,
  type HeldCatalogLock,
} from './catalog-lock';

export {
  enrichEvent,
  generateMissingExample,
  inferOwnership,
  loadCodeowners,
  provenanceSummary,
  type ProvenanceSummary,
} from './enrich-event';

export {
  mergeDiscoveries,
  validateDiscoveryResult,
  DiscoveryAdapterContractError,
  type DiscoverResult,
  type DiscoveryOutput,
  type DiscoveryAdapter,
  type DiscoveryCandidate,
  type DiscoveryContext,
  type DiscoveryLimits,
  type DiscoveryConflict,
  type MergeDiscoveriesResult,
  type ScanFindingBase,
} from './merge-discoveries';

export {
  discoverJsonSchemas,
  jsonSchemaDiscoveryAdapter,
  looksLikeJsonSchema,
  idFromFilename,
  idFromSchemaId,
  domainForJsonPath,
  type ScanJsonSchemaOptions,
  type JsonSchemaScanFinding,
} from './scan-json-schema';

export { scanCatalog, type ScanCatalogOptions, type ScanCatalogResult } from './scan-catalog';

export { builtInDiscoveryAdapters } from './built-in-adapters';

export {
  discoverAvro,
  avroDiscoveryAdapter,
  eventFromAvroSchema,
  looksLikeAvroSchema,
  idFromAvroName,
  avroDomain,
  type ScanAvroOptions,
  type AvroScanFinding,
} from './scan-avro';

export {
  discoverProtobuf,
  protobufDiscoveryAdapter,
  eventsFromProtoRoot,
  messageToJsonSchema,
  rpcTypeNames,
  metaFromOptions,
  idFromMessageName,
  type ScanProtobufOptions,
  type ProtobufScanFinding,
} from './scan-protobuf';

export {
  AUTOCATALOG_GRAPH_SPEC,
  composeResourceGraphs,
  createEventResourceGraph,
  createRepositoryResource,
  createResourceGraphComposer,
  isAgentSystemCatalogResource,
  isDocumentCatalogResource,
  isEventCatalogResource,
  isRepositoryCatalogResource,
  isServiceCatalogResource,
  relationshipKey,
  ResourceGraphConflictError,
  resourceKey,
  summarizeResourceGraph,
  type CatalogRelationship,
  type CatalogRelationshipType,
  type CatalogResource,
  type AgentSystemCatalogResource,
  type AgentSystemResourceAttributes,
  type AgentSystemResourceKind,
  type CreateEventResourceGraphOptions,
  type DocumentCatalogResource,
  type DocumentResourceAttributes,
  type EventCatalogResource,
  type EventResourceAttributes,
  type ResourceEvidence,
  type ResourceGraph,
  type ResourceGraphComposer,
  type ResourceGraphSummary,
  type ResourceRef,
  type RepositoryCatalogResource,
  type RepositoryResourceAttributes,
  type ServiceCatalogResource,
  type ServiceResourceAttributes,
  type TypedCatalogResource,
} from './resource-graph';

export {
  createCatalogProjection,
  buildGraph,
  buildServices,
  type CatalogProjection,
  type CatalogSearchRecord,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type ServiceSummary,
} from './projection';

export { readContractFile, type ContractFileResult } from './contract-file';

export {
  loadRepositoryEvents,
  isSingleRepository,
  publishesCatalogContent,
  RUNTIME_SNAPSHOT,
  type LoadRepositoryEventsOptions,
} from './repository-events';

export { eventRuntimeEvidence, type EventRuntimeEvidence } from './runtime-evidence';

export * from './architecture';

export * from './resource-store';

export { ResourceReadError, readOptionalResourceJson } from './resource-files';

export * from './model-resources';

export * from './command-resources';

export * from './resource-drift';

export * from './ownership-sources';

export * from './schema-registries';

export * from './cloudevents';

export * from './scan-architecture';

export * from './consumes';
