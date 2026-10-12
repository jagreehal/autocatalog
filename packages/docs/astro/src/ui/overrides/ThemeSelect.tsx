/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { Button } from '#ui/components/ui/button.tsx';
import { Icon } from '../components/Icon';

type Theme = 'light' | 'dark';

// Same key and data-theme as Starlight's own select, so its no-flash script and
// every listener on data-theme (the EventCatalog frames) keep working.
const storageKey = 'starlight-theme';

const prefersLight = () => matchMedia('(prefers-color-scheme: light)').matches;

const system = (): Theme => (prefersLight() ? 'light' : 'dark');

const stored = (): Theme | null => {
  try {
    const value = localStorage.getItem(storageKey);

    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
};

const store = (theme: Theme) => {
  try {
    // The system's own preference is stored as "follow the system".
    localStorage.setItem(storageKey, theme === system() ? '' : theme);
  } catch {
    // Storage can be off; the choice then lasts until the page changes.
  }
};

/** The theme a press switches to. */
const other = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');

/**
 * One button in place of Starlight's three-way select. The page follows the
 * system until the reader presses it; pressing it flips to the other theme, and
 * flipping back to whatever the system prefers returns to following it. Which
 * icon shows is CSS on `[data-theme]`, so the markup is the same in both.
 */
export function ThemeSelect() {
  // What the server rendered, before the page's own theme is known.
  const [next, setNext] = useState<Theme>('light');

  useEffect(() => {
    const sync = () => setNext(other());

    sync();

    // Anything that changes the theme (this button, a second one in the mobile
    // menu, the system) is heard here, so every button's label stays true.
    const observer = new MutationObserver(sync);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const query = matchMedia('(prefers-color-scheme: light)');

    const follow = () => {
      if (!stored()) document.documentElement.dataset.theme = system();
    };

    query.addEventListener('change', follow);

    return () => {
      observer.disconnect();
      query.removeEventListener('change', follow);
    };
  }, []);

  const press = () => {
    const theme = other();

    store(theme);
    document.documentElement.dataset.theme = theme;
    setNext(other());
  };

  return (
    <Button variant="ghost" size="icon" aria-label={`Switch to ${next} theme`} onPress={press}>
      <Icon name="sun" className="hidden dark:block" />
      <Icon name="moon" className="dark:hidden" />
    </Button>
  );
}

export default ThemeSelect;
