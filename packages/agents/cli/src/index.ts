#!/usr/bin/env node
import { CatalogNotFoundError } from 'autocatalog-agents-core';
import { runValidate } from './commands/validate.js';
import { runImpact } from './commands/impact.js';
import { runMcp } from './commands/mcp.js';
import { runLlmsTxt } from './commands/llmstxt.js';
import { runCost } from './commands/cost.js';
import { runAudit } from './commands/audit.js';
import { runDrift } from './commands/drift.js';
import { runSearch } from './commands/search.js';
import { runDiscover } from './commands/discover.js';

const HELP = `ac agents — autocatalog agent catalog commands

Usage:
  ac agents validate <root> [--events <dir>]      Validate a catalog directory, and its event references
  ac agents impact <kind>/<id> [--root <path>]    Show what an entity depends on and what depends on it
  ac agents impact event/<domain>/<id> [--root <path>] [--events <dir>]
                                           Which agents and tools produce or consume an event
  ac agents mcp [--root <path>]                   Start the stdio MCP server
  ac agents llmstxt [--root <path>] [-o <file>]   Emit llms.txt for the catalog (stdout or file)
  ac agents cost [<agent>] [--by-domain|--by-owner|--by-model]
                                           Cost estimate for one agent, or rollup
  ac agents audit [--root <path>] [--json] [--fail-on P0|P1|P2]
                                           Run the audit ruleset, exit nonzero if findings cross threshold
  ac agents drift <otlp-file> [--root <path>] [--json]
                                           Diff observed agent behaviour (OTLP JSON) against the declared catalog
  ac agents search <query> [--root <path>] [--json]
                                           Substring search across every entity's id, name, description, owner
  ac agents discover --from pydantic-ai|ai-sdk <source-dir> [--root <catalog>] [--dry-run]
                                           Infer draft catalog entries from framework source code
  ac agents --help                         Show this message

Examples:
  ac agents validate starters/agent-default
  ac agents impact agent/refund-agent --root starters/agent-default
  ac agents impact event/payments/refund.issued --root starters/agent-default
  ac agents mcp --root starters/agent-default
  ac agents llmstxt --root starters/agent-default -o starters/agent-default/llms.txt
  ac agents cost agent/refund-agent --root starters/agent-default
  ac agents cost --by-domain --root starters/agent-default
  ac agents discover --from ai-sdk ./app --root ./catalog --dry-run
`;

/**
 * The agent commands, callable with an argv slice.
 *
 * Exported so `ac agents …` runs exactly this code rather than a second copy
 * of the dispatch, and so one binary can front the whole product.
 */
export const runAgentsCli = async (argv: string[]): Promise<number> => {
  try {
    return await dispatch(argv);
  } catch (error) {
    if (error instanceof CatalogNotFoundError) {
      process.stderr.write(`${error.message}\n`);

      return 2;
    }

    throw error;
  }
};

const dispatch = async (argv: string[]): Promise<number> => {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);

    return 0;
  }

  switch (cmd) {
    case 'validate':
      return runValidate(rest);
    case 'impact':
      return runImpact(rest);
    case 'mcp':
      return runMcp(rest);
    case 'llmstxt':
      return runLlmsTxt(rest);
    case 'cost':
      return runCost(rest);
    case 'audit':
      return runAudit(rest);
    case 'drift':
      return runDrift(rest);
    case 'search':
      return runSearch(rest);
    case 'discover':
      return runDiscover(rest);
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);

      return 2;
  }
};
