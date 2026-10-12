// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSelect } from '../src/ui/overrides/ThemeSelect';

const key = 'starlight-theme';

const system = (light: boolean) => {
  const matchMedia = (query: string): MediaQueryList => {
    const media: MediaQueryList = {
      matches: light && query.includes('light'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };

    return media;
  };

  vi.stubGlobal('matchMedia', matchMedia);
};

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ThemeSelect behaviour', () => {
  it('labels the button with the theme a press switches to', async () => {
    system(false);
    document.documentElement.dataset.theme = 'dark';

    render(createElement(ThemeSelect));

    expect(await screen.findByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
  });

  it('flips the theme and stores the choice', async () => {
    system(false);
    document.documentElement.dataset.theme = 'dark';
    render(createElement(ThemeSelect));

    await act(async () => screen.getByRole('button').click());

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(key)).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
  });

  it('stores "follow the system" when pressed back to what the system prefers', async () => {
    system(false);
    document.documentElement.dataset.theme = 'light';
    render(createElement(ThemeSelect));

    await act(async () => screen.getByRole('button').click());

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(key)).toBe('');
  });

  it('survives storage being off', async () => {
    system(false);
    document.documentElement.dataset.theme = 'dark';
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('off');
    });
    render(createElement(ThemeSelect));

    await act(async () => screen.getByRole('button').click());

    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
