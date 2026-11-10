import { getViteConfig } from 'astro/config';
import { defaultChatPanel } from './src/chat-panel.ts';

export default getViteConfig({
  plugins: [defaultChatPanel()],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
