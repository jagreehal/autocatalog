import { defineCollection } from 'astro:content';
import { i18nLoader } from '@astrojs/starlight/loaders';
import { i18nSchema } from '@astrojs/starlight/schema';
import { collections as docs } from 'autocatalog-docs-astro/content.config';

// The plugin's docs collection, plus Starlight's UI strings. The empty English
// file keeps Starlight's defaults and gives a site somewhere to override them.
export const collections = {
  ...docs,
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
