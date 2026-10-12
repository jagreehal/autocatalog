import type { DiscoveryAdapter } from './merge-discoveries';
import { avroDiscoveryAdapter } from './scan-avro';
import { jsonSchemaDiscoveryAdapter } from './scan-json-schema';
import { openApiDiscoveryAdapter } from './scan-openapi';
import { messageContractDiscoveryAdapter } from './scan-message-contract';
import { protobufDiscoveryAdapter } from './scan-protobuf';

/**
 * The Adapters that need no installation and execute no repository code.
 *
 * One list, because `ac scan` and `ac drift` must see the same events. If drift
 * scanned with fewer Adapters than scan, every event only the missing Adapter
 * finds would read as removed on one side and added on the other.
 */
export const builtInDiscoveryAdapters: DiscoveryAdapter[] = [
  jsonSchemaDiscoveryAdapter,
  openApiDiscoveryAdapter,
  avroDiscoveryAdapter,
  protobufDiscoveryAdapter,
  messageContractDiscoveryAdapter,
];
