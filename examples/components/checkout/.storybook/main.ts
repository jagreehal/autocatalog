import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  // Writes manifests/components.json, which `ac from-storybook` reads.
  features: { componentsManifest: true },
};

export default config;
