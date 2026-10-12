import type { Meta, StoryObj } from '@storybook/react-vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// Every *.stories.tsx default-exports a CSF meta; the rest of its exports are stories.
const modules = import.meta.glob<{ default: Meta } & Record<string, StoryObj>>(
  '../src/ui/**/*.stories.tsx',
  {
    eager: true,
  },
);

// Storybook only ever runs in a browser; this renders each story the way the
// site's server does, so a story that breaks fails the gate and not a demo.
describe.each(Object.entries(modules))('%s', (_file, { default: meta, ...stories }) => {
  it.each(Object.entries(stories))('%s renders', (_name, story) => {
    const args = { ...meta.args, ...story.args };

    // An empty story renders nothing on purpose; only a throw is a failure.
    expect(() =>
      renderToString(
        story.render
          ? // SAFETY: no story here reads its Storybook context.
            createElement(() => story.render!(args, {} as never))
          : createElement(meta.component!, args),
      ),
    ).not.toThrow();
  });
});
