import type { StorybookConfig } from '@storybook/react-vite';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { microlighterGrammars } from '../src/index';
import { cjsShimAliases } from '../src/react-integration';

const config: StorybookConfig = {
  stories: ['../src/ui/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    const shims = cjsShimAliases();

    return mergeConfig(config, {
      plugins: [tailwindcss()],
      // microlighter loads each grammar with import(`./grammars/${name}.js`),
      // which pre-bundling would break.
      optimizeDeps: { exclude: ['microlighter'] },
      build: { dynamicImportVarsOptions: microlighterGrammars },
      define: {
        'import.meta.env.BASE_URL': JSON.stringify('/'),
      },
      resolve: {
        alias: [
          { find: '@ui', replacement: fileURLToPath(new URL('../src/ui', import.meta.url)) },
          ...shims,
        ],
      },
    });
  },
};

export default config;
