// What this site adds to the one `ac site` builds: signing in, and the
// account switcher.
export default {
  name: 'help-centre',
  middleware: './middleware.ts',
  // Starlight's slot for header icons holds the account switcher.
  components: { SocialIcons: './ReaderSwitcher.astro' },
};
