// The events `ac site` dev's server sends its pages (routes.ts), so `import.meta.hot.on` types them.
import 'vite/types/customEvent.d.ts';

declare module 'vite/types/customEvent.d.ts' {
  interface CustomEventMap {
    /** A design file changed on disk; `by` is the editor tab whose save it is, when it is one. */
    'autocatalog:design-changed': { file: string; by?: string };
  }
}
