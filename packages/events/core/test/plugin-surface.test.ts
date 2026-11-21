import { describe, expect, it } from 'vitest';
import * as plugin from '../src/plugin';

describe('autocatalog-core/plugin', () => {
  it('exports exactly the runtime names plugins build on', () => {
    expect(Object.keys(plugin).sort()).toEqual([
      'enrichEvent',
      'eventFrontmatter',
      'isJsonObject',
      'jsonObjectSchema',
      'jsonValueSchema',
      'loadCodeowners',
      'modelExports',
      'pascalCase',
      'publishCatalog',
      'readOptionalResourceJson',
      'scanModelResources',
      'writeComponents',
      'writeEventFolder',
      'writeGatewayFile',
      'writeNetworkFile',
    ]);
  });
});
