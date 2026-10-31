/** @jsxImportSource react */
import { StarIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '#ui/components/ui/button.tsx';
import {
  FAVORITES_KEY,
  isFavorite,
  readFavorites,
  toggleFavorite,
  writeFavorites,
  type Favorite,
} from '../../favorites';

function load(): Favorite[] {
  try {
    return readFavorites(localStorage.getItem(FAVORITES_KEY));
  } catch {
    return [];
  }
}

function save(favorites: Favorite[]): void {
  localStorage.setItem(FAVORITES_KEY, writeFavorites(favorites));
}

function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setFavorites(load());
    setReady(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key === FAVORITES_KEY) setFavorites(load());
    };

    window.addEventListener('storage', onStorage);

    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = (next: Favorite[]) => {
    setFavorites(next);
    save(next);
    window.dispatchEvent(new Event('ac-favorites'));
  };

  useEffect(() => {
    const refresh = () => setFavorites(load());

    window.addEventListener('ac-favorites', refresh);

    return () => window.removeEventListener('ac-favorites', refresh);
  }, []);

  return { favorites, ready, update };
}

/** Pin / unpin the page beside its other actions. */
export function FavoriteToggle({
  catalogKey,
  label,
}: {
  catalogKey?: string | undefined;
  label?: string | undefined;
}) {
  const { favorites, ready, update } = useFavorites();

  if (!ready || !catalogKey) return null;

  const href = typeof location !== 'undefined' ? location.pathname : '';
  const pinned = isFavorite(favorites, catalogKey);

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={pinned ? 'Unpin page' : 'Pin page'}
      aria-pressed={pinned}
      data-favorite-toggle=""
      onPress={() =>
        update(
          toggleFavorite(favorites, {
            key: catalogKey,
            href,
            label: label ?? document.title,
          }),
        )
      }
    >
      <StarIcon className={pinned ? 'fill-current' : undefined} />
      {pinned ? 'Pinned' : 'Pin'}
    </Button>
  );
}

/** Pinned pages, the first group of the sidebar, shaped like Starlight's own. */
export function FavoritesRail() {
  const { favorites, ready } = useFavorites();

  if (!ready || favorites.length === 0) return null;

  const here = location.pathname;

  return (
    <nav aria-label="Pinned pages" data-favorites-list="">
      <p data-favorites-label="">
        <StarIcon aria-hidden="true" className="size-3.5 fill-current" />
        Pinned
      </p>
      <ul>
        {favorites.map((favorite) => (
          <li key={favorite.key}>
            <a href={favorite.href} aria-current={favorite.href === here ? 'page' : undefined}>
              {favorite.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default FavoritesRail;
