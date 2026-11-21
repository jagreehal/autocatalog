import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalog } from './loader.js';
import { createAgentsResourceGraph } from './resource-graph.js';
import {
  discoverSkills,
  AllowedTools,
  pluginDraft,
  refreshSkillEntry,
  skillChanges,
  skillDraft,
} from './skills.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-skills-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const writeText = async (file: string, content: string) => {
  const target = path.join(root, file);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
};

const write = (file: string, content: Parameters<typeof JSON.stringify>[0]) =>
  writeText(file, JSON.stringify(content, null, 2));

const skill = (name: string, extra = '') =>
  `---\nname: ${name}\ndescription: Does ${name}.\n${extra}---\n\nSteps.\n`;

describe('AllowedTools', () => {
  it('reads commas, spaces outside parentheses, and lists', () => {
    expect(AllowedTools.parse('Read, Grep')).toEqual(['Grep', 'Read']);
    expect(AllowedTools.parse('Bash(git add:*) Read')).toEqual(['Bash(git add:*)', 'Read']);
    expect(AllowedTools.parse(['Read', 'Read'])).toEqual(['Read']);
    expect(AllowedTools.parse(undefined)).toEqual([]);
  });
});

describe('discoverSkills', () => {
  it('reads skills, a plugin with what it ships, its marketplace, and the settings that enable it', async () => {
    await writeText(
      '.claude/skills/release/SKILL.md',
      skill('release', 'allowed-tools: Bash(git:*) Read\n'),
    );
    await write('plugins/review/.claude-plugin/plugin.json', {
      name: 'review',
      version: '1.2.0',
      description: 'Code review.',
    });
    await writeText('plugins/review/skills/checklist/SKILL.md', skill('checklist'));
    await writeText('plugins/review/agents/reviewer.md', '---\nname: reviewer\n---\nReview.\n');
    await writeText('plugins/review/commands/review.md', 'Review the diff.\n');
    await write('plugins/review/hooks/hooks.json', {
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'secret.sh' }] }] },
    });
    await write('plugins/review/.mcp.json', {
      mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' } },
    });
    await write('.claude-plugin/marketplace.json', {
      name: 'acme-tools',
      plugins: [
        { name: 'review', source: './plugins/review' },
        { name: 'deploy', source: { source: 'github', repo: 'acme/deploy-plugin' } },
      ],
    });
    await write('.claude/settings.json', {
      enabledPlugins: { 'review@acme-tools': true, 'old@acme-tools': false },
    });
    // One person's settings are never read.
    await write('.claude/settings.local.json', { enabledPlugins: { 'private@x': true } });

    const result = await discoverSkills(root);

    expect(
      result.skills.map(({ id, plugin, allowed_tools }) => ({ id, plugin, allowed_tools })),
    ).toEqual([
      { id: 'release', plugin: undefined, allowed_tools: ['Bash(git:*)', 'Read'] },
      { id: 'review-checklist', plugin: 'review', allowed_tools: [] },
    ]);

    const [deploy, review] = result.plugins;

    expect(deploy).toMatchObject({
      id: 'deploy',
      marketplace: 'acme-tools',
      source: 'github:acme/deploy-plugin',
      enabled_in: [],
    });

    expect(review).toMatchObject({
      id: 'review',
      version: '1.2.0',
      marketplace: 'acme-tools',
      path: 'plugins/review',
      skills: ['review-checklist'],
      agents: ['reviewer'],
      commands: ['review'],
      hooks: ['PreToolUse'],
      servers: ['linear-app'],
      enabled_in: ['.claude/settings.json'],
    });

    expect(review?.source).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('secret.sh');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('joins the graph: the repository defines and uses the plugin, which defines its skills', async () => {
    await write('.claude-plugin/plugin.json', { name: 'review' });
    await writeText('skills/checklist/SKILL.md', skill('checklist'));
    await write('.claude/settings.json', { enabledPlugins: { 'review@local': true } });

    const result = await discoverSkills(root);
    const catalog = path.join(root, 'catalog');

    for (const item of result.skills) {
      await write(`catalog/agent-skills/${item.id}/autocatalog.json`, skillDraft(item));
    }

    for (const item of result.plugins) {
      await write(`catalog/agent-plugins/${item.id}/autocatalog.json`, pluginDraft(item));
    }

    const graph = createAgentsResourceGraph(await loadCatalog(catalog), { repository: 'payments' });

    const edges = graph.relationships.map(
      ({ type, from, to }) => `${from.kind}/${from.id} ${type} ${to.kind}/${to.id}`,
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        'agent-plugin/review defines skill/review-checklist',
        'repository/payments defines agent-plugin/review',
        'repository/payments usesPlugin agent-plugin/review',
      ]),
    );
  });
});

describe('discoverSkills, other instructions and other layouts', () => {
  it('reads slash commands and Cursor rules as skills of their own format', async () => {
    await writeText(
      '.claude/commands/deploy.md',
      '---\ndescription: Deploy.\nallowed-tools: Bash(kubectl:*)\n---\nGo.\n',
    );
    await writeText('.cursor/rules/deploy.mdc', '---\ndescription: How we deploy.\n---\nRule.\n');

    const { skills } = await discoverSkills(root);

    expect(skills.map(({ id, format, allowed_tools }) => ({ id, format, allowed_tools }))).toEqual([
      { id: 'deploy', format: 'command', allowed_tools: ['Bash(kubectl:*)'] },
      { id: 'cursor-deploy', format: 'cursor-rule', allowed_tools: [] },
    ]);
  });

  it('follows manifest paths inside the repository and refuses ones outside it', async () => {
    await write('plugins/review/.claude-plugin/plugin.json', {
      name: 'review',
      skills: '../../shared-skills',
      commands: ['../../../etc'],
    });
    await writeText('shared-skills/lint/SKILL.md', skill('lint'));

    const result = await discoverSkills(root);

    expect(result.skills.map(({ id, plugin }) => ({ id, plugin }))).toEqual([
      { id: 'review-lint', plugin: 'review' },
    ]);
    expect(result.warnings).toEqual([
      'plugins/review/.claude-plugin/plugin.json: "../../../etc" is outside, not read',
    ]);
  });

  it('refuses a link inside the plugin that points outside the repository', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-skills-outside-'));

    await fs.mkdir(path.join(outside, 'agents'));
    await fs.writeFile(
      path.join(outside, 'agents', 'secret-agent.md'),
      '---\nname: secret-agent\n---\n',
    );
    await fs.writeFile(
      path.join(outside, 'hooks.json'),
      JSON.stringify({ hooks: { SecretEvent: [] } }),
    );
    await write('p/.claude-plugin/plugin.json', { name: 'p' });
    await fs.symlink(path.join(outside, 'agents'), path.join(root, 'p', 'agents'));
    await fs.mkdir(path.join(root, 'p', 'hooks'));
    await fs.symlink(path.join(outside, 'hooks.json'), path.join(root, 'p', 'hooks', 'hooks.json'));

    const result = await discoverSkills(root);

    expect(result.plugins[0]).toMatchObject({ agents: [], hooks: [] });
    expect(result.warnings).toEqual([
      'p/.claude-plugin/plugin.json: "agents" is outside, not read',
      'p/.claude-plugin/plugin.json: hooks file "hooks/hooks.json" is outside, not read',
    ]);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('reads a folder of checkouts, one repository per folder', async () => {
    await writeText('payments/.claude/skills/release/SKILL.md', skill('release'));
    await writeText('orders/.claude/skills/release/SKILL.md', skill('release'));
    await write('tools/.claude-plugin/plugin.json', { name: 'review' });
    await write('payments/.claude/settings.json', { enabledPlugins: { 'review@acme': true } });
    await write('orders/.claude/settings.json', { enabledPlugins: { 'review@acme': true } });

    const result = await discoverSkills(root, { perRepository: true });

    expect(result.skills.map(({ id, repository }) => ({ id, repository }))).toEqual([
      { id: 'orders-release', repository: 'orders' },
      { id: 'payments-release', repository: 'payments' },
    ]);
    expect(result.plugins[0]).toMatchObject({
      id: 'tools-review',
      repository: 'tools',
      used_by: ['orders', 'payments'],
    });
  });

  it("keeps two repositories' plugins of one name apart, with their skills", async () => {
    for (const repository of ['orders', 'payments']) {
      await write(`${repository}/plugins/tools/.claude-plugin/plugin.json`, { name: 'tools' });
      await writeText(`${repository}/plugins/tools/skills/review/SKILL.md`, skill('review'));
    }

    const result = await discoverSkills(root, { perRepository: true });

    expect(result.warnings).toEqual([]);
    expect(result.plugins.map(({ id, repository, path: at }) => ({ id, repository, at }))).toEqual([
      { id: 'orders-tools', repository: 'orders', at: 'orders/plugins/tools' },
      { id: 'payments-tools', repository: 'payments', at: 'payments/plugins/tools' },
    ]);
    expect(result.skills.map(({ id }) => id)).toEqual([
      'orders-tools-review',
      'payments-tools-review',
    ]);
  });

  it("keeps two repositories' skills of one name apart once composed", async () => {
    const graph = async (repository: string) => {
      const catalog = path.join(root, repository);

      await write(
        `${repository}/agent-skills/release/autocatalog.json`,
        skillDraft({
          id: 'release',
          name: 'release',
          format: 'skill',
          allowed_tools: [],
          sources: [],
        }),
      );

      return createAgentsResourceGraph(await loadCatalog(catalog), { repository });
    };

    const refs = [
      ...(await graph('payments')).resources,
      ...(await graph('orders')).resources,
    ].flatMap(({ ref }) => (ref.kind === 'skill' ? [`${ref.namespace}/${ref.id}`] : []));

    expect(refs).toEqual(['payments/release', 'orders/release']);
  });
});

describe('skill changes', () => {
  it('keeps what a person decided and flags new grants for review', () => {
    const before = {
      ...skillDraft({
        id: 'release',
        name: 'release',
        format: 'skill',
        allowed_tools: ['Read'],
        sources: [{ file: 'SKILL.md', line: 1 }],
      }),
      owner: 'platform',
    };

    const draft = skillDraft({
      id: 'release',
      name: 'release',
      format: 'skill',
      allowed_tools: ['Bash(*)', 'Read'],
      sources: [{ file: 'SKILL.md', line: 1 }],
    });

    const next = refreshSkillEntry('skill', before, draft);

    expect(next.owner).toBe('platform');
    expect(next.allowed_tools).toEqual(['Bash(*)', 'Read']);
    expect(skillChanges('skill', 'release', before, next)).toEqual([
      { severity: 'review', ref: 'skill/release', message: 'allowed_tools gained Bash(*)' },
    ]);
    expect(skillChanges('skill', 'release', next, next)).toEqual([]);
    expect(skillChanges('agent-plugin', 'x', undefined, { hooks: ['Stop'] })[0]?.severity).toBe(
      'review',
    );
  });
});
