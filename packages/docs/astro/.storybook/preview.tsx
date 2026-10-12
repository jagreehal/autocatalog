import type { Preview } from '@storybook/react-vite';
// Starlight's own base: fonts, sizes and colours the theme builds on. Its
// exports map hides these files, so they are reached by path.
import '../node_modules/@astrojs/starlight/dist/style/layers.css';
import '../node_modules/@astrojs/starlight/dist/style/props.css';
import '../node_modules/@astrojs/starlight/dist/style/reset.css';
import '../node_modules/@astrojs/starlight/dist/style/markdown.css';
import '../src/styles/index.css';

const preview: Preview = {
  // Both themes are first-class, so every story can be checked in each.
  globalTypes: {
    theme: {
      description: 'Light or dark theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'dark' },
  parameters: {
    layout: 'padded',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  decorators: [
    (Story, context) => {
      // The theme's tokens resolve on <html>, as Starlight marks it there.
      document.documentElement.dataset.theme = context.globals.theme === 'light' ? 'light' : 'dark';

      return (
        <div
          className="sl-markdown-content"
          style={{
            color: 'var(--ac-text)',
            background: 'var(--ac-bg)',
            minHeight: '100vh',
            padding: '1.5rem',
          }}
        >
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
