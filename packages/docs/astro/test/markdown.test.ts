import { describe, expect, it } from 'vitest';
import { dropRepeatedTitle } from '../src/markdown';

describe('dropRepeatedTitle', () => {
  it('drops an opening heading that repeats the title', () => {
    const html = '\n<h1 id="runbook">Payments service runbook</h1>\n<p>Read this first.</p>';

    expect(dropRepeatedTitle(html, 'Payments service runbook')).toBe('\n<p>Read this first.</p>');
  });

  it('matches through entities, inline markup, case and spacing', () => {
    const html = '<h1>Q&amp;A  for <code>payments</code></h1><p>x</p>';

    expect(dropRepeatedTitle(html, 'q&a for payments')).toBe('<p>x</p>');
  });

  it('keeps a first heading that says something else', () => {
    const html = '<h1>Before you start</h1><p>x</p>';

    expect(dropRepeatedTitle(html, 'Payments service runbook')).toBe(html);
  });

  it('keeps a matching heading that does not open the body', () => {
    const html = '<p>Intro</p><h1>Runbook</h1>';

    expect(dropRepeatedTitle(html, 'Runbook')).toBe(html);
  });
});
