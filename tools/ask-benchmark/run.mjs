// Scores `ask` against questions with known answers. Nothing judges with a model:
// every result comes from string checks, so a score cannot flatter itself.
//
//   node run.mjs --tier retrieval                  no model, free, fit for CI
//   node run.mjs --tier agent --model beam-free    a real model through MCP
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioTransport } from '@ai-sdk/mcp/mcp-stdio';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs } from 'ai';

const here = path.dirname(fileURLToPath(import.meta.url));

const repos = path.resolve(here, '../../examples/docs-demo/repos');

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);

  return at === -1 ? fallback : process.argv[at + 1];
};

const tier = flag('tier', 'retrieval');

const modelId = flag('model', 'beam-free');

const label = flag('label', 'latest');

const only = flag('set', undefined);

const limit = Number(flag('limit', '0'));

const server = path.resolve(
  flag('server', path.join(here, '../../packages/events/mcp/dist/index.js')),
);

const { questions: all } = JSON.parse(fs.readFileSync(path.join(here, 'questions.json'), 'utf8'));

const chosen = only ? all.filter((question) => question.set === only) : all;

const questions = limit ? chosen.slice(0, limit) : chosen;

const connect = () =>
  createMCPClient({
    transport: new StdioTransport({
      command: 'node',
      args: [server, '--root', path.join(repos, 'payments-service'), '--company', repos],
      stderr: 'ignore',
    }),
  });

const textOf = (result) => result.content?.[0]?.text ?? '';

async function retrieval(client, tools, question) {
  const output = await tools.ask.execute(
    { question: question.q, limit: 3 },
    { messages: [], toolCallId: question.id },
  );

  const { answered, results } = JSON.parse(textOf(output));

  if (question.abstain) return { outcome: answered ? 'made-up' : 'correct' };

  if (!answered) return { outcome: 'missed' };

  return {
    outcome: results.some((result) => result.source.includes(question.source))
      ? 'correct'
      : 'wrong',
    found: results.map((result) => result.source),
  };
}

const SYSTEM = `You answer staff questions about a company. Use the tools. Answer only from what they return, never from general knowledge. If a tool result is marked as a draft or hypothesis, say so. Retry with other words before giving up.

End with exactly one final line:
SOURCE: <the source path you relied on>
or, if the tools do not contain the answer:
NOT FOUND`;

function score(question, text) {
  const lower = text.toLowerCase();
  const notFound = /not found/i.test(text.trim().split('\n').at(-1) ?? '');
  const source = /source:\s*(.+)\s*$/i.exec(text.trim())?.[1] ?? '';

  if (!text.trim()) return 'no-answer';

  if (question.abstain) return notFound ? 'correct' : 'made-up';

  if (notFound) return 'missed';

  const right = question.answer.some((answer) => lower.includes(answer.toLowerCase()));
  const cited = source.includes(question.source);
  const flagged = !question.mustFlag || question.mustFlag.some((word) => lower.includes(word));

  if (right && cited && flagged) return 'correct';

  return right && flagged ? 'uncited' : right ? 'unflagged' : 'wrong';
}

// The Go API wants one session id per conversation, so each question gets its own.
const modelFor = () =>
  createOpenAICompatible({
    name: 'opencode-go',
    baseURL: 'https://opencode.ai/inference/go/openai/v1',
    apiKey: process.env.OPENCODE_API_KEY,
    headers: { 'x-opencode-session': crypto.randomUUID() },
  })(modelId);

const STEPS = 6;

async function agent(tools, question) {
  const { text, steps } = await generateText({
    model: modelFor(),
    tools,
    system: SYSTEM,
    prompt: question.q,
    temperature: 0,
    maxRetries: 4,
    stopWhen: stepCountIs(STEPS),
    // A real assistant has to answer eventually: the last step cannot call a tool.
    prepareStep: ({ stepNumber, messages }) =>
      stepNumber === STEPS - 1
        ? {
            toolChoice: 'none',
            messages: [
              ...messages,
              { role: 'user', content: 'Stop searching. Give your final answer now.' },
            ],
          }
        : {},
  });

  return {
    outcome: score(question, text),
    calls: steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
    text,
  };
}

const client = await connect();

const tools = await client.tools();

const rows = [];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A free tier limits requests. Waiting keeps a limit from being scored as a failure.
async function patiently(work, tries = 12) {
  try {
    return await work();
  } catch (error) {
    if (tries === 0 || !/rate limit/i.test(String(error))) throw error;

    await pause(150_000);

    return patiently(work, tries - 1);
  }
}

for (const question of questions) {
  try {
    const result =
      tier === 'agent'
        ? await patiently(() => agent(tools, question))
        : await retrieval(client, tools, question);

    rows.push({ id: question.id, set: question.set, abstain: !!question.abstain, ...result });
  } catch (error) {
    rows.push({ id: question.id, set: question.set, outcome: 'error', error: String(error) });
  }

  const last = rows.at(-1);

  console.log(`${last.outcome.padEnd(10)} ${last.set.padEnd(8)} ${last.id}`);
}

await client.close();

const summarise = (subset) => {
  const count = (outcome) => subset.filter((row) => row.outcome === outcome).length;
  const scored = subset.filter((row) => row.outcome !== 'error').length;

  return {
    correct: `${count('correct')}/${scored}`,
    missed: count('missed'),
    wrong: count('wrong'),
    uncited: count('uncited'),
    unflagged: count('unflagged'),
    madeUp: count('made-up'),
    noAnswer: count('no-answer'),
    errors: subset.length - scored,
  };
};

const summary = {
  tier,
  ...(tier === 'agent' && { model: modelId }),
  all: summarise(rows),
  dev: summarise(rows.filter((row) => row.set === 'dev')),
  holdout: summarise(rows.filter((row) => row.set === 'holdout')),
};

fs.mkdirSync(path.join(here, 'results'), { recursive: true });

fs.writeFileSync(
  path.join(here, 'results', `${label}-${tier}.json`),
  `${JSON.stringify({ summary, rows }, null, 2)}\n`,
);

console.log(JSON.stringify(summary, null, 2));
