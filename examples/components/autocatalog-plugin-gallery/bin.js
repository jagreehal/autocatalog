#!/usr/bin/env node
// `ac from-gallery [--check]`: gallery.json into autocatalog.components.json.
import fs from 'node:fs/promises';
import { writeComponents } from 'autocatalog-core';

const gallery = JSON.parse(await fs.readFile('gallery.json', 'utf8'));

const components = gallery.items.map((item) => ({
  id: item.slug,
  name: item.name,
  description: item.summary,
  props: [],
  stories: item.screens.map((screen) => ({
    id: `${item.slug}--${screen}`,
    name: screen,
    link: `#${item.slug}/${screen}`,
  })),
}));

const result = await writeComponents(
  process.cwd(),
  { components, viewer: { name: 'Gallery', url: gallery.url }, owner: gallery.team },
  { check: process.argv.includes('--check') },
);

console.log(result);

process.exitCode = result === 'stale' ? 1 : 0;
