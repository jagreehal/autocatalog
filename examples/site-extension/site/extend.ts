// Everything this site adds to the one `ac site` builds.
import { shout } from './shout.ts';

export default {
  name: 'example',
  middleware: './middleware.ts',
  routeMiddleware: './route-data.ts',
  components: { Footer: './Footer.astro' },
  rehypePlugins: [shout],
};
