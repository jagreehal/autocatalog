import { getViteConfig } from 'astro/config';
import { defaultChatPanel } from './src/chat-panel.ts';

export default getViteConfig({
  plugins: [defaultChatPanel()],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Rendering React Aria tables takes under a second alone and several on a
    // busy CI runner beside the example sites' builds.
    testTimeout: 20_000,
  },
});
