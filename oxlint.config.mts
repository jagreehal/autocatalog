import autoAntiSlop from 'auto-anti-slop';
import { defineConfig } from 'oxlint';

export default defineConfig({
  ...autoAntiSlop,
  ignorePatterns: [
    ...autoAntiSlop.ignorePatterns,
    // Copied from upstream and kept byte-identical, so never linted here.
    'packages/docs/astro/src/ui/vendor/**',
    // shadcn's own components, owned by its registry.
    'packages/docs/astro/src/ui/components/ui/**',
    'packages/docs/chatbot/src/ui/components/ui/**',
    // Local agent and editor state.
    '**/.agent/**',
    '**/.agents/**',
    '**/.claude/**',
    '**/.codex/**',
    '**/.continue/**',
    '**/.cursor/**',
    '**/.gemini/**',
    '**/.opencode/**',
    '**/.pi/**',
    '**/.roo/**',
    '**/.windsurf/**',
  ],
  jsPlugins: [...autoAntiSlop.jsPlugins, '@shadcn/lint'],
  rules: {
    ...autoAntiSlop.rules,
    'eslint/preserve-caught-error': 'error',
  },
  overrides: [
    ...autoAntiSlop.overrides,
    {
      files: [
        'packages/docs/astro/src/ui/**',
        'packages/docs/chatbot/src/react/**',
        'apps/docs/src/**/*.tsx',
      ],
      rules: {
        'shadcn/no-restyle': ['error', { allow: ['layout'] }],
        'shadcn/no-raw-colors': 'error',
        'shadcn/no-arbitrary-values': 'error',
        'shadcn/no-inline-styles': 'error',
        'shadcn/no-unknown-classes': [
          'error',
          { allow: ['not-content', 'sl-markdown-content', 'mermaid'] },
        ],
        'shadcn/require-static-classes': 'error',
      },
    },
  ],
  settings: {
    shadcn: { note: 'See DESIGN.md for the design rules.' },
  },
});
